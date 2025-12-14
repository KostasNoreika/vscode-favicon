const fs = require('fs');
const path = require('path');
const config = require('./config');
const logger = require('./logger');

/**
 * Centralized Registry Cache with TTL and File Watch Invalidation
 *
 * Features:
 * - In-memory cache with configurable TTL (default 60 seconds)
 * - Automatic invalidation on registry file changes (fs.watch with debouncing)
 * - Cache statistics (hits, misses, invalidations, hit rate)
 * - Graceful degradation (returns stale cache on read errors)
 * - Thread-safe (single cache instance per process)
 * - Optimized single-pass registry parsing
 * - FIX QUA-028: Cache warming on startup for reduced first-request latency
 */

// Cache state
let registryCache = null;
let cacheTimestamp = 0;
const cacheStats = {
    hits: 0,
    misses: 0,
    invalidations: 0,
};

// File watcher with debouncing
let watcher = null;
let debounceTimeout = null;

/**
 * Setup file watcher for automatic cache invalidation with debouncing
 * Watches the registry file for changes and invalidates cache after 500ms debounce
 */
function setupWatcher() {
    if (watcher) return;

    try {
        watcher = fs.watch(config.registryPath, (eventType) => {
            if (eventType === 'change') {
                // Debounce invalidation to prevent multiple rapid invalidations
                if (debounceTimeout) {
                    clearTimeout(debounceTimeout);
                }

                debounceTimeout = setTimeout(async () => {
                    // FIX QUA-015: Validate JSON before invalidating cache
                    try {
                        const data = await fs.promises.readFile(config.registryPath, 'utf8');
                        JSON.parse(data); // Validate JSON syntax

                        logger.info(
                            {
                                registryPath: config.registryPath,
                                cacheAge: registryCache ? Date.now() - cacheTimestamp : null,
                            },
                            'Registry file changed, invalidating cache'
                        );

                        registryCache = null;
                        cacheTimestamp = 0;
                        cacheStats.invalidations++;
                    } catch (err) {
                        // FIX QUA-015: Keep stale cache on invalid JSON
                        logger.error(
                            {
                                err,
                                registryPath: config.registryPath,
                                cacheAge: registryCache ? Date.now() - cacheTimestamp : null,
                            },
                            'Registry file changed but contains invalid JSON, keeping stale cache'
                        );
                    } finally {
                        debounceTimeout = null;
                    }
                }, 500); // 500ms debounce
            }
        });

        watcher.on('error', (err) => {
            logger.error({ err, registryPath: config.registryPath }, 'File watcher error');
        });

        logger.info({ registryPath: config.registryPath }, 'Registry file watch enabled');
    } catch (err) {
        logger.warn({ err, registryPath: config.registryPath }, 'Could not setup file watcher');
    }
}

/**
 * PERF-008: Load and parse registry with optimized single-pass flattened structure
 * Combines all possible project sources into one array before iteration
 * Returns: { projects: { path: projectInfo }, original: rawRegistry }
 */
async function loadRegistryFromDisk() {
    const data = await fs.promises.readFile(config.registryPath, 'utf8');
    let rawRegistry = JSON.parse(data);

    // Handle array format (registry is [metadata, projects])
    let registry = Array.isArray(rawRegistry) ? rawRegistry[1] || {} : rawRegistry;

    // Flatten the registry structure for easier lookup
    const flatProjects = {};

    // Combine all possible project sources into one array with type annotation
    // This reduces iterations from 4 to 1
    const allProjects = [
        ...(registry.development || []).map((p) => ({ ...p, type: 'dev' })),
        ...(registry.production || []).map((p) => ({ ...p, type: 'prod' })),
        ...(registry.projects?.development || []).map((p) => ({ ...p, type: 'dev' })),
        ...(registry.projects?.production || []).map((p) => ({ ...p, type: 'prod' })),
    ];

    // Single iteration through all projects with dual indexing
    for (const project of allProjects) {
        // Index by name for name-based lookups
        if (project.name) {
            flatProjects[project.name] = project;
        }

        // Index by path for path-based lookups
        if (project.path) {
            flatProjects[project.path] = project;
        }
    }

    return {
        projects: flatProjects,
        original: rawRegistry,
    };
}

/**
 * Gets the project registry with TTL-based caching and graceful degradation.
 * Returns cached data if within TTL, otherwise reloads from disk.
 * On read errors, returns stale cache if available, or empty registry as last resort.
 *
 * @returns {Promise<{projects: Object, original: Object}>} Registry object with flattened projects map and original data
 * @returns {Promise<{projects: Object.<string, Object>}>} projects - Map of project paths/names to project metadata
 * @returns {Promise<Object>} original - Original registry data from file
 *
 * @example
 * const registry = await getRegistry();
 * const projectInfo = registry.projects['/opt/dev/myproject'];
 * // projectInfo contains: { name, path, type, port, ... }
 */
async function getRegistry() {
    const now = Date.now();

    // Return cached data if valid (within TTL)
    if (registryCache && now - cacheTimestamp < config.registryCacheTtl) {
        cacheStats.hits++;
        return registryCache;
    }

    // Cache miss - reload from disk
    cacheStats.misses++;

    try {
        const registry = await loadRegistryFromDisk();

        // Update cache
        registryCache = registry;
        cacheTimestamp = now;

        logger.info(
            {
                projectCount: Object.keys(registry.projects).length,
                registryPath: config.registryPath,
                ttl: config.registryCacheTtl,
            },
            'Registry loaded and cached'
        );

        return registry;
    } catch (error) {
        logger.error(
            {
                err: error,
                registryPath: config.registryPath,
            },
            'Failed to load registry'
        );

        // Graceful degradation: return stale cache if available
        if (registryCache) {
            logger.warn(
                {
                    cacheAge: Date.now() - cacheTimestamp,
                    ttl: config.registryCacheTtl,
                },
                'Using stale registry cache due to error'
            );
            return registryCache;
        }

        // No cache available - return empty registry
        return {
            projects: {},
            original: {},
        };
    }
}

/**
 * Warms the registry cache on startup to reduce first-request latency.
 * Preloads registry data into memory by calling getRegistry().
 * Should be called during application initialization for optimal performance.
 *
 * @returns {Promise<void>} Resolves when cache is warmed successfully
 * @throws {Error} If registry file cannot be read and no fallback cache exists
 *
 * @example
 * // Call during server startup
 * await warmCache();
 * logger.info('Registry cache ready');
 */
async function warmCache() {
    logger.debug({ registryPath: config.registryPath }, 'Warming registry cache');
    await getRegistry();
    logger.debug('Registry cache warmed successfully');
}

/**
 * FIX QUA-013: Get project info by validated path
 * Centralizes duplicate registry lookup logic used across endpoints
 *
 * Looks up project by path first, then by project name as fallback
 *
 * @param {string} validatedPath - Validated absolute project path
 * @returns {Promise<Object>} Project info object (empty if not found)
 */
async function getProjectInfo(validatedPath) {
    const registry = await getRegistry();
    const projectName = path.basename(validatedPath);

    // Try to find by path first, then by name
    return registry.projects?.[validatedPath] || registry.projects?.[projectName] || {};
}

/**
 * Get cache statistics for monitoring
 *
 * @returns {Object} Cache stats with hit rate, age, and TTL
 */
function getCacheStats() {
    const totalRequests = cacheStats.hits + cacheStats.misses;
    const hitRate =
        totalRequests > 0 ? ((cacheStats.hits / totalRequests) * 100).toFixed(1) + '%' : 'N/A';

    return {
        hits: cacheStats.hits,
        misses: cacheStats.misses,
        invalidations: cacheStats.invalidations,
        hitRate,
        cached: registryCache !== null,
        cacheAge: registryCache ? Date.now() - cacheTimestamp : null,
        ttl: config.registryCacheTtl,
    };
}

/**
 * Manually invalidate cache
 * Useful for testing or forced reloads
 */
function invalidateCache() {
    logger.info(
        {
            cacheAge: registryCache ? Date.now() - cacheTimestamp : null,
        },
        'Cache manually invalidated'
    );

    registryCache = null;
    cacheTimestamp = 0;
    cacheStats.invalidations++;
}

/**
 * Reset cache statistics
 * Useful for testing or monitoring reset
 */
function resetStats() {
    cacheStats.hits = 0;
    cacheStats.misses = 0;
    cacheStats.invalidations = 0;
}

/**
 * Close file watcher for graceful shutdown
 */
function closeWatcher() {
    if (debounceTimeout) {
        clearTimeout(debounceTimeout);
        debounceTimeout = null;
    }

    if (watcher) {
        watcher.close();
        watcher = null;
        logger.info('Registry file watcher closed');
    }
}

// Initialize watcher on module load
setupWatcher();

module.exports = {
    getRegistry,
    getCacheStats,
    invalidateCache,
    resetStats,
    closeWatcher,
    warmCache,
    getProjectInfo,
};
