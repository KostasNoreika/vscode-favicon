/**
 * Domain management utilities for VS Code Server URLs
 * Handles domain whitelisting, permissions, and auto-detection
 */

(function() {
'use strict';

const STORAGE_KEYS = {
    DOMAINS: 'vscodeServerDomains',
    AUTO_DETECT: 'autoDetectVSCode',
};

/**
 * Check if URL is a VS Code Server URL
 * Validates presence of ?folder= parameter which indicates VS Code Server
 *
 * @param {string} url - URL to check
 * @returns {boolean} - True if URL has ?folder= parameter
 */
function isVSCodeUrl(url) {
    // Type validation
    if (!url || typeof url !== 'string') {
        return false;
    }

    // Parse URL safely
    let parsedUrl;
    try {
        parsedUrl = new URL(url);
    } catch (e) {
        return false;
    }

    // Check for folder parameter (case-insensitive)
    return parsedUrl.searchParams.has('folder');
}

/**
 * Extract origin from URL
 * Returns protocol + hostname + port (e.g., "https://vs.example.com")
 *
 * @param {string} url - URL to extract origin from
 * @returns {string|null} - Origin string or null if invalid
 */
function getOrigin(url) {
    // Type validation
    if (!url || typeof url !== 'string') {
        return null;
    }

    // Parse URL safely
    let parsedUrl;
    try {
        parsedUrl = new URL(url);
    } catch (e) {
        return null;
    }

    // Return origin (includes protocol, hostname, and non-default port)
    return parsedUrl.origin;
}

/**
 * Get whitelisted VS Code Server domains from storage
 * Returns array of origin strings (e.g., ["https://vs.example.com"])
 *
 * @returns {Promise<Array<string>>} - Array of whitelisted domain origins
 */
async function getWhitelistedDomains() {
    try {
        const data = await chrome.storage.local.get(STORAGE_KEYS.DOMAINS);
        const domains = data[STORAGE_KEYS.DOMAINS] || [];

        // Validate array
        if (!Array.isArray(domains)) {
            console.error('Domain Manager: Invalid domains format in storage, resetting to empty array');
            return [];
        }

        // Filter to valid strings only
        return domains.filter(domain => domain && typeof domain === 'string');
    } catch (error) {
        console.error('Domain Manager: Error loading domains from storage:', error.message);
        return [];
    }
}

/**
 * Add domain to whitelist
 * Validates origin format and prevents duplicates
 *
 * @param {string} domain - Origin to add (e.g., "https://vs.example.com")
 * @returns {Promise<object>} - { success: boolean, error?: string }
 */
async function addDomain(domain) {
    // Type validation
    if (!domain || typeof domain !== 'string') {
        return {
            success: false,
            error: 'Domain must be a non-empty string',
        };
    }

    // Validate origin format
    let parsedUrl;
    try {
        parsedUrl = new URL(domain);
    } catch (e) {
        return {
            success: false,
            error: 'Invalid domain format',
        };
    }

    // Ensure it's just the origin (no path, query, or hash)
    const origin = parsedUrl.origin;

    // Get current domains
    const domains = await getWhitelistedDomains();

    // Check if already exists
    if (domains.includes(origin)) {
        return {
            success: false,
            error: 'Domain already whitelisted',
        };
    }

    // Add to list
    domains.push(origin);

    // Save to storage
    try {
        await chrome.storage.local.set({ [STORAGE_KEYS.DOMAINS]: domains });
        console.log('Domain Manager: Added domain to whitelist:', origin);
        return { success: true };
    } catch (error) {
        console.error('Domain Manager: Error saving domain to storage:', error.message);
        return {
            success: false,
            error: 'Failed to save domain to storage',
        };
    }
}

/**
 * Remove domain from whitelist
 *
 * @param {string} domain - Origin to remove (e.g., "https://vs.example.com")
 * @returns {Promise<object>} - { success: boolean, error?: string }
 */
async function removeDomain(domain) {
    // Type validation
    if (!domain || typeof domain !== 'string') {
        return {
            success: false,
            error: 'Domain must be a non-empty string',
        };
    }

    // Get current domains
    const domains = await getWhitelistedDomains();

    // Check if exists
    const index = domains.indexOf(domain);
    if (index === -1) {
        return {
            success: false,
            error: 'Domain not found in whitelist',
        };
    }

    // Remove from list
    domains.splice(index, 1);

    // Save to storage
    try {
        await chrome.storage.local.set({ [STORAGE_KEYS.DOMAINS]: domains });
        console.log('Domain Manager: Removed domain from whitelist:', domain);
        return { success: true };
    } catch (error) {
        console.error('Domain Manager: Error saving domains to storage:', error.message);
        return {
            success: false,
            error: 'Failed to save changes to storage',
        };
    }
}

/**
 * Request browser permission for domain
 * Uses Chrome permissions API for host permissions
 *
 * @param {string} origin - Origin to request permission for (e.g., "https://vs.example.com")
 * @returns {Promise<object>} - { granted: boolean, error?: string }
 */
async function requestDomainPermission(origin) {
    // Type validation
    if (!origin || typeof origin !== 'string') {
        return {
            granted: false,
            error: 'Origin must be a non-empty string',
        };
    }

    // Validate origin format
    let parsedUrl;
    try {
        parsedUrl = new URL(origin);
    } catch (e) {
        return {
            granted: false,
            error: 'Invalid origin format',
        };
    }

    // Ensure it's just the origin
    const validOrigin = parsedUrl.origin;

    // Build permission pattern (origin + all paths)
    const permissions = {
        origins: [`${validOrigin}/*`],
    };

    try {
        const granted = await chrome.permissions.request(permissions);

        if (granted) {
            console.log('Domain Manager: Permission granted for:', validOrigin);
        } else {
            console.log('Domain Manager: Permission denied by user for:', validOrigin);
        }

        return { granted };
    } catch (error) {
        console.error('Domain Manager: Error requesting permission:', error.message);
        return {
            granted: false,
            error: 'Failed to request permission',
        };
    }
}

/**
 * Check if browser has permission for domain
 *
 * @param {string} origin - Origin to check permission for (e.g., "https://vs.example.com")
 * @returns {Promise<boolean>} - True if permission is granted
 */
async function hasDomainPermission(origin) {
    // Type validation
    if (!origin || typeof origin !== 'string') {
        return false;
    }

    // Validate origin format
    let parsedUrl;
    try {
        parsedUrl = new URL(origin);
    } catch (e) {
        return false;
    }

    // Ensure it's just the origin
    const validOrigin = parsedUrl.origin;

    // Build permission pattern
    const permissions = {
        origins: [`${validOrigin}/*`],
    };

    try {
        return await chrome.permissions.contains(permissions);
    } catch (error) {
        console.error('Domain Manager: Error checking permission:', error.message);
        return false;
    }
}

/**
 * Get auto-detect setting
 * Returns whether automatic VS Code Server detection is enabled
 *
 * @returns {Promise<boolean>} - True if auto-detect is enabled (default: true)
 */
async function isAutoDetectEnabled() {
    try {
        const data = await chrome.storage.local.get(STORAGE_KEYS.AUTO_DETECT);

        // Default to true if not set
        if (data[STORAGE_KEYS.AUTO_DETECT] === undefined) {
            return true;
        }

        return Boolean(data[STORAGE_KEYS.AUTO_DETECT]);
    } catch (error) {
        console.error('Domain Manager: Error loading auto-detect setting:', error.message);
        return true; // Default to enabled on error
    }
}

/**
 * Set auto-detect setting
 * Controls whether extension automatically detects VS Code Server URLs
 *
 * @param {boolean} enabled - True to enable auto-detection
 * @returns {Promise<object>} - { success: boolean, error?: string }
 */
async function setAutoDetect(enabled) {
    // Type validation
    if (typeof enabled !== 'boolean') {
        return {
            success: false,
            error: 'Enabled must be a boolean',
        };
    }

    try {
        await chrome.storage.local.set({ [STORAGE_KEYS.AUTO_DETECT]: enabled });
        console.log('Domain Manager: Auto-detect setting updated:', enabled);
        return { success: true };
    } catch (error) {
        console.error('Domain Manager: Error saving auto-detect setting:', error.message);
        return {
            success: false,
            error: 'Failed to save setting',
        };
    }
}

// Export for both Node.js (testing) and browser (service worker/content script)
const DomainManagerExports = {
    isVSCodeUrl,
    getOrigin,
    getWhitelistedDomains,
    addDomain,
    removeDomain,
    requestDomainPermission,
    hasDomainPermission,
    isAutoDetectEnabled,
    setAutoDetect,
    STORAGE_KEYS,
};

// Use require check to definitively detect Node.js (avoid false positives from partial module shims)
if (typeof require === 'function' && typeof module !== 'undefined') {
    module.exports = DomainManagerExports;
} else if (typeof self !== 'undefined') {
    // Service worker global
    self.DomainManager = DomainManagerExports;
} else if (typeof window !== 'undefined') {
    // Content script / popup global
    window.DomainManager = DomainManagerExports;
}

})(); // End IIFE
