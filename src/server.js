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
    setupMetrics,
    setupCompression,
    setupHelmet,
    setupBodyParser,
    setupCORS,
    createCSRFProtection,
    createAPILimiter,
    createNotificationLimiter,
    createDownloadLimiter,
    createCacheClearLimiter,
    createPasteImageLimiter,
    createAdminAuth,
} = require('../lib/middleware/setup');

// Import route modules
const { createFaviconRoutes, requireValidPath } = require('../lib/routes/favicon-routes');
const { createNotificationRoutes, getSSEStats } = require('../lib/routes/notification-routes');
const { createHealthRoutes } = require('../lib/routes/health-routes');
const { createAdminRoutes } = require('../lib/routes/admin-routes');
const { createPasteRoutes } = require('../lib/routes/paste-routes');
const { createUploadRoutes } = require('../lib/routes/upload-routes');
const { createMetricsRoutes } = require('../lib/routes/metrics-routes');

// Import upload storage for centralized file storage
const uploadStorage = require('../lib/services/upload-storage');

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

// Metrics tracking middleware (must be after logging, before routes)
app.use(setupMetrics());

// COMPRESSION: Gzip compression for responses > 1KB (70-90% reduction)
app.use(setupCompression());

// SECURITY: Helmet security headers
app.use(setupHelmet());

// SECURITY: Limit JSON body size to 10KB to prevent DoS attacks
app.use(setupBodyParser(express));

// SECURITY: Strict CORS policy with origin whitelist validation
// IMPORTANT: Must be BEFORE rate limiters so 429 responses include CORS headers
app.use(setupCORS());

// SECURITY FIX SEC-007: CSRF protection via custom header requirement
// Must be applied after CORS but before routes
app.use(createCSRFProtection());

// =============================================================================
// RATE LIMITERS
// =============================================================================

const apiLimiter = createAPILimiter();
const notificationLimiter = createNotificationLimiter();
const downloadLimiter = createDownloadLimiter();
const cacheClearLimiter = createCacheClearLimiter();
const pasteImageLimiter = createPasteImageLimiter();
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

// Mount paste routes (uses centralized storage, no path validation needed)
const pasteRoutes = createPasteRoutes(pasteImageLimiter);
app.use(pasteRoutes);

// Mount upload routes (serves files from centralized storage)
const uploadRoutes = createUploadRoutes(downloadLimiter);
app.use(uploadRoutes);

// Mount admin routes
const adminRoutes = createAdminRoutes(faviconCache, cacheClearLimiter, adminAuth, downloadLimiter);
app.use(adminRoutes);

// Mount health check routes
const healthRoutes = createHealthRoutes(faviconCache, faviconService, getSSEStats);
app.use(healthRoutes);

// Mount metrics routes (Prometheus exposition endpoint)
const metricsRoutes = createMetricsRoutes();
app.use(metricsRoutes);

// =============================================================================
// STATIC SCRIPTS (Claude hooks setup)
// =============================================================================

const path = require('path');

// Serve setup script for Claude Code hooks
app.get('/scripts/setup-claude-hooks.sh', downloadLimiter, (req, res) => {
    const scriptPath = path.join(__dirname, '..', 'scripts', 'setup-claude-hooks.sh');
    res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="setup-claude-hooks.sh"');
    res.sendFile(scriptPath);
});

// =============================================================================
// SERVER LIFECYCLE
// =============================================================================

// Server instance and cleanup intervals for graceful shutdown
let server;
let cleanupInterval;
let uploadCleanupInterval;

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

        // Start upload storage cleanup (hourly)
        uploadCleanupInterval = uploadStorage.startCleanupInterval();

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
                        pasteImage: 'POST /api/paste-image (multipart/form-data)',
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
                        pasteImageRateLimit: '10 req/min per IP',
                        downloadRateLimit: '5 req/hour per IP',
                        pathValidation: 'enabled',
                        jsonBodyLimit: '10KB',
                        helmet: 'CSP, HSTS, X-Frame-Options, X-Content-Type-Options',
                        csrfProtection: 'X-Requested-With header required for POST/DELETE/PUT/PATCH',
                        adminIPWhitelist: config.adminIPs,
                        adminApiKeyHash: config.adminApiKeyHash ? 'configured' : 'not configured',
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

        // Register shutdown handlers (pass both cleanup intervals)
        registerShutdownHandlers(server, cleanupInterval, uploadCleanupInterval);
    } catch (err) {
        logger.fatal({ err }, 'Server initialization failed');
        process.exit(1);
    }
})();
