/**
 * Jest Configuration for vscode-favicon
 *
 * Comprehensive test configuration with:
 * - Coverage thresholds (70% for core lib/ modules)
 * - Separate unit/integration test paths
 * - Performance timeout configuration
 * - Proper ignore patterns for node_modules
 */

module.exports = {
    // Test environment
    testEnvironment: 'node',

    // Test file patterns
    testMatch: ['**/tests/**/*.test.js', '**/tests/**/*.spec.js'],

    // Ignore patterns
    testPathIgnorePatterns: [
        '/node_modules/',
        '/vscode-favicon-service/node_modules/',
        '/vscode-favicon-api/node_modules/',
        '/vscode-favicon-extension/',
        '/coverage/',
        '/.git/',
    ],

    // Coverage collection - Core lib/ modules only
    // Excluded modules are API-specific and tested via integration tests:
    // - notification-store.js (API notification system)
    // - registry-cache.js (API registry caching)
    // - config.js (runtime configuration, tested via integration)
    // - logger.js (logging utility, tested via integration)
    collectCoverageFrom: [
        'lib/**/*.js',
        '!lib/notification-store.js', // API-only module
        '!lib/registry-cache.js', // API-only module
        '!lib/config.js', // Runtime config (integration tested)
        '!lib/logger.js', // Logging utility (integration tested)
        '!**/node_modules/**',
        '!**/tests/**',
        '!**/coverage/**',
        '!**/*.config.js',
    ],

    // Coverage output
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'text-summary', 'lcov', 'html', 'json'],

    // Coverage thresholds - Core lib/ modules (70% baseline)
    coverageThreshold: {
        global: {
            branches: 70,
            functions: 70,
            lines: 70,
            statements: 70,
        },
        // Critical security modules - maintain high coverage
        './lib/path-validator.js': {
            branches: 70, // Currently at 70.96%
            functions: 70, // Currently at 78.57%
            lines: 70, // Currently at 74.1%
            statements: 70, // Currently at 74.33%
        },
        './lib/svg-sanitizer.js': {
            branches: 80, // Currently at 96.66% - maintain high standard
            functions: 80, // Currently at 100%
            lines: 80, // Currently at 97.61%
            statements: 80, // Currently at 97.61%
        },
        './lib/cors-config.js': {
            branches: 80, // Currently at 100%
            functions: 80, // Currently at 100%
            lines: 80, // Currently at 100%
            statements: 80, // Currently at 100%
        },
        './lib/lru-cache.js': {
            branches: 80, // Currently at 100%
            functions: 80, // Currently at 100%
            lines: 80, // Currently at 100%
            statements: 80, // Currently at 100%
        },
        './lib/validators.js': {
            branches: 50, // Currently at 50%
            functions: 60, // Currently at 62.5%
            lines: 60, // Currently at 65.71%
            statements: 60, // Currently at 65.71%
        },
    },

    // Test execution
    verbose: true,
    testTimeout: 10000,

    // Setup files
    setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],

    // Module paths
    moduleDirectories: ['node_modules', '<rootDir>'],

    // Transform settings (if needed for ES modules in future)
    transform: {},

    // Performance and concurrency
    maxWorkers: '50%', // Use half of available CPU cores

    // Error handling
    bail: false, // Continue running tests after first failure
    errorOnDeprecated: true,

    // Clear mocks between tests
    clearMocks: true,
    resetMocks: false,
    restoreMocks: true,

    // Notify on completion (useful for watch mode)
    notify: false,
    notifyMode: 'failure-change',
};
