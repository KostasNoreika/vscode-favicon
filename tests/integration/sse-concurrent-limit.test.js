/**
 * SSE Concurrent Connection Limit Tests (TOCTOU Race Condition)
 *
 * SEC-006: Tests that verify connection limits are enforced atomically
 * under concurrent load, preventing TOCTOU race condition bypass.
 *
 * These tests specifically target the scenario where multiple requests
 * attempt to connect simultaneously, which could bypass limits if
 * using a check-then-increment pattern instead of increment-first-then-validate.
 */

const SSEConnectionManager = require('../../lib/sse-connection-manager');

describe('SSE Concurrent Connection Limit Tests (SEC-006)', () => {
    let manager;
    let mockReq;
    let _mockRes;
    const MAX_CONNECTIONS_PER_IP = 5;
    const GLOBAL_LIMIT = 10;

    beforeEach(() => {
        manager = new SSEConnectionManager({
            maxConnectionsPerIP: MAX_CONNECTIONS_PER_IP,
            globalLimit: GLOBAL_LIMIT,
            keepaliveInterval: 30000,
        });

        mockReq = {
            log: {
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
                debug: jest.fn(),
            },
            on: jest.fn(),
        };

        _mockRes = {
            setHeader: jest.fn(),
            write: jest.fn(),
        };
    });

    describe('Atomic global limit enforcement', () => {
        test('should enforce global limit atomically under concurrent requests', () => {
            // SEC-006: Test for TOCTOU race condition
            // Simulate exactly GLOBAL_LIMIT + 5 concurrent validation attempts
            // Only GLOBAL_LIMIT should succeed, rest should fail atomically
            const results = [];
            const attemptedConnections = GLOBAL_LIMIT + 5;

            // Simulate concurrent requests by calling validateConnectionLimits synchronously
            // In a TOCTOU vulnerable implementation, multiple requests could slip through
            for (let i = 0; i < attemptedConnections; i++) {
                const ip = `192.168.1.${100 + (i % 3)}`; // Vary IPs to avoid per-IP limit
                const result = manager.validateConnectionLimits(mockReq, ip);
                results.push({ ip, error: result });
            }

            // Count successful validations (null error means success)
            const successful = results.filter(r => r.error === null).length;
            const rejected = results.filter(r => r.error !== null).length;

            // SEC-006: Exactly GLOBAL_LIMIT connections should succeed, no more
            expect(successful).toBe(GLOBAL_LIMIT);
            expect(rejected).toBe(5);
            expect(manager.globalSSEConnections).toBe(GLOBAL_LIMIT);

            // Verify rejected connections got 503 status
            results.filter(r => r.error !== null).forEach(r => {
                expect(r.error.status).toBe(503);
                expect(r.error.code).toBe('SERVICE_UNAVAILABLE');
                expect(r.error.message).toBe('Service at capacity');
            });
        });

        test('should rollback global counter when per-IP limit is exceeded', () => {
            const ip = '192.168.1.100';
            const results = [];

            // Fill up to per-IP limit (should succeed)
            for (let i = 0; i < MAX_CONNECTIONS_PER_IP; i++) {
                const result = manager.validateConnectionLimits(mockReq, ip);
                results.push(result);
            }

            // All should succeed
            expect(results.filter(r => r === null).length).toBe(MAX_CONNECTIONS_PER_IP);
            expect(manager.globalSSEConnections).toBe(MAX_CONNECTIONS_PER_IP);

            // Try one more from same IP (should fail)
            const exceededResult = manager.validateConnectionLimits(mockReq, ip);
            expect(exceededResult).not.toBeNull();
            expect(exceededResult.status).toBe(429);

            // SEC-006: Global counter should be rolled back correctly
            expect(manager.globalSSEConnections).toBe(MAX_CONNECTIONS_PER_IP);
        });

        test('should handle rapid alternating success and failure without counter drift', () => {
            // SEC-006: Test for counter consistency under mixed success/failure
            // Use different IPs to avoid per-IP limit, focus on global limit

            // Create GLOBAL_LIMIT connections from different IPs
            for (let i = 0; i < GLOBAL_LIMIT; i++) {
                const ip = `192.168.1.${100 + i}`;
                manager.validateConnectionLimits(mockReq, ip);
            }
            expect(manager.globalSSEConnections).toBe(GLOBAL_LIMIT);

            // Now try to exceed limit 10 times (all should fail)
            for (let i = 0; i < 10; i++) {
                const ip = `192.168.2.${100 + i}`; // Different IPs to avoid per-IP limit
                const result = manager.validateConnectionLimits(mockReq, ip);
                expect(result).not.toBeNull();
                expect(result.status).toBe(503);
            }

            // SEC-006: Counter should remain stable at GLOBAL_LIMIT
            expect(manager.globalSSEConnections).toBe(GLOBAL_LIMIT);
        });
    });

    describe('Atomic per-IP limit enforcement', () => {
        test('should enforce per-IP limit atomically under concurrent requests', () => {
            const ip = '192.168.1.100';
            const results = [];
            const attemptedConnections = MAX_CONNECTIONS_PER_IP + 3;

            // Simulate concurrent requests from same IP
            for (let i = 0; i < attemptedConnections; i++) {
                const result = manager.validateConnectionLimits(mockReq, ip);
                results.push(result);
            }

            // SEC-006: Exactly MAX_CONNECTIONS_PER_IP should succeed
            const successful = results.filter(r => r === null).length;
            const rejected = results.filter(r => r !== null).length;

            expect(successful).toBe(MAX_CONNECTIONS_PER_IP);
            expect(rejected).toBe(3);
            expect(manager.sseConnections.get(ip)).toBe(MAX_CONNECTIONS_PER_IP);

            // Verify rejected connections got 429 status
            results.filter(r => r !== null).forEach(r => {
                expect(r.status).toBe(429);
                expect(r.code).toBe('RATE_LIMITED');
                expect(r.message).toBe('Too many concurrent connections');
            });
        });

        test('should handle multiple IPs approaching limit simultaneously', () => {
            const ips = ['192.168.1.1', '192.168.1.2'];
            const results = [];

            // Each IP tries to create MAX_CONNECTIONS_PER_IP + 1 connections
            // Total attempts = 2 * 6 = 12, but global limit is 10
            ips.forEach(ip => {
                for (let i = 0; i < MAX_CONNECTIONS_PER_IP + 1; i++) {
                    const result = manager.validateConnectionLimits(mockReq, ip);
                    results.push({ ip, error: result });
                }
            });

            // SEC-006: Should respect both per-IP and global limits
            const successful = results.filter(r => r.error === null).length;

            // Total successful should be limited by GLOBAL_LIMIT (10)
            expect(successful).toBe(GLOBAL_LIMIT);
            expect(manager.globalSSEConnections).toBe(GLOBAL_LIMIT);

            // Each IP should have at most MAX_CONNECTIONS_PER_IP
            ips.forEach(ip => {
                const ipCount = manager.sseConnections.get(ip) || 0;
                expect(ipCount).toBeLessThanOrEqual(MAX_CONNECTIONS_PER_IP);
            });
        });
    });

    describe('Combined limit enforcement', () => {
        test('should enforce global limit even when per-IP limits not reached', () => {
            // SEC-006: Global limit should prevent connections even if per-IP is OK
            const results = [];

            // Create connections from different IPs to reach global limit
            // Each IP will have fewer connections than MAX_CONNECTIONS_PER_IP
            for (let i = 0; i < GLOBAL_LIMIT + 5; i++) {
                const ip = `192.168.1.${100 + i}`; // Different IP for each
                const result = manager.validateConnectionLimits(mockReq, ip);
                results.push({ ip, error: result });
            }

            const successful = results.filter(r => r.error === null).length;
            const rejected = results.filter(r => r.error !== null).length;

            // SEC-006: Should respect global limit
            expect(successful).toBe(GLOBAL_LIMIT);
            expect(rejected).toBe(5);

            // Each successful connection should have per-IP count of 1
            results
                .filter(r => r.error === null)
                .forEach(r => {
                    expect(manager.sseConnections.get(r.ip)).toBe(1);
                });
        });

        test('should maintain correct counts when both limits interact', () => {
            const ip1 = '192.168.1.1';
            const ip2 = '192.168.1.2';

            // IP1: Fill to per-IP limit (5 connections)
            for (let i = 0; i < MAX_CONNECTIONS_PER_IP; i++) {
                manager.validateConnectionLimits(mockReq, ip1);
            }

            // IP2: Fill to global limit (5 more connections, total = 10)
            for (let i = 0; i < MAX_CONNECTIONS_PER_IP; i++) {
                manager.validateConnectionLimits(mockReq, ip2);
            }

            expect(manager.globalSSEConnections).toBe(GLOBAL_LIMIT);
            expect(manager.sseConnections.get(ip1)).toBe(MAX_CONNECTIONS_PER_IP);
            expect(manager.sseConnections.get(ip2)).toBe(MAX_CONNECTIONS_PER_IP);

            // Try to add more from ip1 - should fail due to global limit
            const result = manager.validateConnectionLimits(mockReq, ip1);
            expect(result).not.toBeNull();
            expect(result.status).toBe(503); // Global limit, not per-IP

            // SEC-006: Counters should not change
            expect(manager.globalSSEConnections).toBe(GLOBAL_LIMIT);
            expect(manager.sseConnections.get(ip1)).toBe(MAX_CONNECTIONS_PER_IP);
        });
    });

    describe('Stress test for race conditions', () => {
        test('should maintain consistency under extreme concurrent load', () => {
            // SEC-006: Aggressive test to expose any TOCTOU vulnerability
            const iterations = 100;
            const results = [];

            // Reset manager for clean slate
            manager.reset();

            // Simulate 100 concurrent attempts from varying IPs
            for (let i = 0; i < iterations; i++) {
                const ip = `192.168.1.${100 + (i % 10)}`; // 10 different IPs
                const result = manager.validateConnectionLimits(mockReq, ip);
                results.push({ ip, error: result, iteration: i });
            }

            const successful = results.filter(r => r.error === null).length;

            // SEC-006: Should not exceed global limit under any circumstances
            expect(successful).toBeLessThanOrEqual(GLOBAL_LIMIT);
            expect(manager.globalSSEConnections).toBeLessThanOrEqual(GLOBAL_LIMIT);
            expect(manager.globalSSEConnections).toBe(successful);

            // Verify per-IP limits are also respected
            results
                .filter(r => r.error === null)
                .forEach(r => {
                    const ipCount = manager.sseConnections.get(r.ip) || 0;
                    expect(ipCount).toBeLessThanOrEqual(MAX_CONNECTIONS_PER_IP);
                });
        });

        test('should handle interleaved validations and cleanups without drift', () => {
            const ip = '192.168.1.100';

            // Fill to limit
            for (let i = 0; i < MAX_CONNECTIONS_PER_IP; i++) {
                manager.validateConnectionLimits(mockReq, ip);
            }

            // Simulate cleanup of 2 connections
            manager.sseConnections.set(ip, 3);
            manager.globalSSEConnections = 3;

            // Now try to add 5 more (should succeed for 2, fail for 3)
            const results = [];
            for (let i = 0; i < 5; i++) {
                const result = manager.validateConnectionLimits(mockReq, ip);
                results.push(result);
            }

            const successful = results.filter(r => r === null).length;
            expect(successful).toBe(2);
            expect(manager.sseConnections.get(ip)).toBe(MAX_CONNECTIONS_PER_IP);
            expect(manager.globalSSEConnections).toBe(MAX_CONNECTIONS_PER_IP);
        });
    });

    describe('Rollback correctness', () => {
        test('should correctly rollback global counter on per-IP rejection', () => {
            const ip = '192.168.1.100';

            // Establish 3 connections
            for (let i = 0; i < 3; i++) {
                manager.validateConnectionLimits(mockReq, ip);
            }
            expect(manager.globalSSEConnections).toBe(3);
            expect(manager.sseConnections.get(ip)).toBe(3);

            // Now fill to per-IP limit
            for (let i = 0; i < 2; i++) {
                manager.validateConnectionLimits(mockReq, ip);
            }
            expect(manager.globalSSEConnections).toBe(5);
            expect(manager.sseConnections.get(ip)).toBe(5);

            // Try to exceed per-IP limit
            const result = manager.validateConnectionLimits(mockReq, ip);
            expect(result).not.toBeNull();
            expect(result.status).toBe(429);

            // SEC-006: Both counters should be correctly maintained
            expect(manager.globalSSEConnections).toBe(5);
            expect(manager.sseConnections.get(ip)).toBe(5);
        });

        test('should not increment per-IP counter when global limit is hit', () => {
            // Fill global limit from different IPs
            for (let i = 0; i < GLOBAL_LIMIT; i++) {
                const ip = `192.168.1.${100 + i}`;
                manager.validateConnectionLimits(mockReq, ip);
            }

            const newIp = '192.168.1.200';
            const initialPerIP = manager.sseConnections.get(newIp) || 0;

            // Try to add one more (should fail global limit)
            const result = manager.validateConnectionLimits(mockReq, newIp);
            expect(result).not.toBeNull();
            expect(result.status).toBe(503);

            // SEC-006: Per-IP counter should never have been incremented
            // (global check happens first, so per-IP increment never happens)
            const finalPerIP = manager.sseConnections.get(newIp) || 0;
            expect(finalPerIP).toBe(initialPerIP);
            expect(manager.globalSSEConnections).toBe(GLOBAL_LIMIT);
        });
    });

    describe('Edge cases', () => {
        test('should handle limit of 1 correctly', () => {
            const smallManager = new SSEConnectionManager({
                maxConnectionsPerIP: 1,
                globalLimit: 1,
                keepaliveInterval: 30000,
            });

            const ip = '192.168.1.1';

            // First should succeed
            const result1 = smallManager.validateConnectionLimits(mockReq, ip);
            expect(result1).toBeNull();

            // Second should fail
            const result2 = smallManager.validateConnectionLimits(mockReq, ip);
            expect(result2).not.toBeNull();

            // Counters should be exactly 1
            expect(smallManager.globalSSEConnections).toBe(1);
            expect(smallManager.sseConnections.get(ip)).toBe(1);
        });

        test('should handle limit of 0 correctly (reject all)', () => {
            const zeroManager = new SSEConnectionManager({
                maxConnectionsPerIP: 5,
                globalLimit: 0,
                keepaliveInterval: 30000,
            });

            const ip = '192.168.1.1';

            // Should immediately reject (increment to 1, check 1 > 0, rollback to 0)
            const result = zeroManager.validateConnectionLimits(mockReq, ip);
            expect(result).not.toBeNull();
            expect(result.status).toBe(503);
            expect(zeroManager.globalSSEConnections).toBe(0);
        });

        test('should handle very large limits', () => {
            const largeManager = new SSEConnectionManager({
                maxConnectionsPerIP: 1000,
                globalLimit: 1000,
                keepaliveInterval: 30000,
            });

            const ip = '192.168.1.1';

            // Should accept many connections
            for (let i = 0; i < 100; i++) {
                const result = largeManager.validateConnectionLimits(mockReq, ip);
                expect(result).toBeNull();
            }

            expect(largeManager.globalSSEConnections).toBe(100);
            expect(largeManager.sseConnections.get(ip)).toBe(100);
        });
    });

    describe('Counter invariants', () => {
        test('global counter should never exceed global limit', () => {
            // Try to create way more connections than limit
            for (let i = 0; i < GLOBAL_LIMIT * 2; i++) {
                const ip = `192.168.1.${100 + i}`;
                manager.validateConnectionLimits(mockReq, ip);

                // SEC-006: Invariant must hold at all times
                expect(manager.globalSSEConnections).toBeLessThanOrEqual(GLOBAL_LIMIT);
            }
        });

        test('per-IP counter should never exceed per-IP limit', () => {
            const ip = '192.168.1.100';

            // Try to create way more connections than limit
            for (let i = 0; i < MAX_CONNECTIONS_PER_IP * 2; i++) {
                manager.validateConnectionLimits(mockReq, ip);

                // SEC-006: Invariant must hold at all times
                const ipCount = manager.sseConnections.get(ip) || 0;
                expect(ipCount).toBeLessThanOrEqual(MAX_CONNECTIONS_PER_IP);
            }
        });

        test('global counter should equal sum of per-IP counters', () => {
            const ips = ['192.168.1.1', '192.168.1.2', '192.168.1.3'];

            // Create various connections
            for (let i = 0; i < 3; i++) {
                manager.validateConnectionLimits(mockReq, ips[0]);
            }
            for (let i = 0; i < 2; i++) {
                manager.validateConnectionLimits(mockReq, ips[1]);
            }
            for (let i = 0; i < 4; i++) {
                manager.validateConnectionLimits(mockReq, ips[2]);
            }

            // SEC-006: Global should equal sum of per-IP
            let sum = 0;
            ips.forEach(ip => {
                sum += manager.sseConnections.get(ip) || 0;
            });
            expect(manager.globalSSEConnections).toBe(sum);
        });
    });
});
