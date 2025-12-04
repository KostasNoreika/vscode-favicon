#!/usr/bin/env node

/**
 * VS Code Favicon Middleware
 * Integrates with existing VS Code Server to serve project-specific favicons
 *
 * This creates a small Express server that:
 * 1. Serves favicon API on a subdomain (favicon-api.vs.noreika.lt)
 * 2. OR can be integrated into VS Code Server itself via middleware
 */

const express = require('express');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { validatePathAsync } = require('../lib/path-validator');
const { corsMiddleware } = require('../lib/cors-config');
const config = require('../lib/config');
const {
    validateFolder,
    validateNotification,
    validateMarkRead,
    validateDelete,
    handleValidationErrors,
} = require('../lib/validators');
const logger = require('../lib/logger');
const { requestLogger } = require('../lib/logger');
const notificationStore = require('../lib/notification-store');
const { getRegistry, getCacheStats: getRegistryCacheStats } = require('../lib/registry-cache');
const { getFullHealth, getLivenessProbe, getReadinessProbe } = require('../lib/health-check');

const app = express();
const PORT = config.apiPort;

// Request logging middleware (must be before routes)
app.use(requestLogger('api'));

// COMPRESSION: Gzip compression for responses > 1KB (70-90% reduction)
app.use(
    compression({
        level: 6, // Balanced speed/compression
        threshold: 1024, // Only compress responses > 1KB
        filter: (req, res) => {
            if (req.headers['x-no-compression']) {
                return false;
            }
            return compression.filter(req, res);
        },
    })
);

// SECURITY: Helmet security headers
app.use(
    helmet({
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
        hsts: {
            maxAge: 31536000, // 1 year
            includeSubDomains: true,
            preload: true,
        },
        frameguard: { action: 'deny' },
        noSniff: true,
        xssFilter: true,
    })
);

// SECURITY: Limit JSON body size to 10KB to prevent DoS attacks
app.use(express.json({ limit: '10kb' }));

// SECURITY: Rate limiting configuration from centralized config
const apiLimiter = rateLimit({
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

// SECURITY: Stricter rate limit for notification endpoints from centralized config
const notificationLimiter = rateLimit({
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

// Apply general rate limiter to favicon API
app.use('/favicon-api', apiLimiter);

// SECURITY: Strict CORS policy with origin whitelist validation
app.use(corsMiddleware);

// SECURITY: SSE connection tracking per IP
const sseConnections = new Map(); // IP -> connection count
const MAX_CONNECTIONS_PER_IP = 5;

// Generate SVG favicon (async)
async function generateFavicon(projectPath) {
    const registry = await getRegistry();
    const projectInfo = registry.projects[projectPath] || {};
    const projectName = path.basename(projectPath);
    const displayName = projectInfo.name || projectName;
    const type = projectInfo.type || 'dev';
    const port = projectInfo.port;

    // Generate initials
    const initials =
        displayName
            .split(/[-_\s]+/)
            .map((word) => word[0])
            .join('')
            .toUpperCase()
            .slice(0, 2) || 'VS';

    // Use type colors from config
    const bgColor = config.typeColors[type] || config.defaultColors[0];

    // Port text for dev projects
    const portText =
        type === 'dev' && port
            ? `<text x="16" y="30" text-anchor="middle" fill="white" font-family="monospace" font-size="6" opacity="0.7">${port}</text>`
            : '';

    return `<svg width="32" height="32" xmlns="http://www.w3.org/2000/svg">
        <rect width="32" height="32" rx="4" fill="${bgColor}"/>
        <text x="16" y="21" text-anchor="middle" fill="white" font-family="Arial" font-size="14" font-weight="bold">
            ${initials}
        </text>
        ${portText}
    </svg>`;
}

// Main API endpoint with comprehensive input validation (async)
app.get('/favicon-api', validateFolder, handleValidationErrors, async (req, res) => {
    try {
        const folder = req.query.folder;

        if (!folder) {
            // Return default VS Code favicon
            const defaultSvg = `<svg width="32" height="32" xmlns="http://www.w3.org/2000/svg">
                <rect width="32" height="32" rx="4" fill="#007ACC"/>
                <text x="16" y="21" text-anchor="middle" fill="white" font-family="Arial" font-size="14" font-weight="bold">VS</text>
            </svg>`;
            res.setHeader('Content-Type', 'image/svg+xml');
            return res.send(defaultSvg);
        }

        // SECURITY: Use shared validator to prevent path traversal
        // Note: express-validator already validated the folder param above
        const validation = await validatePathAsync(folder);
        if (!validation.valid) {
            req.log.error(
                {
                    input: folder,
                    sanitized: validation.sanitized,
                    resolved: validation.resolved,
                    error: validation.error,
                },
                'Path validation failed'
            );

            // SECURITY: Sanitize error messages in production
            const errorResponse = {
                error: 'Access denied',
            };
            if (config.nodeEnv !== 'production') {
                errorResponse.details = validation.error;
            }

            return res.status(403).json(errorResponse);
        }

        // Use validated path
        const validatedPath = validation.resolved;

        // Generate and return favicon (async)
        const svg = await generateFavicon(validatedPath);
        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('Cache-Control', `public, max-age=${config.cacheTtl}`);
        res.send(svg);
    } catch (error) {
        req.log.error({ err: error }, 'Favicon API request failed');
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Health check endpoints (excluded from rate limiting via skip function)

// Main health endpoint with detailed status
app.get('/health', async (req, res) => {
    try {
        // Get cache and notification statistics
        const registryStats = getRegistryCacheStats();
        const notificationStats = notificationStore.getStats();

        // Get full health status
        const health = await getFullHealth('vscode-favicon-api', {
            registryCache: {
                status: 'ok',
                ...registryStats,
            },
            notifications: {
                status: 'ok',
                ...notificationStats,
            },
            sseConnections: {
                status: 'ok',
                totalIPs: sseConnections.size,
                totalConnections: Array.from(sseConnections.values()).reduce((a, b) => a + b, 0),
                maxPerIP: MAX_CONNECTIONS_PER_IP,
            },
        });

        // Return 503 if service is degraded
        const statusCode = health.status === 'ok' ? 200 : 503;
        res.status(statusCode).json(health);
    } catch (error) {
        logger.error({ err: error }, 'Health check failed');
        res.status(503).json({
            status: 'error',
            service: 'vscode-favicon-api',
            error: error.message,
            timestamp: new Date().toISOString(),
        });
    }
});

// Kubernetes liveness probe - is the service alive?
app.get('/health/live', (req, res) => {
    const liveness = getLivenessProbe();
    res.json(liveness);
});

// Kubernetes readiness probe - is the service ready to accept traffic?
app.get('/health/ready', async (req, res) => {
    try {
        const readiness = await getReadinessProbe();

        if (readiness.status === 'ready') {
            res.json(readiness);
        } else {
            res.status(503).json(readiness);
        }
    } catch (error) {
        logger.error({ err: error }, 'Readiness probe failed');
        res.status(503).json({
            status: 'not_ready',
            timestamp: new Date().toISOString(),
            error: error.message,
        });
    }
});

// Server-Sent Events (SSE) endpoint for real-time notifications with per-IP connection limits
app.get(
    '/notifications/stream',
    notificationLimiter,
    validateFolder,
    handleValidationErrors,
    async (req, res) => {
        const folder = req.query.folder;

        // SECURITY: Validate folder path
        const validation = await validatePathAsync(folder);
        if (!validation.valid) {
            req.log.error(
                {
                    input: folder,
                    sanitized: validation.sanitized,
                    resolved: validation.resolved,
                    error: validation.error,
                },
                'Path validation failed'
            );

            // SECURITY: Sanitize error messages in production
            const errorResponse = {
                error: 'Access denied',
            };
            if (config.nodeEnv !== 'production') {
                errorResponse.details = validation.error;
            }

            return res.status(403).json(errorResponse);
        }

        const validatedPath = validation.resolved;

        // SECURITY: Check SSE connection limit per IP
        const clientIP = req.ip || req.connection.remoteAddress;
        const currentConnections = sseConnections.get(clientIP) || 0;

        if (currentConnections >= MAX_CONNECTIONS_PER_IP) {
            req.log.warn(
                { ip: clientIP, connections: currentConnections },
                'SSE connection limit exceeded'
            );
            return res.status(429).json({
                error: 'Too many concurrent connections',
                limit: MAX_CONNECTIONS_PER_IP,
            });
        }

        // Increment connection count
        sseConnections.set(clientIP, currentConnections + 1);

        // Set SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

        // Send initial connection event
        res.write('event: connected\n');
        res.write(`data: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);

        // Send current notification state immediately
        const currentNotification = notificationStore.get(validatedPath);
        if (currentNotification && currentNotification.unread) {
            res.write('event: notification\n');
            res.write(
                `data: ${JSON.stringify({
                    hasNotification: true,
                    timestamp: currentNotification.timestamp,
                    message: currentNotification.message,
                })}\n\n`
            );
        } else {
            res.write('event: notification\n');
            res.write(`data: ${JSON.stringify({ hasNotification: false })}\n\n`);
        }

        req.log.info(
            { folder: validatedPath, ip: clientIP, connections: currentConnections + 1 },
            'SSE client connected'
        );

        // Subscribe to notification events
        const unsubscribe = notificationStore.subscribe((event) => {
            // Only send events relevant to this folder
            if (event.folder === validatedPath) {
                const payload = {
                    hasNotification: event.type === 'created',
                    type: event.type,
                };

                if (event.notification) {
                    payload.timestamp = event.notification.timestamp;
                    payload.message = event.notification.message;
                }

                res.write('event: notification\n');
                res.write(`data: ${JSON.stringify(payload)}\n\n`);

                req.log.debug(
                    { folder: validatedPath, event: event.type },
                    'SSE notification sent'
                );
            }
        });

        // Send keepalive every 30 seconds
        const keepaliveInterval = setInterval(() => {
            res.write(':keepalive\n\n');
        }, 30000);

        // Cleanup on client disconnect
        req.on('close', () => {
            clearInterval(keepaliveInterval);
            unsubscribe();

            // Decrement connection count
            const connections = sseConnections.get(clientIP) || 1;
            if (connections <= 1) {
                sseConnections.delete(clientIP);
            } else {
                sseConnections.set(clientIP, connections - 1);
            }

            req.log.info(
                { folder: validatedPath, ip: clientIP, remainingConnections: connections - 1 },
                'SSE client disconnected'
            );
        });
    }
);

// Claude completion notification endpoints with comprehensive validation
app.post(
    '/claude-completion',
    notificationLimiter,
    validateNotification,
    handleValidationErrors,
    async (req, res) => {
        const { folder, message = 'Task completed', timestamp = Date.now() } = req.body;

        // SECURITY: Validate folder path
        const validation = await validatePathAsync(folder);
        if (!validation.valid) {
            req.log.error(
                {
                    input: folder,
                    sanitized: validation.sanitized,
                    resolved: validation.resolved,
                    error: validation.error,
                },
                'Path validation failed'
            );

            // SECURITY: Sanitize error messages in production
            const errorResponse = {
                error: 'Access denied',
            };
            if (config.nodeEnv !== 'production') {
                errorResponse.details = validation.error;
            }

            return res.status(403).json(errorResponse);
        }

        // Store notification with validated path
        const validatedPath = validation.resolved;
        notificationStore.set(validatedPath, {
            timestamp,
            message,
            unread: true,
        });

        req.log.info({ folder: validatedPath, message }, 'Claude completion notification stored');
        res.json({ status: 'ok', folder: validatedPath, message });
    }
);

// Get completion status for a project with validation
app.get(
    '/claude-status',
    notificationLimiter,
    validateFolder,
    handleValidationErrors,
    async (req, res) => {
        const folder = req.query.folder;

        // SECURITY: Validate folder path
        const validation = await validatePathAsync(folder);
        if (!validation.valid) {
            req.log.error(
                {
                    input: folder,
                    sanitized: validation.sanitized,
                    resolved: validation.resolved,
                    error: validation.error,
                },
                'Path validation failed'
            );

            // SECURITY: Sanitize error messages in production
            const errorResponse = {
                error: 'Access denied',
            };
            if (config.nodeEnv !== 'production') {
                errorResponse.details = validation.error;
            }

            return res.status(403).json(errorResponse);
        }

        const validatedPath = validation.resolved;
        const notification = notificationStore.get(validatedPath);

        if (notification && notification.unread) {
            res.json({
                hasNotification: true,
                timestamp: notification.timestamp,
                message: notification.message,
            });
        } else {
            res.json({
                hasNotification: false,
            });
        }
    }
);

// Mark notification as read with validation
app.post(
    '/claude-status/mark-read',
    notificationLimiter,
    validateMarkRead,
    handleValidationErrors,
    async (req, res) => {
        const { folder } = req.body;

        // SECURITY: Validate folder path
        const validation = await validatePathAsync(folder);
        if (!validation.valid) {
            req.log.error(
                {
                    input: folder,
                    sanitized: validation.sanitized,
                    resolved: validation.resolved,
                    error: validation.error,
                },
                'Path validation failed'
            );

            // SECURITY: Sanitize error messages in production
            const errorResponse = {
                error: 'Access denied',
            };
            if (config.nodeEnv !== 'production') {
                errorResponse.details = validation.error;
            }

            return res.status(403).json(errorResponse);
        }

        const validatedPath = validation.resolved;

        if (notificationStore.markRead(validatedPath)) {
            req.log.info({ folder: validatedPath }, 'Notification marked as read');
        }

        res.json({ status: 'ok' });
    }
);

// Clear notification with validation
app.delete(
    '/claude-status',
    notificationLimiter,
    validateDelete,
    handleValidationErrors,
    async (req, res) => {
        const { folder } = req.body;

        // SECURITY: Validate folder path
        const validation = await validatePathAsync(folder);
        if (!validation.valid) {
            req.log.error(
                {
                    input: folder,
                    sanitized: validation.sanitized,
                    resolved: validation.resolved,
                    error: validation.error,
                },
                'Path validation failed'
            );

            // SECURITY: Sanitize error messages in production
            const errorResponse = {
                error: 'Access denied',
            };
            if (config.nodeEnv !== 'production') {
                errorResponse.details = validation.error;
            }

            return res.status(403).json(errorResponse);
        }

        const validatedPath = validation.resolved;

        if (notificationStore.remove(validatedPath)) {
            req.log.info({ folder: validatedPath }, 'Notification cleared');
        }
        res.json({ status: 'ok' });
    }
);

// Server instance and cleanup interval for graceful shutdown
let server;
let cleanupInterval;

/**
 * Graceful Shutdown Handler
 * Handles SIGTERM and SIGINT signals for PM2 compatibility
 */
async function gracefulShutdown(signal) {
    logger.info({ signal }, 'Shutdown signal received, starting graceful shutdown');

    // Stop accepting new connections
    if (server) {
        server.close(() => {
            logger.info('HTTP server closed');
        });
    }

    // Stop cleanup interval
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        logger.info('Notification cleanup interval stopped');
    }

    // Save pending notifications immediately
    try {
        await notificationStore.saveImmediate();
        logger.info('Notifications saved');
    } catch (err) {
        logger.error({ err }, 'Error saving notifications');
    }

    // Close registry watcher
    try {
        const { closeWatcher } = require('../lib/registry-cache');
        closeWatcher();
        logger.info('Registry watcher closed');
    } catch (err) {
        logger.error({ err }, 'Error closing registry watcher');
    }

    // Force exit after timeout (10 seconds)
    const forceExitTimeout = setTimeout(() => {
        logger.warn('Forcefully shutting down after timeout');
        process.exit(1);
    }, 10000);

    // Allow cleanup to complete, then exit gracefully
    setTimeout(() => {
        clearTimeout(forceExitTimeout);
        logger.info('Graceful shutdown complete');
        process.exit(0);
    }, 1000);
}

// Register signal handlers for graceful shutdown
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error({ reason, promise }, 'Unhandled rejection');
});

// Initialize notification persistence on startup
(async () => {
    // Load notifications from disk
    await notificationStore.load();

    // Start periodic cleanup (hourly)
    cleanupInterval = notificationStore.startCleanupInterval();

    server = app.listen(PORT, () => {
        const notifStats = notificationStore.getStats();
        logger.info(
            {
                port: PORT,
                environment: config.nodeEnv,
                endpoints: {
                    faviconApi: '/favicon-api?folder=/path/to/project',
                    notificationsStream: '/notifications/stream?folder=/path/to/project (SSE)',
                    claudeCompletion: '/claude-completion',
                    claudeStatus: '/claude-status',
                    health: '/health',
                    healthLiveness: '/health/live',
                    healthReadiness: '/health/ready',
                },
                security: {
                    apiRateLimit: `${config.rateLimitMax} req/${config.rateLimitWindow}ms`,
                    notificationRateLimit: `${config.rateLimitNotificationMax} req/${config.rateLimitNotificationWindow}ms`,
                    jsonBodyLimit: '10KB',
                    inputValidation: 'express-validator',
                    pathTraversal: 'enabled',
                    helmet: 'CSP, HSTS, X-Frame-Options, X-Content-Type-Options',
                    sseConnectionLimit: `${MAX_CONNECTIONS_PER_IP} per IP`,
                },
                compression: {
                    enabled: true,
                    level: 6,
                    threshold: '1KB',
                    expectedReduction: '70-90%',
                },
                notifications: {
                    storage: `${config.dataDir}/notifications.json`,
                    maxCount: notifStats.maxCount,
                    ttlHours: notifStats.ttl / 1000 / 60 / 60,
                    loaded: notifStats.total,
                },
                cloudflare: `favicon-api.vs.noreika.lt -> localhost:${PORT}`,
            },
            'VS Code Favicon API started'
        );
    });

    // Handle port already in use
    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            logger.fatal({ port: PORT, err }, 'Port already in use');
            process.exit(1);
        }
        throw err;
    });
})();
