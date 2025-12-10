// VS Code Favicon Extension - Background Service Worker
// Uses chrome.alarms for reliable polling (Service Workers don't support EventSource/setTimeout)

const CONFIG = {
    API_BASE: 'https://favicon-api.noreika.lt',
    POLL_INTERVAL_MINUTES: 1, // chrome.alarms minimum is 1 minute
    API_TIMEOUT: 10000,
    STORAGE_KEY: 'notifications',
};

// In-memory cache (may be lost on Service Worker restart)
let notifications = [];

// Load notifications from persistent storage
async function loadNotifications() {
    try {
        const data = await chrome.storage.local.get(CONFIG.STORAGE_KEY);
        notifications = data[CONFIG.STORAGE_KEY] || [];
        console.log('VS Code Favicon BG: Loaded', notifications.length, 'notifications from storage');
    } catch (e) {
        console.log('VS Code Favicon BG: Failed to load from storage:', e.message);
        notifications = [];
    }
}

// Save notifications to persistent storage
async function saveNotifications() {
    try {
        await chrome.storage.local.set({ [CONFIG.STORAGE_KEY]: notifications });
    } catch (e) {
        console.log('VS Code Favicon BG: Failed to save to storage:', e.message);
    }
}

// Fetch notifications from server
async function fetchNotifications() {
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
                await saveNotifications();
                await broadcastNotifications();
            }
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('VS Code Favicon BG: Fetch timeout');
        } else {
            console.log('VS Code Favicon BG: Fetch error:', error.message);
        }
    }
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

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Ensure notifications are loaded
    const handleMessage = async () => {
        if (notifications.length === 0) {
            await loadNotifications();
        }

        if (message.type === 'GET_NOTIFICATIONS') {
            return { notifications };
        }

        if (message.type === 'GET_NOTIFICATION_STATUS') {
            const folder = message.folder;
            const notification = notifications.find(n => {
                const nFolder = (n.folder || '').replace(/\/+$/, '');
                const reqFolder = (folder || '').replace(/\/+$/, '');
                return nFolder.toLowerCase() === reqFolder.toLowerCase();
            });
            return {
                hasNotification: !!notification,
                status: notification?.status || null,
                notification: notification || null,
            };
        }

        if (message.type === 'SWITCH_TO_TAB') {
            const tabs = await chrome.tabs.query({ url: 'https://vs.noreika.lt/*' });
            const targetFolder = message.folder;
            const normalizedTarget = decodeURIComponent(targetFolder || '').replace(/\/+$/, '');

            for (const tab of tabs) {
                if (tab.url) {
                    try {
                        const url = new URL(tab.url);
                        const urlFolder = url.searchParams.get('folder');
                        const normalizedUrlFolder = (urlFolder || '').replace(/\/+$/, '');

                        if (normalizedUrlFolder.toLowerCase() === normalizedTarget.toLowerCase()) {
                            await chrome.tabs.update(tab.id, { active: true });
                            await chrome.windows.update(tab.windowId, { focused: true });
                            return { success: true, tabId: tab.id };
                        }
                    } catch (e) {
                        // Invalid URL, skip this tab
                    }
                }
            }
            console.log('VS Code Favicon BG: Tab not found for folder:', targetFolder);
            return { success: false, error: 'Tab not found' };
        }

        if (message.type === 'MARK_READ') {
            try {
                await fetch(`${CONFIG.API_BASE}/claude-status/mark-read`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ folder: message.folder }),
                });
                notifications = notifications.filter(n => n.folder !== message.folder);
                await saveNotifications();
                await broadcastNotifications();
                return { success: true };
            } catch (err) {
                return { success: false, error: err.message };
            }
        }

        if (message.type === 'MARK_ALL_READ') {
            try {
                await Promise.all(notifications.map(n =>
                    fetch(`${CONFIG.API_BASE}/claude-status/mark-read`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ folder: n.folder }),
                    })
                ));
                notifications = [];
                await saveNotifications();
                await broadcastNotifications();
                return { success: true };
            } catch (err) {
                return { success: false, error: err.message };
            }
        }

        if (message.type === 'REFRESH_NOTIFICATIONS') {
            await fetchNotifications();
            return { success: true };
        }

        return { error: 'Unknown message type' };
    };

    // Handle async response
    handleMessage().then(sendResponse).catch(err => {
        console.log('VS Code Favicon BG: Message handler error:', err.message);
        sendResponse({ error: err.message });
    });

    return true; // Keep channel open for async response
});

// Setup polling alarm
async function setupPolling() {
    // Create alarm for periodic polling (minimum 1 minute for chrome.alarms)
    await chrome.alarms.create('pollNotifications', { periodInMinutes: CONFIG.POLL_INTERVAL_MINUTES });
    console.log('VS Code Favicon BG: Polling alarm set for every', CONFIG.POLL_INTERVAL_MINUTES, 'minute(s)');
}

// Handle alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'pollNotifications') {
        console.log('VS Code Favicon BG: Polling triggered by alarm');
        await fetchNotifications();
    }
});

// Fetch immediately when a VS Code tab becomes active
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        if (tab.url && tab.url.includes('vs.noreika.lt')) {
            await fetchNotifications();
        }
    } catch (e) {
        // Tab might have been closed
    }
});

// Initialize on Service Worker start
async function initialize() {
    console.log('VS Code Favicon BG: Initializing...');

    // Load persisted notifications
    await loadNotifications();

    // Update badge based on loaded notifications
    updateIconBadge();

    // Setup polling alarm
    await setupPolling();

    // Fetch fresh notifications
    await fetchNotifications();

    console.log('VS Code Favicon BG: Initialization complete');
}

// Run initialization
initialize();
