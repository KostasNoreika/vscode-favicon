/**
 * Health Routes Comprehensive Unit Tests
 * Complete coverage for health check endpoints
 */

const express = require('express');
const request = require('supertest');

// Mock dependencies
const mockGetFullHealth = jest.fn();
const mockGetLivenessProbe = jest.fn();
const mockGetReadinessProbe = jest.fn();
const mockGetFileDescriptorUsage = jest.fn();
const mockGetCacheStats = jest.fn();
const mockNotificationStoreGetStats = jest.fn();

jest.mock('../../lib/health-check', () => ({
    getFullHealth: mockGetFullHealth,
    getLivenessProbe: mockGetLivenessProbe,
    getReadinessProbe: mockGetReadinessProbe,
    getFileDescriptorUsage: mockGetFileDescriptorUsage,
}));

jest.mock('../../lib/registry-cache', () => ({
    getCacheStats: mockGetCacheStats,
}));

jest.mock('../../lib/notification-store', () => ({
    getStats: mockNotificationStoreGetStats,
}));

jest.mock('../../lib/logger', () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
}));

const { createHealthRoutes } = require('../../lib/routes/health-routes');

describe('Health Routes', () => {
    let app;
    let mockFaviconCache;
    let mockFaviconService;
    let mockGetSSEStats;

    beforeEach(() => {
        app = express();

        mockFaviconCache = {
            getStats: jest.fn(() => ({
                size: 42,
                maxSize: 100,
                hitRate: 0.85,
            })),
        };

        mockFaviconService = {
            getStats: jest.fn(() => ({
                cacheSize: 10,
                maxCacheSize: 50,
            })),
        };

        mockGetSSEStats = jest.fn(() => ({
            totalConnections: 5,
            maxConnections: 100,
        }));

        mockGetCacheStats.mockReturnValue({
            cached: true,
            lastLoad: Date.now(),
        });

        mockNotificationStoreGetStats.mockReturnValue({
            count: 10,
            maxCount: 1000,
            listenerCount: 5,
        });

        mockGetFileDescriptorUsage.mockReturnValue({
            used: 100,
            limit: 1024,
            percentage: 9.76,
        });

        mockGetFullHealth.mockResolvedValue({
            status: 'healthy',
            service: 'vscode-favicon-unified',
        });

        mockGetLivenessProbe.mockResolvedValue({
            status: 'alive',
            uptime: 12345,
        });

        mockGetReadinessProbe.mockResolvedValue({
            status: 'ready',
            checks: { database: 'ok' },
        });

        const router = createHealthRoutes(mockFaviconCache, mockFaviconService, mockGetSSEStats);
        app.use(router);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /health', () => {
        it('should return healthy status with cache stats', async () => {
            const response = await request(app)
                .get('/health')
                .expect('Content-Type', /json/)
                .expect(200);

            expect(response.body).toHaveProperty('status', 'healthy');
            expect(mockFaviconCache.getStats).toHaveBeenCalled();
            expect(mockGetCacheStats).toHaveBeenCalled();
            expect(mockNotificationStoreGetStats).toHaveBeenCalled();
        });

        it('should handle missing favicon cache', async () => {
            const appWithoutCache = express();
            const router = createHealthRoutes(null, mockFaviconService, mockGetSSEStats);
            appWithoutCache.use(router);

            await request(appWithoutCache).get('/health').expect(200);

            expect(mockGetFullHealth).toHaveBeenCalledWith(
                'vscode-favicon-unified',
                expect.objectContaining({
                    faviconCache: expect.objectContaining({
                        status: 'error',
                        error: 'Cache not initialized',
                    }),
                })
            );
        });

        it('should handle missing favicon service', async () => {
            const appWithoutService = express();
            const router = createHealthRoutes(mockFaviconCache, null, mockGetSSEStats);
            appWithoutService.use(router);

            await request(appWithoutService).get('/health').expect(200);

            expect(mockGetFullHealth).toHaveBeenCalledWith(
                'vscode-favicon-unified',
                expect.objectContaining({
                    faviconService: expect.objectContaining({
                        status: 'error',
                        error: 'FaviconService not initialized',
                    }),
                })
            );
        });

        it('should return 503 for unhealthy status', async () => {
            mockGetFullHealth.mockResolvedValue({
                status: 'unhealthy',
                service: 'vscode-favicon-unified',
            });

            await request(app).get('/health').expect(503);
        });

        it('should return 503 for not_ready status', async () => {
            mockGetFullHealth.mockResolvedValue({
                status: 'not_ready',
                service: 'vscode-favicon-unified',
            });

            await request(app).get('/health').expect(503);
        });

        it('should return 200 for degraded status', async () => {
            mockGetFullHealth.mockResolvedValue({
                status: 'degraded',
                service: 'vscode-favicon-unified',
            });

            await request(app).get('/health').expect(200);
        });

        it('should handle errors gracefully', async () => {
            mockGetFullHealth.mockRejectedValue(new Error('Health check failed'));

            const response = await request(app).get('/health').expect(500);

            expect(response.body).toHaveProperty('status', 'error');
            expect(response.body).toHaveProperty('error', 'Health check failed');
        });

        it('should include SSE stats in response', async () => {
            await request(app).get('/health').expect(200);

            expect(mockGetSSEStats).toHaveBeenCalled();
        });

        it('should include file descriptor usage', async () => {
            await request(app).get('/health').expect(200);

            expect(mockGetFileDescriptorUsage).toHaveBeenCalled();
        });
    });

    describe('GET /health/live', () => {
        it('should return liveness probe status', async () => {
            const response = await request(app)
                .get('/health/live')
                .expect('Content-Type', /json/)
                .expect(200);

            expect(response.body).toHaveProperty('status', 'alive');
            expect(mockGetLivenessProbe).toHaveBeenCalled();
        });

        it('should return 503 when not alive', async () => {
            mockGetLivenessProbe.mockResolvedValue({
                status: 'dead',
            });

            await request(app).get('/health/live').expect(503);
        });

        it('should handle liveness probe errors', async () => {
            mockGetLivenessProbe.mockRejectedValue(new Error('Liveness check failed'));

            const response = await request(app).get('/health/live').expect(500);

            expect(response.body).toHaveProperty('status', 'error');
        });
    });

    describe('GET /health/ready', () => {
        it('should return readiness probe status', async () => {
            const response = await request(app)
                .get('/health/ready')
                .expect('Content-Type', /json/)
                .expect(200);

            expect(response.body).toHaveProperty('status', 'ready');
            expect(mockGetReadinessProbe).toHaveBeenCalled();
        });

        it('should return 503 when not ready', async () => {
            mockGetReadinessProbe.mockResolvedValue({
                status: 'not_ready',
            });

            await request(app).get('/health/ready').expect(503);
        });

        it('should handle readiness probe errors', async () => {
            mockGetReadinessProbe.mockRejectedValue(new Error('Readiness check failed'));

            const response = await request(app).get('/health/ready').expect(500);

            expect(response.body).toHaveProperty('status', 'error');
        });
    });

    describe('getStatusCode helper', () => {
        // This is tested implicitly through the health endpoints
        it('should return 200 for ok status', async () => {
            mockGetFullHealth.mockResolvedValue({ status: 'ok' });
            await request(app).get('/health').expect(200);
        });

        it('should return 200 for healthy status', async () => {
            mockGetFullHealth.mockResolvedValue({ status: 'healthy' });
            await request(app).get('/health').expect(200);
        });

        it('should return 200 for ready status', async () => {
            mockGetFullHealth.mockResolvedValue({ status: 'ready' });
            await request(app).get('/health').expect(200);
        });

        it('should return 200 for alive status', async () => {
            mockGetLivenessProbe.mockResolvedValue({ status: 'alive' });
            await request(app).get('/health/live').expect(200);
        });

        it('should handle case-insensitive status', async () => {
            mockGetFullHealth.mockResolvedValue({ status: 'HEALTHY' });
            await request(app).get('/health').expect(200);
        });

        it('should handle null status as unhealthy', async () => {
            mockGetFullHealth.mockResolvedValue({ status: null });
            await request(app).get('/health').expect(503);
        });

        it('should handle undefined status as unhealthy', async () => {
            mockGetFullHealth.mockResolvedValue({});
            await request(app).get('/health').expect(503);
        });
    });
});
