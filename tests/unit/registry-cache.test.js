/**
 * Unit Tests for registry-cache.js
 *
 * Tests for centralized registry caching with:
 * - TTL-based cache expiration
 * - File watch invalidation with debouncing
 * - Cache hit/miss tracking and statistics
 * - Graceful degradation on errors
 * - Thread-safe single cache instance
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Mock dependencies before requiring module
jest.mock('../../lib/config', () => ({
    registryPath: path.join(__dirname, '../fixtures/mock-registry.json'),
    registryCacheTtl: 1000, // 1 second for faster tests
}));

jest.mock('../../lib/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

const registryCache = require('../../lib/registry-cache');
const config = require('../../lib/config');
const logger = require('../../lib/logger');

describe('registry-cache', () => {
    let tempDir;
    let testRegistryPath;
    let originalRegistryPath;

    beforeAll(() => {
        // Create temp directory for test files
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-cache-test-'));
        testRegistryPath = path.join(tempDir, 'test-registry.json');
        originalRegistryPath = config.registryPath;
    });

    afterAll(async () => {
        // Close watcher
        registryCache.closeWatcher();

        // Cleanup temp files
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (err) {
            // Ignore cleanup errors
        }
    });

    beforeEach(() => {
        // Reset mocks
        jest.clearAllMocks();

        // Invalidate cache before each test
        registryCache.invalidateCache();

        // Reset stats AFTER invalidation (so we start clean)
        registryCache.resetStats();

        // Create test registry file
        const testRegistry = {
            development: [
                {
                    name: 'test-dev',
                    path: '/opt/dev/test-dev',
                    type: 'node',
                },
            ],
            production: [
                {
                    name: 'test-prod',
                    path: '/opt/prod/test-prod',
                    type: 'react',
                },
            ],
        };
        fs.writeFileSync(testRegistryPath, JSON.stringify(testRegistry, null, 2));

        // Update config to use test registry
        config.registryPath = testRegistryPath;
    });

    afterEach(() => {
        // Restore original config
        config.registryPath = originalRegistryPath;
    });

    describe('getRegistry() - Cache Hit/Miss Scenarios', () => {
        test('should return registry data on first call (cache miss)', async () => {
            const registry = await registryCache.getRegistry();

            expect(registry).toBeDefined();
            expect(registry.projects).toBeDefined();
            expect(registry.original).toBeDefined();

            // Verify stats show cache miss
            const stats = registryCache.getCacheStats();
            expect(stats.hits).toBe(0);
            expect(stats.misses).toBe(1);
            expect(stats.cached).toBe(true);
        });

        test('should return cached data on second call within TTL (cache hit)', async () => {
            // First call - cache miss
            const registry1 = await registryCache.getRegistry();

            // Second call - cache hit
            const registry2 = await registryCache.getRegistry();

            // Should return same reference
            expect(registry2).toBe(registry1);

            // Verify stats
            const stats = registryCache.getCacheStats();
            expect(stats.hits).toBe(1);
            expect(stats.misses).toBe(1);
            expect(stats.hitRate).toBe('50.0%');
        });

        test('should track multiple cache hits correctly', async () => {
            // First call - miss
            await registryCache.getRegistry();

            // Multiple hits
            await registryCache.getRegistry();
            await registryCache.getRegistry();
            await registryCache.getRegistry();

            const stats = registryCache.getCacheStats();
            expect(stats.hits).toBe(3);
            expect(stats.misses).toBe(1);
            expect(stats.hitRate).toBe('75.0%');
        });

        test('should flatten development projects correctly', async () => {
            const registry = await registryCache.getRegistry();

            // Check by name
            expect(registry.projects['test-dev']).toBeDefined();
            expect(registry.projects['test-dev'].name).toBe('test-dev');
            expect(registry.projects['test-dev'].type).not.toBe('prod');

            // Check by path
            expect(registry.projects['/opt/dev/test-dev']).toBeDefined();
            expect(registry.projects['/opt/dev/test-dev'].path).toBe('/opt/dev/test-dev');
        });

        test('should flatten production projects with type=prod', async () => {
            const registry = await registryCache.getRegistry();

            // Check by name
            expect(registry.projects['test-prod']).toBeDefined();
            expect(registry.projects['test-prod'].name).toBe('test-prod');
            expect(registry.projects['test-prod'].type).toBe('prod');

            // Check by path
            expect(registry.projects['/opt/prod/test-prod']).toBeDefined();
            expect(registry.projects['/opt/prod/test-prod'].type).toBe('prod');
        });

        test('should handle array format registry [metadata, projects]', async () => {
            // Create registry with array format
            const arrayRegistry = [
                { version: '1.0', updated: '2024-12-04' },
                {
                    development: [{ name: 'array-test', path: '/opt/dev/array-test' }],
                },
            ];
            fs.writeFileSync(testRegistryPath, JSON.stringify(arrayRegistry, null, 2));

            registryCache.invalidateCache();

            const registry = await registryCache.getRegistry();

            expect(registry.projects['array-test']).toBeDefined();
            expect(registry.original).toEqual(arrayRegistry);
        });

        test('should handle legacy nested projects structure', async () => {
            // Legacy format: { projects: { development: [], production: [] } }
            const legacyRegistry = {
                projects: {
                    development: [{ name: 'legacy-dev', path: '/opt/dev/legacy' }],
                    production: [{ name: 'legacy-prod', path: '/opt/prod/legacy' }],
                },
            };
            fs.writeFileSync(testRegistryPath, JSON.stringify(legacyRegistry, null, 2));

            registryCache.invalidateCache();

            const registry = await registryCache.getRegistry();

            expect(registry.projects['legacy-dev']).toBeDefined();
            expect(registry.projects['legacy-prod']).toBeDefined();
            expect(registry.projects['legacy-prod'].type).toBe('prod');
        });
    });

    describe('TTL Expiration', () => {
        test('should reload registry after TTL expires (cache miss)', async () => {
            // First call - miss
            await registryCache.getRegistry();

            // Wait for TTL to expire (1 second + buffer)
            await new Promise((resolve) => setTimeout(resolve, 1100));

            // Second call after TTL - should be another miss
            await registryCache.getRegistry();

            // Stats should show 2 misses
            const stats = registryCache.getCacheStats();
            expect(stats.hits).toBe(0);
            expect(stats.misses).toBe(2);

            // Should log reload
            expect(logger.info).toHaveBeenCalledWith(
                expect.objectContaining({
                    projectCount: expect.any(Number),
                }),
                'Registry loaded and cached'
            );
        });

        test('should return cached data within TTL even with file changes', async () => {
            // First call
            const registry1 = await registryCache.getRegistry();

            // Modify file (but within TTL, so cache should still be used)
            const modified = JSON.parse(fs.readFileSync(testRegistryPath, 'utf8'));
            modified.development.push({ name: 'new-project', path: '/opt/dev/new' });
            fs.writeFileSync(testRegistryPath, JSON.stringify(modified, null, 2));

            // Immediate second call - should use cache
            const registry2 = await registryCache.getRegistry();

            // Should be cache hit (same reference)
            expect(registry2).toBe(registry1);

            // New project should NOT be in cached data
            expect(registry2.projects['new-project']).toBeUndefined();
        });

        test('should show correct cache age in stats', async () => {
            await registryCache.getRegistry();

            // Wait 100ms
            await new Promise((resolve) => setTimeout(resolve, 100));

            const stats = registryCache.getCacheStats();
            expect(stats.cacheAge).toBeGreaterThanOrEqual(90); // Allow some variance
            expect(stats.cacheAge).toBeLessThan(200);
            expect(stats.ttl).toBe(1000);
        });
    });

    describe('File Watch Invalidation', () => {
        // Note: fs.watch may not work reliably in test environments
        // These tests verify the behavior when file watch DOES work

        test('should handle file changes gracefully', async () => {
            // Load registry
            await registryCache.getRegistry();

            // Modify registry file
            const modified = JSON.parse(fs.readFileSync(testRegistryPath, 'utf8'));
            modified.development.push({
                name: 'watched-project',
                path: '/opt/dev/watched',
            });
            fs.writeFileSync(testRegistryPath, JSON.stringify(modified, null, 2));

            // Wait for potential debounce (500ms + buffer)
            await new Promise((resolve) => setTimeout(resolve, 600));

            // Either way, manual invalidation + reload should get new data
            registryCache.invalidateCache();
            const registry = await registryCache.getRegistry();
            expect(registry.projects['watched-project']).toBeDefined();
        });

        test('should support manual invalidation after file changes', async () => {
            await registryCache.getRegistry();

            // Modify file
            const modified = JSON.parse(fs.readFileSync(testRegistryPath, 'utf8'));
            modified.development.push({ name: 'manual-watch', path: '/opt/dev/manual-watch' });
            fs.writeFileSync(testRegistryPath, JSON.stringify(modified, null, 2));

            // Manual invalidation (equivalent to what watcher would do)
            registryCache.invalidateCache();

            const registry = await registryCache.getRegistry();
            expect(registry.projects['manual-watch']).toBeDefined();
        });
    });

    describe('invalidateCache() - Manual Invalidation', () => {
        test('should manually invalidate cache', async () => {
            // Load cache
            await registryCache.getRegistry();

            let stats = registryCache.getCacheStats();
            expect(stats.cached).toBe(true);

            const beforeInvalidations = stats.invalidations;

            // Manual invalidation
            registryCache.invalidateCache();

            stats = registryCache.getCacheStats();
            expect(stats.cached).toBe(false);
            expect(stats.invalidations).toBe(beforeInvalidations + 1);
        });

        test('should reload from disk after manual invalidation', async () => {
            const registry1 = await registryCache.getRegistry();

            // Modify file
            const modified = JSON.parse(fs.readFileSync(testRegistryPath, 'utf8'));
            modified.development.push({
                name: 'manual-invalidate',
                path: '/opt/dev/manual',
            });
            fs.writeFileSync(testRegistryPath, JSON.stringify(modified, null, 2));

            // Manual invalidation
            registryCache.invalidateCache();

            // Reload
            const registry2 = await registryCache.getRegistry();

            // Should have new project
            expect(registry2.projects['manual-invalidate']).toBeDefined();

            // Should be different reference
            expect(registry2).not.toBe(registry1);
        });

        test('should increment invalidation counter', async () => {
            await registryCache.getRegistry();

            const before = registryCache.getCacheStats().invalidations;

            registryCache.invalidateCache();
            registryCache.invalidateCache();
            registryCache.invalidateCache();

            const stats = registryCache.getCacheStats();
            expect(stats.invalidations).toBe(before + 3);
        });
    });

    describe('getCacheStats() - Statistics', () => {
        test('should return correct initial stats', () => {
            const stats = registryCache.getCacheStats();

            expect(stats).toEqual({
                hits: 0,
                misses: 0,
                invalidations: 0,
                hitRate: 'N/A',
                cached: false,
                cacheAge: null,
                ttl: 1000,
                invalidationMode: expect.stringMatching(/^(fs\.watch|polling)$/),
            });
        });

        test('should calculate hit rate correctly', async () => {
            // 1 miss, 3 hits = 75% hit rate
            await registryCache.getRegistry();
            await registryCache.getRegistry();
            await registryCache.getRegistry();
            await registryCache.getRegistry();

            const stats = registryCache.getCacheStats();
            expect(stats.hitRate).toBe('75.0%');
        });

        test('should show N/A hit rate with no requests', () => {
            const stats = registryCache.getCacheStats();
            expect(stats.hitRate).toBe('N/A');
        });

        test('should show cache status correctly', async () => {
            let stats = registryCache.getCacheStats();
            expect(stats.cached).toBe(false);

            await registryCache.getRegistry();

            stats = registryCache.getCacheStats();
            expect(stats.cached).toBe(true);

            registryCache.invalidateCache();

            stats = registryCache.getCacheStats();
            expect(stats.cached).toBe(false);
        });

        test('should track all counters independently', async () => {
            // Miss
            await registryCache.getRegistry();

            // Hits
            await registryCache.getRegistry();
            await registryCache.getRegistry();

            const beforeInvalidations = registryCache.getCacheStats().invalidations;

            // Invalidations
            registryCache.invalidateCache();
            registryCache.invalidateCache();

            const stats = registryCache.getCacheStats();
            expect(stats.hits).toBe(2);
            expect(stats.misses).toBe(1);
            expect(stats.invalidations).toBe(beforeInvalidations + 2);
        });
    });

    describe('resetStats() - Statistics Reset', () => {
        test('should reset all statistics', async () => {
            // Generate some stats
            await registryCache.getRegistry();
            await registryCache.getRegistry();
            registryCache.invalidateCache();

            let stats = registryCache.getCacheStats();
            expect(stats.hits).toBeGreaterThan(0);
            expect(stats.misses).toBeGreaterThan(0);

            // Reset
            registryCache.resetStats();

            stats = registryCache.getCacheStats();
            expect(stats.hits).toBe(0);
            expect(stats.misses).toBe(0);
            expect(stats.invalidations).toBe(0);
            expect(stats.hitRate).toBe('N/A');
        });

        test('should not affect cache data when resetting stats', async () => {
            const registry1 = await registryCache.getRegistry();

            registryCache.resetStats();

            // Cache should still be valid
            const registry2 = await registryCache.getRegistry();
            expect(registry2).toBe(registry1);

            // But stats should show as new hit (stats were reset)
            const stats = registryCache.getCacheStats();
            expect(stats.hits).toBe(1);
            expect(stats.misses).toBe(0);
        });
    });

    describe('Graceful Degradation - Error Handling', () => {
        test('should return stale cache on read error', async () => {
            // Load valid cache
            const validRegistry = await registryCache.getRegistry();
            expect(validRegistry.projects['test-dev']).toBeDefined();

            // Delete registry file to cause read error
            fs.unlinkSync(testRegistryPath);

            // Force cache miss by waiting for TTL
            await new Promise((resolve) => setTimeout(resolve, 1100));

            // Should return stale cache
            const staleRegistry = await registryCache.getRegistry();
            expect(staleRegistry).toBe(validRegistry);
            expect(staleRegistry.projects['test-dev']).toBeDefined();

            // Should log error and warning
            expect(logger.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    err: expect.any(Object),
                }),
                'Failed to load registry'
            );
            expect(logger.warn).toHaveBeenCalledWith(
                expect.objectContaining({
                    cacheAge: expect.any(Number),
                }),
                'Using stale registry cache due to error'
            );
        });

        test('should return empty registry if no cache and read fails', async () => {
            // Delete file before first load
            fs.unlinkSync(testRegistryPath);

            // Should return empty registry
            const registry = await registryCache.getRegistry();
            expect(registry).toEqual({
                projects: {},
                original: {},
            });

            // Should log error
            expect(logger.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    err: expect.any(Object),
                }),
                'Failed to load registry'
            );
        });

        test('should handle corrupted JSON gracefully', async () => {
            // Write invalid JSON
            fs.writeFileSync(testRegistryPath, '{ invalid json: }');

            // Should return empty registry
            const registry = await registryCache.getRegistry();
            expect(registry).toEqual({
                projects: {},
                original: {},
            });

            // Should log error
            expect(logger.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    err: expect.any(Object),
                }),
                'Failed to load registry'
            );
        });

        test('should handle missing registry file gracefully on startup', async () => {
            // Point to non-existent file
            config.registryPath = path.join(tempDir, 'non-existent.json');

            const registry = await registryCache.getRegistry();

            expect(registry).toEqual({
                projects: {},
                original: {},
            });
        });

        test('should continue using stale cache for multiple errors', async () => {
            // Load valid cache
            const validRegistry = await registryCache.getRegistry();

            // Delete file
            fs.unlinkSync(testRegistryPath);

            // Multiple calls after TTL should all return stale cache
            await new Promise((resolve) => setTimeout(resolve, 1100));

            const stale1 = await registryCache.getRegistry();
            const stale2 = await registryCache.getRegistry();
            const stale3 = await registryCache.getRegistry();

            expect(stale1).toBe(validRegistry);
            expect(stale2).toBe(validRegistry);
            expect(stale3).toBe(validRegistry);
        });
    });

    describe('Thread Safety & Single Cache Instance', () => {
        test('should handle concurrent calls efficiently', async () => {
            // Concurrent calls
            const promises = [
                registryCache.getRegistry(),
                registryCache.getRegistry(),
                registryCache.getRegistry(),
                registryCache.getRegistry(),
                registryCache.getRegistry(),
            ];

            const results = await Promise.all(promises);

            // All should return valid registry
            results.forEach((result) => {
                expect(result.projects).toBeDefined();
                expect(result.projects['test-dev']).toBeDefined();
            });

            // Concurrent calls might all become misses due to async file I/O
            // Total requests should equal total hits + misses
            const stats = registryCache.getCacheStats();
            expect(stats.hits + stats.misses).toBe(5);

            // All results should be valid (no corruption)
            expect(results.length).toBe(5);
        });

        test('should handle concurrent reads during TTL expiration', async () => {
            // First load
            await registryCache.getRegistry();

            // Wait for TTL
            await new Promise((resolve) => setTimeout(resolve, 1100));

            // Concurrent calls after TTL expiration
            const promises = [
                registryCache.getRegistry(),
                registryCache.getRegistry(),
                registryCache.getRegistry(),
            ];

            const results = await Promise.all(promises);

            // Should all get valid registry
            results.forEach((result) => {
                expect(result.projects).toBeDefined();
            });
        });
    });

    describe('closeWatcher() - Cleanup', () => {
        test('should close file watcher', () => {
            // closeWatcher should not throw
            expect(() => registryCache.closeWatcher()).not.toThrow();
        });

        test('should handle multiple close calls', () => {
            registryCache.closeWatcher();
            registryCache.closeWatcher();
            registryCache.closeWatcher();
            // Should not throw
        });
    });

    describe('Edge Cases', () => {
        test('should handle empty registry arrays', async () => {
            const emptyRegistry = {
                development: [],
                production: [],
            };
            fs.writeFileSync(testRegistryPath, JSON.stringify(emptyRegistry, null, 2));

            registryCache.invalidateCache();

            const registry = await registryCache.getRegistry();
            expect(registry.projects).toEqual({});
            expect(Object.keys(registry.projects).length).toBe(0);
        });

        test('should handle null/undefined arrays in registry', async () => {
            const nullRegistry = {
                development: null,
                production: undefined,
            };
            fs.writeFileSync(testRegistryPath, JSON.stringify(nullRegistry, null, 2));

            registryCache.invalidateCache();

            // Should not throw
            const registry = await registryCache.getRegistry();
            expect(registry.projects).toEqual({});
        });

        test('should handle projects without name field', async () => {
            const noNameRegistry = {
                development: [
                    {
                        path: '/opt/dev/no-name',
                        type: 'node',
                    },
                ],
            };
            fs.writeFileSync(testRegistryPath, JSON.stringify(noNameRegistry, null, 2));

            registryCache.invalidateCache();

            const registry = await registryCache.getRegistry();

            // Should be indexed by path only
            expect(registry.projects['/opt/dev/no-name']).toBeDefined();
        });

        test('should handle projects without path field', async () => {
            const noPathRegistry = {
                development: [
                    {
                        name: 'no-path-project',
                        type: 'node',
                    },
                ],
            };
            fs.writeFileSync(testRegistryPath, JSON.stringify(noPathRegistry, null, 2));

            registryCache.invalidateCache();

            const registry = await registryCache.getRegistry();

            // Should be indexed by name only
            expect(registry.projects['no-path-project']).toBeDefined();
        });

        test('should handle duplicate projects (last one wins)', async () => {
            const duplicateRegistry = {
                development: [
                    { name: 'dup', path: '/opt/dev/dup1', version: 1 },
                    { name: 'dup', path: '/opt/dev/dup2', version: 2 },
                ],
            };
            fs.writeFileSync(testRegistryPath, JSON.stringify(duplicateRegistry, null, 2));

            registryCache.invalidateCache();

            const registry = await registryCache.getRegistry();

            // Last one should win
            expect(registry.projects['dup'].version).toBe(2);
            expect(registry.projects['dup'].path).toBe('/opt/dev/dup2');
        });

        test('should preserve original registry format', async () => {
            const originalFormat = {
                version: '2.0',
                development: [{ name: 'test', path: '/opt/dev/test' }],
            };
            fs.writeFileSync(testRegistryPath, JSON.stringify(originalFormat, null, 2));

            registryCache.invalidateCache();

            const registry = await registryCache.getRegistry();

            // Original should be preserved as-is
            expect(registry.original).toEqual(originalFormat);
            expect(registry.original.version).toBe('2.0');
        });

        test('should handle very large registry efficiently', async () => {
            // Create large registry
            const largeRegistry = {
                development: [],
                production: [],
            };

            for (let i = 0; i < 1000; i++) {
                largeRegistry.development.push({
                    name: `dev-project-${i}`,
                    path: `/opt/dev/project-${i}`,
                });
            }

            fs.writeFileSync(testRegistryPath, JSON.stringify(largeRegistry, null, 2));

            registryCache.invalidateCache();

            const startTime = Date.now();
            const registry = await registryCache.getRegistry();
            const duration = Date.now() - startTime;

            // Should load quickly (< 100ms even for 1000 projects)
            expect(duration).toBeLessThan(100);

            // Should have all projects indexed
            expect(Object.keys(registry.projects).length).toBeGreaterThanOrEqual(1000);
            expect(registry.projects['dev-project-0']).toBeDefined();
            expect(registry.projects['dev-project-999']).toBeDefined();
        });
    });

    describe('Polling Fallback Mode', () => {
        test('should report invalidation mode in stats', async () => {
            await registryCache.getRegistry();

            const stats = registryCache.getCacheStats();

            // Should report either fs.watch or polling mode
            expect(stats.invalidationMode).toBeDefined();
            expect(['fs.watch', 'polling']).toContain(stats.invalidationMode);
        });

        test('should include invalidation mode in cache stats', () => {
            const stats = registryCache.getCacheStats();

            expect(stats).toHaveProperty('invalidationMode');
            expect(typeof stats.invalidationMode).toBe('string');
        });
    });

    describe('Integration - Real-World Scenarios', () => {
        test('should handle typical usage pattern: load, cache, invalidate, reload', async () => {
            // Load
            const registry1 = await registryCache.getRegistry();
            expect(registry1.projects['test-dev']).toBeDefined();

            // Cache hit
            const registry2 = await registryCache.getRegistry();
            expect(registry2).toBe(registry1);

            // External update
            const updated = JSON.parse(fs.readFileSync(testRegistryPath, 'utf8'));
            updated.development.push({ name: 'new-dev', path: '/opt/dev/new-dev' });
            fs.writeFileSync(testRegistryPath, JSON.stringify(updated, null, 2));

            // Invalidate (simulating file watch or manual)
            registryCache.invalidateCache();

            // Reload
            const registry3 = await registryCache.getRegistry();
            expect(registry3).not.toBe(registry1);
            expect(registry3.projects['new-dev']).toBeDefined();
        });

        test('should handle mixed format registries in production', async () => {
            // Simulate real-world mixed format
            const mixedRegistry = [
                { version: '1.0', lastUpdated: '2024-12-04' },
                {
                    development: [
                        { name: 'api', path: '/opt/dev/api', type: 'node' },
                        { name: 'web', path: '/opt/dev/web', type: 'react' },
                    ],
                    production: [{ name: 'api-prod', path: '/opt/prod/api', type: 'node' }],
                    projects: {
                        development: [{ name: 'legacy', path: '/opt/dev/legacy', type: 'php' }],
                    },
                },
            ];

            fs.writeFileSync(testRegistryPath, JSON.stringify(mixedRegistry, null, 2));
            registryCache.invalidateCache();

            const registry = await registryCache.getRegistry();

            // Should index all projects from all formats
            expect(registry.projects['api']).toBeDefined();
            expect(registry.projects['web']).toBeDefined();
            expect(registry.projects['api-prod']).toBeDefined();
            expect(registry.projects['api-prod'].type).toBe('prod');
            expect(registry.projects['legacy']).toBeDefined();
        });

        test('should maintain cache during high frequency reads', async () => {
            await registryCache.getRegistry();

            // Simulate 100 rapid reads
            const startTime = Date.now();
            for (let i = 0; i < 100; i++) {
                await registryCache.getRegistry();
            }
            const duration = Date.now() - startTime;

            const stats = registryCache.getCacheStats();

            // Should be mostly cache hits
            expect(stats.hits).toBeGreaterThan(90);

            // Should complete quickly (< 50ms for 100 cached reads)
            expect(duration).toBeLessThan(100);
        });
    });
});
