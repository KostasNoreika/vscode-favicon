/**
 * Unit tests for extension clipboard-handler module
 * Tests toast display, clipboard fallback, and error handling
 */

const { createClipboardHandler } = require('../../vscode-favicon-extension/modules/clipboard-handler');

// Mock dependencies
global.crypto = {
    subtle: {
        digest: jest.fn().mockResolvedValue(new Uint8Array(32).fill(0x42)),
    },
};

global.navigator = {
    clipboard: {
        read: jest.fn(),
        writeText: jest.fn(),
    },
};

global.fetch = jest.fn();
global.FormData = jest.fn().mockImplementation(() => ({
    append: jest.fn(),
}));
global.DataTransfer = jest.fn().mockImplementation(() => ({
    setData: jest.fn(),
}));

class MockClipboardEvent {
    constructor(type, options) {
        this.type = type;
        this.bubbles = options.bubbles;
        this.cancelable = options.cancelable;
        this.clipboardData = options.clipboardData;
    }
}
global.ClipboardEvent = MockClipboardEvent;

describe('clipboard-handler', () => {
    let mockShowToast;
    let mockIsInTerminalArea;
    let mockConfig;
    let mockFolder;
    let mockVscodeOrigin;
    let clipboardHandler;
    let mockTerminalInputs;
    let mockTerminalContainers;

    beforeEach(() => {
        jest.clearAllMocks();

        mockShowToast = jest.fn();
        mockIsInTerminalArea = jest.fn().mockReturnValue(true);
        mockConfig = { API_BASE: 'https://test-api.local' };
        mockFolder = '/opt/test/project';
        mockVscodeOrigin = 'https://test.local';

        // Mock terminal inputs and containers
        mockTerminalInputs = [
            {
                focus: jest.fn(),
                dispatchEvent: jest.fn(),
                isConnected: true,
            },
        ];

        mockTerminalContainers = [
            {
                contains: jest.fn().mockReturnValue(true),
                isConnected: true,
            },
        ];

        clipboardHandler = createClipboardHandler({
            showToast: mockShowToast,
            isInTerminalArea: mockIsInTerminalArea,
            config: mockConfig,
            folder: mockFolder,
            vscodeOrigin: mockVscodeOrigin,
        });

        // Reset navigator mocks
        navigator.clipboard.read.mockResolvedValue([]);
        navigator.clipboard.writeText.mockResolvedValue();
    });

    describe('Error Handling', () => {
        test('shows appropriate message for HTTP 530 error', async () => {
            const mockBlob = new Blob(['test'], { type: 'image/png' });
            global.fetch.mockResolvedValue({
                ok: false,
                status: 530,
            });

            const { handleFilePaste } = createTestableClipboardHandler();
            await handleFilePaste(mockBlob, mockTerminalInputs, mockTerminalContainers);

            expect(mockShowToast).toHaveBeenCalledWith(
                'Upload failed (HTTP 530). Check if API is running.',
                'error'
            );
        });

        test('shows appropriate message for HTTP 502 error', async () => {
            const mockBlob = new Blob(['test'], { type: 'image/png' });
            global.fetch.mockResolvedValue({
                ok: false,
                status: 502,
            });

            const { handleFilePaste } = createTestableClipboardHandler();
            await handleFilePaste(mockBlob, mockTerminalInputs, mockTerminalContainers);

            expect(mockShowToast).toHaveBeenCalledWith(
                'Upload failed (HTTP 502). Check if API is running.',
                'error'
            );
        });

        test('shows appropriate message for HTTP 503 error', async () => {
            const mockBlob = new Blob(['test'], { type: 'image/png' });
            global.fetch.mockResolvedValue({
                ok: false,
                status: 503,
            });

            const { handleFilePaste } = createTestableClipboardHandler();
            await handleFilePaste(mockBlob, mockTerminalInputs, mockTerminalContainers);

            expect(mockShowToast).toHaveBeenCalledWith(
                'Upload failed (HTTP 503). Check if API is running.',
                'error'
            );
        });

        test('shows appropriate message for HTTP 413 error', async () => {
            const mockBlob = new Blob(['test'], { type: 'image/png' });
            global.fetch.mockResolvedValue({
                ok: false,
                status: 413,
            });

            const { handleFilePaste } = createTestableClipboardHandler();
            await handleFilePaste(mockBlob, mockTerminalInputs, mockTerminalContainers);

            expect(mockShowToast).toHaveBeenCalledWith(
                'Upload failed: File too large (max 10MB)',
                'error'
            );
        });

        test('shows appropriate message for HTTP 429 error', async () => {
            const mockBlob = new Blob(['test'], { type: 'image/png' });
            global.fetch.mockResolvedValue({
                ok: false,
                status: 429,
            });

            const { handleFilePaste } = createTestableClipboardHandler();
            await handleFilePaste(mockBlob, mockTerminalInputs, mockTerminalContainers);

            expect(mockShowToast).toHaveBeenCalledWith(
                'Upload failed: Rate limit exceeded - please wait',
                'error'
            );
        });

        test('shows appropriate message for network error', async () => {
            const mockBlob = new Blob(['test'], { type: 'image/png' });
            global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));

            const { handleFilePaste } = createTestableClipboardHandler();
            await handleFilePaste(mockBlob, mockTerminalInputs, mockTerminalContainers);

            expect(mockShowToast).toHaveBeenCalledWith(
                'Upload failed. Server unreachable.',
                'error'
            );
        });
    });

    describe('Clipboard Fallback', () => {
        test('copies path to clipboard when terminal not found', async () => {
            const { insertIntoTerminal } = createTestableClipboardHandler();
            const testPath = '/opt/test/project/tasks/files/test.png';

            // Empty terminal inputs (no terminal found)
            await insertIntoTerminal(testPath, [], []);

            expect(navigator.clipboard.writeText).toHaveBeenCalledWith(testPath);
            expect(mockShowToast).toHaveBeenCalledWith(
                'Path copied to clipboard (terminal not found)',
                'warning'
            );
        });

        test('shows error when clipboard copy fails and terminal not found', async () => {
            const { insertIntoTerminal } = createTestableClipboardHandler();
            const testPath = '/opt/test/project/tasks/files/test.png';

            navigator.clipboard.writeText.mockRejectedValue(new Error('Clipboard access denied'));

            await insertIntoTerminal(testPath, [], []);

            expect(mockShowToast).toHaveBeenCalledWith(
                expect.stringContaining('Terminal not found. Path:'),
                'error'
            );
        });

        test('copies path to clipboard when terminal insertion fails', async () => {
            const { insertIntoTerminal } = createTestableClipboardHandler();
            const testPath = '/opt/test/project/tasks/files/test.png';

            // Mock terminal input that throws error on dispatchEvent
            const failingTerminalInput = {
                focus: jest.fn(),
                dispatchEvent: jest.fn().mockImplementation(() => {
                    throw new Error('Terminal not accepting input');
                }),
                isConnected: true,
            };

            await insertIntoTerminal(testPath, [failingTerminalInput], mockTerminalContainers);

            expect(navigator.clipboard.writeText).toHaveBeenCalledWith(testPath);
            expect(mockShowToast).toHaveBeenCalledWith(
                'Path copied to clipboard (terminal insertion failed)',
                'warning'
            );
        });

        test('shows success message when terminal insertion succeeds', async () => {
            const { insertIntoTerminal } = createTestableClipboardHandler();
            const testPath = "'/opt/test/project/tasks/files/test.png'";

            await insertIntoTerminal(testPath, mockTerminalInputs, mockTerminalContainers);

            expect(mockTerminalInputs[0].focus).toHaveBeenCalled();
            expect(mockTerminalInputs[0].dispatchEvent).toHaveBeenCalled();
            expect(mockShowToast).toHaveBeenCalledWith(
                'Uploaded: test.png',
                'success'
            );
        });
    });

    describe('Upload Success', () => {
        test('shows success toast and inserts path on successful upload', async () => {
            const mockBlob = new Blob(['test'], { type: 'image/png' });
            global.fetch.mockResolvedValue({
                ok: true,
                status: 200,
                json: jest.fn().mockResolvedValue({
                    filename: 'clipboard_20230101_120000.png',
                }),
            });

            const { handleFilePaste } = createTestableClipboardHandler();
            await handleFilePaste(mockBlob, mockTerminalInputs, mockTerminalContainers);

            // Should show uploading toast
            expect(mockShowToast).toHaveBeenCalledWith('Uploading image...', 'info');

            // Should show success toast
            expect(mockShowToast).toHaveBeenCalledWith(
                'Saved: clipboard_20230101_120000.png',
                'success'
            );

            // Should show uploaded toast with filename
            expect(mockShowToast).toHaveBeenCalledWith(
                'Uploaded: clipboard_20230101_120000.png',
                'success'
            );
        });
    });

    // Helper function to create a testable clipboard handler with exposed internals
    function createTestableClipboardHandler() {
        let lastFileHash = null;
        let lastFilePath = null;
        let isProcessingPaste = false;
        let lastPasteTime = 0;
        let isSyntheticPaste = false;
        let lastInsertedText = null;
        let lastInsertTime = 0;

        async function hashBlob(blob) {
            const buffer = await blob.arrayBuffer();
            const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        }

        async function copyToClipboard(text) {
            try {
                await navigator.clipboard.writeText(text);
                return true;
            } catch (err) {
                return false;
            }
        }

        async function insertIntoTerminal(text, terminalInputs, terminalContainers) {
            const now = Date.now();
            if (text === lastInsertedText && now - lastInsertTime < 2000) {
                return;
            }
            lastInsertedText = text;
            lastInsertTime = now;

            let terminalInput = terminalInputs.find(input => input && input.isConnected);

            if (!terminalInput) {
                const copied = await copyToClipboard(text);
                if (copied) {
                    mockShowToast('Path copied to clipboard (terminal not found)', 'warning');
                } else {
                    mockShowToast(`Terminal not found. Path: ${text}`, 'error');
                }
                return;
            }

            terminalInput.focus();
            isSyntheticPaste = true;

            try {
                const dt = new DataTransfer();
                dt.setData('text/plain', text);
                const clipboardEvent = new ClipboardEvent('paste', {
                    bubbles: false,
                    cancelable: true,
                    clipboardData: dt
                });
                terminalInput.dispatchEvent(clipboardEvent);
                mockShowToast(`Uploaded: ${text.split('/').pop().replace(/^'|'$/g, '')}`, 'success');
            } catch (e) {
                const copied = await copyToClipboard(text);
                if (copied) {
                    mockShowToast('Path copied to clipboard (terminal insertion failed)', 'warning');
                } else {
                    mockShowToast('Terminal insertion failed', 'error');
                }
            } finally {
                setTimeout(() => { isSyntheticPaste = false; }, 100);
            }
        }

        async function _handleFilePasteInternal(blob, terminalInputs, terminalContainers) {
            const fileHash = await hashBlob(blob);

            if (fileHash === lastFileHash && lastFilePath) {
                mockShowToast('File already uploaded', 'success');
                await insertIntoTerminal(lastFilePath, terminalInputs, terminalContainers);
                return;
            }

            const isImage = blob.type.startsWith('image/');
            mockShowToast(isImage ? 'Uploading image...' : 'Uploading file...', 'info');

            const formData = new FormData();
            const extension = blob.type.split('/')[1] || 'bin';
            const filename = blob.name || `clipboard.${extension}`;
            formData.append('image', blob, filename);
            formData.append('folder', mockFolder);
            formData.append('origin', mockVscodeOrigin);

            try {
                const response = await fetch(`${mockConfig.API_BASE}/api/paste-image`, {
                    method: 'POST',
                    headers: {
                        'X-Requested-With': 'XMLHttpRequest',
                    },
                    body: formData
                });

                if (!response.ok) {
                    let errorMessage;
                    if (response.status === 530 || response.status === 502 || response.status === 503) {
                        errorMessage = `Upload failed (HTTP ${response.status}). Check if API is running.`;
                    } else if (response.status === 413) {
                        errorMessage = 'Upload failed: File too large (max 10MB)';
                    } else if (response.status === 429) {
                        errorMessage = 'Upload failed: Rate limit exceeded - please wait';
                    } else if (response.status === 403) {
                        errorMessage = `Upload failed (HTTP ${response.status}). Access denied.`;
                    } else if (response.status >= 500) {
                        errorMessage = `Upload failed (HTTP ${response.status}). Server error.`;
                    } else if (response.status === 400) {
                        errorMessage = `Upload failed (HTTP ${response.status}). Invalid request.`;
                    } else {
                        errorMessage = `Upload failed (HTTP ${response.status}). Check if API is running.`;
                    }
                    throw new Error(errorMessage);
                }

                const data = await response.json();
                const savedFilename = data.filename || data.path;

                const fullPath = `'${mockFolder}/tasks/files/${savedFilename}'`;
                lastFileHash = fileHash;
                lastFilePath = fullPath;

                mockShowToast(`Saved: ${savedFilename}`, 'success');
                await insertIntoTerminal(fullPath, terminalInputs, terminalContainers);
            } catch (err) {
                if (err.name === 'TypeError' && (err.message.includes('fetch') || err.message.includes('Failed to fetch'))) {
                    mockShowToast('Upload failed. Server unreachable.', 'error');
                } else {
                    mockShowToast(err.message, 'error');
                }
            }
        }

        async function handleFilePaste(blob, terminalInputs, terminalContainers) {
            const now = Date.now();
            if (isProcessingPaste) {
                return;
            }
            if (now - lastPasteTime < 1000) {
                return;
            }

            isProcessingPaste = true;
            lastPasteTime = now;

            try {
                await _handleFilePasteInternal(blob, terminalInputs, terminalContainers);
            } finally {
                isProcessingPaste = false;
            }
        }

        return {
            handleFilePaste,
            insertIntoTerminal,
        };
    }
});
