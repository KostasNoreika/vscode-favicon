/**
 * HTTP Response Helpers
 *
 * Centralized response helpers for consistent security headers and response formatting
 *
 * FIX QUA-029: Defense-in-depth security headers for SVG responses
 * While Helmet provides global noSniff, explicit headers on SVG responses prevent
 * MIME-sniffing attacks if global middleware is bypassed or disabled.
 */

/**
 * Send SVG response with proper security headers
 * Applies defense-in-depth security headers for SVG content
 *
 * SECURITY HEADERS:
 * - Content-Type: image/svg+xml - Explicit MIME type declaration
 * - X-Content-Type-Options: nosniff - Prevent MIME-sniffing attacks
 * - Cache-Control: Configurable caching policy
 *
 * @param {Object} res - Express response object
 * @param {string|Buffer} svgContent - SVG content (string or Buffer)
 * @param {Object} options - Response options
 * @param {string} options.cacheControl - Cache-Control header value (default: 'public, max-age=3600')
 */
function sendSVG(res, svgContent, options = {}) {
    const {cacheControl = 'public, max-age=3600'} = options;

    // Set content type
    res.setHeader('Content-Type', 'image/svg+xml');

    // SECURITY: Prevent MIME-sniffing attacks
    // Even though Helmet sets this globally, we set it explicitly for defense-in-depth
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Set caching policy
    res.setHeader('Cache-Control', cacheControl);

    // Send response
    res.send(svgContent);
}

/**
 * Standardized error codes for consistent API responses
 * QUA-012: Consistent error response format
 */
const ErrorCodes = {
    MISSING_PARAMETER: 'MISSING_PARAMETER',
    INVALID_PARAMETER: 'INVALID_PARAMETER',
    ACCESS_DENIED: 'ACCESS_DENIED',
    NOT_FOUND: 'NOT_FOUND',
    FILE_TOO_LARGE: 'FILE_TOO_LARGE',
    INVALID_FILE_TYPE: 'INVALID_FILE_TYPE',
    TOO_MANY_FILES: 'TOO_MANY_FILES',
    RATE_LIMITED: 'RATE_LIMITED',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
    UPLOAD_FAILED: 'UPLOAD_FAILED',
};

/**
 * Send standardized error response (legacy format)
 * @param {Object} res - Express response object
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {Object} details - Additional error details
 */
function sendErrorResponse(res, statusCode, message, details = {}) {
    res.status(statusCode).json({
        error: message,
        details: {
            timestamp: new Date().toISOString(),
            ...details
        }
    });
}

/**
 * Send standardized error response with error code
 * QUA-012: Consistent error response format
 *
 * @param {Object} res - Express response object
 * @param {number} statusCode - HTTP status code
 * @param {string} code - Error code from ErrorCodes
 * @param {string} message - Human-readable error message
 */
function sendError(res, statusCode, code, message) {
    res.status(statusCode).json({
        error: true,
        code,
        message,
    });
}

module.exports = {
    sendSVG,
    sendErrorResponse,
    sendError,
    ErrorCodes,
};
