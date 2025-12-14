/**
 * Unit tests for transient filesystem error retry logic in paste-routes.js
 *
 * Tests verify:
 * - Successful operations pass through without retry
 * - Transient errors (EAGAIN, EBUSY, ETIMEDOUT) are retried with exponential backoff
 * - Non-transient errors fail immediately without retry
 * - Max retry limit is enforced
 * - Exponential backoff timing is correct
 */

const {
    retryTransientErrors,
    RETRYABLE_ERROR_CODES,
    RETRY_CONFIG,
} = require('../../lib/routes/paste-routes');

describe('Transient Filesystem Error Retry Logic', () => {
    // Mock timers to control and verify exponential backoff
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    describe('retryTransientErrors() - Success Cases', () => {
        it('should execute successful operation without retry', async () => {
            const mockOperation = jest.fn().mockResolvedValue('success');

            const result = await retryTransientErrors(mockOperation, 'test-op');

            expect(result).toBe('success');
            expect(mockOperation).toHaveBeenCalledTimes(1);
        });

        it('should return operation result on successful retry', async () => {
            const mockOperation = jest
                .fn()
                .mockRejectedValueOnce(Object.assign(new Error('EAGAIN'), { code: 'EAGAIN' }))
                .mockResolvedValueOnce({ data: 'success' });

            const promise = retryTransientErrors(mockOperation, 'test-op');

            // Fast-forward through the retry delay
            await jest.advanceTimersByTimeAsync(100);

            const result = await promise;

            expect(result).toEqual({ data: 'success' });
            expect(mockOperation).toHaveBeenCalledTimes(2);
        });
    });

    describe('retryTransientErrors() - Transient Error Retry', () => {
        it('should retry EAGAIN error and succeed on second attempt', async () => {
            const error = new Error('Resource temporarily unavailable');
            error.code = 'EAGAIN';

            const mockOperation = jest
                .fn()
                .mockRejectedValueOnce(error)
                .mockResolvedValueOnce('success');

            const promise = retryTransientErrors(mockOperation, 'test-op');

            // Advance through first retry delay (100ms)
            await jest.advanceTimersByTimeAsync(100);

            const result = await promise;

            expect(result).toBe('success');
            expect(mockOperation).toHaveBeenCalledTimes(2);
        });

        it('should retry EBUSY error and succeed on third attempt', async () => {
            const error = new Error('Resource busy');
            error.code = 'EBUSY';

            const mockOperation = jest
                .fn()
                .mockRejectedValueOnce(error)
                .mockRejectedValueOnce(error)
                .mockResolvedValueOnce('success');

            const promise = retryTransientErrors(mockOperation, 'test-op');

            // Advance through first retry (100ms) and second retry (200ms)
            await jest.advanceTimersByTimeAsync(100);
            await jest.advanceTimersByTimeAsync(200);

            const result = await promise;

            expect(result).toBe('success');
            expect(mockOperation).toHaveBeenCalledTimes(3);
        });

        it('should retry ETIMEDOUT error and succeed on fourth attempt', async () => {
            const error = new Error('Operation timed out');
            error.code = 'ETIMEDOUT';

            const mockOperation = jest
                .fn()
                .mockRejectedValueOnce(error)
                .mockRejectedValueOnce(error)
                .mockRejectedValueOnce(error)
                .mockResolvedValueOnce('success');

            const promise = retryTransientErrors(mockOperation, 'test-op');

            // Advance through retries: 100ms, 200ms, 400ms
            await jest.advanceTimersByTimeAsync(100);
            await jest.advanceTimersByTimeAsync(200);
            await jest.advanceTimersByTimeAsync(400);

            const result = await promise;

            expect(result).toBe('success');
            expect(mockOperation).toHaveBeenCalledTimes(4);
        });
    });

    describe('retryTransientErrors() - Non-Transient Errors', () => {
        it('should fail immediately on ENOENT without retry', async () => {
            const error = new Error('No such file or directory');
            error.code = 'ENOENT';

            const mockOperation = jest.fn().mockRejectedValue(error);

            await expect(retryTransientErrors(mockOperation, 'test-op')).rejects.toThrow(
                'No such file or directory'
            );
            expect(mockOperation).toHaveBeenCalledTimes(1);
        });

        it('should fail immediately on EACCES without retry', async () => {
            const error = new Error('Permission denied');
            error.code = 'EACCES';

            const mockOperation = jest.fn().mockRejectedValue(error);

            await expect(retryTransientErrors(mockOperation, 'test-op')).rejects.toThrow(
                'Permission denied'
            );
            expect(mockOperation).toHaveBeenCalledTimes(1);
        });

        it('should fail immediately on EEXIST without retry', async () => {
            const error = new Error('File exists');
            error.code = 'EEXIST';

            const mockOperation = jest.fn().mockRejectedValue(error);

            await expect(retryTransientErrors(mockOperation, 'test-op')).rejects.toThrow(
                'File exists'
            );
            expect(mockOperation).toHaveBeenCalledTimes(1);
        });

        it('should fail immediately on generic error without retry', async () => {
            const error = new Error('Unknown error');
            // No error code

            const mockOperation = jest.fn().mockRejectedValue(error);

            await expect(retryTransientErrors(mockOperation, 'test-op')).rejects.toThrow(
                'Unknown error'
            );
            expect(mockOperation).toHaveBeenCalledTimes(1);
        });
    });

    describe('retryTransientErrors() - Max Retries Exhausted', () => {
        it('should throw error after max retries exhausted', async () => {
            const mockError = new Error('Resource temporarily unavailable');
            mockError.code = 'EAGAIN';

            const mockOperation = jest.fn().mockRejectedValue(mockError);

            // Start the retry operation
            const operationPromise = retryTransientErrors(mockOperation, 'test-op');

            // Run all timers to complete all retries
            await jest.runAllTimersAsync();

            // Verify the error is thrown
            try {
                await operationPromise;
                throw new Error('Should have thrown an error');
            } catch (err) {
                expect(err.message).toBe('Resource temporarily unavailable');
                expect(err.code).toBe('EAGAIN');
            }

            // Should be called: initial attempt + 3 retries = 4 times
            expect(mockOperation).toHaveBeenCalledTimes(4);
        });

        it('should respect custom maxRetries configuration', async () => {
            const mockError = new Error('Resource busy');
            mockError.code = 'EBUSY';

            const mockOperation = jest.fn().mockRejectedValue(mockError);
            const customConfig = { ...RETRY_CONFIG, maxRetries: 1 };

            // Start the retry operation
            const operationPromise = retryTransientErrors(mockOperation, 'test-op', customConfig);

            // Run all timers to complete all retries
            await jest.runAllTimersAsync();

            // Verify the error is thrown
            try {
                await operationPromise;
                throw new Error('Should have thrown an error');
            } catch (err) {
                expect(err.message).toBe('Resource busy');
                expect(err.code).toBe('EBUSY');
            }

            // Should be called: initial attempt + 1 retry = 2 times
            expect(mockOperation).toHaveBeenCalledTimes(2);
        });
    });

    describe('retryTransientErrors() - Exponential Backoff', () => {
        it('should use exponential backoff with correct delays', async () => {
            const mockError = new Error('Resource temporarily unavailable');
            mockError.code = 'EAGAIN';

            const mockOperation = jest.fn().mockRejectedValue(mockError);
            const delays = [];

            // Capture actual delay timings
            const originalSetTimeout = global.setTimeout;
            jest.spyOn(global, 'setTimeout').mockImplementation((callback, delay) => {
                if (delay !== undefined && delay > 0) {
                    delays.push(delay);
                }
                return originalSetTimeout(callback, 0);
            });

            // Start the retry operation
            const operationPromise = retryTransientErrors(mockOperation, 'test-op');

            // Advance timers to complete all retries
            await jest.runAllTimersAsync();

            // Verify error was thrown
            try {
                await operationPromise;
                throw new Error('Should have thrown an error');
            } catch (err) {
                expect(err.message).toBe('Resource temporarily unavailable');
            }

            // Verify exponential backoff: 100ms, 200ms, 400ms
            expect(delays).toEqual([100, 200, 400]);

            global.setTimeout.mockRestore();
        });

        it('should use custom backoff configuration', async () => {
            const mockError = new Error('Resource busy');
            mockError.code = 'EBUSY';

            const mockOperation = jest.fn().mockRejectedValue(mockError);
            const customConfig = {
                maxRetries: 2,
                initialDelayMs: 50,
                backoffMultiplier: 3,
            };
            const delays = [];

            const originalSetTimeout = global.setTimeout;
            jest.spyOn(global, 'setTimeout').mockImplementation((callback, delay) => {
                if (delay !== undefined && delay > 0) {
                    delays.push(delay);
                }
                return originalSetTimeout(callback, 0);
            });

            // Start the retry operation
            const operationPromise = retryTransientErrors(mockOperation, 'test-op', customConfig);

            await jest.runAllTimersAsync();

            // Verify error was thrown
            try {
                await operationPromise;
                throw new Error('Should have thrown an error');
            } catch (err) {
                expect(err.message).toBe('Resource busy');
            }

            // Verify custom backoff: 50ms, 150ms (50 * 3^1)
            expect(delays).toEqual([50, 150]);

            global.setTimeout.mockRestore();
        });
    });

    describe('retryTransientErrors() - All Retryable Error Codes', () => {
        it('should have correct retryable error codes defined', () => {
            expect(RETRYABLE_ERROR_CODES).toEqual(['EAGAIN', 'EBUSY', 'ETIMEDOUT']);
        });

        it('should retry all defined retryable error codes', async () => {
            for (const errorCode of RETRYABLE_ERROR_CODES) {
                const error = new Error(`Test error: ${errorCode}`);
                error.code = errorCode;

                const mockOperation = jest
                    .fn()
                    .mockRejectedValueOnce(error)
                    .mockResolvedValueOnce('success');

                const promise = retryTransientErrors(mockOperation, `test-${errorCode}`);

                await jest.advanceTimersByTimeAsync(100);
                const result = await promise;

                expect(result).toBe('success');
                expect(mockOperation).toHaveBeenCalledTimes(2);

                mockOperation.mockClear();
            }
        });
    });

    describe('retryTransientErrors() - Default Configuration', () => {
        it('should use correct default retry configuration', () => {
            expect(RETRY_CONFIG).toEqual({
                maxRetries: 3,
                initialDelayMs: 100,
                backoffMultiplier: 2,
            });
        });
    });

    describe('retryTransientErrors() - Edge Cases', () => {
        it('should handle operation returning null', async () => {
            const mockOperation = jest.fn().mockResolvedValue(null);

            const result = await retryTransientErrors(mockOperation, 'test-op');

            expect(result).toBeNull();
            expect(mockOperation).toHaveBeenCalledTimes(1);
        });

        it('should handle operation returning undefined', async () => {
            const mockOperation = jest.fn().mockResolvedValue(undefined);

            const result = await retryTransientErrors(mockOperation, 'test-op');

            expect(result).toBeUndefined();
            expect(mockOperation).toHaveBeenCalledTimes(1);
        });

        it('should handle operation returning falsy values', async () => {
            const mockOperation = jest.fn().mockResolvedValue(0);

            const result = await retryTransientErrors(mockOperation, 'test-op');

            expect(result).toBe(0);
            expect(mockOperation).toHaveBeenCalledTimes(1);
        });

        it('should preserve error properties on retry exhaustion', async () => {
            const mockError = new Error('Resource busy');
            mockError.code = 'EBUSY';
            mockError.path = '/tmp/test.txt';
            mockError.errno = -16;

            const mockOperation = jest.fn().mockRejectedValue(mockError);

            // Start the retry operation
            const operationPromise = retryTransientErrors(mockOperation, 'test-op');

            await jest.runAllTimersAsync();

            // Verify error properties are preserved
            try {
                await operationPromise;
                throw new Error('Should have thrown an error');
            } catch (err) {
                expect(err.code).toBe('EBUSY');
                expect(err.path).toBe('/tmp/test.txt');
                expect(err.errno).toBe(-16);
                expect(err.message).toBe('Resource busy');
            }
        });
    });

    describe('retryTransientErrors() - Integration Scenarios', () => {
        it('should handle mixed transient and non-transient errors', async () => {
            const transientError = new Error('Resource temporarily unavailable');
            transientError.code = 'EAGAIN';

            const permanentError = new Error('Permission denied');
            permanentError.code = 'EACCES';

            const mockOperation = jest
                .fn()
                .mockRejectedValueOnce(transientError)
                .mockRejectedValueOnce(permanentError);

            const operationPromise = retryTransientErrors(mockOperation, 'test-op');

            await jest.advanceTimersByTimeAsync(100);

            // Verify correct error is thrown
            try {
                await operationPromise;
                throw new Error('Should have thrown an error');
            } catch (err) {
                expect(err.message).toBe('Permission denied');
                expect(err.code).toBe('EACCES');
            }

            expect(mockOperation).toHaveBeenCalledTimes(2);
        });

        it('should handle operation that succeeds after intermittent failures', async () => {
            const error = new Error('Resource busy');
            error.code = 'EBUSY';

            const mockOperation = jest
                .fn()
                .mockRejectedValueOnce(error)
                .mockRejectedValueOnce(error)
                .mockResolvedValueOnce({ status: 'ok', data: [1, 2, 3] });

            const promise = retryTransientErrors(mockOperation, 'test-op');

            await jest.advanceTimersByTimeAsync(100);
            await jest.advanceTimersByTimeAsync(200);
            const result = await promise;

            expect(result).toEqual({ status: 'ok', data: [1, 2, 3] });
            expect(mockOperation).toHaveBeenCalledTimes(3);
        });
    });
});
