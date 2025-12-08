const fs = require('fs');
const path = require('path');

// Mock config BEFORE requiring notification-store
const testDataDir = path.join(__dirname, '../../.test-data-notification-save');
jest.mock('../../lib/config', () => ({
    dataDir: testDataDir,
    notificationMaxCount: 1000,
    notificationTtlMs: 24 * 60 * 60 * 1000,
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

describe('Notification Store - Save Race Condition Fix', () => {
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
        // Clean up after each test - ensure pending saves complete
        await notificationStore.saveImmediate();
        if (fs.existsSync(testDataDir)) {
            fs.rmSync(testDataDir, { recursive: true, force: true });
        }
    });

    describe('save() returns a Promise', () => {
        test('should return a Promise that resolves when save completes', async () => {
            // Set a notification (this calls save() internally)
            notificationStore.set('/opt/dev/project1', {
                message: 'Test notification',
                status: 'completed',
            });

            // Get the save promise (we'll need to access save directly)
            const savePromise = notificationStore.save();

            // Verify it's a Promise
            expect(savePromise).toBeInstanceOf(Promise);

            // Wait for the promise to resolve
            await savePromise;

            // Verify the file was written
            expect(fs.existsSync(testNotificationsFile)).toBe(true);

            // Verify the content
            const content = JSON.parse(fs.readFileSync(testNotificationsFile, 'utf8'));
            expect(content['/opt/dev/project1']).toBeDefined();
            expect(content['/opt/dev/project1'].message).toBe('Test notification');
        }, 10000);

        test('should resolve multiple save() calls with the same promise during debounce window', async () => {
            // Call save() multiple times in quick succession
            const promise1 = notificationStore.save();
            const promise2 = notificationStore.save();
            const promise3 = notificationStore.save();

            // All three should be the same promise (debounced)
            expect(promise2).toBe(promise1);
            expect(promise3).toBe(promise1);

            // Wait for them all to resolve
            await Promise.all([promise1, promise2, promise3]);

            // Verify only one save happened
            expect(fs.existsSync(testNotificationsFile)).toBe(true);
        }, 10000);

        test('should properly debounce saves - last call wins', async () => {
            // Set multiple notifications rapidly
            notificationStore.set('/opt/dev/project1', { message: 'First', status: 'completed' });
            await new Promise(resolve => setTimeout(resolve, 100)); // Wait 100ms

            notificationStore.set('/opt/dev/project2', { message: 'Second', status: 'completed' });
            await new Promise(resolve => setTimeout(resolve, 100)); // Wait 100ms

            notificationStore.set('/opt/dev/project3', { message: 'Third', status: 'completed' });

            // Get the current save promise and wait for it
            const savePromise = notificationStore.save();
            await savePromise;

            // All three notifications should be saved
            const content = JSON.parse(fs.readFileSync(testNotificationsFile, 'utf8'));
            expect(content['/opt/dev/project1']).toBeDefined();
            expect(content['/opt/dev/project2']).toBeDefined();
            expect(content['/opt/dev/project3']).toBeDefined();
        }, 10000);

        test('should handle cleanup() which awaits save()', async () => {
            // Set a notification with old timestamp (will be cleaned up)
            const oldTimestamp = Date.now() - (25 * 60 * 60 * 1000); // 25 hours ago
            notificationStore.set('/opt/dev/old-project', {
                message: 'Old notification',
                status: 'completed',
                timestamp: oldTimestamp,
            });

            // Wait for initial save
            await notificationStore.saveImmediate();

            // Set a fresh notification
            notificationStore.set('/opt/dev/new-project', {
                message: 'New notification',
                status: 'completed',
            });

            // Run cleanup - this should remove old notification and save
            const removed = await notificationStore.cleanup();

            // Should have removed the old one
            expect(removed).toBe(1);

            // Verify the file contains only the new notification
            const content = JSON.parse(fs.readFileSync(testNotificationsFile, 'utf8'));
            expect(content['/opt/dev/old-project']).toBeUndefined();
            expect(content['/opt/dev/new-project']).toBeDefined();
        }, 10000);
    });

    describe('saveImmediate() with pending saves', () => {
        test('should resolve pending save promises when saveImmediate() is called', async () => {
            // Set a notification (triggers debounced save)
            notificationStore.set('/opt/dev/project1', {
                message: 'Test notification',
                status: 'completed',
            });

            // Get the pending save promise
            const savePromise = notificationStore.save();

            // Immediately call saveImmediate (before debounce timeout fires)
            await notificationStore.saveImmediate();

            // The pending promise should also resolve
            await savePromise;

            // Verify the file was written
            const content = JSON.parse(fs.readFileSync(testNotificationsFile, 'utf8'));
            expect(content['/opt/dev/project1']).toBeDefined();
        }, 10000);
    });

    describe('Backward compatibility', () => {
        test('should not break existing callers that dont await save()', async () => {
            // This mimics the existing behavior where save() is called but not awaited
            notificationStore.set('/opt/dev/project1', {
                message: 'Test notification',
                status: 'completed',
            });

            // Don't await - just let it save in background
            // Wait for debounce + a bit more
            await new Promise(resolve => setTimeout(resolve, 1500));

            // Verify the file was written
            expect(fs.existsSync(testNotificationsFile)).toBe(true);
            const content = JSON.parse(fs.readFileSync(testNotificationsFile, 'utf8'));
            expect(content['/opt/dev/project1']).toBeDefined();
        }, 10000);
    });
});
