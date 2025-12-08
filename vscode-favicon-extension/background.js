// VS Code Favicon Extension - Background Service Worker
// Polls for all unread notifications and broadcasts to content scripts

const CONFIG = {
    API_BASE: 'https://favicon-api.noreika.lt',
    POLL_INTERVAL: 5000,  // 5 seconds
    API_TIMEOUT: 5000,
};

let notifications = [];
let pollTimer = null;

// Poll for unread notifications
async function pollNotifications() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONFIG.API_TIMEOUT);

        const response = await fetch(`${CONFIG.API_BASE}/api/notifications/unread`, {
            method: 'GET',
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
            const data = await response.json();
            const newNotifications = data.notifications || [];

            // Check if notifications changed
            const changed = JSON.stringify(newNotifications) !== JSON.stringify(notifications);
            notifications = newNotifications;

            if (changed) {
                console.log('VS Code Favicon BG: Notifications updated:', notifications.length);
                broadcastNotifications();
            }
        }
    } catch (error) {
        console.log('VS Code Favicon BG: Poll error:', error.message);
    }

    // Schedule next poll
    pollTimer = setTimeout(pollNotifications, CONFIG.POLL_INTERVAL);
}

// Update extension icon badge
function updateIconBadge() {
    const count = notifications.length;
    if (count > 0) {
        chrome.action.setBadgeText({ text: count.toString() });
        chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
        chrome.action.setTitle({ title: `${count} Claude notification${count > 1 ? 's' : ''}` });
    } else {
        chrome.action.setBadgeText({ text: '' });
        chrome.action.setTitle({ title: 'VS Code Server Favicons' });
    }
}

// Broadcast notifications to all VS Code tabs
async function broadcastNotifications() {
    // Update icon badge
    updateIconBadge();

    try {
        const tabs = await chrome.tabs.query({ url: 'https://vs.noreika.lt/*' });

        for (const tab of tabs) {
            try {
                await chrome.tabs.sendMessage(tab.id, {
                    type: 'NOTIFICATIONS_UPDATE',
                    notifications: notifications,
                });
            } catch (e) {
                // Tab might not have content script loaded yet
            }
        }
    } catch (error) {
        console.log('VS Code Favicon BG: Broadcast error:', error.message);
    }
}

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_NOTIFICATIONS') {
        sendResponse({ notifications });
        return true;
    }

    if (message.type === 'SWITCH_TO_TAB') {
        // Find tab with matching folder and switch to it
        chrome.tabs.query({ url: 'https://vs.noreika.lt/*' }, (tabs) => {
            const targetFolder = message.folder;
            // Normalize: remove trailing slashes and decode
            const normalizedTarget = decodeURIComponent(targetFolder || '').replace(/\/+$/, '');

            for (const tab of tabs) {
                if (tab.url) {
                    try {
                        const url = new URL(tab.url);
                        const urlFolder = url.searchParams.get('folder');
                        // Normalize: remove trailing slashes (searchParams already decodes)
                        const normalizedUrlFolder = (urlFolder || '').replace(/\/+$/, '');

                        if (normalizedUrlFolder === normalizedTarget) {
                            chrome.tabs.update(tab.id, { active: true });
                            chrome.windows.update(tab.windowId, { focused: true });
                            sendResponse({ success: true, tabId: tab.id });
                            return;
                        }
                    } catch (e) {
                        // Invalid URL, skip this tab
                    }
                }
            }
            console.log('VS Code Favicon BG: Tab not found for folder:', targetFolder, '(normalized:', normalizedTarget, ')');
            sendResponse({ success: false, error: 'Tab not found' });
        });
        return true; // Keep channel open for async response
    }

    if (message.type === 'MARK_READ') {
        // Mark notification as read via API
        fetch(`${CONFIG.API_BASE}/claude-status/mark-read`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folder: message.folder }),
        })
            .then(() => {
                // Remove from local cache
                notifications = notifications.filter(n => n.folder !== message.folder);
                broadcastNotifications();
                sendResponse({ success: true });
            })
            .catch(err => {
                sendResponse({ success: false, error: err.message });
            });
        return true;
    }

    if (message.type === 'MARK_ALL_READ') {
        // Mark all notifications as read
        const promises = notifications.map(n =>
            fetch(`${CONFIG.API_BASE}/claude-status/mark-read`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folder: n.folder }),
            })
        );

        Promise.all(promises)
            .then(() => {
                notifications = [];
                broadcastNotifications();
                sendResponse({ success: true });
            })
            .catch(err => {
                sendResponse({ success: false, error: err.message });
            });
        return true;
    }

    if (message.type === 'REFRESH_NOTIFICATIONS') {
        // Immediate poll and update badge
        pollNotifications();
        sendResponse({ success: true });
        return true;
    }
});

// Start polling when extension loads
console.log('VS Code Favicon BG: Starting notification polling');
pollNotifications();

// Note: popup.html handles click on extension icon - no onClicked handler needed

// Also poll immediately when a VS Code tab becomes active
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        if (tab.url && tab.url.includes('vs.noreika.lt')) {
            // Immediate poll and broadcast to the newly active tab
            await pollNotifications();
        }
    } catch (e) {
        // Tab might have been closed
    }
});
