/**
 * Unit tests for extension notification-panel module
 * Tests toast notification display with different types
 */

const { createNotificationPanel } = require('../../vscode-favicon-extension/modules/notification-panel');

describe('notification-panel', () => {
    let mockSendMessage;
    let mockLoadBadgePosition;
    let mockSaveBadgePosition;
    let mockApplyBadgePosition;
    let mockSetupBadgeDrag;
    let notificationPanel;
    let mockDocument;

    beforeEach(() => {
        jest.clearAllMocks();

        // Mock window.DomUtils
        global.window = {
            DomUtils: {
                createElementWithText: jest.fn((tag, text, className) => {
                    const element = {
                        tagName: tag.toUpperCase(),
                        className: className || '',
                        textContent: text,
                        appendChild: jest.fn(),
                    };
                    return element;
                }),
                createNotificationItem: jest.fn((_notification, _options) => {
                    const element = {
                        tagName: 'DIV',
                        className: 'vscode-favicon-panel-item',
                        appendChild: jest.fn(),
                        setAttribute: jest.fn(),
                    };
                    return element;
                }),
            },
            TimeUtils: {
                formatTimeAgo: jest.fn((_timestamp) => 'just now'),
            },
        };

        // Mock dependencies
        mockSendMessage = jest.fn();
        mockLoadBadgePosition = jest.fn().mockResolvedValue({ top: 16, right: 16 });
        mockSaveBadgePosition = jest.fn().mockResolvedValue();
        mockApplyBadgePosition = jest.fn();
        mockSetupBadgeDrag = jest.fn();

        // Mock DOM
        mockDocument = {
            querySelector: jest.fn(),
            querySelectorAll: jest.fn().mockReturnValue([]),
            createElement: jest.fn((tag) => {
                const element = {
                    tagName: tag.toUpperCase(),
                    className: '',
                    textContent: '',
                    style: {},
                    children: [],
                    appendChild: jest.fn(function(child) {
                        this.children.push(child);
                        return child;
                    }),
                    remove: jest.fn(),
                    addEventListener: jest.fn(),
                    setAttribute: jest.fn(),
                    classList: {
                        add: jest.fn(),
                        remove: jest.fn(),
                        contains: jest.fn(),
                    },
                };
                return element;
            }),
            body: {
                appendChild: jest.fn(),
            },
            head: {
                appendChild: jest.fn(),
            },
            getElementById: jest.fn(),
        };

        global.document = mockDocument;

        notificationPanel = createNotificationPanel({
            sendMessage: mockSendMessage,
            loadBadgePosition: mockLoadBadgePosition,
            saveBadgePosition: mockSaveBadgePosition,
            applyBadgePosition: mockApplyBadgePosition,
            setupBadgeDrag: mockSetupBadgeDrag,
        });
    });

    describe('showUploadToast', () => {
        test('creates toast with info type by default', () => {
            mockDocument.querySelector.mockReturnValue(null);

            notificationPanel.showUploadToast('Test message');

            expect(mockDocument.createElement).toHaveBeenCalledWith('div');
            expect(mockDocument.body.appendChild).toHaveBeenCalled();

            const toastElement = mockDocument.createElement.mock.results.find(
                result => result.value.className.includes('vscode-favicon-upload-toast')
            )?.value;

            expect(toastElement).toBeDefined();
            expect(toastElement.className).toBe('vscode-favicon-upload-toast vscode-favicon-upload-toast-info');
            expect(toastElement.textContent).toBe('Test message');
        });

        test('creates toast with success type', () => {
            mockDocument.querySelector.mockReturnValue(null);

            notificationPanel.showUploadToast('Upload successful', 'success');

            const toastElement = mockDocument.createElement.mock.results.find(
                result => result.value.className.includes('vscode-favicon-upload-toast')
            )?.value;

            expect(toastElement).toBeDefined();
            expect(toastElement.className).toBe('vscode-favicon-upload-toast vscode-favicon-upload-toast-success');
            expect(toastElement.textContent).toBe('Upload successful');
        });

        test('creates toast with error type', () => {
            mockDocument.querySelector.mockReturnValue(null);

            notificationPanel.showUploadToast('Upload failed', 'error');

            const toastElement = mockDocument.createElement.mock.results.find(
                result => result.value.className.includes('vscode-favicon-upload-toast')
            )?.value;

            expect(toastElement).toBeDefined();
            expect(toastElement.className).toBe('vscode-favicon-upload-toast vscode-favicon-upload-toast-error');
            expect(toastElement.textContent).toBe('Upload failed');
        });

        test('creates toast with warning type', () => {
            mockDocument.querySelector.mockReturnValue(null);

            notificationPanel.showUploadToast('Path copied to clipboard', 'warning');

            const toastElement = mockDocument.createElement.mock.results.find(
                result => result.value.className.includes('vscode-favicon-upload-toast')
            )?.value;

            expect(toastElement).toBeDefined();
            expect(toastElement.className).toBe('vscode-favicon-upload-toast vscode-favicon-upload-toast-warning');
            expect(toastElement.textContent).toBe('Path copied to clipboard');
        });

        test('removes existing toast before creating new one', () => {
            const existingToast = {
                remove: jest.fn(),
            };
            mockDocument.querySelector.mockReturnValue(existingToast);

            notificationPanel.showUploadToast('New message');

            expect(mockDocument.querySelector).toHaveBeenCalledWith('.vscode-favicon-upload-toast');
            expect(existingToast.remove).toHaveBeenCalled();
        });

        test('sets up click listener to dismiss toast', () => {
            mockDocument.querySelector.mockReturnValue(null);

            notificationPanel.showUploadToast('Test message');

            const toastElement = mockDocument.createElement.mock.results.find(
                result => result.value.className.includes('vscode-favicon-upload-toast')
            )?.value;

            expect(toastElement).toBeDefined();
            expect(toastElement.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
        });

        test('toast displays various error messages correctly', () => {
            mockDocument.querySelector.mockReturnValue(null);

            const errorMessages = [
                'Upload failed (HTTP 530). Check if API is running.',
                'Upload failed. Server unreachable.',
                'Path copied to clipboard (terminal not found)',
                'Upload failed: File too large (max 10MB)',
                'Upload failed: Rate limit exceeded - please wait',
            ];

            errorMessages.forEach(message => {
                notificationPanel.showUploadToast(message, 'error');

                const toastElement = mockDocument.createElement.mock.results[mockDocument.createElement.mock.results.length - 1].value;
                expect(toastElement.textContent).toBe(message);
            });
        });
    });

    describe('Toast Auto-dismiss', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        test('toast auto-dismisses after 3 seconds', () => {
            mockDocument.querySelector.mockReturnValue(null);

            notificationPanel.showUploadToast('Test message');

            const toastElement = mockDocument.createElement.mock.results.find(
                result => result.value.className.includes('vscode-favicon-upload-toast')
            )?.value;

            expect(toastElement).toBeDefined();
            expect(toastElement.classList.add).not.toHaveBeenCalledWith('fade-out');

            // Fast-forward 3 seconds
            jest.advanceTimersByTime(3000);

            expect(toastElement.classList.add).toHaveBeenCalledWith('fade-out');

            // Fast-forward another 300ms for the fade-out animation
            jest.advanceTimersByTime(300);

            expect(toastElement.remove).toHaveBeenCalled();
        });
    });

    describe('updateNotifications', () => {
        test('handles empty notifications array', () => {
            expect(() => {
                notificationPanel.updateNotifications([]);
            }).not.toThrow();
        });

        test('handles notifications array with items', () => {
            const notifications = [
                {
                    folder: '/opt/test/project1',
                    projectName: 'project1',
                    message: 'Task completed',
                    timestamp: Date.now(),
                },
                {
                    folder: '/opt/test/project2',
                    projectName: 'project2',
                    message: 'Build finished',
                    timestamp: Date.now(),
                },
            ];

            expect(() => {
                notificationPanel.updateNotifications(notifications);
            }).not.toThrow();
        });
    });
});
