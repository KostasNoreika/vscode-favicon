// Popup script for VS Code Favicon Extension

const API_BASE = 'https://favicon-api.noreika.lt';

function formatTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

async function loadNotifications() {
    const url = `${API_BASE}/api/notifications/unread`;
    console.log('Popup: Fetching notifications from:', url);
    try {
        const response = await fetch(url);
        console.log('Popup: Response status:', response.status);
        const data = await response.json();
        console.log('Popup: Got data:', data);
        return data.notifications || [];
    } catch (error) {
        console.error('Popup: Failed to load notifications:', error);
        return [];
    }
}

function createNotificationElement(notification) {
    // Create main container
    const item = document.createElement('div');
    item.className = 'item';
    item.dataset.folder = notification.folder;

    // Create icon
    const icon = document.createElement('div');
    icon.className = 'item-icon';
    icon.textContent = '✓';

    // Create content container
    const content = document.createElement('div');
    content.className = 'item-content';

    // Create project name
    const projectName = document.createElement('div');
    projectName.className = 'item-project';
    projectName.textContent = notification.projectName;

    // Create message
    const message = document.createElement('div');
    message.className = 'item-message';
    message.textContent = notification.message || 'Task completed';

    // Create time
    const time = document.createElement('div');
    time.className = 'item-time';
    time.textContent = formatTimeAgo(notification.timestamp);

    // Assemble content
    content.appendChild(projectName);
    content.appendChild(message);
    content.appendChild(time);

    // Create dismiss button
    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'item-dismiss';
    dismissBtn.dataset.folder = notification.folder;
    dismissBtn.title = 'Dismiss';
    dismissBtn.textContent = '×';

    // Assemble item
    item.appendChild(icon);
    item.appendChild(content);
    item.appendChild(dismissBtn);

    return item;
}

function renderNotifications(notifications) {
    const list = document.getElementById('list');
    const count = document.getElementById('count');
    const clearAllBtn = document.getElementById('clearAll');

    count.textContent = notifications.length;

    // SECURITY FIX SEC-002: Clear existing content safely using replaceChildren()
    // This prevents potential XSS vectors from innerHTML usage
    list.replaceChildren();

    if (notifications.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'No notifications';
        list.appendChild(empty);
        clearAllBtn.style.display = 'none';
        return;
    }

    clearAllBtn.style.display = 'block';

    // Create notification elements safely
    notifications.forEach(notification => {
        const item = createNotificationElement(notification);
        list.appendChild(item);
    });

    // Add click handlers
    list.querySelectorAll('.item').forEach(item => {
        item.addEventListener('click', async (e) => {
            if (e.target.classList.contains('item-dismiss')) return;

            const folder = item.dataset.folder;
            await switchToTab(folder);
            await markAsRead(folder);
            window.close();
        });
    });

    list.querySelectorAll('.item-dismiss').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const folder = btn.dataset.folder;
            await markAsRead(folder);
            // Reload
            const updated = await loadNotifications();
            renderNotifications(updated);
        });
    });
}

async function switchToTab(folder) {
    return new Promise((resolve) => {
        chrome.tabs.query({ url: 'https://vs.noreika.lt/*' }, (tabs) => {
            for (const tab of tabs) {
                if (tab.url) {
                    try {
                        const url = new URL(tab.url);
                        const urlFolder = url.searchParams.get('folder');

                        // Normalize: remove trailing slashes
                        const normalizedUrlFolder = (urlFolder || '').replace(/\/+$/, '');
                        const normalizedTarget = folder.replace(/\/+$/, '');

                        if (normalizedUrlFolder === normalizedTarget) {
                            chrome.tabs.update(tab.id, { active: true });
                            chrome.windows.update(tab.windowId, { focused: true });
                            resolve(true);
                            return;
                        }
                    } catch (e) {
                        // Invalid URL
                    }
                }
            }
            resolve(false);
        });
    });
}

async function markAsRead(folder) {
    try {
        await fetch(`${API_BASE}/claude-status/mark-read`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folder })
        });
        // Update badge
        chrome.runtime.sendMessage({ type: 'REFRESH_NOTIFICATIONS' });
    } catch (error) {
        console.error('Failed to mark as read:', error);
    }
}

async function clearAll() {
    const notifications = await loadNotifications();
    for (const n of notifications) {
        await markAsRead(n.folder);
    }
    renderNotifications([]);
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    console.log('Popup: DOMContentLoaded fired');
    const notifications = await loadNotifications();
    console.log('Popup: Loaded', notifications.length, 'notifications');
    renderNotifications(notifications);

    document.getElementById('clearAll').addEventListener('click', clearAll);
});
