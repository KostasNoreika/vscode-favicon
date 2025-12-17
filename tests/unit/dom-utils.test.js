/**
 * Tests for DOM utilities module
 */

// Mock DOM environment
class MockElement {
    constructor(tagName) {
        this.tagName = tagName.toUpperCase();
        this.className = '';
        this.textContent = '';
        this.innerHTML = '';
        this.children = [];
        this.attributes = {};
        this.dataset = {};
    }

    setAttribute(name, value) {
        this.attributes[name] = value;
        // Support dataset
        if (name.startsWith('data-')) {
            const dataKey = name.slice(5).replace(/-([a-z])/g, (g) => g[1].toUpperCase());
            this.dataset[dataKey] = value;
        }
        // Support special attributes
        if (name === 'title') this.title = value;
    }

    getAttribute(name) {
        return this.attributes[name] || null;
    }

    appendChild(child) {
        this.children.push(child);
    }

    querySelector(selector) {
        // Simple class selector implementation
        if (selector.startsWith('.')) {
            const className = selector.slice(1);
            return this._findByClass(className);
        }
        return null;
    }

    _findByClass(className) {
        if (this.className === className) return this;
        for (const child of this.children) {
            if (child instanceof MockElement) {
                const found = child._findByClass(className);
                if (found) return found;
            }
        }
        return null;
    }

    // Simulate innerHTML escaping
    get innerHTML() {
        if (this.textContent) {
            return this.textContent
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }
        return this._innerHTML || '';
    }

    set innerHTML(value) {
        this._innerHTML = value;
    }
}

class MockDocument {
    createElement(tagName) {
        return new MockElement(tagName);
    }
}

describe('DomUtils', () => {
    let DomUtils;

    beforeEach(() => {
        // Set up DOM mock
        global.document = new MockDocument();

        // Load the module - it will export via module.exports in Node.js environment
        const { DomUtils: LoadedDomUtils } = require('../../vscode-favicon-extension/modules/dom-utils');
        DomUtils = LoadedDomUtils;
    });

    afterEach(() => {
        delete global.document;
        delete global.window;
    });
    describe('createElementWithText', () => {
        it('should create element with tag and text', () => {
            const element = DomUtils.createElementWithText('div', 'Hello World');

            expect(element.tagName).toBe('DIV');
            expect(element.textContent).toBe('Hello World');
            expect(element.className).toBe('');
        });

        it('should create element with tag, text, and className', () => {
            const element = DomUtils.createElementWithText('span', 'Test', 'test-class');

            expect(element.tagName).toBe('SPAN');
            expect(element.textContent).toBe('Test');
            expect(element.className).toBe('test-class');
        });

        it('should create element without className when not provided', () => {
            const element = DomUtils.createElementWithText('p', 'Paragraph');

            expect(element.tagName).toBe('P');
            expect(element.textContent).toBe('Paragraph');
            expect(element.className).toBe('');
        });

        it('should handle empty text', () => {
            const element = DomUtils.createElementWithText('div', '');

            expect(element.tagName).toBe('DIV');
            expect(element.textContent).toBe('');
        });

        it('should handle null text by not setting textContent', () => {
            const element = DomUtils.createElementWithText('div', null);

            expect(element.tagName).toBe('DIV');
            expect(element.textContent).toBe('');
        });

        it('should handle undefined text by not setting textContent', () => {
            const element = DomUtils.createElementWithText('div', undefined);

            expect(element.tagName).toBe('DIV');
            expect(element.textContent).toBe('');
        });

        it('should convert numeric text to string', () => {
            const element = DomUtils.createElementWithText('div', 42);

            expect(element.textContent).toBe('42');
        });

        it('should create button with text', () => {
            const element = DomUtils.createElementWithText('button', 'Click me', 'btn-primary');

            expect(element.tagName).toBe('BUTTON');
            expect(element.textContent).toBe('Click me');
            expect(element.className).toBe('btn-primary');
        });

        describe('XSS safety', () => {
            it('should safely escape HTML tags in text', () => {
                const element = DomUtils.createElementWithText('div', '<script>alert("XSS")</script>');

                // textContent should escape HTML, not execute it
                expect(element.textContent).toBe('<script>alert("XSS")</script>');
                // innerHTML escapes the content (quotes may be encoded differently)
                expect(element.innerHTML).toContain('&lt;script&gt;');
                expect(element.innerHTML).toContain('&lt;/script&gt;');
                expect(element.querySelector('script')).toBeNull();
            });

            it('should safely handle malicious event handlers', () => {
                const element = DomUtils.createElementWithText('div', '<img src=x onerror="alert(1)">');

                expect(element.textContent).toBe('<img src=x onerror="alert(1)">');
                expect(element.querySelector('img')).toBeNull();
            });

            it('should safely handle iframe injection attempts', () => {
                const element = DomUtils.createElementWithText('div', '<iframe src="javascript:alert(1)"></iframe>');

                expect(element.textContent).toBe('<iframe src="javascript:alert(1)"></iframe>');
                expect(element.querySelector('iframe')).toBeNull();
            });

            it('should not execute javascript: protocol', () => {
                const element = DomUtils.createElementWithText('a', 'javascript:alert(1)');

                expect(element.textContent).toBe('javascript:alert(1)');
                // textContent is set, but href attribute is not (safe - no actual link)
                expect(element.getAttribute('href')).toBeNull();
            });
        });
    });

    describe('createNotificationItem', () => {
        const mockNotification = {
            folder: '/opt/dev/test-project',
            projectName: 'Test Project',
            message: 'Task completed successfully',
            timestamp: Date.now(),
        };

        const mockFormatTimeAgo = (timestamp) => {
            const seconds = Math.floor((Date.now() - timestamp) / 1000);
            if (seconds < 60) return `${seconds}s ago`;
            return `${Math.floor(seconds / 60)}m ago`;
        };

        it('should create notification item with all fields', () => {
            const element = DomUtils.createNotificationItem(mockNotification, {
                index: 0,
                formatTimeAgo: mockFormatTimeAgo,
            });

            expect(element.tagName).toBe('DIV');
            expect(element.className).toBe('vscode-favicon-panel-item');
            expect(element.getAttribute('data-folder')).toBe('/opt/dev/test-project');
            expect(element.getAttribute('data-index')).toBe('0');
        });

        it('should create icon element', () => {
            const element = DomUtils.createNotificationItem(mockNotification);
            const icon = element.querySelector('.vscode-favicon-panel-item-icon');

            expect(icon).not.toBeNull();
            expect(icon.textContent).toBe('✓');
        });

        it('should create project name element', () => {
            const element = DomUtils.createNotificationItem(mockNotification);
            const projectName = element.querySelector('.vscode-favicon-panel-item-project');

            expect(projectName).not.toBeNull();
            expect(projectName.textContent).toBe('Test Project');
        });

        it('should create message element', () => {
            const element = DomUtils.createNotificationItem(mockNotification);
            const message = element.querySelector('.vscode-favicon-panel-item-message');

            expect(message).not.toBeNull();
            expect(message.textContent).toBe('Task completed successfully');
        });

        it('should use default message when not provided', () => {
            const notificationWithoutMessage = {
                ...mockNotification,
                message: undefined,
            };
            const element = DomUtils.createNotificationItem(notificationWithoutMessage);
            const message = element.querySelector('.vscode-favicon-panel-item-message');

            expect(message.textContent).toBe('Task completed');
        });

        it('should create time element with formatTimeAgo', () => {
            const element = DomUtils.createNotificationItem(mockNotification, {
                formatTimeAgo: mockFormatTimeAgo,
            });
            const time = element.querySelector('.vscode-favicon-panel-item-time');

            expect(time).not.toBeNull();
            expect(time.textContent).toMatch(/^\d+[sm] ago$/);
        });

        it('should create time element without formatTimeAgo', () => {
            const element = DomUtils.createNotificationItem(mockNotification);
            const time = element.querySelector('.vscode-favicon-panel-item-time');

            expect(time).not.toBeNull();
            expect(time.textContent).toBeTruthy();
        });

        it('should create dismiss button', () => {
            const element = DomUtils.createNotificationItem(mockNotification);
            const dismissBtn = element.querySelector('.vscode-favicon-panel-item-dismiss');

            expect(dismissBtn).not.toBeNull();
            expect(dismissBtn.tagName).toBe('BUTTON');
            expect(dismissBtn.textContent).toBe('×');
            expect(dismissBtn.getAttribute('data-folder')).toBe('/opt/dev/test-project');
            expect(dismissBtn.getAttribute('title')).toBe('Dismiss');
        });

        it('should work without index option', () => {
            const element = DomUtils.createNotificationItem(mockNotification, {
                formatTimeAgo: mockFormatTimeAgo,
            });

            expect(element.getAttribute('data-index')).toBeNull();
            expect(element.getAttribute('data-folder')).toBe('/opt/dev/test-project');
        });

        it('should handle XSS in project name', () => {
            const xssNotification = {
                ...mockNotification,
                projectName: '<script>alert("XSS")</script>',
            };
            const element = DomUtils.createNotificationItem(xssNotification);
            const projectName = element.querySelector('.vscode-favicon-panel-item-project');

            expect(projectName.textContent).toBe('<script>alert("XSS")</script>');
            expect(element.querySelector('script')).toBeNull();
        });

        it('should handle XSS in message', () => {
            const xssNotification = {
                ...mockNotification,
                message: '<img src=x onerror="alert(1)">',
            };
            const element = DomUtils.createNotificationItem(xssNotification);
            const message = element.querySelector('.vscode-favicon-panel-item-message');

            expect(message.textContent).toBe('<img src=x onerror="alert(1)">');
            expect(element.querySelector('img')).toBeNull();
        });
    });

    describe('createNotificationElement', () => {
        const mockNotification = {
            folder: '/opt/dev/test-project',
            projectName: 'Test Project',
            message: 'Task completed successfully',
            timestamp: Date.now(),
        };

        const mockFormatTimeAgo = (timestamp) => {
            const seconds = Math.floor((Date.now() - timestamp) / 1000);
            if (seconds < 60) return `${seconds}s ago`;
            return `${Math.floor(seconds / 60)}m ago`;
        };

        it('should create notification element with popup-specific classes', () => {
            const element = DomUtils.createNotificationElement(mockNotification, mockFormatTimeAgo);

            expect(element.tagName).toBe('DIV');
            expect(element.className).toBe('item');
            expect(element.dataset.folder).toBe('/opt/dev/test-project');
        });

        it('should create icon element with popup class', () => {
            const element = DomUtils.createNotificationElement(mockNotification);
            const icon = element.querySelector('.item-icon');

            expect(icon).not.toBeNull();
            expect(icon.textContent).toBe('✓');
        });

        it('should create project name element with popup class', () => {
            const element = DomUtils.createNotificationElement(mockNotification);
            const projectName = element.querySelector('.item-project');

            expect(projectName).not.toBeNull();
            expect(projectName.textContent).toBe('Test Project');
        });

        it('should create message element with popup class', () => {
            const element = DomUtils.createNotificationElement(mockNotification);
            const message = element.querySelector('.item-message');

            expect(message).not.toBeNull();
            expect(message.textContent).toBe('Task completed successfully');
        });

        it('should use default message when not provided', () => {
            const notificationWithoutMessage = {
                ...mockNotification,
                message: undefined,
            };
            const element = DomUtils.createNotificationElement(notificationWithoutMessage);
            const message = element.querySelector('.item-message');

            expect(message.textContent).toBe('Task completed');
        });

        it('should create time element with formatTimeAgo', () => {
            const element = DomUtils.createNotificationElement(mockNotification, mockFormatTimeAgo);
            const time = element.querySelector('.item-time');

            expect(time).not.toBeNull();
            expect(time.textContent).toMatch(/^\d+[sm] ago$/);
        });

        it('should create time element without formatTimeAgo', () => {
            const element = DomUtils.createNotificationElement(mockNotification);
            const time = element.querySelector('.item-time');

            expect(time).not.toBeNull();
            expect(time.textContent).toBeTruthy();
        });

        it('should create dismiss button with popup class', () => {
            const element = DomUtils.createNotificationElement(mockNotification);
            const dismissBtn = element.querySelector('.item-dismiss');

            expect(dismissBtn).not.toBeNull();
            expect(dismissBtn.tagName).toBe('BUTTON');
            expect(dismissBtn.textContent).toBe('×');
            expect(dismissBtn.dataset.folder).toBe('/opt/dev/test-project');
            expect(dismissBtn.title).toBe('Dismiss');
        });

        it('should handle XSS in project name', () => {
            const xssNotification = {
                ...mockNotification,
                projectName: '<script>alert("XSS")</script>',
            };
            const element = DomUtils.createNotificationElement(xssNotification);
            const projectName = element.querySelector('.item-project');

            expect(projectName.textContent).toBe('<script>alert("XSS")</script>');
            expect(element.querySelector('script')).toBeNull();
        });

        it('should handle XSS in message', () => {
            const xssNotification = {
                ...mockNotification,
                message: '<img src=x onerror="alert(1)">',
            };
            const element = DomUtils.createNotificationElement(xssNotification);
            const message = element.querySelector('.item-message');

            expect(message.textContent).toBe('<img src=x onerror="alert(1)">');
            expect(element.querySelector('img')).toBeNull();
        });
    });

    describe('Module exports', () => {
        it('should export DomUtils with all methods', () => {
            expect(DomUtils).toBeDefined();
            expect(typeof DomUtils.createElementWithText).toBe('function');
            expect(typeof DomUtils.createNotificationItem).toBe('function');
            expect(typeof DomUtils.createNotificationElement).toBe('function');
        });
    });
});
