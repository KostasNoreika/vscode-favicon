/**
 * Secure Path Validator
 *
 * Protects against:
 * - Directory traversal (../)
 * - Symlink attacks
 * - URL encoding bypasses (%2F..%2F)
 * - Null byte injection (%00)
 * - Path prefix confusion (/opt/devmalicious)
 *
 * CVSS 9.1 vulnerability fix
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');
const logger = require('./logger');
const LRUCache = require('./lru-cache');

// Use allowed paths from config
const ALLOWED_PATHS = config.allowedPaths;

// PERF-011: Pre-compile separate regex per allowed path for better performance
// This approach doesn't assume all paths share the same base directory
const PATH_REGEXES = ALLOWED_PATHS.map((allowedPath) => {
    const escaped = allowedPath.replace(/\//g, '\\/');
    return new RegExp(`^${escaped}(\\/[\\w\\-\\.]+)*$`);
});

// PERF-011: Pre-compute prefix strings for fast-path checks
// Check string prefixes before expensive regex matching
const ALLOWED_PREFIXES = ALLOWED_PATHS.map((p) => p + '/');
const ALLOWED_EXACT_MATCHES = new Set(ALLOWED_PATHS);

// PERF-012: LRU cache for validated paths with 60s TTL
// Most requests are for the same set of project paths
const pathCache = new LRUCache(100);
const PATH_CACHE_TTL = 60000; // 60 seconds

// PERF-013: Periodic cache cleanup to remove expired entries
// Without this, entries never re-accessed remain in LRU indefinitely
const CACHE_CLEANUP_INTERVAL = 60000; // 60 seconds (matches TTL)

let cleanupInterval = null;

/**
 * Start periodic cache cleanup
 * Removes expired entries to prevent memory bloat
 *
 * PERF-013: Adds automatic TTL-based cache expiration
 * - Runs every 60 seconds (matches PATH_CACHE_TTL)
 * - Iterates through cache entries and removes expired ones
 * - Prevents stale entries from accumulating indefinitely
 */
function startCacheCleanup() {
    if (cleanupInterval) {
        return; // Already running
    }

    cleanupInterval = setInterval(() => {
        const now = Date.now();
        let removedCount = 0;

        // Iterate through cache entries and remove expired ones
        // Use entriesIterator() for memory-efficient iteration
        for (const [key, value] of pathCache.entriesIterator()) {
            if (value && value.timestamp && now - value.timestamp >= PATH_CACHE_TTL) {
                pathCache.delete(key);
                removedCount++;
            }
        }

        // Log cleanup activity if entries were removed
        if (removedCount > 0) {
            const stats = pathCache.getStats();
            logger.debug(
                {
                    removedCount,
                    remainingSize: stats.size,
                    hitRate: stats.hitRate,
                    performance: 'PERF-013',
                },
                'Path validation cache cleanup completed'
            );
        }
    }, CACHE_CLEANUP_INTERVAL);

    // Prevent cleanup interval from keeping the process alive
    // This allows graceful shutdown when the main server stops
    if (cleanupInterval.unref) {
        cleanupInterval.unref();
    }
}

/**
 * Stop periodic cache cleanup
 * Should be called during graceful shutdown
 */
function stopCacheCleanup() {
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
        logger.debug('Path validation cache cleanup stopped');
    }
}

// Start cleanup on module load
startCacheCleanup();

/**
 * Sanitize and validate input path
 * @param {string} folder - User-provided folder path
 * @returns {string|null} - Sanitized path or null if invalid
 */
function sanitizePath(folder) {
    // Type validation
    if (!folder || typeof folder !== 'string') {
        return null;
    }

    // Decode URL encoding and detect double-encoding attacks
    let decoded;
    try {
        decoded = decodeURIComponent(folder);
        // Detect double-encoding attempts
        const doubleDecoded = decodeURIComponent(decoded);
        if (decoded !== doubleDecoded) {
            logger.warn({ folder, security: 'double-encoding' }, 'Double URL encoding detected');
            return null;
        }
    } catch (error) {
        logger.warn({ folder, security: 'url-encoding' }, 'Invalid URL encoding detected');
        return null;
    }

    // PERF-011: Early rejection - must start with '/' (absolute paths only)
    // This fast check rejects most malformed inputs after URL decoding
    if (decoded.length === 0 || decoded[0] !== '/') {
        return null;
    }

    // Block null bytes
    if (decoded.includes('\0') || decoded.includes('%00')) {
        logger.warn({ folder, security: 'null-byte' }, 'Null byte injection attempt');
        return null;
    }

    // Block explicit directory traversal patterns
    if (decoded.includes('..') || decoded.includes('./')) {
        logger.warn({ folder, security: 'path-traversal' }, 'Directory traversal pattern detected');
        return null;
    }

    // Remove trailing slashes (VS Code Server URLs often have them)
    decoded = decoded.replace(/\/+$/, '');

    // Normalize case for macOS (case-insensitive filesystem)
    // VS Code Server sometimes sends /Opt/dev instead of /opt/dev
    return decoded.toLowerCase();
}

/**
 * Core path validation logic - checks if normalized path is within allowed directories
 * @param {string} normalizedPath - Normalized absolute path to check
 * @returns {boolean} - True if path is allowed
 */
function checkPathAgainstAllowed(normalizedPath) {
    return ALLOWED_PATHS.some((allowed) => {
        const allowedRoot = path.resolve(allowed) + path.sep;
        return (
            normalizedPath === path.resolve(allowed) || normalizedPath.startsWith(allowedRoot)
        );
    });
}

/**
 * Resolve symlinks asynchronously with error handling
 * @param {string} sanitized - Sanitized path to resolve
 * @returns {Promise<{realPath: string|null, error: Error|null}>} - Resolved path or error
 */
async function resolvePathAsync(sanitized) {
    try {
        const realPath = await fs.promises.realpath(sanitized);
        return { realPath, error: null };
    } catch (error) {
        return { realPath: null, error };
    }
}

/**
 * Core path validation logic - performs canonicalization and validation
 * Extracted from validatePathAsync and isPathAllowedAsync to reduce code duplication
 * @private
 * @param {string} sanitized - Sanitized path (already lowercased)
 * @returns {Promise<object>} - { valid: boolean, resolved: string, error?: string, hasResolveError: boolean }
 */
async function validatePathCore(sanitized) {
    // PERF-011: Fast-path check - exact match or prefix match before regex
    // This avoids regex overhead for the common case of valid paths
    let matchesPattern = false;

    if (ALLOWED_EXACT_MATCHES.has(sanitized)) {
        // Exact match - fast path
        matchesPattern = true;
    } else {
        // Check if path starts with any allowed prefix
        for (let i = 0; i < ALLOWED_PREFIXES.length; i++) {
            if (sanitized.startsWith(ALLOWED_PREFIXES[i])) {
                // Found prefix match - now validate with corresponding regex
                // to ensure the path components are valid (no special chars, etc.)
                if (PATH_REGEXES[i].test(sanitized)) {
                    matchesPattern = true;
                    break;
                }
            }
        }
    }

    if (!matchesPattern) {
        return {
            valid: false,
            resolved: path.resolve(sanitized),
            error: 'Path pattern not allowed',
            hasResolveError: false,
        };
    }

    // Second level: Resolve symlinks and normalize
    const { realPath, error: resolveError } = await resolvePathAsync(sanitized);
    const normalizedPath = realPath ? path.resolve(realPath) : path.resolve(sanitized);

    // Third level: Check against allowed roots with path.sep protection
    const isAllowed = checkPathAgainstAllowed(normalizedPath);

    return {
        valid: isAllowed,
        resolved: realPath || normalizedPath,
        error: isAllowed ? undefined : (resolveError ? 'Path outside allowed directories' : 'Path outside allowed directories (symlink)'),
        hasResolveError: !!resolveError,
    };
}

/**
 * Async version of validatePath with LRU caching
 * @param {string} folder - User-provided folder path
 * @returns {Promise<object>} - { valid: boolean, error?: string, sanitized?: string }
 */
async function validatePathAsync(folder) {
    const sanitized = sanitizePath(folder);

    if (!sanitized) {
        return {
            valid: false,
            error: 'Invalid path format or encoding',
        };
    }

    // PERF-012: Check cache first
    const cached = pathCache.get(sanitized);
    if (cached && Date.now() - cached.timestamp < PATH_CACHE_TTL) {
        return {
            valid: cached.valid,
            sanitized: cached.sanitized,
            resolved: cached.resolved,
            error: cached.error,
        };
    }

    // Use core validation logic
    const coreResult = await validatePathCore(sanitized);

    const result = {
        valid: coreResult.valid,
        sanitized,
        resolved: coreResult.resolved,
        error: coreResult.error,
    };

    // Cache result
    pathCache.set(sanitized, { ...result, timestamp: Date.now() });
    return result;
}

/**
 * Async version of isPathAllowed with LRU caching
 * @param {string} folder - User-provided folder path
 * @returns {Promise<boolean>} - True if path is allowed
 */
async function isPathAllowedAsync(folder) {
    const sanitized = sanitizePath(folder);
    if (!sanitized) {
        return false;
    }

    // PERF-012: Check cache first
    const cached = pathCache.get(sanitized);
    if (cached && Date.now() - cached.timestamp < PATH_CACHE_TTL) {
        return cached.valid;
    }

    // Use core validation logic
    const coreResult = await validatePathCore(sanitized);

    // Log validation failures with detailed context
    if (!coreResult.valid) {
        if (coreResult.error === 'Path pattern not allowed') {
            logger.warn(
                { sanitized, security: 'regex-validation' },
                'Path failed regex validation (async)'
            );
        } else if (!coreResult.hasResolveError) {
            logger.warn(
                { sanitized, realPath: coreResult.resolved, security: 'symlink-escape' },
                'Symlink resolved outside allowed paths (async)'
            );
        } else {
            logger.warn(
                { sanitized, normalizedPath: coreResult.resolved, security: 'path-validation' },
                'Non-existent path outside allowed directories (async)'
            );
        }
    }

    // Cache result
    pathCache.set(sanitized, {
        valid: coreResult.valid,
        resolved: coreResult.resolved,
        timestamp: Date.now(),
    });

    return coreResult.valid;
}

/**
 * Get path validation cache statistics
 * @returns {Object} Cache statistics
 */
function getPathCacheStats() {
    return pathCache.getStats();
}

// Only async functions are exported to prevent event loop blocking
// All production code MUST use the async versions
module.exports = {
    sanitizePath,
    validatePathAsync,
    isPathAllowedAsync,
    getPathCacheStats,
    startCacheCleanup,
    stopCacheCleanup,
    ALLOWED_PATHS,
};
