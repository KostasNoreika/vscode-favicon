// VS Code Favicon Extension - Background Service Worker
// Uses chrome.alarms for reliable polling (Service Workers don't support EventSource/setTimeout)

const CircuitBreaker = require('./modules/circuit-breaker');
const { createStorageManager } = require('./modules/storage-manager');
const { createNotificationPoller } = require('./modules/notification-poller');
const { createTabManager } = require('./modules/tab-manager');
const { createMessageRouter } = require('./modules/message-router');

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

/**
 * Initialize background service worker
 */
async function initialize() {
    console.log('VS Code Favicon BG: Initializing...');

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
    });

    // Update badge based on loaded notifications
    tabManager.updateIconBadge();

    // Setup polling alarm
    await notificationPoller.setupPolling();

    // Fetch fresh notifications
    await notificationPoller.fetchNotifications();

    console.log('VS Code Favicon BG: Initialization complete');
}

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Handle async response
    messageRouter
        .handleMessage(message, sender)
        .then(sendResponse)
        .catch(err => {
            console.log('VS Code Favicon BG: Message handler error:', err.message);
            sendResponse({ error: err.message });
        });

    return true; // Keep channel open for async response
});

// Handle alarms for polling
chrome.alarms.onAlarm.addListener(async (alarm) => {
    await notificationPoller.handleAlarm(alarm);
});

// Fetch immediately when a VS Code tab becomes active
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    await tabManager.handleTabActivated(activeInfo, () => notificationPoller.fetchNotifications());
});

// Clean up activeTerminalFolders when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
    tabManager.handleTabRemoved(tabId);
});

// Run initialization
initialize();
