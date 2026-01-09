/**
 * Favicon Finder Module
 * Searches for custom favicon files directly from VS Code Server
 * Caches results per project to avoid repeated searches
 */

// Favicon file patterns to search for (priority order)
const FAVICON_PATTERNS = [
    'favicon.ico',
    'favicon.png',
    'favicon.svg',
    'favicon-32x32.png',
    'favicon-16x16.png',
    'apple-touch-icon.png',
    'icon.png',
    'icon.ico',
    'icon.svg',
    'logo.png',
    'logo.svg',
    'logo.ico',
];

// Common directories to check (priority order)
const COMMON_DIRS = [
    '',                     // root
    'public',
    'static',
    'assets',
    'images',
    'img',
    'icons',
    'favicon',
    // Frontend frameworks
    'frontend/public',
    'client/public',
    'src/assets',
    'src/assets/images',
    'src/images',
    'src/icons',
    'app/assets',
    'app/assets/images',
    // Web directories
    'web',
    'www',
    'wwwroot',
    'htdocs',
    // Python/Flask/Django
    'app/static',
    'static/images',
    'staticfiles',
    // Rails
    'app/assets/images',
    // PHP/Laravel
    'public/images',
    'public/assets',
    'resources/assets',
    // .NET
    'wwwroot/images',
    'Content/images',
];

// Cache configuration
const CACHE_PREFIX = 'faviconCache_';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const NEGATIVE_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours for "not found"

/**
 * Create favicon finder instance
 * @param {string} vscodeOrigin - VS Code Server origin (e.g., https://vm.paysera.tech)
 * @param {string} folder - Project folder path
 * @returns {object} - Favicon finder instance
 */
function createFaviconFinder(vscodeOrigin, folder) {
    const cacheKey = CACHE_PREFIX + btoa(folder).replace(/[^a-zA-Z0-9]/g, '_');

    /**
     * Get cached favicon URL
     * @returns {Promise<{url: string|null, found: boolean, expired: boolean}>}
     */
    async function getCached() {
        return new Promise((resolve) => {
            if (typeof chrome === 'undefined' || !chrome.storage) {
                resolve({ url: null, found: false, expired: true });
                return;
            }

            chrome.storage.local.get([cacheKey], (result) => {
                const cached = result[cacheKey];
                if (!cached) {
                    resolve({ url: null, found: false, expired: true });
                    return;
                }

                const now = Date.now();
                const ttl = cached.isNegative ? NEGATIVE_CACHE_TTL_MS : CACHE_TTL_MS;

                if (now - cached.timestamp > ttl) {
                    // Cache expired
                    resolve({ url: cached.url, found: true, expired: true });
                    return;
                }

                resolve({ url: cached.url, found: true, expired: false });
            });
        });
    }

    /**
     * Save to cache
     * @param {string|null} url - Favicon URL or null if not found
     */
    async function saveToCache(url) {
        if (typeof chrome === 'undefined' || !chrome.storage) {
            return;
        }

        const cacheEntry = {
            url: url,
            timestamp: Date.now(),
            isNegative: url === null,
            folder: folder,
        };

        chrome.storage.local.set({ [cacheKey]: cacheEntry }, () => {
            if (url) {
                console.log(`Favicon Finder: Cached custom favicon for ${folder}`);
            } else {
                console.log(`Favicon Finder: Cached negative result for ${folder}`);
            }
        });
    }

    /**
     * Build all possible favicon URLs to check
     * @returns {string[]} - Array of URLs to try
     */
    function buildSearchUrls() {
        const urls = [];

        // Build URLs for each pattern in each directory
        for (const pattern of FAVICON_PATTERNS) {
            for (const dir of COMMON_DIRS) {
                const relativePath = dir ? `${dir}/${pattern}` : pattern;
                urls.push(`${vscodeOrigin}/${relativePath}`);
            }
        }

        return urls;
    }

    /**
     * Check if a URL returns a valid image
     * @param {string} url - URL to check
     * @returns {Promise<boolean>}
     */
    async function checkUrl(url) {
        try {
            const response = await fetch(url, {
                method: 'HEAD',
                signal: AbortSignal.timeout(2000), // 2 second timeout per request
            });

            if (!response.ok) return false;

            const contentType = response.headers.get('content-type') || '';
            return contentType.includes('image') ||
                   contentType.includes('svg') ||
                   contentType.includes('icon');
        } catch {
            return false;
        }
    }

    /**
     * Search for favicon file
     * Checks URLs in batches to avoid overwhelming the server
     * @returns {Promise<string|null>} - Favicon URL or null
     */
    async function search() {
        const urls = buildSearchUrls();
        const batchSize = 5; // Check 5 URLs at a time

        console.log(`Favicon Finder: Searching ${urls.length} possible locations...`);

        for (let i = 0; i < urls.length; i += batchSize) {
            const batch = urls.slice(i, i + batchSize);

            const results = await Promise.all(
                batch.map(async (url) => {
                    const exists = await checkUrl(url);
                    return exists ? url : null;
                })
            );

            const found = results.find(url => url !== null);
            if (found) {
                console.log(`Favicon Finder: Found custom favicon at ${found}`);
                return found;
            }
        }

        console.log('Favicon Finder: No custom favicon found');
        return null;
    }

    /**
     * Find favicon with caching
     * @param {boolean} forceRefresh - Bypass cache and search again
     * @returns {Promise<string|null>} - Favicon URL or null
     */
    async function findFavicon(forceRefresh = false) {
        // Check cache first
        if (!forceRefresh) {
            const cached = await getCached();

            if (cached.found && !cached.expired) {
                if (cached.url) {
                    console.log(`Favicon Finder: Using cached favicon for ${folder}`);
                } else {
                    console.log(`Favicon Finder: Using cached negative result for ${folder}`);
                }
                return cached.url;
            }
        }

        // Search for favicon
        const faviconUrl = await search();

        // Cache the result (including negative results)
        await saveToCache(faviconUrl);

        return faviconUrl;
    }

    /**
     * Clear cache for this project
     */
    async function clearCache() {
        if (typeof chrome === 'undefined' || !chrome.storage) {
            return;
        }

        chrome.storage.local.remove([cacheKey], () => {
            console.log(`Favicon Finder: Cleared cache for ${folder}`);
        });
    }

    return {
        findFavicon,
        clearCache,
        getCached,
    };
}

// Export for both Node.js and browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createFaviconFinder, FAVICON_PATTERNS, COMMON_DIRS };
} else if (typeof window !== 'undefined') {
    window.FaviconFinder = { createFaviconFinder, FAVICON_PATTERNS, COMMON_DIRS };
}
