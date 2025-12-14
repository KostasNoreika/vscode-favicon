/**
 * Prometheus Metrics Module
 *
 * Centralized metrics definitions for observability and monitoring.
 * Provides standardized Prometheus metrics for:
 * - HTTP request performance (histogram)
 * - HTTP request counts by status code (counter)
 * - Favicon cache efficiency (counters)
 * - SSE connection tracking (gauge)
 *
 * Usage:
 *   const metrics = require('./lib/metrics');
 *   metrics.httpRequestDuration.observe({ method: 'GET', route: '/api/favicon', status_code: 200 }, 0.123);
 *   metrics.httpRequestsTotal.inc({ method: 'GET', route: '/api/favicon', status_code: 200 });
 *   metrics.faviconCacheHitsTotal.inc();
 *   metrics.sseConnectionsActive.set(5);
 */

const client = require('prom-client');

// Create a Registry to register all metrics
const register = new client.Registry();

// Add default metrics (process CPU, memory, etc.)
client.collectDefaultMetrics({ register });

/**
 * HTTP Request Duration Histogram
 * Tracks request latency distribution with route and status code labels
 *
 * Labels:
 * - method: HTTP method (GET, POST, DELETE, etc.)
 * - route: Normalized route path (e.g., /api/favicon)
 * - status_code: HTTP response status code
 *
 * Buckets optimized for web service latency (10ms to 10s)
 */
const httpRequestDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10], // 10ms to 10s
    registers: [register],
});

/**
 * HTTP Requests Total Counter
 * Tracks total number of HTTP requests by method, route, and status code
 *
 * Labels:
 * - method: HTTP method
 * - route: Normalized route path
 * - status_code: HTTP response status code
 */
const httpRequestsTotal = new client.Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_code'],
    registers: [register],
});

/**
 * Favicon Cache Hits Counter
 * Tracks successful cache lookups (favicon found in cache)
 */
const faviconCacheHitsTotal = new client.Counter({
    name: 'favicon_cache_hits_total',
    help: 'Total number of favicon cache hits',
    registers: [register],
});

/**
 * Favicon Cache Misses Counter
 * Tracks cache misses (favicon not in cache, requires generation)
 */
const faviconCacheMissesTotal = new client.Counter({
    name: 'favicon_cache_misses_total',
    help: 'Total number of favicon cache misses',
    registers: [register],
});

/**
 * SSE Connections Active Gauge
 * Tracks current number of active Server-Sent Events connections
 *
 * Gauge metric that can increase/decrease based on connection lifecycle
 */
const sseConnectionsActive = new client.Gauge({
    name: 'sse_connections_active',
    help: 'Current number of active SSE connections',
    registers: [register],
});

/**
 * Normalize route path for consistent metric labels
 * Removes query parameters and normalizes dynamic path segments
 *
 * Examples:
 * - /api/favicon?folder=/opt/dev -> /api/favicon
 * - /notifications/stream?folder=/opt/dev -> /notifications/stream
 * - /claude-status/mark-read -> /claude-status/mark-read
 *
 * @param {string} path - Request path with potential query parameters
 * @returns {string} Normalized route path
 */
function normalizeRoute(path) {
    // Remove query string
    const pathWithoutQuery = path.split('?')[0];

    // Remove trailing slashes for consistency
    return pathWithoutQuery.replace(/\/$/, '') || '/';
}

module.exports = {
    register,
    httpRequestDuration,
    httpRequestsTotal,
    faviconCacheHitsTotal,
    faviconCacheMissesTotal,
    sseConnectionsActive,
    normalizeRoute,
};
