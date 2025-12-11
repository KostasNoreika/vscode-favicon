const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const config = require('./config');
const logger = require('./logger');

// Constants
const NOTIFICATIONS_FILE = path.join(config.dataDir, 'notifications.json');
const MAX_NOTIFICATIONS = config.notificationMaxCount;
const TTL_MS = config.notificationTtlMs;
const CLEANUP_INTERVAL = config.notificationCleanupIntervalMs;
const SAVE_DEBOUNCE_MS = 1000; // Debounce saves by 1 second to reduce disk writes
const SSE_LISTENER_BUFFER = 20; // Extra buffer beyond global SSE limit for event processing
const SSE_LISTENER_FALLBACK = 120; // Fallback max listeners if config unavailable

// In-memory storage
let notifications = {};
let saveTimeout = null;
let savePromise = null; // Track pending save promise
let saveResolve = null; // Store promise resolve function
let dirty = false; // Track if there are unsaved changes

// PERF-006: Maintain separate index of unread completed notifications for O(1) lookup
const unreadCompletedIndex = new Map();

// PERF-003: Cache maxAge with dirty flag to avoid recalculation
let cachedMaxAge = 0;
let maxAgeTimestamp = 0;
let maxAgeDirty = true;

// Event emitter for SSE support
const eventEmitter = new EventEmitter();
// Support SSE connections with buffer: sseGlobalLimit (100) + SSE_LISTENER_BUFFER (20) = 120
// The buffer allows room for concurrent event processing without hitting max listener warnings
eventEmitter.setMaxListeners(
    config.sseGlobalLimit ? config.sseGlobalLimit + SSE_LISTENER_BUFFER : SSE_LISTENER_FALLBACK
);

/**
 * Mark maxAge cache as dirty
 */
function markMaxAgeDirty() {
    maxAgeDirty = true;
}

/**
 * Update unreadCompletedIndex when notification changes
 */
function updateUnreadIndex(folder) {
    const notification = notifications[folder];
    if (notification && notification.unread && notification.status === 'completed') {
        unreadCompletedIndex.set(folder, notification);
    } else {
        unreadCompletedIndex.delete(folder);
    }
}

/**
 * Ensure data directory exists with strict permissions
 * SECURITY FIX SEC-005: Set secure file permissions to prevent unauthorized access
 */
async function ensureDataDir() {
    try {
        await fs.promises.mkdir(config.dataDir, { recursive: true, mode: 0o700 });
        
        // SECURITY FIX SEC-005: Verify and set strict directory permissions (0700)
        // Only the service user can read/write/execute
        try {
            await fs.promises.chmod(config.dataDir, 0o700);
            logger.debug({ dataDir: config.dataDir, mode: '0700' }, 'Notifications data directory ready');
        } catch (chmodErr) {
            logger.warn({ err: chmodErr, dataDir: config.dataDir }, 'Failed to set directory permissions');
        }
    } catch (err) {
        if (err.code !== 'EEXIST') {
            logger.error({ err, dataDir: config.dataDir }, 'Failed to create data directory');
            throw err;
        }
    }
}

/**
 * Load notifications from disk
 */
async function load() {
    try {
        await ensureDataDir();
        const data = await fs.promises.readFile(NOTIFICATIONS_FILE, 'utf8');
        notifications = JSON.parse(data);

        // Rebuild unreadCompletedIndex from loaded data
        unreadCompletedIndex.clear();
        for (const [folder, notification] of Object.entries(notifications)) {
            if (notification.unread && notification.status === 'completed') {
                unreadCompletedIndex.set(folder, notification);
            }
        }

        // Remove expired notifications on load
        await cleanup();

        logger.info(
            {
                count: Object.keys(notifications).length,
                file: NOTIFICATIONS_FILE,
            },
            'Notifications loaded from file'
        );
    } catch (err) {
        if (err.code !== 'ENOENT') {
            logger.error({ err, file: NOTIFICATIONS_FILE }, 'Failed to load notifications');
        } else {
            logger.info(
                { file: NOTIFICATIONS_FILE },
                'No existing notifications file, starting fresh'
            );
        }
        notifications = {};
        unreadCompletedIndex.clear();
    }
    dirty = false; // Reset dirty flag after load
    markMaxAgeDirty();
}

/**
 * Internal save function (extracted for reuse)
 * SECURITY FIX SEC-005: Sets strict file permissions after writing
 */
async function doSave() {
    try {
        await ensureDataDir();
        await fs.promises.writeFile(
            NOTIFICATIONS_FILE,
            JSON.stringify(notifications, null, 2),
            'utf8'
        );
        
        // SECURITY FIX SEC-005: Set strict file permissions (0600)
        // Only the service user can read/write the notification file
        try {
            await fs.promises.chmod(NOTIFICATIONS_FILE, 0o600);
        } catch (chmodErr) {
            logger.warn({ err: chmodErr, file: NOTIFICATIONS_FILE }, 'Failed to set file permissions');
        }
        
        dirty = false; // Clear dirty flag after successful save
        logger.debug(
            {
                count: Object.keys(notifications).length,
                file: NOTIFICATIONS_FILE,
                mode: '0600'
            },
            'Notifications saved to file'
        );
    } catch (err) {
        logger.error({ err, file: NOTIFICATIONS_FILE }, 'Failed to save notifications');
        throw err;
    }
}

/**
 * Save notifications to disk (debounced, fire-and-forget pattern)
 *
 * PERFORMANCE: PERF-010 - Optimized promise handling to reduce overhead
 *
 * FIX QUA-011: This function uses debouncing for performance optimization.
 *
 * DESIGN DECISION: Fire-and-forget behavior
 * - The save() function returns a Promise but callers typically don't await it
 * - Debouncing means saves are delayed by SAVE_DEBOUNCE_MS (1 second)
 * - Multiple calls within the debounce window share the same Promise
 * - This prevents excessive disk I/O during rapid notification updates
 *
 * DATA DURABILITY:
 * - Acceptable: Notifications are non-critical UI state, not transactional data
 * - Recent changes may be lost if process terminates before debounced save completes
 * - For critical shutdown scenarios, use saveImmediate() which bypasses debouncing
 *
 * USAGE:
 * ```javascript
 * // Standard usage (fire-and-forget)
 * notificationStore.set(folder, data);  // Triggers debounced save
 *
 * // If you need to ensure save completes (rare)
 * await notificationStore.save();
 *
 * // Graceful shutdown (always awaited)
 * await notificationStore.saveImmediate();
 * ```
 *
 * @returns {Promise<void>} Promise that resolves when save completes
 */
function save() {
    dirty = true; // Mark as dirty when save is requested

    // Create promise if needed - all calls during debounce window share this promise
    if (!savePromise) {
        savePromise = new Promise((resolve) => {
            saveResolve = resolve;
        });
    }

    // Clear existing timeout and set new one
    if (saveTimeout) {
        clearTimeout(saveTimeout);
    }

    saveTimeout = setTimeout(async () => {
        await doSave();

        // Capture resolve function before clearing state
        const resolve = saveResolve;

        // Clear state
        savePromise = null;
        saveResolve = null;
        saveTimeout = null;

        // Resolve the promise
        resolve();
    }, SAVE_DEBOUNCE_MS);

    return savePromise;
}

/**
 * Save immediately (for graceful shutdown)
 * Clears any pending debounced saves and saves immediately
 */
async function saveImmediate() {
    if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
    }

    // If there's a pending promise, we need to resolve it after save
    const pendingResolve = saveResolve;
    savePromise = null;
    saveResolve = null;

    // Only save if there are dirty changes
    if (dirty) {
        await doSave();
    }

    // Resolve any pending promise
    if (pendingResolve) {
        pendingResolve();
    }
}

/**
 * PERF-001: Cleanup expired and excess notifications with optimized sorting
 * - Removes notifications older than TTL_MS (24 hours)
 * - Enforces MAX_NOTIFICATIONS limit (keeps most recent)
 * @returns {Promise<number>} Number of notifications removed
 */
async function cleanup() {
    const now = Date.now();
    const before = Object.keys(notifications).length;

    // Remove expired notifications (older than TTL)
    for (const [folder, data] of Object.entries(notifications)) {
        if (now - data.timestamp > TTL_MS) {
            delete notifications[folder];
            unreadCompletedIndex.delete(folder);
        }
    }

    // Enforce size limit - only sort excess items, not entire array
    const remaining = Object.entries(notifications);
    if (remaining.length > MAX_NOTIFICATIONS) {
        const excess = remaining.length - MAX_NOTIFICATIONS;
        // Only sort to find the oldest 'excess' items (O(n + k log k) where k = excess)
        const oldest = remaining
            .slice()
            .sort((a, b) => a[1].timestamp - b[1].timestamp)
            .slice(0, excess);

        // Remove oldest notifications
        for (const [folder] of oldest) {
            delete notifications[folder];
            unreadCompletedIndex.delete(folder);
        }
    }

    const removed = before - Object.keys(notifications).length;

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
        markMaxAgeDirty();
        await save();
    }

    return removed;
}

/**
 * Get a notification by folder path
 * @param {string} folder - Validated folder path
 * @returns {Object|null} Notification object or null
 */
function get(folder) {
    return notifications[folder] || null;
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
            unreadCompletedIndex.delete(oldest);
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
 */
function set(folder, data) {
    notifications[folder] = {
        message: data.message || 'Task completed',
        timestamp: data.timestamp || Date.now(),
        unread: data.unread !== undefined ? data.unread : true,
        status: data.status || 'completed', // 'working' or 'completed'
    };
    updateUnreadIndex(folder);
    markMaxAgeDirty();

    // FIX QUA-026: Enforce size limit immediately
    enforceSizeLimit();

    save();

    // Emit event for SSE clients
    eventEmitter.emit('notification', {
        folder,
        type: 'created',
        notification: notifications[folder],
    });
}

/**
 * Set working status (Claude started)
 * @param {string} folder - Validated folder path
 * @param {string} message - Optional message
 */
function setWorking(folder, message = 'Working...') {
    notifications[folder] = {
        message,
        timestamp: Date.now(),
        unread: true,
        status: 'working',
    };
    updateUnreadIndex(folder);
    markMaxAgeDirty();

    // FIX QUA-026: Enforce size limit immediately
    enforceSizeLimit();

    save();

    eventEmitter.emit('notification', {
        folder,
        type: 'working',
        notification: notifications[folder],
    });
}

/**
 * Set completed status (Claude finished)
 * @param {string} folder - Validated folder path
 * @param {string} message - Optional message
 * @param {Object} metadata - Optional metadata (files_changed, tools_used, etc.)
 */
function setCompleted(folder, message = 'Task completed', metadata = null) {
    notifications[folder] = {
        message,
        timestamp: Date.now(),
        unread: true,
        status: 'completed',
        ...(metadata && { metadata }),
    };
    updateUnreadIndex(folder);
    markMaxAgeDirty();

    // FIX QUA-026: Enforce size limit immediately
    enforceSizeLimit();

    save();

    eventEmitter.emit('notification', {
        folder,
        type: 'completed',
        notification: notifications[folder],
    });
}

/**
 * Mark a notification as read
 * @param {string} folder - Validated folder path
 * @returns {boolean} True if notification exists and was marked read
 */
function markRead(folder) {
    if (notifications[folder]) {
        notifications[folder].unread = false;
        updateUnreadIndex(folder);
        save();

        // Emit event for SSE clients
        eventEmitter.emit('notification', {
            folder,
            type: 'read',
            notification: notifications[folder],
        });

        return true;
    }
    return false;
}

/**
 * Remove a notification
 * @param {string} folder - Validated folder path
 * @returns {boolean} True if notification existed and was removed
 */
function remove(folder) {
    if (notifications[folder]) {
        delete notifications[folder];
        unreadCompletedIndex.delete(folder);
        markMaxAgeDirty();
        save();

        // Emit event for SSE clients
        eventEmitter.emit('notification', {
            folder,
            type: 'removed',
        });

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
        unreadCompletedIndex.clear();
        markMaxAgeDirty();
        save();

        // Emit event for SSE clients
        eventEmitter.emit('notification', {
            type: 'cleared_all',
            count,
        });

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
 * PERF-003: Get notification statistics with cached maxAge
 * @returns {Object} Stats object with total, unread, maxAge, listenerCount
 */
function getStats() {
    const entries = Object.values(notifications);

    // Recalculate maxAge only if dirty
    if (maxAgeDirty && entries.length > 0) {
        maxAgeTimestamp = Math.min(...entries.map((n) => n.timestamp));
        cachedMaxAge = Date.now() - maxAgeTimestamp;
        maxAgeDirty = false;
    } else if (entries.length === 0) {
        cachedMaxAge = 0;
        maxAgeDirty = false;
    }

    return {
        total: entries.length,
        unread: entries.filter((n) => n.unread).length,
        maxAge: cachedMaxAge,
        maxCount: MAX_NOTIFICATIONS,
        ttl: TTL_MS,
        listenerCount: eventEmitter.listenerCount('notification'),
    };
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
 * @param {Function} callback - Event callback
 * @returns {Function} Unsubscribe function
 */
function subscribe(callback) {
    eventEmitter.on('notification', callback);
    return () => eventEmitter.off('notification', callback);
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
