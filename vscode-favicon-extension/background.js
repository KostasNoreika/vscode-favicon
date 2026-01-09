// VS Code Favicon Extension - Background Service Worker
// Uses chrome.alarms for reliable polling (Service Workers don't support EventSource/setTimeout)

// Load all modules via importScripts() - service workers don't support require() or ES modules
// Order matters: dependencies must be loaded before dependents
importScripts(
    './modules/path-utils.js',         // Base - no dependencies
    './modules/circuit-breaker.js',     // Base - no dependencies
    './modules/storage-manager.js',     // Base - no dependencies
    './modules/domain-manager.js',      // Base - no dependencies
    './modules/tab-group-manager.js',   // Base - no dependencies (uses chrome.tabs/tabGroups APIs)
    './modules/tab-manager.js',         // Depends on: path-utils, tab-group-manager
    './modules/notification-poller.js', // Depends on: tab-manager
    './modules/message-router.js'       // Depends on: path-utils, domain-manager, storage-manager
);

// Access modules via service worker global (self.*)
// Note: CircuitBreaker class is already in global scope from importScripts
// (class declarations go directly to global, unlike factory functions/objects)
const { createStorageManager } = self.StorageManager;
const { createNotificationPoller } = self.NotificationPoller;
const { createTabManager } = self.TabManager;
const { createMessageRouter } = self.MessageRouter;
const DomainManager = self.DomainManager;

// Production API - VM has symlinks to match Mac Studio paths
const DEFAULT_API_BASE = 'https://favicon-api.noreika.lt';

const CONFIG = {
    API_BASE: DEFAULT_API_BASE,
    POLL_INTERVAL_MINUTES: 1,
    API_TIMEOUT: 10000,
    STORAGE_KEY: 'notifications',
    API_URL_STORAGE_KEY: 'apiBaseUrl',
    STORAGE_RETRY_ATTEMPTS: 3,
    STORAGE_INITIAL_BACKOFF: 100,
    STORAGE_MAX_BACKOFF: 5000,
    STORAGE_ERROR_THRESHOLD: 3,
    CIRCUIT_BREAKER_FAILURE_THRESHOLD: 3,
    CIRCUIT_BREAKER_INITIAL_BACKOFF: 5000,
    CIRCUIT_BREAKER_MAX_BACKOFF: 5 * 60 * 1000,
};

// Module instances
let circuitBreaker = null;
let storageManager = null;
let notificationPoller = null;
let tabManager = null;
let messageRouter = null;

// Initialization gate - prevents race conditions where events fire before modules are ready
let initPromise = null;
let initError = null;

// Track tabs that have had content script injected
const injectedTabs = new Set();

/**
 * Inject content script into VS Code Server tab
 * Detects any URL with ?folder= parameter (universal VS Code Server detection)
 * Prevents double injection via injectedTabs set and content script guard
 *
 * @param {number} tabId - Chrome tab ID
 * @param {string} url - Full URL (used for logging)
 * @returns {Promise<boolean>} - True if injection successful
 */
async function injectContentScript(tabId, url) {
    if (injectedTabs.has(tabId)) {
        console.log('VS Code Favicon BG: Tab already injected:', tabId);
        return false;
    }

    try {
        // Inject modules first, then main content script
        await chrome.scripting.executeScript({
            target: { tabId },
            files: [
                'modules/path-utils.js',
                'modules/time-utils.js',
                'modules/dom-utils.js',
                'modules/badge-manager.js',
                'modules/terminal-selectors.js',
                'modules/terminal-area-detector.js',
                'modules/terminal-detector.js',
                'modules/clipboard-handler.js',
                'modules/notification-panel.js',
                'modules/favicon-finder.js',
                'modules/favicon-updater.js',
                'content-project-favicon.js'
            ]
        });

        injectedTabs.add(tabId);

        // Track domain for statistics (optional)
        const origin = DomainManager.getOrigin(url);
        if (origin) {
            await DomainManager.addDomain(origin);
        }

        console.log('VS Code Favicon BG: Content script injected into tab:', tabId, url);
        return true;
    } catch (error) {
        console.error('VS Code Favicon BG: Injection failed:', error.message);
        return false;
    }
}

/**
 * Initialize background service worker
 */
async function initialize() {
    console.log('VS Code Favicon BG: Initializing...');

    try {
        // Load API base URL from storage
        try {
            const stored = await chrome.storage.local.get('apiBaseUrl');
            if (stored.apiBaseUrl) {
                CONFIG.API_BASE = stored.apiBaseUrl;
                console.log('VS Code Favicon BG: Loaded API base URL:', CONFIG.API_BASE);
            }
        } catch (error) {
            console.warn('VS Code Favicon BG: Failed to load API base URL from storage:', error.message);
            // Continue with default
        }

        // Initialize circuit breaker
        circuitBreaker = new CircuitBreaker({
            failureThreshold: CONFIG.CIRCUIT_BREAKER_FAILURE_THRESHOLD,
            initialBackoffDelay: CONFIG.CIRCUIT_BREAKER_INITIAL_BACKOFF,
            maxBackoffDelay: CONFIG.CIRCUIT_BREAKER_MAX_BACKOFF,
        });
        await circuitBreaker.loadState();

        // Initialize storage manager
        storageManager = createStorageManager(
            {
                STORAGE_KEY: CONFIG.STORAGE_KEY,
                STORAGE_RETRY_ATTEMPTS: CONFIG.STORAGE_RETRY_ATTEMPTS,
                STORAGE_INITIAL_BACKOFF: CONFIG.STORAGE_INITIAL_BACKOFF,
                STORAGE_MAX_BACKOFF: CONFIG.STORAGE_MAX_BACKOFF,
                STORAGE_ERROR_THRESHOLD: CONFIG.STORAGE_ERROR_THRESHOLD,
            },
            // Badge update callback (will be set after tabManager is created)
            null
        );

        // Load notifications from storage
        const notifications = await storageManager.loadNotifications();

        // Initialize tab manager
        tabManager = createTabManager({
            getNotifications: () => notificationPoller.getNotifications(),
            updateBadge: null, // Will be set to its own updateIconBadge
        });

        // Initialize notification poller
        notificationPoller = createNotificationPoller(
            {
                circuitBreaker,
                getApiBase: () => CONFIG.API_BASE,
                saveNotifications: (notifications) => storageManager.saveNotifications(notifications),
                broadcastNotifications: () => tabManager.broadcastNotifications(),
            },
            {
                POLL_INTERVAL_MINUTES: CONFIG.POLL_INTERVAL_MINUTES,
                API_TIMEOUT: CONFIG.API_TIMEOUT,
            }
        );

        // Set initial notifications
        notificationPoller.setNotifications(notifications);

        // Initialize message router
        messageRouter = createMessageRouter({
            getNotifications: () => notificationPoller.getNotifications(),
            getFilteredNotifications: () => tabManager.getFilteredNotifications(),
            switchToTab: (folder) => tabManager.switchToTab(folder),
            handleTerminalStateChange: (folder, hasTerminal, tabId) =>
                tabManager.handleTerminalStateChange(folder, hasTerminal, tabId),
            broadcastNotifications: () => tabManager.broadcastNotifications(),
            fetchNotifications: () => notificationPoller.fetchNotifications(),
            markRead: (folder) => notificationPoller.markRead(folder),
            markAllRead: () => notificationPoller.markAllRead(),
            getCircuitBreakerStatus: () => circuitBreaker.getStats(),
            getApiBase: () => CONFIG.API_BASE,
        });

        // Update badge based on loaded notifications
        tabManager.updateIconBadge();

        // Setup polling alarm
        await notificationPoller.setupPolling();

        // Fetch fresh notifications
        await notificationPoller.fetchNotifications();

        console.log('VS Code Favicon BG: Initialization complete');
    } catch (error) {
        console.error('VS Code Favicon BG: Initialization failed:', error);
        initError = error;
        throw error;
    }
}

/**
 * Wait for initialization to complete before executing event handler
 * Prevents race conditions where events fire before modules are ready
 * @param {Function} handler - Event handler function
 * @returns {Function} - Wrapped handler that waits for initialization
 */
function withInitialization(handler) {
    return async function(...args) {
        try {
            // Wait for initialization to complete (with 10s timeout)
            if (initPromise) {
                const INIT_TIMEOUT_MS = 10000;
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('Initialization timeout after 10s')), INIT_TIMEOUT_MS);
                });
                try {
                    await Promise.race([initPromise, timeoutPromise]);
                } catch (timeoutErr) {
                    console.error('VS Code Favicon BG: Init timeout, proceeding anyway:', timeoutErr.message);
                    // Don't return - try to run handler anyway
                }
            }

            // Check if initialization failed
            if (initError) {
                console.error('VS Code Favicon BG: Handler skipped - initialization failed:', initError.message);
                return { error: initError.message };
            }

            // Run the handler
            console.log('VS Code Favicon BG: Running handler after init');
            return await handler(...args);
        } catch (error) {
            console.error('VS Code Favicon BG: Handler error:', error);
            return { error: error.message };
        }
    };
}

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // DEBUG: Log all incoming messages
    if (message.type === 'UPLOAD_FILE') {
        console.log('VS Code Favicon BG: UPLOAD_FILE received', {
            hasFileData: !!message.fileData,
            fileDataLength: message.fileData?.length || 0,
            fileName: message.fileName,
            fileType: message.fileType,
            folder: message.folder,
            initError: initError?.message || null,
        });
    }

    // Handle async response with initialization gate
    withInitialization(async () => {
        return await messageRouter.handleMessage(message, sender);
    })()
        .then((result) => {
            if (message.type === 'UPLOAD_FILE') {
                console.log('VS Code Favicon BG: UPLOAD_FILE response', result);
            }
            sendResponse(result);
        })
        .catch(err => {
            console.log('VS Code Favicon BG: Message handler error:', err.message);
            sendResponse({ error: err.message });
        });

    return true; // Keep channel open for async response
});

// Handle alarms for polling
chrome.alarms.onAlarm.addListener(withInitialization(async (alarm) => {
    await notificationPoller.handleAlarm(alarm);
}));

// Fetch immediately when a VS Code tab becomes active
chrome.tabs.onActivated.addListener(withInitialization(async (activeInfo) => {
    await tabManager.handleTabActivated(activeInfo, () => notificationPoller.fetchNotifications());
}));

// Detect VS Code Server pages and inject content script dynamically
// Universal detection: any URL with ?folder= parameter is a VS Code Server
chrome.tabs.onUpdated.addListener(withInitialization(async (tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete') return;
    if (!tab.url) return;

    if (DomainManager.isVSCodeUrl(tab.url)) {
        console.log('VS Code Favicon BG: VS Code page detected:', tab.url);
        await injectContentScript(tabId, tab.url);
    }
}));

// Clean up when tabs are closed
chrome.tabs.onRemoved.addListener(withInitialization((tabId) => {
    tabManager.handleTabRemoved(tabId);
    injectedTabs.delete(tabId);
}));

// Clean up cached group IDs when windows are closed
chrome.windows.onRemoved.addListener(withInitialization((windowId) => {
    if (self.TabGroupManager) {
        self.TabGroupManager.handleWindowRemoved(windowId);
    }
}));

// Run initialization and store promise for event handlers
initPromise = initialize().catch(error => {
    console.error('VS Code Favicon BG: Fatal initialization error:', error);
    initError = error;
});
