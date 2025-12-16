// Popup script for VS Code Favicon Extension

let API_BASE = 'https://favicon-api.noreika.lt'; // Default fallback

/**
 * Initialize API base URL from background worker
 * @returns {Promise<void>}
 */
async function initApiBase() {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_API_BASE_URL' }, (response) => {
            if (response?.apiBaseUrl) {
                API_BASE = response.apiBaseUrl;
                console.log('Popup: Using API base URL:', API_BASE);
            } else {
                console.log('Popup: Using default API base URL:', API_BASE);
            }
            resolve();
        });
        // Fallback timeout in case message fails
        setTimeout(resolve, 1000);
    });
}

// Use shared utility modules
const { normalizeFolder } = window.PathUtils;
const { formatTimeAgo } = window.TimeUtils;

async function loadNotifications() {
    const url = `${API_BASE}/api/notifications/unread`;
    console.log('Popup: Fetching notifications from:', url);
    try {
        const response = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        console.log('Popup: Response status:', response.status);

        // Check if response is ok
        if (!response.ok) {
            console.error('Popup: API returned error status:', response.status);
            return { error: `API unavailable (HTTP ${response.status})`, notifications: [] };
        }

        // Check content-type before parsing JSON
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            console.error('Popup: Non-JSON response, content-type:', contentType);
            const text = await response.text();
            console.error('Popup: Response body:', text.substring(0, 200));
            return { error: `API returned non-JSON response (${contentType || 'unknown'})`, notifications: [] };
        }

        const data = await response.json();
        console.log('Popup: Got data:', data);
        return { notifications: data.notifications || [] };
    } catch (error) {
        console.error('Popup: Failed to load notifications:', error.message);
        return { error: `Network error: ${error.message}`, notifications: [] };
    }
}

function createNotificationElement(notification) {
    // Use shared DOM utilities for XSS-safe element creation
    return window.DomUtils.createNotificationElement(notification, formatTimeAgo);
}

function renderNotifications(result) {
    const list = document.getElementById('list');
    const count = document.getElementById('count');
    const clearAllBtn = document.getElementById('clearAll');

    const notifications = result.notifications || [];
    count.textContent = notifications.length;

    // SECURITY FIX SEC-002: Clear existing content safely using replaceChildren()
    // This prevents potential XSS vectors from innerHTML usage
    list.replaceChildren();

    // Show error message if API is unavailable
    if (result.error) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.style.cssText = 'padding: 16px; text-align: center; color: #ff6b6b; background: #ffe0e0; border-radius: 8px; margin: 8px;';

        const errorText = document.createElement('div');
        errorText.textContent = result.error;
        errorText.style.cssText = 'font-weight: bold; margin-bottom: 8px;';

        const healthLink = document.createElement('a');
        healthLink.href = 'https://favicon-api.noreika.lt/health';
        healthLink.target = '_blank';
        healthLink.textContent = 'Check API health';
        healthLink.style.cssText = 'color: #ff6b6b; text-decoration: underline;';

        errorDiv.appendChild(errorText);
        errorDiv.appendChild(healthLink);
        list.appendChild(errorDiv);
        clearAllBtn.style.display = 'none';
        return;
    }

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
        // Query all tabs and filter dynamically by ?folder= parameter
        chrome.tabs.query({}, (tabs) => {
            const vscodeTabs = tabs.filter(tab => {
                if (!tab.url) return false;
                try {
                    return new URL(tab.url).searchParams.has('folder');
                } catch {
                    return false;
                }
            });

            for (const tab of vscodeTabs) {
                try {
                    const url = new URL(tab.url);
                    const urlFolder = url.searchParams.get('folder');

                    // Normalize paths using consistent server-aligned function
                    const normalizedUrlFolder = normalizeFolder(urlFolder);
                    const normalizedTarget = normalizeFolder(folder);

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
            resolve(false);
        });
    });
}

async function markAsRead(folder) {
    try {
        await fetch(`${API_BASE}/claude-status/mark-read`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
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

    // Initialize API base URL from background worker
    await initApiBase();

    const notifications = await loadNotifications();
    console.log('Popup: Loaded', notifications.length, 'notifications');
    renderNotifications(notifications);

    document.getElementById('clearAll').addEventListener('click', clearAll);
});
