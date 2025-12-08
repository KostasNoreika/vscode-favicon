/**
 * CORS Configuration Module
 *
 * Security: Implements strict CORS policy to prevent unauthorized cross-origin access
 * OWASP Reference: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Origin_Resource_Sharing_Cheat_Sheet.html
 *
 * CVE Mitigations:
 * - Prevents CORS misconfiguration attacks (CWE-942)
 * - Mitigates data exfiltration via wildcard origins
 * - Protects against CSRF attacks on API endpoints
 */

const config = require('./config');

// Use allowed origins from centralized config
const ALLOWED_ORIGINS = config.corsOrigins;

/**
 * CORS middleware with strict origin validation
 *
 * Security features:
 * 1. Whitelist validation - only trusted origins receive CORS headers
 * 2. Vary: Origin header - prevents cache poisoning attacks
 * 3. Proper preflight handling - returns 204 No Content
 * 4. No credentials support - reduces attack surface
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
function corsMiddleware(req, res, next) {
    const origin = req.headers.origin;

    // Validate origin against whitelist
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
        // Set CORS headers ONLY for whitelisted origins
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        // Critical: Vary header prevents cache poisoning
        // Without this, cached responses could be served to wrong origins
        res.setHeader('Vary', 'Origin');
    }
    // SECURITY: No CORS headers for non-whitelisted origins
    // This causes the browser to block the response

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        // 204 No Content is the correct HTTP status for successful preflight
        return res.sendStatus(204);
    }

    next();
}

/**
 * Validate if an origin is allowed
 * Useful for logging or additional validation logic
 *
 * @param {string} origin - Origin header value
 * @returns {boolean} - True if origin is whitelisted, false otherwise
 */
function isOriginAllowed(origin) {
    // Explicit boolean conversion to handle undefined, null, empty string
    return Boolean(origin && ALLOWED_ORIGINS.includes(origin));
}

// Production exports - used in application code
module.exports = {
    corsMiddleware,
    ALLOWED_ORIGINS,

    // Test-only exports - internal functions exposed for comprehensive testing
    // Not used in production code, only in test suites
    _testing: {
        isOriginAllowed,
    },
};
