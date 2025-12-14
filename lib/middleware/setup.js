/**
 * Middleware Setup Module
 * Centralized configuration for Express middleware
 *
 * This module acts as a composition layer that imports and re-exports
 * middleware from focused modules:
 * - security-middleware.js: Security (Helmet, CORS, Trust Proxy, CSRF, Admin Auth)
 * - rate-limiters.js: Rate limiting for all endpoints
 * - compression-middleware.js: Response compression
 *
 * Additionally provides:
 * - Request logging middleware
 * - Metrics tracking middleware
 * - JSON body parser middleware
 */

const logger = require('../logger');
const requestLogger = logger.requestLogger;

// Import focused middleware modules
const {
    setupTrustProxy,
    createProxyHeaderValidator,
    setupHelmet,
    setupCORS,
    createCSRFProtection,
    createAdminAuth,
} = require('./security-middleware');

const {
    createAPILimiter,
    createNotificationLimiter,
    createDownloadLimiter,
    createCacheClearLimiter,
    createPasteImageLimiter,
    createHealthCheckLimiter,
} = require('./rate-limiters');

const {
    setupCompression,
} = require('./compression-middleware');

const {
    httpRequestDuration,
    httpRequestsTotal,
    normalizeRoute,
} = require('../metrics');

/**
 * Configure request logging middleware
 *
 * @returns {Function} Request logger middleware
 */
function setupRequestLogging() {
    return requestLogger('unified');
}

/**
 * Configure metrics tracking middleware
 * Tracks HTTP request duration and counts for Prometheus monitoring
 *
 * @returns {Function} Metrics middleware
 */
function setupMetrics() {
    return (req, res, next) => {
        const startTime = Date.now();

        // Capture original res.end to track response completion
        const originalEnd = res.end;

        res.end = function (...args) {
            // Calculate request duration in seconds
            const durationSeconds = (Date.now() - startTime) / 1000;

            // Normalize route for consistent labels
            const route = normalizeRoute(req.path);
            const method = req.method;
            const statusCode = res.statusCode;

            // Record metrics
            httpRequestDuration.observe(
                { method, route, status_code: statusCode },
                durationSeconds
            );
            httpRequestsTotal.inc({ method, route, status_code: statusCode });

            // Call original end function
            originalEnd.apply(res, args);
        };

        next();
    };
}

/**
 * Configure JSON body parser with size limit
 *
 * @param {Object} express - Express module
 * @returns {Function} JSON body parser middleware
 */
function setupBodyParser(express) {
    // SECURITY: Limit JSON body size to 10KB to prevent DoS attacks
    return express.json({ limit: '10kb' });
}

// Export all middleware functions
module.exports = {
    // Security middleware
    setupTrustProxy,
    createProxyHeaderValidator,
    setupHelmet,
    setupCORS,
    createCSRFProtection,
    createAdminAuth,

    // Rate limiters
    createAPILimiter,
    createNotificationLimiter,
    createDownloadLimiter,
    createCacheClearLimiter,
    createPasteImageLimiter,
    createHealthCheckLimiter,

    // Compression
    setupCompression,

    // Request logging, metrics, and body parsing
    setupRequestLogging,
    setupMetrics,
    setupBodyParser,
};
