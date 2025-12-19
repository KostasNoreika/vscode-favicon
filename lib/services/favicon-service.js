const fs = require('fs');
const path = require('path');
const logger = require('../logger');
const FaviconFinder = require('./favicon-finder');
const FaviconGenerator = require('./favicon-generator');
const { makeCacheKey } = require('../utils/cache-keys');
const { retryFileOperation } = require('../utils/file-operations');
const LRUCache = require('../lru-cache');
const { PermissionError } = require('../errors');

// FIX PERF-005: Negative cache configuration for missing custom favicons
// Most projects don't have custom favicons - cache negative results to avoid repeated filesystem scans
const NEGATIVE_CACHE_CONFIG = {
    MAX_SIZE: 200, // Most projects won't have custom favicons
    TTL_MS: 300000, // 5 minutes TTL for negative results
};

/**
 * FIX REF-014: Refactored FaviconService with composition
 *
 * Orchestrates favicon operations using focused collaborators:
 * - FaviconFinder: Locates custom favicon files
 * - FaviconGenerator: Creates SVG favicons and manages colors
 *
 * FaviconService maintains caching layer and API compatibility.
 *
 * FIX PERF-005: Added negative caching to avoid repeated filesystem scans
 * for projects without custom favicons.
 */
class FaviconService {
    /**
     * FIX REF-026: Backward compatibility wrapper for makeCacheKey
     * Delegates to shared utility in lib/utils/cache-keys.js
     * @deprecated Use require('../utils/cache-keys').makeCacheKey directly
     */
    static makeCacheKey(type, ...parts) {
        return makeCacheKey(type, ...parts);
    }

    /**
     * Creates a new FaviconService instance with dependency injection.
     *
     * @param {Object} params - Configuration object
     * @param {Object} params.registryCache - Registry cache instance with getRegistry() method
     * @param {Object} params.faviconCache - LRU cache instance with get() and set() methods
     * @param {Object} params.typeColors - Map of project types to color values (e.g., {dev: '#00ACC1', prod: '#D32F2F'})
     * @param {string[]} params.defaultColors - Array of fallback color values for project name hashing
     * @param {Object} [params.negativeCache] - Optional LRU cache for negative results (projects without custom favicons)
     * @throws {Error} If registryCache is missing or invalid
     * @throws {Error} If faviconCache is missing or invalid
     * @throws {Error} If typeColors is missing or not an object
     * @throws {Error} If defaultColors is missing or not an array
     */
    constructor({ registryCache, faviconCache, typeColors, defaultColors, negativeCache }) {
        if (!registryCache || typeof registryCache.getRegistry !== 'function') {
            throw new Error('FaviconService requires registryCache with getRegistry method');
        }
        if (!faviconCache || typeof faviconCache.get !== 'function' || typeof faviconCache.set !== 'function') {
            throw new Error('FaviconService requires faviconCache with get and set methods');
        }
        if (!typeColors || typeof typeColors !== 'object') {
            throw new Error('FaviconService requires typeColors object');
        }
        if (!defaultColors || !Array.isArray(defaultColors)) {
            throw new Error('FaviconService requires defaultColors array');
        }

        this.registryCache = registryCache;
        this.faviconCache = faviconCache;
        this.finder = new FaviconFinder();
        this.generator = new FaviconGenerator({ typeColors, defaultColors });

        // FIX PERF-005: Negative cache for projects without custom favicons
        // Stores { path: { hasCustomFavicon: false, timestamp: Date.now() } }
        // Prevents repeated filesystem scans for projects that don't have custom favicons
        this.negativeCache = negativeCache || new LRUCache(NEGATIVE_CACHE_CONFIG.MAX_SIZE);
        this.negativeCacheTtl = NEGATIVE_CACHE_CONFIG.TTL_MS;
    }

    /**
     * Searches for a custom favicon file in the project directory.
     * Performs a quick search in common locations, then falls back to full project scan if needed.
     *
     * @param {string} projectPath - Absolute path to the project directory
     * @returns {Promise<string|null>} Absolute path to favicon file, or null if not found
     *
     * @example
     * const faviconPath = await service.findFaviconFile('/opt/dev/myproject');
     * if (faviconPath) {
     *   console.log('Found custom favicon at:', faviconPath);
     * }
     */
    async findFaviconFile(projectPath) {
        return this.finder.findFaviconFile(projectPath);
    }

    async quickSearch(projectPath) {
        return this.finder.quickSearch(projectPath);
    }

    async fullProjectScan(projectPath) {
        return this.finder.fullProjectScan(projectPath);
    }

    /**
     * FIX PERF-005: Check if negative cache entry is still valid
     * @param {string} projectPath - Absolute path to the project directory
     * @returns {boolean} True if negative cache indicates no custom favicon exists (and entry is not expired)
     * @private
     */
    _hasValidNegativeCacheEntry(projectPath) {
        const negativeCacheKey = makeCacheKey('favicon-negative', projectPath);
        const negativeEntry = this.negativeCache.get(negativeCacheKey);

        if (!negativeEntry) {
            return false;
        }

        // Check if entry has expired
        const now = Date.now();
        const age = now - negativeEntry.timestamp;

        if (age > this.negativeCacheTtl) {
            // Entry expired, remove it
            this.negativeCache.delete(negativeCacheKey);
            return false;
        }

        // Valid negative cache entry - no custom favicon exists
        return negativeEntry.hasCustomFavicon === false;
    }

    /**
     * FIX PERF-005: Store negative cache entry (project has no custom favicon)
     * @param {string} projectPath - Absolute path to the project directory
     * @private
     */
    _storeNegativeCacheEntry(projectPath) {
        const negativeCacheKey = makeCacheKey('favicon-negative', projectPath);
        this.negativeCache.set(negativeCacheKey, {
            hasCustomFavicon: false,
            timestamp: Date.now(),
        });
        logger.debug({ projectPath, ttlMs: this.negativeCacheTtl }, 'Stored negative cache entry for project without custom favicon');
    }

    /**
     * Generates an SVG favicon based on project name and metadata.
     * Creates a color-coded, text-based favicon with project initials and optional environment badge.
     *
     * @param {string} projectName - Name of the project (used for initials and color selection)
     * @param {Object} [projectInfo={}] - Project metadata from registry
     * @param {string} [projectInfo.type] - Project type/environment (e.g., 'dev', 'prod', 'staging')
     * @param {string} [projectInfo.port] - Port number to display in badge
     * @param {Object} [options={}] - Generation options
     * @param {boolean} [options.grayscale=false] - Whether to convert colors to grayscale
     * @returns {string} SVG markup as string (XSS-safe, sanitized)
     *
     * @example
     * const svg = service.generateSvgFavicon('my-project', { type: 'dev', port: '8080' });
     * // Returns: '<svg>...</svg>' with project initials and dev environment badge
     */
    generateSvgFavicon(projectName, projectInfo = {}, options = {}) {
        return this.generator.generateSvgFavicon(projectName, projectInfo, options);
    }

    getTypeColor(type, projectName) {
        return this.generator.getTypeColor(type, projectName);
    }

    toGrayscale(hexColor) {
        return this.generator.toGrayscale(hexColor);
    }

    generatePortText(type, sanitizedPort) {
        return this.generator.generatePortText(type, sanitizedPort);
    }

    getContentType(filePath) {
        return this.generator.getContentType(filePath);
    }

    /**
     * Read file with error handling and automatic retry for transient errors
     * Uses shared utility lib/utils/file-operations.js for retry logic
     *
     * @param {string} filePath - Path to file to read
     * @returns {Promise<Buffer|null>} File buffer or null on error (returns null for missing files to allow fallback)
     * @throws {PermissionError} When permission is denied (EACCES, EPERM)
     */
    async readFileWithErrorHandling(filePath) {
        try {
            // Use shared retry utility for transient errors (EAGAIN, EBUSY, ETIMEDOUT, EMFILE, ENFILE)
            return await retryFileOperation(
                () => fs.promises.readFile(filePath),
                {
                    operationName: `reading ${path.basename(filePath)}`,
                }
            );
        } catch (err) {
            // Handle non-retryable errors
            switch (err.code) {
                case 'ENOENT':
                    // File not found - return null to allow fallback to generated favicon
                    logger.debug({ filePath, err: err.message }, 'Favicon file not found (race condition)');
                    return null;
                case 'EACCES':
                case 'EPERM':
                    // Permission denied - throw typed error for proper HTTP status code
                    logger.warn({ filePath, err: err.message, code: err.code }, 'Permission denied reading favicon file');
                    throw new PermissionError('Access denied to favicon file', { filePath, code: err.code });
                case 'EISDIR':
                    logger.warn({ filePath, err: err.message }, 'Path is a directory, not a file');
                    return null;
                case 'ENOTDIR':
                    logger.warn({ filePath, err: err.message }, 'Invalid path component in favicon path');
                    return null;
                case 'EIO':
                    logger.error({ filePath, err: err.message }, 'I/O error reading favicon file');
                    return null;
                // Retryable errors that exhausted retries - logged by retryFileOperation
                case 'EMFILE':
                case 'ENFILE':
                case 'EBUSY':
                case 'EAGAIN':
                case 'ETIMEDOUT':
                    logger.error({ filePath, code: err.code, err: err.message }, 'File operation failed after retries');
                    return null;
                default:
                    logger.error({ filePath, err: err.message, code: err.code, stack: err.stack }, 'Unexpected error reading favicon file');
                    return null;
            }
        }
    }

    /**
     * Gets a favicon for the specified project path.
     * First searches for custom favicon files in the project directory.
     * Falls back to generating an SVG favicon based on project metadata if no custom favicon is found.
     *
     * FIX PERF-005: Added negative caching to avoid repeated filesystem scans for projects
     * without custom favicons. Most projects don't have custom favicons, so caching negative
     * results (with 5-minute TTL) significantly reduces filesystem operations.
     *
     * FIX PERF-012: Uses makeCacheKey for consistent cache key format across modules.
     *
     * @param {string} projectPath - Absolute path to the project directory
     * @param {Object} [options={}] - Configuration options
     * @param {boolean} [options.grayscale=false] - Whether to convert colors to grayscale
     * @returns {Promise<{contentType: string, data: Buffer}>} Favicon data with content type
     * @throws {Error} If project path is invalid or inaccessible
     *
     * @example
     * const favicon = await service.getFavicon('/opt/dev/myproject', { grayscale: true });
     * res.setHeader('Content-Type', favicon.contentType);
     * res.send(favicon.data);
     */
    async getFavicon(projectPath, options = {}) {
        // FIX PERF-012: Use makeCacheKey for consistent cache key format across modules
        const cacheKey = makeCacheKey('favicon', projectPath, options.grayscale ? 'gray' : '');
        const cached = this.faviconCache.get(cacheKey);
        if (cached) return cached;

        // FIX PERF-005: Check negative cache before filesystem scan
        // If we recently confirmed this project has no custom favicon, skip the search
        const hasNegativeCacheHit = this._hasValidNegativeCacheEntry(projectPath);
        let existingFavicon = null;

        if (hasNegativeCacheHit) {
            logger.debug({ projectPath }, 'Negative cache hit - skipping favicon file search');
        } else {
            existingFavicon = await this.findFaviconFile(projectPath);

            // FIX PERF-005: Store negative result if no custom favicon found
            if (!existingFavicon) {
                this._storeNegativeCacheEntry(projectPath);
            }
        }

        if (existingFavicon) {
            const data = await this.readFileWithErrorHandling(existingFavicon);
            if (data) {
                const contentType = this.getContentType(existingFavicon);
                const result = { contentType, data };
                this.faviconCache.set(cacheKey, result);
                return result;
            }
            logger.info({ projectPath, existingFavicon }, 'Falling back to generated favicon due to file read error');
        }

        const registry = await this.registryCache.getRegistry();
        const projectName = path.basename(projectPath);
        // eslint-disable-next-line security/detect-object-injection
        const projectInfo = registry.projects?.[projectPath] || registry.projects?.[projectName] || {};
        const svg = this.generateSvgFavicon(projectName, projectInfo, options);
        const result = { contentType: 'image/svg+xml', data: Buffer.from(svg) };
        this.faviconCache.set(cacheKey, result);
        return result;
    }

    async warmCache(projectPaths, options = {}) {
        const { timeout = 5000 } = options;
        const startTime = Date.now();

        if (!projectPaths || projectPaths.length === 0) {
            logger.debug('No projects to warm, skipping favicon cache warming');
            return { warmed: 0, failed: 0, skipped: 0, durationMs: 0 };
        }

        logger.info({ projectCount: projectPaths.length, timeout }, 'Starting favicon cache warming in background');

        const warmingPromise = (async () => {
            const results = { warmed: 0, failed: 0, skipped: 0, errors: [] };
            const warmPromises = projectPaths.map(async (projectPath) => {
                try {
                    await this.getFavicon(projectPath, { grayscale: false });
                    await this.getFavicon(projectPath, { grayscale: true });
                    results.warmed++;
                    logger.debug({ projectPath }, 'Favicon warmed successfully');
                } catch (err) {
                    results.failed++;
                    results.errors.push({ projectPath, error: err.message });
                    logger.debug({ projectPath, err }, 'Favicon warming failed for project');
                }
            });

            const timeoutPromise = new Promise((resolve) => setTimeout(resolve, timeout));
            await Promise.race([Promise.allSettled(warmPromises), timeoutPromise]);

            const duration = Date.now() - startTime;
            logger.info({ warmed: results.warmed, failed: results.failed, total: projectPaths.length, durationMs: duration, cacheStats: this.faviconCache.getStats() }, 'Favicon cache warming completed');
            return { ...results, total: projectPaths.length };
        })();

        warmingPromise.catch((err) => {
            logger.error({ err }, 'Favicon cache warming encountered unexpected error');
        });

        return { warmed: 0, failed: 0, skipped: 0, durationMs: Date.now() - startTime, background: true, promise: warmingPromise };
    }

    getStats() {
        const faviconStats = this.faviconCache.getStats();
        const colorStats = this.generator.getColorCacheStats();
        const negativeStats = this.negativeCache.getStats();

        return {
            faviconCache: {
                hits: faviconStats.hits,
                misses: faviconStats.misses,
                evictions: faviconStats.evictions,
                size: faviconStats.size,
                maxSize: faviconStats.maxSize,
                hitRate: faviconStats.hitRate,
                utilizationPercent: faviconStats.utilizationPercent,
            },
            colorCache: {
                hits: colorStats.hits,
                misses: colorStats.misses,
                evictions: colorStats.evictions,
                size: colorStats.size,
                maxSize: colorStats.maxSize,
                hitRate: colorStats.hitRate,
                utilizationPercent: colorStats.utilizationPercent,
            },
            negativeCache: {
                hits: negativeStats.hits,
                misses: negativeStats.misses,
                evictions: negativeStats.evictions,
                size: negativeStats.size,
                maxSize: negativeStats.maxSize,
                hitRate: negativeStats.hitRate,
                utilizationPercent: negativeStats.utilizationPercent,
                ttlMs: this.negativeCacheTtl,
            },
            combined: {
                totalHits: faviconStats.hits + colorStats.hits + negativeStats.hits,
                totalMisses: faviconStats.misses + colorStats.misses + negativeStats.misses,
                totalEvictions: faviconStats.evictions + colorStats.evictions + negativeStats.evictions,
                overallHitRate:
                    faviconStats.hits + colorStats.hits + negativeStats.hits + faviconStats.misses + colorStats.misses + negativeStats.misses > 0
                        ? (((faviconStats.hits + colorStats.hits + negativeStats.hits) / (faviconStats.hits + colorStats.hits + negativeStats.hits + faviconStats.misses + colorStats.misses + negativeStats.misses)) * 100).toFixed(1) + '%'
                        : 'N/A',
            },
        };
    }

}

module.exports = FaviconService;
