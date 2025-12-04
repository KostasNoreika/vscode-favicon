const fs = require('fs');
const config = require('./config');
const logger = require('./logger');

/**
 * Enhanced Health Check System
 *
 * Features:
 * - Registry file accessibility checks
 * - Data directory write permission checks
 * - Memory usage reporting
 * - Service uptime tracking
 * - Kubernetes-style liveness and readiness probes
 * - 503 status on degraded services
 */

/**
 * Check registry file accessibility and metadata
 * @returns {Promise<Object>} Status object with file info or error
 */
async function checkRegistry() {
    try {
        await fs.promises.access(config.registryPath, fs.constants.R_OK);
        const stats = await fs.promises.stat(config.registryPath);

        return {
            status: 'ok',
            path: config.registryPath,
            size: stats.size,
            modified: stats.mtime.toISOString(),
            readable: true,
        };
    } catch (err) {
        logger.error({ err, path: config.registryPath }, 'Registry file check failed');
        return {
            status: 'error',
            path: config.registryPath,
            error: err.message,
            readable: false,
        };
    }
}

/**
 * Check data directory write permissions
 * @returns {Promise<Object>} Status object with directory info or error
 */
async function checkDataDir() {
    try {
        await fs.promises.access(config.dataDir, fs.constants.W_OK);
        const stats = await fs.promises.stat(config.dataDir);

        return {
            status: 'ok',
            path: config.dataDir,
            writable: true,
            isDirectory: stats.isDirectory(),
        };
    } catch (err) {
        logger.warn({ err, path: config.dataDir }, 'Data directory check failed');
        return {
            status: 'error',
            path: config.dataDir,
            error: err.message,
            writable: false,
        };
    }
}

/**
 * Get formatted memory usage statistics
 * @returns {Object} Memory usage in MB
 */
function getMemoryUsage() {
    const usage = process.memoryUsage();
    return {
        heapUsed: Math.round(usage.heapUsed / 1024 / 1024) + 'MB',
        heapTotal: Math.round(usage.heapTotal / 1024 / 1024) + 'MB',
        rss: Math.round(usage.rss / 1024 / 1024) + 'MB',
        external: Math.round(usage.external / 1024 / 1024) + 'MB',
        arrayBuffers: Math.round((usage.arrayBuffers || 0) / 1024 / 1024) + 'MB',
    };
}

/**
 * Get formatted uptime
 * @returns {String} Uptime in human-readable format
 */
function getUptime() {
    const seconds = Math.floor(process.uptime());
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
        return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${secs}s`;
    } else {
        return `${secs}s`;
    }
}

/**
 * Get comprehensive health status
 *
 * @param {String} serviceName - Name of the service
 * @param {Object} extraChecks - Additional health checks to include
 * @returns {Promise<Object>} Full health status with all checks
 */
async function getFullHealth(serviceName, extraChecks = {}) {
    const registryCheck = await checkRegistry();
    const dataDirCheck = await checkDataDir();

    const health = {
        status: 'ok',
        service: serviceName,
        version: process.env.npm_package_version || '1.0.0',
        environment: config.nodeEnv,
        timestamp: new Date().toISOString(),
        uptime: getUptime(),
        uptimeSeconds: Math.floor(process.uptime()),
        memory: getMemoryUsage(),
        checks: {
            registry: registryCheck,
            dataDir: dataDirCheck,
            ...extraChecks,
        },
    };

    // Determine overall status based on all checks
    const allChecks = Object.values(health.checks);

    // Count errors
    const errorCount = allChecks.filter((c) => c && c.status === 'error').length;

    if (errorCount > 0) {
        // If registry is broken, service is degraded
        if (registryCheck.status === 'error') {
            health.status = 'degraded';
            health.message = 'Registry file is not accessible';
        } else {
            health.status = 'degraded';
            health.message = `${errorCount} check(s) failed`;
        }
    }

    return health;
}

/**
 * Simple liveness probe
 * Returns true if process is alive (always returns ok)
 *
 * @returns {Object} Liveness status
 */
function getLivenessProbe() {
    return {
        status: 'alive',
        timestamp: new Date().toISOString(),
        pid: process.pid,
        uptime: getUptime(),
    };
}

/**
 * Readiness probe - checks if service is ready to accept traffic
 * Returns error if critical dependencies are unavailable
 *
 * @returns {Promise<Object>} Readiness status
 */
async function getReadinessProbe() {
    try {
        // Check registry accessibility (critical for operation)
        await fs.promises.access(config.registryPath, fs.constants.R_OK);

        return {
            status: 'ready',
            timestamp: new Date().toISOString(),
            message: 'Service is ready to accept traffic',
        };
    } catch (err) {
        logger.error({ err, path: config.registryPath }, 'Readiness probe failed');
        return {
            status: 'not_ready',
            timestamp: new Date().toISOString(),
            message: 'Registry file is not accessible',
            error: err.message,
        };
    }
}

module.exports = {
    getFullHealth,
    getLivenessProbe,
    getReadinessProbe,
    checkRegistry,
    checkDataDir,
    getMemoryUsage,
    getUptime,
};
