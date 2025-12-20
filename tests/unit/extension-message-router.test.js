/**
 * Unit tests for extension message-router module
 */

// Mock DomainManager module
const mockDomainManager = {
    getWhitelistedDomains: jest.fn(),
    addDomain: jest.fn(),
    removeDomain: jest.fn(),
    requestDomainPermission: jest.fn(),
    isAutoDetectEnabled: jest.fn(),
    setAutoDetect: jest.fn(),
};

// Mock modules before requiring message-router
jest.mock('../../vscode-favicon-extension/modules/domain-manager', () => mockDomainManager);

// Mock chrome.storage.local
global.chrome = {
    storage: {
        local: {
            get: jest.fn(),
            set: jest.fn(),
        },
    },
};

// Mock console
global.console = {
    ...console,
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
};

// Mock fetch for UPLOAD_FILE tests
global.fetch = jest.fn();

// Mock atob for base64 decoding
global.atob = jest.fn((str) => {
    // Simple base64 decode for testing
    return Buffer.from(str, 'base64').toString('binary');
});

// Mock Blob
global.Blob = jest.fn().mockImplementation((parts, options) => ({
    size: parts[0]?.length || 0,
    type: options?.type || '',
}));

// Mock FormData
global.FormData = jest.fn().mockImplementation(() => {
    const data = new Map();
    return {
        append: jest.fn((key, value, filename) => {
            data.set(key, { value, filename });
        }),
        get: jest.fn((key) => data.get(key)),
    };
});

const { createMessageRouter } = require('../../vscode-favicon-extension/modules/message-router');

describe('message-router', () => {
    let mockDeps;

    beforeEach(() => {
        jest.clearAllMocks();

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
            getApiBase: jest.fn(() => 'https://test-api.example.com'),
        };
    });

    describe('handleMessage - Basic routing', () => {
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
            expect(console.warn).toHaveBeenCalledWith('Message Router: Unknown message type:', 'UNKNOWN_TYPE');
        });
    });

    describe('handleMessage - Domain management', () => {
        it('should handle GET_VSCODE_DOMAINS message', async () => {
            const mockDomains = ['https://vscode.example.com', 'https://code.example.com'];
            mockDomainManager.getWhitelistedDomains.mockResolvedValue(mockDomains);

            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'GET_VSCODE_DOMAINS',
                },
                {}
            );

            expect(result.domains).toEqual(mockDomains);
            expect(mockDomainManager.getWhitelistedDomains).toHaveBeenCalled();
        });

        it('should handle ADD_VSCODE_DOMAIN message', async () => {
            mockDomainManager.addDomain.mockResolvedValue({ success: true });

            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'ADD_VSCODE_DOMAIN',
                    domain: 'https://new-vscode.example.com',
                },
                {}
            );

            expect(result.success).toBe(true);
            expect(mockDomainManager.addDomain).toHaveBeenCalledWith('https://new-vscode.example.com');
        });

        it('should handle REMOVE_VSCODE_DOMAIN message', async () => {
            mockDomainManager.removeDomain.mockResolvedValue({ success: true });

            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'REMOVE_VSCODE_DOMAIN',
                    domain: 'https://old-vscode.example.com',
                },
                {}
            );

            expect(result.success).toBe(true);
            expect(mockDomainManager.removeDomain).toHaveBeenCalledWith('https://old-vscode.example.com');
        });

        it('should handle REQUEST_DOMAIN_PERMISSION message', async () => {
            mockDomainManager.requestDomainPermission.mockResolvedValue({ granted: true });

            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'REQUEST_DOMAIN_PERMISSION',
                    origin: 'https://vscode.example.com',
                },
                {}
            );

            expect(result.granted).toBe(true);
            expect(mockDomainManager.requestDomainPermission).toHaveBeenCalledWith('https://vscode.example.com');
        });

        it('should handle GET_AUTO_DETECT_SETTING message', async () => {
            mockDomainManager.isAutoDetectEnabled.mockResolvedValue(true);

            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'GET_AUTO_DETECT_SETTING',
                },
                {}
            );

            expect(result.enabled).toBe(true);
            expect(mockDomainManager.isAutoDetectEnabled).toHaveBeenCalled();
        });

        it('should handle SET_AUTO_DETECT_SETTING message', async () => {
            mockDomainManager.setAutoDetect.mockResolvedValue({ success: true });

            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'SET_AUTO_DETECT_SETTING',
                    enabled: false,
                },
                {}
            );

            expect(result.success).toBe(true);
            expect(mockDomainManager.setAutoDetect).toHaveBeenCalledWith(false);
        });
    });

    describe('handleMessage - API base URL management', () => {
        it('should handle GET_API_BASE_URL message', async () => {
            mockDeps.getApiBase.mockReturnValue('https://favicon-api.example.com');

            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'GET_API_BASE_URL',
                },
                {}
            );

            expect(result.apiBaseUrl).toBe('https://favicon-api.example.com');
            expect(mockDeps.getApiBase).toHaveBeenCalled();
        });

        it('should handle SET_API_BASE_URL with valid HTTPS URL', async () => {
            chrome.storage.local.set.mockResolvedValue();

            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'SET_API_BASE_URL',
                    url: 'https://new-api.example.com',
                },
                {}
            );

            expect(result.success).toBe(true);
            expect(result.apiBaseUrl).toBe('https://new-api.example.com');
            expect(chrome.storage.local.set).toHaveBeenCalledWith({
                apiBaseUrl: 'https://new-api.example.com',
            });
        });

        it('should handle SET_API_BASE_URL with valid localhost HTTP URL', async () => {
            chrome.storage.local.set.mockResolvedValue();

            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'SET_API_BASE_URL',
                    url: 'http://localhost:8090',
                },
                {}
            );

            expect(result.success).toBe(true);
            expect(result.apiBaseUrl).toBe('http://localhost:8090');
        });

        it('should reject SET_API_BASE_URL with invalid URL', async () => {
            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'SET_API_BASE_URL',
                    url: 'not-a-url',
                },
                {}
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain('Invalid URL format');
            expect(chrome.storage.local.set).not.toHaveBeenCalled();
        });

        it('should reject SET_API_BASE_URL with HTTP for non-localhost', async () => {
            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'SET_API_BASE_URL',
                    url: 'http://example.com',
                },
                {}
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain('HTTP is only allowed for localhost');
            expect(chrome.storage.local.set).not.toHaveBeenCalled();
        });

        it('should handle SET_API_BASE_URL storage error', async () => {
            chrome.storage.local.set.mockRejectedValue(new Error('Storage error'));

            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'SET_API_BASE_URL',
                    url: 'https://api.example.com',
                },
                {}
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe('Storage error');
        });

        it('should trim whitespace in SET_API_BASE_URL', async () => {
            chrome.storage.local.set.mockResolvedValue();

            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'SET_API_BASE_URL',
                    url: '  https://api.example.com  ',
                },
                {}
            );

            expect(result.success).toBe(true);
            expect(result.apiBaseUrl).toBe('https://api.example.com');
        });
    });

    describe('Error handling', () => {
        it('should handle errors gracefully in async operations', async () => {
            mockDeps.fetchNotifications.mockRejectedValue(new Error('Network error'));

            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'REFRESH_NOTIFICATIONS',
                },
                {}
            );

            expect(result.error).toBe('Network error');
            expect(console.error).toHaveBeenCalledWith(
                'Message Router: Handler error:',
                expect.any(Error)
            );
        });

        it('should handle errors in terminal state change', async () => {
            mockDeps.handleTerminalStateChange.mockImplementation(() => {
                throw new Error('State change error');
            });

            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'TERMINAL_STATE_CHANGE',
                    folder: '/opt/dev/test',
                    hasTerminal: true,
                },
                { tab: { id: 123 } }
            );

            expect(result.error).toBe('State change error');
        });

        it('should handle errors in switch to tab', async () => {
            mockDeps.switchToTab.mockRejectedValue(new Error('Tab not found'));

            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'SWITCH_TO_TAB',
                    folder: '/opt/dev/test',
                },
                {}
            );

            expect(result.error).toBe('Tab not found');
        });

        it('should handle errors in mark read', async () => {
            mockDeps.markRead.mockRejectedValue(new Error('Mark read failed'));

            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'MARK_READ',
                    folder: '/opt/dev/test',
                },
                {}
            );

            expect(result.error).toBe('Mark read failed');
        });

        it('should handle errors in mark all read', async () => {
            mockDeps.markAllRead.mockRejectedValue(new Error('Mark all read failed'));

            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'MARK_ALL_READ',
                },
                {}
            );

            expect(result.error).toBe('Mark all read failed');
        });

        it('should handle errors in domain management', async () => {
            mockDomainManager.addDomain.mockRejectedValue(new Error('Domain add failed'));

            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'ADD_VSCODE_DOMAIN',
                    domain: 'https://vscode.example.com',
                },
                {}
            );

            expect(result.error).toBe('Domain add failed');
        });
    });

    describe('Edge cases', () => {
        it('should handle missing sender tab in TERMINAL_STATE_CHANGE', async () => {
            mockDeps.handleTerminalStateChange.mockReturnValue({ activeTerminals: 1 });

            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'TERMINAL_STATE_CHANGE',
                    folder: '/opt/dev/test',
                    hasTerminal: true,
                },
                {} // No tab property
            );

            expect(result.success).toBe(true);
            expect(mockDeps.handleTerminalStateChange).toHaveBeenCalledWith(
                '/opt/dev/test',
                true,
                undefined
            );
        });

        it('should handle empty folder in GET_NOTIFICATION_STATUS', async () => {
            mockDeps.getNotifications.mockReturnValue([
                { folder: '/opt/dev/test', timestamp: 123456 },
            ]);

            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'GET_NOTIFICATION_STATUS',
                    folder: '',
                },
                {}
            );

            expect(result.hasNotification).toBe(false);
        });

        it('should handle null notification properties', async () => {
            mockDeps.getNotifications.mockReturnValue([
                { folder: '/opt/dev/test', timestamp: 123456 },
            ]);

            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'GET_NOTIFICATION_STATUS',
                    folder: null,
                },
                {}
            );

            expect(result.hasNotification).toBe(false);
        });
    });

    describe('handleMessage - UPLOAD_FILE', () => {
        const validBase64 = Buffer.from('test image data').toString('base64');

        beforeEach(() => {
            jest.clearAllMocks();
            global.fetch.mockReset();
            // Reset atob to default working implementation
            global.atob.mockReset();
            global.atob.mockImplementation((str) => {
                return Buffer.from(str, 'base64').toString('binary');
            });
        });

        it('should reject UPLOAD_FILE with missing fileData', async () => {
            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'UPLOAD_FILE',
                    fileName: 'test.png',
                    fileType: 'image/png',
                    folder: '/opt/dev/test',
                    origin: 'https://vscode.example.com',
                },
                {}
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe('Missing or invalid file data');
            expect(console.error).toHaveBeenCalledWith(
                'Message Router: UPLOAD_FILE missing or invalid fileData'
            );
        });

        it('should reject UPLOAD_FILE with missing folder', async () => {
            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'UPLOAD_FILE',
                    fileData: validBase64,
                    fileName: 'test.png',
                    fileType: 'image/png',
                    origin: 'https://vscode.example.com',
                },
                {}
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe('Missing or invalid folder path');
        });

        it('should reject UPLOAD_FILE with missing fileName', async () => {
            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'UPLOAD_FILE',
                    fileData: validBase64,
                    fileType: 'image/png',
                    folder: '/opt/dev/test',
                    origin: 'https://vscode.example.com',
                },
                {}
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe('Missing or invalid file name');
        });

        it('should reject UPLOAD_FILE with missing fileType', async () => {
            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'UPLOAD_FILE',
                    fileData: validBase64,
                    fileName: 'test.png',
                    folder: '/opt/dev/test',
                    origin: 'https://vscode.example.com',
                },
                {}
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe('Missing or invalid file type');
        });

        it('should reject UPLOAD_FILE with non-string fileData', async () => {
            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'UPLOAD_FILE',
                    fileData: 12345,
                    fileName: 'test.png',
                    fileType: 'image/png',
                    folder: '/opt/dev/test',
                    origin: 'https://vscode.example.com',
                },
                {}
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe('Missing or invalid file data');
        });

        it('should handle successful file upload', async () => {
            global.fetch.mockResolvedValue({
                ok: true,
                status: 200,
                json: jest.fn().mockResolvedValue({ filename: 'img-2025-01-01-123456.png' }),
            });

            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'UPLOAD_FILE',
                    fileData: validBase64,
                    fileName: 'test.png',
                    fileType: 'image/png',
                    folder: '/opt/dev/test',
                    origin: 'https://vscode.example.com',
                },
                {}
            );

            expect(result.success).toBe(true);
            expect(result.filename).toBe('img-2025-01-01-123456.png');
            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/api/paste-image'),
                expect.objectContaining({
                    method: 'POST',
                    headers: { 'X-Requested-With': 'XMLHttpRequest' },
                })
            );
        });

        it('should use localhost API for local origin + Mac paths (/opt/)', async () => {
            global.fetch.mockResolvedValue({
                ok: true,
                status: 200,
                json: jest.fn().mockResolvedValue({ filename: 'test.png' }),
            });

            const router = createMessageRouter(mockDeps);
            await router.handleMessage(
                {
                    type: 'UPLOAD_FILE',
                    fileData: validBase64,
                    fileName: 'test.png',
                    fileType: 'image/png',
                    folder: '/opt/dev/project',
                    origin: 'http://localhost:8080', // Local origin
                },
                {}
            );

            expect(global.fetch).toHaveBeenCalledWith(
                'http://localhost:8090/api/paste-image',
                expect.any(Object)
            );
        });

        it('should use localhost API for local origin (127.0.0.1) + Mac paths', async () => {
            global.fetch.mockResolvedValue({
                ok: true,
                status: 200,
                json: jest.fn().mockResolvedValue({ filename: 'test.png' }),
            });

            const router = createMessageRouter(mockDeps);
            await router.handleMessage(
                {
                    type: 'UPLOAD_FILE',
                    fileData: validBase64,
                    fileName: 'test.png',
                    fileType: 'image/png',
                    folder: '/users/dev/project',
                    origin: 'http://127.0.0.1:8080', // Local origin
                },
                {}
            );

            expect(global.fetch).toHaveBeenCalledWith(
                'http://localhost:8090/api/paste-image',
                expect.any(Object)
            );
        });

        it('should use mapped API for known origin (vs.noreika.lt)', async () => {
            global.fetch.mockResolvedValue({
                ok: true,
                status: 200,
                json: jest.fn().mockResolvedValue({ filename: 'test.png' }),
            });

            const router = createMessageRouter(mockDeps);
            // vs.noreika.lt should use favicon-api.noreika.lt (Production VM with symlinks)
            await router.handleMessage(
                {
                    type: 'UPLOAD_FILE',
                    fileData: validBase64,
                    fileName: 'test.png',
                    fileType: 'image/png',
                    folder: '/opt/dev/project',
                    origin: 'https://vs.noreika.lt',
                },
                {}
            );

            // Should use mapped API for known origin
            expect(global.fetch).toHaveBeenCalledWith(
                'https://favicon-api.noreika.lt/api/paste-image',
                expect.any(Object)
            );
        });

        it('should use default API for unknown remote origin', async () => {
            global.fetch.mockResolvedValue({
                ok: true,
                status: 200,
                json: jest.fn().mockResolvedValue({ filename: 'test.png' }),
            });

            const router = createMessageRouter(mockDeps);
            // Unknown remote origin should use default API
            await router.handleMessage(
                {
                    type: 'UPLOAD_FILE',
                    fileData: validBase64,
                    fileName: 'test.png',
                    fileType: 'image/png',
                    folder: '/opt/dev/project',
                    origin: 'https://unknown-vscode.example.com',
                },
                {}
            );

            // Should use default API from getApiBase()
            expect(global.fetch).toHaveBeenCalledWith(
                'https://test-api.example.com/api/paste-image',
                expect.any(Object)
            );
        });

        it('should handle invalid base64 data', async () => {
            global.atob.mockImplementation(() => {
                throw new Error('Invalid character');
            });

            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'UPLOAD_FILE',
                    fileData: '!!!invalid-base64!!!',
                    fileName: 'test.png',
                    fileType: 'image/png',
                    folder: '/opt/dev/test',
                    origin: 'https://vscode.example.com',
                },
                {}
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe('Invalid base64 file data');
            expect(console.error).toHaveBeenCalledWith(
                'Message Router: Invalid base64 data:',
                'Invalid character'
            );
        });

        it('should handle HTTP error response', async () => {
            global.fetch.mockResolvedValue({
                ok: false,
                status: 413,
                text: jest.fn().mockResolvedValue('File too large'),
            });

            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'UPLOAD_FILE',
                    fileData: validBase64,
                    fileName: 'test.png',
                    fileType: 'image/png',
                    folder: '/opt/dev/test',
                    origin: 'https://vscode.example.com',
                },
                {}
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe('HTTP 413: File too large');
        });

        it('should handle network error', async () => {
            global.fetch.mockRejectedValue(new Error('Network error'));

            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'UPLOAD_FILE',
                    fileData: validBase64,
                    fileName: 'test.png',
                    fileType: 'image/png',
                    folder: '/opt/dev/test',
                    origin: 'https://vscode.example.com',
                },
                {}
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe('Network error');
        });

        it('should handle error without message property', async () => {
            // Error objects without message property get stringified
            global.fetch.mockRejectedValue({ code: 'ERR_CONNECTION_REFUSED' });

            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'UPLOAD_FILE',
                    fileData: validBase64,
                    fileName: 'test.png',
                    fileType: 'image/png',
                    folder: '/opt/dev/test',
                    origin: 'https://vscode.example.com',
                },
                {}
            );

            expect(result.success).toBe(false);
            // When error has no message, String(error) is used which returns [object Object]
            expect(result.error).toBeDefined();
            expect(typeof result.error).toBe('string');
        });

        it('should return path field if filename not in response', async () => {
            global.fetch.mockResolvedValue({
                ok: true,
                status: 200,
                json: jest.fn().mockResolvedValue({ path: '/tasks/files/uploaded.png' }),
            });

            const router = createMessageRouter(mockDeps);
            const result = await router.handleMessage(
                {
                    type: 'UPLOAD_FILE',
                    fileData: validBase64,
                    fileName: 'test.png',
                    fileType: 'image/png',
                    folder: '/opt/dev/test',
                    origin: 'https://vscode.example.com',
                },
                {}
            );

            expect(result.success).toBe(true);
            expect(result.filename).toBe('/tasks/files/uploaded.png');
        });
    });
});
