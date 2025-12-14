const { EventEmitter } = require('events');
const config = require('./config');

// Constants
const SSE_LISTENER_BUFFER = 20; // Extra buffer beyond global SSE limit for event processing
const SSE_LISTENER_FALLBACK = 120; // Fallback max listeners if config unavailable

// Event emitter for SSE support
const eventEmitter = new EventEmitter();
// Support SSE connections with buffer: sseGlobalLimit (100) + SSE_LISTENER_BUFFER (20) = 120
// The buffer allows room for concurrent event processing without hitting max listener warnings
eventEmitter.setMaxListeners(
    config.sseGlobalLimit ? config.sseGlobalLimit + SSE_LISTENER_BUFFER : SSE_LISTENER_FALLBACK
);

/**
 * PERF-006: Pre-serialize SSE payload to avoid repeated JSON.stringify per client
 * Builds the SSE payload structure and returns both the object and pre-serialized string
 *
 * @param {string} eventType - Event type (created, completed, working, read, removed)
 * @param {Object} notification - Notification object (optional for 'removed' type)
 * @returns {Object} { payload, serialized } - Payload object and pre-serialized JSON string
 */
function buildSSEPayload(eventType, notification) {
    const payload = {
        hasNotification: eventType === 'created' || eventType === 'completed' || eventType === 'working',
        type: eventType,
    };

    if (notification) {
        payload.timestamp = notification.timestamp;
        payload.message = notification.message;
        if (notification.metadata) {
            payload.metadata = notification.metadata;
        }
    }

    return {
        payload,
        serialized: JSON.stringify(payload),
    };
}

/**
 * Emit a notification event
 * @param {string} folder - Folder path
 * @param {string} type - Event type (created, completed, working, read, removed)
 * @param {Object} [notification] - Notification object (optional for 'removed' type)
 */
function emit(folder, type, notification) {
    // PERF-006: Pre-serialize SSE payload to avoid repeated JSON.stringify per client
    const { serialized } = buildSSEPayload(type, notification);

    // Emit event for SSE clients with pre-serialized payload
    const eventData = {
        folder,
        type,
        serializedPayload: serialized,
    };

    // Only add notification if it exists (removed events don't have notification)
    if (notification) {
        eventData.notification = notification;
    }

    eventEmitter.emit('notification', eventData);
}

/**
 * Emit a cleared_all event
 * @param {number} count - Number of notifications cleared
 */
function emitClearedAll(count) {
    // Note: 'cleared_all' event doesn't have a folder-specific payload
    eventEmitter.emit('notification', {
        type: 'cleared_all',
        count,
    });
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

/**
 * Get listener count for notification events
 * @returns {number} Number of active listeners
 */
function getListenerCount() {
    return eventEmitter.listenerCount('notification');
}

module.exports = {
    emit,
    emitClearedAll,
    subscribe,
    getListenerCount,
};
