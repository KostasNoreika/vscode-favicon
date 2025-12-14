/**
 * Graceful Shutdown Tests
 * Tests for lib/lifecycle/shutdown.js
 *
 * Coverage areas:
 * - HTTP server shutdown
 * - Notification persistence
 * - Registry watcher cleanup
 * - Cleanup interval management
 * - Force exit timeout
 * - Signal handler registration
 * - Error scenarios
 */

// Mock dependencies BEFORE requiring the module
jest.mock('../../lib/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    fatal: jest.fn(),
    debug: jest.fn(),
}));

jest.mock('../../lib/config', () => ({
    gracefulShutdownTimeout: 10000,
}));

jest.mock('../../lib/notification-store', () => ({
    saveImmediate: jest.fn().mockResolvedValue(),
}));

jest.mock('../../lib/registry-cache', () => ({
    closeWatcher: jest.fn(),
}));

const {
    gracefulShutdown,
    registerShutdownHandlers,
    stopHTTPServer,
    stopCleanupInterval,
    saveNotificationsOnShutdown,
    closeRegistryWatcher,
    setupForceExitTimeout,
} = require('../../lib/lifecycle/shutdown');

const logger = require('../../lib/logger');
const config = require('../../lib/config');
const notificationStore = require('../../lib/notification-store');
const registryCache = require('../../lib/registry-cache');

describe('Graceful Shutdown Module', () => {
    let originalProcessExit;
    let mockProcessExit;
    let mockServer;
    let mockCleanupInterval;

    beforeEach(() => {
        // Mock process.exit to prevent test termination
        originalProcessExit = process.exit;
        mockProcessExit = jest.fn();
        process.exit = mockProcessExit;

        // Setup mock server
        mockServer = {
            close: jest.fn((callback) => callback()),
        };

        // Setup mock cleanup interval
        mockCleanupInterval = setInterval(() => {}, 1000);

        // Reset config
        config.gracefulShutdownTimeout = 10000;

        jest.clearAllMocks();
    });

    afterEach(() => {
        // Restore process.exit
        process.exit = originalProcessExit;

        // Clear intervals
        clearInterval(mockCleanupInterval);

        jest.clearAllMocks();
    });

    describe('stopHTTPServer()', () => {
        it('should close HTTP server successfully', async () => {
            await stopHTTPServer(mockServer);

            expect(mockServer.close).toHaveBeenCalledTimes(1);
            expect(logger.info).toHaveBeenCalledWith('HTTP server closed');
        });

        it('should handle null server gracefully', async () => {
            await stopHTTPServer(null);

            expect(logger.info).not.toHaveBeenCalled();
        });

        it('should handle undefined server gracefully', async () => {
            await stopHTTPServer(undefined);

            expect(logger.info).not.toHaveBeenCalled();
        });

        it('should wait for server close callback', async () => {
            const delayedServer = {
                close: jest.fn((callback) => {
                    setTimeout(callback, 100);
                }),
            };

            const promise = stopHTTPServer(delayedServer);
            expect(logger.info).not.toHaveBeenCalled();

            await promise;
            expect(logger.info).toHaveBeenCalledWith('HTTP server closed');
        });
    });

    describe('stopCleanupInterval()', () => {
        it('should stop cleanup interval', () => {
            stopCleanupInterval(mockCleanupInterval);

            expect(logger.info).toHaveBeenCalledWith('Notification cleanup interval stopped');
        });

        it('should handle null interval gracefully', () => {
            stopCleanupInterval(null);

            expect(logger.info).not.toHaveBeenCalled();
        });

        it('should handle undefined interval gracefully', () => {
            stopCleanupInterval(undefined);

            expect(logger.info).not.toHaveBeenCalled();
        });
    });

    describe('saveNotificationsOnShutdown()', () => {
        it('should save notifications immediately', async () => {
            await saveNotificationsOnShutdown();

            expect(notificationStore.saveImmediate).toHaveBeenCalledTimes(1);
            expect(logger.info).toHaveBeenCalledWith('Notifications saved');
        });

        it('should propagate notification save errors', async () => {
            const error = new Error('Save failed');
            notificationStore.saveImmediate.mockRejectedValue(error);

            await expect(saveNotificationsOnShutdown()).rejects.toThrow('Save failed');
        });
    });

    describe('closeRegistryWatcher()', () => {
        it('should close registry watcher', () => {
            closeRegistryWatcher();

            expect(registryCache.closeWatcher).toHaveBeenCalledTimes(1);
            expect(logger.info).toHaveBeenCalledWith('Registry watcher closed');
        });
    });

    describe('setupForceExitTimeout()', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        it('should setup force exit timeout', () => {
            const timeout = setupForceExitTimeout(5000);

            expect(timeout).toBeDefined();
            expect(typeof timeout).toBe('object'); // Timer object
        });

        it('should force exit after timeout', () => {
            setupForceExitTimeout(5000);

            jest.advanceTimersByTime(5000);

            expect(logger.warn).toHaveBeenCalledWith('Shutdown timeout exceeded, forcing exit');
            expect(mockProcessExit).toHaveBeenCalledWith(1);
        });

        it('should not force exit if cleared before timeout', () => {
            const timeout = setupForceExitTimeout(5000);

            jest.advanceTimersByTime(2500);
            clearTimeout(timeout);
            jest.advanceTimersByTime(2500);

            expect(mockProcessExit).not.toHaveBeenCalled();
        });
    });

    describe('gracefulShutdown()', () => {
        beforeEach(() => {
            jest.useFakeTimers();
            notificationStore.saveImmediate.mockResolvedValue();
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        it('should perform graceful shutdown for SIGTERM', async () => {
            const shutdownPromise = gracefulShutdown('SIGTERM', mockServer, mockCleanupInterval);

            await Promise.resolve();
            jest.runAllTimers();

            await shutdownPromise;

            expect(logger.info).toHaveBeenCalledWith(
                { signal: 'SIGTERM' },
                'Shutdown signal received, starting graceful shutdown'
            );
            expect(mockServer.close).toHaveBeenCalled();
            expect(notificationStore.saveImmediate).toHaveBeenCalled();
            expect(registryCache.closeWatcher).toHaveBeenCalled();
            expect(logger.info).toHaveBeenCalledWith('Graceful shutdown complete');
            expect(mockProcessExit).toHaveBeenCalledWith(0);
        });

        it('should handle server close errors gracefully', async () => {
            mockServer.close = jest.fn(() => {
                throw new Error('Server close failed');
            });

            const shutdownPromise = gracefulShutdown('SIGTERM', mockServer, mockCleanupInterval);

            await Promise.resolve();
            jest.runAllTimers();

            await shutdownPromise;

            expect(logger.error).toHaveBeenCalled();
            expect(mockProcessExit).toHaveBeenCalledWith(1);
        });
    });

    describe('registerShutdownHandlers()', () => {
        let sigTermListeners;
        let sigIntListeners;
        let uncaughtExceptionListeners;
        let unhandledRejectionListeners;
        let originalProcessOn;

        beforeEach(() => {
            sigTermListeners = [];
            sigIntListeners = [];
            uncaughtExceptionListeners = [];
            unhandledRejectionListeners = [];

            originalProcessOn = process.on;
            process.on = jest.fn((event, handler) => {
                if (event === 'SIGTERM') sigTermListeners.push(handler);
                if (event === 'SIGINT') sigIntListeners.push(handler);
                if (event === 'uncaughtException') uncaughtExceptionListeners.push(handler);
                if (event === 'unhandledRejection') unhandledRejectionListeners.push(handler);
                return process;
            });
        });

        afterEach(() => {
            process.on = originalProcessOn;
        });

        it('should register SIGTERM handler', () => {
            registerShutdownHandlers(mockServer, mockCleanupInterval);

            expect(process.on).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
            expect(sigTermListeners.length).toBe(1);
        });

        it('should register SIGINT handler', () => {
            registerShutdownHandlers(mockServer, mockCleanupInterval);

            expect(process.on).toHaveBeenCalledWith('SIGINT', expect.any(Function));
            expect(sigIntListeners.length).toBe(1);
        });

        it('should log fatal on uncaughtException', () => {
            registerShutdownHandlers(mockServer, mockCleanupInterval);

            const error = new Error('Uncaught error');
            uncaughtExceptionListeners[0](error);

            expect(logger.fatal).toHaveBeenCalledWith({ err: error }, 'Uncaught exception');
        });

        it('should log error on unhandledRejection', () => {
            registerShutdownHandlers(mockServer, mockCleanupInterval);

            const reason = new Error('Unhandled rejection');
            const promise = Promise.reject(reason).catch(() => {});

            unhandledRejectionListeners[0](reason, promise);

            expect(logger.error).toHaveBeenCalledWith(
                { reason, promise },
                'Unhandled rejection'
            );
        });
    });
});
