const FaviconService = require('../../lib/services/favicon-service');
const LRUCache = require('../../lib/lru-cache');

describe('FaviconService - Cache Warming', () => {
    let faviconService;
    let faviconCache;
    let mockRegistryCache;

    const mockTypeColors = {
        dev: '#4ECDC4',
        prod: '#FF6B6B',
        staging: '#FFEAA7',
    };

    const mockDefaultColors = ['#FF6B6B', '#4ECDC4', '#45B7D1'];

    beforeEach(() => {
        faviconCache = new LRUCache(100);

        // Mock registry with some test projects
        mockRegistryCache = {
            getRegistry: jest.fn().mockResolvedValue({
                projects: {
                    '/opt/dev/project1': { name: 'Project 1', type: 'dev' },
                    '/opt/dev/project2': { name: 'Project 2', type: 'prod' },
                    '/opt/dev/project3': { name: 'Project 3', type: 'staging' },
                },
                original: {},
            }),
        };

        faviconService = new FaviconService({
            registryCache: mockRegistryCache,
            faviconCache,
            typeColors: mockTypeColors,
            defaultColors: mockDefaultColors,
        });
    });

    describe('warmCache', () => {
        it('should have warmCache method', () => {
            expect(typeof faviconService.warmCache).toBe('function');
        });

        it('should return immediately with background flag', async () => {
            const projectPaths = ['/opt/dev/project1', '/opt/dev/project2'];
            const startTime = Date.now();

            const result = await faviconService.warmCache(projectPaths);
            const callDuration = Date.now() - startTime;

            // Should return almost immediately (< 100ms)
            expect(callDuration).toBeLessThan(100);
            expect(result.background).toBe(true);
            expect(result.promise).toBeDefined();
        });

        it('should warm cache for all provided projects in background', async () => {
            const projectPaths = ['/opt/dev/project1', '/opt/dev/project2'];

            const result = await faviconService.warmCache(projectPaths, { timeout: 1000 });

            // Wait for background warming to complete
            const warmingResult = await result.promise;

            expect(warmingResult.warmed).toBe(2); // 2 projects
            expect(warmingResult.failed).toBe(0);

            // Verify cache contains both regular and grayscale versions
            const stats = faviconCache.getStats();
            expect(stats.size).toBe(4); // 2 projects * 2 versions each
        });

        it('should handle empty project list gracefully', async () => {
            const result = await faviconService.warmCache([]);

            expect(result.warmed).toBe(0);
            expect(result.failed).toBe(0);
            expect(result.skipped).toBe(0);
            expect(result.durationMs).toBe(0);
        });

        it('should handle null/undefined project list gracefully', async () => {
            const result1 = await faviconService.warmCache(null);
            const result2 = await faviconService.warmCache(undefined);

            expect(result1.warmed).toBe(0);
            expect(result2.warmed).toBe(0);
        });

        it('should continue warming even if some projects fail', async () => {
            // Mock getFavicon to fail for specific project
            const originalGetFavicon = faviconService.getFavicon.bind(faviconService);
            faviconService.getFavicon = jest.fn().mockImplementation(async (projectPath, options) => {
                if (projectPath.includes('project2')) {
                    throw new Error('Mock error for project2');
                }
                return originalGetFavicon(projectPath, options);
            });

            const projectPaths = ['/opt/dev/project1', '/opt/dev/project2', '/opt/dev/project3'];

            const result = await faviconService.warmCache(projectPaths, { timeout: 2000 });
            const warmingResult = await result.promise;

            // Should have warmed some projects and failed on project2
            expect(warmingResult.warmed + warmingResult.failed).toBe(3);
            expect(warmingResult.failed).toBeGreaterThan(0);

            // Cleanup mock
            faviconService.getFavicon = originalGetFavicon;
        });

        it('should respect timeout and abort warming if exceeded', async () => {
            // Create a long list of projects
            const projectPaths = Array.from({ length: 100 }, (_, i) => `/opt/dev/project${i}`);

            const _result = await faviconService.warmCache(projectPaths, { timeout: 100 });

            // Wait for timeout
            await new Promise((resolve) => setTimeout(resolve, 200));

            // Should have timed out before warming all 100 projects
            const stats = faviconCache.getStats();
            expect(stats.size).toBeLessThan(200); // 100 projects * 2 versions each
        });

        it('should generate both regular and grayscale versions', async () => {
            const projectPaths = ['/opt/dev/project1'];

            const result = await faviconService.warmCache(projectPaths, { timeout: 1000 });
            await result.promise;

            // Check that both versions are in cache
            const regularKey = FaviconService.makeCacheKey('favicon', '/opt/dev/project1', '');
            const grayscaleKey = FaviconService.makeCacheKey('favicon', '/opt/dev/project1', 'gray');

            const regular = faviconCache.get(regularKey);
            const grayscale = faviconCache.get(grayscaleKey);

            expect(regular).toBeDefined();
            expect(grayscale).toBeDefined();
            expect(regular.contentType).toBe('image/svg+xml');
            expect(grayscale.contentType).toBe('image/svg+xml');
        });

        it('should improve cache hit rate for warmed projects', async () => {
            const projectPaths = ['/opt/dev/project1', '/opt/dev/project2'];

            // Warm cache
            const result = await faviconService.warmCache(projectPaths, { timeout: 1000 });
            await result.promise;

            // Get initial stats
            const warmStats = faviconCache.getStats();
            const hitsBeforeFetch = warmStats.hits;
            const _missesBeforeFetch = warmStats.misses;

            // Request favicons that were warmed
            await faviconService.getFavicon('/opt/dev/project1');
            await faviconService.getFavicon('/opt/dev/project2');

            const stats = faviconCache.getStats();

            // Should have cache hits for the warmed projects
            expect(stats.hits).toBeGreaterThan(hitsBeforeFetch);
            expect(stats.hitRate).not.toBe('0.0%');
        });

        it('should include warming results in final stats', async () => {
            const projectPaths = ['/opt/dev/project1', '/opt/dev/project2', '/opt/dev/project3'];

            const result = await faviconService.warmCache(projectPaths, { timeout: 2000 });
            const warmingResult = await result.promise;

            expect(warmingResult).toHaveProperty('warmed');
            expect(warmingResult).toHaveProperty('failed');
            expect(warmingResult).toHaveProperty('total');
            expect(warmingResult.total).toBe(3);
        });
    });

    describe('warmCache - error handling', () => {
        it('should catch and log errors without crashing', async () => {
            // Mock getFavicon to throw an error
            const originalGetFavicon = faviconService.getFavicon.bind(faviconService);
            faviconService.getFavicon = jest.fn().mockRejectedValue(new Error('Test error'));

            const projectPaths = ['/opt/dev/project1'];

            const result = await faviconService.warmCache(projectPaths, { timeout: 1000 });

            // Should not throw
            await expect(result.promise).resolves.toBeDefined();

            const warmingResult = await result.promise;
            expect(warmingResult.failed).toBe(1);
            expect(warmingResult.warmed).toBe(0);

            // Restore
            faviconService.getFavicon = originalGetFavicon;
        });
    });

    describe('warmCache - performance benchmarking', () => {
        it('should complete warming within reasonable time for small project set', async () => {
            const projectPaths = [
                '/opt/dev/project1',
                '/opt/dev/project2',
                '/opt/dev/project3',
                '/opt/dev/project4',
                '/opt/dev/project5',
            ];

            const startTime = Date.now();
            const result = await faviconService.warmCache(projectPaths, { timeout: 5000 });
            await result.promise;
            const duration = Date.now() - startTime;

            // Should complete in under 2 seconds for 5 projects
            expect(duration).toBeLessThan(2000);
        });

        it('should not block server startup (returns immediately)', async () => {
            const projectPaths = Array.from({ length: 50 }, (_, i) => `/opt/dev/project${i}`);

            const startTime = Date.now();
            await faviconService.warmCache(projectPaths);
            const callDuration = Date.now() - startTime;

            // Should return in under 50ms (non-blocking)
            expect(callDuration).toBeLessThan(50);
        });
    });
});
