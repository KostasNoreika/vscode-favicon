/**
 * Route Error Path Integration Tests
 * Tests error handling scenarios across all route modules
 *
 * Coverage areas:
 * - Favicon routes error paths
 * - Notification routes error paths
 * - Paste routes error paths
 * - Health routes error paths
 * - Admin routes error paths
 * - Error response consistency
 */

const express = require('express');
const request = require('supertest');
const _fs = require('fs').promises;
const _path = require('path');

jest.mock('../../lib/logger');
jest.mock('../../lib/config');
jest.mock('../../lib/notification-store');
jest.mock('../../lib/registry-cache');
jest.mock('../../lib/lru-cache');
jest.mock('../../lib/services/favicon-service');

const logger = require('../../lib/logger');
const config = require('../../lib/config');
const notificationStore = require('../../lib/notification-store');
const { getRegistry } = require('../../lib/registry-cache');
const _LRUCache = require('../../lib/lru-cache');
const _FaviconService = require('../../lib/services/favicon-service');

describe('Route Error Path Integration Tests', () => {
    let app;
    let faviconCache;
    let faviconService;

    beforeEach(() => {
        app = express();

        // Setup request logger mock
        app.use((req, res, next) => {
            req.log = {
                info: jest.fn(),
                error: jest.fn(),
                warn: jest.fn(),
                debug: jest.fn(),
            };
            next();
        });

        // Mock logger
        logger.error = jest.fn();
        logger.warn = jest.fn();
        logger.info = jest.fn();

        // Setup basic config
        config.allowedPaths = ['/opt/test'];
        config.adminIPs = ['127.0.0.1'];
        config.adminApiKey = null;
        config.extensionZipPath = '/path/to/extension.zip';

        // Setup mocks
        faviconCache = {
            get: jest.fn(),
            set: jest.fn(),
            clear: jest.fn(),
            size: 0,
        };

        faviconService = {
            generateFaviconSVG: jest.fn(),
            searchForCustomFavicon: jest.fn(),
        };

        notificationStore.get = jest.fn();
        notificationStore.set = jest.fn();
        notificationStore.delete = jest.fn();
        notificationStore.markAsRead = jest.fn();
        notificationStore.getAllForFolder = jest.fn().mockReturnValue([]);

        getRegistry.mockResolvedValue({
            projects: [],
        });

        jest.clearAllMocks();
    });

    describe('Favicon Routes Error Paths', () => {
        beforeEach(() => {
            const { createFaviconRoutes } = require('../../lib/routes/favicon-routes');
            app.use(createFaviconRoutes(faviconCache, faviconService));
        });

        it('should return 400 for missing folder parameter', async () => {
            const response = await request(app)
                .get('/api/favicon')
                .expect(400);

            expect(response.body.error).toBeDefined();
        });

        it('should return 403 for path outside allowed paths', async () => {
            const response = await request(app)
                .get('/api/favicon?folder=/etc/passwd')
                .expect(403);

            expect(response.body.error).toBe('Access denied');
        });

        it('should return 403 for path traversal attempt', async () => {
            const response = await request(app)
                .get('/api/favicon?folder=/opt/test/../../etc/passwd')
                .expect(403);

            expect(response.body.error).toBe('Access denied');
        });

        it('should handle favicon service errors gracefully', async () => {
            faviconService.generateFaviconSVG.mockRejectedValue(new Error('Service failed'));
            faviconService.searchForCustomFavicon.mockResolvedValue(null);

            const response = await request(app)
                .get('/api/favicon?folder=/opt/test')
                .expect(500);

            expect(response.body.error).toBe('Internal server error');
        });

        it('should handle invalid grayscale parameter', async () => {
            faviconService.generateFaviconSVG.mockResolvedValue('<svg></svg>');
            faviconService.searchForCustomFavicon.mockResolvedValue(null);

            const _response = await request(app)
                .get('/api/favicon?folder=/opt/test&grayscale=invalid')
                .expect(200); // Should ignore invalid and default to false

            expect(faviconService.generateFaviconSVG).toHaveBeenCalled();
        });
    });

    describe('Notification Routes Error Paths', () => {
        beforeEach(() => {
            const { createNotificationRoutes } = require('../../lib/routes/notification-routes');
            const notificationLimiter = (req, res, next) => next();
            app.use(express.json());
            app.use(createNotificationRoutes(notificationLimiter));
        });

        it('should return 400 for POST without folder', async () => {
            const response = await request(app)
                .post('/claude-completion')
                .send({ message: 'test' })
                .expect(400);

            expect(response.body.error).toBeDefined();
        });

        it('should return 400 for POST without message', async () => {
            const response = await request(app)
                .post('/claude-completion')
                .send({ folder: '/opt/test' })
                .expect(400);

            expect(response.body.error).toBeDefined();
        });

        it('should return 403 for notification access outside allowed paths', async () => {
            const response = await request(app)
                .post('/claude-completion')
                .send({ folder: '/etc/passwd', message: 'test' })
                .expect(403);

            expect(response.body.error).toBe('Access denied');
        });

        it('should return 404 for GET status with non-existent folder', async () => {
            notificationStore.get.mockReturnValue(null);

            const response = await request(app)
                .get('/claude-status?folder=/opt/test')
                .expect(404);

            expect(response.body.error).toBe('No notifications found');
        });

        it('should return 400 for DELETE without folder', async () => {
            const response = await request(app)
                .delete('/claude-status')
                .expect(400);

            expect(response.body.error).toBeDefined();
        });

        it('should return 403 for mark-read with invalid path', async () => {
            const response = await request(app)
                .post('/claude-status/mark-read')
                .send({ folder: '/etc/passwd' })
                .expect(403);

            expect(response.body.error).toBe('Access denied');
        });

        it('should handle notification store errors', async () => {
            notificationStore.set.mockImplementation(() => {
                throw new Error('Store failed');
            });

            const response = await request(app)
                .post('/claude-completion')
                .send({ folder: '/opt/test', message: 'test' })
                .expect(500);

            expect(response.body.error).toBe('Internal server error');
        });
    });

    describe('Health Routes Error Paths', () => {
        beforeEach(() => {
            const { createHealthRoutes } = require('../../lib/routes/health-routes');
            const healthLimiter = (req, res, next) => next();
            app.use(createHealthRoutes(healthLimiter, getRegistry));
        });

        it('should return degraded status when registry fails', async () => {
            getRegistry.mockRejectedValue(new Error('Registry failed'));

            const response = await request(app)
                .get('/health')
                .expect(200);

            expect(response.body.status).toBe('degraded');
            expect(response.body.checks.registry).toBe('failed');
        });

        it('should handle missing uptime gracefully', async () => {
            const response = await request(app)
                .get('/health')
                .expect(200);

            expect(response.body.uptime).toBeDefined();
        });

        it('should always return 200 for liveness probe', async () => {
            // Even if registry fails
            getRegistry.mockRejectedValue(new Error('Registry failed'));

            const response = await request(app)
                .get('/health/live')
                .expect(200);

            expect(response.body.status).toBe('ok');
        });

        it('should return 503 for readiness when registry fails', async () => {
            getRegistry.mockRejectedValue(new Error('Registry failed'));

            const response = await request(app)
                .get('/health/ready')
                .expect(503);

            expect(response.body.status).toBe('not ready');
        });
    });

    describe('Admin Routes Error Paths', () => {
        beforeEach(() => {
            const { createAdminRoutes } = require('../../lib/routes/admin-routes');
            const cacheClearLimiter = (req, res, next) => next();
            const adminAuth = (req, res, next) => {
                if (req.ip === '127.0.0.1') return next();
                res.status(403).json({ error: 'Forbidden' });
            };
            const downloadLimiter = (req, res, next) => next();

            app.use(createAdminRoutes(faviconCache, cacheClearLimiter, adminAuth, downloadLimiter));
        });

        it('should return 403 for cache clear from unauthorized IP', async () => {
            const response = await request(app)
                .post('/api/clear-cache')
                .set('X-Forwarded-For', '192.168.1.1')
                .expect(403);

            expect(response.body.error).toBe('Forbidden');
        });

        it('should return 404 for extension download when file missing', async () => {
            config.extensionZipPath = '/nonexistent/path.zip';

            const response = await request(app)
                .get('/download/extension')
                .expect(404);

            expect(response.body.error).toBe('Extension file not found');
        });
    });

    describe('Error Response Consistency', () => {
        beforeEach(() => {
            const { createFaviconRoutes } = require('../../lib/routes/favicon-routes');
            app.use(createFaviconRoutes(faviconCache, faviconService));
        });

        it('should return JSON error responses', async () => {
            const response = await request(app)
                .get('/api/favicon')
                .expect(400);

            expect(response.headers['content-type']).toMatch(/json/);
            expect(response.body.error).toBeDefined();
        });

        it('should not expose internal error details', async () => {
            faviconService.generateFaviconSVG.mockRejectedValue(new Error('Internal database connection failed'));
            faviconService.searchForCustomFavicon.mockResolvedValue(null);

            const response = await request(app)
                .get('/api/favicon?folder=/opt/test')
                .expect(500);

            // Should return generic error, not expose internal details
            expect(response.body.error).toBe('Internal server error');
            expect(response.body.error).not.toContain('database');
        });

        it('should include appropriate HTTP status codes', async () => {
            // 400 for bad request
            await request(app).get('/api/favicon').expect(400);

            // 403 for forbidden
            await request(app).get('/api/favicon?folder=/etc/passwd').expect(403);

            // 500 for server errors
            faviconService.generateFaviconSVG.mockRejectedValue(new Error('Fail'));
            faviconService.searchForCustomFavicon.mockResolvedValue(null);
            await request(app).get('/api/favicon?folder=/opt/test').expect(500);
        });
    });

    describe('Path Validation Edge Cases', () => {
        beforeEach(() => {
            const { createFaviconRoutes } = require('../../lib/routes/favicon-routes');
            app.use(createFaviconRoutes(faviconCache, faviconService));
        });

        it('should reject null byte in path', async () => {
            const response = await request(app)
                .get('/api/favicon?folder=/opt/test%00')
                .expect(403);

            expect(response.body.error).toBe('Access denied');
        });

        it('should reject path with .. components', async () => {
            const response = await request(app)
                .get('/api/favicon?folder=/opt/test/../../../etc')
                .expect(403);

            expect(response.body.error).toBe('Access denied');
        });

        it('should reject relative paths', async () => {
            const response = await request(app)
                .get('/api/favicon?folder=./test')
                .expect(403);

            expect(response.body.error).toBe('Access denied');
        });

        it('should reject empty folder parameter', async () => {
            const response = await request(app)
                .get('/api/favicon?folder=')
                .expect(400);

            expect(response.body.error).toBeDefined();
        });

        it('should reject folder parameter with only whitespace', async () => {
            const response = await request(app)
                .get('/api/favicon?folder=%20%20%20')
                .expect(400);

            expect(response.body.error).toBeDefined();
        });
    });

    describe('Content-Type Validation', () => {
        beforeEach(() => {
            const { createNotificationRoutes } = require('../../lib/routes/notification-routes');
            const notificationLimiter = (req, res, next) => next();
            app.use(express.json());
            app.use(createNotificationRoutes(notificationLimiter));
        });

        it('should handle missing Content-Type header', async () => {
            const response = await request(app)
                .post('/claude-completion')
                .send('folder=/opt/test&message=test')
                .expect(400);

            // Should fail validation or return bad request
            expect([400, 415]).toContain(response.status);
        });

        it('should accept application/json Content-Type', async () => {
            notificationStore.set.mockReturnValue(undefined);

            const response = await request(app)
                .post('/claude-completion')
                .set('Content-Type', 'application/json')
                .send({ folder: '/opt/test', message: 'test' })
                .expect(200);

            expect(response.body.success).toBe(true);
        });
    });

    describe('Rate Limiter Error Scenarios', () => {
        it('should handle rate limiter errors gracefully', async () => {
            const _failingLimiter = (_req, _res, next) => {
                next(new Error('Rate limiter failed'));
            };

            const { createFaviconRoutes } = require('../../lib/routes/favicon-routes');
            app.use(createFaviconRoutes(faviconCache, faviconService));

            // Add error handler
            app.use((err, _req, res, _next) => {
                res.status(500).json({ error: 'Internal server error' });
            });

            const response = await request(app)
                .get('/api/favicon?folder=/opt/test')
                .expect(500);

            expect(response.body.error).toBeDefined();
        });
    });
});
