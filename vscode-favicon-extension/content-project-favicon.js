// VS Code Server Dynamic Favicon Extension v6.1.3
// Reliable polling-based notification system (no SSE - works through any CDN/proxy)
// Features: Claude CLI completion notifications with red badge

(function() {
    'use strict';

    // Deduplication guard - prevent double initialization from static + dynamic injection
    if (window.__vscodeFaviconInjected) {
        console.log('VS Code Favicon Extension: Already initialized, skipping duplicate injection');
        return;
    }
    window.__vscodeFaviconInjected = true;

    console.log('VS Code Favicon Extension v6.1.3: Starting');

    // Configuration
    const CONFIG = {
        API_BASE: null,  // Will be fetched from background
        API_TIMEOUT: 5000,
        TERMINAL_UPDATE_THROTTLE: 500,
    };

    const VSCODE_ORIGIN = window.location.origin;

    // Use normalizeFolder from path-utils.js module
    const { normalizeFolder } = window.PathUtils;

    // Track extension context validity
    let extensionContextValid = true;

    // Track initialization state for early paste detection
    let extensionFullyInitialized = false;
    let earlyPasteToast = null;

    /**
     * Show early paste detection toast
     */
    function showEarlyPasteWarning() {
        // Avoid showing duplicate toasts
        if (earlyPasteToast) return;

        // Create toast element
        earlyPasteToast = document.createElement('div');
        earlyPasteToast.className = 'vscode-favicon-upload-toast vscode-favicon-upload-toast-warning';
        earlyPasteToast.textContent = 'Extension not fully loaded. Try refreshing the page.';
        earlyPasteToast.style.cssText = `
            position: fixed;
            bottom: 16px;
            right: 16px;
            padding: 12px 16px;
            background: #252526;
            border: 1px solid #f39c12;
            border-radius: 6px;
            color: #cccccc;
            font-size: 12px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            z-index: 999997;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            max-width: 300px;
            word-break: break-all;
        `;

        document.body.appendChild(earlyPasteToast);

        setTimeout(() => {
            if (earlyPasteToast) {
                earlyPasteToast.style.opacity = '0';
                earlyPasteToast.style.transition = 'opacity 0.3s';
                setTimeout(() => {
                    if (earlyPasteToast) {
                        earlyPasteToast.remove();
                        earlyPasteToast = null;
                    }
                }, 300);
            }
        }, 5000);

        earlyPasteToast.addEventListener('click', () => {
            if (earlyPasteToast) {
                earlyPasteToast.remove();
                earlyPasteToast = null;
            }
        });
    }

    /**
     * Early paste event detector - catches paste attempts before extension is fully initialized
     */
    function setupEarlyPasteDetection() {
        window.addEventListener('paste', (e) => {
            if (extensionFullyInitialized) return;

            // Check if there's a file in the clipboard
            const items = e.clipboardData?.items;
            if (!items) return;

            for (const item of items) {
                if (item.kind === 'file') {
                    console.log('VS Code Favicon: Early paste detected before initialization');
                    showEarlyPasteWarning();
                    return;
                }
            }
        }, true);
    }

    // Set up early paste detection immediately
    setupEarlyPasteDetection();

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
                console.log('VS Code Favicon: API_BASE configured:', CONFIG.API_BASE);
                resolve();
            });
            setTimeout(() => {
                if (!CONFIG.API_BASE) {
                    CONFIG.API_BASE = 'https://favicon-api.noreika.lt';
                    console.log('VS Code Favicon: API_BASE fallback used:', CONFIG.API_BASE);
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
    let isTabFocused = document.hasFocus();

    /**
     * Auto-dismiss notification and update favicon
     * @param {string} reason - Reason for dismissal (for logging)
     */
    function autoDismissNotification(reason) {
        if (!notificationStatus) return;
        console.log(`VS Code Favicon: Auto-dismiss (${reason})`);
        safeSendMessage({ type: 'MARK_READ', folder: folder });
        notificationStatus = null;
        faviconUpdater.updateFavicon();
    }

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

            if (!terminalOpen) {
                autoDismissNotification('terminal closed');
            }

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

        if (message.type === 'TAB_FOCUS_CHANGED') {
            isTabFocused = message.isFocused;
            if (isTabFocused) {
                autoDismissNotification('tab focused');
            }
            return;
        }

        if (message.type === 'NOTIFICATIONS_UPDATE') {
            // Filter out notifications for this project if tab is focused
            const thisFolder = normalizeFolder(folder);
            const filteredNotifications = message.notifications.filter(n => {
                if (isTabFocused && normalizeFolder(n.folder) === thisFolder) {
                    safeSendMessage({ type: 'MARK_READ', folder: n.folder });
                    return false;
                }
                return true;
            });

            notificationPanel.updateNotifications(filteredNotifications);
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

        console.log('VS Code Favicon: Initialized successfully');
        console.log('  - Clipboard paste: Ready (Ctrl+V / Ctrl+Shift+V in terminal)');
        console.log('  - Notifications: Connected via background worker');
        console.log('  - Terminal detection: Active');

        // Mark extension as fully initialized
        extensionFullyInitialized = true;

        requestNotifications();

        document.addEventListener('visibilitychange', async () => {
            isTabFocused = !document.hidden;
            if (isTabFocused) {
                autoDismissNotification('tab visible');
                await updateNotificationStatus();
                requestNotifications();
            }
        });

        window.addEventListener('focus', () => {
            isTabFocused = true;
            autoDismissNotification('window focus');
            requestNotifications();
        });

        window.addEventListener('blur', () => {
            isTabFocused = false;
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
