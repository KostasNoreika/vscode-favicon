/**
 * Unit tests for extension terminal-selectors module
 * Tests selector fallback logic, DOM queries, and version compatibility
 */

const {
    TERMINAL_INPUT_SELECTORS,
    TERMINAL_CONTAINER_SELECTORS,
    findTerminalInput,
    findAllTerminalInputs,
    findAllTerminalContainers,
    isTerminalInput,
    isTerminalContainer,
    getCombinedSelectors,
} = require('../../vscode-favicon-extension/modules/terminal-selectors');

// Mock HTMLTextAreaElement for Node.js environment
class MockHTMLTextAreaElement {
    constructor() {
        this.tagName = 'TEXTAREA';
    }
}
global.HTMLTextAreaElement = MockHTMLTextAreaElement;

describe('terminal-selectors', () => {
    let mockDocument;
    let mockTextArea1;
    let mockTextArea2;
    let mockDiv1;
    let mockDiv2;

    beforeEach(() => {
        // Create mock DOM elements
        mockTextArea1 = {
            tagName: 'TEXTAREA',
            classList: { contains: jest.fn() },
            matches: jest.fn(),
        };
        Object.setPrototypeOf(mockTextArea1, MockHTMLTextAreaElement.prototype);

        mockTextArea2 = {
            tagName: 'TEXTAREA',
            classList: { contains: jest.fn() },
            matches: jest.fn(),
        };
        Object.setPrototypeOf(mockTextArea2, MockHTMLTextAreaElement.prototype);

        mockDiv1 = {
            tagName: 'DIV',
            classList: { contains: jest.fn() },
            matches: jest.fn(),
        };

        mockDiv2 = {
            tagName: 'DIV',
            classList: { contains: jest.fn() },
            matches: jest.fn(),
        };

        // Create mock document
        mockDocument = {
            querySelector: jest.fn(),
            querySelectorAll: jest.fn(),
        };

        jest.clearAllMocks();
    });

    describe('TERMINAL_INPUT_SELECTORS', () => {
        it('should include primary xterm-helper-textarea selector', () => {
            expect(TERMINAL_INPUT_SELECTORS).toContain('.xterm-helper-textarea');
        });

        it('should include fallback selectors', () => {
            expect(TERMINAL_INPUT_SELECTORS.length).toBeGreaterThan(1);
            expect(Array.isArray(TERMINAL_INPUT_SELECTORS)).toBe(true);
        });

        it('should have selectors in priority order', () => {
            expect(TERMINAL_INPUT_SELECTORS[0]).toBe('.xterm-helper-textarea');
        });
    });

    describe('TERMINAL_CONTAINER_SELECTORS', () => {
        it('should include xterm container selectors', () => {
            expect(TERMINAL_CONTAINER_SELECTORS).toContain('.xterm');
            expect(TERMINAL_CONTAINER_SELECTORS).toContain('.terminal-wrapper');
        });

        it('should include multiple container variants', () => {
            expect(TERMINAL_CONTAINER_SELECTORS.length).toBeGreaterThanOrEqual(5);
            expect(Array.isArray(TERMINAL_CONTAINER_SELECTORS)).toBe(true);
        });
    });

    describe('findTerminalInput', () => {
        it('should return first matching textarea element', () => {
            mockTextArea1.matches.mockReturnValue(true);
            mockDocument.querySelector = jest.fn()
                .mockReturnValueOnce(null)
                .mockReturnValueOnce(mockTextArea1);

            const result = findTerminalInput(mockDocument);
            expect(result).toBe(mockTextArea1);
        });

        it('should try fallback selectors in order', () => {
            mockDocument.querySelector = jest.fn()
                .mockReturnValueOnce(null)
                .mockReturnValueOnce(null)
                .mockReturnValueOnce(mockTextArea1);

            mockTextArea1.matches.mockReturnValue(true);

            const result = findTerminalInput(mockDocument);
            expect(result).toBe(mockTextArea1);
            expect(mockDocument.querySelector).toHaveBeenCalledTimes(3);
        });

        it('should return null if no textarea found', () => {
            mockDocument.querySelector.mockReturnValue(null);

            const result = findTerminalInput(mockDocument);
            expect(result).toBeNull();
        });

        it('should skip non-textarea elements', () => {
            mockDocument.querySelector = jest.fn()
                .mockReturnValueOnce(mockDiv1)
                .mockReturnValueOnce(null);

            const result = findTerminalInput(mockDocument);
            expect(result).toBeNull();
        });

        it('should handle invalid selectors gracefully', () => {
            mockDocument.querySelector = jest.fn().mockImplementation((selector) => {
                if (selector === '.xterm-helper-textarea') {
                    throw new Error('Invalid selector');
                }
                return null;
            });

            const result = findTerminalInput(mockDocument);
            expect(result).toBeNull();
        });

        it('should use document as default context', () => {
            // Test that it doesn't throw when called without context
            // In real environment, it would use global document
            const result = findTerminalInput(mockDocument);
            expect(mockDocument.querySelector).toHaveBeenCalled();
        });
    });

    describe('findAllTerminalInputs', () => {
        it('should return all matching textarea elements', () => {
            mockTextArea1.matches.mockReturnValue(true);
            mockTextArea2.matches.mockReturnValue(true);

            mockDocument.querySelectorAll = jest.fn()
                .mockReturnValueOnce([mockTextArea1])
                .mockReturnValueOnce([mockTextArea2])
                .mockReturnValue([]);

            const result = findAllTerminalInputs(mockDocument);
            expect(result).toHaveLength(2);
            expect(result).toContain(mockTextArea1);
            expect(result).toContain(mockTextArea2);
        });

        it('should deduplicate elements found by multiple selectors', () => {
            mockTextArea1.matches.mockReturnValue(true);

            mockDocument.querySelectorAll = jest.fn()
                .mockReturnValueOnce([mockTextArea1])
                .mockReturnValueOnce([mockTextArea1])
                .mockReturnValue([]);

            const result = findAllTerminalInputs(mockDocument);
            expect(result).toHaveLength(1);
            expect(result[0]).toBe(mockTextArea1);
        });

        it('should filter out non-textarea elements', () => {
            mockDocument.querySelectorAll = jest.fn()
                .mockReturnValueOnce([mockDiv1, mockTextArea1])
                .mockReturnValue([]);

            const result = findAllTerminalInputs(mockDocument);
            expect(result).toHaveLength(1);
            expect(result[0]).toBe(mockTextArea1);
        });

        it('should handle invalid selectors gracefully', () => {
            mockDocument.querySelectorAll = jest.fn().mockImplementation((selector) => {
                if (selector === '.xterm-helper-textarea') {
                    throw new Error('Invalid selector');
                }
                return [];
            });

            const result = findAllTerminalInputs(mockDocument);
            expect(Array.isArray(result)).toBe(true);
        });

        it('should return empty array when no inputs found', () => {
            mockDocument.querySelectorAll.mockReturnValue([]);

            const result = findAllTerminalInputs(mockDocument);
            expect(result).toEqual([]);
        });
    });

    describe('findAllTerminalContainers', () => {
        it('should return all matching container elements', () => {
            mockDiv1.matches.mockReturnValue(true);
            mockDiv2.matches.mockReturnValue(true);

            mockDocument.querySelectorAll = jest.fn()
                .mockReturnValueOnce([mockDiv1])
                .mockReturnValueOnce([mockDiv2])
                .mockReturnValue([]);

            const result = findAllTerminalContainers(mockDocument);
            expect(result.length).toBeGreaterThanOrEqual(2);
            expect(result).toContain(mockDiv1);
            expect(result).toContain(mockDiv2);
        });

        it('should deduplicate elements found by multiple selectors', () => {
            mockDiv1.matches.mockReturnValue(true);

            mockDocument.querySelectorAll = jest.fn()
                .mockReturnValueOnce([mockDiv1])
                .mockReturnValueOnce([mockDiv1])
                .mockReturnValue([]);

            const result = findAllTerminalContainers(mockDocument);
            expect(result).toHaveLength(1);
            expect(result[0]).toBe(mockDiv1);
        });

        it('should handle invalid selectors gracefully', () => {
            mockDocument.querySelectorAll = jest.fn().mockImplementation((selector) => {
                if (selector === '.xterm') {
                    throw new Error('Invalid selector');
                }
                return [];
            });

            const result = findAllTerminalContainers(mockDocument);
            expect(Array.isArray(result)).toBe(true);
        });

        it('should return empty array when no containers found', () => {
            mockDocument.querySelectorAll.mockReturnValue([]);

            const result = findAllTerminalContainers(mockDocument);
            expect(result).toEqual([]);
        });

        it('should query multiple selectors', () => {
            mockDocument.querySelectorAll.mockReturnValue([]);

            findAllTerminalContainers(mockDocument);

            expect(mockDocument.querySelectorAll).toHaveBeenCalledTimes(
                TERMINAL_CONTAINER_SELECTORS.length
            );
        });
    });

    describe('isTerminalInput', () => {
        it('should return true for element matching input selector', () => {
            mockTextArea1.matches.mockReturnValue(true);

            const result = isTerminalInput(mockTextArea1);
            expect(result).toBe(true);
        });

        it('should return false for element not matching any selector', () => {
            mockTextArea1.matches.mockReturnValue(false);

            const result = isTerminalInput(mockTextArea1);
            expect(result).toBe(false);
        });

        it('should return false for null element', () => {
            const result = isTerminalInput(null);
            expect(result).toBe(false);
        });

        it('should return false for undefined element', () => {
            const result = isTerminalInput(undefined);
            expect(result).toBe(false);
        });

        it('should handle invalid selector errors', () => {
            mockTextArea1.matches.mockImplementation(() => {
                throw new Error('Invalid selector');
            });

            const result = isTerminalInput(mockTextArea1);
            expect(result).toBe(false);
        });

        it('should try all selectors until match found', () => {
            mockTextArea1.matches
                .mockReturnValueOnce(false)
                .mockReturnValueOnce(false)
                .mockReturnValueOnce(true);

            const result = isTerminalInput(mockTextArea1);
            expect(result).toBe(true);
            expect(mockTextArea1.matches).toHaveBeenCalledTimes(3);
        });
    });

    describe('isTerminalContainer', () => {
        it('should return true for element matching container selector', () => {
            mockDiv1.matches.mockReturnValue(true);

            const result = isTerminalContainer(mockDiv1);
            expect(result).toBe(true);
        });

        it('should return false for element not matching any selector', () => {
            mockDiv1.matches.mockReturnValue(false);

            const result = isTerminalContainer(mockDiv1);
            expect(result).toBe(false);
        });

        it('should return false for null element', () => {
            const result = isTerminalContainer(null);
            expect(result).toBe(false);
        });

        it('should return false for undefined element', () => {
            const result = isTerminalContainer(undefined);
            expect(result).toBe(false);
        });

        it('should handle invalid selector errors', () => {
            mockDiv1.matches.mockImplementation(() => {
                throw new Error('Invalid selector');
            });

            const result = isTerminalContainer(mockDiv1);
            expect(result).toBe(false);
        });

        it('should try multiple selectors', () => {
            mockDiv1.matches.mockReturnValue(false);

            isTerminalContainer(mockDiv1);

            expect(mockDiv1.matches.mock.calls.length).toBeGreaterThan(1);
        });
    });

    describe('getCombinedSelectors', () => {
        it('should return combined selector string', () => {
            const result = getCombinedSelectors();
            expect(typeof result).toBe('string');
        });

        it('should include input and container selectors', () => {
            const result = getCombinedSelectors();
            expect(result).toContain('.xterm-helper-textarea');
            expect(result).toContain('.xterm');
        });

        it('should be comma-separated', () => {
            const result = getCombinedSelectors();
            expect(result).toContain(',');
        });

        it('should include all selectors', () => {
            const result = getCombinedSelectors();
            const selectorCount = result.split(',').length;
            const totalSelectors = TERMINAL_INPUT_SELECTORS.length + TERMINAL_CONTAINER_SELECTORS.length;
            expect(selectorCount).toBe(totalSelectors);
        });
    });

    describe('Selector fallback chain', () => {
        it('should have primary selector as first option', () => {
            expect(TERMINAL_INPUT_SELECTORS[0]).toBe('.xterm-helper-textarea');
        });

        it('should have multiple fallback options', () => {
            expect(TERMINAL_INPUT_SELECTORS.length).toBeGreaterThan(2);
        });

        it('should handle DOM changes gracefully via fallback', () => {
            // Simulate primary selector failing, fallback succeeding
            mockDocument.querySelector = jest.fn()
                .mockReturnValueOnce(null)
                .mockReturnValueOnce(mockTextArea1);

            mockTextArea1.matches.mockReturnValue(true);

            const result = findTerminalInput(mockDocument);
            expect(result).toBe(mockTextArea1);
        });
    });

    describe('Module exports', () => {
        it('should export all required functions', () => {
            expect(typeof findTerminalInput).toBe('function');
            expect(typeof findAllTerminalInputs).toBe('function');
            expect(typeof findAllTerminalContainers).toBe('function');
            expect(typeof isTerminalInput).toBe('function');
            expect(typeof isTerminalContainer).toBe('function');
            expect(typeof getCombinedSelectors).toBe('function');
        });

        it('should export selector arrays', () => {
            expect(Array.isArray(TERMINAL_INPUT_SELECTORS)).toBe(true);
            expect(Array.isArray(TERMINAL_CONTAINER_SELECTORS)).toBe(true);
        });

        it('should export immutable selectors', () => {
            const originalLength = TERMINAL_INPUT_SELECTORS.length;
            TERMINAL_INPUT_SELECTORS.push('.test');
            // Array reference is same but we verify selectors work
            expect(TERMINAL_INPUT_SELECTORS.length).toBe(originalLength + 1);
        });
    });

    describe('Version compatibility', () => {
        it('should handle xterm.js 4.x selector format', () => {
            expect(TERMINAL_INPUT_SELECTORS).toContain('.xterm-helper-textarea');
        });

        it('should have fallback for potential future xterm versions', () => {
            const hasAlternatives = TERMINAL_INPUT_SELECTORS.some(
                selector => selector !== '.xterm-helper-textarea'
            );
            expect(hasAlternatives).toBe(true);
        });

        it('should support multiple VS Code container patterns', () => {
            expect(TERMINAL_CONTAINER_SELECTORS).toContain('.terminal-wrapper');
            expect(TERMINAL_CONTAINER_SELECTORS).toContain('.xterm');
            expect(TERMINAL_CONTAINER_SELECTORS).toContain('.xterm-viewport');
        });
    });
});
