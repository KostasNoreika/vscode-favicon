/**
 * Path normalization utilities
 * Aligns with server-side normalization in lib/path-validator.js
 */

(function() {
'use strict';

/**
 * Normalize folder path to match server-side behavior
 *
 * Server normalization rules (lib/path-validator.js sanitizePath):
 * 1. URL decode the path
 * 2. Remove trailing slashes
 * 3. Convert to lowercase (for macOS case-insensitive filesystem)
 *
 * @param {string} folder - Folder path to normalize
 * @returns {string} - Normalized path, or empty string for invalid input
 */
function normalizeFolder(folder) {
    // Handle edge cases: null, undefined, non-string, empty string
    if (!folder || typeof folder !== 'string') {
        return '';
    }

    // Trim whitespace
    let normalized = folder.trim();

    // Return empty string if nothing left
    if (!normalized) {
        return '';
    }

    // URL decode if needed (server does this)
    // Only decode if it looks URL-encoded to avoid breaking normal paths
    try {
        const decoded = decodeURIComponent(normalized);
        // Only use decoded if it's different (was actually encoded)
        if (decoded !== normalized) {
            normalized = decoded;
        }
    } catch (e) {
        // Invalid URL encoding, use original
        // Server would reject this, but we'll normalize what we can
    }

    // Normalize path separators: convert backslashes to forward slashes
    // Windows paths like "C:\Users\..." become "C:/Users/..."
    // IMPORTANT: Do this BEFORE removing trailing slashes
    normalized = normalized.replace(/\\/g, '/');

    // Remove trailing slashes (matches server: decoded.replace(/\/+$/, ''))
    normalized = normalized.replace(/\/+$/, '');

    // Convert to lowercase (matches server: decoded.toLowerCase())
    // Server does this for macOS case-insensitive filesystem compatibility
    normalized = normalized.toLowerCase();

    return normalized;
}

// Export for both Node.js (testing) and browser (service worker)
// Use require check to definitively detect Node.js (avoid false positives from partial module shims)
if (typeof require === 'function' && typeof module !== 'undefined') {
    module.exports = { normalizeFolder };
} else if (typeof self !== 'undefined') {
    // Service worker global
    self.PathUtils = { normalizeFolder };
} else if (typeof window !== 'undefined') {
    // Content script global
    window.PathUtils = { normalizeFolder };
}

})(); // End IIFE
