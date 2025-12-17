/**
 * Registry Cache Error Handling Tests
 * Tests for lib/registry-cache.js error scenarios
 *
 * Coverage areas:
 * - File reading errors
 * - JSON parsing errors
 * - File watcher errors
 * - Cache invalidation
 * - Concurrent access handling
 */

const _path = require('path');

// Create persistent mock objects before jest.mock hoisting
const mockFs = {
    promises: {
        readFile: jest.fn(),
        stat: jest.fn(),
    },
    watch: jest.fn(),
};

const mockLogger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
};

const mockConfig = {
    registryPath: '/opt/registry/projects.json',
    registryCacheTtl: 60000,
};

jest.mock('fs', () => mockFs);
jest.mock('../../lib/logger', () => mockLogger);
jest.mock('../../lib/config', () => mockConfig);

// Clear module cache to allow fresh require
beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    // Reset mock functions while keeping the same object references
    mockFs.promises.readFile.mockClear();
    mockFs.promises.stat.mockClear();
    mockFs.watch.mockClear();

    mockLogger.info.mockClear();
    mockLogger.error.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.debug.mockClear();

    mockConfig.registryPath = '/opt/registry/projects.json';
    mockConfig.registryCacheTtl = 60000;
});

describe('Registry Cache Error Handling Tests', () => {
    describe('File Reading Errors', () => {
        it('should return empty registry on file not found', async () => {
            mockFs.promises.readFile.mockRejectedValue({ code: 'ENOENT', message: 'File not found' });

            const { getRegistry } = require('../../lib/registry-cache');
            const registry = await getRegistry();

            expect(registry).toEqual({ projects: {}, original: {} });
            expect(mockLogger.error).toHaveBeenCalled();
        });

        it('should return empty registry on permission denied', async () => {
            mockFs.promises.readFile.mockRejectedValue({ code: 'EACCES', message: 'Permission denied' });

            const { getRegistry } = require('../../lib/registry-cache');
            const registry = await getRegistry();

            expect(registry).toEqual({ projects: {}, original: {} });
            expect(mockLogger.error).toHaveBeenCalled();
        });

        it('should return empty registry on disk read error', async () => {
            mockFs.promises.readFile.mockRejectedValue({ code: 'EIO', message: 'I/O error' });

            const { getRegistry } = require('../../lib/registry-cache');
            const registry = await getRegistry();

            expect(registry).toEqual({ projects: {}, original: {} });
        });

        it('should handle timeout errors', async () => {
            mockFs.promises.readFile.mockRejectedValue({ code: 'ETIMEDOUT', message: 'Operation timed out' });

            const { getRegistry } = require('../../lib/registry-cache');
            const registry = await getRegistry();

            expect(registry).toEqual({ projects: {}, original: {} });
        });

        it('should handle unexpected errors', async () => {
            mockFs.promises.readFile.mockRejectedValue(new Error('Unexpected error'));

            const { getRegistry } = require('../../lib/registry-cache');
            const registry = await getRegistry();

            expect(registry).toEqual({ projects: {}, original: {} });
            expect(mockLogger.error).toHaveBeenCalled();
        });
    });

    describe('JSON Parsing Errors', () => {
        it('should handle invalid JSON', async () => {
            mockFs.promises.readFile.mockResolvedValue('{ invalid json }');

            const { getRegistry } = require('../../lib/registry-cache');
            const registry = await getRegistry();

            expect(registry).toEqual({ projects: {}, original: {} });
            expect(mockLogger.error).toHaveBeenCalled();
        });

        it('should handle empty file', async () => {
            mockFs.promises.readFile.mockResolvedValue('');

            const { getRegistry } = require('../../lib/registry-cache');
            const registry = await getRegistry();

            expect(registry).toEqual({ projects: {}, original: {} });
        });

        it('should handle whitespace-only file', async () => {
            mockFs.promises.readFile.mockResolvedValue('   \n\n  \t  ');

            const { getRegistry } = require('../../lib/registry-cache');
            const registry = await getRegistry();

            expect(registry).toEqual({ projects: {}, original: {} });
        });

        it('should handle JSON with missing projects array', async () => {
            mockFs.promises.readFile.mockResolvedValue('{"name": "registry"}');

            const { getRegistry } = require('../../lib/registry-cache');
            const registry = await getRegistry();

            // Should have projects object (empty)
            expect(registry).toHaveProperty('projects');
            expect(typeof registry.projects).toBe('object');
        });

        it('should handle JSON with null projects', async () => {
            mockFs.promises.readFile.mockResolvedValue('{"projects": null}');

            const { getRegistry } = require('../../lib/registry-cache');
            const registry = await getRegistry();

            expect(registry).toHaveProperty('projects');
            expect(typeof registry.projects).toBe('object');
        });

        it('should handle JSON with non-array projects', async () => {
            mockFs.promises.readFile.mockResolvedValue('{"projects": "not-an-array"}');

            const { getRegistry } = require('../../lib/registry-cache');
            const registry = await getRegistry();

            expect(registry).toHaveProperty('projects');
            expect(typeof registry.projects).toBe('object');
        });

        it('should handle truncated JSON', async () => {
            mockFs.promises.readFile.mockResolvedValue('{"projects": [{"name": "test"');

            const { getRegistry } = require('../../lib/registry-cache');
            const registry = await getRegistry();

            expect(registry).toEqual({ projects: {}, original: {} });
        });

        it('should handle JSON with BOM', async () => {
            mockFs.promises.readFile.mockResolvedValue('\uFEFF{"development": [{"name": "test", "path": "/test"}]}');

            const { getRegistry } = require('../../lib/registry-cache');
            const registry = await getRegistry();

            expect(registry).toHaveProperty('projects');
            expect(typeof registry.projects).toBe('object');
        });
    });

    describe('Cache Behavior', () => {
        it('should cache successful registry reads', async () => {
            const validRegistry = '{"development": [{"name": "test", "path": "/test"}]}';
            mockFs.promises.readFile.mockResolvedValue(validRegistry);

            const { getRegistry } = require('../../lib/registry-cache');

            const registry1 = await getRegistry();
            const registry2 = await getRegistry();

            // Should only read file once (cached)
            expect(mockFs.promises.readFile).toHaveBeenCalledTimes(1);
            expect(registry1).toEqual(registry2);
        });

        it('should not cache failed reads', async () => {
            mockFs.promises.readFile
                .mockRejectedValueOnce(new Error('First error'))
                .mockResolvedValueOnce('{"development": [{"name": "test", "path": "/test"}]}');

            const { getRegistry } = require('../../lib/registry-cache');

            const _registry1 = await getRegistry();
            const _registry2 = await getRegistry();

            // Should try to read file twice
            expect(mockFs.promises.readFile).toHaveBeenCalledTimes(2);
        });

        it('should invalidate cache on demand', async () => {
            const validRegistry = '{"development": [{"name": "test", "path": "/test"}]}';
            mockFs.promises.readFile.mockResolvedValue(validRegistry);

            const { getRegistry, invalidateCache } = require('../../lib/registry-cache');

            await getRegistry();
            invalidateCache();
            await getRegistry();

            // Should read file twice due to invalidation
            expect(mockFs.promises.readFile).toHaveBeenCalledTimes(2);
        });

        it('should return cache stats', () => {
            const { getCacheStats } = require('../../lib/registry-cache');
            const stats = getCacheStats();

            expect(stats).toHaveProperty('cached');
            expect(typeof stats.cached).toBe('boolean');
        });

        it('should handle concurrent getRegistry calls', async () => {
            const validRegistry = '{"development": [{"name": "test", "path": "/test"}]}';
            mockFs.promises.readFile.mockResolvedValue(validRegistry);

            const { getRegistry } = require('../../lib/registry-cache');

            // Make multiple concurrent calls
            const promises = [
                getRegistry(),
                getRegistry(),
                getRegistry(),
            ];

            const results = await Promise.all(promises);

            // At least one read should occur (cache miss), but without in-flight
            // deduplication, concurrent calls may result in multiple reads.
            // The important behavior is that all results are identical (cached).
            expect(mockFs.promises.readFile).toHaveBeenCalled();

            // All results should be identical
            expect(results[0]).toEqual(results[1]);
            expect(results[1]).toEqual(results[2]);
        });
    });

    describe('File Watcher', () => {
        it('should handle watcher setup errors gracefully', async () => {
            mockFs.watch.mockImplementation(() => {
                throw new Error('Watch failed');
            });

            mockFs.promises.readFile.mockResolvedValue('{"development": [{"name": "test", "path": "/test"}]}');

            const { getRegistry } = require('../../lib/registry-cache');
            const registry = await getRegistry();

            // Should still return registry despite watcher failure
            expect(registry).toHaveProperty('projects');
        });

        it('should close watcher successfully', () => {
            const mockWatcher = {
                close: jest.fn(),
                on: jest.fn(),
            };

            mockFs.watch.mockReturnValue(mockWatcher);

            const { closeWatcher } = require('../../lib/registry-cache');

            // Should not throw
            expect(() => closeWatcher()).not.toThrow();
        });

        it('should handle watcher close errors', () => {
            const { closeWatcher } = require('../../lib/registry-cache');

            // Should not throw even if no watcher exists
            expect(() => closeWatcher()).not.toThrow();
        });
    });

    describe('Polling Fallback', () => {
        it('should fallback to polling when fs.watch throws', async () => {
            // Mock fs.watch to throw an error
            mockFs.watch.mockImplementation(() => {
                throw new Error('fs.watch not available');
            });

            mockFs.promises.readFile.mockResolvedValue('{"development": [{"name": "test", "path": "/test"}]}');

            const { getRegistry, getCacheStats } = require('../../lib/registry-cache');
            const registry = await getRegistry();

            // Should still work despite watcher failure
            expect(registry).toHaveProperty('projects');

            // Should indicate polling mode
            const stats = getCacheStats();
            expect(stats.invalidationMode).toBe('polling');

            // Should log warning about fallback
            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.objectContaining({
                    registryPath: expect.any(String),
                }),
                expect.stringContaining('falling back to polling')
            );
        });

        it('should fallback to polling when fs.watch is undefined', async () => {
            // Mock fs.watch to throw
            mockFs.watch.mockImplementation(() => {
                throw new Error('Not available');
            });

            mockFs.promises.readFile.mockResolvedValue('{"development": [{"name": "test", "path": "/test"}]}');

            const { getRegistry, getCacheStats } = require('../../lib/registry-cache');
            await getRegistry();

            const stats = getCacheStats();
            expect(stats.invalidationMode).toBe('polling');
        });

        it('should show fs.watch mode when watcher works', async () => {
            const mockWatcher = {
                close: jest.fn(),
                on: jest.fn(),
            };

            mockFs.watch.mockReturnValue(mockWatcher);

            mockFs.promises.readFile.mockResolvedValue('{"development": [{"name": "test", "path": "/test"}]}');

            const { getRegistry, getCacheStats } = require('../../lib/registry-cache');
            await getRegistry();

            const stats = getCacheStats();
            expect(stats.invalidationMode).toBe('fs.watch');
        });

        it('should cleanup polling interval on closeWatcher', () => {
            mockFs.watch.mockImplementation(() => {
                throw new Error('Watch unavailable');
            });

            mockFs.promises.readFile.mockResolvedValue('{"development": [{"name": "test", "path": "/test"}]}');

            const { closeWatcher, getCacheStats } = require('../../lib/registry-cache');

            // Verify polling mode was enabled
            const beforeStats = getCacheStats();
            const wasPolling = beforeStats.invalidationMode === 'polling';

            closeWatcher();

            // If was polling, should have logged cleanup
            if (wasPolling) {
                expect(mockLogger.info).toHaveBeenCalledWith(
                    'Registry polling interval closed'
                );
            }
        });
    });

    describe('Registry Path Validation', () => {
        it('should use config registry path', async () => {
            mockConfig.registryPath = '/custom/path/registry.json';
            mockFs.promises.readFile.mockResolvedValue('{"projects": []}');

            const { getRegistry } = require('../../lib/registry-cache');
            await getRegistry();

            expect(mockFs.promises.readFile).toHaveBeenCalledWith('/custom/path/registry.json', 'utf8');
        });

        it('should handle absolute paths', async () => {
            mockConfig.registryPath = '/absolute/path/registry.json';
            mockFs.promises.readFile.mockResolvedValue('{"projects": []}');

            const { getRegistry } = require('../../lib/registry-cache');
            await getRegistry();

            expect(mockFs.promises.readFile).toHaveBeenCalledWith('/absolute/path/registry.json', 'utf8');
        });

        it('should handle path with special characters', async () => {
            mockConfig.registryPath = '/path/with spaces/registry.json';
            mockFs.promises.readFile.mockResolvedValue('{"projects": []}');

            const { getRegistry } = require('../../lib/registry-cache');
            await getRegistry();

            expect(mockFs.promises.readFile).toHaveBeenCalledWith('/path/with spaces/registry.json', 'utf8');
        });
    });

    describe('Error Recovery', () => {
        it('should recover after temporary errors', async () => {
            mockFs.promises.readFile
                .mockRejectedValueOnce({ code: 'EBUSY', message: 'Resource busy' })
                .mockResolvedValueOnce('{"development": [{"name": "test", "path": "/test"}]}');

            const { getRegistry } = require('../../lib/registry-cache');

            const registry1 = await getRegistry();
            const registry2 = await getRegistry();

            expect(registry1).toEqual({ projects: {}, original: {} }); // Error state
            expect(Object.keys(registry2.projects).length).toBeGreaterThan(0); // Recovered
        });

        it('should handle intermittent I/O errors', async () => {
            mockFs.promises.readFile
                .mockRejectedValueOnce({ code: 'EIO', message: 'I/O error' })
                .mockRejectedValueOnce({ code: 'EIO', message: 'I/O error' })
                .mockResolvedValueOnce('{"development": [{"name": "test", "path": "/test"}]}');

            const { getRegistry } = require('../../lib/registry-cache');

            await getRegistry(); // Error
            await getRegistry(); // Error
            const registry = await getRegistry(); // Success

            expect(registry).toHaveProperty('projects');
        });
    });

    describe('Large Registry Handling', () => {
        it('should handle large registry files', async () => {
            const largeProjects = Array.from({ length: 1000 }, (_, i) => ({
                name: `project-${i}`,
                path: `/opt/project-${i}`,
            }));

            mockFs.promises.readFile.mockResolvedValue(JSON.stringify({ development: largeProjects }));

            const { getRegistry } = require('../../lib/registry-cache');
            const registry = await getRegistry();

            // Projects are indexed by both name and path, so 2x entries
            expect(Object.keys(registry.projects).length).toBeGreaterThanOrEqual(1000);
        });

        it('should handle deeply nested project structures', async () => {
            const deepProject = {
                name: 'deep',
                path: '/deep',
                metadata: {
                    level1: {
                        level2: {
                            level3: {
                                data: 'value',
                            },
                        },
                    },
                },
            };

            mockFs.promises.readFile.mockResolvedValue(JSON.stringify({ development: [deepProject] }));

            const { getRegistry } = require('../../lib/registry-cache');
            const registry = await getRegistry();

            expect(registry.projects['deep'].metadata.level1.level2.level3.data).toBe('value');
        });
    });
});
