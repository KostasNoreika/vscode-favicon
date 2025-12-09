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
const config = require('../lib/config');
const LRUCache = require('../lib/lru-cache');
const logger = require('../lib/logger');
const { warmCache } = require('../lib/registry-cache');
const notificationStore = require('../lib/notification-store');
const FaviconService = require('../lib/services/favicon-service');
const { getRegistry } = require('../lib/registry-cache');

// Import middleware setup
const {
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
} = require('../lib/middleware/setup');

// Import route modules
const { createFaviconRoutes, requireValidPath } = require('../lib/routes/favicon-routes');
const { createNotificationRoutes, getSSEStats } = require('../lib/routes/notification-routes');
const { createHealthRoutes } = require('../lib/routes/health-routes');
const { createAdminRoutes } = require('../lib/routes/admin-routes');

// Import lifecycle management
const { registerShutdownHandlers } = require('../lib/lifecycle/shutdown');

const app = express();
const PORT = config.servicePort; // Use port 8090

// =============================================================================
// MIDDLEWARE SETUP
// =============================================================================

// SECURITY: Trust proxy configuration for accurate client IP detection
setupTrustProxy(app);

// Request logging middleware (must be before routes)
app.use(setupRequestLogging());

// COMPRESSION: Gzip compression for responses > 1KB (70-90% reduction)
app.use(setupCompression());

// SECURITY: Helmet security headers
app.use(setupHelmet());

// SECURITY: Limit JSON body size to 10KB to prevent DoS attacks
app.use(setupBodyParser(express));

// SECURITY: Strict CORS policy with origin whitelist validation
// IMPORTANT: Must be BEFORE rate limiters so 429 responses include CORS headers
app.use(setupCORS());

// =============================================================================
// RATE LIMITERS
// =============================================================================

const apiLimiter = createAPILimiter();
const notificationLimiter = createNotificationLimiter();
const downloadLimiter = createDownloadLimiter();
const cacheClearLimiter = createCacheClearLimiter();
const adminAuth = createAdminAuth();

// Apply rate limiter to API routes
app.use('/api/', apiLimiter);
app.use('/favicon-api', apiLimiter);

// =============================================================================
// SERVICE INITIALIZATION
// =============================================================================

// Cache for generated favicons with LRU eviction and statistics
const faviconCache = new LRUCache(config.cacheMaxSize);

// FIX QUA-022: Initialize FaviconService with explicit dependencies
const faviconService = new FaviconService({
    registryCache: { getRegistry },
    faviconCache,
    typeColors: config.typeColors,
    defaultColors: config.defaultColors,
});

// =============================================================================
// ROUTE MOUNTING
// =============================================================================

// Mount favicon routes
const faviconRoutes = createFaviconRoutes(faviconCache, faviconService);
app.use(faviconRoutes);

// Mount notification routes
const notificationRoutes = createNotificationRoutes(requireValidPath, notificationLimiter);
app.use(notificationRoutes);

// Mount admin routes
const adminRoutes = createAdminRoutes(faviconCache, cacheClearLimiter, adminAuth, downloadLimiter);
app.use(adminRoutes);

// Mount health check routes
const healthRoutes = createHealthRoutes(faviconCache, faviconService, getSSEStats);
app.use(healthRoutes);

// =============================================================================
// SERVER LIFECYCLE
// =============================================================================

// Server instance and cleanup interval for graceful shutdown
let server;
let cleanupInterval;

// Initialize and start server
(async () => {
    try {
        // FIX QUA-028: Warm registry cache before starting server
        try {
            const startTime = Date.now();
            await warmCache();
            const loadTime = Date.now() - startTime;
            logger.info({ loadTimeMs: loadTime }, 'Registry cache pre-warmed');
        } catch (err) {
            // Graceful degradation: log warning but continue startup
            logger.warn({ err }, 'Registry cache warming failed, will load on first request');
        }

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
                        downloadRateLimit: '5 req/hour per IP',
                        pathValidation: 'enabled',
                        jsonBodyLimit: '10KB',
                        helmet: 'CSP, HSTS, X-Frame-Options, X-Content-Type-Options',
                        adminIPWhitelist: config.adminIPs,
                        adminApiKey: config.adminApiKey ? 'configured' : 'not configured',
                        sseConnectionLimit: `${config.sseMaxConnectionsPerIP} per IP`,
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

        // Register shutdown handlers
        registerShutdownHandlers(server, cleanupInterval);
    } catch (err) {
        logger.fatal({ err }, 'Server initialization failed');
        process.exit(1);
    }
})();
