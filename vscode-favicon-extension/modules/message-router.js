/**
 * Message routing for Chrome extension
 * Handles incoming messages from content scripts and popup
 */

const { normalizeFolder } = require('./path-utils');
const DomainManager = require('./domain-manager');

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
        getApiBase,
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

                case 'GET_VSCODE_DOMAINS': {
                    const domains = await DomainManager.getWhitelistedDomains();
                    return { domains };
                }

                case 'ADD_VSCODE_DOMAIN': {
                    const result = await DomainManager.addDomain(message.domain);
                    return result;
                }

                case 'REMOVE_VSCODE_DOMAIN': {
                    const result = await DomainManager.removeDomain(message.domain);
                    return result;
                }

                case 'REQUEST_DOMAIN_PERMISSION': {
                    const result = await DomainManager.requestDomainPermission(message.origin);
                    return result;
                }

                case 'GET_AUTO_DETECT_SETTING': {
                    const enabled = await DomainManager.isAutoDetectEnabled();
                    return { enabled };
                }

                case 'SET_AUTO_DETECT_SETTING': {
                    const result = await DomainManager.setAutoDetect(message.enabled);
                    return result;
                }

                case 'GET_API_BASE_URL': {
                    const apiBaseUrl = getApiBase();
                    return { apiBaseUrl };
                }

                case 'SET_API_BASE_URL': {
                    const { validateApiUrl } = require('./storage-manager');
                    const validation = validateApiUrl(message.url);

                    if (!validation.valid) {
                        return { success: false, error: validation.error };
                    }

                    try {
                        await chrome.storage.local.set({ apiBaseUrl: validation.url });
                        // Update runtime config (will be picked up after reload)
                        return { success: true, apiBaseUrl: validation.url };
                    } catch (error) {
                        return { success: false, error: error.message };
                    }
                }

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
