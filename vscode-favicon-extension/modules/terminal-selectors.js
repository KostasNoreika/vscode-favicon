/**
 * Terminal selectors module
 * Centralized VS Code/xterm terminal DOM selectors with version compatibility tracking
 *
 * This module provides a single source of truth for all terminal-related selectors,
 * making it easier to maintain compatibility when VS Code/xterm DOM changes occur.
 */

/**
 * Terminal input textarea selectors
 * Used to find the hidden textarea element that handles terminal input
 *
 * Compatibility:
 * - VS Code 1.60+ / xterm.js 4.x: .xterm-helper-textarea (primary)
 * - Fallback options for future xterm.js versions
 */
const TERMINAL_INPUT_SELECTORS = [
    '.xterm-helper-textarea',  // VS Code 1.60+ / xterm.js 4.x+ (current standard)
    'textarea.xterm-helper',   // Potential future variant
    '.xterm textarea',         // Fallback: textarea within xterm container
];

/**
 * Terminal container selectors
 * Used to find terminal container elements and check visibility
 *
 * Compatibility:
 * - VS Code 1.60+: Multiple container patterns for terminal panels
 */
const TERMINAL_CONTAINER_SELECTORS = [
    '.xterm',                              // VS Code 1.60+ (xterm.js core container)
    '.terminal-wrapper',                   // VS Code wrapper element
    '.terminal',                           // Generic terminal container
    '.xterm-viewport',                     // xterm.js viewport element
    '.panel .terminal',                    // Terminal in panel area
    '.part.panel .terminal-outer-container', // Full panel path
    '[id*="workbench.panel.terminal"]',    // Terminal workbench panel
];

/**
 * Find terminal input element with fallback
 * Tries selectors in order and returns first valid element
 *
 * @param {Document|HTMLElement} context - Search context (defaults to document)
 * @returns {HTMLElement|null} - Terminal input element or null if not found
 */
function findTerminalInput(context = document) {
    for (const selector of TERMINAL_INPUT_SELECTORS) {
        try {
            const element = context.querySelector(selector);
            if (element && element instanceof HTMLTextAreaElement) {
                return element;
            }
        } catch (error) {
            console.warn('Terminal Selectors: Invalid selector:', selector, error.message);
        }
    }
    return null;
}

/**
 * Find all terminal input elements with fallback
 * Tries selectors in order and returns all valid elements
 *
 * @param {Document|HTMLElement} context - Search context (defaults to document)
 * @returns {HTMLElement[]} - Array of terminal input elements
 */
function findAllTerminalInputs(context = document) {
    const inputs = [];
    const seen = new Set();

    for (const selector of TERMINAL_INPUT_SELECTORS) {
        try {
            const elements = context.querySelectorAll(selector);
            for (const element of elements) {
                if (element instanceof HTMLTextAreaElement && !seen.has(element)) {
                    inputs.push(element);
                    seen.add(element);
                }
            }
        } catch (error) {
            console.warn('Terminal Selectors: Invalid selector:', selector, error.message);
        }
    }

    return inputs;
}

/**
 * Find all terminal container elements
 * Returns all matching container elements across all selectors
 *
 * @param {Document|HTMLElement} context - Search context (defaults to document)
 * @returns {HTMLElement[]} - Array of terminal container elements
 */
function findAllTerminalContainers(context = document) {
    const containers = [];
    const seen = new Set();

    for (const selector of TERMINAL_CONTAINER_SELECTORS) {
        try {
            const elements = context.querySelectorAll(selector);
            for (const element of elements) {
                if (!seen.has(element)) {
                    containers.push(element);
                    seen.add(element);
                }
            }
        } catch (error) {
            console.warn('Terminal Selectors: Invalid selector:', selector, error.message);
        }
    }

    return containers;
}

/**
 * Check if element matches any terminal input selector
 *
 * @param {HTMLElement} element - Element to check
 * @returns {boolean} - True if element matches any input selector
 */
function isTerminalInput(element) {
    if (!element) return false;

    for (const selector of TERMINAL_INPUT_SELECTORS) {
        try {
            if (element.matches(selector)) {
                return true;
            }
        } catch (error) {
            // Invalid selector, continue
        }
    }

    return false;
}

/**
 * Check if element matches any terminal container selector
 *
 * @param {HTMLElement} element - Element to check
 * @returns {boolean} - True if element matches any container selector
 */
function isTerminalContainer(element) {
    if (!element) return false;

    for (const selector of TERMINAL_CONTAINER_SELECTORS) {
        try {
            if (element.matches(selector)) {
                return true;
            }
        } catch (error) {
            // Invalid selector, continue
        }
    }

    return false;
}

/**
 * Get combined selector string for MutationObserver monitoring
 * Useful for checking if added/removed nodes match terminal selectors
 *
 * @returns {string} - Combined selector string
 */
function getCombinedSelectors() {
    return [...TERMINAL_INPUT_SELECTORS, ...TERMINAL_CONTAINER_SELECTORS].join(', ');
}

// Export for both Node.js and browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        TERMINAL_INPUT_SELECTORS,
        TERMINAL_CONTAINER_SELECTORS,
        findTerminalInput,
        findAllTerminalInputs,
        findAllTerminalContainers,
        isTerminalInput,
        isTerminalContainer,
        getCombinedSelectors,
    };
} else if (typeof window !== 'undefined') {
    window.TerminalSelectors = {
        TERMINAL_INPUT_SELECTORS,
        TERMINAL_CONTAINER_SELECTORS,
        findTerminalInput,
        findAllTerminalInputs,
        findAllTerminalContainers,
        isTerminalInput,
        isTerminalContainer,
        getCombinedSelectors,
    };
}
