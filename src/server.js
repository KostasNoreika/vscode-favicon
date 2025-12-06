#!/usr/bin/env node

/**
 * VS Code Favicon Unified Service
 * Consolidated service combining favicon generation and notification API
 *
 * Endpoints:
 * - Favicon Service (port 8090):
 *   - GET /api/favicon - Generate/serve project favicons
 *   - GET /api/project-info - Get project metadata
 *   - POST /api/clear-cache - Clear favicon cache (admin only)
 *
 * - Notification API:
 *   - GET /favicon-api - Alternative favicon endpoint
 *   - POST /claude-completion - Create notification
 *   - GET /claude-status - Get notification status
 *   - POST /claude-status/mark-read - Mark notification as read
 *   - DELETE /claude-status - Delete notification
 *   - GET /notifications/stream - SSE stream for real-time notifications
 *
 * - Health Checks:
 *   - GET /health - Detailed health status
 *   - GET /health/live - Liveness probe
 *   - GET /health/ready - Readiness probe
 */

const express = require('express');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const { corsMiddleware } = require('../lib/cors-config');
const { validateAndExtractPath, ValidationError } = require('../lib/validation-middleware');
const { validatePathAsync } = require('../lib/path-validator');
const config = require('../lib/config');
const LRUCache = require('../lib/lru-cache');
const logger = require('../lib/logger');
const { requestLogger } = require('../lib/logger');
const {
    getRegistry,
    getCacheStats: getRegistryCacheStats,
    invalidateCache,
} = require('../lib/registry-cache');
const { getFullHealth, getLivenessProbe, getReadinessProbe } = require('../lib/health-check');
const {
    validateFolder,
    validateNotification,
    validateMarkRead,
    validateDelete,
    handleValidationErrors,
} = require('../lib/validators');
const notificationStore = require('../lib/notification-store');
const FaviconService = require('../lib/services/favicon-service');

const app = express();
const PORT = config.servicePort; // Use port 8090

// SECURITY: Trust first proxy (Cloudflare) for correct client IP
app.set('trust proxy', 1);

// Request logging middleware (must be before routes)
app.use(requestLogger('unified'));

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
        crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow favicons to be loaded from vs.noreika.lt
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

// Apply rate limiter to API routes
app.use('/api/', apiLimiter);
app.use('/favicon-api', apiLimiter);

// SECURITY: Strict CORS policy with origin whitelist validation
app.use(corsMiddleware);

// SECURITY: SSE connection tracking per IP
const sseConnections = new Map(); // IP -> connection count
const MAX_CONNECTIONS_PER_IP = 5;
const SSE_GLOBAL_LIMIT = 100; // Maximum total SSE connections
let globalSSEConnections = 0;

// Cache for generated favicons with LRU eviction and statistics
const faviconCache = new LRUCache(config.cacheMaxSize);

// Initialize FaviconService with dependencies
const faviconService = new FaviconService({
    config,
    registryCache: { getRegistry },
    faviconCache,
});

// =============================================================================
// FAVICON SERVICE ENDPOINTS
// =============================================================================

// API endpoint for favicon (async)
app.get('/api/favicon', async (req, res) => {
    try {
        const folder = req.query.folder;

        if (!folder) {
            return res.status(400).json({ error: 'Folder parameter required' });
        }

        // SECURITY: Use shared validator to prevent path traversal
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
                error: 'Access denied: path outside allowed directories',
            };
            if (config.nodeEnv !== 'production') {
                errorResponse.details = validation.error;
            }

            return res.status(403).json(errorResponse);
        }

        // Use validated path
        const validatedPath = validation.resolved;

        // Check cache first
        const cacheKey = `favicon_${validatedPath}`;
        const cached = faviconCache.get(cacheKey);
        if (cached) {
            res.setHeader('Content-Type', cached.contentType);
            res.setHeader('Cache-Control', `public, max-age=${config.cacheTtl}`);
            return res.send(cached.data);
        }

        // Load registry (async via centralized cache)
        const registry = await getRegistry();
        const projectName = path.basename(validatedPath);
        // Try to find by path first, then by name
        const projectInfo =
            registry.projects?.[validatedPath] || registry.projects?.[projectName] || {};

        // Try to find existing favicon (async)
        const existingFavicon = await faviconService.findFaviconFile(validatedPath);

        if (existingFavicon) {
            const ext = path.extname(existingFavicon).toLowerCase();
            let contentType = 'image/x-icon';

            if (ext === '.png') contentType = 'image/png';
            else if (ext === '.svg') contentType = 'image/svg+xml';

            const data = await fs.promises.readFile(existingFavicon);

            // Cache the favicon
            faviconCache.set(cacheKey, { contentType, data });

            res.setHeader('Content-Type', contentType);
            res.setHeader('Cache-Control', `public, max-age=${config.cacheTtl}`);
            return res.send(data);
        }

        // Generate SVG favicon
        const svgFavicon = faviconService.generateSvgFavicon(projectName, projectInfo);
        const svgBuffer = Buffer.from(svgFavicon);

        // Cache the generated SVG
        faviconCache.set(cacheKey, {
            contentType: 'image/svg+xml',
            data: svgBuffer,
        });

        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('Cache-Control', `public, max-age=${config.cacheTtl}`);
        res.send(svgBuffer);
    } catch (error) {
        req.log.error({ err: error }, 'Favicon request failed');
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API endpoint to get project info (async)
app.get('/api/project-info', async (req, res) => {
    try {
        const folder = req.query.folder;

        if (!folder) {
            return res.status(400).json({ error: 'Folder parameter required' });
        }

        // SECURITY: Use shared validator to prevent path traversal
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
                error: 'Access denied: path outside allowed directories',
            };
            if (config.nodeEnv !== 'production') {
                errorResponse.details = validation.error;
            }

            return res.status(403).json(errorResponse);
        }

        // Use validated path
        const validatedPath = validation.resolved;

        const registry = await getRegistry();
        const projectName = path.basename(validatedPath);
        // Try to find by path first, then by name
        const projectInfo =
            registry.projects?.[validatedPath] || registry.projects?.[projectName] || {};

        res.json({
            name: projectName,
            ...projectInfo,
            hasCustomFavicon: !!(await faviconService.findFaviconFile(validatedPath)),
        });
    } catch (error) {
        req.log.error({ err: error }, 'Project info request failed');
        res.status(500).json({ error: 'Internal server error' });
    }
});

// SECURITY: Strict rate limit for cache clear endpoint (1 req/min)
const cacheClearLimiter = rateLimit({
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

// SECURITY: Admin authentication middleware for cache clear endpoint
const adminAuth = (req, res, next) => {
    // Get allowed IPs from env or use defaults (localhost + Mac Studio LAN)
    const allowedIPs = (process.env.ADMIN_IPS || '127.0.0.1,::1,192.168.110.199')
        .split(',')
        .map((ip) => ip.trim());
    const clientIP = req.ip || req.connection.remoteAddress;

    if (!allowedIPs.includes(clientIP)) {
        req.log.warn({ ip: clientIP }, 'Unauthorized cache clear attempt');
        return res.status(403).json({ error: 'Forbidden' });
    }

    next();
};

// Clear cache endpoint with rate limit + IP whitelist authentication
app.post('/api/clear-cache', cacheClearLimiter, adminAuth, (req, res) => {
    const faviconSizeBefore = faviconCache.size;
    const statsBeforeClear = getRegistryCacheStats();

    faviconCache.clear();
    invalidateCache();

    res.json({
        success: true,
        message: 'All caches cleared',
        faviconItemsCleared: faviconSizeBefore,
        registryCacheCleared: statsBeforeClear.cached,
    });
});

// =============================================================================
// NOTIFICATION API ENDPOINTS
// =============================================================================

// Alternative favicon API endpoint (async)
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

            const errorResponse = {
                error: 'Access denied',
            };
            if (config.nodeEnv !== 'production') {
                errorResponse.details = validation.error;
            }

            return res.status(403).json(errorResponse);
        }

        const validatedPath = validation.resolved;

        // Check cache first
        const cacheKey = `favicon_${validatedPath}`;
        const cached = faviconCache.get(cacheKey);
        if (cached) {
            res.setHeader('Content-Type', cached.contentType);
            res.setHeader('Cache-Control', `public, max-age=${config.cacheTtl}`);
            return res.send(cached.data);
        }

        // Load registry and project info
        const registry = await getRegistry();
        const projectName = path.basename(validatedPath);
        const projectInfo =
            registry.projects?.[validatedPath] || registry.projects?.[projectName] || {};

        // Try to find existing favicon first (same as /api/favicon)
        const existingFavicon = await faviconService.findFaviconFile(validatedPath);

        if (existingFavicon) {
            const ext = path.extname(existingFavicon).toLowerCase();
            let contentType = 'image/x-icon';

            if (ext === '.png') contentType = 'image/png';
            else if (ext === '.svg') contentType = 'image/svg+xml';

            const data = await fs.promises.readFile(existingFavicon);

            // Cache the favicon
            faviconCache.set(cacheKey, { contentType, data });

            res.setHeader('Content-Type', contentType);
            res.setHeader('Cache-Control', `public, max-age=${config.cacheTtl}`);
            return res.send(data);
        }

        // No custom favicon found - generate SVG
        const svg = faviconService.generateSvgFavicon(projectName, projectInfo);
        const svgBuffer = Buffer.from(svg);

        // Cache the generated SVG
        faviconCache.set(cacheKey, {
            contentType: 'image/svg+xml',
            data: svgBuffer,
        });

        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('Cache-Control', `public, max-age=${config.cacheTtl}`);
        res.send(svgBuffer);
    } catch (error) {
        req.log.error({ err: error }, 'Favicon API request failed');
        res.status(500).json({ error: 'Internal server error' });
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

            const errorResponse = {
                error: 'Access denied',
            };
            if (config.nodeEnv !== 'production') {
                errorResponse.details = validation.error;
            }

            return res.status(403).json(errorResponse);
        }

        const validatedPath = validation.resolved;

        // SECURITY: Check global SSE connection limit
        if (globalSSEConnections >= SSE_GLOBAL_LIMIT) {
            req.log.warn(
                { globalConnections: globalSSEConnections },
                'Global SSE connection limit exceeded'
            );
            return res.status(503).json({
                error: 'Service at capacity',
                limit: SSE_GLOBAL_LIMIT,
            });
        }

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

        // Increment connection counts
        globalSSEConnections++;
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
            globalSSEConnections--;

            // Decrement per-IP connection count
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

// =============================================================================
// STATIC DOWNLOADS
// =============================================================================

// Download Chrome extension ZIP
app.get('/download/extension', (req, res) => {
    const extensionPath = path.join(__dirname, '..', 'vscode-favicon-extension-v2.zip');
    res.download(extensionPath, 'vscode-favicon-extension.zip', (err) => {
        if (err) {
            req.log.error({ err }, 'Extension download failed');
            res.status(404).json({ error: 'Extension file not found' });
        }
    });
});

// =============================================================================
// HEALTH CHECK ENDPOINTS
// =============================================================================

// Main health endpoint with detailed status
app.get('/health', async (req, res) => {
    try {
        // Get cache statistics
        const faviconStats = faviconCache
            ? faviconCache.getStats()
            : { status: 'error', error: 'Cache not initialized' };
        const registryStats = getRegistryCacheStats();
        const notificationStats = notificationStore.getStats();

        // Get full health status
        const health = await getFullHealth('vscode-favicon-unified', {
            faviconCache: {
                status: 'ok',
                ...faviconStats,
            },
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
            service: 'vscode-favicon-unified',
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

// =============================================================================
// SERVER LIFECYCLE
// =============================================================================

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

// Initialize and start server
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
                    faviconService: '/api/favicon?folder=/path/to/project',
                    faviconApi: '/favicon-api?folder=/path/to/project',
                    projectInfo: '/api/project-info?folder=/path/to/project',
                    clearCache: '/api/clear-cache (admin only)',
                    notificationsStream: '/notifications/stream?folder=/path/to/project (SSE)',
                    claudeCompletion: 'POST /claude-completion',
                    claudeStatus: 'GET /claude-status',
                    health: '/health',
                    healthLiveness: '/health/live',
                    healthReadiness: '/health/ready',
                },
                security: {
                    apiRateLimit: `${config.rateLimitMax} req/${config.rateLimitWindow}ms per IP`,
                    notificationRateLimit: `${config.rateLimitNotificationMax} req/${config.rateLimitNotificationWindow}ms`,
                    pathValidation: 'enabled',
                    jsonBodyLimit: '10KB',
                    helmet: 'CSP, HSTS, X-Frame-Options, X-Content-Type-Options',
                    adminIPWhitelist: ['127.0.0.1', '::1', '192.168.110.199'],
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
            },
            'VS Code Favicon Unified Service started'
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
