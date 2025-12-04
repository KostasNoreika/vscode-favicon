/**
 * Unit Tests for Registry Loading (registry-cache.js)
 * Tests registry loading, file watching, caching, and error handling
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Mock dependencies before requiring the module
jest.mock('../../lib/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

describe('Registry Loading', () => {
    let testRegistryPath;
    let registryCache;
    let logger;

    beforeAll(() => {
        // Create temp test registry path
        testRegistryPath = path.join(os.tmpdir(), `test-registry-${Date.now()}.json`);

        // Mock config before requiring registry-cache
        jest.doMock('../../lib/config', () => ({
            registryPath: testRegistryPath,
            registryCacheTtl: 1000, // 1 second for faster tests
        }));

        // Now require the modules
        logger = require('../../lib/logger');
        registryCache = require('../../lib/registry-cache');
    });

    beforeEach(() => {
        // Clear mocks and reset stats
        jest.clearAllMocks();
        if (registryCache.resetStats) {
            registryCache.resetStats();
        }
        if (registryCache.invalidateCache) {
            registryCache.invalidateCache();
        }

        // Ensure clean test file
        try {
            if (fs.existsSync(testRegistryPath)) {
                fs.unlinkSync(testRegistryPath);
            }
        } catch (err) {
            // Ignore
        }
    });

    afterAll(() => {
        // Cleanup
        if (registryCache.closeWatcher) {
            registryCache.closeWatcher();
        }
        try {
            if (fs.existsSync(testRegistryPath)) {
                fs.unlinkSync(testRegistryPath);
            }
        } catch (err) {
            // Ignore
        }
    });

    describe('Loading from Disk', () => {
        test('should load and parse registry from disk', async () => {
            const mockRegistry = {
                projects: {
                    development: [
                        { name: 'project1', path: '/opt/dev/project1', type: 'dev' },
                        { name: 'project2', path: '/opt/dev/project2', type: 'dev' },
                    ],
                },
            };

            fs.writeFileSync(testRegistryPath, JSON.stringify(mockRegistry));

            const result = await registryCache.getRegistry();

            expect(result).toHaveProperty('projects');
            expect(result).toHaveProperty('original');
            expect(result.projects['project1']).toBeDefined();
            expect(result.projects['project2']).toBeDefined();
        });

        test('should flatten registry structure for easier lookup', async () => {
            const mockRegistry = {
                development: [{ name: 'dev-app', path: '/opt/dev/app', port: 3000 }],
                production: [{ name: 'prod-api', path: '/opt/prod/api', port: 8080 }],
            };

            fs.writeFileSync(testRegistryPath, JSON.stringify(mockRegistry));

            const result = await registryCache.getRegistry();

            // Check both name and path indexing
            expect(result.projects['dev-app']).toBeDefined();
            expect(result.projects['/opt/dev/app']).toBeDefined();
            expect(result.projects['prod-api']).toBeDefined();
            expect(result.projects['/opt/prod/api']).toBeDefined();
        });

        test('should handle array format registry [metadata, projects]', async () => {
            const mockRegistry = [
                { version: '1.0', updated: '2024-01-01' },
                {
                    development: [{ name: 'app1', path: '/opt/dev/app1' }],
                },
            ];

            fs.writeFileSync(testRegistryPath, JSON.stringify(mockRegistry));

            const result = await registryCache.getRegistry();

            expect(result.projects['app1']).toBeDefined();
            expect(result.original).toEqual(mockRegistry);
        });

        test('should handle nested projects structure', async () => {
            const mockRegistry = {
                projects: {
                    development: [{ name: 'nested-app', path: '/opt/dev/nested', type: 'dev' }],
                    production: [{ name: 'nested-prod', path: '/opt/prod/nested', type: 'prod' }],
                },
            };

            fs.writeFileSync(testRegistryPath, JSON.stringify(mockRegistry));

            const result = await registryCache.getRegistry();

            expect(result.projects['nested-app']).toBeDefined();
            expect(result.projects['nested-prod']).toBeDefined();
            expect(result.projects['nested-prod'].type).toBe('prod');
        });

        test('should add type=prod to production projects', async () => {
            const mockRegistry = {
                production: [{ name: 'prod-service', path: '/opt/prod/service' }],
            };

            fs.writeFileSync(testRegistryPath, JSON.stringify(mockRegistry));

            const result = await registryCache.getRegistry();

            expect(result.projects['prod-service'].type).toBe('prod');
        });
    });

    describe('Caching Behavior', () => {
        test('should cache registry data with TTL', async () => {
            const mockRegistry = {
                development: [{ name: 'cached-app', path: '/opt/dev/cached' }],
            };

            fs.writeFileSync(testRegistryPath, JSON.stringify(mockRegistry));

            registryCache.resetStats();

            // First call - cache miss
            await registryCache.getRegistry();
            let stats = registryCache.getCacheStats();
            expect(stats.misses).toBe(1);
            expect(stats.hits).toBe(0);

            // Second call - cache hit
            await registryCache.getRegistry();
            stats = registryCache.getCacheStats();
            expect(stats.hits).toBe(1);
            expect(stats.misses).toBe(1);
        });

        test('should invalidate cache after TTL expires', async () => {
            const mockRegistry = {
                development: [{ name: 'ttl-app', path: '/opt/dev/ttl' }],
            };

            fs.writeFileSync(testRegistryPath, JSON.stringify(mockRegistry));

            registryCache.resetStats();

            // First call
            await registryCache.getRegistry();

            // Wait for TTL to expire (1 second + buffer)
            await new Promise((resolve) => setTimeout(resolve, 1100));

            // Second call should reload
            await registryCache.getRegistry();
            const stats = registryCache.getCacheStats();
            expect(stats.misses).toBe(2);
        });

        test('should provide cache statistics', async () => {
            const mockRegistry = {
                development: [{ name: 'stats-app', path: '/opt/dev/stats' }],
            };

            fs.writeFileSync(testRegistryPath, JSON.stringify(mockRegistry));

            registryCache.resetStats();

            await registryCache.getRegistry(); // Miss
            await registryCache.getRegistry(); // Hit
            await registryCache.getRegistry(); // Hit

            const stats = registryCache.getCacheStats();

            expect(stats).toHaveProperty('hits');
            expect(stats).toHaveProperty('misses');
            expect(stats).toHaveProperty('invalidations');
            expect(stats).toHaveProperty('hitRate');
            expect(stats).toHaveProperty('cached');
            expect(stats).toHaveProperty('cacheAge');
            expect(stats).toHaveProperty('ttl');

            expect(stats.hits).toBe(2);
            expect(stats.misses).toBe(1);
            expect(stats.hitRate).toBe('66.7%');
            expect(stats.cached).toBe(true);
        });

        test('should calculate hit rate correctly', async () => {
            const mockRegistry = {
                development: [{ name: 'rate-app', path: '/opt/dev/rate' }],
            };

            fs.writeFileSync(testRegistryPath, JSON.stringify(mockRegistry));

            registryCache.resetStats();

            // No operations yet
            let stats = registryCache.getCacheStats();
            expect(stats.hitRate).toBe('N/A');

            // 1 miss, 4 hits = 80%
            await registryCache.getRegistry(); // Miss
            await registryCache.getRegistry(); // Hit
            await registryCache.getRegistry(); // Hit
            await registryCache.getRegistry(); // Hit
            await registryCache.getRegistry(); // Hit

            stats = registryCache.getCacheStats();
            expect(stats.hitRate).toBe('80.0%');
        });
    });

    describe('File Watching', () => {
        test('should have watcher setup capability', () => {
            // Just verify the watcher functions exist
            expect(registryCache.closeWatcher).toBeDefined();
            expect(typeof registryCache.closeWatcher).toBe('function');
        });

        test('should debounce rapid file changes', (done) => {
            const mockRegistry = {
                development: [{ name: 'debounce-app', path: '/opt/dev/debounce' }],
            };

            fs.writeFileSync(testRegistryPath, JSON.stringify(mockRegistry));

            registryCache.getRegistry().then(() => {
                registryCache.resetStats();

                // Make rapid changes
                let changeCount = 0;
                const interval = setInterval(() => {
                    fs.writeFileSync(
                        testRegistryPath,
                        JSON.stringify({
                            development: [
                                { name: `debounce-app-${changeCount}`, path: '/opt/dev/debounce' },
                            ],
                        })
                    );
                    changeCount++;

                    if (changeCount >= 5) {
                        clearInterval(interval);

                        // Wait for debounce period
                        setTimeout(() => {
                            const stats = registryCache.getCacheStats();
                            // Should have fewer invalidations than changes due to debouncing
                            expect(stats.invalidations).toBeLessThan(5);
                            done();
                        }, 1000);
                    }
                }, 50);
            });
        }, 10000);
    });

    describe('Error Handling', () => {
        test('should handle missing registry file', async () => {
            // Don't create the file
            const result = await registryCache.getRegistry();

            expect(result).toHaveProperty('projects');
            expect(result).toHaveProperty('original');
            expect(Object.keys(result.projects)).toHaveLength(0);
        });

        test('should handle invalid JSON in registry file', async () => {
            fs.writeFileSync(testRegistryPath, 'invalid json {{{');

            const result = await registryCache.getRegistry();

            expect(result.projects).toEqual({});
        });

        test('should gracefully degrade on read errors', async () => {
            // First, load valid registry to have something in cache
            const mockRegistry = {
                development: [{ name: 'stale-app', path: '/opt/dev/stale' }],
            };

            fs.writeFileSync(testRegistryPath, JSON.stringify(mockRegistry));
            const result1 = await registryCache.getRegistry();
            expect(result1.projects['stale-app']).toBeDefined();

            // Now test that invalid JSON returns empty or stale cache
            registryCache.invalidateCache();
            fs.writeFileSync(testRegistryPath, 'corrupted!!!');

            const result2 = await registryCache.getRegistry();
            // Should return either stale cache or empty registry without crashing
            expect(result2).toHaveProperty('projects');
            expect(result2).toHaveProperty('original');
        });

        test('should handle empty registry file', async () => {
            fs.writeFileSync(testRegistryPath, '{}');

            const result = await registryCache.getRegistry();

            expect(result.projects).toEqual({});
        });

        test('should handle registry with empty arrays', async () => {
            const mockRegistry = {
                development: [],
                production: [],
            };

            fs.writeFileSync(testRegistryPath, JSON.stringify(mockRegistry));

            const result = await registryCache.getRegistry();

            expect(result.projects).toEqual({});
        });

        test('should handle file watcher errors gracefully', async () => {
            // Create registry
            const mockRegistry = {
                development: [{ name: 'watcher-error', path: '/opt/dev/error' }],
            };

            fs.writeFileSync(testRegistryPath, JSON.stringify(mockRegistry));

            // Load registry (watcher is already set up in beforeAll)
            await registryCache.getRegistry();

            // The watcher should be running without errors
            expect(logger.error).not.toHaveBeenCalledWith(
                expect.objectContaining({ err: expect.anything() }),
                expect.stringContaining('watcher')
            );
        });
    });

    describe('Manual Cache Control', () => {
        test('should allow manual cache invalidation', async () => {
            const mockRegistry = {
                development: [{ name: 'manual-app', path: '/opt/dev/manual' }],
            };

            fs.writeFileSync(testRegistryPath, JSON.stringify(mockRegistry));

            registryCache.resetStats();

            await registryCache.getRegistry();
            await registryCache.getRegistry(); // Hit

            const stats1 = registryCache.getCacheStats();
            expect(stats1.hits).toBe(1);

            registryCache.invalidateCache();

            const stats2 = registryCache.getCacheStats();
            expect(stats2.invalidations).toBe(1);

            await registryCache.getRegistry(); // Should reload

            const stats3 = registryCache.getCacheStats();
            expect(stats3.misses).toBe(2);
        });

        test('should allow statistics reset', async () => {
            const mockRegistry = {
                development: [{ name: 'reset-app', path: '/opt/dev/reset' }],
            };

            fs.writeFileSync(testRegistryPath, JSON.stringify(mockRegistry));

            await registryCache.getRegistry();
            await registryCache.getRegistry();

            let stats = registryCache.getCacheStats();
            expect(stats.hits).toBeGreaterThan(0);

            registryCache.resetStats();

            stats = registryCache.getCacheStats();
            expect(stats.hits).toBe(0);
            expect(stats.misses).toBe(0);
            expect(stats.invalidations).toBe(0);
        });
    });

    describe('Edge Cases', () => {
        test('should handle projects without name field', async () => {
            const mockRegistry = {
                development: [{ path: '/opt/dev/no-name', type: 'dev' }],
            };

            fs.writeFileSync(testRegistryPath, JSON.stringify(mockRegistry));

            const result = await registryCache.getRegistry();

            expect(result.projects['/opt/dev/no-name']).toBeDefined();
        });

        test('should handle projects without path field', async () => {
            const mockRegistry = {
                development: [{ name: 'no-path-app', type: 'dev' }],
            };

            fs.writeFileSync(testRegistryPath, JSON.stringify(mockRegistry));

            const result = await registryCache.getRegistry();

            expect(result.projects['no-path-app']).toBeDefined();
        });

        test('should handle large registry files', async () => {
            const projects = [];
            for (let i = 0; i < 1000; i++) {
                projects.push({
                    name: `project-${i}`,
                    path: `/opt/dev/project-${i}`,
                    type: 'dev',
                });
            }

            const mockRegistry = { development: projects };
            fs.writeFileSync(testRegistryPath, JSON.stringify(mockRegistry));

            const result = await registryCache.getRegistry();

            expect(Object.keys(result.projects).length).toBeGreaterThanOrEqual(1000);
        });

        test('should handle unicode characters in project names', async () => {
            const mockRegistry = {
                development: [
                    { name: '测试项目', path: '/opt/dev/chinese' },
                    { name: 'проект', path: '/opt/dev/russian' },
                    { name: 'プロジェクト', path: '/opt/dev/japanese' },
                ],
            };

            fs.writeFileSync(testRegistryPath, JSON.stringify(mockRegistry));

            const result = await registryCache.getRegistry();

            expect(result.projects['测试项目']).toBeDefined();
            expect(result.projects['проект']).toBeDefined();
            expect(result.projects['プロジェクト']).toBeDefined();
        });

        test('should preserve additional project properties', async () => {
            const mockRegistry = {
                development: [
                    {
                        name: 'rich-app',
                        path: '/opt/dev/rich',
                        type: 'dev',
                        port: 3000,
                        description: 'Test app',
                        tags: ['api', 'backend'],
                    },
                ],
            };

            fs.writeFileSync(testRegistryPath, JSON.stringify(mockRegistry));

            const result = await registryCache.getRegistry();
            const project = result.projects['rich-app'];

            expect(project.port).toBe(3000);
            expect(project.description).toBe('Test app');
            expect(project.tags).toEqual(['api', 'backend']);
        });
    });
});
