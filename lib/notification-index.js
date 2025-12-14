const config = require('./config');

// Constants
const TTL_MS = config.notificationTtlMs;
const MAX_NOTIFICATIONS = config.notificationMaxCount;

// PERF-006: Maintain separate index of unread completed notifications for O(1) lookup
const unreadCompletedIndex = new Map();

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
 * @param {Object} notifications - All notifications object
 */
function rebuildIndex(notifications) {
    unreadCompletedIndex.clear();
    for (const [folder, notification] of Object.entries(notifications)) {
        if (notification.unread && notification.status === 'completed') {
            unreadCompletedIndex.set(folder, notification);
        }
    }
}

/**
 * Clear the unread index
 */
function clearIndex() {
    unreadCompletedIndex.clear();
}

/**
 * Remove a folder from the unread index
 * @param {string} folder - Folder path
 */
function removeFromIndex(folder) {
    unreadCompletedIndex.delete(folder);
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
 * REF-006: Compute maxAge directly without caching - simpler and more maintainable
 * @param {Object} notifications - All notifications object
 * @param {number} listenerCount - Number of SSE listeners
 * @returns {Object} Stats object with total, unread, maxAge, maxCount, ttl, listenerCount
 */
function getStats(notifications, listenerCount = 0) {
    const entries = Object.values(notifications);

    // REF-006: Compute maxAge directly without caching - simpler and more maintainable
    let maxAge = 0;
    if (entries.length > 0) {
        const oldestTimestamp = Math.min(...entries.map((n) => n.timestamp));
        maxAge = Date.now() - oldestTimestamp;
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
    getUnread,
    getStats,
};
