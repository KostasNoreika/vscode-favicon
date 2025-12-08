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
const SAVE_DEBOUNCE_MS = 1000; // Debounce saves by 1 second

// In-memory storage
let notifications = {};
let saveTimeout = null;
let savePromise = null; // Track pending save promise
let saveResolve = null; // Store promise resolve function
let dirty = false; // Track if there are unsaved changes

// Event emitter for SSE support
const eventEmitter = new EventEmitter();
// Support SSE connections with buffer: sseGlobalLimit (100) + 20 = 120
// Falls back to 120 if config.sseGlobalLimit is unavailable
eventEmitter.setMaxListeners(config.sseGlobalLimit ? config.sseGlobalLimit + 20 : 120);

/**
 * Ensure data directory exists
 */
async function ensureDataDir() {
    try {
        await fs.promises.mkdir(config.dataDir, { recursive: true });
        logger.debug({ dataDir: config.dataDir }, 'Notifications data directory ready');
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
    }
    dirty = false; // Reset dirty flag after load
}

/**
 * Internal save function (extracted for reuse)
 */
async function doSave() {
    try {
        await ensureDataDir();
        await fs.promises.writeFile(
            NOTIFICATIONS_FILE,
            JSON.stringify(notifications, null, 2),
            'utf8'
        );
        dirty = false; // Clear dirty flag after successful save
        logger.debug(
            {
                count: Object.keys(notifications).length,
                file: NOTIFICATIONS_FILE,
            },
            'Notifications saved to file'
        );
    } catch (err) {
        logger.error({ err, file: NOTIFICATIONS_FILE }, 'Failed to save notifications');
        throw err;
    }
}

/**
 * Save notifications to disk (debounced)
 * Returns a Promise that resolves when the debounced save completes
 * @returns {Promise<void>} Promise that resolves when save completes
 */
function save() {
    dirty = true; // Mark as dirty when save is requested

    // Clear existing timeout
    if (saveTimeout) {
        clearTimeout(saveTimeout);
    }

    // Create promise if needed - all calls during debounce window share this promise
    if (!savePromise) {
        savePromise = new Promise(resolve => {
            saveResolve = resolve;
        });
    }

    // Set new timeout (always, to implement debouncing)
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
 * Cleanup expired and excess notifications
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
        }
    }

    // Enforce size limit (keep most recent)
    const remaining = Object.entries(notifications);
    if (remaining.length > MAX_NOTIFICATIONS) {
        // Sort by timestamp (oldest first) and remove excess
        remaining
            .sort((a, b) => a[1].timestamp - b[1].timestamp)
            .slice(0, remaining.length - MAX_NOTIFICATIONS)
            .forEach(([folder]) => {
                delete notifications[folder];
            });
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
 */
function setCompleted(folder, message = 'Task completed') {
    notifications[folder] = {
        message,
        timestamp: Date.now(),
        unread: true,
        status: 'completed',
    };
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
 * Get all notifications (internal use)
 * @returns {Object} All notifications
 */
function getAll() {
    return notifications;
}

/**
 * Get unread completed notifications with efficient filtering
 * @param {string} [folder] - Optional folder filter
 * @returns {Array} Array of notification objects with folder, message, timestamp, status
 */
function getUnread(folder) {
    const now = Date.now();
    const results = [];

    // Single-pass iteration with inline filtering
    for (const [notificationFolder, notification] of Object.entries(notifications)) {
        // Filter criteria (all conditions must be true)
        const matchesFolder = !folder || notificationFolder === folder;
        const isUnread = notification.unread === true;
        const isCompleted = notification.status === 'completed';
        const notExpired = (now - notification.timestamp) < TTL_MS;

        if (matchesFolder && isUnread && isCompleted && notExpired) {
            results.push({
                folder: notificationFolder,
                message: notification.message,
                timestamp: notification.timestamp,
                status: notification.status,
            });
        }
    }

    // Sort by timestamp (newest first)
    results.sort((a, b) => b.timestamp - a.timestamp);

    return results;
}

/**
 * Get notification statistics
 * @returns {Object} Stats object with total, unread, maxAge, listenerCount
 */
function getStats() {
    const entries = Object.values(notifications);

    // Calculate maxAge iteratively to avoid stack overflow
    let maxAge = 0;
    for (const n of entries) {
        const age = Date.now() - n.timestamp;
        if (age > maxAge) maxAge = age;
    }

    return {
        total: entries.length,
        unread: entries.filter((n) => n.unread).length,
        maxAge,
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
    getAll,
    getUnread,
    getStats,
    startCleanupInterval,
    subscribe,
};
