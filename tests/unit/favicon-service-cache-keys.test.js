/**
 * FIX REF-026: Unit tests for centralized cache key generation
 *
 * Tests the makeCacheKey static method and its usage throughout FaviconService.
 * Ensures consistent, collision-resistant cache keys with version prefix.
 */

const FaviconService = require('../../lib/services/favicon-service');
const LRUCache = require('../../lib/lru-cache');

describe('FaviconService.makeCacheKey - FIX REF-026', () => {
    describe('Static method - basic functionality', () => {
        it('should generate cache key with version prefix', () => {
            const key = FaviconService.makeCacheKey('favicon', '/opt/dev/project');
            expect(key).toBe('v1:favicon:/opt/dev/project');
        });

        it('should handle multiple parts', () => {
            const key = FaviconService.makeCacheKey('favicon', '/opt/dev/project', 'gray');
            expect(key).toBe('v1:favicon:/opt/dev/project:gray');
        });

        it('should handle single part', () => {
            const key = FaviconService.makeCacheKey('color', 'myproject');
            expect(key).toBe('v1:color:myproject');
        });

        it('should filter out empty string parts', () => {
            const key = FaviconService.makeCacheKey('favicon', '/opt/dev/project', '');
            expect(key).toBe('v1:favicon:/opt/dev/project');
        });

        it('should filter out null parts', () => {
            const key = FaviconService.makeCacheKey('favicon', '/opt/dev/project', null);
            expect(key).toBe('v1:favicon:/opt/dev/project');
        });

        it('should filter out undefined parts', () => {
            const key = FaviconService.makeCacheKey('favicon', '/opt/dev/project', undefined);
            expect(key).toBe('v1:favicon:/opt/dev/project');
        });

        it('should handle mix of valid and invalid parts', () => {
            const key = FaviconService.makeCacheKey('favicon', '/opt/dev/project', '', null, 'gray', undefined);
            expect(key).toBe('v1:favicon:/opt/dev/project:gray');
        });

        it('should preserve zero as valid part', () => {
            const key = FaviconService.makeCacheKey('test', 'path', 0);
            expect(key).toBe('v1:test:path:0');
        });
    });

    describe('Static method - validation', () => {
        it('should throw error for missing type', () => {
            expect(() => FaviconService.makeCacheKey()).toThrow('Cache key type must be a non-empty string');
        });

        it('should throw error for empty string type', () => {
            expect(() => FaviconService.makeCacheKey('')).toThrow('Cache key type must be a non-empty string');
        });

        it('should throw error for null type', () => {
            expect(() => FaviconService.makeCacheKey(null)).toThrow('Cache key type must be a non-empty string');
        });

        it('should throw error for non-string type', () => {
            expect(() => FaviconService.makeCacheKey(123)).toThrow('Cache key type must be a non-empty string');
        });

        it('should throw error for undefined type', () => {
            expect(() => FaviconService.makeCacheKey(undefined)).toThrow('Cache key type must be a non-empty string');
        });
    });

    describe('Static method - collision resistance', () => {
        it('should generate different keys for different types', () => {
            const key1 = FaviconService.makeCacheKey('favicon', '/opt/dev/project');
            const key2 = FaviconService.makeCacheKey('color', '/opt/dev/project');
            expect(key1).not.toBe(key2);
        });

        it('should generate different keys for different paths', () => {
            const key1 = FaviconService.makeCacheKey('favicon', '/opt/dev/project1');
            const key2 = FaviconService.makeCacheKey('favicon', '/opt/dev/project2');
            expect(key1).not.toBe(key2);
        });

        it('should generate different keys for grayscale vs color', () => {
            const key1 = FaviconService.makeCacheKey('favicon', '/opt/dev/project', 'gray');
            const key2 = FaviconService.makeCacheKey('favicon', '/opt/dev/project', '');
            expect(key1).not.toBe(key2);
        });

        it('should generate same key for same inputs', () => {
            const key1 = FaviconService.makeCacheKey('favicon', '/opt/dev/project', 'gray');
            const key2 = FaviconService.makeCacheKey('favicon', '/opt/dev/project', 'gray');
            expect(key1).toBe(key2);
        });

        it('should handle special characters in paths', () => {
            const key = FaviconService.makeCacheKey('favicon', '/opt/dev/my-project_123');
            expect(key).toBe('v1:favicon:/opt/dev/my-project_123');
        });

        it('should handle Unicode characters', () => {
            const key = FaviconService.makeCacheKey('color', '项目名称');
            expect(key).toBe('v1:color:项目名称');
        });
    });

    describe('Integration with FaviconService - favicon cache', () => {
        let service;
        let faviconCache;
        let _colorCache;

        beforeEach(() => {
            const mockRegistry = {
                getRegistry: jest.fn().mockResolvedValue({ projects: {} }),
            };
            faviconCache = new LRUCache(10);
            _colorCache = new LRUCache(10);

            service = new FaviconService({
                registryCache: mockRegistry,
                faviconCache: faviconCache,
                typeColors: { dev: '#00ff00', prod: '#ff0000' },
                defaultColors: ['#0088cc', '#ff6600'],
            });
        });

        it('should use makeCacheKey for favicon cache - regular', async () => {
            const projectPath = '/opt/dev/test-project';
            const expectedKey = FaviconService.makeCacheKey('favicon', projectPath, '');

            // Generate favicon (will cache it)
            await service.getFavicon(projectPath, { grayscale: false });

            // Verify cache contains the expected key
            const cached = faviconCache.get(expectedKey);
            expect(cached).toBeDefined();
            expect(cached.contentType).toBe('image/svg+xml');
        });

        it('should use makeCacheKey for favicon cache - grayscale', async () => {
            const projectPath = '/opt/dev/test-project';
            const expectedKey = FaviconService.makeCacheKey('favicon', projectPath, 'gray');

            // Generate grayscale favicon
            await service.getFavicon(projectPath, { grayscale: true });

            // Verify cache contains the expected key
            const cached = faviconCache.get(expectedKey);
            expect(cached).toBeDefined();
            expect(cached.contentType).toBe('image/svg+xml');
        });

        it('should maintain separate cache entries for grayscale and regular', async () => {
            const projectPath = '/opt/dev/test-project';

            // Generate both versions
            await service.getFavicon(projectPath, { grayscale: false });
            await service.getFavicon(projectPath, { grayscale: true });

            // Verify both are cached with different keys
            const regularKey = FaviconService.makeCacheKey('favicon', projectPath, '');
            const grayKey = FaviconService.makeCacheKey('favicon', projectPath, 'gray');

            expect(faviconCache.get(regularKey)).toBeDefined();
            expect(faviconCache.get(grayKey)).toBeDefined();
            expect(regularKey).not.toBe(grayKey);
        });
    });

    describe('Integration with FaviconService - color cache', () => {
        let service;
        let colorCache;

        beforeEach(() => {
            const mockRegistry = {
                getRegistry: jest.fn().mockResolvedValue({ projects: {} }),
            };
            const faviconCache = new LRUCache(10);

            service = new FaviconService({
                registryCache: mockRegistry,
                faviconCache: faviconCache,
                typeColors: { dev: '#00ff00', prod: '#ff0000' },
                defaultColors: ['#0088cc', '#ff6600', '#9933cc'],
            });

            // Access the colorCache created internally
            colorCache = service.generator.colorCache;
        });

        it('should use makeCacheKey for color cache', () => {
            const projectName = 'test-project';
            const expectedKey = FaviconService.makeCacheKey('color', projectName);

            // Trigger color computation (type not in typeColors)
            const color = service.getTypeColor('unknown', projectName);

            // Verify cache contains the expected key
            const cached = colorCache.get(expectedKey);
            expect(cached).toBeDefined();
            expect(cached).toBe(color);
        });

        it('should return cached color on second call', () => {
            const projectName = 'test-project';

            // First call - computes and caches
            const color1 = service.getTypeColor('unknown', projectName);

            // Second call - should return cached value
            const color2 = service.getTypeColor('unknown', projectName);

            expect(color1).toBe(color2);

            // Verify cache hit
            const stats = colorCache.getStats();
            expect(stats.hits).toBeGreaterThan(0);
        });

        it('should maintain separate cache entries for different projects', () => {
            const project1 = 'project-one';
            const project2 = 'project-two';

            // Generate colors for different projects
            service.getTypeColor('unknown', project1);
            service.getTypeColor('unknown', project2);

            // Verify both are cached
            const key1 = FaviconService.makeCacheKey('color', project1);
            const key2 = FaviconService.makeCacheKey('color', project2);

            expect(colorCache.get(key1)).toBeDefined();
            expect(colorCache.get(key2)).toBeDefined();
            expect(key1).not.toBe(key2);
        });

        it('should not cache type colors (only computed colors)', () => {
            const projectName = 'test-project';

            // Get a type color (should not cache)
            service.getTypeColor('dev', projectName);

            // Verify cache is empty
            const stats = colorCache.getStats();
            expect(stats.size).toBe(0);
        });
    });

    describe('Cache key format stability', () => {
        it('should maintain consistent format across different executions', () => {
            const keys = [];
            for (let i = 0; i < 100; i++) {
                keys.push(FaviconService.makeCacheKey('favicon', '/opt/dev/project', 'gray'));
            }

            // All keys should be identical
            const uniqueKeys = new Set(keys);
            expect(uniqueKeys.size).toBe(1);
        });

        it('should use colon as delimiter consistently', () => {
            const key = FaviconService.makeCacheKey('favicon', '/opt/dev/project', 'gray');
            const parts = key.split(':');

            expect(parts).toEqual(['v1', 'favicon', '/opt/dev/project', 'gray']);
        });

        it('should always start with version prefix', () => {
            const faviconKey = FaviconService.makeCacheKey('favicon', '/opt/dev/project');
            const colorKey = FaviconService.makeCacheKey('color', 'project');

            expect(faviconKey).toMatch(/^v1:/);
            expect(colorKey).toMatch(/^v1:/);
        });
    });

    describe('Version prefix behavior', () => {
        it('should include v1 version prefix', () => {
            const key = FaviconService.makeCacheKey('favicon', '/opt/dev/project');
            expect(key).toMatch(/^v1:/);
        });

        it('should allow future version changes by using prefix', () => {
            // This test documents that the version prefix enables cache invalidation
            // If we change the version prefix in the future, old cache entries
            // will naturally be invalidated due to key mismatch
            const key = FaviconService.makeCacheKey('favicon', '/opt/dev/project');
            expect(key.startsWith('v1:')).toBe(true);

            // Future version would be 'v2:favicon:/opt/dev/project'
            // which would not match the v1 cached entries
        });
    });
});
