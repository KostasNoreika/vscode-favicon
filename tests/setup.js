/**
 * Jest Global Setup
 *
 * Runs before all tests to configure test environment
 */

// Set default timeout for all tests
jest.setTimeout(10000);

// Suppress console output during tests unless DEBUG is set
if (!process.env.DEBUG) {
    global.console = {
        ...console,
        log: jest.fn(),
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        // Keep error and trace for debugging test failures
        error: console.error,
        trace: console.trace,
    };
}

// Global test utilities
global.testUtils = {
    /**
     * Create a temporary test path
     */
    createTestPath: (base, ...segments) => {
        const path = require('path');
        return path.join(base, ...segments);
    },

    /**
     * Wait for a promise with timeout
     */
    waitFor: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),

    /**
     * Create mock request object for Express tests
     */
    mockRequest: (options = {}) => ({
        body: options.body || {},
        params: options.params || {},
        query: options.query || {},
        headers: options.headers || {},
        method: options.method || 'GET',
        path: options.path || '/',
        ...options,
    }),

    /**
     * Create mock response object for Express tests
     */
    mockResponse: () => {
        const res = {};
        res.status = jest.fn().mockReturnValue(res);
        res.json = jest.fn().mockReturnValue(res);
        res.send = jest.fn().mockReturnValue(res);
        res.set = jest.fn().mockReturnValue(res);
        res.setHeader = jest.fn().mockReturnValue(res);
        return res;
    },
};

// Setup and teardown for test environment
beforeAll(() => {
    // Global setup
    process.env.NODE_ENV = 'test';
    // Set log level for tests (suppress logs unless DEBUG is set)
    process.env.LOG_LEVEL = process.env.DEBUG ? 'debug' : 'error';
});

afterAll(() => {
    // Global cleanup
    delete process.env.NODE_ENV;
    delete process.env.LOG_LEVEL;
});
