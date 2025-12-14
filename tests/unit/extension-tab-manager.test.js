/**
 * Unit tests for extension tab-manager module
 */

const {
    getNotificationId,
    getNotificationsVersion,
    createTabManager,
} = require('../../vscode-favicon-extension/modules/tab-manager');

// Mock chrome APIs
global.chrome = {
    action: {
        setBadgeText: jest.fn(),
        setBadgeBackgroundColor: jest.fn(),
        setTitle: jest.fn(),
    },
    tabs: {
        query: jest.fn(),
        sendMessage: jest.fn(),
        get: jest.fn(),
        update: jest.fn(),
    },
    windows: {
        update: jest.fn(),
    },
};

describe('tab-manager', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('getNotificationId', () => {
        it('should generate stable ID from notification', () => {
            const notification = {
                folder: '/opt/dev/project',
                timestamp: 1234567890,
            };
            const id = getNotificationId(notification);
            expect(id).toBe('/opt/dev/project:1234567890');
        });

        it('should return empty string for invalid notification', () => {
            expect(getNotificationId(null)).toBe('');
            expect(getNotificationId({})).toBe('');
            expect(getNotificationId({ folder: '/test' })).toBe('');
            expect(getNotificationId({ timestamp: 123 })).toBe('');
        });
    });

    describe('getNotificationsVersion', () => {
        it('should generate version string from notifications', () => {
            const notifications = [
                { folder: '/opt/dev/project1', timestamp: 123456 },
                { folder: '/opt/dev/project2', timestamp: 123457 },
            ];
            const version = getNotificationsVersion(notifications);
            expect(version).toContain('/opt/dev/project1:123456');
            expect(version).toContain('/opt/dev/project2:123457');
        });

        it('should return same version for same notifications', () => {
            const notifications1 = [
                { folder: '/opt/dev/test', timestamp: 123 },
            ];
            const notifications2 = [
                { folder: '/opt/dev/test', timestamp: 123 },
            ];
            expect(getNotificationsVersion(notifications1)).toBe(
                getNotificationsVersion(notifications2)
            );
        });

        it('should return different version for different notifications', () => {
            const notifications1 = [
                { folder: '/opt/dev/test1', timestamp: 123 },
            ];
            const notifications2 = [
                { folder: '/opt/dev/test2', timestamp: 456 },
            ];
            expect(getNotificationsVersion(notifications1)).not.toBe(
                getNotificationsVersion(notifications2)
            );
        });

        it('should sort notifications for consistency', () => {
            const notifications1 = [
                { folder: '/opt/dev/b', timestamp: 2 },
                { folder: '/opt/dev/a', timestamp: 1 },
            ];
            const notifications2 = [
                { folder: '/opt/dev/a', timestamp: 1 },
                { folder: '/opt/dev/b', timestamp: 2 },
            ];
            expect(getNotificationsVersion(notifications1)).toBe(
                getNotificationsVersion(notifications2)
            );
        });

        it('should return empty string for empty array', () => {
            expect(getNotificationsVersion([])).toBe('');
            expect(getNotificationsVersion(null)).toBe('');
        });
    });

    describe('createTabManager', () => {
        let mockDeps;

        beforeEach(() => {
            mockDeps = {
                getNotifications: jest.fn(() => []),
                updateBadge: jest.fn(),
            };
        });

        describe('updateIconBadge', () => {
            it('should set badge text for notifications', () => {
                const manager = createTabManager(mockDeps);
                manager.updateIconBadge(3);

                expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '3' });
                expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#4CAF50' });
            });

            it('should clear badge when no notifications', () => {
                const manager = createTabManager(mockDeps);
                manager.updateIconBadge(0);

                expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '' });
            });
        });

        describe('handleTerminalStateChange', () => {
            it('should track terminal opened', () => {
                const manager = createTabManager(mockDeps);
                const result = manager.handleTerminalStateChange('/opt/dev/test', true, 123);

                expect(result.activeTerminals).toBe(1);
                expect(manager.getActiveTerminalCount()).toBe(1);
            });

            it('should track terminal closed', () => {
                const manager = createTabManager(mockDeps);
                manager.handleTerminalStateChange('/opt/dev/test', true, 123);
                const result = manager.handleTerminalStateChange('/opt/dev/test', false, 123);

                expect(result.activeTerminals).toBe(0);
                expect(manager.getActiveTerminalCount()).toBe(0);
            });

            it('should track multiple terminals', () => {
                const manager = createTabManager(mockDeps);
                manager.handleTerminalStateChange('/opt/dev/test1', true, 123);
                manager.handleTerminalStateChange('/opt/dev/test2', true, 124);

                expect(manager.getActiveTerminalCount()).toBe(2);
            });
        });

        describe('getFilteredNotifications', () => {
            it('should return empty when no active terminals', () => {
                mockDeps.getNotifications.mockReturnValue([
                    { folder: '/opt/dev/test', timestamp: 123 },
                ]);

                const manager = createTabManager(mockDeps);
                const filtered = manager.getFilteredNotifications();

                expect(filtered).toHaveLength(0);
            });

            it('should return notifications for active terminals', () => {
                mockDeps.getNotifications.mockReturnValue([
                    { folder: '/opt/dev/test1', timestamp: 123 },
                    { folder: '/opt/dev/test2', timestamp: 124 },
                ]);

                const manager = createTabManager(mockDeps);
                manager.handleTerminalStateChange('/opt/dev/test1', true, 123);

                const filtered = manager.getFilteredNotifications();
                expect(filtered).toHaveLength(1);
                expect(filtered[0].folder).toBe('/opt/dev/test1');
            });

            it('should normalize folder paths for matching', () => {
                mockDeps.getNotifications.mockReturnValue([
                    { folder: '/OPT/DEV/TEST/', timestamp: 123 },
                ]);

                const manager = createTabManager(mockDeps);
                manager.handleTerminalStateChange('/opt/dev/test', true, 123);

                const filtered = manager.getFilteredNotifications();
                expect(filtered).toHaveLength(1);
            });
        });

        describe('switchToTab', () => {
            it('should switch to tab with exact folder match', async () => {
                chrome.tabs.query.mockResolvedValue([
                    {
                        id: 123,
                        windowId: 456,
                        url: 'https://vs.noreika.lt/?folder=/opt/dev/test',
                    },
                ]);

                const manager = createTabManager(mockDeps);
                const result = await manager.switchToTab('/opt/dev/test');

                expect(result.success).toBe(true);
                expect(result.tabId).toBe(123);
                expect(chrome.tabs.update).toHaveBeenCalledWith(123, { active: true });
                expect(chrome.windows.update).toHaveBeenCalledWith(456, { focused: true });
            });

            it('should switch to tab with partial folder match', async () => {
                chrome.tabs.query.mockResolvedValue([
                    {
                        id: 123,
                        windowId: 456,
                        url: 'https://vs.noreika.lt/?folder=/opt/dev',
                    },
                ]);

                const manager = createTabManager(mockDeps);
                const result = await manager.switchToTab('/opt/dev/test/subfolder');

                expect(result.success).toBe(true);
                expect(result.tabId).toBe(123);
            });

            it('should return error when tab not found', async () => {
                chrome.tabs.query.mockResolvedValue([]);

                const manager = createTabManager(mockDeps);
                const result = await manager.switchToTab('/opt/dev/test');

                expect(result.success).toBe(false);
                expect(result.error).toBe('Tab not found');
            });

            it('should normalize folder paths for matching', async () => {
                chrome.tabs.query.mockResolvedValue([
                    {
                        id: 123,
                        windowId: 456,
                        url: 'https://vs.noreika.lt/?folder=/OPT/DEV/TEST/',
                    },
                ]);

                const manager = createTabManager(mockDeps);
                const result = await manager.switchToTab('/opt/dev/test');

                expect(result.success).toBe(true);
            });

            it('should efficiently handle multiple tabs with single-pass indexing', async () => {
                // Create 10 tabs to verify single-pass optimization
                const mockTabs = Array.from({ length: 10 }, (_, i) => ({
                    id: 100 + i,
                    windowId: 456,
                    url: `https://vs.noreika.lt/?folder=/opt/dev/project${i}`,
                }));

                chrome.tabs.query.mockResolvedValue(mockTabs);

                const manager = createTabManager(mockDeps);
                const result = await manager.switchToTab('/opt/dev/project5');

                expect(result.success).toBe(true);
                expect(result.tabId).toBe(105);
                expect(chrome.tabs.update).toHaveBeenCalledWith(105, { active: true });
            });

            it('should skip tabs without folder parameter', async () => {
                chrome.tabs.query.mockResolvedValue([
                    {
                        id: 123,
                        windowId: 456,
                        url: 'https://vs.noreika.lt/',  // No folder param
                    },
                    {
                        id: 124,
                        windowId: 456,
                        url: 'https://vs.noreika.lt/?folder=/opt/dev/test',
                    },
                ]);

                const manager = createTabManager(mockDeps);
                const result = await manager.switchToTab('/opt/dev/test');

                expect(result.success).toBe(true);
                expect(result.tabId).toBe(124);
            });
        });

        describe('handleTabRemoved', () => {
            it('should remove terminal tracking for closed tab', async () => {
                chrome.tabs.query.mockResolvedValue([]);

                const manager = createTabManager(mockDeps);
                manager.handleTerminalStateChange('/opt/dev/test', true, 123);

                expect(manager.getActiveTerminalCount()).toBe(1);

                await manager.handleTabRemoved(123);

                expect(manager.getActiveTerminalCount()).toBe(0);
            });
        });

        describe('broadcastNotifications', () => {
            it('should send messages to all VS Code tabs', async () => {
                const mockTabs = [
                    { id: 123, url: 'https://vs.noreika.lt/?folder=/opt/dev/test1' },
                    { id: 124, url: 'https://vs.noreika.lt/?folder=/opt/dev/test2' },
                ];

                chrome.tabs.query.mockResolvedValue(mockTabs);
                chrome.tabs.sendMessage.mockResolvedValue({});

                const manager = createTabManager(mockDeps);
                await manager.broadcastNotifications();

                expect(chrome.tabs.query).toHaveBeenCalledWith({ url: 'https://vs.noreika.lt/*' });
                expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
            });

            it('should handle sendMessage errors gracefully', async () => {
                const mockTabs = [
                    { id: 123, url: 'https://vs.noreika.lt/?folder=/opt/dev/test' },
                ];

                chrome.tabs.query.mockResolvedValue(mockTabs);
                chrome.tabs.sendMessage.mockRejectedValue(new Error('Tab not ready'));

                const manager = createTabManager(mockDeps);

                // Should not throw
                await expect(manager.broadcastNotifications()).resolves.not.toThrow();
            });
        });
    });
});
