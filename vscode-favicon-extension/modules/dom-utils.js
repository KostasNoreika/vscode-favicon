/**
 * DOM utility functions
 * Provides XSS-safe DOM element creation using textContent (never innerHTML)
 */

(function() {
    'use strict';

    /**
     * Create DOM element with text content (XSS-safe)
     * @param {string} tag - Element tag name
     * @param {string} text - Text content
     * @param {string} [className] - Optional CSS class name
     * @returns {HTMLElement} - Created element
     */
    function createElementWithText(tag, text, className) {
        const element = document.createElement(tag);
        if (className) {
            element.className = className;
        }
        if (text !== undefined && text !== null) {
            // SECURITY: Always use textContent (never innerHTML) to prevent XSS
            element.textContent = String(text);
        }
        return element;
    }

    /**
     * Create notification item element for panels
     * @param {object} notification - Notification object
     * @param {string} notification.folder - Project folder path
     * @param {string} notification.projectName - Project display name
     * @param {string} [notification.message] - Notification message
     * @param {number} notification.timestamp - Timestamp in milliseconds
     * @param {object} [options] - Optional configuration
     * @param {number} [options.index] - Item index for data attribute
     * @param {Function} [options.formatTimeAgo] - Time formatting function
     * @returns {HTMLElement} - Notification item element
     */
    function createNotificationItem(notification, options = {}) {
        const { index, formatTimeAgo } = options;

        // Create main container
        const item = document.createElement('div');
        item.className = 'vscode-favicon-panel-item';
        item.setAttribute('data-folder', notification.folder);
        if (index !== undefined) {
            item.setAttribute('data-index', String(index));
        }

        // Create icon
        const icon = createElementWithText('div', '✓', 'vscode-favicon-panel-item-icon');
        item.appendChild(icon);

        // Create content container
        const content = document.createElement('div');
        content.className = 'vscode-favicon-panel-item-content';

        // Create project name
        const projectNameEl = createElementWithText(
            'div',
            notification.projectName,
            'vscode-favicon-panel-item-project'
        );
        content.appendChild(projectNameEl);

        // Create message
        const messageEl = createElementWithText(
            'div',
            notification.message || 'Task completed',
            'vscode-favicon-panel-item-message'
        );
        content.appendChild(messageEl);

        // Create time
        let timeText = '';
        if (formatTimeAgo && notification.timestamp) {
            timeText = formatTimeAgo(notification.timestamp);
        } else if (notification.timestamp) {
            timeText = new Date(notification.timestamp).toLocaleString();
        }
        const timeEl = createElementWithText(
            'div',
            timeText,
            'vscode-favicon-panel-item-time'
        );
        content.appendChild(timeEl);

        item.appendChild(content);

        // Create dismiss button
        const dismissBtn = createElementWithText('button', '×', 'vscode-favicon-panel-item-dismiss');
        dismissBtn.setAttribute('data-folder', notification.folder);
        dismissBtn.setAttribute('title', 'Dismiss');
        item.appendChild(dismissBtn);

        return item;
    }

    /**
     * Create notification element for popup
     * Similar to createNotificationItem but uses popup-specific class names
     * @param {object} notification - Notification object
     * @param {string} notification.folder - Project folder path
     * @param {string} notification.projectName - Project display name
     * @param {string} [notification.message] - Notification message
     * @param {number} notification.timestamp - Timestamp in milliseconds
     * @param {Function} [formatTimeAgo] - Time formatting function
     * @returns {HTMLElement} - Notification element
     */
    function createNotificationElement(notification, formatTimeAgo) {
        // Create main container
        const item = document.createElement('div');
        item.className = 'item';
        item.dataset.folder = notification.folder;

        // Create icon
        const icon = createElementWithText('div', '✓', 'item-icon');

        // Create content container
        const content = document.createElement('div');
        content.className = 'item-content';

        // Create project name
        const projectName = createElementWithText('div', notification.projectName, 'item-project');
        content.appendChild(projectName);

        // Create message
        const message = createElementWithText('div', notification.message || 'Task completed', 'item-message');
        content.appendChild(message);

        // Create time
        let timeText = '';
        if (formatTimeAgo && notification.timestamp) {
            timeText = formatTimeAgo(notification.timestamp);
        } else if (notification.timestamp) {
            timeText = new Date(notification.timestamp).toLocaleString();
        }
        const time = createElementWithText('div', timeText, 'item-time');
        content.appendChild(time);

        // Assemble item
        item.appendChild(icon);
        item.appendChild(content);

        // Create dismiss button
        const dismissBtn = document.createElement('button');
        dismissBtn.className = 'item-dismiss';
        dismissBtn.dataset.folder = notification.folder;
        dismissBtn.title = 'Dismiss';
        dismissBtn.textContent = '×';
        item.appendChild(dismissBtn);

        return item;
    }

    // Export for both Node.js (testing) and browser
    const DomUtils = {
        createElementWithText,
        createNotificationItem,
        createNotificationElement,
    };

    // Use require check to definitively detect Node.js (avoid false positives from partial module shims)
    if (typeof require === 'function' && typeof module !== 'undefined') {
        module.exports = { DomUtils };
    } else if (typeof window !== 'undefined') {
        // Browser global
        window.DomUtils = DomUtils;
    }
})();
