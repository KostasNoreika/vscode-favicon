/**
 * Rate Limiters Unit Tests
 * Tests for all rate limiting middleware
 */

const express = require('express');
const request = require('supertest');
const {
    createAPILimiter,
    createNotificationLimiter,
    createDownloadLimiter,
    createCacheClearLimiter,
    createPasteImageLimiter,
    createHealthCheckLimiter,
} = require('../../lib/middleware/rate-limiters');

// Mock logger to prevent console output during tests
jest.mock('../../lib/logger', () => ({
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
}));

describe('Rate Limiters', () => {
    let app;

    beforeEach(() => {
        app = express();
        app.use(express.json());
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('createAPILimiter', () => {
        it('should create API rate limiter middleware', () => {
            const limiter = createAPILimiter();
            expect(limiter).toBeDefined();
            expect(typeof limiter).toBe('function');
        });

        it('should allow requests within limit', async () => {
            const limiter = createAPILimiter();
            app.use(limiter);
            app.get('/test', (req, res) => res.json({ success: true }));

            const response = await request(app).get('/test').expect(200);

            expect(response.body).toEqual({ success: true });
        });

        it('should set standard headers', async () => {
            const limiter = createAPILimiter();
            app.use(limiter);
            app.get('/test', (req, res) => res.json({ success: true }));

            const response = await request(app).get('/test');

            expect(response.headers['ratelimit-limit']).toBeDefined();
            expect(response.headers['ratelimit-remaining']).toBeDefined();
        });
    });

    describe('createNotificationLimiter', () => {
        it('should create notification rate limiter middleware', () => {
            const limiter = createNotificationLimiter();
            expect(limiter).toBeDefined();
            expect(typeof limiter).toBe('function');
        });

        it('should allow requests within limit', async () => {
            const limiter = createNotificationLimiter();
            app.use(limiter);
            app.post('/notify', (req, res) => res.json({ success: true }));

            const response = await request(app).post('/notify').expect(200);

            expect(response.body).toEqual({ success: true });
        });
    });

    describe('createDownloadLimiter', () => {
        it('should create download rate limiter middleware', () => {
            const limiter = createDownloadLimiter();
            expect(limiter).toBeDefined();
            expect(typeof limiter).toBe('function');
        });

        it('should allow requests within limit', async () => {
            const limiter = createDownloadLimiter();
            app.use(limiter);
            app.get('/download', (req, res) => res.json({ success: true }));

            const response = await request(app).get('/download').expect(200);

            expect(response.body).toEqual({ success: true });
        });

        it('should set standard headers', async () => {
            const limiter = createDownloadLimiter();
            app.use(limiter);
            app.get('/download', (req, res) => res.json({ success: true }));

            const response = await request(app).get('/download');

            expect(response.headers['ratelimit-limit']).toBeDefined();
            expect(response.headers['ratelimit-remaining']).toBeDefined();
        });
    });

    describe('createCacheClearLimiter', () => {
        it('should create cache clear rate limiter middleware', () => {
            const limiter = createCacheClearLimiter();
            expect(limiter).toBeDefined();
            expect(typeof limiter).toBe('function');
        });

        it('should allow requests within limit', async () => {
            const limiter = createCacheClearLimiter();
            app.use(limiter);
            app.post('/clear', (req, res) => res.json({ success: true }));

            const response = await request(app).post('/clear').expect(200);

            expect(response.body).toEqual({ success: true });
        });

        it('should have strict limit (1 per minute)', async () => {
            const limiter = createCacheClearLimiter();
            app.use(limiter);
            app.post('/clear', (req, res) => res.json({ success: true }));

            // First request should succeed
            await request(app).post('/clear').expect(200);

            // Second immediate request should be rate limited
            const response = await request(app).post('/clear').expect(429);

            expect(response.body).toHaveProperty('error');
            expect(response.body.error).toMatch(/rate limit/i);
        });
    });

    describe('createPasteImageLimiter', () => {
        it('should create paste image rate limiter middleware', () => {
            const limiter = createPasteImageLimiter();
            expect(limiter).toBeDefined();
            expect(typeof limiter).toBe('function');
        });

        it('should allow requests within limit', async () => {
            const limiter = createPasteImageLimiter();
            app.use(limiter);
            app.post('/paste', (req, res) => res.json({ success: true }));

            const response = await request(app).post('/paste').expect(200);

            expect(response.body).toEqual({ success: true });
        });

        it('should set standard headers', async () => {
            const limiter = createPasteImageLimiter();
            app.use(limiter);
            app.post('/paste', (req, res) => res.json({ success: true }));

            const response = await request(app).post('/paste');

            expect(response.headers['ratelimit-limit']).toBeDefined();
            expect(response.headers['ratelimit-remaining']).toBeDefined();
        });
    });

    describe('createHealthCheckLimiter', () => {
        it('should create health check rate limiter middleware', () => {
            const limiter = createHealthCheckLimiter();
            expect(limiter).toBeDefined();
            expect(typeof limiter).toBe('function');
        });

        it('should allow requests within limit', async () => {
            const limiter = createHealthCheckLimiter();
            app.use(limiter);
            app.get('/health', (req, res) => res.json({ status: 'ok' }));

            const response = await request(app).get('/health').expect(200);

            expect(response.body).toEqual({ status: 'ok' });
        });

        it('should have higher limit than API endpoints', async () => {
            const limiter = createHealthCheckLimiter();
            app.use(limiter);
            app.get('/health', (req, res) => res.json({ status: 'ok' }));

            // Make multiple requests - should not be limited immediately
            for (let i = 0; i < 10; i++) {
                await request(app).get('/health').expect(200);
            }
        });

        it('should set standard rate limit headers', async () => {
            const limiter = createHealthCheckLimiter();
            app.use(limiter);
            app.get('/health', (req, res) => res.json({ status: 'ok' }));

            const response = await request(app).get('/health');

            expect(response.headers['ratelimit-limit']).toBeDefined();
            expect(response.headers['ratelimit-remaining']).toBeDefined();
        });
    });

    describe('Rate Limit Error Responses', () => {
        it('should include retryAfter in error response', async () => {
            const limiter = createCacheClearLimiter();
            app.use(limiter);
            app.post('/clear', (req, res) => res.json({ success: true }));

            // First request succeeds
            await request(app).post('/clear').expect(200);

            // Second request gets rate limited
            const response = await request(app).post('/clear').expect(429);

            expect(response.body).toHaveProperty('retryAfter');
            expect(typeof response.body.retryAfter).toBe('number');
            expect(response.body.retryAfter).toBeGreaterThan(0);
        });

        it('should set Retry-After header', async () => {
            const limiter = createCacheClearLimiter();
            app.use(limiter);
            app.post('/clear', (req, res) => res.json({ success: true }));

            // First request succeeds
            await request(app).post('/clear').expect(200);

            // Second request gets rate limited
            const response = await request(app).post('/clear').expect(429);

            expect(response.headers['retry-after']).toBeDefined();
            expect(parseInt(response.headers['retry-after'], 10)).toBeGreaterThan(0);
        });
    });
});
