const fs = require('fs');
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

                debounceTimeout = setTimeout(() => {
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
                    debounceTimeout = null;
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
 * Normalize and flatten projects array with dual indexing (by name and path)
 * Indexes each project by both name and path for flexible lookups
 *
 * @param {Array} projects - Array of project objects
 * @param {string} type - Project type ('dev' or 'prod')
 * @param {Object} targetMap - Target object to populate with indexed projects
 */
function normalizeAndIndexProjects(projects, type, targetMap) {
    if (!Array.isArray(projects)) return;

    for (const project of projects) {
        const projectData = type === 'prod' ? { ...project, type: 'prod' } : project;

        // Index by name for name-based lookups
        if (project.name) {
            targetMap[project.name] = projectData;
        }

        // Index by path for path-based lookups
        if (project.path) {
            targetMap[project.path] = projectData;
        }
    }
}

/**
 * Load and parse registry with optimized single-pass flattened structure
 * Returns: { projects: { path: projectInfo }, original: rawRegistry }
 */
async function loadRegistryFromDisk() {
    const data = await fs.promises.readFile(config.registryPath, 'utf8');
    let rawRegistry = JSON.parse(data);

    // Handle array format (registry is [metadata, projects])
    let registry = Array.isArray(rawRegistry) ? rawRegistry[1] || {} : rawRegistry;

    // Flatten the registry structure for easier lookup
    const flatProjects = {};

    // Handle all formats - new structure and legacy structure
    normalizeAndIndexProjects(registry.development, 'dev', flatProjects);
    normalizeAndIndexProjects(registry.production, 'prod', flatProjects);
    normalizeAndIndexProjects(registry.projects?.development, 'dev', flatProjects);
    normalizeAndIndexProjects(registry.projects?.production, 'prod', flatProjects);

    return {
        projects: flatProjects,
        original: rawRegistry,
    };
}

/**
 * Get registry with TTL-based caching
 * Returns cached data if TTL not expired, otherwise reloads from disk
 *
 * @returns {Promise<{ projects: Object, original: Object }>}
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
};
