/**
 * Rate Limiter Middleware Module
 * Centralized configuration for all rate limiters
 *
 * Exports rate limiter middleware functions for:
 * - API endpoints (general)
 * - Notification endpoints
 * - Download endpoints
 * - Cache clear endpoints
 * - Paste image endpoints
 * - Health check endpoints
 */

const rateLimit = require('express-rate-limit');
const config = require('../config');
const logger = require('../logger');

/**
 * Create API rate limiter
 *
 * @returns {Function} API rate limiter middleware
 */
function createAPILimiter() {
    // SECURITY: Rate limiting configuration from centralized config
    // FIX SEC-009: Removed skip for health endpoints - now have dedicated limiter
    return rateLimit({
        windowMs: config.rateLimitWindow,
        max: config.rateLimitMax,
        message: { error: 'Too many requests, please try again later' },
        standardHeaders: true,
        legacyHeaders: false,
        handler: (req, res) => {
            const retryAfterSeconds = Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000);
            logger.warn(
                {
                    ip: req.ip,
                    path: req.path,
                    limit: 'api',
                    retryAfter: retryAfterSeconds,
                },
                'Rate limit exceeded'
            );
            res.setHeader('Retry-After', retryAfterSeconds);
            res.status(429).json({
                error: 'Too many requests, please try again later',
                retryAfter: retryAfterSeconds,
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
            const retryAfterSeconds = Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000);
            logger.warn(
                {
                    ip: req.ip,
                    path: req.path,
                    limit: 'notification',
                    retryAfter: retryAfterSeconds,
                },
                'Notification rate limit exceeded'
            );
            res.setHeader('Retry-After', retryAfterSeconds);
            res.status(429).json({
                error: 'Too many notification requests',
                retryAfter: retryAfterSeconds,
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
            const retryAfterSeconds = Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000);
            logger.warn(
                {
                    ip: req.ip,
                    path: req.path,
                    limit: 'download',
                    retryAfter: retryAfterSeconds,
                },
                'Download rate limit exceeded'
            );
            res.setHeader('Retry-After', retryAfterSeconds);
            res.status(429).json({
                error: 'Too many download requests',
                retryAfter: retryAfterSeconds,
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
            const retryAfterSeconds = Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000);
            logger.warn({ ip: req.ip, retryAfter: retryAfterSeconds }, 'Cache clear rate limit exceeded');
            res.setHeader('Retry-After', retryAfterSeconds);
            res.status(429).json({
                error: 'Cache clear rate limit exceeded',
                retryAfter: retryAfterSeconds,
            });
        },
    });
}

/**
 * Create paste image rate limiter
 *
 * @returns {Function} Paste image rate limiter middleware
 */
function createPasteImageLimiter() {
    // Rate limit for paste image endpoint (100 req/min per IP)
    return rateLimit({
        windowMs: 60000, // 1 minute
        max: 100, // 100 requests per minute per IP
        message: { error: 'Too many paste requests' },
        standardHeaders: true,
        legacyHeaders: false,
        handler: (req, res) => {
            const retryAfterSeconds = Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000);
            logger.warn(
                {
                    ip: req.ip,
                    path: req.path,
                    limit: 'paste-image',
                    retryAfter: retryAfterSeconds,
                },
                'Paste image rate limit exceeded'
            );
            res.setHeader('Retry-After', retryAfterSeconds);
            res.status(429).json({
                error: 'Too many paste requests',
                retryAfter: retryAfterSeconds,
            });
        },
    });
}

/**
 * Create health check rate limiter
 *
 * @returns {Function} Health check rate limiter middleware
 */
function createHealthCheckLimiter() {
    // FIX SEC-009: Dedicated rate limiter for health check endpoints
    // Higher limit than API endpoints but prevents DoS abuse
    // Allows legitimate monitoring probes (Kubernetes, monitoring systems)
    // while preventing malicious actors from overwhelming the service
    return rateLimit({
        windowMs: 60000, // 1 minute
        max: 200, // 200 requests per minute per IP
        message: { error: 'Too many health check requests' },
        standardHeaders: true,
        legacyHeaders: false,
        handler: (req, res) => {
            const retryAfterSeconds = Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000);
            logger.warn(
                {
                    ip: req.ip,
                    path: req.path,
                    limit: 'health-check',
                    retryAfter: retryAfterSeconds,
                },
                'Health check rate limit exceeded'
            );
            res.setHeader('Retry-After', retryAfterSeconds);
            res.status(429).json({
                error: 'Too many health check requests',
                retryAfter: retryAfterSeconds,
            });
        },
    });
}

module.exports = {
    createAPILimiter,
    createNotificationLimiter,
    createDownloadLimiter,
    createCacheClearLimiter,
    createPasteImageLimiter,
    createHealthCheckLimiter,
};
