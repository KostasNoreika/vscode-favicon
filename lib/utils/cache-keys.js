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
 * @param {...(string|number|boolean)} parts - Key parts to join (primitives only, nullish/empty values filtered out)
 * @returns {string} Versioned cache key (format: "v1:type:part1:part2:...")
 * @throws {Error} If type is not a non-empty string
 * @throws {TypeError} If any part is an object or array (prevents "[object Object]" collisions)
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
 *
 * @example
 * makeCacheKey('test', 'path', 123, true)
 * // Returns: 'v1:test:path:123:true' (numbers and booleans are allowed)
 *
 * @example
 * makeCacheKey('test', 'path', {foo: 'bar'})
 * // Throws TypeError: Cache key parts must be primitives (string, number, boolean)
 */
function makeCacheKey(type, ...parts) {
    if (!type || typeof type !== 'string') {
        throw new Error('Cache key type must be a non-empty string');
    }

    // Validate parts before filtering to prevent cache collisions from stringified objects
    for (const part of parts) {
        // Allow null, undefined, and empty string (will be filtered)
        if (part == null || part === '') {
            continue;
        }
        // Check for non-primitive types (objects, arrays, functions)
        const partType = typeof part;
        if (partType !== 'string' && partType !== 'number' && partType !== 'boolean') {
            throw new TypeError(`Cache key parts must be primitives (string, number, boolean), got ${partType}: ${Object.prototype.toString.call(part)}`);
        }
    }

    const validParts = parts.filter((part) => part != null && part !== '');
    return `${CACHE_VERSION}:${type}:${validParts.join(':')}`;
}

module.exports = { makeCacheKey, CACHE_VERSION };
