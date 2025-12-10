// VS Code Favicon Extension - Background Service Worker
// Uses SSE for real-time updates, falls back to polling if SSE fails

const CONFIG = {
    API_BASE: 'https://favicon-api.noreika.lt',
    SSE_RECONNECT_DELAY: 5000,    // 5 seconds before SSE reconnect
    POLL_INTERVAL: 60000,          // 60 seconds fallback polling
    API_TIMEOUT: 10000,
};

let notifications = [];
let eventSource = null;
let pollTimer = null;
let useSSE = true;
let sseRetryCount = 0;
const MAX_SSE_RETRIES = 3;

// Connect to SSE stream
function connectSSE() {
    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }

    console.log('VS Code Favicon BG: Connecting to SSE...');

    try {
        eventSource = new EventSource(`${CONFIG.API_BASE}/notifications/stream`);

        eventSource.onopen = () => {
            console.log('VS Code Favicon BG: SSE connected');
            sseRetryCount = 0;
            // Stop polling since SSE is working
            if (pollTimer) {
                clearTimeout(pollTimer);
                pollTimer = null;
            }
        };

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('VS Code Favicon BG: SSE event:', data.type);

                if (data.type === 'notification' || data.type === 'update') {
                    // Server pushed an update, fetch latest
                    fetchNotifications();
                } else if (data.type === 'connected' || data.type === 'heartbeat') {
                    // Connection alive, no action needed
                }
            } catch (e) {
                console.log('VS Code Favicon BG: SSE parse error:', e.message);
            }
        };

        eventSource.onerror = (error) => {
            console.log('VS Code Favicon BG: SSE error, reconnecting...');
            eventSource.close();
            eventSource = null;

            sseRetryCount++;
            if (sseRetryCount > MAX_SSE_RETRIES) {
                console.log('VS Code Favicon BG: SSE failed, falling back to polling');
                useSSE = false;
                startPolling();
            } else {
                // Retry SSE connection
                setTimeout(connectSSE, CONFIG.SSE_RECONNECT_DELAY * sseRetryCount);
            }
        };
    } catch (e) {
        console.log('VS Code Favicon BG: SSE not supported, using polling');
        useSSE = false;
        startPolling();
    }
}

// Fetch notifications (used by both SSE and polling)
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
                broadcastNotifications();
            }
        }
    } catch (error) {
        console.log('VS Code Favicon BG: Fetch error:', error.message);
    }
}

// Start polling as fallback
function startPolling() {
    if (pollTimer) return;

    async function poll() {
        await fetchNotifications();
        pollTimer = setTimeout(poll, CONFIG.POLL_INTERVAL);
    }

    poll();
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

    if (message.type === 'GET_NOTIFICATION_STATUS') {
        // Get status for a specific folder (for favicon badge)
        const folder = message.folder;
        const notification = notifications.find(n => {
            const nFolder = (n.folder || '').replace(/\/+$/, '');
            const reqFolder = (folder || '').replace(/\/+$/, '');
            return nFolder.toLowerCase() === reqFolder.toLowerCase();
        });
        sendResponse({
            hasNotification: !!notification,
            status: notification?.status || null,
            notification: notification || null,
        });
        return true;
    }

    if (message.type === 'SWITCH_TO_TAB') {
        // Find tab with matching folder and switch to it
        chrome.tabs.query({ url: 'https://vs.noreika.lt/*' }, (tabs) => {
            const targetFolder = message.folder;
            const normalizedTarget = decodeURIComponent(targetFolder || '').replace(/\/+$/, '');

            for (const tab of tabs) {
                if (tab.url) {
                    try {
                        const url = new URL(tab.url);
                        const urlFolder = url.searchParams.get('folder');
                        const normalizedUrlFolder = (urlFolder || '').replace(/\/+$/, '');

                        if (normalizedUrlFolder.toLowerCase() === normalizedTarget.toLowerCase()) {
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
            console.log('VS Code Favicon BG: Tab not found for folder:', targetFolder);
            sendResponse({ success: false, error: 'Tab not found' });
        });
        return true;
    }

    if (message.type === 'MARK_READ') {
        fetch(`${CONFIG.API_BASE}/claude-status/mark-read`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folder: message.folder }),
        })
            .then(() => {
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
        fetchNotifications();
        sendResponse({ success: true });
        return true;
    }
});

// Initialize: try SSE first, fallback to polling
console.log('VS Code Favicon BG: Starting with SSE...');

// Initial fetch
fetchNotifications();

// Try SSE connection
if (typeof EventSource !== 'undefined') {
    connectSSE();
} else {
    console.log('VS Code Favicon BG: EventSource not available, using polling');
    useSSE = false;
    startPolling();
}

// Also fetch immediately when a VS Code tab becomes active
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        if (tab.url && tab.url.includes('vs.noreika.lt')) {
            fetchNotifications();
        }
    } catch (e) {
        // Tab might have been closed
    }
});

// Keep-alive: reconnect SSE if needed (Service Worker can suspend)
chrome.alarms.create('keepAlive', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'keepAlive') {
        if (useSSE && !eventSource) {
            console.log('VS Code Favicon BG: Reconnecting SSE after wake...');
            connectSSE();
        } else if (!useSSE) {
            // Polling mode - fetch now
            fetchNotifications();
        }
    }
});
