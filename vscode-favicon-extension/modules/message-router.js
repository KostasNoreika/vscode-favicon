/**
 * Message routing for Chrome extension
 * Handles incoming messages from content scripts and popup
 */

(function() {
'use strict';

// Browser-compatible imports: use globals if available, otherwise require for Node.js testing
// Service worker uses self.*, Node.js uses require(), browser uses window.*
const { normalizeFolder } = (typeof self !== 'undefined' && self.PathUtils)
    ? self.PathUtils
    : (typeof window !== 'undefined' && window.PathUtils)
        ? window.PathUtils
        : (typeof require === 'function' ? require('./path-utils') : {});

const DomainManager = (typeof self !== 'undefined' && self.DomainManager)
    ? self.DomainManager
    : (typeof window !== 'undefined' && window.DomainManager)
        ? window.DomainManager
        : (typeof require === 'function' ? require('./domain-manager') : {});

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

                case 'UPLOAD_FILE': {
                    console.log('Message Router: UPLOAD_FILE case entered');
                    // Proxy file upload through background script to bypass CORS
                    const { fileData, fileName, fileType, folder, origin } = message;

                    // Input validation
                    if (!fileData || typeof fileData !== 'string') {
                        console.error('Message Router: UPLOAD_FILE missing or invalid fileData');
                        return { success: false, error: 'Missing or invalid file data' };
                    }
                    if (!folder || typeof folder !== 'string') {
                        console.error('Message Router: UPLOAD_FILE missing or invalid folder');
                        return { success: false, error: 'Missing or invalid folder path' };
                    }
                    if (!fileName || typeof fileName !== 'string') {
                        console.error('Message Router: UPLOAD_FILE missing or invalid fileName');
                        return { success: false, error: 'Missing or invalid file name' };
                    }
                    if (!fileType || typeof fileType !== 'string') {
                        console.error('Message Router: UPLOAD_FILE missing or invalid fileType');
                        return { success: false, error: 'Missing or invalid file type' };
                    }

                    let apiBase = getApiBase();

                    // Origin → API mapping for known VS Code servers
                    // VM has symlinks to match Mac Studio paths (/opt/tools -> ~/tools)
                    const ORIGIN_API_MAP = {
                        'vs.noreika.lt': 'https://favicon-api.noreika.lt', // Production VM
                        // Add more mappings as needed:
                        // 'vscode.example.com': 'https://api.example.com',
                    };

                    // Check for known origin mapping first
                    let originHostname = null;
                    try {
                        originHostname = new URL(origin).hostname;
                    } catch (e) {
                        // Invalid origin URL
                    }

                    if (originHostname && ORIGIN_API_MAP[originHostname]) {
                        apiBase = ORIGIN_API_MAP[originHostname];
                        console.log('Message Router: Known origin mapping:', originHostname, '→', apiBase);
                    } else {
                        // Determine if origin is local (localhost/127.0.0.1) or remote
                        const isLocalOrigin = originHostname === 'localhost' ||
                            originHostname === '127.0.0.1' ||
                            originHostname === '::1';

                        if (isLocalOrigin) {
                            // Local development: use path-based routing
                            const folderForDetection = folder.toLowerCase();
                            const isMacPath = folderForDetection.startsWith('/opt/') ||
                                folderForDetection.startsWith('/users/') ||
                                folderForDetection.startsWith('/applications/');

                            if (isMacPath) {
                                apiBase = 'http://localhost:8090';
                                console.log('Message Router: Local origin + Mac path → localhost:8090');
                            } else {
                                console.log('Message Router: Local origin + non-Mac path → default API');
                            }
                        } else {
                            // Remote VS Code: use default API
                            console.log('Message Router: Remote origin → using default API:', apiBase);
                        }
                    }

                    console.log('Message Router: UPLOAD_FILE request', {
                        fileName,
                        fileType,
                        folder,
                        origin,
                        apiBase,
                        originHostname,
                        dataLength: fileData?.length || 0,
                    });

                    try {
                        // Convert base64 back to blob
                        let binaryString;
                        try {
                            binaryString = atob(fileData);
                        } catch (atobError) {
                            console.error('Message Router: Invalid base64 data:', atobError.message);
                            return { success: false, error: 'Invalid base64 file data' };
                        }

                        const bytes = new Uint8Array(binaryString.length);
                        for (let i = 0; i < binaryString.length; i++) {
                            bytes[i] = binaryString.charCodeAt(i);
                        }
                        const blob = new Blob([bytes], { type: fileType });

                        console.log('Message Router: Created blob', {
                            blobSize: blob.size,
                            blobType: blob.type,
                        });

                        const formData = new FormData();
                        formData.append('image', blob, fileName);
                        formData.append('folder', folder);
                        formData.append('origin', origin);

                        console.log('Message Router: Sending to', `${apiBase}/api/paste-image`);

                        const response = await fetch(`${apiBase}/api/paste-image`, {
                            method: 'POST',
                            headers: {
                                'X-Requested-With': 'XMLHttpRequest',
                            },
                            body: formData
                        });

                        console.log('Message Router: Response status', response.status);

                        if (!response.ok) {
                            const errorText = await response.text();
                            console.error('Message Router: Upload failed', {
                                status: response.status,
                                errorText,
                            });
                            return { success: false, error: `HTTP ${response.status}: ${errorText}` };
                        }

                        const data = await response.json();
                        console.log('Message Router: Upload success', data);
                        return { success: true, filename: data.filename || data.path };
                    } catch (error) {
                        const errorMessage = error?.message || String(error) || 'Unknown upload error';
                        console.error('Message Router: Upload error:', errorMessage, error);
                        return { success: false, error: errorMessage };
                    }
                }

                case 'SET_API_BASE_URL': {
                    // Browser-compatible import for validateApiUrl
                    const StorageModule = (typeof self !== 'undefined' && self.StorageManager)
                        ? self.StorageManager
                        : (typeof window !== 'undefined' && window.StorageManager)
                            ? window.StorageManager
                            : (typeof require === 'function' ? require('./storage-manager') : {});
                    const { validateApiUrl } = StorageModule;
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

// Export for both Node.js (testing) and browser (service worker)
const MessageRouterExports = { createMessageRouter };

// Use require check to definitively detect Node.js (avoid false positives from partial module shims)
if (typeof require === 'function' && typeof module !== 'undefined') {
    module.exports = MessageRouterExports;
} else if (typeof self !== 'undefined') {
    // Service worker global
    self.MessageRouter = MessageRouterExports;
} else if (typeof window !== 'undefined') {
    // Browser global
    window.MessageRouter = MessageRouterExports;
}

})(); // End IIFE
