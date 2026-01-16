/**
 * Tab Group Manager - Auto pin and sort tabs based on terminal state
 *
 * Behavior:
 * - All VS Code tabs stay pinned at all times
 * - Active tabs (terminal open) are sorted to the LEFT
 * - Inactive tabs (terminal closed, grey favicon) are sorted to the RIGHT
 * - User's manual order is preserved and persisted to storage
 * - Sorting only reorders within active/inactive groups, keeping user's relative order
 */

(function() {
    'use strict';

    // Storage key for persisting tab order
    const STORAGE_KEY = 'tabBaseOrders';

    // Track pending operations to prevent race conditions
    const pendingOperations = new Map(); // tabId -> Promise

    // Track tabs that have been seen with terminal open at least once
    const seenWithTerminal = new Set(); // tabId

    // Track current terminal state per tab
    const tabTerminalState = new Map(); // tabId -> boolean (hasTerminal)

    // Base order by folder path (persisted) - folderPath -> sequence number
    // This is the user's preferred order, loaded from storage
    let folderBaseOrder = new Map();

    // Track tabId -> folderPath mapping for current session
    const tabFolders = new Map(); // tabId -> folderPath

    // Next sequence number for new folders
    let nextSequence = 0;

    // Debounce timers for sorting and saving
    const sortDebounceTimers = new Map(); // windowId -> timeout
    let saveDebounceTimer = null;

    // Track tabs being moved by auto-sorting (to ignore our own moves)
    const tabsBeingSorted = new Set();

    // Configuration
    const CONFIG = {
        SORT_DEBOUNCE_MS: 150,
        SAVE_DEBOUNCE_MS: 500,
    };

    /**
     * Load saved order from chrome.storage.local
     */
    async function loadSavedOrder() {
        try {
            const result = await chrome.storage.local.get(STORAGE_KEY);
            if (result[STORAGE_KEY]) {
                const saved = result[STORAGE_KEY];
                folderBaseOrder = new Map(Object.entries(saved.order || {}));
                nextSequence = saved.nextSequence || 0;
                console.log(`Tab Group Manager: Loaded ${folderBaseOrder.size} saved folder orders, nextSequence=${nextSequence}`);
            }
        } catch (e) {
            console.error('Tab Group Manager: Error loading saved order:', e.message);
        }
    }

    /**
     * Save order to chrome.storage.local (debounced)
     */
    function saveOrder() {
        if (saveDebounceTimer) {
            clearTimeout(saveDebounceTimer);
        }
        saveDebounceTimer = setTimeout(async () => {
            try {
                const data = {
                    order: Object.fromEntries(folderBaseOrder),
                    nextSequence: nextSequence,
                };
                await chrome.storage.local.set({ [STORAGE_KEY]: data });
                console.log(`Tab Group Manager: Saved ${folderBaseOrder.size} folder orders`);
            } catch (e) {
                console.error('Tab Group Manager: Error saving order:', e.message);
            }
        }, CONFIG.SAVE_DEBOUNCE_MS);
    }

    /**
     * Wait for any pending operation on a tab to complete
     */
    async function waitForPendingOperation(tabId) {
        const pending = pendingOperations.get(tabId);
        if (pending) {
            try {
                await pending;
            } catch (e) {
                // Ignore errors from previous operation
            }
        }
    }

    /**
     * Execute operation with pending tracking
     */
    async function executeWithTracking(tabId, operation) {
        await waitForPendingOperation(tabId);

        const promise = operation();
        pendingOperations.set(tabId, promise);

        try {
            return await promise;
        } finally {
            pendingOperations.delete(tabId);
        }
    }

    /**
     * Check if a tab is a VS Code Server tab
     */
    function isVSCodeTab(tab) {
        if (!tab.url) return false;
        try {
            return new URL(tab.url).searchParams.has('folder');
        } catch {
            return false;
        }
    }

    /**
     * Extract folder path from tab URL
     */
    function getFolderFromTab(tab) {
        if (!tab.url) return null;
        try {
            return new URL(tab.url).searchParams.get('folder');
        } catch {
            return null;
        }
    }

    /**
     * Get or create base order for a folder
     * @param {string} folder - Folder path
     * @param {number} [currentIndex] - Current tab index (used for initialization)
     * @returns {number} - Sequence number
     */
    function getOrCreateFolderOrder(folder, currentIndex = null) {
        if (folderBaseOrder.has(folder)) {
            return folderBaseOrder.get(folder);
        }

        // New folder - assign sequence
        // If we have a current index, use it to maintain visual order
        // Otherwise use next available sequence
        const sequence = currentIndex !== null ? currentIndex * 1000 : nextSequence++;
        folderBaseOrder.set(folder, sequence);
        saveOrder();
        console.log(`Tab Group Manager: Assigned order ${sequence} to folder ${folder}`);
        return sequence;
    }

    /**
     * Sort VS Code tabs in a window: active (left) -> inactive (right)
     * Preserves user's relative order within each group
     */
    async function sortTabsInWindow(windowId) {
        try {
            const allTabs = await chrome.tabs.query({ windowId, pinned: true });
            const vscodeTabs = allTabs.filter(isVSCodeTab);

            if (vscodeTabs.length === 0) {
                return;
            }

            // Partition into active and inactive
            // Only include tabs that have reported their terminal state
            const activeTabs = [];
            const inactiveTabs = [];

            for (const tab of vscodeTabs) {
                // Skip tabs that haven't reported their state yet
                // This prevents newly active tabs from jumping to front during reload
                if (!tabTerminalState.has(tab.id)) {
                    continue;
                }
                const hasTerminal = tabTerminalState.get(tab.id);
                if (hasTerminal) {
                    activeTabs.push(tab);
                } else {
                    inactiveTabs.push(tab);
                }
            }

            // Sort each group by folder base order (user's preferred order)
            const sortByFolderOrder = (a, b) => {
                const folderA = getFolderFromTab(a);
                const folderB = getFolderFromTab(b);
                const orderA = folderA ? (folderBaseOrder.get(folderA) ?? Infinity) : Infinity;
                const orderB = folderB ? (folderBaseOrder.get(folderB) ?? Infinity) : Infinity;
                return orderA - orderB;
            };

            activeTabs.sort(sortByFolderOrder);
            inactiveTabs.sort(sortByFolderOrder);

            // Desired order: active tabs first (left), then inactive (right)
            const desiredOrder = [...activeTabs, ...inactiveTabs];

            // Find the first index where VS Code tabs should start
            const nonVSCodePinned = allTabs.filter(t => !isVSCodeTab(t));
            const firstVSCodeIndex = nonVSCodePinned.length;

            console.log(`Tab Group Manager: Sorting ${vscodeTabs.length} tabs (${activeTabs.length} active, ${inactiveTabs.length} inactive)`);

            // Mark all tabs as being sorted (to ignore onMoved events)
            for (const tab of desiredOrder) {
                tabsBeingSorted.add(tab.id);
            }

            // Move tabs to achieve desired order
            for (let i = 0; i < desiredOrder.length; i++) {
                const targetIndex = firstVSCodeIndex + i;
                const tab = desiredOrder[i];

                try {
                    const currentTab = await chrome.tabs.get(tab.id);
                    if (currentTab.index !== targetIndex) {
                        await chrome.tabs.move(tab.id, { index: targetIndex });
                    }
                } catch (e) {
                    // Tab may have been closed
                }
            }

            // Clear sorted tabs after a delay
            setTimeout(() => {
                for (const tab of desiredOrder) {
                    tabsBeingSorted.delete(tab.id);
                }
            }, 500);
        } catch (e) {
            console.error('Tab Group Manager: Error sorting tabs:', e.message);
        }
    }

    /**
     * Debounced version of sortTabsInWindow
     */
    function debouncedSortTabsInWindow(windowId) {
        const existing = sortDebounceTimers.get(windowId);
        if (existing) {
            clearTimeout(existing);
        }

        const timer = setTimeout(() => {
            sortDebounceTimers.delete(windowId);
            sortTabsInWindow(windowId);
        }, CONFIG.SORT_DEBOUNCE_MS);

        sortDebounceTimers.set(windowId, timer);
    }

    /**
     * Handle manual tab move by user
     * Only updates the moved tab's order, not all tabs
     */
    async function handleTabMoved(tabId, moveInfo) {
        // Ignore moves triggered by our sorting
        if (tabsBeingSorted.has(tabId)) {
            return;
        }

        try {
            const tab = await chrome.tabs.get(tabId);
            if (!isVSCodeTab(tab) || !tab.pinned) {
                return;
            }

            const folder = getFolderFromTab(tab);
            if (!folder) {
                return;
            }

            console.log(`Tab Group Manager: Manual move detected for tab ${tabId} (${folder}) to index ${moveInfo.toIndex}`);

            // Get all VS Code pinned tabs to find neighbors
            const allTabs = await chrome.tabs.query({ windowId: tab.windowId, pinned: true });
            const vscodeTabs = allTabs.filter(isVSCodeTab).sort((a, b) => a.index - b.index);

            // Find the moved tab's position among VS Code tabs
            const movedTabIndex = vscodeTabs.findIndex(t => t.id === tabId);
            if (movedTabIndex === -1) return;

            // Calculate new order based on neighbors
            let newOrder;
            const prevTab = movedTabIndex > 0 ? vscodeTabs[movedTabIndex - 1] : null;
            const nextTab = movedTabIndex < vscodeTabs.length - 1 ? vscodeTabs[movedTabIndex + 1] : null;

            const prevFolder = prevTab ? getFolderFromTab(prevTab) : null;
            const nextFolder = nextTab ? getFolderFromTab(nextTab) : null;

            const prevOrder = prevFolder ? (folderBaseOrder.get(prevFolder) ?? -1000) : -1000;
            const nextOrder = nextFolder ? (folderBaseOrder.get(nextFolder) ?? prevOrder + 2000) : prevOrder + 2000;

            // Place the moved tab between its neighbors
            newOrder = Math.floor((prevOrder + nextOrder) / 2);

            // If orders are too close, rebalance all
            if (newOrder === prevOrder || newOrder === nextOrder) {
                // Rebalance: assign orders 0, 1000, 2000, ...
                vscodeTabs.forEach((t, idx) => {
                    const f = getFolderFromTab(t);
                    if (f) {
                        folderBaseOrder.set(f, idx * 1000);
                    }
                });
                nextSequence = (vscodeTabs.length + 1) * 1000;
            } else {
                folderBaseOrder.set(folder, newOrder);
            }

            saveOrder();
            console.log(`Tab Group Manager: Updated order for ${folder} to ${folderBaseOrder.get(folder)}`);
        } catch (e) {
            console.error('Tab Group Manager: Error handling tab move:', e.message);
        }
    }

    /**
     * Pin a tab
     */
    async function pinTab(tabId) {
        try {
            const tab = await chrome.tabs.get(tabId);
            if (tab.pinned) {
                return true;
            }

            await chrome.tabs.update(tabId, { pinned: true });
            console.log(`Tab Group Manager: Pinned tab ${tabId}`);
            return true;
        } catch (e) {
            console.error('Tab Group Manager: Error pinning tab:', e.message);
            return false;
        }
    }

    /**
     * Remove a tab from its group
     */
    async function removeFromGroup(tabId) {
        try {
            const tab = await chrome.tabs.get(tabId);
            if (tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
                return true;
            }

            await chrome.tabs.ungroup(tabId);
            return true;
        } catch (e) {
            console.error('Tab Group Manager: Error removing from group:', e.message);
            return false;
        }
    }

    /**
     * Handle terminal state change for tab sorting
     * Main entry point called from tab-manager.js
     */
    async function handleTerminalStateForTabGrouping(tabId, hasTerminal) {
        console.log(`Tab Group Manager: handleTerminalStateForTabGrouping - tabId=${tabId}, hasTerminal=${hasTerminal}`);

        if (!tabId) {
            return { success: false, error: 'No tabId provided' };
        }

        // Check if state actually changed
        const previousState = tabTerminalState.get(tabId);
        if (previousState === hasTerminal) {
            return { success: true, state: hasTerminal ? 'active' : 'inactive', skipped: true };
        }

        return executeWithTracking(tabId, async () => {
            try {
                const tab = await chrome.tabs.get(tabId);
                const windowId = tab.windowId;
                const folder = getFolderFromTab(tab);

                // Ensure tab is pinned
                if (!tab.pinned) {
                    await pinTab(tabId);
                }

                // Ensure tab is not in any group
                if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
                    await removeFromGroup(tabId);
                }

                // Track folder mapping and ensure order exists
                if (folder) {
                    tabFolders.set(tabId, folder);
                    getOrCreateFolderOrder(folder, tab.index);
                }

                if (hasTerminal) {
                    seenWithTerminal.add(tabId);
                    tabTerminalState.set(tabId, true);
                    debouncedSortTabsInWindow(windowId);
                    return { success: true, state: 'active', pinned: true, sorted: true };
                } else {
                    if (!seenWithTerminal.has(tabId)) {
                        // First contact without terminal - initialize order but don't sort yet
                        return { success: true, state: 'unknown', pinned: true, sorted: false, ignored: true };
                    }

                    tabTerminalState.set(tabId, false);
                    debouncedSortTabsInWindow(windowId);
                    return { success: true, state: 'inactive', pinned: true, sorted: true };
                }
            } catch (e) {
                console.error('Tab Group Manager: Error handling terminal state:', e.message);
                return { success: false, error: e.message };
            }
        });
    }

    /**
     * Handle tab attached to a window (moved between windows)
     */
    async function handleTabAttached(tabId, newWindowId) {
        // Re-sort new window after a tab is attached
        debouncedSortTabsInWindow(newWindowId);
    }

    /**
     * Clean up when a tab is removed
     */
    function handleTabRemoved(tabId) {
        pendingOperations.delete(tabId);
        seenWithTerminal.delete(tabId);
        tabTerminalState.delete(tabId);
        tabFolders.delete(tabId);
        // Note: We don't remove from folderBaseOrder - keep the order for when tab reopens
    }

    /**
     * Clean up when a window is removed
     */
    function handleWindowRemoved(windowId) {
        sortDebounceTimers.delete(windowId);
    }

    /**
     * Initialize the module - load saved order
     */
    async function initialize() {
        await loadSavedOrder();
        console.log('Tab Group Manager: Initialized');
    }

    // Export for service worker
    const TabGroupManagerExports = {
        initialize,
        handleTerminalStateForTabGrouping,
        handleTabRemoved,
        handleWindowRemoved,
        handleTabAttached,
        handleTabMoved,
        sortTabsInWindow,
        pinTab,
        removeFromGroup,
    };

    // Service worker global
    if (typeof self !== 'undefined') {
        self.TabGroupManager = TabGroupManagerExports;
    }

    // Node.js for testing
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = TabGroupManagerExports;
    }

})();
