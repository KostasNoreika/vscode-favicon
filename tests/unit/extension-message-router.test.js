/**
 * Unit tests for extension message-router module
 */

const { createMessageRouter } = require('../../vscode-favicon-extension/modules/message-router');

describe('message-router', () => {
    let mockDeps;

    beforeEach(() => {
        mockDeps = {
            getNotifications: jest.fn(() => []),
            getFilteredNotifications: jest.fn(() => []),
            switchToTab: jest.fn(),
            handleTerminalStateChange: jest.fn(),
            broadcastNotifications: jest.fn(),
            fetchNotifications: jest.fn(),
            markRead: jest.fn(),
            markAllRead: jest.fn(),
            getCircuitBreakerStatus: jest.fn(),
        };
    });

    describe('handleMessage', () => {
        it('should handle GET_NOTIFICATIONS message', async () => {
            const mockNotifications = [
                { folder: '/opt/dev/test', timestamp: 123456 },
            ];
            mockDeps.getFilteredNotifications.mockReturnValue(mockNotifications);

            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage({ type: 'GET_NOTIFICATIONS' }, {});

            expect(result.notifications).toEqual(mockNotifications);
        });

        it('should handle TERMINAL_STATE_CHANGE message', async () => {
            mockDeps.handleTerminalStateChange.mockReturnValue({ activeTerminals: 1 });

            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'TERMINAL_STATE_CHANGE',
                    folder: '/opt/dev/test',
                    hasTerminal: true,
                },
                { tab: { id: 123 } }
            );

            expect(result.success).toBe(true);
            expect(result.activeTerminals).toBe(1);
            expect(mockDeps.handleTerminalStateChange).toHaveBeenCalledWith(
                '/opt/dev/test',
                true,
                123
            );
            expect(mockDeps.broadcastNotifications).toHaveBeenCalled();
        });

        it('should handle GET_NOTIFICATION_STATUS message', async () => {
            const mockNotifications = [
                { folder: '/opt/dev/test', timestamp: 123456, status: 'unread' },
            ];
            mockDeps.getNotifications.mockReturnValue(mockNotifications);

            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'GET_NOTIFICATION_STATUS',
                    folder: '/opt/dev/test',
                },
                {}
            );

            expect(result.hasNotification).toBe(true);
            expect(result.status).toBe('unread');
            expect(result.notification).toBeDefined();
        });

        it('should handle GET_NOTIFICATION_STATUS when notification not found', async () => {
            mockDeps.getNotifications.mockReturnValue([]);

            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'GET_NOTIFICATION_STATUS',
                    folder: '/opt/dev/test',
                },
                {}
            );

            expect(result.hasNotification).toBe(false);
            expect(result.status).toBe(null);
            expect(result.notification).toBe(null);
        });

        it('should normalize folder paths when finding notifications', async () => {
            const mockNotifications = [
                { folder: '/OPT/DEV/TEST/', timestamp: 123456, status: 'unread' },
            ];
            mockDeps.getNotifications.mockReturnValue(mockNotifications);

            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'GET_NOTIFICATION_STATUS',
                    folder: '/opt/dev/test',
                },
                {}
            );

            expect(result.hasNotification).toBe(true);
        });

        it('should handle SWITCH_TO_TAB message', async () => {
            mockDeps.switchToTab.mockResolvedValue({ success: true, tabId: 123 });

            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'SWITCH_TO_TAB',
                    folder: '/opt/dev/test',
                },
                {}
            );

            expect(result.success).toBe(true);
            expect(result.tabId).toBe(123);
            expect(mockDeps.switchToTab).toHaveBeenCalledWith('/opt/dev/test');
        });

        it('should handle MARK_READ message', async () => {
            mockDeps.markRead.mockResolvedValue({ success: true });

            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'MARK_READ',
                    folder: '/opt/dev/test',
                },
                {}
            );

            expect(result.success).toBe(true);
            expect(mockDeps.markRead).toHaveBeenCalledWith('/opt/dev/test');
        });

        it('should handle MARK_ALL_READ message', async () => {
            mockDeps.markAllRead.mockResolvedValue({ success: true });

            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'MARK_ALL_READ',
                },
                {}
            );

            expect(result.success).toBe(true);
            expect(mockDeps.markAllRead).toHaveBeenCalled();
        });

        it('should handle REFRESH_NOTIFICATIONS message', async () => {
            mockDeps.fetchNotifications.mockResolvedValue();

            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'REFRESH_NOTIFICATIONS',
                },
                {}
            );

            expect(result.success).toBe(true);
            expect(mockDeps.fetchNotifications).toHaveBeenCalled();
        });

        it('should handle GET_CIRCUIT_BREAKER_STATUS message', async () => {
            const mockStatus = {
                state: 'closed',
                failures: 0,
                lastFailureTime: null,
            };
            mockDeps.getCircuitBreakerStatus.mockReturnValue(mockStatus);

            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'GET_CIRCUIT_BREAKER_STATUS',
                },
                {}
            );

            expect(result.state).toBe('closed');
            expect(result.failures).toBe(0);
        });

        it('should handle unknown message type', async () => {
            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'UNKNOWN_TYPE',
                },
                {}
            );

            expect(result.error).toBe('Unknown message type');
        });

        it('should handle errors gracefully', async () => {
            mockDeps.fetchNotifications.mockRejectedValue(new Error('Network error'));

            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'REFRESH_NOTIFICATIONS',
                },
                {}
            );

            expect(result.error).toBe('Network error');
        });
    });
});
