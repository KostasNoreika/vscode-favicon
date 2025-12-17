/**
 * Unit tests for extension notification-poller module
 */

// Mock tab-manager module before requiring poller
jest.mock('../../vscode-favicon-extension/modules/tab-manager', () => ({
    getNotificationsVersion: jest.fn((notifications) => {
        if (!notifications || !Array.isArray(notifications) || notifications.length === 0) {
            return '';
        }
        return notifications
            .filter(n => n.folder)
            .map(n => `${n.folder}:${n.timestamp}`)
            .sort()
            .join('|');
    }),
}));

const { createNotificationPoller } = require('../../vscode-favicon-extension/modules/notification-poller');

// Mock chrome.alarms
global.chrome = {
    alarms: {
        create: jest.fn(),
    },
};

// Mock fetch
global.fetch = jest.fn();

// Mock console
global.console = {
    ...console,
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
};

describe('notification-poller', () => {
    let mockCircuitBreaker;
    let mockDeps;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();

        mockCircuitBreaker = {
            shouldAllowRequest: jest.fn(() => ({ allowed: true })),
            recordSuccess: jest.fn(),
            recordFailure: jest.fn(),
        };

        mockDeps = {
            circuitBreaker: mockCircuitBreaker,
            getApiBase: () => 'https://test-api.example.com',
            saveNotifications: jest.fn(),
            broadcastNotifications: jest.fn(),
        };
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('setupPolling', () => {
        it('should create chrome alarm', async () => {
            const poller = createNotificationPoller(mockDeps);
            await poller.setupPolling();

            expect(chrome.alarms.create).toHaveBeenCalledWith('pollNotifications', {
                periodInMinutes: 1,
            });
        });

        it('should use custom poll interval', async () => {
            const poller = createNotificationPoller(mockDeps, {
                POLL_INTERVAL_MINUTES: 5,
            });
            await poller.setupPolling();

            expect(chrome.alarms.create).toHaveBeenCalledWith('pollNotifications', {
                periodInMinutes: 5,
            });
        });

        it('should log polling setup', async () => {
            const poller = createNotificationPoller(mockDeps);
            await poller.setupPolling();

            expect(console.log).toHaveBeenCalledWith(
                'Notification Poller: Polling alarm set for every',
                1,
                'minute(s)'
            );
        });
    });

    describe('fetchNotifications', () => {
        it('should fetch and update notifications on success', async () => {
            const mockNotifications = [
                { folder: '/opt/dev/test', timestamp: 123456 },
            ];

            fetch.mockResolvedValue({
                ok: true,
                json: async () => ({ notifications: mockNotifications }),
            });

            const poller = createNotificationPoller(mockDeps);
            await poller.fetchNotifications();

            expect(fetch).toHaveBeenCalledWith(
                'https://test-api.example.com/api/notifications/unread',
                expect.objectContaining({ method: 'GET' })
            );
            expect(mockCircuitBreaker.recordSuccess).toHaveBeenCalled();
            expect(mockDeps.saveNotifications).toHaveBeenCalledWith(mockNotifications);
            expect(mockDeps.broadcastNotifications).toHaveBeenCalled();
        });

        it('should record failure on non-OK response', async () => {
            fetch.mockResolvedValue({
                ok: false,
                status: 500,
            });

            const poller = createNotificationPoller(mockDeps);
            await poller.fetchNotifications();

            expect(mockCircuitBreaker.recordFailure).toHaveBeenCalled();
            expect(console.log).toHaveBeenCalledWith('Notification Poller: API returned error:', 500);
        });

        it('should record failure on fetch error', async () => {
            fetch.mockRejectedValue(new Error('Network error'));

            const poller = createNotificationPoller(mockDeps);
            await poller.fetchNotifications();

            expect(mockCircuitBreaker.recordFailure).toHaveBeenCalled();
            expect(console.log).toHaveBeenCalledWith('Notification Poller: Fetch error:', 'Network error');
        });

        it('should respect circuit breaker', async () => {
            mockCircuitBreaker.shouldAllowRequest.mockReturnValue({
                allowed: false,
                reason: 'Circuit OPEN',
            });

            const poller = createNotificationPoller(mockDeps);
            await poller.fetchNotifications();

            expect(fetch).not.toHaveBeenCalled();
            expect(console.log).toHaveBeenCalledWith('Notification Poller: Request blocked -', 'Circuit OPEN');
        });

        it('should log when probing in half-open state', async () => {
            mockCircuitBreaker.shouldAllowRequest.mockReturnValue({
                allowed: true,
                probing: true,
            });

            fetch.mockResolvedValue({
                ok: true,
                json: async () => ({ notifications: [] }),
            });

            const poller = createNotificationPoller(mockDeps);
            await poller.fetchNotifications();

            expect(console.log).toHaveBeenCalledWith('Notification Poller: Probing API - testing recovery');
        });

        it('should not save if notifications unchanged', async () => {
            const mockNotifications = [
                { folder: '/opt/dev/test', timestamp: 123456 },
            ];

            fetch.mockResolvedValue({
                ok: true,
                json: async () => ({ notifications: mockNotifications }),
            });

            const poller = createNotificationPoller(mockDeps);

            // First fetch - should save
            await poller.fetchNotifications();
            expect(mockDeps.saveNotifications).toHaveBeenCalledTimes(1);

            // Second fetch with same data - should not save
            mockDeps.saveNotifications.mockClear();
            await poller.fetchNotifications();
            expect(mockDeps.saveNotifications).not.toHaveBeenCalled();
        });

        it('should handle AbortError specially', async () => {
            const abortError = new Error('Request timeout');
            abortError.name = 'AbortError';
            fetch.mockRejectedValue(abortError);

            const poller = createNotificationPoller(mockDeps);
            await poller.fetchNotifications();

            expect(mockCircuitBreaker.recordFailure).toHaveBeenCalled();
            expect(console.log).toHaveBeenCalledWith('Notification Poller: Fetch timeout');
        });

        it('should use AbortController with timeout', async () => {
            let capturedSignal;
            fetch.mockImplementation((url, options) => {
                capturedSignal = options.signal;
                return Promise.resolve({
                    ok: true,
                    json: async () => ({ notifications: [] }),
                });
            });

            const poller = createNotificationPoller(mockDeps, {
                API_TIMEOUT: 5000,
            });
            await poller.fetchNotifications();

            expect(capturedSignal).toBeDefined();
            expect(capturedSignal).toBeInstanceOf(AbortSignal);
        });

        it('should abort request on timeout', async () => {
            let capturedSignal;
            fetch.mockImplementation((_url, options) => {
                capturedSignal = options.signal;
                // Simulate long-running request that respects abort signal
                return new Promise((resolve, reject) => {
                    // Listen for abort signal
                    if (options.signal) {
                        options.signal.addEventListener('abort', () => {
                            reject(new DOMException('Aborted', 'AbortError'));
                        });
                    }
                    // Simulate request that would take longer than timeout
                    setTimeout(() => {
                        resolve({
                            ok: true,
                            json: async () => ({ notifications: [] }),
                        });
                    }, 15000);
                });
            });

            const poller = createNotificationPoller(mockDeps, {
                API_TIMEOUT: 100, // Use short timeout for testing
            });

            // Start fetch but don't await - it will fail due to timeout
            const fetchPromise = poller.fetchNotifications();

            // Advance time past timeout
            jest.advanceTimersByTime(200);

            // Wait for fetch to complete (should fail due to abort)
            await fetchPromise;

            // Should have received the abort signal
            expect(capturedSignal).toBeDefined();
            expect(capturedSignal).toBeInstanceOf(AbortSignal);
            // After timeout, the signal should be aborted
            expect(capturedSignal.aborted).toBe(true);
        });

        it('should handle empty notifications response', async () => {
            fetch.mockResolvedValue({
                ok: true,
                json: async () => ({ notifications: [] }),
            });

            const poller = createNotificationPoller(mockDeps);
            await poller.fetchNotifications();

            expect(mockCircuitBreaker.recordSuccess).toHaveBeenCalled();
            expect(poller.getNotifications()).toEqual([]);
        });

        it('should handle response without notifications property', async () => {
            fetch.mockResolvedValue({
                ok: true,
                json: async () => ({}),
            });

            const poller = createNotificationPoller(mockDeps);
            await poller.fetchNotifications();

            expect(mockCircuitBreaker.recordSuccess).toHaveBeenCalled();
            expect(poller.getNotifications()).toEqual([]);
        });

        it('should detect notification changes correctly', async () => {
            const notifications1 = [
                { folder: '/opt/dev/test1', timestamp: 123456 },
            ];
            const notifications2 = [
                { folder: '/opt/dev/test1', timestamp: 123456 },
                { folder: '/opt/dev/test2', timestamp: 123457 },
            ];

            // First fetch
            fetch.mockResolvedValue({
                ok: true,
                json: async () => ({ notifications: notifications1 }),
            });

            const poller = createNotificationPoller(mockDeps);
            await poller.fetchNotifications();
            expect(mockDeps.saveNotifications).toHaveBeenCalledTimes(1);

            // Second fetch with different notifications
            fetch.mockResolvedValue({
                ok: true,
                json: async () => ({ notifications: notifications2 }),
            });
            mockDeps.saveNotifications.mockClear();
            await poller.fetchNotifications();
            expect(mockDeps.saveNotifications).toHaveBeenCalledTimes(1);
        });

        it('should log notification updates', async () => {
            fetch.mockResolvedValue({
                ok: true,
                json: async () => ({ notifications: [{ folder: '/opt/dev/test', timestamp: 123 }] }),
            });

            const poller = createNotificationPoller(mockDeps);
            await poller.fetchNotifications();

            expect(console.log).toHaveBeenCalledWith(
                'Notification Poller: Notifications updated:',
                1
            );
        });
    });

    describe('handleAlarm', () => {
        it('should trigger fetch on pollNotifications alarm', async () => {
            fetch.mockResolvedValue({
                ok: true,
                json: async () => ({ notifications: [] }),
            });

            const poller = createNotificationPoller(mockDeps);
            await poller.handleAlarm({ name: 'pollNotifications' });

            expect(fetch).toHaveBeenCalled();
            expect(console.log).toHaveBeenCalledWith('Notification Poller: Polling triggered by alarm');
        });

        it('should ignore other alarms', async () => {
            const poller = createNotificationPoller(mockDeps);
            await poller.handleAlarm({ name: 'otherAlarm' });

            expect(fetch).not.toHaveBeenCalled();
        });

        it('should handle null alarm', async () => {
            const poller = createNotificationPoller(mockDeps);
            await poller.handleAlarm(null);

            expect(fetch).not.toHaveBeenCalled();
        });

        it('should handle alarm without name', async () => {
            const poller = createNotificationPoller(mockDeps);
            await poller.handleAlarm({});

            expect(fetch).not.toHaveBeenCalled();
        });
    });

    describe('markRead', () => {
        it('should mark notification as read and update', async () => {
            const mockNotifications = [
                { folder: '/opt/dev/test1', timestamp: 123456 },
                { folder: '/opt/dev/test2', timestamp: 123457 },
            ];

            fetch.mockResolvedValue({ ok: true });

            const poller = createNotificationPoller(mockDeps);
            poller.setNotifications(mockNotifications);

            const result = await poller.markRead('/opt/dev/test1');

            expect(result.success).toBe(true);
            expect(fetch).toHaveBeenCalledWith(
                'https://test-api.example.com/claude-status/mark-read',
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({ folder: '/opt/dev/test1' }),
                })
            );
            expect(poller.getNotifications()).toHaveLength(1);
            expect(poller.getNotifications()[0].folder).toBe('/opt/dev/test2');
        });

        it('should return error on failure', async () => {
            fetch.mockRejectedValue(new Error('Network error'));

            const poller = createNotificationPoller(mockDeps);
            const result = await poller.markRead('/opt/dev/test');

            expect(result.success).toBe(false);
            expect(result.error).toBe('Network error');
        });

        it('should broadcast after marking read', async () => {
            fetch.mockResolvedValue({ ok: true });

            const poller = createNotificationPoller(mockDeps);
            poller.setNotifications([{ folder: '/opt/dev/test', timestamp: 123456 }]);

            await poller.markRead('/opt/dev/test');

            expect(mockDeps.broadcastNotifications).toHaveBeenCalled();
        });

        it('should save notifications after marking read', async () => {
            fetch.mockResolvedValue({ ok: true });

            const poller = createNotificationPoller(mockDeps);
            poller.setNotifications([{ folder: '/opt/dev/test', timestamp: 123456 }]);

            await poller.markRead('/opt/dev/test');

            expect(mockDeps.saveNotifications).toHaveBeenCalled();
        });

        it('should handle marking non-existent notification', async () => {
            fetch.mockResolvedValue({ ok: true });

            const poller = createNotificationPoller(mockDeps);
            poller.setNotifications([{ folder: '/opt/dev/test1', timestamp: 123456 }]);

            const result = await poller.markRead('/opt/dev/test2');

            expect(result.success).toBe(true);
            expect(poller.getNotifications()).toHaveLength(1); // Should still have test1
        });
    });

    describe('markAllRead', () => {
        it('should clear all notifications', async () => {
            fetch.mockResolvedValue({ ok: true });

            const poller = createNotificationPoller(mockDeps);
            poller.setNotifications([
                { folder: '/opt/dev/test1', timestamp: 123456 },
                { folder: '/opt/dev/test2', timestamp: 123457 },
            ]);

            const result = await poller.markAllRead();

            expect(result.success).toBe(true);
            expect(fetch).toHaveBeenCalledWith(
                'https://test-api.example.com/claude-status/all',
                expect.objectContaining({ method: 'DELETE' })
            );
            expect(poller.getNotifications()).toHaveLength(0);
        });

        it('should return error on failure', async () => {
            fetch.mockRejectedValue(new Error('Delete failed'));

            const poller = createNotificationPoller(mockDeps);
            const result = await poller.markAllRead();

            expect(result.success).toBe(false);
            expect(result.error).toBe('Delete failed');
        });

        it('should broadcast after marking all read', async () => {
            fetch.mockResolvedValue({ ok: true });

            const poller = createNotificationPoller(mockDeps);
            poller.setNotifications([{ folder: '/opt/dev/test', timestamp: 123456 }]);

            await poller.markAllRead();

            expect(mockDeps.broadcastNotifications).toHaveBeenCalled();
        });

        it('should save empty notifications after marking all read', async () => {
            fetch.mockResolvedValue({ ok: true });

            const poller = createNotificationPoller(mockDeps);
            poller.setNotifications([{ folder: '/opt/dev/test', timestamp: 123456 }]);

            await poller.markAllRead();

            expect(mockDeps.saveNotifications).toHaveBeenCalledWith([]);
        });
    });

    describe('getNotifications and setNotifications', () => {
        it('should get and set notifications', () => {
            const notifications = [
                { folder: '/opt/dev/test', timestamp: 123456 },
            ];

            const poller = createNotificationPoller(mockDeps);
            poller.setNotifications(notifications);

            expect(poller.getNotifications()).toEqual(notifications);
        });

        it('should initialize with empty notifications', () => {
            const poller = createNotificationPoller(mockDeps);
            expect(poller.getNotifications()).toEqual([]);
        });

        it('should track notification version', () => {
            const poller = createNotificationPoller(mockDeps);

            poller.setNotifications([{ folder: '/opt/dev/test1', timestamp: 123 }]);
            poller.setNotifications([{ folder: '/opt/dev/test2', timestamp: 456 }]);

            // Version should be different for different notifications
            expect(poller.getNotifications()).toHaveLength(1);
            expect(poller.getNotifications()[0].folder).toBe('/opt/dev/test2');
        });
    });

    describe('Custom configuration', () => {
        it('should use custom API timeout', async () => {
            const poller = createNotificationPoller(mockDeps, {
                API_TIMEOUT: 5000,
            });

            let timeoutDuration;
            global.setTimeout = jest.fn((callback, duration) => {
                timeoutDuration = duration;
                return 123;
            });

            fetch.mockImplementation(() =>
                new Promise((resolve) => {
                    resolve({ ok: true, json: async () => ({ notifications: [] }) });
                })
            );

            await poller.fetchNotifications();

            expect(timeoutDuration).toBe(5000);
        });

        it('should use custom poll interval', async () => {
            const poller = createNotificationPoller(mockDeps, {
                POLL_INTERVAL_MINUTES: 10,
            });

            await poller.setupPolling();

            expect(chrome.alarms.create).toHaveBeenCalledWith('pollNotifications', {
                periodInMinutes: 10,
            });
        });
    });

    describe('Integration scenarios', () => {
        it('should handle complete polling cycle', async () => {
            const poller = createNotificationPoller(mockDeps);

            // Setup polling
            await poller.setupPolling();
            expect(chrome.alarms.create).toHaveBeenCalled();

            // Initial fetch
            fetch.mockResolvedValue({
                ok: true,
                json: async () => ({
                    notifications: [
                        { folder: '/opt/dev/test', timestamp: 123456 },
                    ],
                }),
            });

            await poller.fetchNotifications();
            expect(poller.getNotifications()).toHaveLength(1);

            // Mark as read
            fetch.mockResolvedValue({ ok: true });
            await poller.markRead('/opt/dev/test');
            expect(poller.getNotifications()).toHaveLength(0);
        });

        it('should handle API failure and recovery', async () => {
            const poller = createNotificationPoller(mockDeps);

            // First call fails
            fetch.mockRejectedValue(new Error('Network error'));
            await poller.fetchNotifications();
            expect(mockCircuitBreaker.recordFailure).toHaveBeenCalled();

            // Second call succeeds
            fetch.mockResolvedValue({
                ok: true,
                json: async () => ({ notifications: [] }),
            });
            mockCircuitBreaker.recordFailure.mockClear();
            await poller.fetchNotifications();
            expect(mockCircuitBreaker.recordSuccess).toHaveBeenCalled();
        });
    });
});
