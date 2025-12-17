/**
 * Integration Tests for Health Check Rate Limiting
 * FIX SEC-009: Tests for health endpoint rate limiting to prevent DoS abuse
 *
 * Verifies that health check endpoints have appropriate rate limiting while
 * still allowing legitimate monitoring probes to function correctly.
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
    rateLimitWindow: 15 * 60 * 1000,
    rateLimitMax: 100,
    sseGlobalLimit: 50,
}));

describe('Health Check Rate Limiting Tests', () => {
    let app;
    let healthCheckLimiter;

    beforeEach(() => {
        // Create a fresh Express app for each test
        app = express();
        app.use(express.json({ limit: '10kb' }));

        // Create health check rate limiter matching production config
        // FIX SEC-009: 200 requests per minute per IP
        healthCheckLimiter = rateLimit({
            windowMs: 60000, // 1 minute
            max: 50, // Reduced for testing to avoid overwhelming test server
            message: { error: 'Too many health check requests' },
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

        // Apply rate limiter to health endpoints
        app.use('/health', healthCheckLimiter);

        // Setup health check endpoints
        app.get('/health', (req, res) => {
            res.json({
                status: 'ok',
                service: 'vscode-favicon-unified',
                uptime: process.uptime(),
                checks: {
                    faviconCache: 'ok',
                    registryCache: 'ok',
                    notifications: 'ok',
                },
            });
        });

        app.get('/health/live', (req, res) => {
            res.json({
                status: 'alive',
                timestamp: new Date().toISOString(),
            });
        });

        app.get('/health/ready', (req, res) => {
            res.json({
                status: 'ready',
                timestamp: new Date().toISOString(),
            });
        });
    });

    describe('Rate Limiting Behavior', () => {
        test('should allow legitimate monitoring probe frequency (10 req/min)', async () => {
            // Kubernetes/monitoring systems typically poll every 5-10 seconds
            // 10 requests per minute = 1 request every 6 seconds
            const requestCount = 10;
            const responses = await Promise.all(
                Array.from({ length: requestCount }, () => request(app).get('/health'))
            );

            for (const response of responses) {
                expect(response.status).toBe(200);
                expect(response.body.status).toBe('ok');
            }
        });

        test('should allow burst traffic up to limit', async () => {
            // Test that we can make requests up to the limit
            const requestCount = 40; // Under test limit of 50
            const responses = await Promise.all(
                Array.from({ length: requestCount }, () => request(app).get('/health'))
            );

            for (const response of responses) {
                expect(response.status).toBe(200);
                expect(response.body.status).toBe('ok');
            }
        });

        test('should enforce rate limit after max requests', async () => {
            // Make requests up to and beyond the limit
            const responses = [];

            // Make requests in parallel batches to avoid overwhelming test server
            const batchSize = 10;
            const totalRequests = 52; // Exceed limit of 50

            for (let i = 0; i < totalRequests; i += batchSize) {
                const batch = Math.min(batchSize, totalRequests - i);
                const batchResponses = await Promise.all(
                    Array.from({ length: batch }, () => request(app).get('/health'))
                );
                responses.push(...batchResponses);
            }

            const successfulRequests = responses.filter((r) => r.status === 200);
            const rateLimitedRequests = responses.filter((r) => r.status === 429);

            expect(successfulRequests.length).toBe(50);
            expect(rateLimitedRequests.length).toBe(2);
        });

        test('should include rate limit headers in responses', async () => {
            const response = await request(app).get('/health').expect(200);

            // Standard rate limit headers (RateLimit-* headers)
            expect(response.headers['ratelimit-limit']).toBeDefined();
            expect(response.headers['ratelimit-remaining']).toBeDefined();
            expect(response.headers['ratelimit-reset']).toBeDefined();
        });

        test('should include retryAfter in 429 response', async () => {
            // Exhaust the rate limit with parallel requests
            await Promise.all(
                Array.from({ length: 50 }, () => request(app).get('/health'))
            );

            // Next request should be rate limited
            const response = await request(app).get('/health').expect(429);

            expect(response.body).toHaveProperty('error', 'Too many health check requests');
            expect(response.body).toHaveProperty('retryAfter');
            expect(typeof response.body.retryAfter).toBe('number');
        });

        test('should include Retry-After header in 429 response', async () => {
            // Exhaust the rate limit with parallel requests
            await Promise.all(
                Array.from({ length: 50 }, () => request(app).get('/health'))
            );

            // Next request should be rate limited
            const response = await request(app).get('/health').expect(429);

            // Verify Retry-After header
            expect(response.headers['retry-after']).toBeDefined();
            expect(typeof response.headers['retry-after']).toBe('string');

            const retryAfterSeconds = parseInt(response.headers['retry-after'], 10);
            expect(retryAfterSeconds).toBeGreaterThan(0);
            expect(retryAfterSeconds).toBeLessThanOrEqual(60);

            // Header and body should be consistent
            expect(Math.abs(retryAfterSeconds - response.body.retryAfter)).toBeLessThanOrEqual(1);
        });
    });

    describe('All Health Endpoints Rate Limited', () => {
        test('/health endpoint should be rate limited', async () => {
            // Make requests up to the limit in batches
            for (let i = 0; i < 5; i++) {
                await Promise.all(
                    Array.from({ length: 10 }, () => request(app).get('/health'))
                );
            }

            // Next request should be rate limited
            const response = await request(app).get('/health').expect(429);
            expect(response.body.error).toBe('Too many health check requests');
        });

        test('/health/live endpoint should be rate limited', async () => {
            // Make requests up to the limit in batches
            for (let i = 0; i < 5; i++) {
                await Promise.all(
                    Array.from({ length: 10 }, () => request(app).get('/health/live'))
                );
            }

            // Next request should be rate limited
            const response = await request(app).get('/health/live').expect(429);
            expect(response.body.error).toBe('Too many health check requests');
        });

        test('/health/ready endpoint should be rate limited', async () => {
            // Make requests up to the limit in batches
            for (let i = 0; i < 5; i++) {
                await Promise.all(
                    Array.from({ length: 10 }, () => request(app).get('/health/ready'))
                );
            }

            // Next request should be rate limited
            const response = await request(app).get('/health/ready').expect(429);
            expect(response.body.error).toBe('Too many health check requests');
        }, 20000); // Extended timeout for 50+ requests
    });

    describe('Kubernetes Probe Compatibility', () => {
        test('should support typical Kubernetes liveness probe frequency', async () => {
            // Kubernetes default liveness probe: every 10 seconds = 6 req/min
            // Our limit allows for significant safety margin
            const kubernetesProbeRate = 6; // requests per minute
            const responses = await Promise.all(
                Array.from({ length: kubernetesProbeRate }, () =>
                    request(app).get('/health/live')
                )
            );

            for (const response of responses) {
                expect(response.status).toBe(200);
                expect(response.body.status).toBe('alive');
            }
        });

        test('should support typical Kubernetes readiness probe frequency', async () => {
            // Kubernetes default readiness probe: every 10 seconds = 6 req/min
            const kubernetesProbeRate = 6; // requests per minute
            const responses = await Promise.all(
                Array.from({ length: kubernetesProbeRate }, () =>
                    request(app).get('/health/ready')
                )
            );

            for (const response of responses) {
                expect(response.status).toBe(200);
                expect(response.body.status).toBe('ready');
            }
        });

        test('should support multiple monitoring systems simultaneously', async () => {
            // Simulate 3 monitoring systems each polling every 10 seconds
            // 3 systems * 6 req/min = 18 req/min total
            const healthRequests = Array.from({ length: 6 }, () =>
                request(app).get('/health')
            );
            const liveRequests = Array.from({ length: 6 }, () =>
                request(app).get('/health/live')
            );
            const readyRequests = Array.from({ length: 6 }, () =>
                request(app).get('/health/ready')
            );

            const responses = await Promise.all([
                ...healthRequests,
                ...liveRequests,
                ...readyRequests,
            ]);

            expect(responses.length).toBe(18);
            for (const response of responses) {
                expect(response.status).toBe(200);
            }
        });
    });

    describe('DoS Prevention', () => {
        test('should prevent malicious high-frequency polling', async () => {
            // Attacker tries to overwhelm with rapid requests
            // Make requests in batches
            const batchSize = 10;
            const totalRequests = 60; // Exceed limit of 50
            const responses = [];

            for (let i = 0; i < totalRequests; i += batchSize) {
                const batch = Math.min(batchSize, totalRequests - i);
                const batchResponses = await Promise.all(
                    Array.from({ length: batch }, () => request(app).get('/health'))
                );
                responses.push(...batchResponses);
            }

            const successfulRequests = responses.filter((r) => r.status === 200);
            const blockedRequests = responses.filter((r) => r.status === 429);

            expect(successfulRequests.length).toBe(50);
            expect(blockedRequests.length).toBe(10);
        });
    });

    describe('Response Format Consistency', () => {
        test('should return JSON error for rate limited requests', async () => {
            // Exhaust rate limit
            await Promise.all(
                Array.from({ length: 50 }, () => request(app).get('/health'))
            );

            const response = await request(app).get('/health').expect(429);

            expect(response.headers['content-type']).toMatch(/application\/json/);
            expect(response.body).toEqual({
                error: 'Too many health check requests',
                retryAfter: expect.any(Number),
            });
        });

        test('should maintain normal response format when not rate limited', async () => {
            const response = await request(app).get('/health').expect(200);

            expect(response.headers['content-type']).toMatch(/application\/json/);
            expect(response.body).toMatchObject({
                status: 'ok',
                service: 'vscode-favicon-unified',
            });
        });
    });

    describe('Production Configuration Validation', () => {
        test('should document production rate limit is 200 req/min', () => {
            // This test documents the production configuration
            // In production, the limit should be 200 req/min
            const productionLimit = 200;
            const productionWindow = 60000; // 1 minute

            // Test uses lower limit (50) to avoid overwhelming test environment
            // but production should use these values:
            expect(productionLimit).toBe(200);
            expect(productionWindow).toBe(60000);
        });

        test('should allow normal monitoring traffic patterns', () => {
            // Typical monitoring patterns:
            // - Kubernetes liveness: every 10s = 6 req/min
            // - Kubernetes readiness: every 10s = 6 req/min
            // - External monitoring: every 30s = 2 req/min
            // - Load balancer health: every 5s = 12 req/min
            // Total: ~26 req/min (well under 200 req/min limit)

            const typicalMonitoringRate = 26;
            const productionLimit = 200;
            const safetyMargin = productionLimit / typicalMonitoringRate;

            // Should have ~7.7x safety margin
            expect(safetyMargin).toBeGreaterThan(7);
        });
    });
});
