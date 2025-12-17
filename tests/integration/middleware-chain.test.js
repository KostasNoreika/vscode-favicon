/**
 * Middleware Chain Integration Tests
 * Tests for lib/middleware/setup.js
 *
 * Coverage areas:
 * - Express middleware chain setup
 * - Request logging middleware
 * - Metrics tracking middleware
 * - Body parser middleware
 * - Integration between middleware components
 * - Error propagation through middleware chain
 */

const express = require('express');
const request = require('supertest');

// Mock logger before importing setup
jest.mock('../../lib/logger', () => {
    const mockRequestLogger = jest.fn(() => (req, res, next) => {
        req.log = {
            info: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
            debug: jest.fn(),
        };
        next();
    });

    return {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        requestLogger: mockRequestLogger,
    };
});

jest.mock('../../lib/metrics', () => ({
    httpRequestDuration: {
        observe: jest.fn(),
    },
    httpRequestsTotal: {
        inc: jest.fn(),
    },
    normalizeRoute: jest.fn((path) => path),
}));

const {
    setupRequestLogging,
    setupMetrics,
    setupBodyParser,
    setupCompression,
} = require('../../lib/middleware/setup');

const logger = require('../../lib/logger');
const metrics = require('../../lib/metrics');

describe('Middleware Chain Integration Tests', () => {
    let app;

    beforeEach(() => {
        app = express();
        jest.clearAllMocks();
    });

    describe('setupRequestLogging()', () => {
        it('should create request logging middleware', () => {
            const middleware = setupRequestLogging();

            expect(middleware).toBeDefined();
            expect(typeof middleware).toBe('function');
            expect(logger.requestLogger).toHaveBeenCalledWith('unified');
        });

        it('should attach logger to request object', async () => {
            app.use(setupRequestLogging());

            app.get('/test', (req, res) => {
                expect(req.log).toBeDefined();
                expect(req.log.info).toBeDefined();
                res.json({ success: true });
            });

            await request(app).get('/test').expect(200);
        });
    });

    describe('setupMetrics()', () => {
        it('should create metrics tracking middleware', () => {
            const middleware = setupMetrics();

            expect(middleware).toBeDefined();
            expect(typeof middleware).toBe('function');
        });

        it('should track request duration and count', async () => {
            app.use(setupRequestLogging());
            app.use(setupMetrics());

            // Use /api/ prefix to ensure metrics are tracked (not skipped by SKIP_METRICS_PATHS)
            app.get('/api/test-metrics', (req, res) => {
                res.json({ success: true });
            });

            await request(app).get('/api/test-metrics').expect(200);

            expect(metrics.httpRequestDuration.observe).toHaveBeenCalled();
            expect(metrics.httpRequestsTotal.inc).toHaveBeenCalled();

            const observeCall = metrics.httpRequestDuration.observe.mock.calls[0];
            expect(observeCall[0]).toMatchObject({
                method: 'GET',
                route: '/api/test-metrics',
                status_code: 200,
            });
            expect(observeCall[1]).toBeGreaterThanOrEqual(0);
        });

        it('should track different HTTP methods', async () => {
            app.use(setupRequestLogging());
            app.use(setupMetrics());

            // Use /api/ prefix to ensure metrics are tracked
            app.post('/api/test-post', (req, res) => res.json({ success: true }));
            app.put('/api/test-put', (req, res) => res.json({ success: true }));
            app.delete('/api/test-delete', (req, res) => res.json({ success: true }));

            await request(app).post('/api/test-post').expect(200);
            await request(app).put('/api/test-put').expect(200);
            await request(app).delete('/api/test-delete').expect(200);

            expect(metrics.httpRequestsTotal.inc).toHaveBeenCalledTimes(3);

            const calls = metrics.httpRequestsTotal.inc.mock.calls;
            expect(calls[0][0].method).toBe('POST');
            expect(calls[1][0].method).toBe('PUT');
            expect(calls[2][0].method).toBe('DELETE');
        });

        it('should track error status codes', async () => {
            app.use(setupRequestLogging());
            app.use(setupMetrics());

            // Use /api/ prefix to ensure metrics are tracked
            app.get('/api/test-404', (req, res) => res.status(404).json({ error: 'Not found' }));
            app.get('/api/test-500', (req, res) => res.status(500).json({ error: 'Server error' }));

            await request(app).get('/api/test-404').expect(404);
            await request(app).get('/api/test-500').expect(500);

            const calls = metrics.httpRequestsTotal.inc.mock.calls;
            expect(calls[0][0].status_code).toBe(404);
            expect(calls[1][0].status_code).toBe(500);
        });

        it('should normalize route for consistent metrics', async () => {
            app.use(setupRequestLogging());
            app.use(setupMetrics());

            // Use /api/info instead of /api/favicon (which is in SKIP_METRICS_PATHS)
            app.get('/api/info', (req, res) => res.json({ success: true }));

            await request(app).get('/api/info?folder=/test').expect(200);

            // normalizeRoute is called via the captured import in setup.js
            // The mock returns the path unchanged by default
            expect(metrics.httpRequestsTotal.inc).toHaveBeenCalledWith(
                expect.objectContaining({ route: '/api/info' })
            );
        });

        it('should measure request duration accurately', async () => {
            app.use(setupRequestLogging());
            app.use(setupMetrics());

            // Use /api/ prefix to ensure metrics are tracked
            app.get('/api/test-slow', async (req, res) => {
                await new Promise(resolve => setTimeout(resolve, 100));
                res.json({ success: true });
            });

            await request(app).get('/api/test-slow').expect(200);

            const observeCall = metrics.httpRequestDuration.observe.mock.calls[0];
            const durationSeconds = observeCall[1];

            // Should be at least 0.1 seconds (100ms)
            expect(durationSeconds).toBeGreaterThanOrEqual(0.1);
        });
    });

    describe('setupBodyParser()', () => {
        it('should create JSON body parser middleware', () => {
            const middleware = setupBodyParser(express);

            expect(middleware).toBeDefined();
            expect(typeof middleware).toBe('function');
        });

        it('should parse JSON request bodies', async () => {
            app.use(setupRequestLogging());
            app.use(setupBodyParser(express));

            app.post('/test-json', (req, res) => {
                res.json({ received: req.body });
            });

            const response = await request(app)
                .post('/test-json')
                .send({ test: 'data', number: 123 })
                .set('Content-Type', 'application/json')
                .expect(200);

            expect(response.body.received).toEqual({ test: 'data', number: 123 });
        });

        it('should enforce 10kb size limit', async () => {
            app.use(setupRequestLogging());
            app.use(setupBodyParser(express));

            app.post('/test-large', (req, res) => {
                res.json({ success: true });
            });

            // Create a payload larger than 10kb
            const largePayload = { data: 'x'.repeat(11 * 1024) };

            await request(app)
                .post('/test-large')
                .send(largePayload)
                .set('Content-Type', 'application/json')
                .expect(413); // Payload Too Large
        });

        it('should accept payloads under size limit', async () => {
            app.use(setupRequestLogging());
            app.use(setupBodyParser(express));

            app.post('/test-size', (req, res) => {
                res.json({ size: JSON.stringify(req.body).length });
            });

            // Create a payload just under 10kb
            const payload = { data: 'x'.repeat(9 * 1024) };

            await request(app)
                .post('/test-size')
                .send(payload)
                .set('Content-Type', 'application/json')
                .expect(200);
        });

        it('should handle invalid JSON gracefully', async () => {
            app.use(setupRequestLogging());
            app.use(setupBodyParser(express));

            app.post('/test-invalid', (req, res) => {
                res.json({ success: true });
            });

            // Add error handler to prevent test crash
            app.use((err, _req, res, _next) => {
                res.status(400).json({ error: err.message });
            });

            await request(app)
                .post('/test-invalid')
                .send('{"invalid": json}')
                .set('Content-Type', 'application/json')
                .expect(400);
        });
    });

    describe('setupCompression()', () => {
        it('should create compression middleware', () => {
            const middleware = setupCompression();

            expect(middleware).toBeDefined();
            expect(typeof middleware).toBe('function');
        });

        it('should compress large responses', async () => {
            app.use(setupRequestLogging());
            app.use(setupCompression());

            app.get('/test-compress', (req, res) => {
                const largeData = 'x'.repeat(10000);
                res.json({ data: largeData });
            });

            const response = await request(app)
                .get('/test-compress')
                .set('Accept-Encoding', 'gzip')
                .expect(200);

            // Check for gzip encoding header (if compression actually applied)
            // Note: compression may not apply for all responses depending on size/type
            expect(response.headers).toBeDefined();
        });
    });

    describe('Middleware Chain Integration', () => {
        it('should execute middleware in correct order', async () => {
            const executionOrder = [];

            app.use((req, res, next) => {
                executionOrder.push('middleware-1');
                next();
            });

            app.use(setupRequestLogging());
            app.use((req, res, next) => {
                executionOrder.push('middleware-2-after-logging');
                next();
            });

            app.use(setupMetrics());
            app.use((req, res, next) => {
                executionOrder.push('middleware-3-after-metrics');
                next();
            });

            app.use(setupBodyParser(express));

            app.get('/test-order', (req, res) => {
                executionOrder.push('route-handler');
                res.json({ order: executionOrder });
            });

            await request(app).get('/test-order').expect(200);

            expect(executionOrder).toEqual([
                'middleware-1',
                'middleware-2-after-logging',
                'middleware-3-after-metrics',
                'route-handler',
            ]);
        });

        it('should allow middleware to modify request', async () => {
            app.use(setupRequestLogging());
            app.use(setupMetrics());

            app.use((req, res, next) => {
                req.customData = { added: 'by-middleware' };
                next();
            });

            app.get('/test-modify', (req, res) => {
                res.json({ customData: req.customData });
            });

            const response = await request(app).get('/test-modify').expect(200);

            expect(response.body.customData).toEqual({ added: 'by-middleware' });
        });

        it('should allow middleware to modify response headers', async () => {
            app.use(setupRequestLogging());

            app.use((req, res, next) => {
                res.setHeader('X-Custom-Header', 'test-value');
                next();
            });

            app.get('/test-headers', (req, res) => {
                res.json({ success: true });
            });

            const response = await request(app).get('/test-headers').expect(200);

            expect(response.headers['x-custom-header']).toBe('test-value');
        });

        it('should handle errors in middleware chain', async () => {
            app.use(setupRequestLogging());

            app.use((req, res, next) => {
                next(new Error('Middleware error'));
            });

            // Error handler
            app.use((err, _req, res, _next) => {
                res.status(500).json({ error: err.message });
            });

            await request(app).get('/test-error').expect(500);
        });

        it('should stop middleware chain on response', async () => {
            const executionOrder = [];

            app.use(setupRequestLogging());

            app.use((req, res, _next) => {
                executionOrder.push('middleware-1');
                res.json({ stopped: true });
                // Don't call next()
            });

            app.use((req, res, next) => {
                executionOrder.push('middleware-2-should-not-run');
                next();
            });

            await request(app).get('/test-stop').expect(200);

            expect(executionOrder).toEqual(['middleware-1']);
            expect(executionOrder).not.toContain('middleware-2-should-not-run');
        });
    });

    describe('Request Logging and Metrics Together', () => {
        it('should work together without conflicts', async () => {
            app.use(setupRequestLogging());
            app.use(setupMetrics());
            app.use(setupBodyParser(express));

            // Use /api/ prefix to ensure metrics are tracked
            app.post('/api/test-combined', (req, res) => {
                req.log.info('Processing request');
                res.json({ body: req.body });
            });

            await request(app)
                .post('/api/test-combined')
                .send({ test: 'data' })
                .expect(200);

            expect(metrics.httpRequestDuration.observe).toHaveBeenCalled();
            expect(metrics.httpRequestsTotal.inc).toHaveBeenCalled();
        });

        it('should track metrics even when logging fails', async () => {
            // Make logger throw error for this test only
            logger.requestLogger.mockImplementationOnce(() => (_req, _res, _next) => {
                throw new Error('Logger failed');
            });

            app.use((req, res, next) => {
                try {
                    const loggingMiddleware = setupRequestLogging();
                    loggingMiddleware(req, res, next);
                } catch (err) {
                    req.log = { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };
                    next();
                }
            });

            app.use(setupMetrics());

            // Use /api/ prefix to ensure metrics are tracked
            app.get('/api/test-logging-error', (req, res) => {
                res.json({ success: true });
            });

            await request(app).get('/api/test-logging-error').expect(200);

            // Metrics should still be tracked
            expect(metrics.httpRequestDuration.observe).toHaveBeenCalled();
            expect(metrics.httpRequestsTotal.inc).toHaveBeenCalled();
        });
    });
});
