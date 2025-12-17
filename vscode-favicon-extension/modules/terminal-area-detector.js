/**
 * Terminal area detector module
 * Detects if user is currently in terminal area for clipboard paste handling
 */

// Import terminal selectors for centralized selector management
const { findAllTerminalInputs, findAllTerminalContainers, isTerminalInput, isTerminalContainer } =
    typeof window !== 'undefined' ? window.TerminalSelectors : require('./terminal-selectors.js');

/**
 * Create terminal area detector
 * @returns {object} - Terminal area detector instance
 */
function createTerminalAreaDetector() {
    // DOM Cache for paste handlers
    const pasteHandlerCache = {
        terminalInputs: [],
        terminalContainers: [],
        lastUpdate: 0
    };

    let pasteHandlerObserver = null;

    /**
     * Update paste handler cache
     */
    function updatePasteHandlerCache() {
        const now = Date.now();
        pasteHandlerCache.lastUpdate = now;

        pasteHandlerCache.terminalInputs = findAllTerminalInputs();
        pasteHandlerCache.terminalContainers = findAllTerminalContainers();

        console.log('Terminal Area Detector: Cache updated -', {
            inputs: pasteHandlerCache.terminalInputs.length,
            containers: pasteHandlerCache.terminalContainers.length
        });
    }

    /**
     * Setup MutationObserver for terminal DOM changes
     */
    function setupPasteHandlerObserver() {
        updatePasteHandlerCache();

        if (pasteHandlerObserver) {
            pasteHandlerObserver.disconnect();
            pasteHandlerObserver = null;
        }

        const targetElement = document.querySelector('.part.panel') || document.body;

        pasteHandlerObserver = new MutationObserver((mutations) => {
            let needsUpdate = false;
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
                    for (const node of nodes) {
                        if (node.nodeType === 1) {
                            // Check if node is a terminal input or container
                            if (isTerminalInput(node) || isTerminalContainer(node)) {
                                needsUpdate = true;
                                break;
                            }
                            // Check if node contains any terminal elements
                            if (node.querySelector) {
                                const hasTerminalInput = findAllTerminalInputs(node).length > 0;
                                const hasTerminalContainer = findAllTerminalContainers(node).length > 0;
                                if (hasTerminalInput || hasTerminalContainer) {
                                    needsUpdate = true;
                                    break;
                                }
                            }
                        }
                    }
                    if (needsUpdate) break;
                }
            }

            if (needsUpdate) {
                const timeSinceUpdate = Date.now() - pasteHandlerCache.lastUpdate;
                if (timeSinceUpdate > 500) {
                    updatePasteHandlerCache();
                }
            }
        });

        pasteHandlerObserver.observe(targetElement, {
            childList: true,
            subtree: true
        });

        console.log('Terminal Area Detector: Observer initialized');
    }

    /**
     * Check if currently in terminal area
     * @returns {boolean} - True if in terminal area
     */
    function isInTerminalArea() {
        const activeElement = document.activeElement;

        const terminalInput = pasteHandlerCache.terminalInputs.find(input =>
            input && input.isConnected
        );

        if (!terminalInput) {
            console.log('Terminal Area Detector: No terminal input found');
            return false;
        }

        if (activeElement === terminalInput) {
            console.log('Terminal Area Detector: Active element is terminal input');
            return true;
        }

        const inTerminal = pasteHandlerCache.terminalContainers.some(container =>
            container && container.isConnected && container.contains(activeElement)
        );

        console.log('Terminal Area Detector:', {
            hasTerminalInput: !!terminalInput,
            activeElement: activeElement?.className || activeElement?.tagName,
            inTerminal
        });

        return inTerminal;
    }

    /**
     * Get cached terminal inputs
     * @returns {Array} - Terminal input elements
     */
    function getTerminalInputs() {
        return pasteHandlerCache.terminalInputs;
    }

    /**
     * Get cached terminal containers
     * @returns {Array} - Terminal container elements
     */
    function getTerminalContainers() {
        return pasteHandlerCache.terminalContainers;
    }

    /**
     * Cleanup observer
     */
    function cleanup() {
        if (pasteHandlerObserver) {
            pasteHandlerObserver.disconnect();
            pasteHandlerObserver = null;
        }
    }

    return {
        setupPasteHandlerObserver,
        isInTerminalArea,
        getTerminalInputs,
        getTerminalContainers,
        cleanup,
    };
}

// Export for both Node.js and browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createTerminalAreaDetector };
} else if (typeof window !== 'undefined') {
    window.TerminalAreaDetector = { createTerminalAreaDetector };
}
