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
    validateNotificationBody,
    handleValidationErrors,
    // DEPRECATED validators kept for backward compatibility with tests
    validateNotification,
    validateMarkRead,
    validateDelete,
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
        level: config.compressionLevel, // Balanced speed/compression
        threshold: config.compressionThreshold, // Only compress responses > 1KB
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

// SECURITY: Strict CORS policy with origin whitelist validation
// IMPORTANT: Must be BEFORE rate limiters so 429 responses include CORS headers
app.use(corsMiddleware);

// Apply rate limiter to API routes
app.use('/api/', apiLimiter);
app.use('/favicon-api', apiLimiter);

// SECURITY: SSE connection tracking per IP
const sseConnections = new Map(); // IP -> connection count
const MAX_CONNECTIONS_PER_IP = config.sseMaxConnectionsPerIP;
const SSE_GLOBAL_LIMIT = config.sseGlobalLimit;
let globalSSEConnections = 0;

// Cache for generated favicons with LRU eviction and statistics
const faviconCache = new LRUCache(config.cacheMaxSize);

// Initialize FaviconService with dependencies
const faviconService = new FaviconService({
    config,
    registryCache: { getRegistry },
    faviconCache,
});

/**
 * Validate and resolve a folder path from request parameters
 * Centralizes path validation logic to eliminate duplication
 *
 * SECURITY: Always returns generic error messages to clients regardless of environment.
 * Detailed errors are logged server-side only to prevent information disclosure.
 *
 * FIX QUA-004: This is the canonical path validation function used by requireValidPath middleware.
 * express-validator validators (validateFolder, validateNotification, etc.) have been simplified
 * to remove duplicate path validation - they now only validate basic input format.
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} paramName - Parameter name ('folder' for query/body)
 * @returns {Promise<Object>} - { error: boolean, status?: number, message?: string, path?: string }
 */
async function validateAndGetPath(req, res, paramName = 'folder') {
    const folder = req.query[paramName] || req.body[paramName];
    if (!folder) {
        return { error: true, status: 400, message: 'Folder parameter required' };
    }

    const validation = await validatePathAsync(folder);
    if (!validation.valid) {
        // SECURITY: Log detailed error information server-side for debugging
        req.log.error(
            {
                input: folder,
                sanitized: validation.sanitized,
                resolved: validation.resolved,
                error: validation.error,
            },
            'Path validation failed'
        );

        // SECURITY: Always return generic error message to client
        // Never expose path details, validation errors, or file system structure
        return {
            error: true,
            status: 403,
            message: 'Access denied',
        };
    }

    return { error: false, path: validation.resolved };
}

/**
 * Express middleware for path validation
 * Validates folder parameter and attaches results to req object
 * This is the STANDARD validation approach - eliminates duplicate validation
 *
 * FIX QUA-004: This middleware is now the single source of truth for path validation.
 * All endpoints should use this instead of chaining express-validator path checks.
 *
 * SECURITY: Performs comprehensive path validation including:
 * - Directory traversal protection
 * - Symlink attack prevention
 * - URL encoding bypass detection
 * - Allowed path verification
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 * @returns {Promise<void>}
 */
const requireValidPath = async (req, res, next) => {
    const result = await validateAndGetPath(req, res);
    if (result.error) {
        return res.status(result.status).json({ error: result.message });
    }
    req.validatedPath = result.path;
    req.projectName = path.basename(result.path);
    next();
};

// =============================================================================
// FAVICON SERVICE ENDPOINTS
// =============================================================================

/**
 * Shared favicon request handler to eliminate code duplication
 * Handles both /api/favicon and /favicon-api endpoints
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Object} options - Handler options
 * @param {boolean} options.allowMissingFolder - If true, returns default SVG when folder is missing
 */
async function handleFaviconRequest(req, res, options = {}) {
    const { allowMissingFolder = false } = options;

    try {
        // Get folder parameter
        const folder = req.query.folder;
        if (!folder) {
            if (allowMissingFolder) {
                // Return default VS Code favicon for /favicon-api
                const defaultSvg = `<svg width="32" height="32" xmlns="http://www.w3.org/2000/svg">
                <rect width="32" height="32" rx="4" fill="#007ACC"/>
                <text x="16" y="21" text-anchor="middle" fill="white" font-family="Arial" font-size="14" font-weight="bold">VS</text>
            </svg>`;
                res.setHeader('Content-Type', 'image/svg+xml');
                return res.send(defaultSvg);
            }
            // /api/favicon requires folder parameter
            return res.status(400).json({ error: 'folder parameter required' });
        }

        // SECURITY: Validate and resolve folder path
        const pathResult = await validateAndGetPath(req, res);
        if (pathResult.error) {
            return res.status(pathResult.status).json({ error: pathResult.message });
        }
        const validatedPath = pathResult.path;

        // Parse grayscale option
        const grayscale = req.query.grayscale === 'true';

        // Check cache first
        const cacheKey = `favicon_${validatedPath}${grayscale ? '_gray' : ''}`;
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
        const svgFavicon = faviconService.generateSvgFavicon(projectName, projectInfo, {
            grayscale,
        });
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
}

// API endpoint for favicon - requires folder parameter
app.get('/api/favicon', (req, res) => handleFaviconRequest(req, res));

// API endpoint to get project info (async)
app.get('/api/project-info', requireValidPath, async (req, res) => {
    try {
        const { validatedPath, projectName } = req;

        const registry = await getRegistry();
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

    // Check if client IP is in the allowed list
    if (!allowedIPs.includes(clientIP)) {
        req.log.warn({ ip: clientIP, allowedIPs }, 'Unauthorized cache clear attempt');
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

// Alternative favicon API endpoint - allows missing folder (returns default SVG)
// FIX QUA-004: Using requireValidPath for consistent validation
app.get('/favicon-api', requireValidPath, (req, res) =>
    handleFaviconRequest(req, res, { allowMissingFolder: true })
);

// Server-Sent Events (SSE) endpoint for real-time notifications with per-IP connection limits
// FIX QUA-004: Removed duplicate validateFolder+handleValidationErrors, using only requireValidPath
app.get(
    '/notifications/stream',
    notificationLimiter,
    requireValidPath,
    async (req, res) => {
        const { validatedPath } = req;

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

        // FIX QUA-014: Declare variables for resources that need cleanup
        let keepaliveInterval = null;
        let unsubscribe = null;

        // FIX QUA-014: Register cleanup handler FIRST, before incrementing counts
        // This ensures cleanup always runs if counts are incremented, preventing connection leaks
        const cleanup = () => {
            if (keepaliveInterval) {
                clearInterval(keepaliveInterval);
            }
            if (unsubscribe) {
                unsubscribe();
            }

            // Decrement global connection count with edge case handling
            globalSSEConnections = Math.max(0, globalSSEConnections - 1);

            // Decrement per-IP connection count with proper edge case handling
            const connections = sseConnections.get(clientIP) || 0;
            if (connections <= 1) {
                sseConnections.delete(clientIP);
            } else {
                sseConnections.set(clientIP, connections - 1);
            }

            req.log.info(
                { folder: validatedPath, ip: clientIP, remainingConnections: Math.max(0, connections - 1) },
                'SSE client disconnected'
            );
        };

        // Register close handler BEFORE incrementing counts
        req.on('close', cleanup);

        // FIX QUA-014: NOW increment connection counts after cleanup handler is registered
        // This guarantees that if increment happens, cleanup will eventually run
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

        // Subscribe to notification events (assign to variable for cleanup)
        unsubscribe = notificationStore.subscribe((event) => {
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

        // Send keepalive every 30 seconds (assign to variable for cleanup)
        keepaliveInterval = setInterval(() => {
            res.write(':keepalive\n\n');
        }, config.sseKeepaliveInterval);
    }
);

// Claude completion notification endpoints with comprehensive validation
// FIX QUA-004: Removed duplicate validateNotification, using validateNotificationBody + requireValidPath
app.post(
    '/claude-completion',
    notificationLimiter,
    validateNotificationBody,
    handleValidationErrors,
    requireValidPath,
    async (req, res) => {
        const { message = 'Task completed' } = req.body;
        const { validatedPath } = req;

        notificationStore.setCompleted(validatedPath, message);

        req.log.info({ folder: validatedPath, message }, 'Claude completion notification stored');
        res.json({ status: 'ok', folder: validatedPath, message, state: 'completed' });
    }
);

// Claude started working notification (YELLOW badge)
// FIX QUA-004: Removed duplicate validateNotification, using validateNotificationBody + requireValidPath
app.post(
    '/claude-started',
    notificationLimiter,
    validateNotificationBody,
    handleValidationErrors,
    requireValidPath,
    async (req, res) => {
        const { message = 'Working...' } = req.body;
        const { validatedPath } = req;

        notificationStore.setWorking(validatedPath, message);

        req.log.info({ folder: validatedPath, message }, 'Claude started notification stored');
        res.json({ status: 'ok', folder: validatedPath, message, state: 'working' });
    }
);

// Get ALL unread notifications (for extension floating panel)
// PERF-006: Optimized to use efficient getUnread() method from notification-store
app.get('/api/notifications/unread', notificationLimiter, async (req, res) => {
    try {
        // Use efficient getUnread() method - handles filtering, TTL check, and sorting
        const unreadNotifications = notificationStore.getUnread();

        // Add projectName to each notification
        const notifications = unreadNotifications.map(notification => ({
            ...notification,
            projectName: notification.folder.split('/').pop(),
        }));

        res.json({
            notifications,
            count: notifications.length,
        });
    } catch (error) {
        req.log.error({ err: error }, 'Failed to get unread notifications');
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get completion status for a project with validation
// FIX QUA-004: Removed duplicate validateFolder+handleValidationErrors, using only requireValidPath
app.get(
    '/claude-status',
    notificationLimiter,
    requireValidPath,
    async (req, res) => {
        const { validatedPath } = req;
        const notification = notificationStore.get(validatedPath);

        if (notification && notification.unread) {
            res.json({
                hasNotification: true,
                status: notification.status || 'completed', // 'working' or 'completed'
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
// FIX QUA-004: Removed duplicate validateMarkRead+handleValidationErrors, using only requireValidPath
app.post(
    '/claude-status/mark-read',
    notificationLimiter,
    requireValidPath,
    async (req, res) => {
        const { validatedPath } = req;

        if (notificationStore.markRead(validatedPath)) {
            req.log.info({ folder: validatedPath }, 'Notification marked as read');
        }

        res.json({ status: 'ok' });
    }
);

// Clear notification with validation
// FIX QUA-004: Removed duplicate validateDelete+handleValidationErrors, using only requireValidPath
app.delete(
    '/claude-status',
    notificationLimiter,
    requireValidPath,
    async (req, res) => {
        const { validatedPath } = req;

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
    const extensionPath = path.join(__dirname, '..', 'vscode-favicon-extension-v4.0.zip');
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

        // Calculate total SSE connections without intermediate array (O(1) space)
        let totalSSEConnections = 0;
        for (const count of sseConnections.values()) {
            totalSSEConnections += count;
        }

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
                totalConnections: totalSSEConnections,
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
    }, config.gracefulShutdownTimeout);

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
    try {
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
                        adminIPWhitelist: config.adminIPs,
                        sseConnectionLimit: `${MAX_CONNECTIONS_PER_IP} per IP`,
                    },
                    compression: {
                        enabled: true,
                        level: config.compressionLevel,
                        threshold: `${config.compressionThreshold}B`,
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
    } catch (err) {
        logger.fatal({ err }, 'Server initialization failed');
        process.exit(1);
    }
})();
