/**
 * Terminal area detector module
 * Detects if user is currently in terminal area for clipboard paste handling
 */

(function() {
    'use strict';

    // Import terminal selectors for centralized selector management
    // Note: isTerminalInput/isTerminalContainer removed - no longer used in mutation callback (performance)
    const { findTerminalInput, findAllTerminalInputs, findAllTerminalContainers } =
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

        // Debounce timeout for cache updates
        let cacheUpdateTimeout = null;
        const CACHE_UPDATE_DEBOUNCE_MS = 1000;

        /**
         * Setup MutationObserver for terminal DOM changes
         * PERFORMANCE: Simplified - just debounce cache updates, don't analyze every mutation
         */
        function setupPasteHandlerObserver() {
            updatePasteHandlerCache();

            if (pasteHandlerObserver) {
                pasteHandlerObserver.disconnect();
                pasteHandlerObserver = null;
            }

            // PERFORMANCE: Only observe panel area, not document.body
            const targetElement = document.querySelector('.part.panel');
            if (!targetElement) {
                // Panel not found yet, retry after delay
                console.log('Terminal Area Detector: Panel not found, retrying in 1s...');
                setTimeout(setupPasteHandlerObserver, 1000);
                return;
            }

            // PERFORMANCE: Simple debounced observer - don't analyze mutations individually
            // Just refresh cache periodically when DOM changes in panel area
            pasteHandlerObserver = new MutationObserver(() => {
                // Debounce: only update cache once per second max
                if (cacheUpdateTimeout) {
                    return; // Already scheduled
                }

                cacheUpdateTimeout = setTimeout(() => {
                    cacheUpdateTimeout = null;
                    updatePasteHandlerCache();
                }, CACHE_UPDATE_DEBOUNCE_MS);
            });

            pasteHandlerObserver.observe(targetElement, {
                childList: true,
                subtree: true
            });

            console.log('Terminal Area Detector: Observer initialized (debounced)');
        }

        /**
         * Check if currently in terminal area
         * @returns {boolean} - True if in terminal area
         */
        function isInTerminalArea() {
            const activeElement = document.activeElement;

            // First try cache
            let terminalInput = pasteHandlerCache.terminalInputs.find(input =>
                input && input.isConnected
            );

            // If cache has no connected inputs, refresh and try again
            if (!terminalInput) {
                console.log('Terminal Area Detector: Cache miss, refreshing...');
                updatePasteHandlerCache();
                terminalInput = pasteHandlerCache.terminalInputs.find(input =>
                    input && input.isConnected
                );
            }

            // Final fallback: query DOM directly
            if (!terminalInput) {
                terminalInput = findTerminalInput(document);
                if (terminalInput) {
                    console.log('Terminal Area Detector: Found via direct DOM query');
                    pasteHandlerCache.terminalInputs = [terminalInput];
                }
            }

            if (!terminalInput) {
                console.log('Terminal Area Detector: No terminal input found after all fallbacks');
                return false;
            }

            if (activeElement === terminalInput) {
                console.log('Terminal Area Detector: Active element is terminal input');
                return true;
            }

            // Check containers from cache first
            let inTerminal = pasteHandlerCache.terminalContainers.some(container =>
                container && container.isConnected && container.contains(activeElement)
            );

            // Fallback: check if active element is within any xterm container
            if (!inTerminal) {
                const xtermContainer = activeElement?.closest('.xterm');
                if (xtermContainer) {
                    inTerminal = true;
                    console.log('Terminal Area Detector: Found via .xterm closest');
                }
            }

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
            if (cacheUpdateTimeout) {
                clearTimeout(cacheUpdateTimeout);
                cacheUpdateTimeout = null;
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
})();
