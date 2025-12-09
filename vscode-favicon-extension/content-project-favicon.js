// VS Code Server Dynamic Favicon Extension v2.0
// Reliable polling-based notification system (no SSE - works through any CDN/proxy)
// Features: Claude CLI completion notifications with red badge

(function() {
    'use strict';

    console.log('VS Code Favicon Extension v2.0: Starting');

    // Configuration
    const CONFIG = {
        API_BASE: 'https://favicon-api.noreika.lt',
        POLL_ACTIVE: 5000,      // 5 seconds when tab is active
        POLL_INACTIVE: 30000,   // 30 seconds when tab is inactive
        POLL_ERROR: 60000,      // 60 seconds after error (backoff)
        API_TIMEOUT: 5000,      // 5 second timeout for API calls
        MAX_ERRORS: 5,          // Max consecutive errors before longer backoff
        TERMINAL_UPDATE_THROTTLE: 500, // Terminal state check throttle (ms)
    };

    // Terminal detection selectors
    const TERMINAL_SELECTORS = [
        '.terminal-wrapper',
        '.xterm',
        '.xterm-viewport',
        '.panel .terminal',
        '.part.panel .terminal-outer-container',
        '[id*="workbench.panel.terminal"]'
    ];

    // Extract project folder from URL
    const urlParams = new URLSearchParams(window.location.search);
    let folder = urlParams.get('folder');

    if (!folder) {
        console.log('VS Code Favicon: No folder parameter found');
        return;
    }

    // Remove trailing slash if present
    folder = folder.replace(/\/+$/, '');

    const projectName = folder.split('/').pop() || folder;
    console.log('VS Code Favicon: Project:', projectName);

    // State
    let notificationStatus = null; // null, 'working', or 'completed' (for THIS project's favicon)
    let pollTimer = null;
    let consecutiveErrors = 0;
    let currentFaviconUrl = null;
    let terminalOpen = false;
    let terminalObserver = null;
    let terminalUpdateTimeout = null;

    // ==========================================================================
    // TERMINAL DETECTION
    // ==========================================================================

    function isElementVisible(element) {
        if (!element) return false;

        // Check computed style
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return false;
        }

        // Check bounding rect - element must have dimensions
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            return false;
        }

        return true;
    }

    function hasOpenTerminal() {
        for (const selector of TERMINAL_SELECTORS) {
            const elements = document.querySelectorAll(selector);
            for (const element of elements) {
                if (isElementVisible(element)) {
                    return true;
                }
            }
        }
        return false;
    }

    function checkTerminalState() {
        const currentTerminalState = hasOpenTerminal();

        if (currentTerminalState !== terminalOpen) {
            terminalOpen = currentTerminalState;
            console.log(`VS Code Favicon: Terminal ${terminalOpen ? 'OPENED' : 'CLOSED'}`);

            // Update favicon immediately on state change
            updateFavicon();
        }
    }

    function setupTerminalObserver() {
        // Cleanup existing observer
        if (terminalObserver) {
            terminalObserver.disconnect();
            terminalObserver = null;
        }

        // Wait for panel element or use body
        const targetElement = document.querySelector('.part.panel') || document.body;

        terminalObserver = new MutationObserver(() => {
            // Throttle updates - max once per 500ms
            if (terminalUpdateTimeout) {
                clearTimeout(terminalUpdateTimeout);
            }

            terminalUpdateTimeout = setTimeout(() => {
                checkTerminalState();
                terminalUpdateTimeout = null;
            }, CONFIG.TERMINAL_UPDATE_THROTTLE);
        });

        // Observe DOM changes
        terminalObserver.observe(targetElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style', 'class']
        });

        // Initial check
        checkTerminalState();

        console.log('VS Code Favicon: Terminal observer initialized');
    }

    // ==========================================================================
    // FLOATING NOTIFICATIONS PANEL (all projects)
    // ==========================================================================

    let allNotifications = []; // All notifications from all projects
    let panelElement = null;
    let badgeElement = null;
    let panelMinimized = false;

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
                cursor: pointer;
                z-index: 999998;
                box-shadow: 0 4px 12px rgba(76, 175, 80, 0.4);
                transition: transform 0.2s, box-shadow 0.2s;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            }
            .vscode-favicon-mini-badge:hover {
                transform: scale(1.1);
                box-shadow: 0 6px 16px rgba(76, 175, 80, 0.5);
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
        `;
        document.head.appendChild(style);
    }

    function formatTimeAgo(timestamp) {
        const seconds = Math.floor((Date.now() - timestamp) / 1000);
        if (seconds < 60) return 'just now';
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        return `${Math.floor(hours / 24)}d ago`;
    }

    // Security: Safe DOM element creation helper
    function createElementWithText(tag, className, text) {
        const element = document.createElement(tag);
        if (className) {
            element.className = className;
        }
        if (text !== undefined && text !== null) {
            element.textContent = String(text);
        }
        return element;
    }

    // Security: Create notification item with safe DOM manipulation (no innerHTML)
    function createNotificationItem(notification, index) {
        const item = document.createElement('div');
        item.className = 'vscode-favicon-panel-item';
        item.setAttribute('data-folder', notification.folder);
        item.setAttribute('data-index', String(index));

        // Icon
        const icon = createElementWithText('div', 'vscode-favicon-panel-item-icon', '✓');
        item.appendChild(icon);

        // Content container
        const content = document.createElement('div');
        content.className = 'vscode-favicon-panel-item-content';

        // Project name (safe - uses textContent)
        const projectNameEl = createElementWithText(
            'div',
            'vscode-favicon-panel-item-project',
            notification.projectName
        );
        content.appendChild(projectNameEl);

        // Message (safe - uses textContent)
        const messageEl = createElementWithText(
            'div',
            'vscode-favicon-panel-item-message',
            notification.message || 'Task completed'
        );
        content.appendChild(messageEl);

        // Time (safe - formatTimeAgo returns string)
        const timeEl = createElementWithText(
            'div',
            'vscode-favicon-panel-item-time',
            formatTimeAgo(notification.timestamp)
        );
        content.appendChild(timeEl);

        item.appendChild(content);

        // Dismiss button (safe - uses textContent)
        const dismissBtn = createElementWithText('button', 'vscode-favicon-panel-item-dismiss', '×');
        dismissBtn.setAttribute('data-folder', notification.folder);
        dismissBtn.setAttribute('title', 'Dismiss');
        item.appendChild(dismissBtn);

        return item;
    }

    function renderPanel() {
        createPanelStyles();

        // Remove existing panel
        if (panelElement) {
            panelElement.remove();
            panelElement = null;
        }

        // Don't show panel if no notifications
        if (allNotifications.length === 0) {
            return;
        }

        panelElement = document.createElement('div');
        panelElement.className = 'vscode-favicon-panel';

        // Create header
        const header = document.createElement('div');
        header.className = 'vscode-favicon-panel-header';

        const titleContainer = document.createElement('div');
        titleContainer.className = 'vscode-favicon-panel-title';

        const titleText = createElementWithText('span', null, 'Claude Notifications');
        titleContainer.appendChild(titleText);

        // Badge count (safe - number)
        const badge = createElementWithText('span', 'vscode-favicon-panel-badge', allNotifications.length);
        titleContainer.appendChild(badge);

        header.appendChild(titleContainer);

        // Actions container
        const actions = document.createElement('div');
        actions.className = 'vscode-favicon-panel-actions';

        const clearAllBtn = createElementWithText('button', 'vscode-favicon-panel-clear-all', 'Clear all');
        clearAllBtn.setAttribute('title', 'Clear all');
        actions.appendChild(clearAllBtn);

        const closeBtn = createElementWithText('button', 'vscode-favicon-panel-close', '−');
        closeBtn.setAttribute('title', 'Minimize');
        actions.appendChild(closeBtn);

        header.appendChild(actions);
        panelElement.appendChild(header);

        // Create list container
        const list = document.createElement('div');
        list.className = 'vscode-favicon-panel-list';

        // Add notification items (safe - uses createElement)
        allNotifications.forEach((notification, index) => {
            const item = createNotificationItem(notification, index);
            list.appendChild(item);
        });

        panelElement.appendChild(list);

        // Create hint footer
        const hint = createElementWithText('div', 'vscode-favicon-panel-hint', 'Click to open project • × to dismiss');
        panelElement.appendChild(hint);

        document.body.appendChild(panelElement);

        // Animate in
        requestAnimationFrame(() => {
            panelElement.classList.add('visible');
        });

        // Event: Close/minimize panel
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            hidePanel();
        });

        // Event: Clear all notifications
        clearAllBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log('VS Code Favicon: Clearing all notifications');
            chrome.runtime.sendMessage({ type: 'MARK_ALL_READ' });
        });

        // Event: Click on notification item → switch to that tab
        list.querySelectorAll('.vscode-favicon-panel-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.classList.contains('vscode-favicon-panel-item-dismiss')) return;

                const itemFolder = item.getAttribute('data-folder');
                console.log('VS Code Favicon: Switching to tab:', itemFolder);

                // Send message to background to switch tab
                chrome.runtime.sendMessage({
                    type: 'SWITCH_TO_TAB',
                    folder: itemFolder,
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error('VS Code Favicon: Switch tab error:', chrome.runtime.lastError);
                        return;
                    }
                    console.log('VS Code Favicon: Switch tab response:', response);
                    if (response && response.success) {
                        // Mark as read after switching
                        chrome.runtime.sendMessage({
                            type: 'MARK_READ',
                            folder: itemFolder,
                        });
                    } else {
                        console.warn('VS Code Favicon: Tab not found for folder:', itemFolder);
                    }
                });
            });
        });

        // Event: Dismiss button → just mark as read
        list.querySelectorAll('.vscode-favicon-panel-item-dismiss').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const itemFolder = btn.getAttribute('data-folder');
                console.log('VS Code Favicon: Dismissing notification:', itemFolder);

                chrome.runtime.sendMessage({
                    type: 'MARK_READ',
                    folder: itemFolder,
                });
            });
        });

        console.log('VS Code Favicon: Panel rendered with', allNotifications.length, 'notifications');
    }

    function hidePanel() {
        panelMinimized = true;
        if (panelElement) {
            panelElement.classList.remove('visible');
            setTimeout(() => {
                if (panelElement && panelElement.parentNode) {
                    panelElement.parentNode.removeChild(panelElement);
                }
                panelElement = null;
                // Show mini badge when panel is hidden
                if (allNotifications.length > 0) {
                    showBadge();
                }
            }, 300);
        }
    }

    function showBadge() {
        createPanelStyles();
        hideBadge(); // Remove existing

        if (allNotifications.length === 0) return;

        badgeElement = document.createElement('div');
        badgeElement.className = 'vscode-favicon-mini-badge pulse';

        // Security: Safe badge rendering with textContent
        const countSpan = createElementWithText('span', 'vscode-favicon-mini-badge-count', allNotifications.length);
        badgeElement.appendChild(countSpan);

        badgeElement.setAttribute('title', `${allNotifications.length} notification${allNotifications.length > 1 ? 's' : ''} - Click to open`);

        document.body.appendChild(badgeElement);

        // Click to open panel
        badgeElement.addEventListener('click', () => {
            panelMinimized = false;
            hideBadge();
            renderPanel();
        });

        console.log('VS Code Favicon: Badge shown with', allNotifications.length, 'notifications');
    }

    function hideBadge() {
        if (badgeElement && badgeElement.parentNode) {
            badgeElement.parentNode.removeChild(badgeElement);
        }
        badgeElement = null;
    }

    function updateNotifications(notifications) {
        allNotifications = notifications || [];

        if (allNotifications.length === 0) {
            // No notifications - hide everything
            hidePanel();
            hideBadge();
            panelMinimized = false;
        } else {
            // Show badge by default, only update panel if already visible
            if (panelElement && panelElement.classList.contains('visible')) {
                // Panel is already open - update its content
                renderPanel();
            } else {
                // Show badge only - user clicks to open panel
                showBadge();
            }
        }
    }

    // Listen for messages from background worker
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log('VS Code Favicon: Message received:', message.type);

        if (message.type === 'NOTIFICATIONS_UPDATE') {
            console.log('VS Code Favicon: Received notifications update:', message.notifications.length);
            updateNotifications(message.notifications);
            return;
        }

        if (message.type === 'SHOW_PANEL') {
            console.log('VS Code Favicon: Show panel requested');
            panelMinimized = false;
            hideBadge();
            // Force render panel immediately
            if (allNotifications.length > 0) {
                renderPanel();
            } else {
                requestNotifications();
            }
            sendResponse({ success: true });
            return true; // Keep channel open
        }
    });

    // Request initial notifications from background
    function requestNotifications() {
        chrome.runtime.sendMessage({ type: 'GET_NOTIFICATIONS' }, (response) => {
            if (response && response.notifications) {
                updateNotifications(response.notifications);
            }
        });
    }

    // ==========================================================================
    // FAVICON MANAGEMENT
    // ==========================================================================

    async function fetchFavicon() {
        // Add grayscale parameter if terminal is closed
        const needsGrayscale = !terminalOpen;
        const grayscaleParam = needsGrayscale ? '&grayscale=true' : '';
        const url = `${CONFIG.API_BASE}/favicon-api?folder=${encodeURIComponent(folder)}${grayscaleParam}`;

        console.log(`VS Code Favicon: Fetching favicon from: ${url}`);

        try {
            const response = await fetch(url, {
                method: 'GET',
                signal: AbortSignal.timeout(CONFIG.API_TIMEOUT)
            });

            console.log(`VS Code Favicon: Response status=${response.status}, type=${response.headers.get('content-type')}`);

            if (response.ok) {
                return url;
            } else {
                console.log('VS Code Favicon: Response not OK:', response.status);
            }
        } catch (error) {
            console.log('VS Code Favicon: API error:', error.message, error);
        }
        return null;
    }

    // Convert hex color to grayscale
    function toGrayscale(hexColor) {
        const hex = hexColor.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);

        // Standard luminance formula
        const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        const grayHex = gray.toString(16).padStart(2, '0');

        return `#${grayHex}${grayHex}${grayHex}`;
    }

    function generateFallbackFavicon() {
        const initials = projectName
            .split(/[-_\s]+/)
            .map(word => word[0])
            .join('')
            .toUpperCase()
            .slice(0, 2) || projectName.slice(0, 2).toUpperCase();

        let bgColor = '#45B7D1';
        if (folder.includes('/opt/prod/')) {
            bgColor = '#FF6B6B';
        } else if (folder.includes('/opt/dev/')) {
            bgColor = '#4ECDC4';
        }

        // Apply grayscale if terminal is closed
        const needsGrayscale = !terminalOpen;
        if (needsGrayscale) {
            const originalColor = bgColor;
            bgColor = toGrayscale(bgColor);
            console.log(`VS Code Favicon: Fallback favicon - converting ${originalColor} → ${bgColor} (terminal closed)`);
        }

        const svg = `<svg width="32" height="32" xmlns="http://www.w3.org/2000/svg">
            <rect width="32" height="32" rx="4" fill="${bgColor}"/>
            <text x="16" y="21" text-anchor="middle" fill="white" font-family="Arial" font-size="14" font-weight="bold">${initials}</text>
        </svg>`;

        return 'data:image/svg+xml;base64,' + btoa(svg);
    }

    // Security: Validate SVG before manipulation
    function isValidSVG(content) {
        const dangerous = [/<script/i, /javascript:/i, /on\w+\s*=/i, /<foreignObject/i, /<iframe/i, /<embed/i, /<object/i];
        return !dangerous.some(p => p.test(content)) && /<svg[^>]*>/i.test(content) && /<\/svg>/i.test(content);
    }

    // Security: Badge types: 'working' (yellow), 'completed' (green)
    // SECURE IMPLEMENTATION: Uses DOMParser instead of regex manipulation
    function addBadgeToSVG(svgContent, badgeType = 'completed') {
        // Security: Validate before parsing
        if (!isValidSVG(svgContent)) {
            console.warn('VS Code Favicon: Invalid SVG content, skipping badge');
            return svgContent;
        }

        const colors = {
            working: '#FFC107',   // Yellow
            completed: '#4CAF50'  // Green
        };
        const fillColor = colors[badgeType] || colors.completed;

        try {
            // Security: Parse SVG using DOMParser (secure DOM-based approach)
            const parser = new DOMParser();
            const doc = parser.parseFromString(svgContent, 'image/svg+xml');
            const svg = doc.documentElement;

            // Security: Check for parse errors
            const parseError = svg.querySelector('parsererror');
            if (parseError) {
                console.warn('VS Code Favicon: SVG parse error, returning original content');
                return svgContent;
            }

            // Security: Create defs element for animation using proper DOM methods
            const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
            // Safe: textContent automatically escapes content
            style.textContent = '@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } } .status-badge { animation: pulse 1.5s ease-in-out infinite; }';
            defs.appendChild(style);

            // Insert defs at the beginning of SVG
            svg.insertBefore(defs, svg.firstChild);

            // Security: Create badge group using DOM methods (no string interpolation)
            const badgeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            badgeGroup.setAttribute('class', 'status-badge');

            // Security: Create badge circle with setAttribute (safe, no string interpolation in markup)
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', '24');
            circle.setAttribute('cy', '8');
            circle.setAttribute('r', '8');
            circle.setAttribute('fill', fillColor); // Safe: fillColor validated from colors object
            circle.setAttribute('stroke', 'white');
            circle.setAttribute('stroke-width', '2');

            badgeGroup.appendChild(circle);
            svg.appendChild(badgeGroup);

            // Security: Serialize back to string using XMLSerializer
            const serializer = new XMLSerializer();
            return serializer.serializeToString(svg);
        } catch (error) {
            console.warn('VS Code Favicon: Error adding badge to SVG:', error.message);
            return svgContent; // Return original on error
        }
    }

    // SECURITY FIX SEC-004: Apply grayscale filter to SVG using secure DOM-based approach
    // Uses DOMParser instead of regex string replacement to prevent potential SVG structure issues
    function applyGrayscaleFilterToSVG(svgContent) {
        // Security: Validate before parsing
        if (!isValidSVG(svgContent)) {
            console.warn('VS Code Favicon: Invalid SVG content, skipping grayscale filter');
            return svgContent;
        }

        try {
            // Security: Parse SVG using DOMParser (secure DOM-based approach)
            const parser = new DOMParser();
            const doc = parser.parseFromString(svgContent, 'image/svg+xml');
            const svg = doc.documentElement;

            // Security: Check for parse errors
            const parseError = svg.querySelector('parsererror');
            if (parseError) {
                console.warn('VS Code Favicon: SVG parse error, returning original content');
                return svgContent;
            }

            // Security: Create defs and filter elements using proper DOM methods
            let defs = svg.querySelector('defs');
            if (!defs) {
                defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
                svg.insertBefore(defs, svg.firstChild);
            }

            // Create grayscale filter
            const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
            filter.setAttribute('id', 'grayscale');

            const colorMatrix = document.createElementNS('http://www.w3.org/2000/svg', 'feColorMatrix');
            colorMatrix.setAttribute('type', 'saturate');
            colorMatrix.setAttribute('values', '0');

            filter.appendChild(colorMatrix);
            defs.appendChild(filter);

            // Wrap SVG content in a group with grayscale filter
            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.setAttribute('filter', 'url(#grayscale)');

            // Move all existing children to the group
            while (svg.firstChild && svg.firstChild !== defs) {
                if (svg.firstChild === defs) {
                    break;
                }
                g.appendChild(svg.firstChild);
            }

            // Move children after defs
            while (svg.childNodes.length > 1) {
                g.appendChild(svg.childNodes[1]);
            }

            svg.appendChild(g);

            // Security: Serialize back to string using XMLSerializer
            const serializer = new XMLSerializer();
            return serializer.serializeToString(svg);
        } catch (error) {
            console.warn('VS Code Favicon: Error applying grayscale filter to SVG:', error.message);
            return svgContent; // Return original on error
        }
    }

    // Process PNG/ICO: apply grayscale and/or badge
    // badgeType: null (no badge), 'working' (yellow), 'completed' (green)
    async function processPNG(blob, applyGrayscale, badgeType = null) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = 32;
                canvas.height = 32;
                const ctx = canvas.getContext('2d');

                // Apply grayscale filter if terminal is closed
                if (applyGrayscale) {
                    ctx.filter = 'grayscale(100%)';
                }

                ctx.drawImage(img, 0, 0, 32, 32);

                // Reset filter before drawing badge
                ctx.filter = 'none';

                // Add status badge if needed - solid circle, no center dot
                if (badgeType) {
                    const colors = {
                        working: '#FFC107',   // Yellow
                        completed: '#4CAF50'  // Green
                    };
                    const fillColor = colors[badgeType] || colors.completed;

                    // Solid badge circle
                    ctx.beginPath();
                    ctx.arc(24, 8, 8, 0, 2 * Math.PI);
                    ctx.fillStyle = fillColor;
                    ctx.fill();
                    ctx.strokeStyle = 'white';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }

                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = () => resolve(null);
            img.src = URL.createObjectURL(blob);
        });
    }

    function setFavicon(url, isDataUrl = false, mimeType = 'image/svg+xml') {
        document.querySelectorAll("link[rel*='icon']").forEach(link => link.remove());

        const link = document.createElement('link');
        link.rel = 'icon';
        link.type = mimeType;
        link.href = isDataUrl ? url : `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
        document.head.appendChild(link);

        console.log(`VS Code Favicon: Set ${badgeStatus || 'normal'}`);
    }

    // Determine badge type based on state
    // - null: no notification status (grayscale if no terminal, color if terminal)
    // - 'working': Claude is working (yellow badge)
    // - 'completed': Claude finished (green badge)
    function getBadgeType() {
        // Badge comes from API status, not terminal state
        return notificationStatus; // null, 'working', or 'completed'
    }

    // Track current badge status for logging
    let badgeStatus = 'normal';

    async function updateFavicon() {
        const apiFavicon = await fetchFavicon();
        const needsGrayscale = !terminalOpen;
        const badgeType = getBadgeType();

        // Update status for logging
        if (badgeType === 'completed') {
            badgeStatus = 'GREEN badge (completed)';
        } else if (badgeType === 'working') {
            badgeStatus = 'YELLOW badge (working)';
        } else if (!terminalOpen) {
            badgeStatus = 'grayscale (no terminal)';
        } else {
            badgeStatus = 'color (terminal open, idle)';
        }

        console.log(`VS Code Favicon: Updating - ${badgeStatus}`);

        if (apiFavicon) {
            try {
                const response = await fetch(apiFavicon);
                const contentType = response.headers.get('content-type') || 'image/x-icon';

                if (contentType.includes('svg')) {
                    let svgText = await response.text();

                    // SECURITY FIX SEC-004: Apply grayscale filter using DOM-based approach
                    if (needsGrayscale) {
                        svgText = applyGrayscaleFilterToSVG(svgText);
                    }

                    // Add status badge if terminal is open
                    if (badgeType) {
                        svgText = addBadgeToSVG(svgText, badgeType);
                    }

                    setFavicon('data:image/svg+xml;base64,' + btoa(svgText), true, 'image/svg+xml');
                } else {
                    // PNG, ICO, or other image formats - process through canvas
                    const blob = await response.blob();
                    const dataUrl = await processPNG(blob, needsGrayscale, badgeType);
                    if (dataUrl) {
                        setFavicon(dataUrl, true, 'image/png');
                    } else {
                        setFavicon(apiFavicon, false, contentType);
                    }
                }
                currentFaviconUrl = apiFavicon;
            } catch (e) {
                console.log('VS Code Favicon: Fetch error:', e.message);
                setFavicon(apiFavicon, false, 'image/x-icon');
            }
        } else {
            let fallback = generateFallbackFavicon();
            if (badgeType) {
                const svgContent = atob(fallback.split(',')[1]);
                fallback = 'data:image/svg+xml;base64,' + btoa(addBadgeToSVG(svgContent, badgeType));
            }
            setFavicon(fallback, true, 'image/svg+xml');
        }
    }

    function updateTitle() {
        let prefix = `[${projectName}]`;
        if (folder.includes('/opt/prod/')) {
            prefix = `[PROD: ${projectName}]`;
        } else if (folder.includes('/opt/dev/')) {
            prefix = `[DEV: ${projectName}]`;
        }

        if (!document.title.includes(prefix)) {
            document.title = `${prefix} ${document.title}`;
        }
    }

    // ==========================================================================
    // NOTIFICATION POLLING
    // ==========================================================================

    async function checkNotification() {
        // This checks THIS project's notification status (for favicon badge only)
        // The floating panel handles ALL projects via background worker
        const url = `${CONFIG.API_BASE}/claude-status?folder=${encodeURIComponent(folder)}`;

        try {
            const response = await fetch(url, {
                method: 'GET',
                signal: AbortSignal.timeout(CONFIG.API_TIMEOUT)
            });

            if (response.ok) {
                const data = await response.json();
                consecutiveErrors = 0;

                const previousStatus = notificationStatus;

                if (data.hasNotification) {
                    // API returns status: 'working' or 'completed'
                    notificationStatus = data.status || 'completed';
                } else {
                    notificationStatus = null;
                }

                // Status changed - update favicon badge
                if (previousStatus !== notificationStatus) {
                    const statusText = notificationStatus ? notificationStatus.toUpperCase() : 'cleared';
                    console.log(`VS Code Favicon: Status changed to ${statusText}`);
                    await updateFavicon();
                }

                return true;
            }
        } catch (error) {
            consecutiveErrors++;
            console.log(`VS Code Favicon: Poll error (${consecutiveErrors}):`, error.message);
        }

        return false;
    }

    async function markAsRead() {
        // Mark THIS project's notification as read (updates favicon)
        if (!notificationStatus) return;

        try {
            await fetch(`${CONFIG.API_BASE}/claude-status/mark-read`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folder }),
                signal: AbortSignal.timeout(CONFIG.API_TIMEOUT)
            });

            notificationStatus = null;
            console.log('VS Code Favicon: Marked as read');
            await updateFavicon();
        } catch (error) {
            console.log('VS Code Favicon: Mark read error:', error.message);
        }
    }

    function getNextPollInterval() {
        // Long backoff after too many errors
        if (consecutiveErrors >= CONFIG.MAX_ERRORS) {
            return CONFIG.POLL_ERROR * 2;
        }

        // Short backoff after error
        if (consecutiveErrors > 0) {
            return CONFIG.POLL_ERROR;
        }

        // Normal intervals based on tab visibility
        return document.hidden ? CONFIG.POLL_INACTIVE : CONFIG.POLL_ACTIVE;
    }

    function schedulePoll() {
        if (pollTimer) {
            clearTimeout(pollTimer);
        }

        const interval = getNextPollInterval();
        pollTimer = setTimeout(async () => {
            await checkNotification();
            schedulePoll();
        }, interval);
    }

    // ==========================================================================
    // INITIALIZATION
    // ==========================================================================

    async function initialize() {
        // Initial setup
        await updateFavicon();
        updateTitle();

        // Initial notification check
        await checkNotification();

        // Start polling
        schedulePoll();

        // Setup terminal detection
        setupTerminalObserver();

        console.log(`VS Code Favicon: Initialized (poll: ${CONFIG.POLL_ACTIVE/1000}s active, ${CONFIG.POLL_INACTIVE/1000}s inactive)`);

        // Request notifications from background worker (for floating panel)
        requestNotifications();

        // Visibility change - adjust polling and request panel update
        document.addEventListener('visibilitychange', async () => {
            if (!document.hidden) {
                // Tab became visible - check immediately and reset polling
                console.log('VS Code Favicon: Tab visible - checking now');
                await checkNotification();
                schedulePoll();
                requestNotifications(); // Refresh panel
            }
        });

        // Window focus - refresh panel
        window.addEventListener('focus', () => {
            console.log('VS Code Favicon: Window focus');
            requestNotifications();
        });

        // Cleanup on unload
        window.addEventListener('beforeunload', () => {
            if (pollTimer) {
                clearTimeout(pollTimer);
            }
            if (terminalUpdateTimeout) {
                clearTimeout(terminalUpdateTimeout);
            }
            if (terminalObserver) {
                terminalObserver.disconnect();
            }
        });
    }

    // Start
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

})();
