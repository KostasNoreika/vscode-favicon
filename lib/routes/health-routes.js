/**
 * Health Check Routes Module
 * Routes for service health monitoring and Kubernetes probes
 *
 * Endpoints:
 * - GET /health - Detailed health status with cache statistics
 * - GET /health/live - Kubernetes liveness probe
 * - GET /health/ready - Kubernetes readiness probe
 */

const express = require('express');
const router = express.Router();
const logger = require('../logger');
const config = require('../config');
const { sendError, ErrorCodes } = require('../response-helpers');
const {
    getFullHealth,
    getLivenessProbe,
    getReadinessProbe,
    getFileDescriptorUsage,
} = require('../health-check');
const { getCacheStats: getRegistryCacheStats } = require('../registry-cache');
const notificationStore = require('../notification-store');

/**
 * Map health status to HTTP status code
 *
 * @param {string} status - Health status ('healthy', 'ok', 'ready', 'degraded', 'unhealthy', 'not_ready', etc.)
 * @returns {number} HTTP status code (200 or 503)
 */
function getStatusCode(status) {
    // Normalize status to lowercase string for case-insensitive comparison
    const normalizedStatus = String(status || '').toLowerCase();

    // Healthy states return 200
    if (['healthy', 'ok', 'ready', 'alive'].includes(normalizedStatus)) {
        return 200;
    }

    // Degraded state returns 200 (still operational, just with warnings)
    if (normalizedStatus === 'degraded') {
        return 200;
    }

    // All other states (unhealthy, not_ready, error, etc.) return 503
    return 503;
}

/**
 * Initialize health check routes with dependencies
 *
 * @param {Object} faviconCache - LRU cache instance for favicons
 * @param {Object} faviconService - FaviconService instance
 * @param {Function} getSSEStats - Function to get SSE connection statistics
 * @returns {Object} Express router with health check routes
 */
function createHealthRoutes(faviconCache, faviconService, getSSEStats) {
    // Main health endpoint with detailed status
    router.get('/health', async (req, res) => {
        try {
            // Get cache statistics
            // FIX QUA-030: Include FaviconService stats for comprehensive cache monitoring
            const faviconStats = faviconCache
                ? faviconCache.getStats()
                : { status: 'error', error: 'Cache not initialized' };
            const faviconServiceStats = faviconService ? faviconService.getStats() : null;
            const registryStats = getRegistryCacheStats();
            const notificationStats = notificationStore.getStats();

            // Get SSE connection statistics
            const sseStats = getSSEStats();

            // FIX QUA-019: Monitor EventEmitter listener count
            const maxListeners = config.sseGlobalLimit + 20;
            const listenerCount = notificationStats.listenerCount;
            const listenerThreshold = Math.floor(maxListeners * 0.8);

            // FIX QUA-015: File descriptor usage monitoring
            const fdUsage = getFileDescriptorUsage();

            // Get full health status
            const health = await getFullHealth('vscode-favicon-unified', {
                faviconCache: {
                    status: 'ok',
                    ...faviconStats,
                },
                // FIX QUA-030: Include FaviconService cache monitoring
                faviconService: faviconServiceStats
                    ? {
                          status: 'ok',
                          ...faviconServiceStats,
                      }
                    : {
                          status: 'error',
                          error: 'FaviconService not initialized',
                      },
                registryCache: {
                    status: 'ok',
                    ...registryStats,
                },
                notifications: {
                    status: 'ok',
                    ...notificationStats,
                },
                sseConnections: {
                    status: 'ok',
                    ...sseStats,
                },
                // FIX QUA-019: EventEmitter listener monitoring
                eventEmitter: {
                    status: listenerCount > listenerThreshold ? 'warning' : 'ok',
                    listenerCount,
                    maxListeners,
                    threshold: listenerThreshold,
                    utilizationPercent: Math.round((listenerCount / maxListeners) * 100),
                },
                // FIX QUA-015: File descriptor usage monitoring
                fileDescriptors: fdUsage,
            });

            // Map status to HTTP status code using helper
            const statusCode = getStatusCode(health.status);
            res.status(statusCode).json(health);
        } catch (error) {
            logger.error({ err: error }, 'Health check failed');
            sendError(res, 503, ErrorCodes.SERVICE_UNAVAILABLE, 'Health check failed');
        }
    });

    // Kubernetes liveness probe - is the service alive?
    // FIX QUA-025: Add try-catch for defensive programming
    router.get('/health/live', (req, res) => {
        try {
            const liveness = getLivenessProbe();
            res.json(liveness);
        } catch (error) {
            logger.error({ err: error }, 'Liveness probe error');
            sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Liveness probe failed');
        }
    });

    // Kubernetes readiness probe - is the service ready to accept traffic?
    router.get('/health/ready', async (req, res) => {
        try {
            const readiness = await getReadinessProbe();

            // Map status to HTTP status code using helper
            const statusCode = getStatusCode(readiness.status);
            res.status(statusCode).json(readiness);
        } catch (error) {
            logger.error({ err: error }, 'Readiness probe failed');
            sendError(res, 503, ErrorCodes.SERVICE_UNAVAILABLE, 'Readiness probe failed');
        }
    });

    return router;
}

module.exports = { createHealthRoutes, getStatusCode };
