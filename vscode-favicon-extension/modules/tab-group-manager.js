/**
 * Tab Group Manager - Auto pin/unpin and tab grouping based on terminal state
 *
 * Behavior:
 * - Terminal opened: tab is pinned, removed from group
 * - Terminal closed: tab is unpinned, moved to "Inactive" group (grey, collapsed)
 * - New tabs start pinned (VS Code usually has terminal open by default)
 */

(function() {
    'use strict';

    // Track inactive group IDs per window (windowId -> groupId)
    const inactiveGroups = new Map();

    // Track pending operations to prevent race conditions
    const pendingOperations = new Map(); // tabId -> Promise

    // Track tabs that have been seen with terminal open at least once
    // This prevents moving tabs to inactive group on first load when terminal detection is delayed
    const seenWithTerminal = new Set(); // tabId

    // Track current terminal state per tab to avoid redundant operations
    // This prevents re-pinning already pinned tabs which would change their order
    const tabTerminalState = new Map(); // tabId -> boolean (hasTerminal)

    // Configuration
    const CONFIG = {
        INACTIVE_GROUP_TITLE: 'Inactive',
        INACTIVE_GROUP_COLOR: 'grey',
        OPERATION_DEBOUNCE_MS: 100,
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
     * Get or create the "Inactive" tab group for a window
     * @param {number} windowId - Window ID
     * @returns {Promise<number|null>} - Group ID or null if failed
     */
    async function getOrCreateInactiveGroup(windowId) {
        // Check if we already have a group for this window
        const existingGroupId = inactiveGroups.get(windowId);
        if (existingGroupId) {
            // Verify the group still exists
            try {
                await chrome.tabGroups.get(existingGroupId);
                return existingGroupId;
            } catch (e) {
                // Group was deleted, remove from cache
                inactiveGroups.delete(windowId);
            }
        }

        // Try to find existing "Inactive" group in this window
        try {
            const groups = await chrome.tabGroups.query({ windowId });
            console.log(`Tab Group Manager: Found ${groups.length} groups in window ${windowId}:`, groups.map(g => `${g.id}:"${g.title}"`));
            for (const group of groups) {
                if (group.title === CONFIG.INACTIVE_GROUP_TITLE) {
                    inactiveGroups.set(windowId, group.id);
                    console.log(`Tab Group Manager: Reusing existing Inactive group ${group.id}`);
                    return group.id;
                }
            }
        } catch (e) {
            console.log('Tab Group Manager: Error querying groups:', e.message);
        }

        // No existing group found - we'll create one when needed
        return null;
    }

    /**
     * Create a new inactive group with the given tab
     * @param {number} tabId - Tab ID to add to the group
     * @param {number} windowId - Window ID
     * @returns {Promise<number|null>} - Group ID or null if failed
     */
    async function createInactiveGroupWithTab(tabId, windowId) {
        try {
            // Create group with this tab
            const groupId = await chrome.tabs.group({
                tabIds: [tabId],
                createProperties: { windowId },
            });

            // Update group properties
            await chrome.tabGroups.update(groupId, {
                title: CONFIG.INACTIVE_GROUP_TITLE,
                color: CONFIG.INACTIVE_GROUP_COLOR,
                collapsed: true,
            });

            // Cache the group ID
            inactiveGroups.set(windowId, groupId);

            console.log(`Tab Group Manager: Created Inactive group ${groupId} in window ${windowId}`);
            return groupId;
        } catch (e) {
            console.error('Tab Group Manager: Error creating group:', e.message);
            return null;
        }
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
     * Unpin a tab
     * @param {number} tabId - Tab ID
     * @returns {Promise<boolean>} - Success status
     */
    async function unpinTab(tabId) {
        try {
            const tab = await chrome.tabs.get(tabId);
            if (!tab.pinned) {
                return true; // Already unpinned
            }

            await chrome.tabs.update(tabId, { pinned: false });
            console.log(`Tab Group Manager: Unpinned tab ${tabId}`);
            return true;
        } catch (e) {
            console.error('Tab Group Manager: Error unpinning tab:', e.message);
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
     * Move a tab to the "Inactive" group
     * @param {number} tabId - Tab ID
     * @returns {Promise<boolean>} - Success status
     */
    async function moveToInactiveGroup(tabId) {
        try {
            const tab = await chrome.tabs.get(tabId);

            // Get or create the inactive group
            let groupId = await getOrCreateInactiveGroup(tab.windowId);

            if (groupId) {
                // Add tab to existing group
                await chrome.tabs.group({ tabIds: [tabId], groupId });
                console.log(`Tab Group Manager: Added tab ${tabId} to Inactive group ${groupId}`);
            } else {
                // Create new group with this tab
                groupId = await createInactiveGroupWithTab(tabId, tab.windowId);
            }

            // Ensure group is collapsed
            if (groupId) {
                try {
                    await chrome.tabGroups.update(groupId, { collapsed: true });
                } catch (e) {
                    // Group might have been deleted
                }
            }

            return groupId !== null;
        } catch (e) {
            console.error('Tab Group Manager: Error moving to inactive group:', e.message);
            return false;
        }
    }

    /**
     * Handle terminal state change for tab grouping
     * This is the main entry point called from tab-manager.js
     *
     * Logic:
     * - If state hasn't changed: SKIP (prevents re-pinning which changes order)
     * - hasTerminal=true: Mark tab as "seen with terminal", pin it, remove from group
     * - hasTerminal=false AND tab was seen with terminal: Unpin and move to inactive group
     * - hasTerminal=false AND tab was NEVER seen with terminal: IGNORE (first load, terminal detection delayed)
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
            // State unchanged, skip to avoid re-pinning (which changes tab order)
            console.log(`Tab Group Manager: State unchanged, skipping`);
            return { success: true, state: hasTerminal ? 'active' : 'inactive', skipped: true };
        }

        return executeWithTracking(tabId, async () => {
            try {
                if (hasTerminal) {
                    // Terminal opened: mark as seen, remove from group, then pin
                    seenWithTerminal.add(tabId);
                    tabTerminalState.set(tabId, true);
                    await removeFromGroup(tabId);
                    await pinTab(tabId);
                    console.log(`Tab Group Manager: Tab ${tabId} marked active (terminal open)`);
                    return { success: true, state: 'active', pinned: true, grouped: false };
                } else {
                    // Terminal closed or not detected yet
                    if (!seenWithTerminal.has(tabId)) {
                        // First contact with this tab and no terminal - ignore
                        // This prevents moving tabs to group on first load when detection is delayed
                        console.log(`Tab Group Manager: Tab ${tabId} first contact without terminal - ignoring`);
                        return { success: true, state: 'unknown', pinned: null, grouped: null, ignored: true };
                    }

                    // Tab was previously seen with terminal, now closed - move to inactive
                    tabTerminalState.set(tabId, false);
                    await unpinTab(tabId);
                    await moveToInactiveGroup(tabId);
                    console.log(`Tab Group Manager: Tab ${tabId} marked inactive (terminal closed)`);
                    return { success: true, state: 'inactive', pinned: false, grouped: true };
                }
            } catch (e) {
                console.error('Tab Group Manager: Error handling terminal state:', e.message);
                return { success: false, error: e.message };
            }
        });
    }

    /**
     * Clean up when a tab is removed
     * @param {number} tabId - Removed tab ID
     */
    function handleTabRemoved(tabId) {
        pendingOperations.delete(tabId);
        seenWithTerminal.delete(tabId);
        tabTerminalState.delete(tabId);
    }

    /**
     * Clean up when a window is removed (remove cached group ID)
     * @param {number} windowId - Removed window ID
     */
    function handleWindowRemoved(windowId) {
        inactiveGroups.delete(windowId);
    }

    // Export for service worker
    const TabGroupManagerExports = {
        handleTerminalStateForTabGrouping,
        handleTabRemoved,
        handleWindowRemoved,
        pinTab,
        unpinTab,
        removeFromGroup,
        moveToInactiveGroup,
        getOrCreateInactiveGroup,
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
