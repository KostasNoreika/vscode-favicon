/**
 * Notification polling module
 * Handles periodic fetching of notifications from the API with circuit breaker protection
 */

// Browser-compatible import: use global if available, otherwise require for Node.js testing
// Service worker uses self.*, Node.js uses require(), browser uses window.*
const { getNotificationsVersion } = (typeof self !== 'undefined' && self.TabManager)
    ? self.TabManager
    : (typeof window !== 'undefined' && window.TabManager)
        ? window.TabManager
        : (typeof require === 'function' ? require('./tab-manager') : {});

const DEFAULT_CONFIG = {
    POLL_INTERVAL_MINUTES: 1,
    API_TIMEOUT: 10000,
};

/**
 * Create notification poller
 * @param {object} deps - Dependencies
 * @param {object} deps.circuitBreaker - Circuit breaker instance
 * @param {Function} deps.getApiBase - Function to get API base URL
 * @param {Function} deps.saveNotifications - Function to save notifications
 * @param {Function} deps.broadcastNotifications - Function to broadcast notifications
 * @param {object} config - Configuration options
 * @returns {object} - Poller instance
 */
function createNotificationPoller(deps, config = {}) {
    const {
        circuitBreaker,
        getApiBase,
        saveNotifications,
        broadcastNotifications,
    } = deps;

    const cfg = { ...DEFAULT_CONFIG, ...config };

    // Notification state
    let notifications = [];
    let notificationsVersion = '';

    /**
     * Get current notifications
     * @returns {Array} - Current notifications array
     */
    function getNotifications() {
        return notifications;
    }

    /**
     * Set notifications (used during initialization)
     * @param {Array} newNotifications - Notifications to set
     */
    function setNotifications(newNotifications) {
        notifications = newNotifications;
        notificationsVersion = getNotificationsVersion(newNotifications);
    }

    /**
     * Fetch notifications from server
     * @returns {Promise<void>}
     */
    async function fetchNotifications() {
        // Check circuit breaker before making request
        const permission = circuitBreaker.shouldAllowRequest();
        if (!permission.allowed) {
            console.log("Notification Poller: Request blocked -", permission.reason);
            return;
        }

        if (permission.probing) {
            console.log("Notification Poller: Probing API - testing recovery");
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), cfg.API_TIMEOUT);

            const response = await fetch(`${getApiBase()}/api/notifications/unread`, {
                method: 'GET',
                headers: {
                    'X-Requested-With': 'XMLHttpRequest',
                },
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (response.ok) {
                // Record success to close circuit
                await circuitBreaker.recordSuccess();
                const data = await response.json();
                const newNotifications = data.notifications || [];

                // Use stable ID-based comparison instead of JSON.stringify
                // This prevents false change detection from key order differences
                const newVersion = getNotificationsVersion(newNotifications);
                const changed = newVersion !== notificationsVersion;

                notifications = newNotifications;
                notificationsVersion = newVersion;

                if (changed) {
                    console.log('Notification Poller: Notifications updated:', notifications.length);
                    await saveNotifications(notifications);
                    await broadcastNotifications();
                }
            } else {
                // Record failure for non-OK responses
                console.log("Notification Poller: API returned error:", response.status);
                await circuitBreaker.recordFailure();
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('Notification Poller: Fetch timeout');
                await circuitBreaker.recordFailure();
            } else {
                console.log('Notification Poller: Fetch error:', error.message);
                await circuitBreaker.recordFailure();
            }
        }
    }

    /**
     * Setup polling alarm
     * @returns {Promise<void>}
     */
    async function setupPolling() {
        await chrome.alarms.create('pollNotifications', {
            periodInMinutes: cfg.POLL_INTERVAL_MINUTES,
        });
        console.log('Notification Poller: Polling alarm set for every',
            cfg.POLL_INTERVAL_MINUTES, 'minute(s)');
    }

    /**
     * Handle alarm event
     * @param {object} alarm - Chrome alarm object
     * @returns {Promise<void>}
     */
    async function handleAlarm(alarm) {
        if (alarm && alarm.name === 'pollNotifications') {
            console.log('Notification Poller: Polling triggered by alarm');
            await fetchNotifications();
        }
    }

    /**
     * Mark notification as read
     * @param {string} folder - Folder path
     * @returns {Promise<object>} - Result object
     */
    async function markRead(folder) {
        try {
            await fetch(`${getApiBase()}/claude-status/mark-read`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                },
                body: JSON.stringify({ folder }),
            });
            notifications = notifications.filter(n => n.folder !== folder);
            notificationsVersion = getNotificationsVersion(notifications);
            await saveNotifications(notifications);
            await broadcastNotifications();
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    /**
     * Mark all notifications as read
     * @returns {Promise<object>} - Result object
     */
    async function markAllRead() {
        try {
            await fetch(`${getApiBase()}/claude-status/all`, {
                method: 'DELETE',
                headers: {
                    'X-Requested-With': 'XMLHttpRequest',
                },
            });
            notifications = [];
            notificationsVersion = '';
            await saveNotifications(notifications);
            await broadcastNotifications();
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    return {
        fetchNotifications,
        setupPolling,
        handleAlarm,
        getNotifications,
        setNotifications,
        markRead,
        markAllRead,
    };
}

// Export for both Node.js (testing) and browser (service worker)
const NotificationPollerExports = { createNotificationPoller };

// Use require check to definitively detect Node.js (avoid false positives from partial module shims)
if (typeof require === 'function' && typeof module !== 'undefined') {
    module.exports = NotificationPollerExports;
} else if (typeof self !== 'undefined') {
    // Service worker global
    self.NotificationPoller = NotificationPollerExports;
} else if (typeof window !== 'undefined') {
    // Browser global
    window.NotificationPoller = NotificationPollerExports;
}
