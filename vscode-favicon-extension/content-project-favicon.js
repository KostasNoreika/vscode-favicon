// VS Code Server Dynamic Favicon Extension v2.0
// Reliable polling-based notification system (no SSE - works through any CDN/proxy)
// Features: Claude CLI completion notifications with red badge

(function() {
    'use strict';

    console.log('VS Code Favicon Extension v5.0: Starting (push-based notifications)');

    // Configuration
    const CONFIG = {
        API_BASE: 'https://favicon-api.noreika.lt',
        API_TIMEOUT: 5000,      // 5 second timeout for API calls
        TERMINAL_UPDATE_THROTTLE: 500, // Terminal state check throttle (ms)
        // Note: Notification polling removed in v5.0.0 - now uses push via background worker
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

    // ==========================================================================
    // CLIPBOARD IMAGE PASTE
    // ==========================================================================

    // Check if in terminal area
    function isInTerminalArea() {
        const activeElement = document.activeElement;
        const terminalInput = document.querySelector('.xterm-helper-textarea');
        const inTerminal = terminalInput && (
            activeElement === terminalInput ||
            activeElement?.closest('.xterm') ||
            activeElement?.closest('.terminal-wrapper') ||
            activeElement?.closest('.terminal')
        );
        console.log('VS Code Favicon: Terminal check -', {
            hasTerminalInput: !!terminalInput,
            activeElement: activeElement?.className || activeElement?.tagName,
            inTerminal
        });
        return inTerminal;
    }

    // Read clipboard using Clipboard API
    async function readClipboardImage() {
        try {
            const clipboardItems = await navigator.clipboard.read();
            console.log('VS Code Favicon: Clipboard items:', clipboardItems.length);

            for (const clipboardItem of clipboardItems) {
                console.log('VS Code Favicon: Item types:', clipboardItem.types);

                for (const type of clipboardItem.types) {
                    if (type.startsWith('image/')) {
                        const blob = await clipboardItem.getType(type);
                        console.log('VS Code Favicon: Found image:', type, blob.size, 'bytes');
                        return blob;
                    }
                }
            }
            console.log('VS Code Favicon: No image in clipboard');
            return null;
        } catch (err) {
            console.error('VS Code Favicon: Clipboard read error:', err.message);
            return null;
        }
    }

    // Main keyboard handler - Ctrl+Shift+V to paste image
    // Using window instead of document for broader capture
    window.addEventListener('keydown', async (e) => {
        // Ctrl+Shift+V - paste image shortcut
        if (e.ctrlKey && e.shiftKey && (e.key === 'V' || e.key === 'v')) {
            console.log('VS Code Favicon: *** Ctrl+Shift+V DETECTED ***');

            // Check terminal
            if (!isInTerminalArea()) {
                console.log('VS Code Favicon: Not in terminal area');
                return;
            }

            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            console.log('VS Code Favicon: Reading clipboard...');
            const imageBlob = await readClipboardImage();

            if (imageBlob) {
                await handleImagePaste(imageBlob);
            } else {
                showUploadToast('No image in clipboard', 'error');
            }
        }
    }, true); // Capture phase

    // Also try standard Ctrl+V with clipboard API
    window.addEventListener('keydown', async (e) => {
        // Ctrl+V (without Shift)
        if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && (e.key === 'V' || e.key === 'v')) {
            console.log('VS Code Favicon: Ctrl+V detected');

            if (!isInTerminalArea()) {
                return; // Let VS Code handle non-terminal paste
            }

            // Try to read clipboard for images
            const imageBlob = await readClipboardImage();

            if (imageBlob) {
                console.log('VS Code Favicon: Image found in Ctrl+V, intercepting');
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                await handleImagePaste(imageBlob);
            }
            // If no image, let the event pass through to xterm for text paste
        }
    }, true);

    // Fallback: paste event listener
    window.addEventListener('paste', async (e) => {
        console.log('VS Code Favicon: Paste event received');

        if (!isInTerminalArea()) {
            return;
        }

        const items = e.clipboardData?.items;
        if (!items) return;

        for (const item of items) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                e.stopPropagation();
                console.log('VS Code Favicon: Image in paste event');
                await handleImagePaste(item.getAsFile());
                return;
            }
        }
    }, true);

    // Track last uploaded image to prevent duplicates
    let lastImageHash = null;
    let lastImagePath = null;

    // Calculate simple hash from blob for duplicate detection
    async function hashBlob(blob) {
        const buffer = await blob.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async function handleImagePaste(blob) {
        console.log('VS Code Favicon: Processing image...', blob.type, blob.size);

        // Calculate hash for duplicate detection
        const imageHash = await hashBlob(blob);
        console.log('VS Code Favicon: Image hash:', imageHash.substring(0, 16) + '...');

        // Check if same image was just uploaded
        if (imageHash === lastImageHash && lastImagePath) {
            console.log('VS Code Favicon: Same image, reusing path:', lastImagePath);
            showUploadToast('Image already uploaded', 'success');
            await insertIntoTerminal(lastImagePath);
            return;
        }

        showUploadToast('Uploading image...', 'info');

        const formData = new FormData();
        formData.append('image', blob, `clipboard.${blob.type.split('/')[1]}`);
        formData.append('folder', folder);

        try {
            const response = await fetch(`${CONFIG.API_BASE}/api/paste-image`, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || `HTTP ${response.status}`);
            }

            const data = await response.json();
            const filename = data.filename || data.path;
            console.log('VS Code Favicon: Image saved:', filename);

            // Store for duplicate detection
            const fullPath = `'${folder}/tasks/${filename}'`;
            lastImageHash = imageHash;
            lastImagePath = fullPath;

            showUploadToast(`Saved: ${filename}`, 'success');
            await insertIntoTerminal(fullPath);
        } catch (err) {
            console.error('VS Code Favicon: Image paste failed:', err.message);
            showUploadToast(`Upload failed: ${err.message}`, 'error');
        }
    }

    async function insertIntoTerminal(text) {
        console.log('VS Code Favicon: Inserting into terminal:', text);

        // Focus terminal first
        const terminalInput = document.querySelector('.xterm-helper-textarea');
        if (!terminalInput) {
            console.log('VS Code Favicon: No terminal input found');
            showUploadToast(`Path: ${text}`, 'info');
            return;
        }

        terminalInput.focus();

        // Method 1: Try InputEvent with insertFromPaste (most modern approach)
        try {
            // First, beforeinput event
            const beforeInputEvent = new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertFromPaste',
                data: text
            });
            const beforeResult = terminalInput.dispatchEvent(beforeInputEvent);
            console.log('VS Code Favicon: beforeinput dispatched, prevented:', !beforeResult);

            // Then, input event
            const inputEvent = new InputEvent('input', {
                bubbles: true,
                cancelable: false,
                inputType: 'insertFromPaste',
                data: text
            });
            terminalInput.dispatchEvent(inputEvent);
            console.log('VS Code Favicon: input event dispatched');
        } catch (e) {
            console.log('VS Code Favicon: InputEvent failed:', e.message);
        }

        // Method 2: Try setting value and triggering input
        try {
            const oldValue = terminalInput.value;
            terminalInput.value = text;
            terminalInput.dispatchEvent(new Event('input', { bubbles: true }));
            terminalInput.dispatchEvent(new Event('change', { bubbles: true }));
            console.log('VS Code Favicon: Value set method tried');

            // Reset to allow normal typing
            setTimeout(() => {
                terminalInput.value = oldValue;
            }, 100);
        } catch (e) {
            console.log('VS Code Favicon: Value set failed:', e.message);
        }

        // Method 3: Try ClipboardEvent with DataTransfer
        try {
            const dt = new DataTransfer();
            dt.setData('text/plain', text);
            const clipboardEvent = new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true,
                clipboardData: dt
            });
            terminalInput.dispatchEvent(clipboardEvent);
            console.log('VS Code Favicon: ClipboardEvent dispatched');
        } catch (e) {
            console.log('VS Code Favicon: ClipboardEvent failed:', e.message);
        }

        // Method 4: Try writing to xterm via keyboard simulation for each character
        try {
            for (const char of text) {
                const keyEvent = new KeyboardEvent('keypress', {
                    key: char,
                    charCode: char.charCodeAt(0),
                    keyCode: char.charCodeAt(0),
                    which: char.charCodeAt(0),
                    bubbles: true
                });
                terminalInput.dispatchEvent(keyEvent);
            }
            console.log('VS Code Favicon: Keypress simulation completed');
        } catch (e) {
            console.log('VS Code Favicon: Keypress simulation failed:', e.message);
        }

        // Fallback: Copy to clipboard for manual paste
        try {
            await navigator.clipboard.writeText(text);
            console.log('VS Code Favicon: Text copied to clipboard');
            showUploadToast(`Uploaded! Press Ctrl+V to paste path`, 'success');
        } catch (err) {
            console.error('VS Code Favicon: Clipboard write failed:', err.message);
            showUploadToast(`Path: ${text}`, 'info');
        }
    }

    // State
    let notificationStatus = null; // null, 'working', or 'completed' (for THIS project's favicon)
    // Polling removed in v5.0.0 - notifications now push-based via background worker
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
            .vscode-favicon-upload-toast.fade-out {
                opacity: 0;
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

    function showUploadToast(message, type = 'info') {
        const existing = document.querySelector('.vscode-favicon-upload-toast');
        if (existing) existing.remove();

        createPanelStyles(); // Ensure styles are loaded

        const toast = document.createElement('div');
        toast.className = `vscode-favicon-upload-toast vscode-favicon-upload-toast-${type}`;
        toast.textContent = message;

        document.body.appendChild(toast);

        // Auto-dismiss after 3 seconds
        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 300);
        }, 3000);

        // Click to dismiss immediately
        toast.addEventListener('click', () => toast.remove());
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

        if (allNotifications.length === 0) {
            hideBadge();
            return;
        }

        // If badge already exists, just update the count (don't recreate - prevents animation restart)
        if (badgeElement && badgeElement.parentNode) {
            const countSpan = badgeElement.querySelector('.vscode-favicon-mini-badge-count');
            if (countSpan) {
                const currentCount = parseInt(countSpan.textContent, 10);
                if (currentCount !== allNotifications.length) {
                    countSpan.textContent = allNotifications.length;
                    badgeElement.setAttribute('title', `${allNotifications.length} notification${allNotifications.length > 1 ? 's' : ''} - Click to open`);
                    console.log('VS Code Favicon: Badge updated to', allNotifications.length, 'notifications');
                }
                // If count is same, do nothing (prevents unnecessary updates)
                return;
            }
        }

        // Badge doesn't exist - create new one
        hideBadge(); // Clean up any orphaned elements

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

        console.log('VS Code Favicon: Badge created with', allNotifications.length, 'notifications');
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
            // Also update favicon badge from this broadcast
            updateNotificationStatus();
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
            working: '#FFD700',   // Bright Gold
            completed: '#00E676'  // Bright Green
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
            circle.setAttribute('r', '12');
            circle.setAttribute('fill', fillColor); // Safe: fillColor validated from colors object
            circle.setAttribute('stroke', 'white');
            circle.setAttribute('stroke-width', '3');

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
                        working: '#FFD700',   // Bright Gold
                        completed: '#00E676'  // Bright Green
                    };
                    const fillColor = colors[badgeType] || colors.completed;

                    // Solid badge circle
                    ctx.beginPath();
                    ctx.arc(24, 8, 12, 0, 2 * Math.PI);
                    ctx.fillStyle = fillColor;
                    ctx.fill();
                    ctx.strokeStyle = 'white';
                    ctx.lineWidth = 3;
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
    // NOTIFICATION STATUS (from background worker - no polling!)
    // ==========================================================================

    // Get notification status for THIS folder from background worker
    async function getNotificationStatus() {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage(
                { type: 'GET_NOTIFICATION_STATUS', folder: folder },
                (response) => {
                    if (chrome.runtime.lastError) {
                        console.log('VS Code Favicon: Background worker error:', chrome.runtime.lastError.message);
                        resolve({ hasNotification: false, status: null });
                        return;
                    }
                    resolve(response || { hasNotification: false, status: null });
                }
            );
        });
    }

    // Update notification status from background broadcast
    async function updateNotificationStatus() {
        const response = await getNotificationStatus();
        const previousStatus = notificationStatus;

        if (response.hasNotification) {
            notificationStatus = response.status || 'completed';
        } else {
            notificationStatus = null;
        }

        // Status changed - update favicon badge
        if (previousStatus !== notificationStatus) {
            const statusText = notificationStatus ? notificationStatus.toUpperCase() : 'cleared';
            console.log(`VS Code Favicon: Status changed to ${statusText}`);
            await updateFavicon();
        }
    }

    // ==========================================================================
    // INITIALIZATION
    // ==========================================================================

    async function initialize() {
        // Initial setup
        await updateFavicon();
        updateTitle();

        // Get initial notification status from background worker (no API call!)
        await updateNotificationStatus();

        // Setup terminal detection
        setupTerminalObserver();

        console.log('VS Code Favicon: Initialized (push-based notifications via background worker)');

        // Request notifications from background worker (for floating panel)
        requestNotifications();

        // Visibility change - request update from background (no polling!)
        document.addEventListener('visibilitychange', async () => {
            if (!document.hidden) {
                console.log('VS Code Favicon: Tab visible - requesting update');
                await updateNotificationStatus();
                requestNotifications();
            }
        });

        // Window focus - refresh panel
        window.addEventListener('focus', () => {
            console.log('VS Code Favicon: Window focus');
            requestNotifications();
        });

        // Cleanup on unload
        window.addEventListener('beforeunload', () => {
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
