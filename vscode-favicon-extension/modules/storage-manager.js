/**
 * Storage and configuration management utilities
 * Handles API URL validation, storage operations with retry logic, and error tracking
 */

const DEFAULT_CONFIG = {
    STORAGE_KEY: 'notifications',
    API_URL_STORAGE_KEY: 'apiBaseUrl',
    STORAGE_RETRY_ATTEMPTS: 3,
    STORAGE_INITIAL_BACKOFF: 100,
    STORAGE_MAX_BACKOFF: 5000,
    STORAGE_ERROR_THRESHOLD: 3,
};

/**
 * Create storage manager with configuration
 * @param {object} config - Configuration object
 * @param {Function} updateBadge - Badge update callback
 * @returns {object} - Storage manager instance
 */
function createStorageManager(config = {}, updateBadge = null) {
    const cfg = { ...DEFAULT_CONFIG, ...config };

    // Storage error tracking for graceful degradation
    const errorTracker = {
        consecutiveFailures: 0,
        lastErrorTime: null,
        lastErrorMessage: null,
        hasActiveBadge: false,
    };

    /**
     * Set error badge on extension icon
     */
    function setStorageErrorBadge() {
        if (errorTracker.hasActiveBadge) return;

        errorTracker.hasActiveBadge = true;
        chrome.action.setBadgeText({ text: '!' });
        chrome.action.setBadgeBackgroundColor({ color: '#FF5722' });
        chrome.action.setTitle({ title: 'Storage error - notifications may not persist' });
        console.error('Storage Manager: Error badge activated after', errorTracker.consecutiveFailures, 'failures');
    }

    /**
     * Clear error badge on successful recovery
     */
    function clearStorageErrorBadge() {
        if (!errorTracker.hasActiveBadge) return;

        errorTracker.hasActiveBadge = false;
        errorTracker.consecutiveFailures = 0;
        errorTracker.lastErrorTime = null;
        errorTracker.lastErrorMessage = null;

        // Restore normal notification badge
        if (updateBadge) {
            updateBadge();
        }
        console.log('Storage Manager: Error badge cleared - recovery successful');
    }

    /**
     * Record storage error with tracking
     * @param {string} operation - Operation name
     * @param {Error} error - Error object
     */
    function recordStorageError(operation, error) {
        errorTracker.consecutiveFailures++;
        errorTracker.lastErrorTime = Date.now();
        errorTracker.lastErrorMessage = error.message;

        console.error('Storage Manager: Error in', operation,
            '(failure', errorTracker.consecutiveFailures + '):', error.message, {
            name: error.name,
            quota: error.name === 'QuotaExceededError',
        });

        if (errorTracker.consecutiveFailures >= cfg.STORAGE_ERROR_THRESHOLD) {
            setStorageErrorBadge();
        }
    }

    /**
     * Retry storage operation with exponential backoff
     * @param {string} operation - Operation name
     * @param {Function} fn - Async function to retry
     * @param {number} attempt - Current attempt number
     * @returns {Promise<*>} - Operation result
     */
    async function retryStorageOperation(operation, fn, attempt = 1) {
        try {
            const result = await fn();

            // Success - clear error tracking
            if (errorTracker.consecutiveFailures > 0) {
                console.log('Storage Manager:', operation,
                    'succeeded after', errorTracker.consecutiveFailures, 'previous failures');
                clearStorageErrorBadge();
            }

            return result;
        } catch (error) {
            recordStorageError(operation, error);

            // Check if we should retry
            if (attempt < cfg.STORAGE_RETRY_ATTEMPTS) {
                const backoff = Math.min(
                    cfg.STORAGE_INITIAL_BACKOFF * Math.pow(2, attempt - 1),
                    cfg.STORAGE_MAX_BACKOFF
                );

                console.warn('Storage Manager: Retrying', operation, 'in', backoff,
                    'ms (attempt', attempt + 1, '/' + cfg.STORAGE_RETRY_ATTEMPTS + ')');

                await new Promise(resolve => setTimeout(resolve, backoff));
                return retryStorageOperation(operation, fn, attempt + 1);
            }

            // All retries exhausted
            console.error('Storage Manager:', operation,
                'failed after', cfg.STORAGE_RETRY_ATTEMPTS, 'attempts');
            throw error;
        }
    }

    /**
     * Load notifications from persistent storage with retry
     * @returns {Promise<Array>} - Array of notifications
     */
    async function loadNotifications() {
        try {
            const data = await retryStorageOperation('loadNotifications', async () => {
                return await chrome.storage.local.get(cfg.STORAGE_KEY);
            });

            const notifications = data[cfg.STORAGE_KEY] || [];
            console.log('Storage Manager: Loaded', notifications.length, 'notifications from storage');
            return notifications;
        } catch (e) {
            console.error('Storage Manager: Failed to load from storage after retries:', e.message);
            return [];
        }
    }

    /**
     * Save notifications to persistent storage with retry
     * @param {Array} notifications - Array of notifications to save
     * @returns {Promise<void>}
     */
    async function saveNotifications(notifications) {
        try {
            await retryStorageOperation('saveNotifications', async () => {
                await chrome.storage.local.set({ [cfg.STORAGE_KEY]: notifications });
            });

            console.log('Storage Manager: Saved', notifications.length, 'notifications to storage');
        } catch (e) {
            console.error('Storage Manager: Failed to save to storage after retries:', e.message);
        }
    }

    /**
     * Get error tracker status
     * @returns {object} - Error tracker state
     */
    function getErrorStatus() {
        return { ...errorTracker };
    }

    return {
        loadNotifications,
        saveNotifications,
        retryStorageOperation,
        getErrorStatus,
        hasStorageError: () => errorTracker.hasActiveBadge,
    };
}

/**
 * Validate API base URL
 * Security: Only allow HTTPS for remote domains, HTTP for localhost only
 *
 * @param {string} url - URL to validate
 * @returns {object} - { valid: boolean, error?: string, url?: string }
 */
function validateApiUrl(url) {
    // Type validation
    if (!url || typeof url !== 'string') {
        return {
            valid: false,
            error: 'URL must be a non-empty string',
        };
    }

    // Trim whitespace
    url = url.trim();

    if (!url) {
        return {
            valid: false,
            error: 'URL must be a non-empty string',
        };
    }

    // Parse URL
    let parsedUrl;
    try {
        parsedUrl = new URL(url);
    } catch (e) {
        return {
            valid: false,
            error: 'Invalid URL format',
        };
    }

    // Only allow HTTP and HTTPS protocols
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return {
            valid: false,
            error: 'Only HTTP and HTTPS protocols are allowed',
        };
    }

    // HTTP is only allowed for localhost
    if (parsedUrl.protocol === 'http:') {
        const hostname = parsedUrl.hostname.toLowerCase();
        const isLocalhost = hostname === 'localhost' ||
                           hostname === '127.0.0.1' ||
                           hostname === '[::1]' ||
                           hostname === '::1';

        if (!isLocalhost) {
            return {
                valid: false,
                error: 'HTTP is only allowed for localhost. Use HTTPS for remote domains.',
            };
        }
    }

    return {
        valid: true,
        url: url,
    };
}

// Export for both Node.js (require) and browser (service worker/content script)
// Use require check to definitively detect Node.js (avoid false positives from partial module shims)
if (typeof require === 'function' && typeof module !== 'undefined') {
    module.exports = { validateApiUrl, createStorageManager };
} else if (typeof self !== 'undefined') {
    // Service worker global
    self.StorageManager = { validateApiUrl, createStorageManager };
} else if (typeof window !== 'undefined') {
    // Content script / popup global
    window.StorageManager = { validateApiUrl, createStorageManager };
}
