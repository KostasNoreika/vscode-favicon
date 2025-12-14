/**
 * Unit Tests for Color Hash Memoization (PERF-009)
 * Tests that hash-based color calculation is cached properly
 */

const FaviconService = require('../../lib/services/favicon-service');

describe('Color Cache Memoization (PERF-009)', () => {
    let faviconService;
    let mockConfig;
    let mockRegistryCache;
    let mockFaviconCache;

    beforeEach(() => {
        // Mock config
        mockConfig = {
            typeColors: {
                prod: '#FF6B6B',
                dev: '#4ECDC4',
                staging: '#FFEAA7',
                test: '#A29BFE',
            },
            defaultColors: [
                '#FF6B6B',
                '#4ECDC4',
                '#45B7D1',
                '#96CEB4',
                '#FFEAA7',
                '#FD79A8',
                '#A29BFE',
                '#6C5CE7',
            ],
        };

        // Mock registry cache
        mockRegistryCache = {
            getRegistry: jest.fn().mockResolvedValue({
                projects: {},
                original: {},
            }),
        };

        // Mock favicon cache with getStats method
        mockFaviconCache = {
            get: jest.fn(),
            set: jest.fn(),
            getStats: jest.fn().mockReturnValue({
                hits: 0,
                misses: 0,
                evictions: 0,
                size: 0,
                maxSize: 100,
                hitRate: '0.0%',
                utilizationPercent: '0.0%',
            }),
        };

        faviconService = new FaviconService({
            registryCache: mockRegistryCache,
            faviconCache: mockFaviconCache,
            typeColors: mockConfig.typeColors,
            defaultColors: mockConfig.defaultColors,
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('Hash-based color memoization', () => {
        test('should return same color for repeated calls with same project name', () => {
            const projectName = 'test-project-123';

            // Call multiple times
            const color1 = faviconService.getTypeColor('unknown', projectName);
            const color2 = faviconService.getTypeColor('unknown', projectName);
            const color3 = faviconService.getTypeColor('unknown', projectName);

            // All should return the same color
            expect(color1).toBe(color2);
            expect(color2).toBe(color3);

            // Color should be from defaultColors
            expect(mockConfig.defaultColors).toContain(color1);
        });

        test('should cache computed colors to avoid rehashing', () => {
            const projectName = 'my-awesome-project';

            // Get initial stats
            const statsBefore = faviconService.getStats();
            const colorMissesBefore = statsBefore.colorCache.misses;
            const colorHitsBefore = statsBefore.colorCache.hits;

            // First call - should be a cache miss (computes hash)
            const color1 = faviconService.getTypeColor('unknown', projectName);

            const statsAfterFirst = faviconService.getStats();
            expect(statsAfterFirst.colorCache.misses).toBe(colorMissesBefore + 1);
            expect(statsAfterFirst.colorCache.size).toBe(1);

            // Second call - should be a cache hit (no hash computation)
            const color2 = faviconService.getTypeColor('unknown', projectName);

            const statsAfterSecond = faviconService.getStats();
            expect(statsAfterSecond.colorCache.hits).toBe(colorHitsBefore + 1);
            expect(statsAfterSecond.colorCache.misses).toBe(colorMissesBefore + 1); // Still same as after first

            // Colors should match
            expect(color1).toBe(color2);
        });

        test('should not cache known type colors', () => {
            // Known types should not use cache (they return directly from typeColors)
            const color1 = faviconService.getTypeColor('prod', 'project-name');
            const color2 = faviconService.getTypeColor('dev', 'another-project');

            const stats = faviconService.getStats();

            // No cache operations for known types
            expect(stats.colorCache.size).toBe(0);
            expect(stats.colorCache.hits).toBe(0);
            expect(stats.colorCache.misses).toBe(0);

            // Should return correct type colors
            expect(color1).toBe('#FF6B6B'); // prod
            expect(color2).toBe('#4ECDC4'); // dev
        });

        test('should cache different colors for different project names', () => {
            const project1 = 'project-alpha';
            const project2 = 'project-beta';
            const project3 = 'project-gamma';

            // Get colors for different projects
            const color1 = faviconService.getTypeColor('unknown', project1);
            const color2 = faviconService.getTypeColor('unknown', project2);
            const color3 = faviconService.getTypeColor('unknown', project3);

            const stats = faviconService.getStats();

            // Should have 3 cached entries
            expect(stats.colorCache.size).toBe(3);
            expect(stats.colorCache.misses).toBe(3); // 3 initial computations
            expect(stats.colorCache.hits).toBe(0); // No repeat calls yet

            // All colors should be from defaultColors
            expect(mockConfig.defaultColors).toContain(color1);
            expect(mockConfig.defaultColors).toContain(color2);
            expect(mockConfig.defaultColors).toContain(color3);
        });

        test('should handle empty project name', () => {
            const color1 = faviconService.getTypeColor('unknown', '');
            const color2 = faviconService.getTypeColor('unknown', '');

            // Should cache even for empty string
            expect(color1).toBe(color2);
            expect(mockConfig.defaultColors).toContain(color1);

            const stats = faviconService.getStats();
            expect(stats.colorCache.size).toBe(1);
            expect(stats.colorCache.hits).toBe(1);
        });

        test('should improve performance with repeated calls', () => {
            const projectName = 'performance-test-project';

            // First call - computes hash
            const start1 = process.hrtime.bigint();
            faviconService.getTypeColor('unknown', projectName);
            const _time1 = process.hrtime.bigint() - start1;

            // Repeated calls - should be faster (cached)
            let totalCachedTime = 0n;
            for (let i = 0; i < 100; i++) {
                const start = process.hrtime.bigint();
                faviconService.getTypeColor('unknown', projectName);
                totalCachedTime += process.hrtime.bigint() - start;
            }
            const _avgCachedTime = totalCachedTime / 100n;

            // Cache hits should be registered
            const stats = faviconService.getStats();
            expect(stats.colorCache.hits).toBe(100);
            expect(stats.colorCache.misses).toBe(1);

            // This is a basic benchmark - cached calls should generally be faster
            // but we won't enforce strict timing as it's environment-dependent
            expect(stats.colorCache.hitRate).toBe('99.0%');
        });

        test('should maintain cache size limit', () => {
            // colorCache is created with size 50 (see FaviconService constructor)
            const maxSize = 50;

            // Add more than maxSize entries
            for (let i = 0; i < maxSize + 10; i++) {
                faviconService.getTypeColor('unknown', `project-${i}`);
            }

            const stats = faviconService.getStats();

            // Cache size should not exceed maxSize
            expect(stats.colorCache.size).toBeLessThanOrEqual(maxSize);
            expect(stats.colorCache.maxSize).toBe(maxSize);

            // Should have evictions
            expect(stats.colorCache.evictions).toBeGreaterThan(0);
        });

        test('should provide accurate cache statistics', () => {
            const project1 = 'project-one';
            const project2 = 'project-two';

            // Initial state
            let stats = faviconService.getStats();
            expect(stats.colorCache).toBeDefined();
            expect(stats.colorCache.hits).toBe(0);
            expect(stats.colorCache.misses).toBe(0);
            expect(stats.colorCache.size).toBe(0);

            // First access - miss
            faviconService.getTypeColor('unknown', project1);
            stats = faviconService.getStats();
            expect(stats.colorCache.misses).toBe(1);
            expect(stats.colorCache.hits).toBe(0);

            // Repeat access - hit
            faviconService.getTypeColor('unknown', project1);
            stats = faviconService.getStats();
            expect(stats.colorCache.hits).toBe(1);

            // New project - miss
            faviconService.getTypeColor('unknown', project2);
            stats = faviconService.getStats();
            expect(stats.colorCache.misses).toBe(2);
            expect(stats.colorCache.size).toBe(2);

            // Check hit rate calculation
            expect(stats.colorCache.hitRate).toBe('33.3%'); // 1 hit out of 3 total accesses
        });

        test('should include color cache stats in combined stats', () => {
            faviconService.getTypeColor('unknown', 'test-project');
            faviconService.getTypeColor('unknown', 'test-project'); // Hit

            const stats = faviconService.getStats();

            // Should have separate stats for each cache
            expect(stats.faviconCache).toBeDefined();
            expect(stats.colorCache).toBeDefined();
            expect(stats.combined).toBeDefined();

            // Combined stats should aggregate both caches
            expect(stats.combined.totalHits).toBe(stats.faviconCache.hits + stats.colorCache.hits);
            expect(stats.combined.totalMisses).toBe(stats.faviconCache.misses + stats.colorCache.misses);
        });

        test('should handle deterministic hash collisions gracefully', () => {
            // While unlikely, if two project names hash to the same index,
            // they should still get cached separately and consistently
            const project1 = 'project-a';
            const project2 = 'project-b';

            const color1a = faviconService.getTypeColor('unknown', project1);
            const color2a = faviconService.getTypeColor('unknown', project2);
            const color1b = faviconService.getTypeColor('unknown', project1);
            const color2b = faviconService.getTypeColor('unknown', project2);

            // Each project should consistently return the same color
            expect(color1a).toBe(color1b);
            expect(color2a).toBe(color2b);

            const stats = faviconService.getStats();
            expect(stats.colorCache.size).toBe(2);
            expect(stats.colorCache.hits).toBe(2); // Two repeat calls
        });

        test('should not modify hash output when using cache', () => {
            const projectName = 'hash-consistency-test';

            // Get color from cache
            const cachedColor = faviconService.getTypeColor('unknown', projectName);

            // Manually compute what the hash should be (without cache)
            let hash = 0;
            for (let i = 0; i < projectName.length; i++) {
                hash = projectName.charCodeAt(i) + ((hash << 5) - hash);
            }
            const expectedColor = mockConfig.defaultColors[Math.abs(hash) % mockConfig.defaultColors.length];

            // Cache should return the same value as manual calculation
            expect(cachedColor).toBe(expectedColor);
        });
    });

    describe('Memory management', () => {
        test('should not grow cache indefinitely', () => {
            const maxSize = 50;

            // Add many unique projects
            for (let i = 0; i < 200; i++) {
                faviconService.getTypeColor('unknown', `project-${i}-unique`);
            }

            const stats = faviconService.getStats();

            // Cache should be capped at maxSize
            expect(stats.colorCache.size).toBe(maxSize);

            // Should have evicted old entries
            expect(stats.colorCache.evictions).toBeGreaterThan(0);

            // Utilization should be 100%
            expect(stats.colorCache.utilizationPercent).toBe('100.0%');
        });

        test('should evict least recently used entries', () => {
            const maxSize = 50;

            // Fill cache to capacity
            for (let i = 0; i < maxSize; i++) {
                faviconService.getTypeColor('unknown', `project-${i}`);
            }

            // Access first entry to make it recently used
            const keepAliveColor = faviconService.getTypeColor('unknown', 'project-0');

            // Add one more entry (should evict LRU, which is NOT project-0)
            faviconService.getTypeColor('unknown', 'new-project');

            // project-0 should still be in cache (it was accessed recently)
            const stats = faviconService.getStats();
            const hitsBefore = stats.colorCache.hits;

            const colorAfter = faviconService.getTypeColor('unknown', 'project-0');
            const statsAfter = faviconService.getStats();

            // Should be a cache hit (project-0 wasn't evicted)
            expect(statsAfter.colorCache.hits).toBe(hitsBefore + 1);
            expect(colorAfter).toBe(keepAliveColor);
        });
    });
});
