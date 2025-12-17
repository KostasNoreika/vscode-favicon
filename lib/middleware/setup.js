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
 * High-frequency endpoints that should skip metrics collection
 * These endpoints are called very frequently and metrics add measurable overhead
 */
const SKIP_METRICS_PATHS = new Set([
    '/health',
    '/health/live',
    '/health/ready',
    '/favicon',
    '/api/favicon',
    '/favicon-api',
]);

/**
 * Check if metrics should be collected for this request
 * PERF-002: Skip metrics for high-frequency endpoints, use sampling for others
 *
 * @param {string} path - Request path
 * @returns {boolean} True if metrics should be collected
 */
function shouldCollectMetrics(path) {
    // Always skip high-frequency health checks and favicon requests
    if (SKIP_METRICS_PATHS.has(path)) {
        return false;
    }

    // For critical API endpoints, always collect metrics
    if (path.startsWith('/api/') || path.startsWith('/notifications/')) {
        return true;
    }

    // For other endpoints, use 10% sampling to reduce overhead
    return Math.random() < 0.1;
}

/**
 * Configure metrics tracking middleware
 * Tracks HTTP request duration and counts for Prometheus monitoring
 *
 * PERF-002 Optimizations:
 * - Uses res.on('finish') instead of wrapping res.end (avoids closure overhead)
 * - Skips metrics for high-frequency endpoints (/health*, /favicon)
 * - Uses 10% sampling for non-critical endpoints
 *
 * @returns {Function} Metrics middleware
 */
function setupMetrics() {
    return (req, res, next) => {
        // PERF-002: Skip metrics collection for high-frequency endpoints
        if (!shouldCollectMetrics(req.path)) {
            return next();
        }

        const startTime = Date.now();

        // PERF-002: Use 'finish' event instead of wrapping res.end
        // This avoids creating a closure and function overhead on every response
        res.on('finish', () => {
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
        });

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
