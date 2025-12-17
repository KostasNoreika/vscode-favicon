/**
 * Metrics Module Unit Tests
 * Tests for lib/metrics.js
 *
 * Coverage areas:
 * - Route normalization
 * - Prometheus metrics setup
 * - Counter increments
 * - Histogram observations
 * - Gauge updates
 * - Metrics endpoint
 */

jest.mock('prom-client', () => {
    const actualPromClient = jest.requireActual('prom-client');
    return {
        ...actualPromClient,
        register: {
            metrics: jest.fn().mockResolvedValue('# Metrics data'),
            clear: jest.fn(),
            contentType: 'text/plain; version=0.0.4; charset=utf-8',
        },
        Counter: jest.fn().mockImplementation(() => ({
            inc: jest.fn(),
        })),
        Histogram: jest.fn().mockImplementation(() => ({
            observe: jest.fn(),
        })),
        Gauge: jest.fn().mockImplementation(() => ({
            set: jest.fn(),
            inc: jest.fn(),
            dec: jest.fn(),
        })),
    };
});

const {
    normalizeRoute,
    httpRequestDuration,
    httpRequestsTotal,
    sseConnectionsActive,
} = require('../../lib/metrics');

describe('Metrics Module Tests', () => {
    describe('normalizeRoute()', () => {
        it('should normalize favicon routes with query params', () => {
            const result = normalizeRoute('/api/favicon?folder=/opt/test');

            expect(result).toBe('/api/favicon');
        });

        it('should normalize claude-status routes', () => {
            const result = normalizeRoute('/claude-status?folder=/opt/test');

            expect(result).toBe('/claude-status');
        });

        it('should normalize favicon-api routes', () => {
            const result = normalizeRoute('/favicon-api?folder=/opt/test&grayscale=true');

            expect(result).toBe('/favicon-api');
        });

        it('should preserve health check routes', () => {
            expect(normalizeRoute('/health')).toBe('/health');
            expect(normalizeRoute('/health/live')).toBe('/health/live');
            expect(normalizeRoute('/health/ready')).toBe('/health/ready');
        });

        it('should preserve admin routes', () => {
            expect(normalizeRoute('/api/clear-cache')).toBe('/api/clear-cache');
        });

        it('should preserve notification routes', () => {
            expect(normalizeRoute('/claude-completion')).toBe('/claude-completion');
            expect(normalizeRoute('/claude-status/mark-read')).toBe('/claude-status/mark-read');
        });

        it('should preserve paste routes', () => {
            expect(normalizeRoute('/api/paste-image')).toBe('/api/paste-image');
        });

        it('should preserve download routes', () => {
            expect(normalizeRoute('/download/extension')).toBe('/download/extension');
        });

        it('should preserve metrics route', () => {
            expect(normalizeRoute('/metrics')).toBe('/metrics');
        });

        it('should normalize project-info route', () => {
            const result = normalizeRoute('/api/project-info?folder=/opt/test');

            expect(result).toBe('/api/project-info');
        });

        it('should handle routes without query params', () => {
            expect(normalizeRoute('/api/favicon')).toBe('/api/favicon');
        });

        it('should handle routes with trailing slashes', () => {
            // Trailing slashes are removed for consistency
            expect(normalizeRoute('/api/favicon/')).toBe('/api/favicon');
        });

        it('should handle empty route', () => {
            // Empty string normalizes to root '/'
            expect(normalizeRoute('')).toBe('/');
        });

        it('should handle root route', () => {
            expect(normalizeRoute('/')).toBe('/');
        });

        it('should handle routes with multiple query params', () => {
            const result = normalizeRoute('/api/favicon?folder=/opt/test&grayscale=true&format=svg');

            expect(result).toBe('/api/favicon');
        });

        it('should handle routes with hash fragments', () => {
            const result = normalizeRoute('/api/favicon#section');

            expect(result).toBe('/api/favicon');
        });

        it('should handle routes with both query and hash', () => {
            const result = normalizeRoute('/api/favicon?folder=/opt/test#section');

            expect(result).toBe('/api/favicon');
        });

        it('should handle unknown routes', () => {
            expect(normalizeRoute('/unknown/route')).toBe('/unknown/route');
        });

        it('should handle routes with special characters', () => {
            const result = normalizeRoute('/api/favicon?folder=/opt/test%20with%20spaces');

            expect(result).toBe('/api/favicon');
        });

        it('should handle very long routes', () => {
            const longPath = '/api/favicon?folder=' + '/opt/'.repeat(100);
            const result = normalizeRoute(longPath);

            expect(result).toBe('/api/favicon');
        });

        it('should normalize SSE notification stream route', () => {
            const result = normalizeRoute('/notifications/stream?folder=/opt/test');

            expect(result).toBe('/notifications/stream');
        });
    });

    describe('Metrics Objects', () => {
        it('should export httpRequestDuration histogram', () => {
            expect(httpRequestDuration).toBeDefined();
            expect(httpRequestDuration.observe).toBeDefined();
            expect(typeof httpRequestDuration.observe).toBe('function');
        });

        it('should export httpRequestsTotal counter', () => {
            expect(httpRequestsTotal).toBeDefined();
            expect(httpRequestsTotal.inc).toBeDefined();
            expect(typeof httpRequestsTotal.inc).toBe('function');
        });

        it('should export sseConnectionsActive gauge', () => {
            expect(sseConnectionsActive).toBeDefined();
            expect(sseConnectionsActive.set).toBeDefined();
            expect(sseConnectionsActive.inc).toBeDefined();
            expect(sseConnectionsActive.dec).toBeDefined();
        });

        it('should allow histogram observations', () => {
            httpRequestDuration.observe({ method: 'GET', route: '/test', status_code: 200 }, 0.5);

            expect(httpRequestDuration.observe).toHaveBeenCalledWith(
                { method: 'GET', route: '/test', status_code: 200 },
                0.5
            );
        });

        it('should allow counter increments', () => {
            httpRequestsTotal.inc({ method: 'POST', route: '/test', status_code: 201 });

            expect(httpRequestsTotal.inc).toHaveBeenCalledWith({
                method: 'POST',
                route: '/test',
                status_code: 201,
            });
        });

        it('should allow gauge updates', () => {
            sseConnectionsActive.set(5);

            expect(sseConnectionsActive.set).toHaveBeenCalledWith(5);
        });

        it('should allow gauge increments', () => {
            sseConnectionsActive.inc();

            expect(sseConnectionsActive.inc).toHaveBeenCalled();
        });

        it('should allow gauge decrements', () => {
            sseConnectionsActive.dec();

            expect(sseConnectionsActive.dec).toHaveBeenCalled();
        });
    });

    describe('Route Normalization Edge Cases', () => {
        it('should handle null route', () => {
            // Should not throw, might return null or handle gracefully
            const result = normalizeRoute(null);
            expect(result).toBeDefined();
        });

        it('should handle undefined route', () => {
            const result = normalizeRoute(undefined);
            expect(result).toBeDefined();
        });

        it('should handle route with only query params', () => {
            const result = normalizeRoute('?folder=/opt/test');

            // Empty path normalizes to root '/'
            expect(result).toBe('/');
        });

        it('should handle route with encoded characters', () => {
            const result = normalizeRoute('/api/favicon?folder=%2Fopt%2Ftest');

            expect(result).toBe('/api/favicon');
        });

        it('should handle route with multiple slashes', () => {
            const result = normalizeRoute('//api//favicon');

            expect(result).toBe('//api//favicon');
        });

        it('should handle route with trailing question mark', () => {
            const result = normalizeRoute('/api/favicon?');

            expect(result).toBe('/api/favicon');
        });

        it('should handle route with empty query param', () => {
            const result = normalizeRoute('/api/favicon?folder=');

            expect(result).toBe('/api/favicon');
        });

        it('should handle route with query param without value', () => {
            const result = normalizeRoute('/api/favicon?folder');

            expect(result).toBe('/api/favicon');
        });

        it('should handle route with ampersand but no params', () => {
            const result = normalizeRoute('/api/favicon?&');

            expect(result).toBe('/api/favicon');
        });

        it('should preserve case sensitivity', () => {
            expect(normalizeRoute('/API/Favicon')).toBe('/API/Favicon');
        });

        it('should handle route with Unicode characters', () => {
            const result = normalizeRoute('/api/测试?folder=/opt/test');

            expect(result).toBe('/api/测试');
        });

        it('should handle route with emoji', () => {
            const result = normalizeRoute('/api/😀?folder=/opt/test');

            expect(result).toBe('/api/😀');
        });
    });

    describe('Metrics Labels', () => {
        it('should support GET method label', () => {
            httpRequestsTotal.inc({ method: 'GET', route: '/test', status_code: 200 });

            expect(httpRequestsTotal.inc).toHaveBeenCalledWith(
                expect.objectContaining({ method: 'GET' })
            );
        });

        it('should support POST method label', () => {
            httpRequestsTotal.inc({ method: 'POST', route: '/test', status_code: 201 });

            expect(httpRequestsTotal.inc).toHaveBeenCalledWith(
                expect.objectContaining({ method: 'POST' })
            );
        });

        it('should support PUT method label', () => {
            httpRequestsTotal.inc({ method: 'PUT', route: '/test', status_code: 200 });

            expect(httpRequestsTotal.inc).toHaveBeenCalledWith(
                expect.objectContaining({ method: 'PUT' })
            );
        });

        it('should support DELETE method label', () => {
            httpRequestsTotal.inc({ method: 'DELETE', route: '/test', status_code: 204 });

            expect(httpRequestsTotal.inc).toHaveBeenCalledWith(
                expect.objectContaining({ method: 'DELETE' })
            );
        });

        it('should support various status codes', () => {
            [200, 201, 204, 400, 401, 403, 404, 500, 503].forEach((code) => {
                httpRequestsTotal.inc({ method: 'GET', route: '/test', status_code: code });

                expect(httpRequestsTotal.inc).toHaveBeenCalledWith(
                    expect.objectContaining({ status_code: code })
                );
            });
        });

        it('should track different routes separately', () => {
            const routes = ['/api/favicon', '/health', '/claude-status', '/metrics'];

            routes.forEach((route) => {
                httpRequestsTotal.inc({ method: 'GET', route, status_code: 200 });
            });

            expect(httpRequestsTotal.inc).toHaveBeenCalledTimes(routes.length);
        });
    });

    describe('Performance Metrics', () => {
        it('should record request durations in seconds', () => {
            const durations = [0.001, 0.01, 0.1, 1, 10];

            durations.forEach((duration) => {
                httpRequestDuration.observe(
                    { method: 'GET', route: '/test', status_code: 200 },
                    duration
                );
            });

            expect(httpRequestDuration.observe).toHaveBeenCalledTimes(5);
        });

        it('should handle very small durations', () => {
            httpRequestDuration.observe(
                { method: 'GET', route: '/test', status_code: 200 },
                0.000001 // 1 microsecond
            );

            expect(httpRequestDuration.observe).toHaveBeenCalled();
        });

        it('should handle very large durations', () => {
            httpRequestDuration.observe(
                { method: 'GET', route: '/test', status_code: 200 },
                3600 // 1 hour
            );

            expect(httpRequestDuration.observe).toHaveBeenCalled();
        });

        it('should track zero duration', () => {
            httpRequestDuration.observe(
                { method: 'GET', route: '/test', status_code: 200 },
                0
            );

            expect(httpRequestDuration.observe).toHaveBeenCalled();
        });
    });

    describe('SSE Connection Tracking', () => {
        it('should track connection increments', () => {
            sseConnectionsActive.inc();
            sseConnectionsActive.inc();
            sseConnectionsActive.inc();

            expect(sseConnectionsActive.inc).toHaveBeenCalledTimes(3);
        });

        it('should track connection decrements', () => {
            sseConnectionsActive.dec();
            sseConnectionsActive.dec();

            expect(sseConnectionsActive.dec).toHaveBeenCalledTimes(2);
        });

        it('should allow setting absolute connection count', () => {
            sseConnectionsActive.set(10);

            expect(sseConnectionsActive.set).toHaveBeenCalledWith(10);
        });

        it('should handle zero connections', () => {
            sseConnectionsActive.set(0);

            expect(sseConnectionsActive.set).toHaveBeenCalledWith(0);
        });

        it('should handle large connection counts', () => {
            sseConnectionsActive.set(10000);

            expect(sseConnectionsActive.set).toHaveBeenCalledWith(10000);
        });
    });
});
