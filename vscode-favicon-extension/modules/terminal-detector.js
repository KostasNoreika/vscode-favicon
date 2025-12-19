/**
 * Terminal detection module
 * Handles terminal visibility detection and state change notifications
 */

(function() {
    'use strict';

    // Import terminal selectors for centralized selector management
    const { TERMINAL_CONTAINER_SELECTORS } = typeof window !== 'undefined'
        ? window.TerminalSelectors
        : require('./terminal-selectors.js');

    /**
     * Create terminal detector
     * @param {object} deps - Dependencies
     * @param {Function} deps.onTerminalStateChange - Callback when terminal state changes
     * @param {number} deps.updateThrottle - Throttle time for updates (ms)
     * @returns {object} - Terminal detector instance
     */
    function createTerminalDetector(deps) {
        const { onTerminalStateChange, updateThrottle = 500 } = deps;

        let terminalOpen = false;
        let terminalObserver = null;
        let terminalUpdateTimeout = null;

        /**
         * Check if element is visible
         * @param {HTMLElement} element - Element to check
         * @returns {boolean} - True if visible
         */
        function isElementVisible(element) {
            if (!element) return false;

            const style = window.getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                return false;
            }

            const rect = element.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) {
                return false;
            }

            return true;
        }

        /**
         * Check if terminal is open
         * @returns {boolean} - True if terminal is visible
         */
        function hasOpenTerminal() {
            for (const selector of TERMINAL_CONTAINER_SELECTORS) {
                const elements = document.querySelectorAll(selector);
                for (const element of elements) {
                    if (isElementVisible(element)) {
                        return true;
                    }
                }
            }
            return false;
        }

        /**
         * Check terminal state and trigger callback if changed
         */
        function checkTerminalState() {
            const currentTerminalState = hasOpenTerminal();

            if (currentTerminalState !== terminalOpen) {
                terminalOpen = currentTerminalState;
                console.log(`Terminal Detector: Terminal ${terminalOpen ? 'OPENED' : 'CLOSED'}`);

                if (onTerminalStateChange) {
                    onTerminalStateChange(terminalOpen);
                }
            }
        }

        /**
         * Setup MutationObserver for terminal state changes
         */
        function setupObserver() {
            if (terminalObserver) {
                terminalObserver.disconnect();
                terminalObserver = null;
            }

            const targetElement = document.querySelector('.part.panel') || document.body;

            terminalObserver = new MutationObserver(() => {
                if (terminalUpdateTimeout) {
                    clearTimeout(terminalUpdateTimeout);
                }

                terminalUpdateTimeout = setTimeout(() => {
                    checkTerminalState();
                    terminalUpdateTimeout = null;
                }, updateThrottle);
            });

            terminalObserver.observe(targetElement, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['style', 'class']
            });

            // Initial check
            checkTerminalState();

            console.log('Terminal Detector: Observer initialized');
        }

        /**
         * Cleanup observer
         */
        function cleanup() {
            if (terminalObserver) {
                terminalObserver.disconnect();
                terminalObserver = null;
            }
            if (terminalUpdateTimeout) {
                clearTimeout(terminalUpdateTimeout);
                terminalUpdateTimeout = null;
            }
        }

        /**
         * Get current terminal state
         * @returns {boolean} - True if terminal is open
         */
        function isTerminalOpen() {
            return terminalOpen;
        }

        return {
            setupObserver,
            cleanup,
            isTerminalOpen,
            checkTerminalState,
        };
    }

    // Export for both Node.js and browser
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { createTerminalDetector };
    } else if (typeof window !== 'undefined') {
        window.TerminalDetector = { createTerminalDetector };
    }
})();
