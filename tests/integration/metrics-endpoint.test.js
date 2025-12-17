/**
 * Integration Tests for Prometheus Metrics Endpoint
 *
 * Tests the /metrics endpoint to ensure it returns valid Prometheus
 * exposition format with all expected metrics.
 *
 * Verifies:
 * - Endpoint returns 200 OK with correct content type
 * - Custom metrics are present (HTTP, cache, SSE)
 * - Default metrics are present (process, Node.js)
 * - Metrics format follows Prometheus standards
 * - Metrics are updated correctly based on application behavior
 */

const request = require('supertest');
const express = require('express');
const path = require('path');

// Mock the server configuration
jest.mock('../../lib/config', () => ({
    allowedPaths: ['/opt/dev', '/opt/prod'],
    registryPath: path.join(__dirname, '../fixtures/mock-registry.json'),
    dataDir: path.join(__dirname, '../fixtures'),
    servicePort: 3000,
    nodeEnv: 'test',
}));

describe('Prometheus Metrics Endpoint Integration Tests', () => {
    let app;
    let metrics;
    let metricsRoutes;

    beforeEach(() => {
        // Clear all metrics before each test
        jest.resetModules();

        // Create fresh instances
        metrics = require('../../lib/metrics');
        const { createMetricsRoutes } = require('../../lib/routes/metrics-routes');
        const { setupMetrics } = require('../../lib/middleware/setup');

        // Clear the registry and re-register metrics
        metrics.register.clear();
        const client = require('prom-client');
        client.collectDefaultMetrics({ register: metrics.register });

        // Re-register custom metrics
        metrics.register.registerMetric(metrics.httpRequestDuration);
        metrics.register.registerMetric(metrics.httpRequestsTotal);
        metrics.register.registerMetric(metrics.faviconCacheHitsTotal);
        metrics.register.registerMetric(metrics.faviconCacheMissesTotal);
        metrics.register.registerMetric(metrics.sseConnectionsActive);

        // Create a fresh Express app for each test
        app = express();
        app.use(express.json({ limit: '10kb' }));

        // Apply metrics middleware
        app.use(setupMetrics());

        // Setup test routes to generate metrics
        // Use /api/ prefix to ensure metrics are collected (see SKIP_METRICS_PATHS in setup.js)
        app.get('/api/test-endpoint', (req, res) => {
            res.json({ message: 'test' });
        });

        app.get('/api/test-error', (req, res) => {
            res.status(500).json({ error: 'test error' });
        });

        // Mount metrics routes
        metricsRoutes = createMetricsRoutes();
        app.use(metricsRoutes);
    });

    afterEach(() => {
        // Clean up
        if (metrics && metrics.register) {
            metrics.register.clear();
        }
    });

    describe('Basic Endpoint Functionality', () => {
        it('should return 200 OK for /metrics endpoint', async () => {
            const response = await request(app).get('/metrics');

            expect(response.status).toBe(200);
        });

        it('should return correct content type for Prometheus', async () => {
            const response = await request(app).get('/metrics');

            expect(response.headers['content-type']).toMatch(/^text\/plain/);
            expect(response.headers['content-type']).toContain('version=0.0.4');
        });

        it('should return text content', async () => {
            const response = await request(app).get('/metrics');

            expect(typeof response.text).toBe('string');
            expect(response.text.length).toBeGreaterThan(0);
        });
    });

    describe('Custom Metrics Presence', () => {
        it('should include http_request_duration_seconds histogram', async () => {
            const response = await request(app).get('/metrics');

            expect(response.text).toContain('# HELP http_request_duration_seconds');
            expect(response.text).toContain('# TYPE http_request_duration_seconds histogram');
        });

        it('should include http_requests_total counter', async () => {
            const response = await request(app).get('/metrics');

            expect(response.text).toContain('# HELP http_requests_total');
            expect(response.text).toContain('# TYPE http_requests_total counter');
        });

        it('should include favicon_cache_hits_total counter', async () => {
            const response = await request(app).get('/metrics');

            expect(response.text).toContain('# HELP favicon_cache_hits_total');
            expect(response.text).toContain('# TYPE favicon_cache_hits_total counter');
        });

        it('should include favicon_cache_misses_total counter', async () => {
            const response = await request(app).get('/metrics');

            expect(response.text).toContain('# HELP favicon_cache_misses_total');
            expect(response.text).toContain('# TYPE favicon_cache_misses_total counter');
        });

        it('should include sse_connections_active gauge', async () => {
            const response = await request(app).get('/metrics');

            expect(response.text).toContain('# HELP sse_connections_active');
            expect(response.text).toContain('# TYPE sse_connections_active gauge');
        });
    });

    describe('Default Metrics Presence', () => {
        it('should include process_cpu_user_seconds_total', async () => {
            const response = await request(app).get('/metrics');

            expect(response.text).toContain('process_cpu_user_seconds_total');
        });

        it('should include process_resident_memory_bytes', async () => {
            const response = await request(app).get('/metrics');

            expect(response.text).toContain('process_resident_memory_bytes');
        });

        it('should include nodejs_heap_size_total_bytes', async () => {
            const response = await request(app).get('/metrics');

            expect(response.text).toContain('nodejs_heap_size_total_bytes');
        });
    });

    describe('Metrics Updates from HTTP Requests', () => {
        it('should track successful HTTP requests', async () => {
            // Make a test request (use /api/ prefix to ensure metrics are tracked)
            await request(app).get('/api/test-endpoint');

            // Get metrics
            const response = await request(app).get('/metrics');

            // Verify request was tracked with status 200
            expect(response.text).toMatch(/http_requests_total\{.*status_code="200".*\}\s+\d+/);
        });

        it('should track failed HTTP requests', async () => {
            // Make a failing request
            await request(app).get('/api/test-error');

            // Get metrics
            const response = await request(app).get('/metrics');

            // Verify request was tracked with status 500
            expect(response.text).toMatch(/http_requests_total\{.*status_code="500".*\}\s+\d+/);
        });

        it('should track request duration with histogram buckets', async () => {
            // Make a test request
            await request(app).get('/api/test-endpoint');

            // Get metrics
            const response = await request(app).get('/metrics');

            // Verify histogram has buckets
            expect(response.text).toContain('http_request_duration_seconds_bucket{');
            expect(response.text).toContain('http_request_duration_seconds_sum');
            expect(response.text).toContain('http_request_duration_seconds_count');
        });

        it('should include method and route labels in HTTP metrics', async () => {
            // Make a test request
            await request(app).get('/api/test-endpoint');

            // Get metrics
            const response = await request(app).get('/metrics');

            // Verify labels are present
            expect(response.text).toMatch(/http_requests_total\{.*method="GET".*\}/);
            expect(response.text).toMatch(/http_requests_total\{.*route="\/api\/test-endpoint".*\}/);
        });
    });

    describe('Cache Metrics Updates', () => {
        it('should track cache hits', async () => {
            // Simulate cache hit
            metrics.faviconCacheHitsTotal.inc();

            // Get metrics
            const response = await request(app).get('/metrics');

            // Verify cache hit was tracked
            expect(response.text).toMatch(/favicon_cache_hits_total\s+1/);
        });

        it('should track cache misses', async () => {
            // Simulate cache miss
            metrics.faviconCacheMissesTotal.inc();

            // Get metrics
            const response = await request(app).get('/metrics');

            // Verify cache miss was tracked
            expect(response.text).toMatch(/favicon_cache_misses_total\s+1/);
        });

        it('should track multiple cache operations', async () => {
            // Simulate multiple cache operations
            metrics.faviconCacheHitsTotal.inc();
            metrics.faviconCacheHitsTotal.inc();
            metrics.faviconCacheMissesTotal.inc();

            // Get metrics
            const response = await request(app).get('/metrics');

            // Verify counts
            expect(response.text).toMatch(/favicon_cache_hits_total\s+2/);
            expect(response.text).toMatch(/favicon_cache_misses_total\s+1/);
        });
    });

    describe('SSE Connection Metrics Updates', () => {
        it('should track active SSE connections', async () => {
            // Simulate SSE connections
            metrics.sseConnectionsActive.set(5);

            // Get metrics
            const response = await request(app).get('/metrics');

            // Verify SSE connections tracked
            expect(response.text).toMatch(/sse_connections_active\s+5/);
        });

        it('should update SSE connections gauge', async () => {
            // Set initial value
            metrics.sseConnectionsActive.set(3);

            // Get first reading
            let response = await request(app).get('/metrics');
            expect(response.text).toMatch(/sse_connections_active\s+3/);

            // Update value
            metrics.sseConnectionsActive.set(7);

            // Get second reading
            response = await request(app).get('/metrics');
            expect(response.text).toMatch(/sse_connections_active\s+7/);
        });

        it('should handle zero SSE connections', async () => {
            // Set to zero
            metrics.sseConnectionsActive.set(0);

            // Get metrics
            const response = await request(app).get('/metrics');

            // Verify zero connections
            expect(response.text).toMatch(/sse_connections_active\s+0/);
        });
    });

    describe('Metrics Format Validation', () => {
        it('should follow Prometheus exposition format', async () => {
            const response = await request(app).get('/metrics');

            // Each metric should have HELP and TYPE comments
            const metricNames = [
                'http_request_duration_seconds',
                'http_requests_total',
                'favicon_cache_hits_total',
                'favicon_cache_misses_total',
                'sse_connections_active',
            ];

            metricNames.forEach((metricName) => {
                expect(response.text).toContain(`# HELP ${metricName}`);
                expect(response.text).toContain(`# TYPE ${metricName}`);
            });
        });

        it('should not include any JSON in the response', async () => {
            const response = await request(app).get('/metrics');

            // Response should not be JSON
            expect(() => JSON.parse(response.text)).toThrow();
        });
    });

    describe('Error Handling', () => {
        it('should handle metrics generation errors gracefully', async () => {
            // Force an error by making the registry fail
            const originalMetrics = metrics.register.metrics;
            metrics.register.metrics = async () => {
                throw new Error('Test error');
            };

            const response = await request(app).get('/metrics');

            // Should return 500 error with standardized format
            expect(response.status).toBe(500);
            expect(response.body).toEqual({
                error: true,
                code: 'INTERNAL_ERROR',
                message: 'Failed to generate metrics',
            });

            // Restore
            metrics.register.metrics = originalMetrics;
        });
    });
});
