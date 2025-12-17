const fs = require('fs');
const path = require('path');
const config = require('./config');
const logger = require('./logger');

// Constants
const NOTIFICATIONS_FILE = path.join(config.dataDir, 'notifications.json');
const SAVE_DEBOUNCE_MS = 1000; // Debounce saves by 1 second to reduce disk writes

// Save state
let saveTimeout = null;
let savePromise = null; // Track pending save promise
let saveResolve = null; // Store promise resolve function
let dirty = false; // Track if there are unsaved changes

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
 * @returns {Promise<Object>} Loaded notifications object
 */
async function load() {
    try {
        await ensureDataDir();
        const data = await fs.promises.readFile(NOTIFICATIONS_FILE, 'utf8');
        const notifications = JSON.parse(data);

        logger.info(
            {
                count: Object.keys(notifications).length,
                file: NOTIFICATIONS_FILE,
            },
            'Notifications loaded from file'
        );

        dirty = false; // Reset dirty flag after load
        return notifications;
    } catch (err) {
        if (err.code !== 'ENOENT') {
            logger.error({ err, file: NOTIFICATIONS_FILE }, 'Failed to load notifications');
        } else {
            logger.info(
                { file: NOTIFICATIONS_FILE },
                'No existing notifications file, starting fresh'
            );
        }
        dirty = false;
        return {};
    }
}

/**
 * Internal save function (extracted for reuse)
 * SECURITY FIX SEC-005: Sets strict file permissions after writing
 * OPTIMIZATION QUA-029: Use compact JSON in production, pretty JSON in development
 * @param {Object} notifications - Notifications object to save
 */
async function doSave(notifications) {
    try {
        await ensureDataDir();

        // Use compact JSON in production for better performance and smaller file size
        // Use pretty JSON in development for readability
        const jsonData = process.env.NODE_ENV === 'production'
            ? JSON.stringify(notifications)
            : JSON.stringify(notifications, null, 2);

        await fs.promises.writeFile(
            NOTIFICATIONS_FILE,
            jsonData,
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
 * @param {Object} notifications - Notifications object to save
 * @returns {Promise<void>} Promise that resolves when save completes
 */
function save(notifications) {
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
        await doSave(notifications);

        // Capture resolve function before clearing state
        const resolve = saveResolve;

        // Clear state
        savePromise = null;
        saveResolve = null;
        saveTimeout = null;

        // Resolve the promise (only if not already resolved by saveImmediate)
        // FIX: Handle edge case where saveImmediate() cleared saveResolve before timeout fired
        if (resolve) {
            resolve();
        }
    }, SAVE_DEBOUNCE_MS);

    return savePromise;
}

/**
 * Save immediately (for graceful shutdown)
 * Clears any pending debounced saves and saves immediately
 * @param {Object} notifications - Notifications object to save
 */
async function saveImmediate(notifications) {
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
        await doSave(notifications);
    }

    // Resolve any pending promise
    if (pendingResolve) {
        pendingResolve();
    }
}

/**
 * Check if there are unsaved changes
 * @returns {boolean} True if there are unsaved changes
 */
function isDirty() {
    return dirty;
}

module.exports = {
    load,
    save,
    saveImmediate,
    isDirty,
};
