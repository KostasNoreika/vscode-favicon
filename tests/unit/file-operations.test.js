/**
 * Unit tests for shared file-operations utility
 *
 * Tests the consolidated retry logic for filesystem operations
 */

const {
    retryFileOperation,
    isRetryableError,
    RETRYABLE_FS_ERRORS,
    DEFAULT_RETRY_CONFIG
} = require('../../lib/utils/file-operations');

describe('File Operations Utility', () => {
    describe('RETRYABLE_FS_ERRORS', () => {
        it('should include all retryable error codes', () => {
            expect(RETRYABLE_FS_ERRORS).toEqual([
                'EAGAIN',
                'EBUSY',
                'ETIMEDOUT',
                'EMFILE',
                'ENFILE'
            ]);
        });
    });

    describe('DEFAULT_RETRY_CONFIG', () => {
        it('should have correct default configuration', () => {
            expect(DEFAULT_RETRY_CONFIG).toEqual({
                maxRetries: 3,
                initialDelayMs: 100,
                backoffMultiplier: 2,
                maxDelayMs: 2000
            });
        });
    });

    describe('isRetryableError()', () => {
        it('should return true for EAGAIN error', () => {
            const err = new Error('Resource temporarily unavailable');
            err.code = 'EAGAIN';
            expect(isRetryableError(err)).toBe(true);
        });

        it('should return true for EBUSY error', () => {
            const err = new Error('Resource busy');
            err.code = 'EBUSY';
            expect(isRetryableError(err)).toBe(true);
        });

        it('should return true for ETIMEDOUT error', () => {
            const err = new Error('Operation timed out');
            err.code = 'ETIMEDOUT';
            expect(isRetryableError(err)).toBe(true);
        });

        it('should return true for EMFILE error', () => {
            const err = new Error('Too many open files');
            err.code = 'EMFILE';
            expect(isRetryableError(err)).toBe(true);
        });

        it('should return true for ENFILE error', () => {
            const err = new Error('File table overflow');
            err.code = 'ENFILE';
            expect(isRetryableError(err)).toBe(true);
        });

        it('should return false for ENOENT error', () => {
            const err = new Error('No such file or directory');
            err.code = 'ENOENT';
            expect(isRetryableError(err)).toBe(false);
        });

        it('should return false for EACCES error', () => {
            const err = new Error('Permission denied');
            err.code = 'EACCES';
            expect(isRetryableError(err)).toBe(false);
        });

        it('should return false for error without code', () => {
            const err = new Error('Generic error');
            expect(isRetryableError(err)).toBe(false);
        });

        it('should return false for null', () => {
            expect(isRetryableError(null)).toBe(false);
        });

        it('should return false for undefined', () => {
            expect(isRetryableError(undefined)).toBe(false);
        });
    });

    describe('retryFileOperation()', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.clearAllTimers();
            jest.useRealTimers();
        });

        it('should execute successful operation without retry', async () => {
            const mockOperation = jest.fn().mockResolvedValue('success');

            const result = await retryFileOperation(mockOperation);

            expect(result).toBe('success');
            expect(mockOperation).toHaveBeenCalledTimes(1);
        });

        it('should retry EAGAIN error and succeed', async () => {
            const err = new Error('Resource temporarily unavailable');
            err.code = 'EAGAIN';

            const mockOperation = jest
                .fn()
                .mockRejectedValueOnce(err)
                .mockResolvedValueOnce('success');

            const promise = retryFileOperation(mockOperation);
            await jest.advanceTimersByTimeAsync(100);
            const result = await promise;

            expect(result).toBe('success');
            expect(mockOperation).toHaveBeenCalledTimes(2);
        });

        it('should retry EMFILE error and succeed', async () => {
            const err = new Error('Too many open files');
            err.code = 'EMFILE';

            const mockOperation = jest
                .fn()
                .mockRejectedValueOnce(err)
                .mockResolvedValueOnce('success');

            const promise = retryFileOperation(mockOperation);
            await jest.advanceTimersByTimeAsync(100);
            const result = await promise;

            expect(result).toBe('success');
            expect(mockOperation).toHaveBeenCalledTimes(2);
        });

        it('should not retry ENOENT error', async () => {
            const err = new Error('No such file or directory');
            err.code = 'ENOENT';

            const mockOperation = jest.fn().mockRejectedValue(err);

            await expect(retryFileOperation(mockOperation)).rejects.toThrow(
                'No such file or directory'
            );
            expect(mockOperation).toHaveBeenCalledTimes(1);
        });

        it('should throw after max retries exhausted', async () => {
            const err = new Error('Resource temporarily unavailable');
            err.code = 'EAGAIN';

            const mockOperation = jest.fn().mockRejectedValue(err);

            const operationPromise = retryFileOperation(mockOperation);
            await jest.runAllTimersAsync();

            await expect(operationPromise).rejects.toThrow(
                'Resource temporarily unavailable'
            );

            // Initial + 3 retries = 4 total attempts
            expect(mockOperation).toHaveBeenCalledTimes(4);
        });

        it('should use exponential backoff with max delay cap', async () => {
            const err = new Error('Resource busy');
            err.code = 'EBUSY';

            const mockOperation = jest.fn().mockRejectedValue(err);
            const delays = [];

            const originalSetTimeout = global.setTimeout;
            jest.spyOn(global, 'setTimeout').mockImplementation((callback, delay) => {
                if (delay !== undefined && delay > 0) {
                    delays.push(delay);
                }
                return originalSetTimeout(callback, 0);
            });

            const operationPromise = retryFileOperation(mockOperation);
            await jest.runAllTimersAsync();

            try {
                await operationPromise;
            } catch (err) {
                // Expected to fail
            }

            // Verify exponential backoff: 100ms, 200ms, 400ms
            // All should be under maxDelayMs (2000ms)
            expect(delays).toEqual([100, 200, 400]);

            global.setTimeout.mockRestore();
        });

        it('should respect custom retry configuration', async () => {
            const err = new Error('Resource busy');
            err.code = 'EBUSY';

            const mockOperation = jest.fn().mockRejectedValue(err);

            const operationPromise = retryFileOperation(mockOperation, {
                maxRetries: 1,
                initialDelayMs: 50,
                backoffMultiplier: 3,
                operationName: 'custom-test'
            });

            await jest.runAllTimersAsync();

            await expect(operationPromise).rejects.toThrow('Resource busy');

            // Initial + 1 retry = 2 total attempts
            expect(mockOperation).toHaveBeenCalledTimes(2);
        });

        it('should handle operation returning null', async () => {
            const mockOperation = jest.fn().mockResolvedValue(null);

            const result = await retryFileOperation(mockOperation);

            expect(result).toBeNull();
            expect(mockOperation).toHaveBeenCalledTimes(1);
        });

        it('should handle operation returning undefined', async () => {
            const mockOperation = jest.fn().mockResolvedValue(undefined);

            const result = await retryFileOperation(mockOperation);

            expect(result).toBeUndefined();
            expect(mockOperation).toHaveBeenCalledTimes(1);
        });
    });
});
