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
const { getFullHealth, getLivenessProbe, getReadinessProbe } = require('../health-check');
const { getCacheStats: getRegistryCacheStats } = require('../registry-cache');
const notificationStore = require('../notification-store');

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
            });

            // Return 503 if service is degraded
            const statusCode = health.status === 'ok' ? 200 : 503;
            res.status(statusCode).json(health);
        } catch (error) {
            logger.error({ err: error }, 'Health check failed');
            // QUA-010: Standardized error format for consistency
            res.status(503).json({
                error: 'Health check failed',
                details: {
                    service: 'vscode-favicon-unified',
                    message: error.message,
                    timestamp: new Date().toISOString(),
                },
            });
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
            // QUA-010: Standardized error format for consistency
            res.status(500).json({
                error: 'Liveness probe failed',
                details: {
                    timestamp: new Date().toISOString(),
                },
            });
        }
    });

    // Kubernetes readiness probe - is the service ready to accept traffic?
    router.get('/health/ready', async (req, res) => {
        try {
            const readiness = await getReadinessProbe();

            if (readiness.status === 'ready') {
                res.json(readiness);
            } else {
                res.status(503).json(readiness);
            }
        } catch (error) {
            logger.error({ err: error }, 'Readiness probe failed');
            // QUA-010: Standardized error format for consistency
            res.status(503).json({
                error: 'Readiness probe failed',
                details: {
                    message: error.message,
                    timestamp: new Date().toISOString(),
                },
            });
        }
    });

    return router;
}

module.exports = { createHealthRoutes };
