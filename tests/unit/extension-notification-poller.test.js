/**
 * Unit tests for extension notification-poller module
 */

const { createNotificationPoller } = require('../../vscode-favicon-extension/modules/notification-poller');

// Mock chrome.alarms
global.chrome = {
    alarms: {
        create: jest.fn(),
    },
};

// Mock fetch
global.fetch = jest.fn();

describe('notification-poller', () => {
    let mockCircuitBreaker;
    let mockDeps;

    beforeEach(() => {
        jest.clearAllMocks();

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
        });

        it('should record failure on fetch error', async () => {
            fetch.mockRejectedValue(new Error('Network error'));

            const poller = createNotificationPoller(mockDeps);
            await poller.fetchNotifications();

            expect(mockCircuitBreaker.recordFailure).toHaveBeenCalled();
        });

        it('should respect circuit breaker', async () => {
            mockCircuitBreaker.shouldAllowRequest.mockReturnValue({
                allowed: false,
                reason: 'Circuit OPEN',
            });

            const poller = createNotificationPoller(mockDeps);
            await poller.fetchNotifications();

            expect(fetch).not.toHaveBeenCalled();
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
        });

        it('should ignore other alarms', async () => {
            const poller = createNotificationPoller(mockDeps);
            await poller.handleAlarm({ name: 'otherAlarm' });

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
    });
});
