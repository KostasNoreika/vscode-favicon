/**
 * Unit Tests for LRU Cache
 * Tests memory management, eviction policy, and statistics tracking
 */

const LRUCache = require('../../lib/lru-cache');

describe('LRUCache', () => {
    describe('Constructor', () => {
        test('should create cache with default maxSize', () => {
            const cache = new LRUCache();
            expect(cache.maxSize).toBe(100);
            expect(cache.size).toBe(0);
        });

        test('should create cache with custom maxSize', () => {
            const cache = new LRUCache(50);
            expect(cache.maxSize).toBe(50);
            expect(cache.size).toBe(0);
        });

        test('should throw error for invalid maxSize', () => {
            expect(() => new LRUCache(0)).toThrow('LRUCache maxSize must be at least 1');
            expect(() => new LRUCache(-1)).toThrow('LRUCache maxSize must be at least 1');
        });
    });

    describe('Basic Operations', () => {
        let cache;

        beforeEach(() => {
            cache = new LRUCache(3);
        });

        test('should set and get values', () => {
            cache.set('key1', 'value1');
            expect(cache.get('key1')).toBe('value1');
            expect(cache.size).toBe(1);
        });

        test('should return undefined for missing keys', () => {
            expect(cache.get('nonexistent')).toBeUndefined();
        });

        test('should update existing keys', () => {
            cache.set('key1', 'value1');
            cache.set('key1', 'value2');
            expect(cache.get('key1')).toBe('value2');
            expect(cache.size).toBe(1);
        });

        test('should check if key exists', () => {
            cache.set('key1', 'value1');
            expect(cache.has('key1')).toBe(true);
            expect(cache.has('key2')).toBe(false);
        });

        test('should delete keys', () => {
            cache.set('key1', 'value1');
            expect(cache.delete('key1')).toBe(true);
            expect(cache.has('key1')).toBe(false);
            expect(cache.size).toBe(0);
        });

        test('should handle different value types', () => {
            // Use larger cache to avoid evictions during test
            const largeCache = new LRUCache(10);

            largeCache.set('string', 'text');
            largeCache.set('number', 42);
            largeCache.set('object', { foo: 'bar' });
            largeCache.set('array', [1, 2, 3]);
            largeCache.set('null', null);

            expect(largeCache.get('string')).toBe('text');
            expect(largeCache.get('number')).toBe(42);
            expect(largeCache.get('object')).toEqual({ foo: 'bar' });
            expect(largeCache.get('array')).toEqual([1, 2, 3]);
            expect(largeCache.get('null')).toBe(null);
        });
    });

    describe('LRU Eviction Policy', () => {
        let cache;

        beforeEach(() => {
            cache = new LRUCache(3);
        });

        test('should evict least recently used item when full', () => {
            cache.set('key1', 'value1');
            cache.set('key2', 'value2');
            cache.set('key3', 'value3');
            cache.set('key4', 'value4'); // Should evict key1

            expect(cache.has('key1')).toBe(false);
            expect(cache.has('key2')).toBe(true);
            expect(cache.has('key3')).toBe(true);
            expect(cache.has('key4')).toBe(true);
            expect(cache.size).toBe(3);
        });

        test('should update LRU position on get', () => {
            cache.set('key1', 'value1');
            cache.set('key2', 'value2');
            cache.set('key3', 'value3');

            // Access key1 to make it most recently used
            cache.get('key1');

            // Add key4, should evict key2 (now LRU)
            cache.set('key4', 'value4');

            expect(cache.has('key1')).toBe(true);
            expect(cache.has('key2')).toBe(false);
            expect(cache.has('key3')).toBe(true);
            expect(cache.has('key4')).toBe(true);
        });

        test('should update LRU position on set of existing key', () => {
            cache.set('key1', 'value1');
            cache.set('key2', 'value2');
            cache.set('key3', 'value3');

            // Update key1 to make it most recently used
            cache.set('key1', 'updated1');

            // Add key4, should evict key2
            cache.set('key4', 'value4');

            expect(cache.has('key1')).toBe(true);
            expect(cache.get('key1')).toBe('updated1');
            expect(cache.has('key2')).toBe(false);
            expect(cache.has('key3')).toBe(true);
            expect(cache.has('key4')).toBe(true);
        });

        test('should maintain correct order with mixed operations', () => {
            cache.set('a', 1);
            cache.set('b', 2);
            cache.set('c', 3);
            cache.get('a'); // a is now MRU: b, c, a
            cache.set('d', 4); // Evicts b: c, a, d

            expect(cache.keys()).toEqual(['c', 'a', 'd']);
            expect(cache.has('b')).toBe(false);
        });
    });

    describe('Statistics Tracking', () => {
        let cache;

        beforeEach(() => {
            cache = new LRUCache(3);
        });

        test('should track hits and misses', () => {
            cache.set('key1', 'value1');
            cache.get('key1'); // Hit
            cache.get('key2'); // Miss
            cache.get('key1'); // Hit
            cache.get('key3'); // Miss

            const stats = cache.getStats();
            expect(stats.hits).toBe(2);
            expect(stats.misses).toBe(2);
            expect(stats.hitRate).toBe('50.0%');
        });

        test('should track evictions', () => {
            cache.set('key1', 'value1');
            cache.set('key2', 'value2');
            cache.set('key3', 'value3');
            cache.set('key4', 'value4'); // Eviction
            cache.set('key5', 'value5'); // Eviction

            const stats = cache.getStats();
            expect(stats.evictions).toBe(2);
        });

        test('should track sets', () => {
            cache.set('key1', 'value1');
            cache.set('key2', 'value2');
            cache.set('key1', 'updated'); // Update counts as set

            const stats = cache.getStats();
            expect(stats.sets).toBe(3);
        });

        test('should calculate utilization percentage', () => {
            cache.set('key1', 'value1');
            cache.set('key2', 'value2');

            const stats = cache.getStats();
            expect(stats.utilizationPercent).toBe('66.7%');
        });

        test('should return N/A for hit rate when no operations', () => {
            const stats = cache.getStats();
            expect(stats.hitRate).toBe('N/A');
        });

        test('should reset statistics on clear', () => {
            cache.set('key1', 'value1');
            cache.get('key1');
            cache.clear();

            const stats = cache.getStats();
            expect(stats.hits).toBe(0);
            expect(stats.misses).toBe(0);
            expect(stats.evictions).toBe(0);
            expect(stats.sets).toBe(0);
            expect(stats.size).toBe(0);
        });
    });

    describe('Utility Methods', () => {
        let cache;

        beforeEach(() => {
            cache = new LRUCache(5);
            cache.set('key1', 'value1');
            cache.set('key2', 'value2');
            cache.set('key3', 'value3');
        });

        test('should return all keys in LRU order', () => {
            expect(cache.keys()).toEqual(['key1', 'key2', 'key3']);
        });

        test('should return all values in LRU order', () => {
            expect(cache.values()).toEqual(['value1', 'value2', 'value3']);
        });

        test('should return all entries in LRU order', () => {
            expect(cache.entries()).toEqual([
                ['key1', 'value1'],
                ['key2', 'value2'],
                ['key3', 'value3'],
            ]);
        });

        test('should clear all items', () => {
            cache.clear();
            expect(cache.size).toBe(0);
            expect(cache.keys()).toEqual([]);
        });
    });

    describe('Edge Cases', () => {
        test('should handle maxSize of 1', () => {
            const cache = new LRUCache(1);
            cache.set('key1', 'value1');
            cache.set('key2', 'value2');

            expect(cache.size).toBe(1);
            expect(cache.has('key1')).toBe(false);
            expect(cache.has('key2')).toBe(true);
        });

        test('should handle large number of items', () => {
            const cache = new LRUCache(100);
            for (let i = 0; i < 200; i++) {
                cache.set(`key${i}`, `value${i}`);
            }

            expect(cache.size).toBe(100);
            expect(cache.getStats().evictions).toBe(100);
            expect(cache.has('key0')).toBe(false);
            expect(cache.has('key199')).toBe(true);
        });

        test('should handle rapid successive operations', () => {
            const cache = new LRUCache(10);

            // Rapid sets
            for (let i = 0; i < 100; i++) {
                cache.set(`key${i % 15}`, `value${i}`);
            }

            expect(cache.size).toBeLessThanOrEqual(10);

            // Rapid gets
            for (let i = 0; i < 100; i++) {
                cache.get(`key${i % 15}`);
            }

            const stats = cache.getStats();
            expect(stats.hits + stats.misses).toBe(100);
        });

        test('should handle empty string keys and values', () => {
            const cache = new LRUCache(3);
            cache.set('', '');
            cache.set('key', '');
            cache.set('', 'value');

            expect(cache.get('')).toBe('value');
            expect(cache.get('key')).toBe('');
        });

        test('should handle undefined and null values', () => {
            const cache = new LRUCache(3);
            cache.set('undefined', undefined);
            cache.set('null', null);

            expect(cache.get('undefined')).toBeUndefined();
            expect(cache.get('null')).toBe(null);
            expect(cache.has('undefined')).toBe(true);
            expect(cache.has('null')).toBe(true);
        });
    });

    describe('Performance Characteristics', () => {
        test('should maintain O(1) performance for get/set', () => {
            const cache = new LRUCache(1000);
            const iterations = 10000;

            const startSet = Date.now();
            for (let i = 0; i < iterations; i++) {
                cache.set(`key${i}`, `value${i}`);
            }
            const setTime = Date.now() - startSet;

            const startGet = Date.now();
            for (let i = 0; i < iterations; i++) {
                cache.get(`key${i}`);
            }
            const getTime = Date.now() - startGet;

            // Operations should be fast even with many items
            expect(setTime).toBeLessThan(1000); // Less than 1 second
            expect(getTime).toBeLessThan(500); // Less than 0.5 seconds
        });
    });
});
