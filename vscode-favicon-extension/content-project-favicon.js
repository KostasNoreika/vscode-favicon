// VS Code Server Dynamic Favicon Extension v6.0.2
// Reliable polling-based notification system (no SSE - works through any CDN/proxy)
// Features: Claude CLI completion notifications with red badge

(function() {
    'use strict';

    console.log('VS Code Favicon Extension v6.0.2: Starting');

    // Configuration
    const CONFIG = {
        API_BASE: null,  // Will be fetched from background
        API_TIMEOUT: 5000,
        TERMINAL_UPDATE_THROTTLE: 500,
    };

    const VSCODE_ORIGIN = window.location.origin;

    /**
     * Normalize folder path to match server-side behavior
     */
    function normalizeFolder(folder) {
        if (!folder || typeof folder !== 'string') {
            return '';
        }

        let normalized = folder.trim();
        if (!normalized) {
            return '';
        }

        try {
            const decoded = decodeURIComponent(normalized);
            if (decoded !== normalized) {
                normalized = decoded;
            }
        } catch (e) {
            // Invalid encoding, use original
        }

        normalized = normalized.replace(/\\/g, '/');
        normalized = normalized.replace(/\/+$/, '');
        normalized = normalized.toLowerCase();

        return normalized;
    }

    // Track extension context validity
    let extensionContextValid = true;

    /**
     * Safe wrapper for chrome.runtime.sendMessage
     */
    function safeSendMessage(message, callback) {
        if (!extensionContextValid) {
            console.log('VS Code Favicon: Extension context invalid, skipping message');
            return;
        }

        try {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    const errorMsg = chrome.runtime.lastError.message || '';
                    if (errorMsg.includes('Extension context invalidated') ||
                        errorMsg.includes('Could not establish connection')) {
                        console.log('VS Code Favicon: Extension was reloaded. Please refresh the page (F5).');
                        extensionContextValid = false;
                        showExtensionReloadNotice();
                        return;
                    }
                    console.error('VS Code Favicon: Message error:', errorMsg);
                    return;
                }
                if (callback) callback(response);
            });
        } catch (e) {
            if (e.message && e.message.includes('Extension context invalidated')) {
                console.log('VS Code Favicon: Extension was reloaded. Please refresh the page (F5).');
                extensionContextValid = false;
                showExtensionReloadNotice();
            } else {
                console.error('VS Code Favicon: Send message error:', e.message);
            }
        }
    }

    /**
     * Show extension reload notice
     */
    function showExtensionReloadNotice() {
        if (document.getElementById('vscode-favicon-reload-notice')) return;

        const notice = document.createElement('div');
        notice.id = 'vscode-favicon-reload-notice';
        notice.innerHTML = `
            <div style="position:fixed;top:10px;right:10px;background:#ff6b6b;color:white;padding:12px 20px;
                        border-radius:8px;z-index:999999;font-family:system-ui;font-size:14px;
                        box-shadow:0 4px 12px rgba(0,0,0,0.3);cursor:pointer;"
                 onclick="location.reload()">
                Extension updated - click to refresh page
            </div>
        `;
        document.body.appendChild(notice);

        setTimeout(() => notice.remove(), 10000);
    }

    /**
     * Initialize configuration
     */
    async function initializeConfig() {
        return new Promise((resolve) => {
            safeSendMessage({ type: 'GET_API_BASE_URL' }, (response) => {
                CONFIG.API_BASE = response?.apiBaseUrl || 'https://favicon-api.noreika.lt';
                resolve();
            });
            setTimeout(() => {
                if (!CONFIG.API_BASE) {
                    CONFIG.API_BASE = 'https://favicon-api.noreika.lt';
                    resolve();
                }
            }, 1000);
        });
    }

    // Extract project folder from URL
    const urlParams = new URLSearchParams(window.location.search);
    let folder = urlParams.get('folder');

    if (!folder) {
        console.log('VS Code Favicon: No folder parameter found');
        return;
    }

    folder = normalizeFolder(folder);
    const projectName = folder.split('/').pop() || folder;
    console.log('VS Code Favicon: Project:', projectName);

    // State
    let notificationStatus = null;

    // Initialize modules
    const badgeManager = window.BadgeManager.createBadgeManager();

    const terminalAreaDetector = window.TerminalAreaDetector.createTerminalAreaDetector();

    const notificationPanel = window.NotificationPanel.createNotificationPanel({
        sendMessage: safeSendMessage,
        loadBadgePosition: badgeManager.loadBadgePosition,
        saveBadgePosition: badgeManager.saveBadgePosition,
        applyBadgePosition: badgeManager.applyBadgePosition,
        setupBadgeDrag: badgeManager.setupBadgeDrag,
    });

    const clipboardHandler = window.ClipboardHandler.createClipboardHandler({
        showToast: notificationPanel.showUploadToast,
        isInTerminalArea: terminalAreaDetector.isInTerminalArea,
        config: CONFIG,
        folder: folder,
        vscodeOrigin: VSCODE_ORIGIN,
    });

    const terminalDetector = window.TerminalDetector.createTerminalDetector({
        onTerminalStateChange: (terminalOpen) => {
            safeSendMessage({
                type: 'TERMINAL_STATE_CHANGE',
                folder: folder,
                hasTerminal: terminalOpen,
                origin: VSCODE_ORIGIN
            });
            faviconUpdater.updateFavicon();
        },
        updateThrottle: CONFIG.TERMINAL_UPDATE_THROTTLE,
    });

    const faviconUpdater = window.FaviconUpdater.createFaviconUpdater({
        config: CONFIG,
        folder: folder,
        projectName: projectName,
        vscodeOrigin: VSCODE_ORIGIN,
        getTerminalState: () => terminalDetector.isTerminalOpen(),
        getNotificationStatus: () => notificationStatus,
    });

    /**
     * Get notification status from background
     */
    async function getNotificationStatus() {
        return new Promise((resolve) => {
            if (!extensionContextValid) {
                resolve({ hasNotification: false, status: null });
                return;
            }
            safeSendMessage(
                { type: 'GET_NOTIFICATION_STATUS', folder: folder },
                (response) => {
                    resolve(response || { hasNotification: false, status: null });
                }
            );
            setTimeout(() => resolve({ hasNotification: false, status: null }), 1000);
        });
    }

    /**
     * Update notification status
     */
    async function updateNotificationStatus() {
        const response = await getNotificationStatus();
        const previousStatus = notificationStatus;

        if (response.hasNotification) {
            notificationStatus = response.status || 'completed';
        } else {
            notificationStatus = null;
        }

        if (previousStatus !== notificationStatus) {
            const statusText = notificationStatus ? notificationStatus.toUpperCase() : 'cleared';
            console.log(`VS Code Favicon: Status changed to ${statusText}`);
            await faviconUpdater.updateFavicon();
        }
    }

    /**
     * Request notifications from background
     */
    function requestNotifications() {
        safeSendMessage({ type: 'GET_NOTIFICATIONS' }, (response) => {
            if (response && response.notifications) {
                notificationPanel.updateNotifications(response.notifications);
            }
        });
    }

    /**
     * Listen for messages from background worker
     */
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log('VS Code Favicon: Message received:', message.type);

        if (message.type === 'NOTIFICATIONS_UPDATE') {
            console.log('VS Code Favicon: Received notifications update:', message.notifications.length);
            notificationPanel.updateNotifications(message.notifications);
            updateNotificationStatus();
            return;
        }

        if (message.type === 'SHOW_PANEL') {
            console.log('VS Code Favicon: Show panel requested');
            notificationPanel.showPanel();
            sendResponse({ success: true });
            return true;
        }
    });

    /**
     * Initialize extension
     */
    async function initialize() {
        await initializeConfig();

        await faviconUpdater.updateFavicon();
        faviconUpdater.updateTitle();

        await updateNotificationStatus();

        terminalAreaDetector.setupPasteHandlerObserver();

        clipboardHandler.setupKeyboardHandlers(
            terminalAreaDetector.getTerminalInputs(),
            terminalAreaDetector.getTerminalContainers()
        );
        clipboardHandler.setupPasteListener(
            terminalAreaDetector.getTerminalInputs(),
            terminalAreaDetector.getTerminalContainers()
        );

        terminalDetector.setupObserver();

        safeSendMessage({
            type: 'TERMINAL_STATE_CHANGE',
            folder: folder,
            hasTerminal: terminalDetector.isTerminalOpen(),
            origin: VSCODE_ORIGIN
        });

        console.log('VS Code Favicon: Initialized (push-based notifications via background worker)');

        requestNotifications();

        document.addEventListener('visibilitychange', async () => {
            if (!document.hidden) {
                console.log('VS Code Favicon: Tab visible - requesting update');
                await updateNotificationStatus();
                requestNotifications();
            }
        });

        window.addEventListener('focus', () => {
            console.log('VS Code Favicon: Window focus');
            requestNotifications();
        });

        window.addEventListener('beforeunload', () => {
            terminalDetector.cleanup();
            terminalAreaDetector.cleanup();
            safeSendMessage({
                type: 'TERMINAL_STATE_CHANGE',
                folder: folder,
                hasTerminal: false,
                origin: VSCODE_ORIGIN
            });
        });
    }

    // Start
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

})();
