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

module.exports = {
    sendSVG,
};
