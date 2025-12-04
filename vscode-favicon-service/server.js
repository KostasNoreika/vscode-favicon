#!/usr/bin/env node

const express = require('express');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const { validatePathAsync } = require('../lib/path-validator');
const { corsMiddleware } = require('../lib/cors-config');
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
const { getCleanInitials, sanitizePort } = require('../lib/svg-sanitizer');

const app = express();

// Request logging middleware (must be before routes)
app.use(requestLogger('service'));

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

// Apply rate limiter to all API routes
app.use('/api/', apiLimiter);

// SECURITY: Strict CORS policy with origin whitelist validation
app.use(corsMiddleware);

// Cache for generated favicons with LRU eviction and statistics
const faviconCache = new LRUCache(config.cacheMaxSize);

// Find favicon for a project using configured search paths with limited concurrency and early exit
async function findProjectFavicon(projectPath) {
    // Build all possible paths
    const possiblePaths = [];

    // Add configured exact paths
    for (const faviconPath of config.faviconSearchPaths) {
        possiblePaths.push(path.join(projectPath, faviconPath));
    }

    // Add configured image patterns in configured directories
    for (const pattern of config.faviconImagePatterns) {
        for (const dir of config.faviconImageDirs) {
            possiblePaths.push(path.join(projectPath, dir, pattern));
        }
    }

    // Check paths with limited concurrency (max 5) and early exit on first match
    const CONCURRENCY_LIMIT = 5;
    for (let i = 0; i < possiblePaths.length; i += CONCURRENCY_LIMIT) {
        const batch = possiblePaths.slice(i, i + CONCURRENCY_LIMIT);
        const checks = batch.map(async (fullPath) => {
            try {
                await fs.promises.access(fullPath, fs.constants.R_OK);
                return fullPath;
            } catch {
                return null;
            }
        });

        const results = await Promise.all(checks);
        const found = results.find((r) => r !== null);
        if (found) return found; // Early exit when favicon found!
    }

    return null;
}

// Generate SVG favicon with project info using configured colors
function generateProjectFavicon(projectName, projectInfo) {
    // Use project info from registry
    const displayName = projectInfo.name || projectName;
    const type = projectInfo.type || 'dev';
    const port = projectInfo.port || '0000';

    // SECURITY: Use sanitized initials generation from svg-sanitizer
    const initials = getCleanInitials(displayName);

    // Get color from configured type colors or generate from project name
    let bgColor = config.typeColors[type];
    if (!bgColor) {
        // Use hash-based color selection from configured default colors
        let hash = 0;
        for (let i = 0; i < projectName.length; i++) {
            hash = projectName.charCodeAt(i) + ((hash << 5) - hash);
        }
        bgColor = config.defaultColors[Math.abs(hash) % config.defaultColors.length];
    }

    // SECURITY: Sanitize port value before embedding in SVG
    const sanitizedPort = sanitizePort(port);

    // Add port number to favicon for dev projects
    const portText =
        type === 'dev' && sanitizedPort
            ? `<text x="16" y="30" text-anchor="middle" fill="white" font-family="monospace" font-size="6" opacity="0.8">${sanitizedPort}</text>`
            : '';

    return `<svg width="32" height="32" xmlns="http://www.w3.org/2000/svg">
        <rect width="32" height="32" rx="4" fill="${bgColor}"/>
        <text x="16" y="21" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-size="14" font-weight="bold">
            ${initials}
        </text>
        ${portText}
    </svg>`;
}

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
        const existingFavicon = await findProjectFavicon(validatedPath);

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
        const svgFavicon = generateProjectFavicon(projectName, projectInfo);
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
            hasCustomFavicon: !!(await findProjectFavicon(validatedPath)),
        });
    } catch (error) {
        req.log.error({ err: error }, 'Project info request failed');
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Health check endpoints (excluded from rate limiting via skip function)

// Main health endpoint with detailed status
app.get('/health', async (req, res) => {
    try {
        // Get cache statistics
        const faviconStats = faviconCache
            ? faviconCache.getStats()
            : { status: 'error', error: 'Cache not initialized' };
        const registryStats = getRegistryCacheStats();

        // Get full health status
        const health = await getFullHealth('vscode-favicon-service', {
            faviconCache: {
                status: 'ok',
                ...faviconStats,
            },
            registryCache: {
                status: 'ok',
                ...registryStats,
            },
        });

        // Return 503 if service is degraded
        const statusCode = health.status === 'ok' ? 200 : 503;
        res.status(statusCode).json(health);
    } catch (error) {
        logger.error({ err: error }, 'Health check failed');
        res.status(503).json({
            status: 'error',
            service: 'vscode-favicon-service',
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

// Server instance for graceful shutdown
let server;

// Start server
server = app.listen(config.servicePort, () => {
    logger.info(
        {
            port: config.servicePort,
            environment: config.nodeEnv,
            endpoints: {
                favicon: `/api/favicon?folder=/path/to/project`,
                projectInfo: `/api/project-info?folder=/path/to/project`,
                health: `/health`,
                healthLiveness: `/health/live`,
                healthReadiness: `/health/ready`,
                clearCache: `/api/clear-cache (admin only)`,
            },
            security: {
                rateLimit: `${config.rateLimitMax} req/${config.rateLimitWindow}ms per IP`,
                pathValidation: 'enabled',
                jsonBodyLimit: '10KB',
                helmet: 'CSP, HSTS, X-Frame-Options, X-Content-Type-Options',
                adminIPWhitelist: ['127.0.0.1', '::1', '192.168.110.199'],
            },
            compression: {
                enabled: true,
                level: 6,
                threshold: '1KB',
                expectedReduction: '70-90%',
            },
        },
        'VS Code Favicon Service started'
    );
});

// Handle port already in use
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        logger.fatal({ port: config.servicePort, err }, 'Port already in use');
        process.exit(1);
    }
    throw err;
});

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
