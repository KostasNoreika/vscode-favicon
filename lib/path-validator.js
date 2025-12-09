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

// PERF-012: LRU cache for validated paths with 60s TTL
// Most requests are for the same set of project paths
const pathCache = new LRUCache(100);
const PATH_CACHE_TTL = 60000; // 60 seconds

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

    // First level: Regex validation
    if (!PATH_REGEXES.some((regex) => regex.test(sanitized))) {
        const result = {
            valid: false,
            error: 'Path pattern not allowed',
            sanitized,
        };
        // Cache negative results too
        pathCache.set(sanitized, { ...result, timestamp: Date.now() });
        return result;
    }

    const { realPath, error: resolveError } = await resolvePathAsync(sanitized);
    const normalizedPath = realPath ? path.resolve(realPath) : path.resolve(sanitized);
    const isAllowed = checkPathAgainstAllowed(normalizedPath);

    const result = {
        valid: isAllowed,
        sanitized,
        resolved: realPath || normalizedPath,
        error: isAllowed ? undefined : (resolveError ? 'Path outside allowed directories' : 'Path outside allowed directories (symlink)'),
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

    // First level: Regex validation
    if (!PATH_REGEXES.some((regex) => regex.test(sanitized))) {
        logger.warn(
            { sanitized, security: 'regex-validation' },
            'Path failed regex validation (async)'
        );
        // Cache negative result
        pathCache.set(sanitized, { valid: false, timestamp: Date.now() });
        return false;
    }

    // Second level: Resolve symlinks and normalize
    const { realPath, error } = await resolvePathAsync(sanitized);
    const normalizedPath = realPath ? path.resolve(realPath) : path.resolve(sanitized);

    // Third level: Check against allowed roots with path.sep protection
    const isAllowed = checkPathAgainstAllowed(normalizedPath);

    if (!isAllowed) {
        if (!error) {
            logger.warn(
                { sanitized, realPath, security: 'symlink-escape' },
                'Symlink resolved outside allowed paths (async)'
            );
        } else {
            logger.warn(
                { sanitized, normalizedPath, security: 'path-validation' },
                'Non-existent path outside allowed directories (async)'
            );
        }
    }

    // Cache result
    pathCache.set(sanitized, {
        valid: isAllowed,
        resolved: realPath || normalizedPath,
        timestamp: Date.now(),
    });

    return isAllowed;
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
    ALLOWED_PATHS,
};
