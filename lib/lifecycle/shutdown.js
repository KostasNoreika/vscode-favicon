/**
 * Graceful Shutdown Module
 * Handles clean shutdown of the service with proper resource cleanup
 *
 * Features:
 * - HTTP server connection draining
 * - Notification persistence to disk
 * - Registry file watcher cleanup
 * - Path validation cache cleanup (PERF-013)
 * - Cleanup interval management
 * - Force exit timeout to prevent hanging
 */

const logger = require('../logger');
const config = require('../config');
const notificationStore = require('../notification-store');
const uploadStorage = require('../services/upload-storage');

/**
 * Stops the HTTP server and waits for existing connections to close
 *
 * @param {Object} httpServer - HTTP server instance
 * @returns {Promise<void>} Resolves when server is closed
 */
function stopHTTPServer(httpServer) {
    return new Promise((resolve) => {
        if (!httpServer) {
            resolve();
            return;
        }

        httpServer.close(() => {
            logger.info('HTTP server closed');
            resolve();
        });
    });
}

/**
 * Stops the notification cleanup interval
 *
 * @param {NodeJS.Timeout} cleanupInterval - Cleanup interval ID
 */
function stopCleanupInterval(cleanupInterval) {
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        logger.info('Notification cleanup interval stopped');
    }
}

/**
 * Stops the path validation cache cleanup interval
 * PERF-013: Ensures cache cleanup interval is properly stopped during shutdown
 */
function stopPathValidatorCleanup() {
    const { stopCacheCleanup } = require('../path-validator');
    stopCacheCleanup();
    logger.info('Path validation cache cleanup stopped');
}

/**
 * Saves all pending notifications to disk
 *
 * @returns {Promise<void>} Resolves when notifications are saved
 */
async function saveNotificationsOnShutdown() {
    await notificationStore.saveImmediate();
    logger.info('Notifications saved');
}

/**
 * Closes the registry file watcher
 */
function closeRegistryWatcher() {
    const { closeWatcher } = require('../registry-cache');
    closeWatcher();
    logger.info('Registry watcher closed');
}

/**
 * Sets up forced exit timeout to prevent hanging during shutdown
 *
 * @param {number} timeout - Timeout in milliseconds
 * @returns {NodeJS.Timeout} Timeout ID that can be cleared
 */
function setupForceExitTimeout(timeout) {
    return setTimeout(() => {
        logger.warn('Shutdown timeout exceeded, forcing exit');
        // eslint-disable-next-line no-process-exit
        process.exit(1);
    }, timeout);
}

/**
 * Graceful Shutdown Handler
 * Handles SIGTERM and SIGINT signals for PM2 compatibility
 *
 * FIX QUA-027: Enhanced JSDoc documentation for complex function
 * FIX QUA-018: Simplified shutdown logic to prevent race conditions
 * FIX REF-004: Refactored into smaller, focused helper functions
 * FIX PERF-013: Added path validation cache cleanup stop
 *
 * @param {string} signal - Signal name that triggered shutdown (e.g., 'SIGTERM', 'SIGINT')
 * @param {Object} server - HTTP server instance
 * @param {NodeJS.Timeout} cleanupInterval - Notification cleanup interval ID
 * @param {NodeJS.Timeout} uploadCleanupInterval - Upload storage cleanup interval ID
 *
 * @description
 * Performs graceful shutdown in the following order:
 * 1. Stop accepting new HTTP connections
 * 2. Stop notification cleanup interval
 * 3. Stop path validation cache cleanup interval
 * 4. Save pending notifications to disk
 * 5. Close registry file watcher
 * 6. Exit with appropriate code (0 for success, 1 for errors)
 *
 * Uses Promise.allSettled() to run independent cleanup tasks in parallel where safe.
 * Uses a single timeout (default: 10 seconds) to force exit if shutdown hangs.
 * This prevents the nested timeout pattern that could cause race conditions.
 *
 * @throws Will force exit with code 1 if shutdown exceeds timeout
 *
 * @example
 * // Triggered by PM2 or Docker
 * process.kill(process.pid, 'SIGTERM')
 *
 * @see {@link config.gracefulShutdownTimeout} for timeout configuration
 * @see {@link notificationStore.saveImmediate} for notification persistence
 */
async function gracefulShutdown(signal, server, cleanupInterval, uploadCleanupInterval) {
    logger.info({ signal }, 'Shutdown signal received, starting graceful shutdown');

    // FIX QUA-018: Single timeout pattern to prevent race conditions
    const timeout = setupForceExitTimeout(config.gracefulShutdownTimeout);

    try {
        // Step 1: Stop accepting new connections (must be first)
        await stopHTTPServer(server);

        // Step 2: Stop cleanup intervals (synchronous, safe to run sequentially)
        stopCleanupInterval(cleanupInterval);
        if (uploadCleanupInterval) {
            uploadStorage.stopCleanupInterval();
        }
        stopPathValidatorCleanup();

        // Step 3 & 4: Run independent cleanup tasks in parallel
        // - Save notifications to disk (I/O operation)
        // - Close registry watcher (file system operation)
        // Using Promise.allSettled to ensure both run even if one fails
        const results = await Promise.allSettled([
            saveNotificationsOnShutdown(),
            Promise.resolve(closeRegistryWatcher()), // Wrap sync function in Promise
        ]);

        // Log any failures (graceful degradation)
        results.forEach((result, index) => {
            if (result.status === 'rejected') {
                const taskName = index === 0 ? 'saveNotifications' : 'closeRegistryWatcher';
                logger.error({ err: result.reason }, `Shutdown task failed: ${taskName}`);
            }
        });

        // Clear timeout and exit gracefully
        clearTimeout(timeout);
        logger.info('Graceful shutdown complete');
        // eslint-disable-next-line no-process-exit
        process.exit(0);
    } catch (err) {
        logger.error({ err }, 'Error during shutdown');
        clearTimeout(timeout);
        // eslint-disable-next-line no-process-exit
        process.exit(1);
    }
}

/**
 * Register signal handlers for graceful shutdown
 *
 * @param {Object} server - HTTP server instance
 * @param {NodeJS.Timeout} cleanupInterval - Notification cleanup interval ID
 * @param {NodeJS.Timeout} uploadCleanupInterval - Upload storage cleanup interval ID
 */
function registerShutdownHandlers(server, cleanupInterval, uploadCleanupInterval) {
    // Register signal handlers for graceful shutdown
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM', server, cleanupInterval, uploadCleanupInterval));
    process.on('SIGINT', () => gracefulShutdown('SIGINT', server, cleanupInterval, uploadCleanupInterval));

    // Handle uncaught errors
    process.on('uncaughtException', (err) => {
        logger.fatal({ err }, 'Uncaught exception');
        gracefulShutdown('uncaughtException', server, cleanupInterval, uploadCleanupInterval);
    });

    process.on('unhandledRejection', (reason, promise) => {
        logger.error({ reason, promise }, 'Unhandled rejection');
    });
}

module.exports = {
    gracefulShutdown,
    registerShutdownHandlers,
    stopHTTPServer,
    stopCleanupInterval,
    stopPathValidatorCleanup,
    saveNotificationsOnShutdown,
    closeRegistryWatcher,
    setupForceExitTimeout,
};
