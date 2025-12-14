/**
 * Unit tests for extension utility functions
 * Tests normalization, notification ID generation, and API URL validation
 */

// Mock chrome API before importing modules
global.chrome = {
    storage: {
        local: {
            get: jest.fn(),
            set: jest.fn(),
        },
        sync: {
            get: jest.fn(),
            set: jest.fn(),
        },
    },
    tabs: {
        query: jest.fn(),
        sendMessage: jest.fn(),
        update: jest.fn(),
        get: jest.fn(),
    },
    windows: {
        update: jest.fn(),
    },
    action: {
        setBadgeText: jest.fn(),
        setBadgeBackgroundColor: jest.fn(),
        setTitle: jest.fn(),
    },
    alarms: {
        create: jest.fn(),
    },
};

// Load modules after chrome mock is set up
const tabManager = require('../../vscode-favicon-extension/modules/tab-manager');
const storageManager = require('../../vscode-favicon-extension/modules/storage-manager');

describe('Extension Utils', () => {
    describe('normalizeFolder', () => {
        const { normalizeFolder } = tabManager;

        it('should remove trailing slashes', () => {
            expect(normalizeFolder('/opt/dev/project/')).toBe('/opt/dev/project');
            expect(normalizeFolder('/opt/dev/project///')).toBe('/opt/dev/project');
        });

        it('should convert to lowercase', () => {
            expect(normalizeFolder('/opt/Dev/Project')).toBe('/opt/dev/project');
            expect(normalizeFolder('/OPT/DEV/PROJECT')).toBe('/opt/dev/project');
        });

        it('should handle empty and null values', () => {
            expect(normalizeFolder('')).toBe('');
            expect(normalizeFolder(null)).toBe('');
            expect(normalizeFolder(undefined)).toBe('');
        });

        it('should handle non-string values', () => {
            expect(normalizeFolder(123)).toBe('');
            expect(normalizeFolder({})).toBe('');
            expect(normalizeFolder([])).toBe('');
        });

        it('should handle paths without trailing slashes', () => {
            expect(normalizeFolder('/opt/dev/project')).toBe('/opt/dev/project');
        });

        it('should handle whitespace-only strings', () => {
            expect(normalizeFolder('   ')).toBe('');
            expect(normalizeFolder('\t\n')).toBe('');
        });

        it('should trim leading/trailing whitespace', () => {
            expect(normalizeFolder('  /opt/dev/project  ')).toBe('/opt/dev/project');
            expect(normalizeFolder('\t/opt/dev/project\n')).toBe('/opt/dev/project');
        });

        it('should normalize backslashes to forward slashes', () => {
            expect(normalizeFolder('C:\\Users\\Project')).toBe('c:/users/project');
            expect(normalizeFolder('/opt/dev\\project')).toBe('/opt/dev/project');
            expect(normalizeFolder('\\\\server\\share\\path')).toBe('//server/share/path');
        });

        it('should URL decode encoded paths', () => {
            expect(normalizeFolder('/opt/dev/my%20project')).toBe('/opt/dev/my project');
            expect(normalizeFolder('/opt/dev/project%2Ftest')).toBe('/opt/dev/project/test');
        });

        it('should handle already decoded paths', () => {
            expect(normalizeFolder('/opt/dev/my project')).toBe('/opt/dev/my project');
        });

        it('should handle invalid URL encoding gracefully', () => {
            // Invalid encoding should not crash, just use original
            expect(normalizeFolder('/opt/dev/%ZZ')).toBe('/opt/dev/%zz');
        });

        it('should be idempotent', () => {
            const input = '/opt/Dev/Project/';
            const normalized = normalizeFolder(input);
            expect(normalizeFolder(normalized)).toBe(normalized);
        });

        it('should match server normalization behavior', () => {
            // Test cases that mirror server-side lib/path-validator.js behavior
            expect(normalizeFolder('/opt/Dev/Project/')).toBe('/opt/dev/project');
            expect(normalizeFolder('/OPT/PROD/App///')).toBe('/opt/prod/app');
            expect(normalizeFolder('/opt/research/ML')).toBe('/opt/research/ml');
        });

        it('should handle mixed separators and case', () => {
            expect(normalizeFolder('C:\\Users\\Dev/Project/')).toBe('c:/users/dev/project');
            expect(normalizeFolder('/Opt\\Prod/APP\\')).toBe('/opt/prod/app');
        });
    });

    describe('getNotificationId', () => {
        const { getNotificationId } = tabManager;

        it('should generate stable ID from folder and timestamp', () => {
            const notification = {
                folder: '/opt/dev/project',
                timestamp: 1234567890,
                status: 'completed',
            };
            expect(getNotificationId(notification)).toBe('/opt/dev/project:1234567890');
        });

        it('should handle missing folder', () => {
            const notification = {
                timestamp: 1234567890,
                status: 'completed',
            };
            expect(getNotificationId(notification)).toBe('');
        });

        it('should handle null or undefined notification', () => {
            expect(getNotificationId(null)).toBe('');
            expect(getNotificationId(undefined)).toBe('');
        });

        it('should produce same ID regardless of property order', () => {
            const notif1 = {
                folder: '/opt/dev/project',
                timestamp: 1234567890,
                status: 'completed',
            };
            const notif2 = {
                status: 'completed',
                timestamp: 1234567890,
                folder: '/opt/dev/project',
            };
            expect(getNotificationId(notif1)).toBe(getNotificationId(notif2));
        });
    });

    describe('getNotificationsVersion', () => {
        const { getNotificationsVersion } = tabManager;

        it('should return empty string for empty array', () => {
            expect(getNotificationsVersion([])).toBe('');
            expect(getNotificationsVersion(null)).toBe('');
            expect(getNotificationsVersion(undefined)).toBe('');
        });

        it('should generate version string from single notification', () => {
            const notifications = [
                { folder: '/opt/dev/project', timestamp: 1234567890 },
            ];
            expect(getNotificationsVersion(notifications)).toBe('/opt/dev/project:1234567890');
        });

        it('should sort notification IDs alphabetically', () => {
            const notifications = [
                { folder: '/opt/dev/z-project', timestamp: 3 },
                { folder: '/opt/dev/a-project', timestamp: 1 },
                { folder: '/opt/dev/m-project', timestamp: 2 },
            ];
            const version = getNotificationsVersion(notifications);
            expect(version).toBe('/opt/dev/a-project:1|/opt/dev/m-project:2|/opt/dev/z-project:3');
        });

        it('should produce same version regardless of input order', () => {
            const notifs1 = [
                { folder: '/opt/dev/a', timestamp: 1 },
                { folder: '/opt/dev/b', timestamp: 2 },
            ];
            const notifs2 = [
                { folder: '/opt/dev/b', timestamp: 2 },
                { folder: '/opt/dev/a', timestamp: 1 },
            ];
            expect(getNotificationsVersion(notifs1)).toBe(getNotificationsVersion(notifs2));
        });

        it('should filter out notifications with missing folder', () => {
            const notifications = [
                { folder: '/opt/dev/a', timestamp: 1 },
                { timestamp: 2 }, // Missing folder
                { folder: '/opt/dev/b', timestamp: 3 },
            ];
            const version = getNotificationsVersion(notifications);
            expect(version).toBe('/opt/dev/a:1|/opt/dev/b:3');
        });

        it('should detect changes in notification set', () => {
            const notifs1 = [
                { folder: '/opt/dev/a', timestamp: 1 },
            ];
            const notifs2 = [
                { folder: '/opt/dev/a', timestamp: 1 },
                { folder: '/opt/dev/b', timestamp: 2 },
            ];
            expect(getNotificationsVersion(notifs1)).not.toBe(getNotificationsVersion(notifs2));
        });
    });

    describe('validateApiUrl', () => {
        const { validateApiUrl } = storageManager;

        describe('valid URLs', () => {
            it('should accept HTTPS URLs', () => {
                const result = validateApiUrl('https://favicon-api.noreika.lt');
                expect(result.valid).toBe(true);
            });

            it('should accept HTTP localhost', () => {
                expect(validateApiUrl('http://localhost:8090').valid).toBe(true);
                expect(validateApiUrl('http://127.0.0.1:8090').valid).toBe(true);
                expect(validateApiUrl('http://[::1]:8090').valid).toBe(true);
            });

            it('should accept localhost without port', () => {
                expect(validateApiUrl('http://localhost').valid).toBe(true);
            });
        });

        describe('invalid URLs', () => {
            it('should reject empty or non-string values', () => {
                expect(validateApiUrl('').valid).toBe(false);
                expect(validateApiUrl(null).valid).toBe(false);
                expect(validateApiUrl(undefined).valid).toBe(false);
                expect(validateApiUrl(123).valid).toBe(false);
            });

            it('should reject malformed URLs', () => {
                const result = validateApiUrl('not-a-url');
                expect(result.valid).toBe(false);
                expect(result.error).toContain('Invalid URL format');
            });

            it('should reject HTTP for non-localhost domains', () => {
                const result = validateApiUrl('http://example.com');
                expect(result.valid).toBe(false);
                expect(result.error).toContain('HTTP is only allowed for localhost');
            });

            it('should reject non-HTTP(S) protocols', () => {
                expect(validateApiUrl('ftp://example.com').valid).toBe(false);
                expect(validateApiUrl('file:///etc/passwd').valid).toBe(false);
                expect(validateApiUrl('javascript:alert(1)').valid).toBe(false);
            });
        });

        describe('security considerations', () => {
            it('should be case-insensitive for localhost', () => {
                expect(validateApiUrl('http://LOCALHOST').valid).toBe(true);
                expect(validateApiUrl('http://LocalHost').valid).toBe(true);
            });

            it('should enforce HTTPS for remote domains', () => {
                const httpResult = validateApiUrl('http://favicon-api.noreika.lt');
                expect(httpResult.valid).toBe(false);

                const httpsResult = validateApiUrl('https://favicon-api.noreika.lt');
                expect(httpsResult.valid).toBe(true);
            });
        });
    });

    describe('message router integration', () => {
        const { createMessageRouter } = require('../../vscode-favicon-extension/modules/message-router');

        let mockLogger;
        let mockDeps;
        let router;

        beforeEach(() => {
            mockLogger = {
                debug: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
            };

            mockDeps = {
                logger: mockLogger,
                loadNotifications: jest.fn().mockResolvedValue([]),
                saveNotifications: jest.fn().mockResolvedValue(undefined),
                getApiBase: jest.fn().mockReturnValue('https://test-api.example.com'),
                setApiBase: jest.fn().mockResolvedValue(undefined),
                getNotifications: jest.fn().mockReturnValue([]),
                getFilteredNotifications: jest.fn().mockReturnValue([]),
                fetchNotifications: jest.fn().mockResolvedValue(undefined),
                broadcastNotifications: jest.fn().mockResolvedValue(undefined),
                switchToTab: jest.fn().mockResolvedValue({ success: true }),
                handleTerminalStateChange: jest.fn().mockReturnValue({ added: true, size: 1 }),
                markRead: jest.fn().mockResolvedValue(undefined),
                markAllRead: jest.fn().mockResolvedValue(undefined),
                getCircuitBreakerStatus: jest.fn().mockReturnValue({ state: 'CLOSED' }),
                normalizeFolder: jest.fn(folder => (folder || '').toLowerCase()),
            };

            router = createMessageRouter(mockDeps);
        });

        it('should route GET_NOTIFICATIONS message', async () => {
            const result = await router.handleMessage({ type: 'GET_NOTIFICATIONS' }, {});
            expect(result).toHaveProperty('notifications');
            expect(Array.isArray(result.notifications)).toBe(true);
        });

        it('should handle unknown message type', async () => {
            const result = await router.handleMessage({ type: 'UNKNOWN_TYPE' }, {});
            expect(result).toEqual({ error: 'Unknown message type' });
        });

        it('should route SWITCH_TO_TAB message', async () => {
            const result = await router.handleMessage(
                { type: 'SWITCH_TO_TAB', folder: '/opt/dev/project' },
                {}
            );
            expect(result.success).toBe(true);
            expect(mockDeps.switchToTab).toHaveBeenCalledWith('/opt/dev/project');
        });

        it('should route TERMINAL_STATE_CHANGE message', async () => {
            const sender = { tab: { id: 123 } };
            const result = await router.handleMessage(
                { type: 'TERMINAL_STATE_CHANGE', folder: '/opt/dev/project', hasTerminal: true },
                sender
            );
            expect(result.success).toBe(true);
            expect(mockDeps.handleTerminalStateChange).toHaveBeenCalledWith(
                '/opt/dev/project',
                true,
                123
            );
        });
    });
});
