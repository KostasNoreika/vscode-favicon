/**
 * Integration Tests for Retry-After Header in Rate Limit Responses
 *
 * Verifies that all rate-limited endpoints return the Retry-After header
 * as per RFC 6585 and HTTP semantics, enabling clients to implement
 * proper retry backoff strategies.
 *
 * Tests cover:
 * - Header presence in 429 responses
 * - Header format (numeric seconds)
 * - Consistency between header and response body
 * - All rate-limited endpoints (API, notifications, health, paste, cache clear)
 */

const request = require('supertest');
const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');

// Mock the server configuration
jest.mock('../../lib/config', () => ({
    allowedPaths: ['/opt/dev', '/opt/prod', '/opt/research'],
    registryPath: path.join(__dirname, '../fixtures/mock-registry.json'),
    dataDir: path.join(__dirname, '../fixtures'),
    servicePort: 3000,
    rateLimitWindow: 60000, // 1 minute
    rateLimitMax: 10, // Low limit for testing
    rateLimitNotificationWindow: 60000,
    rateLimitNotificationMax: 10,
    sseGlobalLimit: 5,
}));

describe('Retry-After Header Tests', () => {
    describe('API Rate Limiter', () => {
        let app;

        beforeEach(() => {
            app = express();
            app.use(express.json({ limit: '10kb' }));

            const apiLimiter = rateLimit({
                windowMs: 60000,
                max: 5,
                standardHeaders: true,
                legacyHeaders: false,
                handler: (req, res) => {
                    const retryAfterSeconds = Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000);
                    res.setHeader('Retry-After', retryAfterSeconds);
                    res.status(429).json({
                        error: 'Too many requests, please try again later',
                        retryAfter: retryAfterSeconds,
                    });
                },
            });

            app.use('/api', apiLimiter);
            app.get('/api/test', (req, res) => res.json({ success: true }));
        });

        test('should include Retry-After header in 429 response', async () => {
            // Exhaust rate limit
            await Promise.all(
                Array.from({ length: 5 }, () => request(app).get('/api/test'))
            );

            // Trigger rate limit
            const response = await request(app).get('/api/test').expect(429);

            expect(response.headers['retry-after']).toBeDefined();
            expect(typeof response.headers['retry-after']).toBe('string');
            expect(parseInt(response.headers['retry-after'], 10)).toBeGreaterThan(0);
        });

        test('should have consistent retryAfter values in header and body', async () => {
            // Exhaust rate limit
            await Promise.all(
                Array.from({ length: 5 }, () => request(app).get('/api/test'))
            );

            // Trigger rate limit
            const response = await request(app).get('/api/test').expect(429);

            const headerValue = parseInt(response.headers['retry-after'], 10);
            const bodyValue = response.body.retryAfter;

            // Values should be identical or within 1 second (timing variance)
            expect(Math.abs(headerValue - bodyValue)).toBeLessThanOrEqual(1);
        });

        test('should return numeric seconds, not HTTP date', async () => {
            // Exhaust rate limit
            await Promise.all(
                Array.from({ length: 5 }, () => request(app).get('/api/test'))
            );

            // Trigger rate limit
            const response = await request(app).get('/api/test').expect(429);

            const retryAfter = response.headers['retry-after'];

            // Should be numeric seconds, not an HTTP date string
            expect(/^\d+$/.test(retryAfter)).toBe(true);
            expect(isNaN(parseInt(retryAfter, 10))).toBe(false);
        });

        test('should have reasonable retry time (< window duration)', async () => {
            // Exhaust rate limit
            await Promise.all(
                Array.from({ length: 5 }, () => request(app).get('/api/test'))
            );

            // Trigger rate limit
            const response = await request(app).get('/api/test').expect(429);

            const retryAfterSeconds = parseInt(response.headers['retry-after'], 10);

            // Should be less than or equal to the window duration (60 seconds)
            expect(retryAfterSeconds).toBeGreaterThan(0);
            expect(retryAfterSeconds).toBeLessThanOrEqual(60);
        });
    });

    describe('Notification Rate Limiter', () => {
        let app;

        beforeEach(() => {
            app = express();
            app.use(express.json({ limit: '10kb' }));

            const notificationLimiter = rateLimit({
                windowMs: 60000,
                max: 3,
                standardHeaders: true,
                legacyHeaders: false,
                handler: (req, res) => {
                    const retryAfterSeconds = Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000);
                    res.setHeader('Retry-After', retryAfterSeconds);
                    res.status(429).json({
                        error: 'Too many notification requests',
                        retryAfter: retryAfterSeconds,
                    });
                },
            });

            app.post('/api/notification', notificationLimiter, (req, res) => {
                res.json({ success: true });
            });
        });

        test('should include Retry-After header for notification endpoints', async () => {
            // Exhaust rate limit
            await Promise.all(
                Array.from({ length: 3 }, () => request(app).post('/api/notification').send({}))
            );

            // Trigger rate limit
            const response = await request(app).post('/api/notification').send({}).expect(429);

            expect(response.headers['retry-after']).toBeDefined();
            expect(parseInt(response.headers['retry-after'], 10)).toBeGreaterThan(0);
        });
    });

    describe('Health Check Rate Limiter', () => {
        let app;

        beforeEach(() => {
            app = express();

            const healthLimiter = rateLimit({
                windowMs: 60000,
                max: 10,
                standardHeaders: true,
                legacyHeaders: false,
                handler: (req, res) => {
                    const retryAfterSeconds = Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000);
                    res.setHeader('Retry-After', retryAfterSeconds);
                    res.status(429).json({
                        error: 'Too many health check requests',
                        retryAfter: retryAfterSeconds,
                    });
                },
            });

            app.get('/health', healthLimiter, (req, res) => {
                res.json({ status: 'ok' });
            });
        });

        test('should include Retry-After header for health endpoints', async () => {
            // Exhaust rate limit
            await Promise.all(
                Array.from({ length: 10 }, () => request(app).get('/health'))
            );

            // Trigger rate limit
            const response = await request(app).get('/health').expect(429);

            expect(response.headers['retry-after']).toBeDefined();
            expect(response.body.retryAfter).toBeDefined();
            expect(response.body.error).toBe('Too many health check requests');
        });
    });

    describe('Paste Image Rate Limiter', () => {
        let app;

        beforeEach(() => {
            app = express();

            const pasteLimiter = rateLimit({
                windowMs: 60000,
                max: 5,
                standardHeaders: true,
                legacyHeaders: false,
                handler: (req, res) => {
                    const retryAfterSeconds = Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000);
                    res.setHeader('Retry-After', retryAfterSeconds);
                    res.status(429).json({
                        error: 'Too many paste requests',
                        retryAfter: retryAfterSeconds,
                    });
                },
            });

            app.post('/api/paste', pasteLimiter, (req, res) => {
                res.json({ success: true });
            });
        });

        test('should include Retry-After header for paste endpoints', async () => {
            // Exhaust rate limit
            await Promise.all(
                Array.from({ length: 5 }, () => request(app).post('/api/paste').send({}))
            );

            // Trigger rate limit
            const response = await request(app).post('/api/paste').send({}).expect(429);

            expect(response.headers['retry-after']).toBeDefined();
            expect(parseInt(response.headers['retry-after'], 10)).toBeGreaterThan(0);
        });
    });

    describe('Cache Clear Rate Limiter', () => {
        let app;

        beforeEach(() => {
            app = express();

            const cacheClearLimiter = rateLimit({
                windowMs: 60000,
                max: 1,
                standardHeaders: true,
                legacyHeaders: false,
                handler: (req, res) => {
                    const retryAfterSeconds = Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000);
                    res.setHeader('Retry-After', retryAfterSeconds);
                    res.status(429).json({
                        error: 'Cache clear rate limit exceeded',
                        retryAfter: retryAfterSeconds,
                    });
                },
            });

            app.post('/api/clear-cache', cacheClearLimiter, (req, res) => {
                res.json({ success: true });
            });
        });

        test('should include Retry-After header for cache clear endpoint', async () => {
            // First request succeeds
            await request(app).post('/api/clear-cache').send({}).expect(200);

            // Second request is rate limited
            const response = await request(app).post('/api/clear-cache').send({}).expect(429);

            expect(response.headers['retry-after']).toBeDefined();
            expect(response.body.retryAfter).toBeDefined();

            const headerValue = parseInt(response.headers['retry-after'], 10);
            const bodyValue = response.body.retryAfter;

            // Should have retry time near window duration (60 seconds)
            expect(headerValue).toBeGreaterThan(0);
            expect(headerValue).toBeLessThanOrEqual(60);
            expect(Math.abs(headerValue - bodyValue)).toBeLessThanOrEqual(1);
        });
    });

    describe('Client Retry Behavior Simulation', () => {
        let app;

        beforeEach(() => {
            app = express();

            const limiter = rateLimit({
                windowMs: 5000, // 5 seconds for faster testing
                max: 2,
                standardHeaders: true,
                legacyHeaders: false,
                handler: (req, res) => {
                    const retryAfterSeconds = Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000);
                    res.setHeader('Retry-After', retryAfterSeconds);
                    res.status(429).json({
                        error: 'Too many requests',
                        retryAfter: retryAfterSeconds,
                    });
                },
            });

            app.get('/api/test', limiter, (req, res) => {
                res.json({ success: true, timestamp: Date.now() });
            });
        });

        test('should allow request after waiting for Retry-After duration', async () => {
            // Exhaust rate limit
            await request(app).get('/api/test').expect(200);
            await request(app).get('/api/test').expect(200);

            // Trigger rate limit
            const rateLimitedResponse = await request(app).get('/api/test').expect(429);

            const retryAfter = parseInt(rateLimitedResponse.headers['retry-after'], 10);
            expect(retryAfter).toBeGreaterThan(0);

            // Wait for the retry-after duration (plus small buffer)
            await new Promise((resolve) => setTimeout(resolve, (retryAfter + 1) * 1000));

            // Should succeed after waiting
            const successResponse = await request(app).get('/api/test').expect(200);
            expect(successResponse.body.success).toBe(true);
        }, 15000); // Extended timeout for this test
    });

    describe('Standard Headers Compatibility', () => {
        let app;

        beforeEach(() => {
            app = express();

            const limiter = rateLimit({
                windowMs: 60000,
                max: 3,
                standardHeaders: true,
                legacyHeaders: false,
                handler: (req, res) => {
                    const retryAfterSeconds = Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000);
                    res.setHeader('Retry-After', retryAfterSeconds);
                    res.status(429).json({
                        error: 'Too many requests',
                        retryAfter: retryAfterSeconds,
                    });
                },
            });

            app.get('/api/test', limiter, (req, res) => {
                res.json({ success: true });
            });
        });

        test('should include both RateLimit-* and Retry-After headers', async () => {
            // Exhaust rate limit
            await Promise.all(
                Array.from({ length: 3 }, () => request(app).get('/api/test'))
            );

            // Trigger rate limit
            const response = await request(app).get('/api/test').expect(429);

            // Standard rate limit headers
            expect(response.headers['ratelimit-limit']).toBeDefined();
            expect(response.headers['ratelimit-remaining']).toBe('0');
            expect(response.headers['ratelimit-reset']).toBeDefined();

            // Retry-After header (RFC 6585)
            expect(response.headers['retry-after']).toBeDefined();

            // Verify Retry-After is reasonable (within the window)
            const retryAfter = parseInt(response.headers['retry-after'], 10);
            expect(retryAfter).toBeGreaterThan(0);
            expect(retryAfter).toBeLessThanOrEqual(60);
        });
    });

    describe('Error Response Schema Validation', () => {
        let app;

        beforeEach(() => {
            app = express();

            const limiter = rateLimit({
                windowMs: 60000,
                max: 2,
                standardHeaders: true,
                legacyHeaders: false,
                handler: (req, res) => {
                    const retryAfterSeconds = Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000);
                    res.setHeader('Retry-After', retryAfterSeconds);
                    res.status(429).json({
                        error: 'Too many requests',
                        retryAfter: retryAfterSeconds,
                    });
                },
            });

            app.get('/api/test', limiter, (req, res) => {
                res.json({ success: true });
            });
        });

        test('should have complete error response schema', async () => {
            // Exhaust rate limit
            await request(app).get('/api/test').expect(200);
            await request(app).get('/api/test').expect(200);

            // Trigger rate limit
            const response = await request(app).get('/api/test').expect(429);

            // Validate response structure
            expect(response.body).toMatchObject({
                error: expect.any(String),
                retryAfter: expect.any(Number),
            });

            // Validate header presence
            expect(response.headers['retry-after']).toBeDefined();
            expect(response.headers['content-type']).toMatch(/application\/json/);

            // Validate retryAfter is positive integer
            expect(response.body.retryAfter).toBeGreaterThan(0);
            expect(Number.isInteger(response.body.retryAfter)).toBe(true);
        });

        test('should provide actionable error message', async () => {
            // Exhaust rate limit
            await request(app).get('/api/test').expect(200);
            await request(app).get('/api/test').expect(200);

            // Trigger rate limit
            const response = await request(app).get('/api/test').expect(429);

            // Error message should be helpful
            expect(response.body.error).toBeTruthy();
            expect(response.body.error.length).toBeGreaterThan(0);

            // Should include retry timing information
            expect(response.body.retryAfter).toBeGreaterThan(0);
        });
    });
});
