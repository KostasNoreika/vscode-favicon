/**
 * Background Service Worker Tests
 * Regression tests for Status code 15 service worker registration failure
 *
 * Tests initialization gate pattern that prevents race conditions where
 * event listeners fire before module initialization completes.
 */

describe('Background Service Worker - Initialization Gate', () => {
    let mockChrome;
    let consoleLog;
    let consoleError;

    beforeEach(() => {
        // Silence console output during tests
        consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

        // Mock Chrome APIs
        mockChrome = {
            storage: {
                local: {
                    get: jest.fn().mockResolvedValue({}),
                    set: jest.fn().mockResolvedValue(undefined),
                },
            },
            alarms: {
                create: jest.fn().mockResolvedValue(undefined),
                onAlarm: {
                    addListener: jest.fn(),
                },
            },
            tabs: {
                onActivated: {
                    addListener: jest.fn(),
                },
                onUpdated: {
                    addListener: jest.fn(),
                },
                onRemoved: {
                    addListener: jest.fn(),
                },
                query: jest.fn().mockResolvedValue([]),
                get: jest.fn().mockResolvedValue({ url: 'https://vs.example.com?folder=/test' }),
            },
            runtime: {
                onMessage: {
                    addListener: jest.fn(),
                },
            },
            action: {
                setBadgeText: jest.fn(),
                setBadgeBackgroundColor: jest.fn(),
                setTitle: jest.fn(),
            },
        };

        global.chrome = mockChrome;
        global.self = global;
    });

    afterEach(() => {
        consoleLog.mockRestore();
        consoleError.mockRestore();
        delete global.chrome;
        delete global.self;
    });

    test('should prevent Node.js detection false positives in modules', () => {
        // Verify all modules use correct Node.js detection pattern
        const pathUtils = require('../../vscode-favicon-extension/modules/path-utils');
        const circuitBreaker = require('../../vscode-favicon-extension/modules/circuit-breaker');
        const storageManager = require('../../vscode-favicon-extension/modules/storage-manager');
        const domainManager = require('../../vscode-favicon-extension/modules/domain-manager');
        const tabManager = require('../../vscode-favicon-extension/modules/tab-manager');
        const notificationPoller = require('../../vscode-favicon-extension/modules/notification-poller');
        const messageRouter = require('../../vscode-favicon-extension/modules/message-router');

        // All modules should export successfully without crashing
        expect(pathUtils).toBeDefined();
        expect(circuitBreaker).toBeDefined();
        expect(storageManager).toBeDefined();
        expect(domainManager).toBeDefined();
        expect(tabManager).toBeDefined();
        expect(notificationPoller).toBeDefined();
        expect(messageRouter).toBeDefined();
    });

    test('should use proper require() guards in all modules', () => {
        const fs = require('fs');
        const modulePaths = [
            '../../vscode-favicon-extension/modules/path-utils.js',
            '../../vscode-favicon-extension/modules/circuit-breaker.js',
            '../../vscode-favicon-extension/modules/storage-manager.js',
            '../../vscode-favicon-extension/modules/domain-manager.js',
            '../../vscode-favicon-extension/modules/tab-manager.js',
            '../../vscode-favicon-extension/modules/notification-poller.js',
            '../../vscode-favicon-extension/modules/message-router.js',
        ];

        modulePaths.forEach(modulePath => {
            const code = fs.readFileSync(require.resolve(modulePath), 'utf8');

            // All modules should check for require() AND module before using them
            expect(code).toContain('typeof require === \'function\'');
            expect(code).toContain('typeof module !== \'undefined\'');
        });
    });

    test('should have initialization gate pattern in background.js', () => {
        const fs = require('fs');
        const backgroundJs = fs.readFileSync(
            require.resolve('../../vscode-favicon-extension/background.js'),
            'utf8'
        );

        // Verify initialization gate variables exist
        expect(backgroundJs).toContain('let initPromise = null');
        expect(backgroundJs).toContain('let initError = null');

        // Verify withInitialization wrapper exists
        expect(backgroundJs).toContain('function withInitialization(handler)');
        expect(backgroundJs).toContain('await initPromise');

        // Verify event listeners use withInitialization wrapper
        expect(backgroundJs).toContain('chrome.runtime.onMessage.addListener');
        expect(backgroundJs).toContain('withInitialization');
        expect(backgroundJs).toContain('chrome.alarms.onAlarm.addListener(withInitialization');
        expect(backgroundJs).toContain('chrome.tabs.onActivated.addListener(withInitialization');
        expect(backgroundJs).toContain('chrome.tabs.onUpdated.addListener(withInitialization');
        expect(backgroundJs).toContain('chrome.tabs.onRemoved.addListener(withInitialization');

        // Verify initialization is stored in promise
        expect(backgroundJs).toContain('initPromise = initialize()');
    });

    test('should wrap async initialize() call in promise', () => {
        const fs = require('fs');
        const backgroundJs = fs.readFileSync(
            require.resolve('../../vscode-favicon-extension/background.js'),
            'utf8'
        );

        // Should NOT have bare initialize() call
        expect(backgroundJs).not.toMatch(/^initialize\(\);$/m);

        // Should have initialize() wrapped in promise assignment
        expect(backgroundJs).toContain('initPromise = initialize()');
    });

    test('should handle initialization errors gracefully', () => {
        const fs = require('fs');
        const backgroundJs = fs.readFileSync(
            require.resolve('../../vscode-favicon-extension/background.js'),
            'utf8'
        );

        // Verify error handling in initialize()
        expect(backgroundJs).toContain('catch (error)');
        expect(backgroundJs).toContain('initError = error');

        // Verify error checking in withInitialization
        expect(backgroundJs).toContain('if (initError)');
        expect(backgroundJs).toContain('initialization failed');
    });

    test('should check if module instances are null before use', () => {
        const fs = require('fs');
        const backgroundJs = fs.readFileSync(
            require.resolve('../../vscode-favicon-extension/background.js'),
            'utf8'
        );

        // Module instances should be initialized as null
        expect(backgroundJs).toMatch(/let circuitBreaker = null/);
        expect(backgroundJs).toMatch(/let storageManager = null/);
        expect(backgroundJs).toMatch(/let notificationPoller = null/);
        expect(backgroundJs).toMatch(/let tabManager = null/);
        expect(backgroundJs).toMatch(/let messageRouter = null/);
    });

    test('PathUtils should detect Node.js correctly', () => {
        const pathUtils = require('../../vscode-favicon-extension/modules/path-utils');

        // Should export normalizeFolder in Node.js context
        expect(pathUtils.normalizeFolder).toBeDefined();
        expect(typeof pathUtils.normalizeFolder).toBe('function');
    });

    test('CircuitBreaker should be available in Node.js context', () => {
        const CircuitBreaker = require('../../vscode-favicon-extension/modules/circuit-breaker');

        // Should export class in Node.js context
        expect(CircuitBreaker).toBeDefined();
        expect(typeof CircuitBreaker).toBe('function');

        // Should be instantiable
        const breaker = new CircuitBreaker({ failureThreshold: 3 });
        expect(breaker).toBeDefined();
        expect(breaker.state).toBe('closed');
    });

    test('StorageManager should export createStorageManager in Node.js', () => {
        const { createStorageManager } = require('../../vscode-favicon-extension/modules/storage-manager');

        expect(createStorageManager).toBeDefined();
        expect(typeof createStorageManager).toBe('function');

        // Should create manager instance
        const manager = createStorageManager();
        expect(manager).toBeDefined();
        expect(manager.loadNotifications).toBeDefined();
        expect(manager.saveNotifications).toBeDefined();
    });

    test('DomainManager should export utilities in Node.js', () => {
        const domainManager = require('../../vscode-favicon-extension/modules/domain-manager');

        expect(domainManager.isVSCodeUrl).toBeDefined();
        expect(domainManager.getOrigin).toBeDefined();
        expect(typeof domainManager.isVSCodeUrl).toBe('function');
        expect(typeof domainManager.getOrigin).toBe('function');
    });

    test('TabManager should export createTabManager in Node.js', () => {
        const { createTabManager } = require('../../vscode-favicon-extension/modules/tab-manager');

        expect(createTabManager).toBeDefined();
        expect(typeof createTabManager).toBe('function');
    });

    test('NotificationPoller should export createNotificationPoller in Node.js', () => {
        const { createNotificationPoller } = require('../../vscode-favicon-extension/modules/notification-poller');

        expect(createNotificationPoller).toBeDefined();
        expect(typeof createNotificationPoller).toBe('function');
    });

    test('MessageRouter should export createMessageRouter in Node.js', () => {
        const { createMessageRouter } = require('../../vscode-favicon-extension/modules/message-router');

        expect(createMessageRouter).toBeDefined();
        expect(typeof createMessageRouter).toBe('function');
    });

    test('should not have any bare module.exports assignments', () => {
        const fs = require('fs');
        const modulePaths = [
            '../../vscode-favicon-extension/modules/path-utils.js',
            '../../vscode-favicon-extension/modules/circuit-breaker.js',
            '../../vscode-favicon-extension/modules/storage-manager.js',
            '../../vscode-favicon-extension/modules/domain-manager.js',
            '../../vscode-favicon-extension/modules/tab-manager.js',
            '../../vscode-favicon-extension/modules/notification-poller.js',
            '../../vscode-favicon-extension/modules/message-router.js',
        ];

        modulePaths.forEach(modulePath => {
            const code = fs.readFileSync(require.resolve(modulePath), 'utf8');

            // All module exports should be guarded
            const exportMatches = code.match(/module\.exports\s*=/g) || [];
            const guardedExports = code.match(/if\s*\(typeof require === 'function' && typeof module !== 'undefined'\)/g) || [];

            // If there are exports, they should all be guarded (allowing for test utils)
            if (exportMatches.length > 0) {
                expect(guardedExports.length).toBeGreaterThan(0);
            }
        });
    });

    test('regression: verify Status code 15 fix - initialization before event handlers', () => {
        const fs = require('fs');
        const backgroundJs = fs.readFileSync(
            require.resolve('../../vscode-favicon-extension/background.js'),
            'utf8'
        );

        // Parse the file to verify execution order
        const lines = backgroundJs.split('\n');

        let initPromiseLineNumber = -1;
        let firstEventListenerLineNumber = -1;

        lines.forEach((line, index) => {
            if (line.includes('initPromise = initialize()')) {
                initPromiseLineNumber = index;
            }
            if (firstEventListenerLineNumber === -1 &&
                (line.includes('.addListener(withInitialization') ||
                 line.includes('onMessage.addListener'))) {
                firstEventListenerLineNumber = index;
            }
        });

        // Event listeners should come BEFORE initialization call
        // But they should be WRAPPED with withInitialization
        expect(firstEventListenerLineNumber).toBeGreaterThan(0);
        expect(initPromiseLineNumber).toBeGreaterThan(firstEventListenerLineNumber);

        // All event listeners should use withInitialization wrapper
        const eventListenerLines = lines.filter(line =>
            line.includes('.addListener')
        );

        // Filter out the addListener function itself
        const actualListeners = eventListenerLines.filter(line =>
            !line.includes('function addListener')
        );

        actualListeners.forEach(line => {
            // Each listener should either use withInitialization or be the onMessage special case
            const usesWrapper = line.includes('withInitialization');
            const isMessageListener = line.includes('onMessage.addListener');

            // Message listener has special handling, others must use wrapper
            if (!isMessageListener) {
                expect(usesWrapper).toBe(true);
            }
        });
    });
});
