/**
 * LRU (Least Recently Used) Cache Implementation
 *
 * Features:
 * - Configurable maximum size limit to prevent memory leaks
 * - Automatic eviction of least recently used items when size limit is reached
 * - Comprehensive statistics tracking (hits, misses, evictions, hit rate)
 * - O(1) get/set operations using JavaScript Map (insertion-ordered)
 * - Optimized to avoid unnecessary delete/set when item is already most recent
 *
 * Usage:
 *   const cache = new LRUCache(100);
 *   cache.set('key', 'value');
 *   const value = cache.get('key');
 *   const stats = cache.getStats();
 */

class LRUCache {
    /**
     * Create a new LRU cache
     * @param {number} maxSize - Maximum number of items to store (default: 100)
     */
    constructor(maxSize = 100) {
        if (maxSize < 1) {
            throw new Error('LRUCache maxSize must be at least 1');
        }

        this.maxSize = maxSize;
        this.cache = new Map();
        this.lastKey = null; // Track most recently used key for optimization
        this.stats = {
            hits: 0,
            misses: 0,
            evictions: 0,
            sets: 0,
        };
    }

    /**
     * Get a value from cache
     * Moves the item to the end (most recently used) if found
     * Optimized to skip move if item is already most recent
     * @param {string} key - Cache key
     * @returns {*} Cached value or undefined if not found
     */
    get(key) {
        if (!this.cache.has(key)) {
            this.stats.misses++;
            return undefined;
        }

        this.stats.hits++;
        const value = this.cache.get(key);

        // Optimization: Only move to end if not already there
        // This avoids unnecessary delete/set operations for hot keys
        if (this.lastKey !== key) {
            this.cache.delete(key);
            this.cache.set(key, value);
            this.lastKey = key;
        }

        return value;
    }

    /**
     * Set a value in cache
     * Evicts least recently used item if cache is at max size
     * @param {string} key - Cache key
     * @param {*} value - Value to cache
     */
    set(key, value) {
        this.stats.sets++;

        // If key exists, delete it first to update position
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            // Cache is full and this is a new key - evict LRU item
            // First item in Map is the least recently used (oldest)
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
            this.stats.evictions++;

            // Update lastKey if we evicted it
            if (this.lastKey === firstKey) {
                this.lastKey = null;
            }
        }

        // Add to end (most recently used position)
        this.cache.set(key, value);
        this.lastKey = key;
    }

    /**
     * Check if a key exists in cache
     * Note: Does NOT update LRU position (use get() for that)
     * @param {string} key - Cache key
     * @returns {boolean} True if key exists
     */
    has(key) {
        return this.cache.has(key);
    }

    /**
     * Delete a specific key from cache
     * @param {string} key - Cache key
     * @returns {boolean} True if key was deleted
     */
    delete(key) {
        // Update lastKey if we're deleting it
        if (this.lastKey === key) {
            this.lastKey = null;
        }
        return this.cache.delete(key);
    }

    /**
     * Clear all items from cache and reset statistics
     */
    clear() {
        this.cache.clear();
        this.lastKey = null;
        this.stats = {
            hits: 0,
            misses: 0,
            evictions: 0,
            sets: 0,
        };
    }

    /**
     * Get cache size
     * @returns {number} Current number of items in cache
     */
    get size() {
        return this.cache.size;
    }

    /**
     * Get cache statistics
     * @returns {Object} Statistics object with hits, misses, evictions, size, and hit rate
     */
    getStats() {
        const total = this.stats.hits + this.stats.misses;
        const hitRate = total > 0 ? ((this.stats.hits / total) * 100).toFixed(1) + '%' : 'N/A';

        return {
            hits: this.stats.hits,
            misses: this.stats.misses,
            evictions: this.stats.evictions,
            sets: this.stats.sets,
            size: this.cache.size,
            maxSize: this.maxSize,
            hitRate: hitRate,
            utilizationPercent: ((this.cache.size / this.maxSize) * 100).toFixed(1) + '%',
        };
    }

    /**
     * Get all keys in cache (ordered from LRU to MRU)
     * Useful for debugging and testing
     * @returns {Array<string>} Array of keys
     */
    keys() {
        return Array.from(this.cache.keys());
    }

    /**
     * Get all values in cache (ordered from LRU to MRU)
     * Useful for debugging and testing
     * @returns {Array<*>} Array of values
     */
    values() {
        return Array.from(this.cache.values());
    }

    /**
     * Get all entries in cache (ordered from LRU to MRU)
     * Useful for debugging and testing
     * @returns {Array<[string, *]>} Array of [key, value] pairs
     */
    entries() {
        return Array.from(this.cache.entries());
    }
}

module.exports = LRUCache;
