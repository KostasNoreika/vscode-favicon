const fs = require('fs');
const path = require('path');

// Mock config BEFORE requiring notification-store
const testDataDir = path.join(__dirname, '../../.test-data-notification-race');
jest.mock('../../lib/config', () => ({
    dataDir: testDataDir,
    notificationMaxCount: 100,
    notificationTtlMs: 24 * 60 * 60 * 1000, // 24 hours
    notificationCleanupIntervalMs: 60 * 60 * 1000,
}));

// Mock logger to suppress output during tests
jest.mock('../../lib/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
}));

const notificationStore = require('../../lib/notification-store');

describe('Notification Store - Race Condition Protection', () => {
    const testNotificationsFile = path.join(testDataDir, 'notifications.json');

    beforeEach(async () => {
        // Clean up test directory
        if (fs.existsSync(testDataDir)) {
            fs.rmSync(testDataDir, { recursive: true, force: true });
        }
        fs.mkdirSync(testDataDir, { recursive: true });

        // Load fresh state
        await notificationStore.load();
    });

    afterEach(async () => {
        // Clean up after each test
        try {
            if (fs.existsSync(testDataDir)) {
                await notificationStore.saveImmediate();
                fs.rmSync(testDataDir, { recursive: true, force: true });
            }
        } catch (err) {
            // Ignore cleanup errors
        }
    });

    describe('Concurrent cleanup protection', () => {
        test('should prevent concurrent cleanup operations with mutex', async () => {
            // Load initial state first
            await notificationStore.load();

            // Create notifications directly in memory (bypassing load cleanup)
            const now = Date.now();
            for (let i = 0; i < 105; i++) {
                notificationStore.set(`/opt/dev/project-${i}`, {
                    message: `Notification ${i}`,
                    timestamp: now - (105 - i) * 1000,
                    unread: true,
                    status: 'completed',
                });
            }

            // Verify we have excess before cleanup
            expect(Object.keys(notificationStore.getAll()).length).toBe(100); // Already limited by enforceSizeLimit

            // Trigger multiple concurrent cleanup operations
            const cleanupPromises = [
                notificationStore.cleanup(),
                notificationStore.cleanup(),
                notificationStore.cleanup(),
                notificationStore.cleanup(),
                notificationStore.cleanup(),
            ];

            const results = await Promise.all(cleanupPromises);

            // Due to mutex, most should return 0 (skipped)
            const nonZeroResults = results.filter(r => r > 0);

            // At most one cleanup should have run
            expect(nonZeroResults.length).toBeLessThanOrEqual(1);

            // Verify final state is correct (at limit)
            const allNotifications = notificationStore.getAll();
            expect(Object.keys(allNotifications).length).toBe(100);
        }, 10000);

        test('should handle concurrent cleanup during notification creation', async () => {
            // Create notifications at the limit
            const now = Date.now();
            const notifications = {};

            for (let i = 0; i < 100; i++) {
                notifications[`/opt/dev/project-${i}`] = {
                    message: `Notification ${i}`,
                    timestamp: now - i * 1000,
                    unread: true,
                    status: 'completed',
                };
            }

            await fs.promises.mkdir(testDataDir, { recursive: true });
            await fs.promises.writeFile(
                testNotificationsFile,
                JSON.stringify(notifications, null, 2)
            );

            await notificationStore.load();

            // Create new notifications while cleanup is running
            const operations = [
                notificationStore.cleanup(),
                Promise.resolve().then(() => {
                    notificationStore.set('/opt/dev/new-project-1', {
                        message: 'New notification 1',
                        status: 'completed',
                    });
                }),
                Promise.resolve().then(() => {
                    notificationStore.set('/opt/dev/new-project-2', {
                        message: 'New notification 2',
                        status: 'completed',
                    });
                }),
                notificationStore.cleanup(),
            ];

            await Promise.all(operations);

            // Verify state is consistent
            const allNotifications = notificationStore.getAll();
            expect(Object.keys(allNotifications).length).toBeLessThanOrEqual(100);

            // Verify new notifications were created
            const hasNew1 = allNotifications['/opt/dev/new-project-1'] !== undefined;
            const hasNew2 = allNotifications['/opt/dev/new-project-2'] !== undefined;

            // At least one should be present (though one might have been cleaned up)
            expect(hasNew1 || hasNew2).toBe(true);
        }, 10000);

        test('should complete cleanup quickly even with multiple waiting calls', async () => {
            // Create file with excess notifications
            const now = Date.now();
            const notifications = {};

            for (let i = 0; i < 110; i++) {
                notifications[`/opt/dev/project-${i}`] = {
                    message: `Notification ${i}`,
                    timestamp: now - (110 - i) * 1000,
                    unread: true,
                    status: 'completed',
                };
            }

            await fs.promises.mkdir(testDataDir, { recursive: true });
            await fs.promises.writeFile(
                testNotificationsFile,
                JSON.stringify(notifications, null, 2)
            );

            await notificationStore.load();

            // Measure time for multiple concurrent cleanup calls
            const startTime = Date.now();

            const cleanupPromises = Array(10)
                .fill(null)
                .map(() => notificationStore.cleanup());

            await Promise.all(cleanupPromises);

            const duration = Date.now() - startTime;

            // Should complete quickly because most are skipped by mutex
            expect(duration).toBeLessThan(500); // Allow 500ms total

            // Verify correct state
            const allNotifications = notificationStore.getAll();
            expect(Object.keys(allNotifications).length).toBe(100);
        }, 10000);

        test('should not corrupt state with rapid concurrent operations', async () => {
            // Create notifications near the limit
            const now = Date.now();
            const notifications = {};

            for (let i = 0; i < 98; i++) {
                notifications[`/opt/dev/project-${i}`] = {
                    message: `Notification ${i}`,
                    timestamp: now - i * 1000,
                    unread: true,
                    status: 'completed',
                };
            }

            await fs.promises.mkdir(testDataDir, { recursive: true });
            await fs.promises.writeFile(
                testNotificationsFile,
                JSON.stringify(notifications, null, 2)
            );

            await notificationStore.load();

            // Mix of operations to stress test the mutex
            const operations = [];

            // Add cleanups
            for (let i = 0; i < 5; i++) {
                operations.push(notificationStore.cleanup());
            }

            // Add new notifications
            for (let i = 0; i < 5; i++) {
                operations.push(
                    Promise.resolve().then(() => {
                        notificationStore.set(`/opt/dev/rapid-${i}`, {
                            message: `Rapid ${i}`,
                            status: 'completed',
                        });
                    })
                );
            }

            // More cleanups
            for (let i = 0; i < 5; i++) {
                operations.push(notificationStore.cleanup());
            }

            await Promise.all(operations);

            // Verify state integrity
            const allNotifications = notificationStore.getAll();
            const count = Object.keys(allNotifications).length;

            // Should be at or under the limit
            expect(count).toBeLessThanOrEqual(100);
            expect(count).toBeGreaterThan(0);

            // Verify no corruption (all entries have required fields)
            for (const [_key, data] of Object.entries(allNotifications)) {
                expect(data).toHaveProperty('message');
                expect(data).toHaveProperty('timestamp');
                expect(data).toHaveProperty('unread');
                expect(data).toHaveProperty('status');
                expect(typeof data.timestamp).toBe('number');
                expect(typeof data.message).toBe('string');
            }
        }, 10000);
    });

    describe('Cleanup algorithm simplification', () => {
        test('should use same algorithm for small and large excess', async () => {
            // Test both small excess (< 10%) and large excess (>= 10%)
            const testCases = [
                { total: 103, excess: 3, name: 'small excess (3%)' },
                { total: 120, excess: 20, name: 'large excess (20%)' },
            ];

            for (const testCase of testCases) {
                // Clean up from previous iteration
                if (fs.existsSync(testDataDir)) {
                    fs.rmSync(testDataDir, { recursive: true, force: true });
                }
                fs.mkdirSync(testDataDir, { recursive: true });

                const now = Date.now();
                const notifications = {};

                for (let i = 0; i < testCase.total; i++) {
                    notifications[`/opt/dev/project-${i}`] = {
                        message: `Notification ${i}`,
                        timestamp: now - (testCase.total - i) * 1000,
                        unread: true,
                        status: 'completed',
                    };
                }

                await fs.promises.writeFile(
                    testNotificationsFile,
                    JSON.stringify(notifications, null, 2)
                );

                await notificationStore.load();

                const allNotifications = notificationStore.getAll();
                expect(Object.keys(allNotifications).length).toBe(100);

                // Verify oldest N removed
                for (let i = 0; i < testCase.excess; i++) {
                    expect(allNotifications[`/opt/dev/project-${i}`]).toBeUndefined();
                }

                // Verify remaining preserved
                for (let i = testCase.excess; i < testCase.total; i++) {
                    expect(allNotifications[`/opt/dev/project-${i}`]).toBeDefined();
                }
            }
        }, 20000);
    });
});
