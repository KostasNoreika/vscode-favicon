const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const config = require('./config');
const logger = require('./logger');

// Constants
const NOTIFICATIONS_FILE = path.join(config.dataDir, 'notifications.json');
const MAX_NOTIFICATIONS = 1000;
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour

// In-memory storage
let notifications = {};
let saveTimeout = null;
let dirty = false; // Track if there are unsaved changes

// Event emitter for SSE support
const eventEmitter = new EventEmitter();
eventEmitter.setMaxListeners(100); // Support multiple SSE connections

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
 */
async function save() {
    dirty = true; // Mark as dirty when save is requested

    // Clear existing timeout
    if (saveTimeout) {
        clearTimeout(saveTimeout);
    }

    // Debounce: save after 1 second of inactivity
    saveTimeout = setTimeout(async () => {
        await doSave();
    }, 1000);
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
    await doSave();
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
 * @param {Object} data - Notification data (message, timestamp, unread)
 */
function set(folder, data) {
    notifications[folder] = {
        message: data.message || 'Task completed',
        timestamp: data.timestamp || Date.now(),
        unread: data.unread !== undefined ? data.unread : true,
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
 * Get notification statistics
 * @returns {Object} Stats object with total, unread, maxAge
 */
function getStats() {
    const entries = Object.values(notifications);
    return {
        total: entries.length,
        unread: entries.filter((n) => n.unread).length,
        maxAge: entries.length > 0 ? Math.max(...entries.map((n) => Date.now() - n.timestamp)) : 0,
        maxCount: MAX_NOTIFICATIONS,
        ttl: TTL_MS,
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

// Backup save handler for unexpected exits (last resort)
process.on('exit', () => {
    // Synchronous save on exit (last resort)
    if (dirty) {
        try {
            fs.writeFileSync(NOTIFICATIONS_FILE, JSON.stringify(notifications, null, 2));
        } catch (error) {
            // Can't log in exit handler reliably
            console.error('Failed to save notifications on exit:', error.message);
        }
    }
});

module.exports = {
    load,
    save,
    saveImmediate,
    cleanup,
    get,
    set,
    markRead,
    remove,
    getAll,
    getStats,
    startCleanupInterval,
    subscribe,
};
