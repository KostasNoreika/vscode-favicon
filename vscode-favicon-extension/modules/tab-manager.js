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
     * @param {number|null} count - Badge count (null to calculate from filtered notifications)
     */
    function updateIconBadge(count = null) {
        // Use filtered count if provided, otherwise calculate
        if (count === null) {
            count = getFilteredNotifications().length;
        }

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
     * @returns {Promise<void>}
     */
    async function broadcastNotifications() {
        const filteredNotifications = getFilteredNotifications();

        // Update icon badge with filtered count
        updateIconBadge(filteredNotifications.length);

        console.log('Tab Manager: Broadcasting', filteredNotifications.length,
            'of', getNotifications().length, 'notifications (filtered by active terminals)');

        try {
            const tabs = await queryVSCodeTabs();

            for (const tab of tabs) {
                try {
                    await chrome.tabs.sendMessage(tab.id, {
                        type: 'NOTIFICATIONS_UPDATE',
                        notifications: filteredNotifications,
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
            console.log('Tab Manager: Terminal OPENED for', folder,
                '- active folders:', activeTerminalFolders.size);
        } else if (folder) {
            activeTerminalFolders.delete(folder);
            console.log('Tab Manager: Terminal CLOSED for', folder,
                '- active folders:', activeTerminalFolders.size);
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

        console.log('Tab Manager: Looking for tab with folder:', normalizedTarget);
        console.log('Tab Manager: Available tabs:', tabs.length);

        // Build index: normalized folder -> tab (single pass, eliminates redundant parsing)
        const folderIndex = new Map();
        for (const tab of tabs) {
            if (tab.url) {
                try {
                    const url = new URL(tab.url);
                    const urlFolder = url.searchParams.get('folder');
                    if (urlFolder) {
                        const normalizedUrlFolder = normalizeFolder(urlFolder);
                        folderIndex.set(normalizedUrlFolder, tab);
                        console.log('Tab Manager: Indexed folder:', normalizedUrlFolder);
                    }
                } catch (e) {
                    // Invalid URL, skip this tab
                }
            }
        }

        // Try exact match with O(1) Map lookup
        const exactMatch = folderIndex.get(normalizedTarget);
        if (exactMatch) {
            console.log('Tab Manager: Found exact match:', normalizedTarget);
            await chrome.tabs.update(exactMatch.id, { active: true });
            await chrome.windows.update(exactMatch.windowId, { focused: true });
            return { success: true, tabId: exactMatch.id };
        }

        // Try partial match (iterate over indexed folders, not all tabs)
        for (const [normalizedUrlFolder, tab] of folderIndex) {
            if (normalizedTarget.startsWith(normalizedUrlFolder + '/') ||
                normalizedUrlFolder.startsWith(normalizedTarget + '/')) {
                console.log('Tab Manager: Found partial match:', normalizedUrlFolder);
                await chrome.tabs.update(tab.id, { active: true });
                await chrome.windows.update(tab.windowId, { focused: true });
                return { success: true, tabId: tab.id };
            }
        }

        console.log('Tab Manager: Tab not found for folder:', folder);
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
                console.log('Tab Manager: Tab closed, removed terminal tracking for', folder);
            }
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
                    if (url.searchParams.has('folder')) {
                        await fetchNotifications();
                    }
                } catch {
                    // Invalid URL, skip
                }
            }
        } catch (e) {
            // Tab might have been closed
        }
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
