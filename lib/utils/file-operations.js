/**
 * File operation utilities with retry logic for transient errors
 * @module file-operations
 *
 * QUALITY FIX: Extracted from duplicated retry logic in:
 * - lib/routes/paste-routes.js (retryTransientErrors)
 * - lib/services/favicon-service.js (readFileWithErrorHandling)
 *
 * Provides unified retry handling for filesystem operations that may encounter
 * transient errors like resource unavailability, file locking, or file descriptor exhaustion.
 */

const logger = require('../logger');

/**
 * Errors that can be retried (transient filesystem errors)
 *
 * - EAGAIN: Resource temporarily unavailable
 * - EBUSY: Resource busy or locked
 * - ETIMEDOUT: Operation timed out
 * - EMFILE: Too many open files (process limit)
 * - ENFILE: Too many open files (system limit)
 */
const RETRYABLE_FS_ERRORS = ['EAGAIN', 'EBUSY', 'ETIMEDOUT', 'EMFILE', 'ENFILE'];

/**
 * Default retry configuration with exponential backoff
 */
const DEFAULT_RETRY_CONFIG = {
    maxRetries: 3,
    initialDelayMs: 100,
    backoffMultiplier: 2,
    maxDelayMs: 2000,
};

/**
 * Retry a file operation with exponential backoff for transient errors
 *
 * Implements exponential backoff with configurable parameters:
 * - delay = min(initialDelayMs * (backoffMultiplier ^ attempt), maxDelayMs)
 *
 * Non-retryable errors are thrown immediately without retry.
 * After max retries exhausted, the last error is thrown.
 *
 * @param {Function} operation - Async function to retry
 * @param {Object} options - Retry options
 * @param {number} [options.maxRetries=3] - Maximum retry attempts
 * @param {number} [options.initialDelayMs=100] - Initial delay in milliseconds
 * @param {number} [options.backoffMultiplier=2] - Exponential backoff multiplier
 * @param {number} [options.maxDelayMs=2000] - Maximum delay cap in milliseconds
 * @param {string} [options.operationName='file operation'] - Name for logging
 * @returns {Promise<*>} Result of the operation
 * @throws {Error} Final error after all retries exhausted, or non-retryable error
 *
 * @example
 * // Retry file read with default config
 * const data = await retryFileOperation(
 *   () => fs.promises.readFile('/path/to/file')
 * );
 *
 * @example
 * // Retry with custom config and operation name
 * const data = await retryFileOperation(
 *   () => fs.promises.writeFile('/path/to/file', content),
 *   {
 *     maxRetries: 5,
 *     initialDelayMs: 50,
 *     operationName: 'writing config.json'
 *   }
 * );
 */
async function retryFileOperation(operation, options = {}) {
    const config = { ...DEFAULT_RETRY_CONFIG, ...options };
    const { maxRetries, initialDelayMs, backoffMultiplier, maxDelayMs, operationName = 'file operation' } = config;

    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (err) {
            const isRetryable = RETRYABLE_FS_ERRORS.includes(err.code);
            const hasRetriesLeft = attempt < maxRetries;

            // Fail fast for non-retryable errors or when retries exhausted
            if (!isRetryable || !hasRetriesLeft) {
                if (isRetryable && !hasRetriesLeft && attempt > 0) {
                    // Only log warning if we actually retried
                    logger.warn({
                        err,
                        errorCode: err.code,
                        attempt: attempt + 1,
                        maxRetries,
                        operationName
                    }, `${operationName} failed after ${attempt + 1} attempts`);
                }
                throw err;
            }

            lastError = err;

            // Calculate exponential backoff delay with max cap
            const delay = Math.min(
                initialDelayMs * Math.pow(backoffMultiplier, attempt),
                maxDelayMs
            );

            logger.debug({
                errorCode: err.code,
                attempt: attempt + 1,
                maxRetries,
                delayMs: delay,
                operationName
            }, `Retrying ${operationName} after transient error`);

            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    // Should never reach here due to throw in loop, but for safety
    throw lastError;
}

/**
 * Check if an error is a retryable filesystem error
 *
 * @param {Error} err - Error to check
 * @returns {boolean} True if error code is in RETRYABLE_FS_ERRORS list
 *
 * @example
 * try {
 *   await fs.promises.readFile('/path/to/file');
 * } catch (err) {
 *   if (isRetryableError(err)) {
 *     // Handle retryable error
 *   } else {
 *     // Handle permanent error
 *   }
 * }
 */
function isRetryableError(err) {
    return !!(err && RETRYABLE_FS_ERRORS.includes(err.code));
}

module.exports = {
    retryFileOperation,
    isRetryableError,
    RETRYABLE_FS_ERRORS,
    DEFAULT_RETRY_CONFIG
};
