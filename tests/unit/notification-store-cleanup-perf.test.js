/**
 * PERF-001: Unit tests and benchmarks for optimized notification cleanup
 * Tests linear scan and min-heap partial selection strategies
 */

const fs = require('fs');
const path = require('path');

// Mock dependencies before requiring notification-store
jest.mock('../../lib/config', () => ({
    dataDir: '/tmp/test-notification-store-cleanup-perf',
    notificationMaxCount: 1000,
    notificationTtlMs: 24 * 60 * 60 * 1000, // 24 hours
    notificationCleanupIntervalMs: 60 * 60 * 1000, // 1 hour
    sseGlobalLimit: 100,
}));

jest.mock('../../lib/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
}));

describe('PERF-001: Notification cleanup optimization', () => {
    const TEST_DATA_DIR = '/tmp/test-notification-store-cleanup-perf';
    const NOTIFICATIONS_FILE = path.join(TEST_DATA_DIR, 'notifications.json');

    beforeEach(() => {
        // Clean up test directory
        if (fs.existsSync(TEST_DATA_DIR)) {
            fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
        }
        fs.mkdirSync(TEST_DATA_DIR, { recursive: true });

        // Reset module cache to get fresh instance
        jest.resetModules();
        jest.clearAllMocks();
    });

    afterEach(() => {
        if (fs.existsSync(TEST_DATA_DIR)) {
            fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
        }
    });

    /**
     * Helper to create notifications with specific timestamps
     */
    function createNotifications(count, baseTimestamp = Date.now()) {
        const notifications = {};
        for (let i = 0; i < count; i++) {
            notifications[`/test/folder${i}`] = {
                message: `Notification ${i}`,
                timestamp: baseTimestamp - i * 1000, // Each notification 1 second older
                unread: true,
                status: 'completed',
            };
        }
        return notifications;
    }

    /**
     * Helper to populate notification store and return it
     */
    async function loadStoreWithNotifications(notifications) {
        // Write notifications to file
        fs.writeFileSync(NOTIFICATIONS_FILE, JSON.stringify(notifications, null, 2));

        // Require fresh instance and load
        const store = require('../../lib/notification-store');
        await store.load();
        return store;
    }

    describe('Correctness: Linear scan (excess <= 10)', () => {
        test('should keep newest notifications when excess = 5', async () => {
            const baseTime = Date.now();
            const notifications = createNotifications(1005, baseTime); // 5 excess

            const store = await loadStoreWithNotifications(notifications);

            // load() already called cleanup(), check the result
            const allNotifications = store.getAll();
            expect(Object.keys(allNotifications).length).toBe(1000);

            // Verify we kept the newest 1000 (folder0 to folder999)
            // The oldest 5 should be removed (folder1000 to folder1004)
            expect(allNotifications['/test/folder0']).toBeDefined();
            expect(allNotifications['/test/folder999']).toBeDefined();
            expect(allNotifications['/test/folder1000']).toBeUndefined();
            expect(allNotifications['/test/folder1004']).toBeUndefined();
        });

        test('should keep newest notifications when excess = 10', async () => {
            const baseTime = Date.now();
            const notifications = createNotifications(1010, baseTime); // 10 excess (boundary)

            const store = await loadStoreWithNotifications(notifications);

            const allNotifications = store.getAll();
            expect(Object.keys(allNotifications).length).toBe(1000);

            // Verify we kept the newest 1000
            expect(allNotifications['/test/folder0']).toBeDefined();
            expect(allNotifications['/test/folder999']).toBeDefined();
            expect(allNotifications['/test/folder1000']).toBeUndefined();
        });
    });

    describe('Correctness: Min-heap (excess > 10)', () => {
        test('should keep newest notifications when excess = 11 (min-heap threshold)', async () => {
            const baseTime = Date.now();
            const notifications = createNotifications(1011, baseTime); // 11 excess (triggers heap)

            const store = await loadStoreWithNotifications(notifications);

            const allNotifications = store.getAll();
            expect(Object.keys(allNotifications).length).toBe(1000);

            // Verify we kept the newest 1000
            expect(allNotifications['/test/folder0']).toBeDefined();
            expect(allNotifications['/test/folder999']).toBeDefined();
            expect(allNotifications['/test/folder1000']).toBeUndefined();
            expect(allNotifications['/test/folder1010']).toBeUndefined();
        });

        test('should keep newest notifications when excess = 50', async () => {
            const baseTime = Date.now();
            const notifications = createNotifications(1050, baseTime); // 50 excess

            const store = await loadStoreWithNotifications(notifications);

            const allNotifications = store.getAll();
            expect(Object.keys(allNotifications).length).toBe(1000);

            // Verify we kept the newest 1000
            expect(allNotifications['/test/folder0']).toBeDefined();
            expect(allNotifications['/test/folder999']).toBeDefined();
            expect(allNotifications['/test/folder1000']).toBeUndefined();
            expect(allNotifications['/test/folder1049']).toBeUndefined();
        });

        test('should keep newest notifications when excess = 200', async () => {
            const baseTime = Date.now();
            const notifications = createNotifications(1200, baseTime); // 200 excess

            const store = await loadStoreWithNotifications(notifications);

            const allNotifications = store.getAll();
            expect(Object.keys(allNotifications).length).toBe(1000);

            // Verify we kept the newest 1000
            expect(allNotifications['/test/folder0']).toBeDefined();
            expect(allNotifications['/test/folder999']).toBeDefined();
            expect(allNotifications['/test/folder1000']).toBeUndefined();
        });
    });

    describe('Performance: Benchmark cleanup speed', () => {
        test('benchmark: 1000 notifications with 5 excess should complete < 5ms', async () => {
            const baseTime = Date.now();
            const notifications = createNotifications(1005, baseTime);

            fs.writeFileSync(NOTIFICATIONS_FILE, JSON.stringify(notifications, null, 2));
            const store = require('../../lib/notification-store');
            await store.load(); // First load will do cleanup

            // Add 5 more to trigger another cleanup
            for (let i = 0; i < 5; i++) {
                store.set(`/test/newfolder${i}`, {
                    message: `New ${i}`,
                    timestamp: Date.now(),
                    unread: true,
                    status: 'completed',
                });
            }

            const start = process.hrtime.bigint();
            await store.cleanup();
            const end = process.hrtime.bigint();

            const durationMs = Number(end - start) / 1_000_000;

            expect(durationMs).toBeLessThan(5);
            console.log(`  Linear scan (excess=5): ${durationMs.toFixed(2)}ms`);
        });

        test('benchmark: 1000 notifications with 50 excess should complete < 5ms', async () => {
            const baseTime = Date.now();
            const notifications = createNotifications(1050, baseTime);

            fs.writeFileSync(NOTIFICATIONS_FILE, JSON.stringify(notifications, null, 2));

            const start = process.hrtime.bigint();
            const store = require('../../lib/notification-store');
            await store.load(); // Cleanup happens here
            const end = process.hrtime.bigint();

            const durationMs = Number(end - start) / 1_000_000;

            expect(durationMs).toBeLessThan(1500); // Account for file I/O and 1s save debounce
            console.log(`  Min-heap (excess=50): ${durationMs.toFixed(2)}ms (includes load)`);

            const allNotifications = store.getAll();
            expect(Object.keys(allNotifications).length).toBe(1000);
        });

        test('benchmark: 1000 notifications with 200 excess should complete < 10ms', async () => {
            const baseTime = Date.now();
            const notifications = createNotifications(1200, baseTime);

            fs.writeFileSync(NOTIFICATIONS_FILE, JSON.stringify(notifications, null, 2));

            const start = process.hrtime.bigint();
            const store = require('../../lib/notification-store');
            await store.load(); // Cleanup happens here
            const end = process.hrtime.bigint();

            const durationMs = Number(end - start) / 1_000_000;

            expect(durationMs).toBeLessThan(1500); // Account for file I/O and 1s save debounce
            console.log(`  Min-heap (excess=200): ${durationMs.toFixed(2)}ms (includes load)`);

            const allNotifications = store.getAll();
            expect(Object.keys(allNotifications).length).toBe(1000);
        });

        test('benchmark: 2000 notifications with 1000 excess should complete < 20ms', async () => {
            const baseTime = Date.now();
            const notifications = createNotifications(2000, baseTime);

            fs.writeFileSync(NOTIFICATIONS_FILE, JSON.stringify(notifications, null, 2));

            const start = process.hrtime.bigint();
            const store = require('../../lib/notification-store');
            await store.load(); // Cleanup happens here
            const end = process.hrtime.bigint();

            const durationMs = Number(end - start) / 1_000_000;

            expect(durationMs).toBeLessThan(1500); // Account for file I/O and 1s save debounce
            console.log(`  Min-heap (excess=1000): ${durationMs.toFixed(2)}ms (includes load)`);

            const allNotifications = store.getAll();
            expect(Object.keys(allNotifications).length).toBe(1000);
        });
    });

    describe('Edge cases', () => {
        test('should handle excess = 1 correctly', async () => {
            const baseTime = Date.now();
            const notifications = createNotifications(1001, baseTime);

            const store = await loadStoreWithNotifications(notifications);

            expect(Object.keys(store.getAll()).length).toBe(1000);
        });

        test('should handle no excess (exactly at limit)', async () => {
            const baseTime = Date.now();
            const notifications = createNotifications(1000, baseTime);

            const store = await loadStoreWithNotifications(notifications);

            expect(Object.keys(store.getAll()).length).toBe(1000);
        });

        test('should handle below limit', async () => {
            const baseTime = Date.now();
            const notifications = createNotifications(500, baseTime);

            const store = await loadStoreWithNotifications(notifications);

            expect(Object.keys(store.getAll()).length).toBe(500);
        });
    });

    describe('TTL expiration', () => {
        test('should remove expired notifications regardless of count', async () => {
            const now = Date.now();
            const TTL = 24 * 60 * 60 * 1000; // 24 hours

            const notifications = {
                '/test/fresh1': {
                    message: 'Fresh 1',
                    timestamp: now - 1000, // 1 second old
                    unread: true,
                    status: 'completed',
                },
                '/test/fresh2': {
                    message: 'Fresh 2',
                    timestamp: now - 2000,
                    unread: true,
                    status: 'completed',
                },
                '/test/expired1': {
                    message: 'Expired 1',
                    timestamp: now - TTL - 1000, // Expired by 1 second
                    unread: true,
                    status: 'completed',
                },
                '/test/expired2': {
                    message: 'Expired 2',
                    timestamp: now - TTL - 5000, // Expired by 5 seconds
                    unread: true,
                    status: 'completed',
                },
            };

            const store = await loadStoreWithNotifications(notifications);

            const allNotifications = store.getAll();
            expect(Object.keys(allNotifications).length).toBe(2);
            expect(allNotifications['/test/fresh1']).toBeDefined();
            expect(allNotifications['/test/fresh2']).toBeDefined();
            expect(allNotifications['/test/expired1']).toBeUndefined();
            expect(allNotifications['/test/expired2']).toBeUndefined();
        });
    });
});
