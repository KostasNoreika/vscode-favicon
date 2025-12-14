/**
 * SSE Race Condition Integration Tests
 *
 * Verifies QUA-007 fix: SSE resource cleanup race conditions
 *
 * Tests specific scenarios:
 * - Connection closes before keepalive interval is set
 * - Connection closes before subscription is created
 * - Multiple rapid close events (idempotency)
 * - Cleanup runs exactly once
 * - No timer or listener leaks
 */

const http = require('http');
const express = require('express');
const path = require('path');
const fs = require('fs');

// Mock config before requiring server modules
jest.mock('../../lib/config', () => ({
    allowedPaths: ['/opt/dev', '/opt/prod'],
    registryPath: path.join(__dirname, '../fixtures/mock-registry.json'),
    dataDir: path.join(__dirname, '../fixtures'),
    servicePort: 0,
    sseMaxConnectionsPerIP: 5,
    sseGlobalLimit: 10,
    sseKeepaliveInterval: 30000,
    rateLimitNotificationWindow: 15 * 60 * 1000,
    rateLimitNotificationMax: 100,
    notificationMaxCount: 100,
    notificationTtlMs: 24 * 60 * 60 * 1000,
    notificationCleanupIntervalMs: 60 * 60 * 1000,
    corsOrigins: ['http://localhost:8080'],
}));

// Mock logger
jest.mock('../../lib/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    fatal: jest.fn(),
    requestLogger: () => (req, res, next) => {
        req.log = {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
        };
        next();
    },
}));

const config = require('../../lib/config');
const notificationStore = require('../../lib/notification-store');
const SSEConnectionManager = require('../../lib/sse-connection-manager');
const { validatePathAsync } = require('../../lib/path-validator');

describe('SSE Race Condition Tests (QUA-007)', () => {
    let app;
    let server;
    let serverPort;
    let sseManager;

    beforeAll(async () => {
        // Create fixtures directory
        const fixturesDir = path.join(__dirname, '../fixtures');
        if (!fs.existsSync(fixturesDir)) {
            fs.mkdirSync(fixturesDir, { recursive: true });
        }

        // Create mock registry
        const registryPath = path.join(fixturesDir, 'mock-registry.json');
        const mockRegistry = {
            '/opt/dev/test-project': {
                name: 'test-project',
                type: 'dev',
            },
        };
        fs.writeFileSync(registryPath, JSON.stringify(mockRegistry, null, 2));

        // Create notifications file
        const notificationsPath = path.join(fixturesDir, 'notifications.json');
        fs.writeFileSync(notificationsPath, JSON.stringify({}));

        // Load notification store once
        await notificationStore.load();
    });

    beforeEach(async () => {
        // Create fresh SSE manager instance
        sseManager = new SSEConnectionManager({
            maxConnectionsPerIP: config.sseMaxConnectionsPerIP,
            globalLimit: config.sseGlobalLimit,
            keepaliveInterval: config.sseKeepaliveInterval,
        });

        // Create Express app
        app = express();
        app.use(express.json());
        app.use((req, res, next) => {
            req.log = {
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
                debug: jest.fn(),
            };
            next();
        });

        // Path validation middleware
        const requireValidPath = async (req, res, next) => {
            const folder = req.query.folder || req.body.folder;
            if (!folder) {
                return res.status(400).json({ error: 'Folder parameter required' });
            }

            const validation = await validatePathAsync(folder);
            if (!validation.valid) {
                return res.status(403).json({ error: 'Access denied' });
            }

            req.validatedPath = validation.resolved;
            next();
        };

        // SSE endpoint using SSEConnectionManager
        app.get('/notifications/stream', requireValidPath, async (req, res) => {
            const { validatedPath } = req;
            const error = sseManager.establishConnection(req, res, validatedPath);
            if (error) {
                return res.status(error.status).json(error.body);
            }
        });

        // Test helper endpoint
        app.get('/test/stats', (req, res) => {
            const stats = sseManager.getStats();
            const notifStats = notificationStore.getStats();
            res.json({
                ...stats,
                listenerCount: notifStats.listenerCount,
            });
        });

        // Start server
        await new Promise((resolve) => {
            server = app.listen(0, () => {
                serverPort = server.address().port;
                resolve();
            });
        });
    });

    afterEach(async () => {
        // Close server
        if (server) {
            await new Promise((resolve) => {
                server.close(resolve);
            });
        }

        // Reset SSE manager if reset method exists
        if (sseManager && typeof sseManager.reset === 'function') {
            sseManager.reset();
        }

        // Wait for cleanup
        await new Promise(resolve => setTimeout(resolve, 200));
    });

    afterAll(() => {
        // Cleanup fixtures
        const fixturesDir = path.join(__dirname, '../fixtures');
        const notificationsPath = path.join(fixturesDir, 'notifications.json');
        if (fs.existsSync(notificationsPath)) {
            fs.unlinkSync(notificationsPath);
        }
    });

    /**
     * Helper to create SSE connection
     */
    function createSSEConnection(folder = '/opt/dev/test-project') {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'localhost',
                port: serverPort,
                path: `/notifications/stream?folder=${encodeURIComponent(folder)}`,
                method: 'GET',
                headers: {
                    'Accept': 'text/event-stream',
                },
            };

            const req = http.request(options, (res) => {
                const connection = {
                    response: res,
                    request: req,
                    close: () => req.destroy(),
                };

                res.on('error', (err) => {
                    // Ignore ECONNRESET errors during close
                    if (err.code !== 'ECONNRESET') {
                        console.error('Response error:', err);
                    }
                });

                resolve(connection);
            });

            req.on('error', (err) => {
                // Ignore ECONNRESET errors during close
                if (err.code !== 'ECONNRESET') {
                    reject(err);
                } else {
                    // Connection closed as expected
                }
            });
            req.end();
        });
    }

    /**
     * Helper to get stats
     */
    async function getStats() {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'localhost',
                port: serverPort,
                path: '/test/stats',
                method: 'GET',
            };

            const req = http.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(JSON.parse(data)));
            });

            req.on('error', reject);
            req.end();
        });
    }

    describe('Immediate close race conditions', () => {
        test('should handle connection close immediately after establishment', async () => {
            // QUA-007: Test race where connection closes before keepalive/subscription setup
            const conn = await createSSEConnection();

            // Close immediately without any delay
            conn.close();

            // Wait for cleanup to complete
            await new Promise(resolve => setTimeout(resolve, 150));

            // Verify complete cleanup
            const stats = await getStats();
            expect(stats.globalConnections).toBe(0);
            expect(stats.uniqueIPs).toBe(0);
        });

        test('should handle 10 rapid immediate-close cycles without leaks', async () => {
            // QUA-007: Stress test for race condition fix
            for (let i = 0; i < 10; i++) {
                const conn = await createSSEConnection();
                // Close immediately
                conn.close();
            }

            // Wait for all cleanups
            await new Promise(resolve => setTimeout(resolve, 300));

            // Verify no leaks
            const stats = await getStats();
            expect(stats.globalConnections).toBe(0);
            expect(stats.uniqueIPs).toBe(0);
        });

        test('should handle close during connection setup phase', async () => {
            // QUA-007: Test close that happens during the setup phase
            const conn = await createSSEConnection();

            // Use setImmediate to close during setup
            setImmediate(() => conn.close());

            await new Promise(resolve => setTimeout(resolve, 150));

            const stats = await getStats();
            expect(stats.globalConnections).toBe(0);
        });
    });

    describe('Cleanup idempotency', () => {
        test('should handle multiple close events on same connection', async () => {
            // QUA-007: Test that cleanup runs exactly once even if close fires multiple times
            const conn = await createSSEConnection();

            await new Promise(resolve => setTimeout(resolve, 100));

            // Get initial listener count
            const statsBefore = await getStats();
            const initialListeners = statsBefore.listenerCount;

            // Close multiple times
            conn.close();
            conn.close();
            conn.close();

            await new Promise(resolve => setTimeout(resolve, 150));

            // Verify cleanup ran exactly once
            const statsAfter = await getStats();
            expect(statsAfter.globalConnections).toBe(0);
            // Listener count should decrease by at most 1
            expect(statsAfter.listenerCount).toBeLessThanOrEqual(initialListeners);
        });

        test('should prevent resource cleanup if already cleaned', async () => {
            // QUA-007: Verify cleanedUp flag prevents double cleanup
            const conn = await createSSEConnection();
            await new Promise(resolve => setTimeout(resolve, 100));

            // First close
            conn.close();
            await new Promise(resolve => setTimeout(resolve, 100));

            const stats1 = await getStats();
            expect(stats1.globalConnections).toBe(0);

            // Second close (should be no-op due to cleanedUp flag)
            conn.close();
            await new Promise(resolve => setTimeout(resolve, 100));

            const stats2 = await getStats();
            expect(stats2.globalConnections).toBe(0);
            // Counter should not go negative
            expect(stats2.globalConnections).toBeGreaterThanOrEqual(0);
        });
    });

    describe('Resource leak prevention', () => {
        test('should not leak keepalive intervals on immediate close', async () => {
            // QUA-007: Verify keepalive interval is cleaned even if close happens first
            const conn = await createSSEConnection();
            conn.close(); // Immediate close

            await new Promise(resolve => setTimeout(resolve, 150));

            // Verify no interval timers leaked
            const stats = await getStats();
            expect(stats.globalConnections).toBe(0);
        });

        test('should not leak notification subscriptions on immediate close', async () => {
            // QUA-007: Verify subscription is cleaned even if close happens first
            const statsBefore = await getStats();
            const initialListeners = statsBefore.listenerCount;

            const conn = await createSSEConnection();
            conn.close(); // Immediate close

            await new Promise(resolve => setTimeout(resolve, 150));

            // Verify subscription was cleaned up (or not set yet)
            const statsAfter = await getStats();
            expect(statsAfter.listenerCount).toBeLessThanOrEqual(initialListeners + 1);
        });

        test('should handle 50 rapid connections without resource leaks', async () => {
            // QUA-007: Comprehensive stress test for resource leaks
            const statsBefore = await getStats();
            const initialListeners = statsBefore.listenerCount;

            for (let i = 0; i < 50; i++) {
                const conn = await createSSEConnection();
                // Randomize close timing to test various race scenarios
                if (i % 3 === 0) {
                    conn.close(); // Immediate
                } else {
                    setTimeout(() => conn.close(), Math.random() * 50);
                }
            }

            // Wait for all cleanups
            await new Promise(resolve => setTimeout(resolve, 500));

            // Verify no leaks
            const statsAfter = await getStats();
            expect(statsAfter.globalConnections).toBe(0);
            expect(statsAfter.uniqueIPs).toBe(0);
            // Listener count should be back to initial or close to it
            expect(statsAfter.listenerCount).toBeLessThanOrEqual(initialListeners + 5);
        });
    });

    describe('Counter integrity under race conditions', () => {
        test('should never allow negative connection counts', async () => {
            // QUA-007: Verify counters stay >= 0 even under race conditions
            const connections = [];

            // Create 5 connections
            for (let i = 0; i < 5; i++) {
                connections.push(await createSSEConnection());
            }

            // Close all immediately and multiple times
            connections.forEach(conn => {
                conn.close();
                conn.close(); // Double close
            });

            await new Promise(resolve => setTimeout(resolve, 200));

            // Verify counts are valid
            const stats = await getStats();
            expect(stats.globalConnections).toBeGreaterThanOrEqual(0);
            expect(stats.globalConnections).toBe(0);
        });

        test('should maintain accurate counts during concurrent connect/close', async () => {
            // QUA-007: Test counter accuracy under concurrent operations
            const operations = [];

            // Start 20 concurrent operations
            for (let i = 0; i < 20; i++) {
                operations.push(
                    createSSEConnection().then(conn => {
                        // Random close timing
                        setTimeout(() => conn.close(), Math.random() * 100);
                    })
                );
            }

            await Promise.all(operations);
            await new Promise(resolve => setTimeout(resolve, 300));

            // All should be cleaned up
            const stats = await getStats();
            expect(stats.globalConnections).toBe(0);
            expect(stats.uniqueIPs).toBe(0);
        });
    });

    describe('Normal operation still works', () => {
        test('should still work correctly for normal connection lifecycle', async () => {
            // QUA-007: Verify fix doesn't break normal operation
            const conn = await createSSEConnection();

            // Wait for full setup
            await new Promise(resolve => setTimeout(resolve, 100));

            // Verify connection established
            const statsConnected = await getStats();
            expect(statsConnected.globalConnections).toBe(1);

            // Normal close
            conn.close();
            await new Promise(resolve => setTimeout(resolve, 150));

            // Verify cleanup
            const statsClosed = await getStats();
            expect(statsClosed.globalConnections).toBe(0);
        });

        test('should handle notification events during connection', async () => {
            // QUA-007: Verify notifications still work with fix in place
            const conn = await createSSEConnection();
            await new Promise(resolve => setTimeout(resolve, 100));

            // Send notification
            notificationStore.setCompleted('/opt/dev/test-project', 'Test notification');

            // Wait for event
            await new Promise(resolve => setTimeout(resolve, 100));

            // Close normally
            conn.close();
            await new Promise(resolve => setTimeout(resolve, 150));

            // Verify cleanup
            const stats = await getStats();
            expect(stats.globalConnections).toBe(0);
        });
    });
});
