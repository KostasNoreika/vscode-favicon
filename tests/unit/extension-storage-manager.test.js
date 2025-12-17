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

// Mock console
global.console = {
    ...console,
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
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

        it('should reject malformed IPv6 ::1 URL (needs brackets)', () => {
            // http://::1:8080 is not valid - IPv6 requires brackets: http://[::1]:8080
            const result = validateApiUrl('http://::1:8080');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Invalid URL format');
        });

        it('should accept HTTP [::1] URL', () => {
            const result = validateApiUrl('http://[::1]:8080');
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

        it('should reject undefined', () => {
            const result = validateApiUrl(undefined);
            expect(result.valid).toBe(false);
        });

        it('should trim whitespace', () => {
            const result = validateApiUrl('  https://example.com  ');
            expect(result.valid).toBe(true);
            expect(result.url).toBe('https://example.com');
        });

        it('should reject whitespace-only string', () => {
            const result = validateApiUrl('   ');
            expect(result.valid).toBe(false);
        });

        it('should be case-insensitive for localhost', () => {
            expect(validateApiUrl('http://LOCALHOST:8080').valid).toBe(true);
            expect(validateApiUrl('http://LocalHost:8080').valid).toBe(true);
        });
    });

    describe('createStorageManager - basic operations', () => {
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

        it('should load empty array when storage is empty', async () => {
            chrome.storage.local.get.mockResolvedValue({});

            const manager = createStorageManager();
            const result = await manager.loadNotifications();

            expect(result).toEqual([]);
        });

        it('should use custom storage key', async () => {
            chrome.storage.local.get.mockResolvedValue({
                customKey: [{ folder: '/opt/dev/test', timestamp: 123 }],
            });

            const manager = createStorageManager({
                STORAGE_KEY: 'customKey',
            });
            const result = await manager.loadNotifications();

            expect(chrome.storage.local.get).toHaveBeenCalledWith('customKey');
            expect(result).toHaveLength(1);
        });
    });

    describe('Retry logic', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        it('should retry on storage errors', async () => {
            chrome.storage.local.get
                .mockRejectedValueOnce(new Error('Storage error'))
                .mockResolvedValueOnce({ notifications: [] });

            const manager = createStorageManager({
                STORAGE_RETRY_ATTEMPTS: 3,
                STORAGE_INITIAL_BACKOFF: 10,
            });

            const resultPromise = manager.loadNotifications();

            // Fast-forward through backoff delay
            await jest.advanceTimersByTimeAsync(10);

            const result = await resultPromise;

            expect(result).toEqual([]);
            expect(chrome.storage.local.get).toHaveBeenCalledTimes(2);
        });

        it('should use exponential backoff', async () => {
            chrome.storage.local.get
                .mockRejectedValueOnce(new Error('Error 1'))
                .mockRejectedValueOnce(new Error('Error 2'))
                .mockResolvedValueOnce({ notifications: [] });

            const manager = createStorageManager({
                STORAGE_RETRY_ATTEMPTS: 3,
                STORAGE_INITIAL_BACKOFF: 100,
            });

            const resultPromise = manager.loadNotifications();

            // First retry: 100ms
            await jest.advanceTimersByTimeAsync(100);
            // Second retry: 200ms
            await jest.advanceTimersByTimeAsync(200);

            const result = await resultPromise;

            expect(result).toEqual([]);
            expect(chrome.storage.local.get).toHaveBeenCalledTimes(3);
        });

        it('should cap backoff at max value', async () => {
            chrome.storage.local.get
                .mockRejectedValueOnce(new Error('Error 1'))
                .mockRejectedValueOnce(new Error('Error 2'))
                .mockResolvedValueOnce({ notifications: [] });

            const manager = createStorageManager({
                STORAGE_RETRY_ATTEMPTS: 3,
                STORAGE_INITIAL_BACKOFF: 3000,
                STORAGE_MAX_BACKOFF: 4000,
            });

            const resultPromise = manager.loadNotifications();

            // First retry: 3000ms
            await jest.advanceTimersByTimeAsync(3000);
            // Second retry: capped at 4000ms (not 6000ms)
            await jest.advanceTimersByTimeAsync(4000);

            const result = await resultPromise;

            expect(result).toEqual([]);
        });

        it('should fail after max retries', async () => {
            chrome.storage.local.get.mockRejectedValue(new Error('Persistent error'));

            const manager = createStorageManager({
                STORAGE_RETRY_ATTEMPTS: 2,
                STORAGE_INITIAL_BACKOFF: 10,
            });

            const resultPromise = manager.loadNotifications();

            await jest.advanceTimersByTimeAsync(10);
            await jest.advanceTimersByTimeAsync(20);

            const result = await resultPromise;

            expect(result).toEqual([]);
            expect(chrome.storage.local.get).toHaveBeenCalledTimes(2);
            // The implementation logs 'Storage Manager:', operation, 'failed after', attempts, 'attempts'
            expect(console.error).toHaveBeenCalledWith(
                'Storage Manager:',
                'loadNotifications',
                'failed after',
                2,
                'attempts'
            );
        });

        it('should log retry attempts', async () => {
            chrome.storage.local.get
                .mockRejectedValueOnce(new Error('Error'))
                .mockResolvedValueOnce({ notifications: [] });

            const manager = createStorageManager({
                STORAGE_RETRY_ATTEMPTS: 3,
                STORAGE_INITIAL_BACKOFF: 10,
            });

            const resultPromise = manager.loadNotifications();
            await jest.advanceTimersByTimeAsync(10);
            await resultPromise;

            // Note: The implementation concatenates '/' + attempts + ')' as a single string
            expect(console.warn).toHaveBeenCalledWith(
                'Storage Manager: Retrying',
                'loadNotifications',
                'in',
                10,
                'ms (attempt',
                2,
                '/3)'
            );
        });
    });

    describe('Error tracking and badge management', () => {
        it('should track consecutive failures', async () => {
            chrome.storage.local.set
                .mockRejectedValueOnce(new Error('Error 1'))
                .mockRejectedValueOnce(new Error('Error 2'))
                .mockRejectedValueOnce(new Error('Error 3'));

            const manager = createStorageManager({
                STORAGE_RETRY_ATTEMPTS: 1,
                STORAGE_ERROR_THRESHOLD: 3,
            });

            await manager.saveNotifications([]);
            await manager.saveNotifications([]);
            await manager.saveNotifications([]);

            const status = manager.getErrorStatus();
            expect(status.consecutiveFailures).toBe(3);
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
            expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#FF5722' });
            expect(chrome.action.setTitle).toHaveBeenCalledWith({
                title: 'Storage error - notifications may not persist',
            });
            expect(manager.hasStorageError()).toBe(true);
        });

        it('should clear error badge on recovery', async () => {
            chrome.storage.local.set
                .mockRejectedValueOnce(new Error('Error 1'))
                .mockRejectedValueOnce(new Error('Error 2'))
                .mockRejectedValueOnce(new Error('Error 3'))
                .mockResolvedValueOnce();

            const manager = createStorageManager({
                STORAGE_RETRY_ATTEMPTS: 1,
                STORAGE_ERROR_THRESHOLD: 3,
            });

            // Trigger failures to set badge
            await manager.saveNotifications([]);
            await manager.saveNotifications([]);
            await manager.saveNotifications([]);
            expect(manager.getErrorStatus().consecutiveFailures).toBe(3);
            expect(manager.hasStorageError()).toBe(true);

            // Trigger success - should clear badge and reset counter
            await manager.saveNotifications([]);

            expect(manager.hasStorageError()).toBe(false);
            expect(manager.getErrorStatus().consecutiveFailures).toBe(0);
        });

        it('should call updateBadge callback on recovery', async () => {
            chrome.storage.local.set
                .mockRejectedValueOnce(new Error('Error 1'))
                .mockRejectedValueOnce(new Error('Error 2'))
                .mockRejectedValueOnce(new Error('Error 3'))
                .mockResolvedValueOnce();

            const updateBadge = jest.fn();
            const manager = createStorageManager(
                {
                    STORAGE_RETRY_ATTEMPTS: 1,
                    STORAGE_ERROR_THRESHOLD: 3,
                },
                updateBadge
            );

            // Trigger errors to set badge
            await manager.saveNotifications([]);
            await manager.saveNotifications([]);
            await manager.saveNotifications([]);
            expect(manager.hasStorageError()).toBe(true);

            // Trigger success
            await manager.saveNotifications([]);
            expect(updateBadge).toHaveBeenCalled();
        });

        it('should not set badge multiple times', async () => {
            chrome.storage.local.set.mockRejectedValue(new Error('Error'));

            const manager = createStorageManager({
                STORAGE_RETRY_ATTEMPTS: 1,
                STORAGE_ERROR_THRESHOLD: 2,
            });

            await manager.saveNotifications([]);
            await manager.saveNotifications([]);

            const firstCallCount = chrome.action.setBadgeText.mock.calls.length;

            await manager.saveNotifications([]);

            // Should not call badge functions again
            expect(chrome.action.setBadgeText.mock.calls.length).toBe(firstCallCount);
        });

        it('should record error details', async () => {
            chrome.storage.local.set.mockRejectedValue(new Error('Test error'));

            const manager = createStorageManager({
                STORAGE_RETRY_ATTEMPTS: 1,
            });

            await manager.saveNotifications([]);

            const status = manager.getErrorStatus();
            expect(status.lastErrorMessage).toBe('Test error');
            expect(status.lastErrorTime).toBeTruthy();
        });

        it('should log QuotaExceededError specially', async () => {
            const quotaError = new Error('Quota exceeded');
            quotaError.name = 'QuotaExceededError';
            chrome.storage.local.set.mockRejectedValue(quotaError);

            const manager = createStorageManager({
                STORAGE_RETRY_ATTEMPTS: 1,
            });

            await manager.saveNotifications([]);

            expect(console.error).toHaveBeenCalledWith(
                'Storage Manager: Error in',
                'saveNotifications',
                '(failure',
                '1):',
                'Quota exceeded',
                expect.objectContaining({
                    name: 'QuotaExceededError',
                    quota: true,
                })
            );
        });

        it('should log recovery success', async () => {
            chrome.storage.local.get
                .mockRejectedValueOnce(new Error('Error'))
                .mockResolvedValueOnce({ notifications: [] });

            const manager = createStorageManager({
                STORAGE_RETRY_ATTEMPTS: 2,
                STORAGE_INITIAL_BACKOFF: 10,
            });

            await manager.loadNotifications();

            // Second call succeeds
            await manager.loadNotifications();

            expect(console.log).toHaveBeenCalledWith(
                'Storage Manager:',
                'loadNotifications',
                'succeeded after',
                1,
                'previous failures'
            );
        });
    });

    describe('retryStorageOperation', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        it('should return result on first success', async () => {
            const manager = createStorageManager();

            const operation = jest.fn().mockResolvedValue('success');
            const result = await manager.retryStorageOperation('testOp', operation);

            expect(result).toBe('success');
            expect(operation).toHaveBeenCalledTimes(1);
        });

        it('should retry failed operations', async () => {
            const manager = createStorageManager({
                STORAGE_RETRY_ATTEMPTS: 3,
                STORAGE_INITIAL_BACKOFF: 10,
            });

            const operation = jest.fn()
                .mockRejectedValueOnce(new Error('Fail'))
                .mockResolvedValueOnce('success');

            const resultPromise = manager.retryStorageOperation('testOp', operation);
            await jest.advanceTimersByTimeAsync(10);
            const result = await resultPromise;

            expect(result).toBe('success');
            expect(operation).toHaveBeenCalledTimes(2);
        });

        it('should throw after all retries exhausted', async () => {
            const manager = createStorageManager({
                STORAGE_RETRY_ATTEMPTS: 2,
                STORAGE_INITIAL_BACKOFF: 10,
            });

            const testError = new Error('Persistent error');
            const operation = jest.fn().mockRejectedValue(testError);

            let thrownError;
            const testPromise = (async () => {
                try {
                    await manager.retryStorageOperation('testOp', operation);
                } catch (e) {
                    thrownError = e;
                }
            })();

            // Advance timers for the retry backoff (attempt 1 fails immediately, then waits 10ms for attempt 2)
            await jest.advanceTimersByTimeAsync(10);

            await testPromise;

            expect(thrownError).toBeDefined();
            expect(thrownError.message).toBe('Persistent error');
            expect(operation).toHaveBeenCalledTimes(2);
        });
    });

    describe('getErrorStatus', () => {
        it('should return error status', async () => {
            chrome.storage.local.set.mockRejectedValue(new Error('Test error'));

            const manager = createStorageManager({
                STORAGE_RETRY_ATTEMPTS: 1,
            });

            await manager.saveNotifications([]);

            const status = manager.getErrorStatus();
            expect(status).toMatchObject({
                consecutiveFailures: 1,
                lastErrorTime: expect.any(Number),
                lastErrorMessage: 'Test error',
                hasActiveBadge: false,
            });
        });

        it('should show active badge when threshold exceeded', async () => {
            chrome.storage.local.set.mockRejectedValue(new Error('Error'));

            const manager = createStorageManager({
                STORAGE_RETRY_ATTEMPTS: 1,
                STORAGE_ERROR_THRESHOLD: 2,
            });

            await manager.saveNotifications([]);
            await manager.saveNotifications([]);

            const status = manager.getErrorStatus();
            expect(status.hasActiveBadge).toBe(true);
        });
    });

    describe('hasStorageError', () => {
        it('should return false initially', () => {
            const manager = createStorageManager();
            expect(manager.hasStorageError()).toBe(false);
        });

        it('should return true after error threshold', async () => {
            chrome.storage.local.set.mockRejectedValue(new Error('Error'));

            const manager = createStorageManager({
                STORAGE_RETRY_ATTEMPTS: 1,
                STORAGE_ERROR_THRESHOLD: 2,
            });

            await manager.saveNotifications([]);
            expect(manager.hasStorageError()).toBe(false);

            await manager.saveNotifications([]);
            expect(manager.hasStorageError()).toBe(true);
        });

        it('should return false after recovery', async () => {
            chrome.storage.local.set
                .mockRejectedValueOnce(new Error('Error'))
                .mockRejectedValueOnce(new Error('Error'))
                .mockResolvedValueOnce();

            const manager = createStorageManager({
                STORAGE_RETRY_ATTEMPTS: 1,
                STORAGE_ERROR_THRESHOLD: 2,
            });

            await manager.saveNotifications([]);
            await manager.saveNotifications([]);
            expect(manager.hasStorageError()).toBe(true);

            await manager.saveNotifications([]);
            expect(manager.hasStorageError()).toBe(false);
        });
    });
});
