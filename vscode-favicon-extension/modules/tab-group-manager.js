/**
 * Tab Group Manager - Auto pin and sort tabs based on terminal state
 *
 * Behavior:
 * - All VS Code tabs stay pinned at all times
 * - Active tabs (terminal open) are sorted to the LEFT
 * - Inactive tabs (terminal closed, grey favicon) are sorted to the RIGHT
 * - Relative order among active/inactive tabs is preserved
 */

(function() {
    'use strict';

    // Track pending operations to prevent race conditions
    const pendingOperations = new Map(); // tabId -> Promise

    // Track tabs that have been seen with terminal open at least once
    // This prevents sorting tabs on first load when terminal detection is delayed
    const seenWithTerminal = new Set(); // tabId

    // Track current terminal state per tab to avoid redundant operations
    const tabTerminalState = new Map(); // tabId -> boolean (hasTerminal)

    // Per-window tab ordering - tracks original order for stable sorting
    // windowId -> { baseOrder: Map<tabId, sequence>, nextSequence: number }
    const windowTabOrders = new Map();

    // Debounce timers for sorting
    const sortDebounceTimers = new Map(); // windowId -> timeout

    // Configuration
    const CONFIG = {
        OPERATION_DEBOUNCE_MS: 100,
        SORT_DEBOUNCE_MS: 150,
    };

    /**
     * Wait for any pending operation on a tab to complete
     * @param {number} tabId - Tab ID
     * @returns {Promise<void>}
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
     * @param {number} tabId - Tab ID
     * @param {Function} operation - Async operation to execute
     * @returns {Promise<any>}
     */
    async function executeWithTracking(tabId, operation) {
        await waitForPendingOperation(tabId);

        const promise = operation();
        pendingOperations.set(tabId, promise);

        try {
            const result = await promise;
            return result;
        } finally {
            pendingOperations.delete(tabId);
        }
    }

    /**
     * Check if a tab is a VS Code Server tab
     * @param {object} tab - Chrome tab object
     * @returns {boolean}
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
     * Ensure base order is tracked for a tab in a window
     * @param {number} windowId - Window ID
     * @param {number} tabId - Tab ID
     */
    function ensureBaseOrder(windowId, tabId) {
        let order = windowTabOrders.get(windowId);
        if (!order) {
            order = { baseOrder: new Map(), nextSequence: 0 };
            windowTabOrders.set(windowId, order);
        }

        if (!order.baseOrder.has(tabId)) {
            order.baseOrder.set(tabId, order.nextSequence++);
            console.log(`Tab Group Manager: Assigned base order ${order.nextSequence - 1} to tab ${tabId} in window ${windowId}`);
        }
    }

    /**
     * Sort VS Code tabs in a window: active (left) -> inactive (right)
     * Preserves relative order within each group
     * @param {number} windowId - Window ID
     * @returns {Promise<void>}
     */
    async function sortTabsInWindow(windowId) {
        try {
            // Get all pinned tabs in this window
            const allTabs = await chrome.tabs.query({ windowId, pinned: true });

            // Filter to only VS Code tabs
            const vscodeTabs = allTabs.filter(isVSCodeTab);

            if (vscodeTabs.length === 0) {
                return;
            }

            // Get window order data
            const order = windowTabOrders.get(windowId);
            if (!order) {
                console.log(`Tab Group Manager: No order data for window ${windowId}`);
                return;
            }

            // Partition into active and inactive
            const activeTabs = [];
            const inactiveTabs = [];

            for (const tab of vscodeTabs) {
                const hasTerminal = tabTerminalState.get(tab.id);
                if (hasTerminal) {
                    activeTabs.push(tab);
                } else {
                    inactiveTabs.push(tab);
                }
            }

            // Sort each group by base order (preserves relative order)
            const sortByBaseOrder = (a, b) => {
                const orderA = order.baseOrder.get(a.id) ?? Infinity;
                const orderB = order.baseOrder.get(b.id) ?? Infinity;
                return orderA - orderB;
            };

            activeTabs.sort(sortByBaseOrder);
            inactiveTabs.sort(sortByBaseOrder);

            // Desired order: active tabs first (left), then inactive (right)
            const desiredOrder = [...activeTabs, ...inactiveTabs];

            // Find the first index where VS Code tabs should start
            // (non-VS Code pinned tabs stay in their positions)
            const nonVSCodePinned = allTabs.filter(t => !isVSCodeTab(t));
            const firstVSCodeIndex = nonVSCodePinned.length;

            console.log(`Tab Group Manager: Sorting ${vscodeTabs.length} VS Code tabs in window ${windowId} (${activeTabs.length} active, ${inactiveTabs.length} inactive)`);

            // Move tabs to achieve desired order
            for (let i = 0; i < desiredOrder.length; i++) {
                const targetIndex = firstVSCodeIndex + i;
                const tab = desiredOrder[i];

                // Re-fetch tab to get current index (may have changed)
                try {
                    const currentTab = await chrome.tabs.get(tab.id);
                    if (currentTab.index !== targetIndex) {
                        await chrome.tabs.move(tab.id, { index: targetIndex });
                        console.log(`Tab Group Manager: Moved tab ${tab.id} from index ${currentTab.index} to ${targetIndex}`);
                    }
                } catch (e) {
                    // Tab may have been closed
                    console.log(`Tab Group Manager: Could not move tab ${tab.id}: ${e.message}`);
                }
            }
        } catch (e) {
            console.error('Tab Group Manager: Error sorting tabs:', e.message);
        }
    }

    /**
     * Debounced version of sortTabsInWindow to prevent excessive API calls
     * @param {number} windowId - Window ID
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
     * Pin a tab
     * @param {number} tabId - Tab ID
     * @returns {Promise<boolean>} - Success status
     */
    async function pinTab(tabId) {
        try {
            const tab = await chrome.tabs.get(tabId);
            if (tab.pinned) {
                return true; // Already pinned
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
     * @param {number} tabId - Tab ID
     * @returns {Promise<boolean>} - Success status
     */
    async function removeFromGroup(tabId) {
        try {
            const tab = await chrome.tabs.get(tabId);
            if (tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
                return true; // Not in a group
            }

            await chrome.tabs.ungroup(tabId);
            console.log(`Tab Group Manager: Removed tab ${tabId} from group`);
            return true;
        } catch (e) {
            console.error('Tab Group Manager: Error removing from group:', e.message);
            return false;
        }
    }

    /**
     * Handle terminal state change for tab sorting
     * This is the main entry point called from tab-manager.js
     *
     * Logic:
     * - If state hasn't changed: SKIP (prevents redundant sorting)
     * - hasTerminal=true: Mark tab as "seen with terminal", ensure pinned, sort
     * - hasTerminal=false AND tab was seen with terminal: Update state, sort
     * - hasTerminal=false AND tab was NEVER seen with terminal: IGNORE (first load)
     *
     * @param {number} tabId - Tab ID
     * @param {boolean} hasTerminal - Whether terminal is open
     * @returns {Promise<object>} - Result object
     */
    async function handleTerminalStateForTabGrouping(tabId, hasTerminal) {
        console.log(`Tab Group Manager: handleTerminalStateForTabGrouping called - tabId=${tabId}, hasTerminal=${hasTerminal}`);

        if (!tabId) {
            return { success: false, error: 'No tabId provided' };
        }

        // Check if state actually changed - skip if same state
        const previousState = tabTerminalState.get(tabId);
        console.log(`Tab Group Manager: previousState=${previousState}, hasTerminal=${hasTerminal}, equal=${previousState === hasTerminal}`);

        if (previousState === hasTerminal) {
            // State unchanged, skip to avoid redundant sorting
            console.log(`Tab Group Manager: State unchanged, skipping`);
            return { success: true, state: hasTerminal ? 'active' : 'inactive', skipped: true };
        }

        return executeWithTracking(tabId, async () => {
            try {
                // Get tab info
                const tab = await chrome.tabs.get(tabId);
                const windowId = tab.windowId;

                // Ensure tab is pinned (always)
                if (!tab.pinned) {
                    await pinTab(tabId);
                }

                // Ensure tab is not in any group
                if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
                    await removeFromGroup(tabId);
                }

                // Track base order if new tab
                ensureBaseOrder(windowId, tabId);

                if (hasTerminal) {
                    // Terminal opened: mark as seen, update state, sort
                    seenWithTerminal.add(tabId);
                    tabTerminalState.set(tabId, true);
                    debouncedSortTabsInWindow(windowId);
                    console.log(`Tab Group Manager: Tab ${tabId} marked active (terminal open)`);
                    return { success: true, state: 'active', pinned: true, sorted: true };
                } else {
                    // Terminal closed or not detected yet
                    if (!seenWithTerminal.has(tabId)) {
                        // First contact with this tab and no terminal - ignore
                        // This prevents sorting tabs on first load when detection is delayed
                        console.log(`Tab Group Manager: Tab ${tabId} first contact without terminal - ignoring`);
                        return { success: true, state: 'unknown', pinned: true, sorted: false, ignored: true };
                    }

                    // Tab was previously seen with terminal, now closed - sort to right
                    tabTerminalState.set(tabId, false);
                    debouncedSortTabsInWindow(windowId);
                    console.log(`Tab Group Manager: Tab ${tabId} marked inactive (terminal closed)`);
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
     * @param {number} tabId - Tab ID
     * @param {number} newWindowId - New window ID
     */
    async function handleTabAttached(tabId, newWindowId) {
        // Find and transfer base order from old window
        for (const [oldWindowId, order] of windowTabOrders) {
            if (oldWindowId !== newWindowId && order.baseOrder.has(tabId)) {
                const sequence = order.baseOrder.get(tabId);
                order.baseOrder.delete(tabId);

                // Assign in new window, keeping relative position
                ensureBaseOrder(newWindowId, tabId);
                const newOrder = windowTabOrders.get(newWindowId);
                // Use the old sequence to preserve ordering
                newOrder.baseOrder.set(tabId, sequence);

                console.log(`Tab Group Manager: Transferred tab ${tabId} order from window ${oldWindowId} to ${newWindowId}`);
                break;
            }
        }

        // Re-sort new window
        debouncedSortTabsInWindow(newWindowId);
    }

    /**
     * Clean up when a tab is removed
     * @param {number} tabId - Removed tab ID
     */
    function handleTabRemoved(tabId) {
        pendingOperations.delete(tabId);
        seenWithTerminal.delete(tabId);
        tabTerminalState.delete(tabId);

        // Clean up base order from all windows
        for (const [windowId, order] of windowTabOrders) {
            if (order.baseOrder.has(tabId)) {
                order.baseOrder.delete(tabId);
                console.log(`Tab Group Manager: Removed tab ${tabId} from window ${windowId} order tracking`);
            }
        }
    }

    /**
     * Clean up when a window is removed
     * @param {number} windowId - Removed window ID
     */
    function handleWindowRemoved(windowId) {
        windowTabOrders.delete(windowId);
        sortDebounceTimers.delete(windowId);
    }

    // Export for service worker
    const TabGroupManagerExports = {
        handleTerminalStateForTabGrouping,
        handleTabRemoved,
        handleWindowRemoved,
        handleTabAttached,
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
