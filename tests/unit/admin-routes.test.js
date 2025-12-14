/**
 * Admin Routes Unit Tests
 * Tests for administrative endpoints
 */

const express = require('express');
const request = require('supertest');
const fs = require('fs');
const path = require('path');

// Mock registry-cache before requiring admin-routes
const mockGetCacheStats = jest.fn(() => ({ cached: false, lastLoad: null }));
const mockInvalidateCache = jest.fn();

jest.mock('../../lib/registry-cache', () => ({
    getCacheStats: mockGetCacheStats,
    invalidateCache: mockInvalidateCache,
}));

const { createAdminRoutes } = require('../../lib/routes/admin-routes');

describe('Admin Routes', () => {
    let app;
    let mockFaviconCache;

    beforeEach(() => {
        // Reset mocks
        mockGetCacheStats.mockReturnValue({ cached: false, lastLoad: null });
        mockInvalidateCache.mockClear();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('POST /api/clear-cache', () => {
        it('should clear favicon cache successfully', async () => {
            app = express();
            app.use(express.json());

            mockFaviconCache = {
                size: 42,
                clear: jest.fn(),
            };

            const mockCacheClearLimiter = (req, res, next) => next();
            const mockAdminAuth = (req, res, next) => next();
            const mockDownloadLimiter = (req, res, next) => next();

            const router = createAdminRoutes(
                mockFaviconCache,
                mockCacheClearLimiter,
                mockAdminAuth,
                mockDownloadLimiter
            );
            app.use(router);

            const response = await request(app)
                .post('/api/clear-cache')
                .expect('Content-Type', /json/)
                .expect(200);

            expect(response.body).toEqual({
                success: true,
                message: 'All caches cleared',
                faviconItemsCleared: 42,
                registryCacheCleared: false,
            });

            expect(mockFaviconCache.clear).toHaveBeenCalledTimes(1);
            expect(mockInvalidateCache).toHaveBeenCalledTimes(1);
        });

        it('should fail if admin auth rejects', async () => {
            app = express();
            app.use(express.json());

            mockFaviconCache = {
                size: 42,
                clear: jest.fn(),
            };

            const mockCacheClearLimiter = (req, res, next) => next();
            const mockAdminAuth = (req, res) => {
                res.status(403).json({ error: 'Forbidden' });
            };
            const mockDownloadLimiter = (req, res, next) => next();

            const router = createAdminRoutes(
                mockFaviconCache,
                mockCacheClearLimiter,
                mockAdminAuth,
                mockDownloadLimiter
            );
            app.use(router);

            await request(app)
                .post('/api/clear-cache')
                .expect(403);

            expect(mockFaviconCache.clear).not.toHaveBeenCalled();
        });

        it('should clear cache even when size is zero', async () => {
            app = express();
            app.use(express.json());

            mockFaviconCache = {
                size: 0,
                clear: jest.fn(),
            };

            const mockCacheClearLimiter = (req, res, next) => next();
            const mockAdminAuth = (req, res, next) => next();
            const mockDownloadLimiter = (req, res, next) => next();

            const router = createAdminRoutes(
                mockFaviconCache,
                mockCacheClearLimiter,
                mockAdminAuth,
                mockDownloadLimiter
            );
            app.use(router);

            const response = await request(app)
                .post('/api/clear-cache')
                .expect(200);

            expect(response.body.faviconItemsCleared).toBe(0);
            expect(mockFaviconCache.clear).toHaveBeenCalled();
        });

        it('should return registry cache cleared status', async () => {
            app = express();
            app.use(express.json());

            mockGetCacheStats.mockReturnValue({ cached: true, lastLoad: Date.now() });

            mockFaviconCache = {
                size: 10,
                clear: jest.fn(),
            };

            const mockCacheClearLimiter = (req, res, next) => next();
            const mockAdminAuth = (req, res, next) => next();
            const mockDownloadLimiter = (req, res, next) => next();

            const router = createAdminRoutes(
                mockFaviconCache,
                mockCacheClearLimiter,
                mockAdminAuth,
                mockDownloadLimiter
            );
            app.use(router);

            const response = await request(app)
                .post('/api/clear-cache')
                .expect(200);

            expect(response.body.registryCacheCleared).toBe(true);
        });

        it('should be rate limited by cache clear limiter', async () => {
            app = express();
            app.use(express.json());

            mockFaviconCache = {
                size: 42,
                clear: jest.fn(),
            };

            let callCount = 0;
            const mockCacheClearLimiter = (req, res, next) => {
                callCount++;
                if (callCount > 1) {
                    return res.status(429).json({ error: 'Too many requests' });
                }
                next();
            };
            const mockAdminAuth = (req, res, next) => next();
            const mockDownloadLimiter = (req, res, next) => next();

            const router = createAdminRoutes(
                mockFaviconCache,
                mockCacheClearLimiter,
                mockAdminAuth,
                mockDownloadLimiter
            );
            app.use(router);

            // First request succeeds
            await request(app).post('/api/clear-cache').expect(200);

            // Second request is rate limited
            await request(app).post('/api/clear-cache').expect(429);
        });
    });

    describe('GET /download/extension', () => {
        it('should return 404 when extension file not found', async () => {
            app = express();

            mockFaviconCache = {
                size: 0,
                clear: jest.fn(),
            };

            const mockCacheClearLimiter = (req, res, next) => next();
            const mockAdminAuth = (req, res, next) => next();
            const mockDownloadLimiter = (req, res, next) => next();

            const router = createAdminRoutes(
                mockFaviconCache,
                mockCacheClearLimiter,
                mockAdminAuth,
                mockDownloadLimiter
            );
            app.use(router);

            const response = await request(app)
                .get('/download/extension')
                .expect('Content-Type', /json/)
                .expect(404);

            expect(response.body).toEqual({
                error: 'Extension file not found',
            });
        });

        it('should initiate download when file exists', async () => {
            app = express();

            // Create a temporary test file
            const testZipPath = path.join(__dirname, '../..', 'test-extension.zip');
            fs.writeFileSync(testZipPath, 'test content');

            // Mock config to point to test file
            const config = require('../../lib/config');
            const originalPath = config.extensionZipPath;
            config.extensionZipPath = testZipPath;

            mockFaviconCache = {
                size: 0,
                clear: jest.fn(),
            };

            const mockCacheClearLimiter = (req, res, next) => next();
            const mockAdminAuth = (req, res, next) => next();
            const mockDownloadLimiter = (req, res, next) => next();

            const router = createAdminRoutes(
                mockFaviconCache,
                mockCacheClearLimiter,
                mockAdminAuth,
                mockDownloadLimiter
            );
            app.use(router);

            try {
                const response = await request(app)
                    .get('/download/extension')
                    .expect(200);

                // Verify download content
                expect(response.text).toBe('test content');
            } finally {
                // Cleanup
                config.extensionZipPath = originalPath;
                if (fs.existsSync(testZipPath)) {
                    fs.unlinkSync(testZipPath);
                }
            }
        });

        it('should be rate limited by download limiter', async () => {
            app = express();

            mockFaviconCache = {
                size: 0,
                clear: jest.fn(),
            };

            const mockCacheClearLimiter = (req, res, next) => next();
            const mockAdminAuth = (req, res, next) => next();

            let downloadCallCount = 0;
            const mockDownloadLimiter = (req, res, next) => {
                downloadCallCount++;
                if (downloadCallCount > 5) {
                    return res.status(429).json({ error: 'Too many downloads' });
                }
                next();
            };

            const router = createAdminRoutes(
                mockFaviconCache,
                mockCacheClearLimiter,
                mockAdminAuth,
                mockDownloadLimiter
            );
            app.use(router);

            // Make 5 requests (should succeed)
            for (let i = 0; i < 5; i++) {
                await request(app).get('/download/extension');
            }

            // 6th request should be rate limited
            await request(app).get('/download/extension').expect(429);
        });
    });
});
