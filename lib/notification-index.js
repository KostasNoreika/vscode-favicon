const config = require('./config');

// Constants
const TTL_MS = config.notificationTtlMs;
const MAX_NOTIFICATIONS = config.notificationMaxCount;

// PERF-006: Maintain separate index of unread completed notifications for O(1) lookup
const unreadCompletedIndex = new Map();

// PERF-003: Cache minimum timestamp for O(1) maxAge computation
let cachedMinTimestamp = Infinity;

/**
 * Update unreadCompletedIndex when notification changes
 * @param {string} folder - Folder path
 * @param {Object} notifications - All notifications object
 */
function updateUnreadIndex(folder, notifications) {
    const notification = notifications[folder];
    if (notification && notification.unread && notification.status === 'completed') {
        unreadCompletedIndex.set(folder, notification);
    } else {
        unreadCompletedIndex.delete(folder);
    }
}

/**
 * Rebuild unreadCompletedIndex from loaded data
 * PERF-003: Also recompute minTimestamp cache
 * @param {Object} notifications - All notifications object
 */
function rebuildIndex(notifications) {
    unreadCompletedIndex.clear();

    // PERF-003: Recompute minTimestamp when rebuilding index
    const entries = Object.values(notifications);
    if (entries.length === 0) {
        cachedMinTimestamp = Infinity;
    } else {
        cachedMinTimestamp = Math.min(...entries.map((n) => n.timestamp));
    }

    for (const [folder, notification] of Object.entries(notifications)) {
        if (notification.unread && notification.status === 'completed') {
            unreadCompletedIndex.set(folder, notification);
        }
    }
}

/**
 * Clear the unread index
 * PERF-003: Also reset minTimestamp cache
 */
function clearIndex() {
    unreadCompletedIndex.clear();
    // PERF-003: Reset minTimestamp when clearing
    cachedMinTimestamp = Infinity;
}

/**
 * Remove a folder from the unread index
 * @param {string} folder - Folder path
 */
function removeFromIndex(folder) {
    unreadCompletedIndex.delete(folder);
}

/**
 * Update minTimestamp cache when notifications change
 * PERF-003: Incrementally update minTimestamp instead of scanning all entries
 * @param {Object} notifications - All notifications object
 * @param {number} [newTimestamp] - Optional timestamp being added (for optimization)
 */
function updateMinTimestamp(notifications, newTimestamp) {
    const entries = Object.values(notifications);

    if (entries.length === 0) {
        cachedMinTimestamp = Infinity;
        return;
    }

    // If we're adding a new notification and it's older than current min, update immediately
    if (newTimestamp !== undefined && newTimestamp < cachedMinTimestamp) {
        cachedMinTimestamp = newTimestamp;
        return;
    }

    // Otherwise, recompute from all entries
    // This happens on removals or when the optimization above doesn't apply
    cachedMinTimestamp = Math.min(...entries.map((n) => n.timestamp));
}

/**
 * PERF-006: Get unread completed notifications using optimized index
 * @param {string} [folder] - Optional folder filter
 * @returns {Array} Array of notification objects with folder, message, timestamp, status
 */
function getUnread(folder) {
    const now = Date.now();
    const results = [];

    // Use unreadCompletedIndex for O(1) lookup instead of scanning all notifications
    if (folder) {
        // Single folder lookup
        const notification = unreadCompletedIndex.get(folder);
        if (notification && now - notification.timestamp < TTL_MS) {
            results.push({
                folder,
                message: notification.message,
                timestamp: notification.timestamp,
                status: notification.status,
            });
        }
    } else {
        // Get all unread completed notifications
        for (const [notificationFolder, notification] of unreadCompletedIndex.entries()) {
            if (now - notification.timestamp < TTL_MS) {
                results.push({
                    folder: notificationFolder,
                    message: notification.message,
                    timestamp: notification.timestamp,
                    status: notification.status,
                });
            }
        }
    }

    // Sort by timestamp (newest first)
    results.sort((a, b) => b.timestamp - a.timestamp);

    return results;
}

/**
 * Get notification statistics
 * PERF-003: Use cached minTimestamp for O(1) maxAge computation
 * @param {Object} notifications - All notifications object
 * @param {number} listenerCount - Number of SSE listeners
 * @returns {Object} Stats object with total, unread, maxAge, maxCount, ttl, listenerCount
 */
function getStats(notifications, listenerCount = 0) {
    const entries = Object.values(notifications);

    // PERF-003: Use cached minTimestamp for O(1) maxAge computation
    let maxAge = 0;
    if (entries.length > 0 && cachedMinTimestamp !== Infinity) {
        maxAge = Date.now() - cachedMinTimestamp;
    }

    return {
        total: entries.length,
        unread: entries.filter((n) => n.unread).length,
        maxAge,
        maxCount: MAX_NOTIFICATIONS,
        ttl: TTL_MS,
        listenerCount,
    };
}

module.exports = {
    updateUnreadIndex,
    rebuildIndex,
    clearIndex,
    removeFromIndex,
    updateMinTimestamp,
    getUnread,
    getStats,
};
