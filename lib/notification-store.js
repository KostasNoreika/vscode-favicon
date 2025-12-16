const config = require('./config');
const logger = require('./logger');
const storage = require('./notification-storage');
const index = require('./notification-index');
const events = require('./notification-events');

// Constants
const MAX_NOTIFICATIONS = config.notificationMaxCount;
const TTL_MS = config.notificationTtlMs;
const CLEANUP_INTERVAL = config.notificationCleanupIntervalMs;

// In-memory storage
let notifications = {};

/**
 * Generate notification key from folder and optional origin
 * @param {string} folder - Folder path
 * @param {string} [origin] - VS Code server origin
 * @returns {string} Notification key
 */
function getNotificationKey(folder, origin) {
    return origin ? `${origin}:${folder}` : folder;
}

/**
 * Load notifications from disk
 */
async function load() {
    notifications = await storage.load();

    // Rebuild unreadCompletedIndex from loaded data
    index.rebuildIndex(notifications);

    // Remove expired notifications on load
    await cleanup();
}

/**
 * Save notifications to disk (debounced)
 * Delegates to storage module
 * @returns {Promise<void>} Promise that resolves when save completes
 */
function save() {
    return storage.save(notifications);
}

/**
 * Save immediately (for graceful shutdown)
 * Delegates to storage module
 */
async function saveImmediate() {
    return storage.saveImmediate(notifications);
}

/**
 * PERF-001: Cleanup expired and excess notifications with optimized sorting
 * - Removes notifications older than TTL_MS (24 hours)
 * - Enforces MAX_NOTIFICATIONS limit (keeps most recent)
 * @returns {Promise<number>} Number of notifications removed
 */
async function cleanup() {
    const now = Date.now();
    const startTime = Date.now();
    const before = Object.keys(notifications).length;

    // Remove expired notifications (older than TTL)
    for (const [folder, data] of Object.entries(notifications)) {
        if (now - data.timestamp > TTL_MS) {
            delete notifications[folder];
            index.removeFromIndex(folder);
        }
    }

    // Enforce size limit - optimize based on excess size
    const remaining = Object.entries(notifications);
    if (remaining.length > MAX_NOTIFICATIONS) {
        const excess = remaining.length - MAX_NOTIFICATIONS;
        const sortThreshold = Math.max(10, Math.floor(MAX_NOTIFICATIONS * 0.1)); // 10% or minimum 10

        let oldest;

        if (excess <= sortThreshold) {
            // Small excess: Use O(n*k) selection where k is small
            // This avoids full array sort and minimizes copies
            oldest = [];
            const selected = new Set();

            for (let i = 0; i < excess; i++) {
                let minEntry = null;
                let minTimestamp = Infinity;

                for (const entry of remaining) {
                    const folder = entry[0];
                    if (selected.has(folder)) continue;

                    const timestamp = entry[1].timestamp;
                    if (timestamp < minTimestamp) {
                        minTimestamp = timestamp;
                        minEntry = entry;
                    }
                }

                if (minEntry) {
                    oldest.push(minEntry);
                    selected.add(minEntry[0]);
                }
            }
        } else {
            // Large excess: Use sort approach
            // Sort is more efficient when we need to remove many items (>= 10%)
            oldest = remaining
                .slice()
                .sort((a, b) => a[1].timestamp - b[1].timestamp)
                .slice(0, excess);
        }

        // Remove oldest notifications
        for (const [folder] of oldest) {
            delete notifications[folder];
            index.removeFromIndex(folder);
        }
    }

    const removed = before - Object.keys(notifications).length;
    const duration = Date.now() - startTime;

    // Debug logging for every cleanup run (even when removed=0)
    logger.debug(
        {
            totalBefore: before,
            removed,
            remaining: Object.keys(notifications).length,
            durationMs: duration,
            maxAge: TTL_MS,
            maxCount: MAX_NOTIFICATIONS,
        },
        'Notification cleanup completed'
    );

    if (removed > 0) {
        logger.info(
            {
                removed,
                remaining: Object.keys(notifications).length,
                maxAge: TTL_MS,
                maxCount: MAX_NOTIFICATIONS,
            },
            'Cleaned up expired/excess notifications'
        );
        await save();
    }

    return removed;
}

/**
 * Get a notification by folder path
 * @param {string} folder - Validated folder path
 * @param {string} [origin] - VS Code server origin
 * @returns {Object|null} Notification object or null
 */
function get(folder, origin = null) {
    const key = getNotificationKey(folder, origin);
    return notifications[key] || null;
}

/**
 * FIX QUA-026: Enforce size limit immediately to prevent unbounded growth
 * Removes oldest notification if we exceed MAX_NOTIFICATIONS
 */
function enforceSizeLimit() {
    const remaining = Object.entries(notifications);
    if (remaining.length > MAX_NOTIFICATIONS) {
        // Find oldest notification
        let oldest = null;
        let oldestTimestamp = Date.now();

        for (const [folder, data] of remaining) {
            if (data.timestamp < oldestTimestamp) {
                oldest = folder;
                oldestTimestamp = data.timestamp;
            }
        }

        // Remove oldest notification
        if (oldest) {
            delete notifications[oldest];
            index.removeFromIndex(oldest);
            logger.debug(
                {
                    removed: oldest,
                    count: remaining.length,
                    maxCount: MAX_NOTIFICATIONS,
                },
                'Removed oldest notification to enforce size limit'
            );
        }
    }
}

/**
 * Set/create a notification
 * @param {string} folder - Validated folder path
 * @param {Object} data - Notification data (message, timestamp, unread, status)
 * @param {string} data.status - 'working' or 'completed'
 * @param {string} [origin] - VS Code server origin
 */
function set(folder, data, origin = null) {
    const key = getNotificationKey(folder, origin);
    notifications[key] = {
        folder,
        message: data.message || 'Task completed',
        timestamp: data.timestamp || Date.now(),
        unread: data.unread !== undefined ? data.unread : true,
        status: data.status || 'completed', // 'working' or 'completed'
    };
    index.updateUnreadIndex(key, notifications);

    // FIX QUA-026: Enforce size limit immediately
    enforceSizeLimit();

    save();

    // Emit event for SSE clients
    events.emit(key, 'created', notifications[key]);
}

/**
 * Set working status (Claude started)
 * @param {string} folder - Validated folder path
 * @param {string} message - Optional message
 * @param {string} [origin] - VS Code server origin
 */
function setWorking(folder, message = 'Working...', origin = null) {
    const key = getNotificationKey(folder, origin);
    notifications[key] = {
        folder,
        message,
        timestamp: Date.now(),
        unread: true,
        status: 'working',
    };
    index.updateUnreadIndex(key, notifications);

    // FIX QUA-026: Enforce size limit immediately
    enforceSizeLimit();

    save();

    events.emit(key, 'working', notifications[key]);
}

/**
 * Set completed status (Claude finished)
 * @param {string} folder - Validated folder path
 * @param {string} message - Optional message
 * @param {Object} metadata - Optional metadata (files_changed, tools_used, etc.)
 * @param {string} [origin] - VS Code server origin
 */
function setCompleted(folder, message = 'Task completed', metadata = null, origin = null) {
    const key = getNotificationKey(folder, origin);
    notifications[key] = {
        folder,
        message,
        timestamp: Date.now(),
        unread: true,
        status: 'completed',
        ...(metadata && { metadata }),
    };
    index.updateUnreadIndex(key, notifications);

    // FIX QUA-026: Enforce size limit immediately
    enforceSizeLimit();

    save();

    events.emit(key, 'completed', notifications[key]);
}

/**
 * Mark a notification as read
 * @param {string} folder - Validated folder path
 * @param {string} [origin] - VS Code server origin
 * @returns {boolean} True if notification exists and was marked read
 */
function markRead(folder, origin = null) {
    const key = getNotificationKey(folder, origin);
    if (notifications[key]) {
        notifications[key].unread = false;
        index.updateUnreadIndex(key, notifications);
        save();

        // Emit event for SSE clients
        events.emit(key, 'read', notifications[key]);

        return true;
    }
    return false;
}

/**
 * Remove a notification
 * @param {string} folder - Validated folder path
 * @param {string} [origin] - VS Code server origin
 * @returns {boolean} True if notification existed and was removed
 */
function remove(folder, origin = null) {
    const key = getNotificationKey(folder, origin);
    if (notifications[key]) {
        delete notifications[key];
        index.removeFromIndex(key);
        save();

        // Emit event for SSE clients
        events.emit(key, 'removed');

        return true;
    }
    return false;
}

/**
 * Remove ALL notifications
 * @returns {number} Number of notifications removed
 */
function removeAll() {
    const count = Object.keys(notifications).length;

    if (count > 0) {
        // Clear all data structures
        for (const folder of Object.keys(notifications)) {
            delete notifications[folder];
        }
        index.clearIndex();
        save();

        // Emit event for SSE clients
        events.emitClearedAll(count);

        logger.info({ count }, 'All notifications cleared');
    }

    return count;
}

/**
 * Get all notifications (internal use)
 * @returns {Object} All notifications
 */
function getAll() {
    return notifications;
}

/**
 * PERF-006: Get unread completed notifications using optimized index
 * Delegates to index module
 * @param {string} [folder] - Optional folder filter
 * @returns {Array} Array of notification objects with folder, message, timestamp, status
 */
function getUnread(folder) {
    return index.getUnread(folder);
}

/**
 * Get notification statistics
 * REF-006: Computes maxAge directly (no caching) for simplicity
 * Delegates to index and events modules
 * @returns {Object} Stats object with total, unread, maxAge, maxCount, ttl, listenerCount
 */
function getStats() {
    return index.getStats(notifications, events.getListenerCount());
}

/**
 * Start periodic cleanup interval
 * @returns {NodeJS.Timeout} Interval handle
 */
function startCleanupInterval() {
    const intervalHandle = setInterval(async () => {
        logger.debug('Running scheduled notification cleanup');
        await cleanup();
    }, CLEANUP_INTERVAL);

    logger.info(
        {
            intervalMinutes: CLEANUP_INTERVAL / 1000 / 60,
            ttlHours: TTL_MS / 1000 / 60 / 60,
            maxCount: MAX_NOTIFICATIONS,
        },
        'Notification cleanup interval started'
    );

    return intervalHandle;
}

/**
 * Subscribe to notification events (for SSE)
 * Delegates to events module
 * @param {Function} callback - Event callback
 * @returns {Function} Unsubscribe function
 */
function subscribe(callback) {
    return events.subscribe(callback);
}

module.exports = {
    load,
    save,
    saveImmediate,
    cleanup,
    get,
    set,
    setWorking,
    setCompleted,
    markRead,
    remove,
    removeAll,
    getAll,
    getUnread,
    getStats,
    startCleanupInterval,
    subscribe,
};
