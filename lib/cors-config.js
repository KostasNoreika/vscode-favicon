/**
 * CORS Configuration Module
 *
 * This API is designed for public use by browser extensions that can run on
 * any VS Code Server domain. Therefore, CORS is open to all origins.
 *
 * Security is maintained through:
 * - Path validation (prevents directory traversal)
 * - Rate limiting (prevents abuse)
 * - Read-only favicon data (no sensitive information)
 */

/**
 * CORS middleware - allows all origins
 *
 * Features:
 * 1. Reflects request origin (allows any origin)
 * 2. Vary: Origin header - ensures proper caching
 * 3. Proper preflight handling - returns 204 No Content
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
function corsMiddleware(req, res, next) {
    const origin = req.headers.origin;

    if (origin) {
        // Reflect the request origin (allows all origins)
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With');

        // Vary header ensures proper caching per origin
        res.setHeader('Vary', 'Origin');
    }

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }

    next();
}

/**
 * Validate if an origin is allowed
 * Now always returns true since all origins are allowed.
 *
 * @param {string} origin - Origin header value
 * @returns {boolean} - Always true for valid origins
 */
function isOriginAllowed(origin) {
    // All origins are allowed, just validate it's a non-empty string
    return typeof origin === 'string' && origin.length > 0;
}

// Production exports
module.exports = {
    corsMiddleware,

    // Test-only exports
    _testing: {
        isOriginAllowed,
    },
};
