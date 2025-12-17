/**
 * Time utilities module
 * Shared time formatting functions for VS Code Favicon Extension
 */

(function() {
    'use strict';

    /**
     * Format timestamp as time ago
     * @param {number} timestamp - Timestamp in milliseconds
     * @returns {string} - Formatted time string (e.g., "5m ago", "2h ago", "3d ago")
     */
    function formatTimeAgo(timestamp) {
        const seconds = Math.floor((Date.now() - timestamp) / 1000);
        if (seconds < 60) return 'just now';
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        return `${days}d ago`;
    }

    // Export for use in other modules and scripts
    window.TimeUtils = {
        formatTimeAgo
    };

})();
