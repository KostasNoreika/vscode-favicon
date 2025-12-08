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

// Use allowed paths from config
const ALLOWED_PATHS = config.allowedPaths;

// Dynamic regex based on configured allowed paths
// Extract unique base paths for regex (e.g., 'dev', 'prod', 'research')
const basePaths = ALLOWED_PATHS.map((p) => path.basename(p)).join('|');
const baseDir = path.dirname(ALLOWED_PATHS[0]); // Assume all paths share same base
const PATH_REGEX = new RegExp(
    `^${baseDir.replace(/\//g, '\\/')}\\/(${basePaths})(\\/[\\w\\-\\.]+)*$`
);

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
 * Check if path is within allowed directories
 * @deprecated Use isPathAllowedAsync() instead - this synchronous version blocks the event loop
 * @internal This function is not exported and kept only for backward compatibility in tests
 * @param {string} folder - User-provided folder path
 * @returns {boolean} - True if path is allowed
 */
function isPathAllowed(folder) {
    logger.warn(
        { function: 'isPathAllowed', folder },
        'DEPRECATED: isPathAllowed() uses synchronous fs.realpathSync() which blocks the event loop. Use isPathAllowedAsync() instead.'
    );

    const sanitized = sanitizePath(folder);
    if (!sanitized) {
        return false;
    }

    // First level: Regex validation
    if (!PATH_REGEX.test(sanitized)) {
        logger.warn({ sanitized, security: 'regex-validation' }, 'Path failed regex validation');
        return false;
    }

    try {
        // Second level: Resolve symlinks and normalize
        // This is critical - fs.realpathSync() resolves ALL symlinks
        const realPath = fs.realpathSync(sanitized);
        const normalizedPath = path.resolve(realPath);

        // Third level: Check against allowed roots with path.sep protection
        const isAllowed = ALLOWED_PATHS.some((allowed) => {
            const allowedRoot = path.resolve(allowed) + path.sep;
            return (
                normalizedPath === path.resolve(allowed) || normalizedPath.startsWith(allowedRoot)
            );
        });

        if (!isAllowed) {
            logger.warn(
                { sanitized, realPath, security: 'symlink-escape' },
                'Symlink resolved outside allowed paths'
            );
        }

        return isAllowed;
    } catch (error) {
        // Path doesn't exist - validate normalized path only
        // This allows checking paths before they're created
        const normalizedPath = path.resolve(sanitized);

        const isAllowed = ALLOWED_PATHS.some((allowed) => {
            const allowedRoot = path.resolve(allowed) + path.sep;
            return (
                normalizedPath === path.resolve(allowed) || normalizedPath.startsWith(allowedRoot)
            );
        });

        if (!isAllowed) {
            logger.warn(
                { sanitized, normalizedPath, security: 'path-validation' },
                'Non-existent path outside allowed directories'
            );
        }

        return isAllowed;
    }
}

/**
 * Validate path and return error details for logging
 * @deprecated Use validatePathAsync() instead - this synchronous version blocks the event loop
 * @internal This function is not exported and kept only for backward compatibility in tests
 * @param {string} folder - User-provided folder path
 * @returns {object} - { valid: boolean, error?: string, sanitized?: string }
 */
function validatePath(folder) {
    logger.warn(
        { function: 'validatePath', folder },
        'DEPRECATED: validatePath() uses synchronous fs.realpathSync() which blocks the event loop. Use validatePathAsync() instead.'
    );

    const sanitized = sanitizePath(folder);

    if (!sanitized) {
        return {
            valid: false,
            error: 'Invalid path format or encoding',
        };
    }

    if (!PATH_REGEX.test(sanitized)) {
        return {
            valid: false,
            error: 'Path pattern not allowed',
            sanitized,
        };
    }

    try {
        const realPath = fs.realpathSync(sanitized);
        const normalizedPath = path.resolve(realPath);

        const isAllowed = ALLOWED_PATHS.some((allowed) => {
            const allowedRoot = path.resolve(allowed) + path.sep;
            return (
                normalizedPath === path.resolve(allowed) || normalizedPath.startsWith(allowedRoot)
            );
        });

        if (!isAllowed) {
            return {
                valid: false,
                error: 'Path outside allowed directories (symlink)',
                sanitized,
                resolved: realPath,
            };
        }

        return {
            valid: true,
            sanitized,
            resolved: realPath,
        };
    } catch (error) {
        // Path doesn't exist
        const normalizedPath = path.resolve(sanitized);

        const isAllowed = ALLOWED_PATHS.some((allowed) => {
            const allowedRoot = path.resolve(allowed) + path.sep;
            return (
                normalizedPath === path.resolve(allowed) || normalizedPath.startsWith(allowedRoot)
            );
        });

        if (!isAllowed) {
            return {
                valid: false,
                error: 'Path outside allowed directories',
                sanitized,
                resolved: normalizedPath,
            };
        }

        return {
            valid: true,
            sanitized,
            resolved: normalizedPath,
        };
    }
}

/**
 * Async version of validatePath
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

    if (!PATH_REGEX.test(sanitized)) {
        return {
            valid: false,
            error: 'Path pattern not allowed',
            sanitized,
        };
    }

    try {
        const realPath = await fs.promises.realpath(sanitized);
        const normalizedPath = path.resolve(realPath);

        const isAllowed = ALLOWED_PATHS.some((allowed) => {
            const allowedRoot = path.resolve(allowed) + path.sep;
            return (
                normalizedPath === path.resolve(allowed) || normalizedPath.startsWith(allowedRoot)
            );
        });

        if (!isAllowed) {
            return {
                valid: false,
                error: 'Path outside allowed directories (symlink)',
                sanitized,
                resolved: realPath,
            };
        }

        return {
            valid: true,
            sanitized,
            resolved: realPath,
        };
    } catch (error) {
        // Path doesn't exist
        const normalizedPath = path.resolve(sanitized);

        const isAllowed = ALLOWED_PATHS.some((allowed) => {
            const allowedRoot = path.resolve(allowed) + path.sep;
            return (
                normalizedPath === path.resolve(allowed) || normalizedPath.startsWith(allowedRoot)
            );
        });

        if (!isAllowed) {
            return {
                valid: false,
                error: 'Path outside allowed directories',
                sanitized,
                resolved: normalizedPath,
            };
        }

        return {
            valid: true,
            sanitized,
            resolved: normalizedPath,
        };
    }
}

/**
 * Async version of isPathAllowed
 * @param {string} folder - User-provided folder path
 * @returns {Promise<boolean>} - True if path is allowed
 */
async function isPathAllowedAsync(folder) {
    const sanitized = sanitizePath(folder);
    if (!sanitized) {
        return false;
    }

    // First level: Regex validation
    if (!PATH_REGEX.test(sanitized)) {
        logger.warn(
            { sanitized, security: 'regex-validation' },
            'Path failed regex validation (async)'
        );
        return false;
    }

    try {
        // Second level: Resolve symlinks and normalize
        const realPath = await fs.promises.realpath(sanitized);
        const normalizedPath = path.resolve(realPath);

        // Third level: Check against allowed roots with path.sep protection
        const isAllowed = ALLOWED_PATHS.some((allowed) => {
            const allowedRoot = path.resolve(allowed) + path.sep;
            return (
                normalizedPath === path.resolve(allowed) || normalizedPath.startsWith(allowedRoot)
            );
        });

        if (!isAllowed) {
            logger.warn(
                { sanitized, realPath, security: 'symlink-escape' },
                'Symlink resolved outside allowed paths (async)'
            );
        }

        return isAllowed;
    } catch (error) {
        // Path doesn't exist - validate normalized path only
        const normalizedPath = path.resolve(sanitized);

        const isAllowed = ALLOWED_PATHS.some((allowed) => {
            const allowedRoot = path.resolve(allowed) + path.sep;
            return (
                normalizedPath === path.resolve(allowed) || normalizedPath.startsWith(allowedRoot)
            );
        });

        if (!isAllowed) {
            logger.warn(
                { sanitized, normalizedPath, security: 'path-validation' },
                'Non-existent path outside allowed directories (async)'
            );
        }

        return isAllowed;
    }
}

// IMPORTANT: Only async functions are exported to prevent event loop blocking
// Synchronous functions (isPathAllowed, validatePath) are kept in the file for
// backward compatibility in existing tests but are NOT exported.
// All production code MUST use the async versions.
module.exports = {
    sanitizePath,
    validatePathAsync,
    isPathAllowedAsync,
    ALLOWED_PATHS,
    // Testing exports - synchronous versions for unit tests only
    // DO NOT use in production code - these block the event loop
    _testing: {
        isPathAllowed,
        validatePath,
    },
};
