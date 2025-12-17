/**
 * Notification panel module
 * Handles floating notifications panel UI and mini badge
 */

/**
 * Create notification panel
 * @param {object} deps - Dependencies
 * @param {Function} deps.sendMessage - Function to send messages to background
 * @param {Function} deps.loadBadgePosition - Load badge position from storage
 * @param {Function} deps.saveBadgePosition - Save badge position to storage
 * @param {Function} deps.applyBadgePosition - Apply position to badge element
 * @param {Function} deps.setupBadgeDrag - Setup drag functionality
 * @returns {object} - Notification panel instance
 */
function createNotificationPanel(deps) {
    const {
        sendMessage,
        loadBadgePosition,
        saveBadgePosition,
        applyBadgePosition,
        setupBadgeDrag,
    } = deps;

    let allNotifications = [];
    let panelElement = null;
    let badgeElement = null;
    let panelMinimized = false;
    let panelDismissHandlers = null;

    /**
     * Create panel styles
     */
    function createPanelStyles() {
        if (document.getElementById('vscode-favicon-panel-styles')) return;

        const style = document.createElement('style');
        style.id = 'vscode-favicon-panel-styles';
        style.textContent = `
            .vscode-favicon-mini-badge {
                position: fixed;
                top: 16px;
                right: 16px;
                width: 48px;
                height: 48px;
                background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: grab;
                z-index: 999998;
                box-shadow: 0 4px 12px rgba(76, 175, 80, 0.4);
                transition: transform 0.2s, box-shadow 0.2s;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                user-select: none;
                touch-action: none;
            }
            .vscode-favicon-mini-badge:hover {
                transform: scale(1.1);
                box-shadow: 0 6px 16px rgba(76, 175, 80, 0.5);
            }
            .vscode-favicon-mini-badge.dragging {
                cursor: grabbing;
                transform: scale(1.15);
                box-shadow: 0 8px 24px rgba(76, 175, 80, 0.6);
                transition: none;
            }
            .vscode-favicon-mini-badge-count {
                color: white;
                font-size: 18px;
                font-weight: 700;
            }
            @keyframes badgePulse {
                0%, 100% { box-shadow: 0 4px 12px rgba(76, 175, 80, 0.4); }
                50% { box-shadow: 0 4px 20px rgba(76, 175, 80, 0.7); }
            }
            .vscode-favicon-mini-badge.pulse {
                animation: badgePulse 2s ease-in-out infinite;
            }
            .vscode-favicon-panel {
                position: fixed;
                top: 16px;
                right: 16px;
                width: 360px;
                max-height: 400px;
                background: #1e1e1e;
                border: 1px solid #3c3c3c;
                border-radius: 8px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
                z-index: 999999;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                overflow: hidden;
                transform: translateX(120%);
                transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }
            .vscode-favicon-panel.visible {
                transform: translateX(0);
            }
            .vscode-favicon-panel-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 12px 14px;
                background: #252526;
                border-bottom: 1px solid #3c3c3c;
            }
            .vscode-favicon-panel-title {
                font-size: 13px;
                font-weight: 600;
                color: #cccccc;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .vscode-favicon-panel-badge {
                background: #4CAF50;
                color: white;
                font-size: 11px;
                padding: 2px 6px;
                border-radius: 10px;
                font-weight: 500;
            }
            .vscode-favicon-panel-actions {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .vscode-favicon-panel-clear-all {
                padding: 4px 8px;
                border: none;
                background: rgba(255, 255, 255, 0.1);
                color: #888;
                border-radius: 4px;
                cursor: pointer;
                font-size: 11px;
                transition: background 0.2s, color 0.2s;
            }
            .vscode-favicon-panel-clear-all:hover {
                background: #e74c3c;
                color: #fff;
            }
            .vscode-favicon-panel-close {
                width: 24px;
                height: 24px;
                border: none;
                background: transparent;
                color: #888;
                border-radius: 4px;
                cursor: pointer;
                font-size: 16px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: background 0.2s, color 0.2s;
            }
            .vscode-favicon-panel-close:hover {
                background: rgba(255, 255, 255, 0.1);
                color: #fff;
            }
            .vscode-favicon-panel-list {
                max-height: 340px;
                overflow-y: auto;
            }
            .vscode-favicon-panel-item {
                display: flex;
                align-items: flex-start;
                gap: 12px;
                padding: 12px 14px;
                border-bottom: 1px solid #2d2d2d;
                cursor: pointer;
                transition: background 0.15s;
            }
            .vscode-favicon-panel-item:hover {
                background: #2a2d2e;
            }
            .vscode-favicon-panel-item:last-child {
                border-bottom: none;
            }
            .vscode-favicon-panel-item-icon {
                width: 32px;
                height: 32px;
                background: #4CAF50;
                border-radius: 6px;
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-size: 16px;
                flex-shrink: 0;
            }
            .vscode-favicon-panel-item-content {
                flex: 1;
                min-width: 0;
            }
            .vscode-favicon-panel-item-project {
                font-size: 13px;
                font-weight: 600;
                color: #e0e0e0;
                margin-bottom: 4px;
            }
            .vscode-favicon-panel-item-message {
                font-size: 12px;
                color: #888;
                line-height: 1.4;
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
                overflow: hidden;
            }
            .vscode-favicon-panel-item-time {
                font-size: 10px;
                color: #666;
                margin-top: 4px;
            }
            .vscode-favicon-panel-item-dismiss {
                width: 20px;
                height: 20px;
                border: none;
                background: transparent;
                color: #666;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 0;
                transition: opacity 0.15s, background 0.15s, color 0.15s;
                flex-shrink: 0;
            }
            .vscode-favicon-panel-item:hover .vscode-favicon-panel-item-dismiss {
                opacity: 1;
            }
            .vscode-favicon-panel-item-dismiss:hover {
                background: rgba(255, 255, 255, 0.1);
                color: #fff;
            }
            .vscode-favicon-panel-empty {
                padding: 24px;
                text-align: center;
                color: #666;
                font-size: 13px;
            }
            .vscode-favicon-panel-hint {
                padding: 8px 14px;
                background: #252526;
                border-top: 1px solid #3c3c3c;
                font-size: 10px;
                color: #666;
                text-align: center;
            }
            .vscode-favicon-upload-toast {
                position: fixed;
                bottom: 16px;
                right: 16px;
                padding: 12px 16px;
                background: #252526;
                border: 1px solid #3c3c3c;
                border-radius: 6px;
                color: #cccccc;
                font-size: 12px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                z-index: 999997;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                transition: opacity 0.3s;
                max-width: 300px;
                word-break: break-all;
            }
            .vscode-favicon-upload-toast-success {
                border-color: #4CAF50;
            }
            .vscode-favicon-upload-toast-error {
                border-color: #e74c3c;
            }
            .vscode-favicon-upload-toast-warning {
                border-color: #f39c12;
            }
            .vscode-favicon-upload-toast.fade-out {
                opacity: 0;
            }
        `;
        document.head.appendChild(style);
    }


    /**
     * Create notification item element using shared DOM utilities
     * @param {object} notification - Notification object
     * @param {number} index - Item index
     * @returns {HTMLElement} - Notification item element
     */
    function createNotificationItem(notification, index) {
        return window.DomUtils.createNotificationItem(notification, {
            index,
            formatTimeAgo: window.TimeUtils.formatTimeAgo,
        });
    }

    /**
     * Cleanup panel dismiss handlers
     */
    function cleanupPanelDismissHandlers() {
        if (panelDismissHandlers) {
            document.removeEventListener('click', panelDismissHandlers.clickOutside, true);
            document.removeEventListener('keydown', panelDismissHandlers.keydown, true);
            panelDismissHandlers = null;
        }
    }

    /**
     * Setup panel dismiss handlers
     */
    function setupPanelDismissHandlers() {
        cleanupPanelDismissHandlers();

        const clickOutsideHandler = (e) => {
            if (!panelElement) return;
            if (!panelElement.contains(e.target)) {
                console.log('Notification Panel: Click outside panel - closing');
                hidePanel();
            }
        };

        const keydownHandler = (e) => {
            if (!panelElement) return;
            if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
            console.log('Notification Panel: Keydown detected - closing panel');
            hidePanel();
        };

        setTimeout(() => {
            document.addEventListener('click', clickOutsideHandler, true);
            document.addEventListener('keydown', keydownHandler, true);
        }, 100);

        panelDismissHandlers = {
            clickOutside: clickOutsideHandler,
            keydown: keydownHandler
        };
    }

    /**
     * Hide panel
     */
    function hidePanel() {
        panelMinimized = true;
        cleanupPanelDismissHandlers();
        if (panelElement) {
            panelElement.classList.remove('visible');
            setTimeout(() => {
                if (panelElement && panelElement.parentNode) {
                    panelElement.parentNode.removeChild(panelElement);
                }
                panelElement = null;
                if (allNotifications.length > 0) {
                    showBadge();
                }
            }, 300);
        }
    }

    /**
     * Render panel
     */
    function renderPanel() {
        createPanelStyles();

        if (panelElement) {
            panelElement.remove();
            panelElement = null;
        }

        if (allNotifications.length === 0) {
            return;
        }

        panelElement = document.createElement('div');
        panelElement.className = 'vscode-favicon-panel';

        const header = document.createElement('div');
        header.className = 'vscode-favicon-panel-header';

        const titleContainer = document.createElement('div');
        titleContainer.className = 'vscode-favicon-panel-title';

        const titleText = window.DomUtils.createElementWithText('span', 'Claude Notifications', null);
        titleContainer.appendChild(titleText);

        const badge = window.DomUtils.createElementWithText('span', allNotifications.length, 'vscode-favicon-panel-badge');
        titleContainer.appendChild(badge);

        header.appendChild(titleContainer);

        const actions = document.createElement('div');
        actions.className = 'vscode-favicon-panel-actions';

        const clearAllBtn = window.DomUtils.createElementWithText('button', 'Clear all', 'vscode-favicon-panel-clear-all');
        clearAllBtn.setAttribute('title', 'Clear all');
        actions.appendChild(clearAllBtn);

        const closeBtn = window.DomUtils.createElementWithText('button', '−', 'vscode-favicon-panel-close');
        closeBtn.setAttribute('title', 'Minimize');
        actions.appendChild(closeBtn);

        header.appendChild(actions);
        panelElement.appendChild(header);

        const list = document.createElement('div');
        list.className = 'vscode-favicon-panel-list';

        allNotifications.forEach((notification, index) => {
            const item = createNotificationItem(notification, index);
            list.appendChild(item);
        });

        panelElement.appendChild(list);

        const hint = window.DomUtils.createElementWithText('div', 'Click to open project • × to dismiss', 'vscode-favicon-panel-hint');
        panelElement.appendChild(hint);

        document.body.appendChild(panelElement);

        requestAnimationFrame(() => {
            panelElement.classList.add('visible');
        });

        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            hidePanel();
        });

        clearAllBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log('Notification Panel: Clearing all notifications');
            sendMessage({ type: 'MARK_ALL_READ' });
            hidePanel();
        });

        list.querySelectorAll('.vscode-favicon-panel-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target && e.target.classList && e.target.classList.contains('vscode-favicon-panel-item-dismiss')) return;

                const itemFolder = item.getAttribute('data-folder');
                console.log('Notification Panel: Clicking notification for:', itemFolder);

                sendMessage({
                    type: 'MARK_READ',
                    folder: itemFolder,
                });

                sendMessage({
                    type: 'SWITCH_TO_TAB',
                    folder: itemFolder,
                }, (response) => {
                    console.log('Notification Panel: Switch tab response:', response);
                    if (!response || !response.success) {
                        console.warn('Notification Panel: Tab not found for folder:', itemFolder);
                    }
                });

                hidePanel();
            });
        });

        list.querySelectorAll('.vscode-favicon-panel-item-dismiss').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const itemFolder = btn.getAttribute('data-folder');
                console.log('Notification Panel: Dismissing notification:', itemFolder);

                sendMessage({
                    type: 'MARK_READ',
                    folder: itemFolder,
                });

                hidePanel();
            });
        });

        console.log('Notification Panel: Panel rendered with', allNotifications.length, 'notifications');

        setupPanelDismissHandlers();
    }

    /**
     * Hide badge
     */
    function hideBadge() {
        if (badgeElement && badgeElement.parentNode) {
            badgeElement.parentNode.removeChild(badgeElement);
        }
        badgeElement = null;
    }

    /**
     * Show badge
     */
    function showBadge() {
        createPanelStyles();

        if (allNotifications.length === 0) {
            hideBadge();
            return;
        }

        if (badgeElement && badgeElement.parentNode) {
            const countSpan = badgeElement.querySelector('.vscode-favicon-mini-badge-count');
            if (countSpan) {
                const currentCount = parseInt(countSpan.textContent, 10);
                if (currentCount !== allNotifications.length) {
                    countSpan.textContent = allNotifications.length;
                    badgeElement.setAttribute('title', `${allNotifications.length} notification${allNotifications.length > 1 ? 's' : ''} - Hover to open • Drag to move`);
                    console.log('Notification Panel: Badge updated to', allNotifications.length, 'notifications');
                }
                return;
            }
        }

        hideBadge();

        badgeElement = document.createElement('div');
        badgeElement.className = 'vscode-favicon-mini-badge pulse';

        const countSpan = window.DomUtils.createElementWithText('span', allNotifications.length, 'vscode-favicon-mini-badge-count');
        badgeElement.appendChild(countSpan);

        badgeElement.setAttribute('title', `${allNotifications.length} notification${allNotifications.length > 1 ? 's' : ''} - Hover to open • Drag to move`);

        document.body.appendChild(badgeElement);

        loadBadgePosition((savedPosition) => {
            if (savedPosition) {
                applyBadgePosition(badgeElement, savedPosition.x, savedPosition.y);
            }
            setupBadgeDrag(badgeElement);
        });

        badgeElement.addEventListener('mouseenter', () => {
            if (badgeElement.classList.contains('dragging')) return;

            panelMinimized = false;
            hideBadge();
            renderPanel();
        });

        console.log('Notification Panel: Badge created with', allNotifications.length, 'notifications');
    }

    /**
     * Update notifications
     * @param {Array} notifications - New notifications array
     */
    function updateNotifications(notifications) {
        allNotifications = notifications || [];

        if (allNotifications.length === 0) {
            hidePanel();
            hideBadge();
            panelMinimized = false;
        } else {
            if (panelElement && panelElement.classList.contains('visible')) {
                renderPanel();
            } else {
                showBadge();
            }
        }
    }

    /**
     * Show panel (forced)
     */
    function showPanel() {
        panelMinimized = false;
        hideBadge();
        if (allNotifications.length > 0) {
            renderPanel();
        }
    }

    /**
     * Show toast notification
     * @param {string} message - Toast message
     * @param {string} type - Toast type (info, success, error, warning)
     */
    function showUploadToast(message, type = 'info') {
        const existing = document.querySelector('.vscode-favicon-upload-toast');
        if (existing) existing.remove();

        createPanelStyles();

        const toast = document.createElement('div');
        toast.className = `vscode-favicon-upload-toast vscode-favicon-upload-toast-${type}`;
        toast.textContent = message;

        document.body.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 300);
        }, 3000);

        toast.addEventListener('click', () => toast.remove());
    }

    return {
        updateNotifications,
        showPanel,
        showUploadToast,
    };
}

// Export for both Node.js and browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createNotificationPanel };
} else if (typeof window !== 'undefined') {
    window.NotificationPanel = { createNotificationPanel };
}
