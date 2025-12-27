/**
 * Tab management utilities
 * Handles notification tracking, tab matching, and notification filtering
 */

(function() {
'use strict';

// Browser-compatible import: use global if available, otherwise require for Node.js testing
// Service worker uses self.*, Node.js uses require(), browser uses window.*
const { normalizeFolder } = (typeof self !== 'undefined' && self.PathUtils)
    ? self.PathUtils
    : (typeof window !== 'undefined' && window.PathUtils)
        ? window.PathUtils
        : (typeof require === 'function' ? require('./path-utils') : {});

/**
 * Query all VS Code Server tabs dynamically
 * Identifies VS Code tabs by presence of ?folder= parameter in URL
 * @returns {Promise<chrome.tabs.Tab[]>}
 */
async function queryVSCodeTabs() {
    const allTabs = await chrome.tabs.query({});
    return allTabs.filter(tab => {
        if (!tab.url) return false;
        try {
            return new URL(tab.url).searchParams.has('folder');
        } catch {
            return false;
        }
    });
}

/**
 * Generate stable notification ID from folder and timestamp
 * @param {object} notification - Notification object
 * @returns {string} - Stable ID or empty string
 */
function getNotificationId(notification) {
    if (!notification || typeof notification !== 'object') {
        return '';
    }

    const folder = notification.folder;
    const timestamp = notification.timestamp;

    if (!folder || !timestamp) {
        return '';
    }

    return `${folder}:${timestamp}`;
}

/**
 * Generate version string from notification array
 * Used for change detection - same notifications = same version
 * @param {Array} notifications - Array of notification objects
 * @returns {string} - Version string (sorted IDs joined by |)
 */
function getNotificationsVersion(notifications) {
    if (!notifications || !Array.isArray(notifications) || notifications.length === 0) {
        return '';
    }

    // Generate IDs and filter out empty ones
    const ids = notifications
        .map(n => getNotificationId(n))
        .filter(id => id !== '');

    // Sort alphabetically for consistency
    ids.sort();

    // Join with | separator
    return ids.join('|');
}

/**
 * Create tab manager for handling tab operations and notification filtering
 * @param {object} deps - Dependencies
 * @param {Function} deps.getNotifications - Function to get current notifications
 * @param {Function} deps.updateBadge - Function to update badge
 * @returns {object} - Tab manager instance
 */
function createTabManager(deps) {
    const { getNotifications, updateBadge } = deps;

    // Track folders with active terminals (folder -> tabId)
    const activeTerminalFolders = new Map();

    // Track currently focused VS Code tab
    let focusedTabInfo = null; // { tabId, folder }

    /**
     * Filter notifications to only those with active terminals
     * @returns {Array} - Filtered notifications
     */
    function getFilteredNotifications() {
        if (activeTerminalFolders.size === 0) {
            return [];
        }

        const notifications = getNotifications();
        return notifications.filter(n => {
            const nFolder = normalizeFolder(n.folder);
            for (const [activeFolder] of activeTerminalFolders) {
                if (normalizeFolder(activeFolder) === nFolder) {
                    return true;
                }
            }
            return false;
        });
    }

    /**
     * Update extension icon badge
     * Shows ALL unread notifications count (not filtered by terminal state)
     * This ensures users always see pending notifications regardless of terminal visibility
     */
    function updateIconBadge() {
        // Always show ALL notifications count on badge (not filtered)
        const allNotifications = getNotifications();
        const count = allNotifications.length;

        if (count > 0) {
            chrome.action.setBadgeText({ text: count.toString() });
            chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
            chrome.action.setTitle({ title: `${count} Claude notification${count > 1 ? 's' : ''}` });
        } else {
            chrome.action.setBadgeText({ text: '' });
            chrome.action.setTitle({ title: 'VS Code Server Favicons' });
        }
    }

    /**
     * Broadcast notifications to all VS Code tabs
     * Both icon badge and in-page panel show ALL notifications
     * @returns {Promise<void>}
     */
    async function broadcastNotifications() {
        const allNotifications = getNotifications();

        // Update icon badge with ALL notifications count
        updateIconBadge();

        try {
            const tabs = await queryVSCodeTabs();

            for (const tab of tabs) {
                try {
                    await chrome.tabs.sendMessage(tab.id, {
                        type: 'NOTIFICATIONS_UPDATE',
                        notifications: allNotifications,
                    });
                } catch (e) {
                    // Tab might not have content script loaded yet
                }
            }
        } catch (error) {
            console.log('Tab Manager: Broadcast error:', error.message);
        }
    }

    /**
     * Handle terminal state change
     * @param {string} folder - Folder path
     * @param {boolean} hasTerminal - Whether terminal is open
     * @param {number} tabId - Tab ID
     * @returns {object} - Result object
     */
    function handleTerminalStateChange(folder, hasTerminal, tabId) {
        if (hasTerminal && folder) {
            activeTerminalFolders.set(folder, tabId);
        } else if (folder) {
            activeTerminalFolders.delete(folder);
        }

        // Auto pin/unpin + tab grouping based on terminal state
        // Fire and forget - don't block the main flow
        if (tabId && typeof self !== 'undefined' && self.TabGroupManager) {
            self.TabGroupManager.handleTerminalStateForTabGrouping(tabId, hasTerminal)
                .catch(err => console.error('Tab Manager: Tab grouping error:', err.message));
        }

        return { activeTerminals: activeTerminalFolders.size };
    }

    /**
     * Switch to tab with matching folder
     * @param {string} folder - Folder path to find
     * @returns {Promise<object>} - Result object
     */
    async function switchToTab(folder) {
        const tabs = await queryVSCodeTabs();
        const normalizedTarget = normalizeFolder(folder);

        // Build index: normalized folder -> tab
        const folderIndex = new Map();
        for (const tab of tabs) {
            if (tab.url) {
                try {
                    const url = new URL(tab.url);
                    const urlFolder = url.searchParams.get('folder');
                    if (urlFolder) {
                        folderIndex.set(normalizeFolder(urlFolder), tab);
                    }
                } catch {
                    // Invalid URL, skip
                }
            }
        }

        // Try exact match
        const exactMatch = folderIndex.get(normalizedTarget);
        if (exactMatch) {
            await chrome.tabs.update(exactMatch.id, { active: true });
            await chrome.windows.update(exactMatch.windowId, { focused: true });
            return { success: true, tabId: exactMatch.id };
        }

        // Try partial match
        for (const [normalizedUrlFolder, tab] of folderIndex) {
            if (normalizedTarget.startsWith(normalizedUrlFolder + '/') ||
                normalizedUrlFolder.startsWith(normalizedTarget + '/')) {
                await chrome.tabs.update(tab.id, { active: true });
                await chrome.windows.update(tab.windowId, { focused: true });
                return { success: true, tabId: tab.id };
            }
        }

        return { success: false, error: 'Tab not found' };
    }

    /**
     * Handle tab removed event
     * @param {number} tabId - Removed tab ID
     * @returns {Promise<void>}
     */
    async function handleTabRemoved(tabId) {
        for (const [folder, tid] of activeTerminalFolders) {
            if (tid === tabId) {
                activeTerminalFolders.delete(folder);
            }
        }

        // Notify tab group manager about tab removal
        if (typeof self !== 'undefined' && self.TabGroupManager) {
            self.TabGroupManager.handleTabRemoved(tabId);
        }

        await broadcastNotifications();
    }

    /**
     * Handle tab activated event
     * @param {object} activeInfo - Chrome activeInfo object
     * @param {Function} fetchNotifications - Function to fetch notifications
     * @returns {Promise<void>}
     */
    async function handleTabActivated(activeInfo, fetchNotifications) {
        try {
            const tab = await chrome.tabs.get(activeInfo.tabId);
            if (tab.url) {
                try {
                    const url = new URL(tab.url);
                    const folder = url.searchParams.get('folder');
                    if (folder) {
                        // Track focused VS Code tab
                        focusedTabInfo = {
                            tabId: activeInfo.tabId,
                            folder: normalizeFolder(folder),
                        };

                        // Notify content script about focus
                        try {
                            await chrome.tabs.sendMessage(activeInfo.tabId, {
                                type: 'TAB_FOCUS_CHANGED',
                                isFocused: true,
                            });
                        } catch {
                            // Content script not ready
                        }

                        await fetchNotifications();
                    } else {
                        // Non-VS Code tab focused - clear focus tracking
                        focusedTabInfo = null;
                    }
                } catch {
                    // Invalid URL, clear focus
                    focusedTabInfo = null;
                }
            }
        } catch (e) {
            // Tab might have been closed
            focusedTabInfo = null;
        }
    }

    /**
     * Check if notification should be suppressed for focused tab
     * @param {string} folder - Notification folder
     * @returns {boolean} - True if should suppress
     */
    function shouldSuppressNotification(folder) {
        if (!focusedTabInfo) return false;
        return normalizeFolder(folder) === focusedTabInfo.folder;
    }

    /**
     * Get focused tab info
     * @returns {object|null} - Focused tab info or null
     */
    function getFocusedTabInfo() {
        return focusedTabInfo;
    }

    return {
        getFilteredNotifications,
        updateIconBadge,
        broadcastNotifications,
        handleTerminalStateChange,
        switchToTab,
        handleTabRemoved,
        handleTabActivated,
        getActiveTerminalCount: () => activeTerminalFolders.size,
        shouldSuppressNotification,
        getFocusedTabInfo,
    };
}

// Export for both Node.js (testing) and browser (service worker)
const TabManagerExports = {
    normalizeFolder,
    getNotificationId,
    getNotificationsVersion,
    createTabManager,
};

// Use require check to definitively detect Node.js (avoid false positives from partial module shims)
if (typeof require === 'function' && typeof module !== 'undefined') {
    module.exports = TabManagerExports;
} else if (typeof self !== 'undefined') {
    // Service worker global
    self.TabManager = TabManagerExports;
} else if (typeof window !== 'undefined') {
    // Browser global
    window.TabManager = TabManagerExports;
}

})(); // End IIFE
