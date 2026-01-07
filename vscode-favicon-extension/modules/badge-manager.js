/**
 * Badge position manager module
 * Handles badge position persistence and drag-and-drop functionality
 */

const BADGE_POSITION_KEY = 'vscode-favicon-badge-position';

/**
 * Create badge manager
 * @returns {object} - Badge manager instance
 */
function createBadgeManager() {
    // Track document-level listeners for cleanup (prevents accumulation)
    let documentMoveHandler = null;
    let documentUpHandler = null;
    /**
     * Save badge position to chrome.storage.local
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     */
    function saveBadgePosition(x, y) {
        const position = { x, y };
        try {
            chrome.storage.local.set({ [BADGE_POSITION_KEY]: position }, () => {
                if (chrome.runtime.lastError) {
                    console.log('Badge Manager: Failed to save badge position:', chrome.runtime.lastError.message);
                } else {
                    console.log('Badge Manager: Badge position saved:', position);
                }
            });
        } catch (e) {
            console.log('Badge Manager: Storage error:', e.message);
        }
    }

    /**
     * Load badge position from chrome.storage.local
     * @param {Function} callback - Callback with position or null
     */
    function loadBadgePosition(callback) {
        try {
            chrome.storage.local.get([BADGE_POSITION_KEY], (result) => {
                if (chrome.runtime.lastError) {
                    console.log('Badge Manager: Failed to load badge position:', chrome.runtime.lastError.message);
                    callback(null);
                    return;
                }
                const position = result[BADGE_POSITION_KEY];
                if (position && typeof position.x === 'number' && typeof position.y === 'number') {
                    console.log('Badge Manager: Loaded badge position:', position);
                    callback(position);
                } else {
                    callback(null);
                }
            });
        } catch (e) {
            console.log('Badge Manager: Storage error:', e.message);
            callback(null);
        }
    }

    /**
     * Apply position to badge element
     * @param {HTMLElement} badge - Badge element
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     */
    function applyBadgePosition(badge, x, y) {
        const maxX = window.innerWidth - 48;
        const maxY = window.innerHeight - 48;
        const clampedX = Math.max(0, Math.min(x, maxX));
        const clampedY = Math.max(0, Math.min(y, maxY));

        badge.style.left = clampedX + 'px';
        badge.style.top = clampedY + 'px';
        badge.style.right = 'auto';
    }

    /**
     * Cleanup document-level drag listeners
     * Call this before setting up new listeners or on extension unload
     */
    function cleanupDragListeners() {
        if (documentMoveHandler) {
            document.removeEventListener('mousemove', documentMoveHandler);
            documentMoveHandler = null;
        }
        if (documentUpHandler) {
            document.removeEventListener('mouseup', documentUpHandler);
            documentUpHandler = null;
        }
    }

    /**
     * Setup drag functionality for badge
     * @param {HTMLElement} badge - Badge element
     */
    function setupBadgeDrag(badge) {
        // Guard against null badge (race condition)
        if (!badge) {
            console.warn('Badge Manager: setupBadgeDrag called with null badge');
            return;
        }

        // CRITICAL: Remove any existing document listeners before adding new ones
        // This prevents listener accumulation that causes browser slowdown
        cleanupDragListeners();

        let isDragging = false;
        let wasDragged = false;
        let startX, startY;
        let initialX, initialY;

        badge.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;

            isDragging = true;
            wasDragged = false;
            badge.classList.add('dragging');

            const rect = badge.getBoundingClientRect();
            initialX = rect.left;
            initialY = rect.top;
            startX = e.clientX;
            startY = e.clientY;

            e.preventDefault();
        });

        // Store handler references for cleanup
        documentMoveHandler = (e) => {
            if (!isDragging) return;

            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;

            if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
                wasDragged = true;
            }

            const newX = initialX + deltaX;
            const newY = initialY + deltaY;

            applyBadgePosition(badge, newX, newY);
        };

        documentUpHandler = (e) => {
            if (!isDragging) return;

            isDragging = false;
            badge.classList.remove('dragging');

            if (wasDragged) {
                const rect = badge.getBoundingClientRect();
                saveBadgePosition(rect.left, rect.top);

                e.stopPropagation();
            }
        };

        document.addEventListener('mousemove', documentMoveHandler);
        document.addEventListener('mouseup', documentUpHandler);

        badge.addEventListener('click', (e) => {
            if (wasDragged) {
                e.stopPropagation();
                e.preventDefault();
                wasDragged = false;
            }
        }, true);
    }

    return {
        saveBadgePosition,
        loadBadgePosition,
        applyBadgePosition,
        setupBadgeDrag,
        cleanupDragListeners,
    };
}

// Export for both Node.js and browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createBadgeManager };
} else if (typeof window !== 'undefined') {
    window.BadgeManager = { createBadgeManager };
}
