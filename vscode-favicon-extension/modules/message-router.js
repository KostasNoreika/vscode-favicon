/**
 * Message routing for Chrome extension
 * Handles incoming messages from content scripts and popup
 */

const { normalizeFolder } = require('./path-utils');

/**
 * Create message router with injected dependencies
 * @param {object} deps - Dependencies
 * @returns {object} - Router with handleMessage method
 */
function createMessageRouter(deps) {
    const {
        getNotifications,
        getFilteredNotifications,
        switchToTab,
        handleTerminalStateChange,
        broadcastNotifications,
        fetchNotifications,
        markRead,
        markAllRead,
        getCircuitBreakerStatus,
    } = deps;

    /**
     * Handle incoming message
     * @param {object} message - Message object with type field
     * @param {object} sender - Chrome sender object
     * @returns {Promise<object>} - Response object
     */
    async function handleMessage(message, sender) {
        const { type } = message;

        try {
            switch (type) {
                case 'TERMINAL_STATE_CHANGE': {
                    const result = handleTerminalStateChange(
                        message.folder,
                        message.hasTerminal,
                        sender.tab?.id
                    );
                    // Re-broadcast notifications with updated filter
                    await broadcastNotifications();
                    return { success: true, ...result };
                }

                case 'GET_NOTIFICATIONS':
                    // Return filtered notifications (only for folders with active terminals)
                    return { notifications: getFilteredNotifications() };

                case 'GET_NOTIFICATION_STATUS': {
                    const folder = message.folder;
                    const notifications = getNotifications();
                    const notification = notifications.find(n => {
                        const nFolder = normalizeFolder(n.folder);
                        const reqFolder = normalizeFolder(folder);
                        return nFolder === reqFolder;
                    });
                    return {
                        hasNotification: !!notification,
                        status: notification?.status || null,
                        notification: notification || null,
                    };
                }

                case 'SWITCH_TO_TAB':
                    return await switchToTab(message.folder);

                case 'MARK_READ':
                    return await markRead(message.folder);

                case 'MARK_ALL_READ':
                    return await markAllRead();

                case 'REFRESH_NOTIFICATIONS':
                    await fetchNotifications();
                    return { success: true };

                case 'GET_CIRCUIT_BREAKER_STATUS':
                    return getCircuitBreakerStatus();

                default:
                    console.warn('Message Router: Unknown message type:', type);
                    return { error: 'Unknown message type' };
            }
        } catch (error) {
            console.error('Message Router: Handler error:', error);
            return { error: error.message };
        }
    }

    return {
        handleMessage,
    };
}

module.exports = {
    createMessageRouter,
};
