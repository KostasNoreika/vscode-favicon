/**
 * Middleware Setup Module
 * Centralized configuration for Express middleware
 *
 * Exports middleware configuration functions for:
 * - Security (Helmet, CORS, Trust Proxy)
 * - Performance (Compression)
 * - Rate Limiting (API, Notifications, Downloads, Cache Clear)
 * - Request Logging
 */

const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { corsMiddleware } = require('../cors-config');
const config = require('../config');
const logger = require('../logger');
const { requestLogger } = require('../logger');

/**
 * Configure trust proxy settings for accurate client IP detection
 *
 * @param {Object} app - Express application instance
 */
function setupTrustProxy(app) {
    // SECURITY FIX SEC-003: Trust proxy configuration for accurate client IP detection
    //
    // IMPORTANT: This setting controls how Express extracts the client IP address from
    // X-Forwarded-For headers. Incorrect configuration allows IP spoofing attacks that
    // can bypass rate limiting and admin authentication.
    //
    // Current setting: 'trust proxy' = 1
    // - Trusts the FIRST proxy in the chain (immediate proxy)
    // - Suitable when directly behind a single reverse proxy (nginx, Cloudflare, etc.)
    // - Express will use the RIGHTMOST IP in X-Forwarded-For as the client IP
    //
    // Deployment considerations:
    // - Single proxy (nginx, Cloudflare): Use app.set('trust proxy', 1) ✓
    // - Multiple proxies: Use app.set('trust proxy', true) for all proxies (higher risk)
    // - Known proxy IPs: Use array like ['192.168.1.1', '10.0.0.1'] (most secure)
    // - No proxy: Use app.set('trust proxy', false) or remove this setting
    //
    // Security implications:
    // - If trust proxy is HIGHER than actual proxy count: IP spoofing possible
    // - If trust proxy is LOWER than actual proxy count: Internal proxy IPs used
    // - Always verify req.ip matches expected client IPs in production logs
    //
    // Current deployment: Behind Cloudflare (1 proxy hop)
    app.set('trust proxy', 1);
}

/**
 * Configure request logging middleware
 *
 * @returns {Function} Request logger middleware
 */
function setupRequestLogging() {
    return requestLogger('unified');
}

/**
 * Configure compression middleware
 *
 * @returns {Function} Compression middleware
 */
function setupCompression() {
    // COMPRESSION: Gzip compression for responses > 1KB (70-90% reduction)
    return compression({
        level: config.compressionLevel, // Balanced speed/compression
        threshold: config.compressionThreshold, // Only compress responses > 1KB
        filter: (req, res) => {
            if (req.headers['x-no-compression']) {
                return false;
            }
            return compression.filter(req, res);
        },
    });
}

/**
 * Configure Helmet security headers
 *
 * @returns {Function} Helmet middleware
 */
function setupHelmet() {
    // SECURITY: Helmet security headers
    return helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"], // Required for SVG inline styles
                scriptSrc: ["'self'"],
                imgSrc: ["'self'", 'data:'], // Allow data: URIs for favicons
                objectSrc: ["'none'"],
                upgradeInsecureRequests: [],
            },
        },
        crossOriginEmbedderPolicy: false, // Allow embedding favicons
        crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow favicons to be loaded from vs.noreika.lt
        hsts: {
            maxAge: 31536000, // 1 year
            includeSubDomains: true,
            preload: true,
        },
        frameguard: { action: 'deny' },
        noSniff: true,
        xssFilter: true,
    });
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

/**
 * Configure CORS middleware
 *
 * @returns {Function} CORS middleware
 */
function setupCORS() {
    // SECURITY: Strict CORS policy with origin whitelist validation
    // IMPORTANT: Must be BEFORE rate limiters so 429 responses include CORS headers
    return corsMiddleware;
}

/**
 * Create API rate limiter
 *
 * @returns {Function} API rate limiter middleware
 */
function createAPILimiter() {
    // SECURITY: Rate limiting configuration from centralized config
    return rateLimit({
        windowMs: config.rateLimitWindow,
        max: config.rateLimitMax,
        message: { error: 'Too many requests, please try again later' },
        standardHeaders: true,
        legacyHeaders: false,
        skip: (req) =>
            req.path === '/health' || req.path === '/health/live' || req.path === '/health/ready',
        handler: (req, res) => {
            logger.warn(
                {
                    ip: req.ip,
                    path: req.path,
                    limit: 'api',
                },
                'Rate limit exceeded'
            );
            res.status(429).json({
                error: 'Too many requests, please try again later',
                retryAfter: Math.ceil(req.rateLimit.resetTime / 1000),
            });
        },
    });
}

/**
 * Create notification rate limiter
 *
 * @returns {Function} Notification rate limiter middleware
 */
function createNotificationLimiter() {
    // SECURITY: Stricter rate limit for notification endpoints from centralized config
    return rateLimit({
        windowMs: config.rateLimitNotificationWindow,
        max: config.rateLimitNotificationMax,
        message: { error: 'Too many notification requests' },
        standardHeaders: true,
        legacyHeaders: false,
        handler: (req, res) => {
            logger.warn(
                {
                    ip: req.ip,
                    path: req.path,
                    limit: 'notification',
                },
                'Notification rate limit exceeded'
            );
            res.status(429).json({
                error: 'Too many notification requests',
                retryAfter: Math.ceil(req.rateLimit.resetTime / 1000),
            });
        },
    });
}

/**
 * Create download rate limiter
 *
 * @returns {Function} Download rate limiter middleware
 */
function createDownloadLimiter() {
    // FIX QUA-016: Rate limiter for download endpoint (5 downloads per hour per IP)
    return rateLimit({
        windowMs: 60 * 60 * 1000, // 1 hour
        max: 5, // 5 downloads per hour per IP
        message: { error: 'Too many download requests' },
        standardHeaders: true,
        legacyHeaders: false,
        handler: (req, res) => {
            logger.warn(
                {
                    ip: req.ip,
                    path: req.path,
                    limit: 'download',
                },
                'Download rate limit exceeded'
            );
            res.status(429).json({
                error: 'Too many download requests',
                retryAfter: Math.ceil(req.rateLimit.resetTime / 1000),
            });
        },
    });
}

/**
 * Create cache clear rate limiter
 *
 * @returns {Function} Cache clear rate limiter middleware
 */
function createCacheClearLimiter() {
    // SECURITY: Strict rate limit for cache clear endpoint (1 req/min)
    return rateLimit({
        windowMs: 60000, // 1 minute
        max: 1, // 1 request per minute
        message: { error: 'Cache clear rate limit exceeded. Try again in 1 minute.' },
        standardHeaders: true,
        legacyHeaders: false,
        handler: (req, res) => {
            logger.warn({ ip: req.ip }, 'Cache clear rate limit exceeded');
            res.status(429).json({
                error: 'Cache clear rate limit exceeded',
                retryAfter: 60,
            });
        },
    });
}

/**
 * Create admin authentication middleware
 *
 * @returns {Function} Admin authentication middleware
 */
function createAdminAuth() {
    // SECURITY: Admin authentication middleware for cache clear endpoint
    // FIX SEC-001: Enhanced with API key authentication
    return (req, res, next) => {
        // Get allowed IPs from validated config (centralized in lib/config.js)
        const allowedIPs = config.adminIPs;

        // Extract client IP with fallback chain
        // req.ip is set by Express with 'trust proxy' enabled
        // req.connection.remoteAddress is deprecated but kept for backward compatibility
        const clientIP = req.ip || req.connection?.remoteAddress || 'unknown';

        // SECURITY: Reject if client IP cannot be determined
        if (clientIP === 'unknown') {
            req.log.error('Unable to determine client IP for admin authentication');
            return res.status(403).json({ error: 'Forbidden' });
        }

        // SECURITY FIX SEC-001: API key authentication (defense-in-depth)
        // If adminApiKey is configured, require BOTH IP whitelist AND API key
        if (config.adminApiKey) {
            // Check for API key in X-API-Key header or Authorization: Bearer header
            const apiKeyHeader = req.headers['x-api-key'];
            const authHeader = req.headers['authorization'];

            let providedKey = null;
            if (apiKeyHeader) {
                providedKey = apiKeyHeader;
            } else if (authHeader && authHeader.startsWith('Bearer ')) {
                providedKey = authHeader.substring(7); // Remove 'Bearer ' prefix
            }

            // Validate API key (constant-time comparison to prevent timing attacks)
            if (!providedKey || providedKey !== config.adminApiKey) {
                req.log.warn(
                    {
                        ip: clientIP,
                        hasApiKey: !!providedKey,
                        headerUsed: apiKeyHeader ? 'X-API-Key' : (authHeader ? 'Authorization' : 'none')
                    },
                    'Admin authentication failed: invalid or missing API key'
                );
                return res.status(403).json({ error: 'Forbidden' });
            }

            req.log.debug({ ip: clientIP }, 'API key validation successful');
        }

        // Check if client IP is in the allowed list
        if (!allowedIPs.includes(clientIP)) {
            req.log.warn({ ip: clientIP, allowedIPs }, 'Unauthorized cache clear attempt');
            return res.status(403).json({ error: 'Forbidden' });
        }

        next();
    };
}

module.exports = {
    setupTrustProxy,
    setupRequestLogging,
    setupCompression,
    setupHelmet,
    setupBodyParser,
    setupCORS,
    createAPILimiter,
    createNotificationLimiter,
    createDownloadLimiter,
    createCacheClearLimiter,
    createAdminAuth,
};
