const fs = require('fs');
const { execSync } = require('child_process');
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
 * - File descriptor usage monitoring
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
        logger.error({ err }, 'Registry file check failed');
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
        logger.warn({ err }, 'Data directory check failed');
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
 * Get file descriptor usage statistics
 * Platform-specific implementation with graceful fallback
 *
 * @returns {Object} FD usage stats with status, current count, limits, and percentage
 */
function getFileDescriptorUsage() {
    const WARNING_THRESHOLD = 0.8; // 80% threshold
    const CRITICAL_THRESHOLD = 0.95; // 95% threshold

    try {
        const platform = process.platform;
        let fdCount = null;
        let softLimit = null;
        let hardLimit = null;

        // Linux: read from /proc/self/fd
        if (platform === 'linux') {
            try {
                const fdDir = '/proc/self/fd';
                const fds = fs.readdirSync(fdDir);
                // Subtract 1 for the directory handle itself
                fdCount = Math.max(0, fds.length - 1);
            } catch (err) {
                logger.debug({ err }, 'Failed to read /proc/self/fd');
            }
        }
        // macOS/BSD: use lsof (slower but works)
        else if (platform === 'darwin' || platform === 'freebsd') {
            try {
                const output = execSync(`lsof -p ${process.pid} | wc -l`, {
                    encoding: 'utf8',
                    timeout: 1000,
                    stdio: ['ignore', 'pipe', 'ignore'],
                });
                // lsof output includes header, subtract 1
                fdCount = Math.max(0, parseInt(output.trim()) - 1);
            } catch (err) {
                logger.debug({ err }, 'Failed to run lsof for FD count');
            }
        }

        // Get ulimit values (works on most Unix-like systems)
        try {
            // Get soft limit
            const softOutput = execSync('ulimit -n', {
                encoding: 'utf8',
                timeout: 1000,
                shell: '/bin/bash',
                stdio: ['ignore', 'pipe', 'ignore'],
            });
            softLimit = parseInt(softOutput.trim(), 10);

            // Get hard limit
            const hardOutput = execSync('ulimit -Hn', {
                encoding: 'utf8',
                timeout: 1000,
                shell: '/bin/bash',
                stdio: ['ignore', 'pipe', 'ignore'],
            });
            const hardOutputTrimmed = hardOutput.trim();
            // Handle "unlimited" on some systems (macOS)
            if (hardOutputTrimmed === 'unlimited') {
                hardLimit = softLimit; // Use soft limit when hard is unlimited
            } else {
                hardLimit = parseInt(hardOutputTrimmed, 10);
            }

            // Validate parsed values
            if (isNaN(softLimit) || isNaN(hardLimit)) {
                logger.debug('Failed to parse ulimit values - got NaN');
                softLimit = null;
                hardLimit = null;
            }
        } catch (err) {
            logger.debug({ err }, 'Failed to get ulimit values');
        }

        // If we couldn't get FD count or limits, return unknown status
        if (fdCount === null || softLimit === null) {
            return {
                status: 'unknown',
                message: `File descriptor monitoring not supported on ${platform}`,
                platform,
            };
        }

        // Calculate usage percentage
        const usagePercent = softLimit > 0 ? fdCount / softLimit : 0;
        const usagePercentRounded = Math.round(usagePercent * 100);

        // Determine status based on thresholds
        let status = 'ok';
        let message = 'File descriptor usage is normal';

        if (usagePercent >= CRITICAL_THRESHOLD) {
            status = 'critical';
            message = `File descriptor usage critically high: ${usagePercentRounded}%`;
        } else if (usagePercent >= WARNING_THRESHOLD) {
            status = 'warning';
            message = `File descriptor usage above warning threshold: ${usagePercentRounded}%`;
        }

        return {
            status,
            message,
            current: fdCount,
            softLimit,
            hardLimit,
            usagePercent: usagePercentRounded,
            warningThreshold: Math.round(WARNING_THRESHOLD * 100),
            criticalThreshold: Math.round(CRITICAL_THRESHOLD * 100),
            platform,
        };
    } catch (err) {
        logger.error({ err }, 'File descriptor check failed unexpectedly');
        return {
            status: 'error',
            message: 'File descriptor check failed',
            error: err.message,
            platform: process.platform,
        };
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

    // Count errors and warnings
    const errorCount = allChecks.filter((c) => c && c.status === 'error').length;
    const criticalCount = allChecks.filter((c) => c && c.status === 'critical').length;
    const warningCount = allChecks.filter((c) => c && c.status === 'warning').length;

    if (errorCount > 0 || criticalCount > 0) {
        // If registry is broken, service is degraded
        if (registryCheck.status === 'error') {
            health.status = 'degraded';
            health.message = 'Registry file is not accessible';
        } else if (criticalCount > 0) {
            health.status = 'degraded';
            health.message = `${criticalCount} critical issue(s) detected`;
        } else {
            health.status = 'degraded';
            health.message = `${errorCount} check(s) failed`;
        }
    } else if (warningCount > 0) {
        // Warnings don't degrade service, just note them
        health.status = 'ok';
        health.warnings = `${warningCount} warning(s) detected`;
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
 * Returns error if critical dependencies are unavailable or FD usage is critical
 *
 * @returns {Promise<Object>} Readiness status
 */
async function getReadinessProbe() {
    try {
        // Check registry accessibility (critical for operation)
        await fs.promises.access(config.registryPath, fs.constants.R_OK);

        // Check file descriptor usage
        const fdUsage = getFileDescriptorUsage();

        // If FD usage is critical, mark as degraded (still ready but with warning)
        if (fdUsage.status === 'critical') {
            logger.warn({ fdUsage }, 'File descriptor usage critical in readiness probe');
            return {
                status: 'degraded',
                timestamp: new Date().toISOString(),
                message: 'Service operational but file descriptor usage is critically high',
                fdUsage,
            };
        }

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
    getFileDescriptorUsage,
};
