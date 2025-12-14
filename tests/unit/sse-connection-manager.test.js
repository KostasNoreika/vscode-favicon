/**
 * SSEConnectionManager Unit Tests
 *
 * Tests for the SSE connection lifecycle management class.
 * REF-011: Unit tests for extracted SSE connection manager
 * SEC-006: Tests updated for atomic increment pattern
 */

const SSEConnectionManager = require('../../lib/sse-connection-manager');

describe('SSEConnectionManager', () => {
    let manager;

    beforeEach(() => {
        manager = new SSEConnectionManager({
            maxConnectionsPerIP: 5,
            globalLimit: 10,
            keepaliveInterval: 30000,
        });
    });

    afterEach(() => {
        if (manager) {
            manager.reset();
        }
    });

    describe('Constructor', () => {
        test('should initialize with default config values', () => {
            const defaultManager = new SSEConnectionManager();
            const stats = defaultManager.getStats();

            expect(stats.totalConnections).toBe(0);
            expect(stats.totalIPs).toBe(0);
            expect(stats.maxPerIP).toBe(5); // default from config
            expect(stats.globalLimit).toBe(100); // default from config
        });

        test('should initialize with custom config values', () => {
            const customManager = new SSEConnectionManager({
                maxConnectionsPerIP: 3,
                globalLimit: 20,
                keepaliveInterval: 15000,
            });
            const stats = customManager.getStats();

            expect(stats.maxPerIP).toBe(3);
            expect(stats.globalLimit).toBe(20);
        });

        test('should allow 0 as valid limit value', () => {
            const zeroManager = new SSEConnectionManager({
                maxConnectionsPerIP: 0,
                globalLimit: 0,
                keepaliveInterval: 30000,
            });
            const stats = zeroManager.getStats();

            expect(stats.maxPerIP).toBe(0);
            expect(stats.globalLimit).toBe(0);
        });
    });

    describe('validateConnectionLimits', () => {
        test('should allow connection within limits', () => {
            const req = {
                log: {
                    warn: jest.fn(),
                },
            };
            const ip = '127.0.0.1';

            const result = manager.validateConnectionLimits(req, ip);

            expect(result).toBeNull();
            expect(req.log.warn).not.toHaveBeenCalled();
        });

        test('should reject when global limit exceeded', () => {
            const req = {
                log: {
                    warn: jest.fn(),
                },
            };
            const ip = '127.0.0.1';

            // Set global connections to limit
            manager.globalSSEConnections = 10;

            const result = manager.validateConnectionLimits(req, ip);

            expect(result).not.toBeNull();
            expect(result.status).toBe(503);
            expect(result.body.error).toBe('Service at capacity');
            expect(req.log.warn).toHaveBeenCalled();
        });

        test('should reject when per-IP limit exceeded', () => {
            const req = {
                log: {
                    warn: jest.fn(),
                },
            };
            const ip = '127.0.0.1';

            // Set per-IP connections to limit
            manager.sseConnections.set(ip, 5);

            const result = manager.validateConnectionLimits(req, ip);

            expect(result).not.toBeNull();
            expect(result.status).toBe(429);
            expect(result.body.error).toBe('Too many concurrent connections');
            expect(req.log.warn).toHaveBeenCalled();
        });

        test('should use atomic increment pattern (SEC-006)', () => {
            const req = {
                log: {
                    warn: jest.fn(),
                },
            };
            const ip = '127.0.0.1';

            const initialGlobal = manager.globalSSEConnections;
            const initialPerIP = manager.sseConnections.get(ip) || 0;

            manager.validateConnectionLimits(req, ip);

            // SEC-006: Both counters should be incremented atomically
            expect(manager.globalSSEConnections).toBe(initialGlobal + 1);
            expect(manager.sseConnections.get(ip)).toBe(initialPerIP + 1);
        });

        test('should rollback both counters on per-IP limit rejection (SEC-006)', () => {
            const req = {
                log: {
                    warn: jest.fn(),
                },
            };
            const ip = '127.0.0.1';

            // Set per-IP to limit
            manager.sseConnections.set(ip, 5);
            manager.globalSSEConnections = 5;

            const result = manager.validateConnectionLimits(req, ip);

            // SEC-006: Should reject and rollback both counters
            expect(result).not.toBeNull();
            expect(result.status).toBe(429);
            expect(manager.globalSSEConnections).toBe(5); // Rolled back
            expect(manager.sseConnections.get(ip)).toBe(5); // Rolled back
        });

        test('should rollback only global counter on global limit rejection (SEC-006)', () => {
            const req = {
                log: {
                    warn: jest.fn(),
                },
            };
            const ip = '127.0.0.1';

            // Set global to limit
            manager.globalSSEConnections = 10;

            const result = manager.validateConnectionLimits(req, ip);

            // SEC-006: Should reject and rollback global, per-IP never incremented
            expect(result).not.toBeNull();
            expect(result.status).toBe(503);
            expect(manager.globalSSEConnections).toBe(10); // Rolled back
            expect(manager.sseConnections.has(ip)).toBe(false); // Never set
        });
    });

    describe('setupHeaders', () => {
        test('should set correct SSE headers', () => {
            const res = {
                setHeader: jest.fn(),
            };

            manager.setupHeaders(res);

            expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
            expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
            expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
            expect(res.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no');
        });
    });

    describe('sendInitialState', () => {
        test('should send connected event', () => {
            const res = {
                write: jest.fn(),
            };

            manager.sendInitialState(res, '/opt/dev/test');

            expect(res.write).toHaveBeenCalledWith('event: connected\n');
            expect(res.write).toHaveBeenCalledWith(expect.stringContaining('data: {'));
        });

        test('should send notification status', () => {
            const res = {
                write: jest.fn(),
            };

            manager.sendInitialState(res, '/opt/dev/test');

            expect(res.write).toHaveBeenCalledWith('event: notification\n');
            expect(res.write).toHaveBeenCalledWith(expect.stringContaining('hasNotification'));
        });
    });

    describe('createCleanupHandler', () => {
        test('should create cleanup function', () => {
            const req = {
                log: {
                    info: jest.fn(),
                },
            };
            const ip = '127.0.0.1';
            const folder = '/opt/dev/test';

            const handler = manager.createCleanupHandler(ip, folder, req);

            expect(handler).toHaveProperty('cleanup');
            expect(handler).toHaveProperty('setKeepaliveInterval');
            expect(handler).toHaveProperty('setUnsubscribe');
            expect(typeof handler.cleanup).toBe('function');
        });

        test('cleanup should decrement counters', () => {
            const req = {
                log: {
                    info: jest.fn(),
                },
            };
            const ip = '127.0.0.1';
            const folder = '/opt/dev/test';

            // Setup initial state
            manager.globalSSEConnections = 5;
            manager.sseConnections.set(ip, 2);

            const handler = manager.createCleanupHandler(ip, folder, req);
            handler.cleanup();

            expect(manager.globalSSEConnections).toBe(4);
            expect(manager.sseConnections.get(ip)).toBe(1);
        });

        test('cleanup should remove IP when count reaches zero', () => {
            const req = {
                log: {
                    info: jest.fn(),
                },
            };
            const ip = '127.0.0.1';
            const folder = '/opt/dev/test';

            // Setup initial state
            manager.globalSSEConnections = 1;
            manager.sseConnections.set(ip, 1);

            const handler = manager.createCleanupHandler(ip, folder, req);
            handler.cleanup();

            expect(manager.globalSSEConnections).toBe(0);
            expect(manager.sseConnections.has(ip)).toBe(false);
        });

        test('cleanup should clear keepalive interval', () => {
            const req = {
                log: {
                    info: jest.fn(),
                },
            };
            const ip = '127.0.0.1';
            const folder = '/opt/dev/test';

            const handler = manager.createCleanupHandler(ip, folder, req);
            const intervalId = setInterval(() => {}, 1000);
            handler.setKeepaliveInterval(intervalId);

            handler.cleanup();

            // Verify interval was cleared (we can't directly test this, but we can ensure no errors)
            expect(req.log.info).toHaveBeenCalled();
        });

        test('cleanup should call unsubscribe function', () => {
            const req = {
                log: {
                    info: jest.fn(),
                    warn: jest.fn(),
                },
            };
            const ip = '127.0.0.1';
            const folder = '/opt/dev/test';
            const unsubscribe = jest.fn();

            const handler = manager.createCleanupHandler(ip, folder, req);
            handler.setUnsubscribe(unsubscribe);

            handler.cleanup();

            expect(unsubscribe).toHaveBeenCalled();
        });

        test('cleanup should handle unsubscribe errors gracefully', () => {
            const req = {
                log: {
                    info: jest.fn(),
                    warn: jest.fn(),
                },
            };
            const ip = '127.0.0.1';
            const folder = '/opt/dev/test';
            const unsubscribe = jest.fn(() => {
                throw new Error('Unsubscribe error');
            });

            manager.globalSSEConnections = 1;
            manager.sseConnections.set(ip, 1);

            const handler = manager.createCleanupHandler(ip, folder, req);
            handler.setUnsubscribe(unsubscribe);

            // Should not throw
            expect(() => handler.cleanup()).not.toThrow();

            // Should still decrement counters
            expect(manager.globalSSEConnections).toBe(0);
            expect(req.log.warn).toHaveBeenCalled();
        });

        test('cleanup should prevent negative counters', () => {
            const req = {
                log: {
                    info: jest.fn(),
                },
            };
            const ip = '127.0.0.1';
            const folder = '/opt/dev/test';

            // Setup initial state with zero
            manager.globalSSEConnections = 0;
            manager.sseConnections.set(ip, 0);

            const handler = manager.createCleanupHandler(ip, folder, req);
            handler.cleanup();

            // Should not go negative
            expect(manager.globalSSEConnections).toBe(0);
            expect(manager.sseConnections.has(ip)).toBe(false);
        });
    });

    describe('startKeepalive', () => {
        test('should create interval that writes keepalive', (done) => {
            const res = {
                write: jest.fn(),
            };

            // Use short interval for testing
            const testManager = new SSEConnectionManager({
                maxConnectionsPerIP: 5,
                globalLimit: 10,
                keepaliveInterval: 100,
            });

            const intervalId = testManager.startKeepalive(res);

            setTimeout(() => {
                expect(res.write).toHaveBeenCalledWith(':keepalive\n\n');
                clearInterval(intervalId);
                done();
            }, 150);
        });
    });

    describe('getStats', () => {
        test('should return correct statistics', () => {
            manager.globalSSEConnections = 3;
            manager.sseConnections.set('127.0.0.1', 2);
            manager.sseConnections.set('192.168.1.1', 1);

            const stats = manager.getStats();

            expect(stats.totalConnections).toBe(3);
            expect(stats.totalIPs).toBe(2);
            expect(stats.maxPerIP).toBe(5);
            expect(stats.globalLimit).toBe(10);
        });
    });

    describe('reset', () => {
        test('should reset all counters', () => {
            manager.globalSSEConnections = 5;
            manager.sseConnections.set('127.0.0.1', 2);
            manager.sseConnections.set('192.168.1.1', 3);

            manager.reset();

            expect(manager.globalSSEConnections).toBe(0);
            expect(manager.sseConnections.size).toBe(0);
        });
    });
});
