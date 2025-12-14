/**
 * Unit tests for extension storage-manager module
 */

const { createStorageManager, validateApiUrl } = require('../../vscode-favicon-extension/modules/storage-manager');

// Mock chrome.storage.local
global.chrome = {
    storage: {
        local: {
            get: jest.fn(),
            set: jest.fn(),
        },
    },
    action: {
        setBadgeText: jest.fn(),
        setBadgeBackgroundColor: jest.fn(),
        setTitle: jest.fn(),
    },
};

describe('storage-manager', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('validateApiUrl', () => {
        it('should accept valid HTTPS URL', () => {
            const result = validateApiUrl('https://example.com');
            expect(result.valid).toBe(true);
            expect(result.url).toBe('https://example.com');
        });

        it('should accept HTTP localhost URL', () => {
            const result = validateApiUrl('http://localhost:8080');
            expect(result.valid).toBe(true);
        });

        it('should accept HTTP 127.0.0.1 URL', () => {
            const result = validateApiUrl('http://127.0.0.1:8080');
            expect(result.valid).toBe(true);
        });

        it('should reject HTTP non-localhost URL', () => {
            const result = validateApiUrl('http://example.com');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('HTTPS');
        });

        it('should reject invalid URL format', () => {
            const result = validateApiUrl('not-a-url');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Invalid URL format');
        });

        it('should reject non-HTTP protocols', () => {
            const result = validateApiUrl('ftp://example.com');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('HTTP and HTTPS');
        });

        it('should reject empty string', () => {
            const result = validateApiUrl('');
            expect(result.valid).toBe(false);
        });

        it('should reject null', () => {
            const result = validateApiUrl(null);
            expect(result.valid).toBe(false);
        });

        it('should trim whitespace', () => {
            const result = validateApiUrl('  https://example.com  ');
            expect(result.valid).toBe(true);
            expect(result.url).toBe('https://example.com');
        });
    });

    describe('createStorageManager', () => {
        it('should load notifications successfully', async () => {
            const mockNotifications = [
                { folder: '/opt/dev/project1', timestamp: 123456 },
                { folder: '/opt/dev/project2', timestamp: 123457 },
            ];

            chrome.storage.local.get.mockResolvedValue({
                notifications: mockNotifications,
            });

            const manager = createStorageManager();
            const result = await manager.loadNotifications();

            expect(result).toEqual(mockNotifications);
            expect(chrome.storage.local.get).toHaveBeenCalledWith('notifications');
        });

        it('should return empty array on load error', async () => {
            chrome.storage.local.get.mockRejectedValue(new Error('Storage error'));

            const manager = createStorageManager({
                STORAGE_RETRY_ATTEMPTS: 1, // Fast fail for testing
            });
            const result = await manager.loadNotifications();

            expect(result).toEqual([]);
        });

        it('should save notifications successfully', async () => {
            chrome.storage.local.set.mockResolvedValue();

            const manager = createStorageManager();
            const notifications = [{ folder: '/opt/dev/test', timestamp: 123456 }];

            await manager.saveNotifications(notifications);

            expect(chrome.storage.local.set).toHaveBeenCalledWith({
                notifications: notifications,
            });
        });

        it('should retry on storage errors', async () => {
            chrome.storage.local.get
                .mockRejectedValueOnce(new Error('Storage error'))
                .mockResolvedValueOnce({ notifications: [] });

            const manager = createStorageManager({
                STORAGE_RETRY_ATTEMPTS: 3,
                STORAGE_INITIAL_BACKOFF: 10,
            });

            const result = await manager.loadNotifications();

            expect(result).toEqual([]);
            expect(chrome.storage.local.get).toHaveBeenCalledTimes(2);
        });

        it('should set error badge after threshold', async () => {
            chrome.storage.local.set
                .mockRejectedValueOnce(new Error('Error 1'))
                .mockRejectedValueOnce(new Error('Error 2'))
                .mockRejectedValueOnce(new Error('Error 3'));

            const manager = createStorageManager({
                STORAGE_RETRY_ATTEMPTS: 1,
                STORAGE_ERROR_THRESHOLD: 3,
            });

            // Trigger 3 failures
            await manager.saveNotifications([]);
            await manager.saveNotifications([]);
            await manager.saveNotifications([]);

            expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '!' });
            expect(manager.hasStorageError()).toBe(true);
        });

        it('should clear error badge on recovery', async () => {
            chrome.storage.local.set
                .mockRejectedValueOnce(new Error('Error'))
                .mockResolvedValueOnce();

            const manager = createStorageManager({
                STORAGE_RETRY_ATTEMPTS: 1,
                STORAGE_INITIAL_BACKOFF: 10,
            });

            // Trigger failure
            await manager.saveNotifications([]);

            // Trigger success
            chrome.storage.local.set.mockResolvedValue();
            await manager.saveNotifications([]);

            expect(manager.hasStorageError()).toBe(false);
        });
    });
});
