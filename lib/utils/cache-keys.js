/**
 * Cache key utilities for consistent key generation across services
 * @module cache-keys
 *
 * FIX REF-026: Extracted from FaviconService to break circular dependency
 * between FaviconService and FaviconGenerator.
 */

const CACHE_VERSION = 'v1';

/**
 * Generate a versioned cache key
 *
 * Creates consistent cache keys across all caching layers (favicon cache, color cache).
 * Version prefix allows cache invalidation when key format changes.
 *
 * @param {string} type - Key type (e.g., 'color', 'favicon', 'registry')
 * @param {...string} parts - Key parts to join (nullish values filtered out)
 * @returns {string} Versioned cache key (format: "v1:type:part1:part2:...")
 * @throws {Error} If type is not a non-empty string
 *
 * @example
 * makeCacheKey('favicon', '/opt/dev/project')
 * // Returns: 'v1:favicon:/opt/dev/project'
 *
 * @example
 * makeCacheKey('favicon', '/opt/dev/project', 'gray')
 * // Returns: 'v1:favicon:/opt/dev/project:gray'
 *
 * @example
 * makeCacheKey('color', 'my-project')
 * // Returns: 'v1:color:my-project'
 *
 * @example
 * makeCacheKey('favicon', '/opt/dev/project', null, '', 'gray')
 * // Returns: 'v1:favicon:/opt/dev/project:gray' (null and empty strings filtered)
 */
function makeCacheKey(type, ...parts) {
    if (!type || typeof type !== 'string') {
        throw new Error('Cache key type must be a non-empty string');
    }
    const validParts = parts.filter((part) => part != null && part !== '');
    return `${CACHE_VERSION}:${type}:${validParts.join(':')}`;
}

module.exports = { makeCacheKey, CACHE_VERSION };
