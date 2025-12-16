/**
 * Clipboard paste handler module
 * Handles clipboard image/file paste, upload, and terminal insertion
 */

const SUPPORTED_FILE_TYPES = [
    // Images
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    // Documents
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // Text
    'text/plain', 'text/markdown', 'text/csv', 'application/json',
    // Archives
    'application/zip',
];

const PASTE_DEBOUNCE_MS = 1000;
const INSERT_DEBOUNCE_MS = 2000;

/**
 * Create clipboard handler
 * @param {object} deps - Dependencies
 * @param {Function} deps.showToast - Toast notification function
 * @param {Function} deps.isInTerminalArea - Check if in terminal function
 * @param {object} deps.config - Configuration object with API_BASE
 * @param {string} deps.folder - Project folder path
 * @param {string} deps.vscodeOrigin - VS Code origin URL
 * @returns {object} - Clipboard handler instance
 */
function createClipboardHandler(deps) {
    const { showToast, isInTerminalArea, config, folder, vscodeOrigin } = deps;

    // State
    let lastFileHash = null;
    let lastFilePath = null;
    let ctrlVHandledPaste = false;
    let isProcessingPaste = false;
    let lastPasteTime = 0;
    let isSyntheticPaste = false;
    let lastInsertedText = null;
    let lastInsertTime = 0;

    /**
     * Calculate simple hash from blob for duplicate detection
     * @param {Blob} blob - Blob to hash
     * @returns {Promise<string>} - SHA-256 hash
     */
    async function hashBlob(blob) {
        const buffer = await blob.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    /**
     * Read clipboard image using Clipboard API
     * @returns {Promise<Blob|null>} - Image blob or null
     */
    async function readClipboardImage() {
        try {
            const clipboardItems = await navigator.clipboard.read();
            console.log('Clipboard Handler: Clipboard items:', clipboardItems.length);

            for (const clipboardItem of clipboardItems) {
                console.log('Clipboard Handler: Item types:', clipboardItem.types);

                for (const type of clipboardItem.types) {
                    if (type.startsWith('image/')) {
                        const blob = await clipboardItem.getType(type);
                        console.log('Clipboard Handler: Found image:', type, blob.size, 'bytes');
                        return blob;
                    }
                }
            }
            console.log('Clipboard Handler: No image in clipboard');
            return null;
        } catch (err) {
            console.error('Clipboard Handler: Clipboard read error:', err.message);
            return null;
        }
    }

    /**
     * Insert text into terminal
     * @param {string} text - Text to insert
     * @param {Array} terminalInputs - Cached terminal inputs
     * @param {Array} terminalContainers - Cached terminal containers
     * @returns {Promise<void>}
     */
    async function insertIntoTerminal(text, terminalInputs, terminalContainers) {
        // Prevent duplicate insertions of the same text
        const now = Date.now();
        if (text === lastInsertedText && now - lastInsertTime < INSERT_DEBOUNCE_MS) {
            console.log('Clipboard Handler: Skipping duplicate insert of:', text);
            return;
        }
        lastInsertedText = text;
        lastInsertTime = now;

        console.log('Clipboard Handler: Inserting into terminal:', text);

        // Find the ACTIVE terminal input
        let terminalInput = null;

        const activeElement = document.activeElement;
        if (activeElement) {
            if (activeElement.classList.contains('xterm-helper-textarea')) {
                terminalInput = activeElement;
            } else {
                const activeContainer = terminalContainers.find(container =>
                    container && container.isConnected && container.contains(activeElement)
                );
                if (activeContainer) {
                    terminalInput = terminalInputs.find(input =>
                        input && input.isConnected && activeContainer.contains(input)
                    );
                }
            }
        }

        // Fallback: find any visible terminal input from cache
        if (!terminalInput) {
            for (const input of terminalInputs) {
                if (input && input.isConnected) {
                    const container = input.closest('.xterm');
                    if (container && container.offsetParent !== null) {
                        terminalInput = input;
                        break;
                    }
                }
            }
        }

        // Final fallback: just get the first cached input
        if (!terminalInput) {
            terminalInput = terminalInputs.find(input => input && input.isConnected);
        }

        if (!terminalInput) {
            console.log('Clipboard Handler: No terminal input found');
            showToast(`Path: ${text}`, 'info');
            return;
        }

        console.log('Clipboard Handler: Found terminal input:', terminalInput);
        terminalInput.focus();

        // Use ClipboardEvent - the most reliable method for xterm terminals
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
            console.log('Clipboard Handler: ClipboardEvent dispatched');
            showToast(`Uploaded: ${text.split('/').pop().replace(/^'|'$/g, '')}`, 'success');
        } catch (e) {
            console.log('Clipboard Handler: ClipboardEvent failed:', e.message);
        } finally {
            setTimeout(() => { isSyntheticPaste = false; }, 100);
        }
    }

    /**
     * Handle file paste internal logic
     * @param {Blob} blob - File blob
     * @param {Array} terminalInputs - Cached terminal inputs
     * @param {Array} terminalContainers - Cached terminal containers
     * @returns {Promise<void>}
     */
    async function _handleFilePasteInternal(blob, terminalInputs, terminalContainers) {
        console.log('Clipboard Handler: Processing file...', blob.type, blob.size, blob.name);

        // Calculate hash for duplicate detection
        const fileHash = await hashBlob(blob);
        console.log('Clipboard Handler: File hash:', fileHash.substring(0, 16) + '...');

        // Check if same file was just uploaded
        if (fileHash === lastFileHash && lastFilePath) {
            console.log('Clipboard Handler: Same file, reusing path:', lastFilePath);
            showToast('File already uploaded', 'success');
            await insertIntoTerminal(lastFilePath, terminalInputs, terminalContainers);
            return;
        }

        const isImage = blob.type.startsWith('image/');
        showToast(isImage ? 'Uploading image...' : 'Uploading file...', 'info');

        const formData = new FormData();
        const extension = blob.type.split('/')[1] || 'bin';
        const filename = blob.name || `clipboard.${extension}`;
        formData.append('image', blob, filename);
        formData.append('folder', folder);
        formData.append('origin', vscodeOrigin);

        try {
            const response = await fetch(`${config.API_BASE}/api/paste-image`, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || `HTTP ${response.status}`);
            }

            const data = await response.json();
            const savedFilename = data.filename || data.path;
            console.log('Clipboard Handler: File saved:', savedFilename);

            const fullPath = `'${folder}/tasks/files/${savedFilename}'`;
            lastFileHash = fileHash;
            lastFilePath = fullPath;

            showToast(`Saved: ${savedFilename}`, 'success');
            await insertIntoTerminal(fullPath, terminalInputs, terminalContainers);
        } catch (err) {
            console.error('Clipboard Handler: File paste failed:', err.message);
            showToast(`Upload failed: ${err.message}`, 'error');
        }
    }

    /**
     * Handle file paste with debouncing
     * @param {Blob} blob - File blob
     * @param {Array} terminalInputs - Cached terminal inputs
     * @param {Array} terminalContainers - Cached terminal containers
     * @returns {Promise<void>}
     */
    async function handleFilePaste(blob, terminalInputs, terminalContainers) {
        const now = Date.now();
        if (isProcessingPaste) {
            console.log('Clipboard Handler: Skipping - already processing a paste');
            return;
        }
        if (now - lastPasteTime < PASTE_DEBOUNCE_MS) {
            console.log('Clipboard Handler: Skipping - debounce active');
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

    /**
     * Setup keyboard handlers for Ctrl+Shift+V and Ctrl+V
     * @param {Array} terminalInputs - Cached terminal inputs
     * @param {Array} terminalContainers - Cached terminal containers
     */
    function setupKeyboardHandlers(terminalInputs, terminalContainers) {
        // Ctrl+Shift+V - paste image shortcut
        window.addEventListener('keydown', async (e) => {
            if (e.ctrlKey && e.shiftKey && (e.key === 'V' || e.key === 'v')) {
                console.log('Clipboard Handler: *** Ctrl+Shift+V DETECTED ***');

                if (!isInTerminalArea()) {
                    console.log('Clipboard Handler: Not in terminal area');
                    return;
                }

                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();

                console.log('Clipboard Handler: Reading clipboard...');
                const imageBlob = await readClipboardImage();

                if (imageBlob) {
                    await handleFilePaste(imageBlob, terminalInputs, terminalContainers);
                } else {
                    showToast('No image in clipboard', 'error');
                }
            }
        }, true);

        // Ctrl+V (without Shift)
        window.addEventListener('keydown', async (e) => {
            if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && (e.key === 'V' || e.key === 'v')) {
                console.log('Clipboard Handler: Ctrl+V detected');

                if (!isInTerminalArea()) {
                    return;
                }

                ctrlVHandledPaste = true;

                const imageBlob = await readClipboardImage();

                if (imageBlob) {
                    console.log('Clipboard Handler: Image found in Ctrl+V, intercepting');
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();

                    await handleFilePaste(imageBlob, terminalInputs, terminalContainers);

                    setTimeout(() => { ctrlVHandledPaste = false; }, 500);
                } else {
                    ctrlVHandledPaste = false;
                }
            }
        }, true);
    }

    /**
     * Setup paste event listener
     * @param {Array} terminalInputs - Cached terminal inputs
     * @param {Array} terminalContainers - Cached terminal containers
     */
    function setupPasteListener(terminalInputs, terminalContainers) {
        window.addEventListener('paste', async (e) => {
            console.log('Clipboard Handler: Paste event received');

            if (isSyntheticPaste) {
                console.log('Clipboard Handler: Skipping synthetic paste event');
                return;
            }

            if (ctrlVHandledPaste) {
                console.log('Clipboard Handler: Skipping paste event - already handled by Ctrl+V');
                return;
            }

            if (isProcessingPaste) {
                console.log('Clipboard Handler: Skipping paste event - already processing');
                return;
            }

            if (!isInTerminalArea()) {
                return;
            }

            const items = e.clipboardData?.items;
            if (!items) return;

            for (const item of items) {
                if (item.kind === 'file') {
                    const file = item.getAsFile();
                    if (file && (SUPPORTED_FILE_TYPES.includes(item.type) || item.type.startsWith('image/'))) {
                        e.preventDefault();
                        e.stopPropagation();
                        console.log('Clipboard Handler: File in paste event:', item.type, file.name);
                        await handleFilePaste(file, terminalInputs, terminalContainers);
                        return;
                    }
                }
            }
        }, true);
    }

    return {
        setupKeyboardHandlers,
        setupPasteListener,
        getSyntheticPasteFlag: () => isSyntheticPaste,
    };
}

// Export for both Node.js and browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createClipboardHandler };
} else if (typeof window !== 'undefined') {
    window.ClipboardHandler = { createClipboardHandler };
}
