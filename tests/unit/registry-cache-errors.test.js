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

const fs = require('fs').promises;
const _path = require('path');

jest.mock('fs', () => ({
    promises: {
        readFile: jest.fn(),
        access: jest.fn(),
    },
    watch: jest.fn(),
}));

jest.mock('../../lib/logger');
jest.mock('../../lib/config');

const logger = require('../../lib/logger');
const config = require('../../lib/config');

// Clear module cache to allow fresh require
beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    logger.info = jest.fn();
    logger.error = jest.fn();
    logger.warn = jest.fn();

    config.registryPath = '/opt/registry/projects.json';
});

describe('Registry Cache Error Handling Tests', () => {
    describe('File Reading Errors', () => {
        it('should return empty registry on file not found', async () => {
            fs.readFile.mockRejectedValue({ code: 'ENOENT', message: 'File not found' });

            const { getRegistry } = require('../../lib/registry-cache');
            const registry = await getRegistry();

            expect(registry).toEqual({ projects: [] });
            expect(logger.warn).toHaveBeenCalledWith(
                expect.objectContaining({ code: 'ENOENT' }),
                expect.stringContaining('not found')
            );
        });

        it('should return empty registry on permission denied', async () => {
            fs.readFile.mockRejectedValue({ code: 'EACCES', message: 'Permission denied' });

            const { getRegistry } = require('../../lib/registry-cache');
            const registry = await getRegistry();

            expect(registry).toEqual({ projects: [] });
            expect(logger.error).toHaveBeenCalled();
        });

        it('should return empty registry on disk read error', async () => {
            fs.readFile.mockRejectedValue({ code: 'EIO', message: 'I/O error' });

            const { getRegistry } = require('../../lib/registry-cache');
            const registry = await getRegistry();

            expect(registry).toEqual({ projects: [] });
        });

        it('should handle timeout errors', async () => {
            fs.readFile.mockRejectedValue({ code: 'ETIMEDOUT', message: 'Operation timed out' });

            const { getRegistry } = require('../../lib/registry-cache');
            const registry = await getRegistry();

            expect(registry).toEqual({ projects: [] });
        });

        it('should handle unexpected errors', async () => {
            fs.readFile.mockRejectedValue(new Error('Unexpected error'));

            const { getRegistry } = require('../../lib/registry-cache');
            const registry = await getRegistry();

            expect(registry).toEqual({ projects: [] });
            expect(logger.error).toHaveBeenCalled();
        });
    });

    describe('JSON Parsing Errors', () => {
        it('should handle invalid JSON', async () => {
            fs.readFile.mockResolvedValue('{ invalid json }');

            const { getRegistry } = require('../../lib/registry-cache');
            const registry = await getRegistry();

            expect(registry).toEqual({ projects: [] });
            expect(logger.error).toHaveBeenCalledWith(
                expect.anything(),
                expect.stringContaining('parse')
            );
        });

        it('should handle empty file', async () => {
            fs.readFile.mockResolvedValue('');

            const { getRegistry } = require('../../lib/registry-cache');
            const registry = await getRegistry();

            expect(registry).toEqual({ projects: [] });
        });

        it('should handle whitespace-only file', async () => {
            fs.readFile.mockResolvedValue('   \n\n  \t  ');

            const { getRegistry } = require('../../lib/registry-cache');
            const registry = await getRegistry();

            expect(registry).toEqual({ projects: [] });
        });

        it('should handle JSON with missing projects array', async () => {
            fs.readFile.mockResolvedValue('{"name": "registry"}');

            const { getRegistry } = require('../../lib/registry-cache');
            const registry = await getRegistry();

            // Should add empty projects array
            expect(registry).toHaveProperty('projects');
            expect(Array.isArray(registry.projects)).toBe(true);
        });

        it('should handle JSON with null projects', async () => {
            fs.readFile.mockResolvedValue('{"projects": null}');

            const { getRegistry } = require('../../lib/registry-cache');
            const registry = await getRegistry();

            expect(registry).toHaveProperty('projects');
            expect(Array.isArray(registry.projects)).toBe(true);
        });

        it('should handle JSON with non-array projects', async () => {
            fs.readFile.mockResolvedValue('{"projects": "not-an-array"}');

            const { getRegistry } = require('../../lib/registry-cache');
            const registry = await getRegistry();

            expect(registry).toHaveProperty('projects');
            expect(Array.isArray(registry.projects)).toBe(true);
        });

        it('should handle truncated JSON', async () => {
            fs.readFile.mockResolvedValue('{"projects": [{"name": "test"');

            const { getRegistry } = require('../../lib/registry-cache');
            const registry = await getRegistry();

            expect(registry).toEqual({ projects: [] });
        });

        it('should handle JSON with BOM', async () => {
            fs.readFile.mockResolvedValue('\uFEFF{"projects": []}');

            const { getRegistry } = require('../../lib/registry-cache');
            const registry = await getRegistry();

            expect(registry).toHaveProperty('projects');
        });
    });

    describe('Cache Behavior', () => {
        it('should cache successful registry reads', async () => {
            const validRegistry = '{"projects": [{"name": "test"}]}';
            fs.readFile.mockResolvedValue(validRegistry);

            const { getRegistry } = require('../../lib/registry-cache');

            const registry1 = await getRegistry();
            const registry2 = await getRegistry();

            // Should only read file once (cached)
            expect(fs.readFile).toHaveBeenCalledTimes(1);
            expect(registry1).toEqual(registry2);
        });

        it('should not cache failed reads', async () => {
            fs.readFile
                .mockRejectedValueOnce(new Error('First error'))
                .mockResolvedValueOnce('{"projects": []}');

            const { getRegistry } = require('../../lib/registry-cache');

            const _registry1 = await getRegistry();
            const _registry2 = await getRegistry();

            // Should try to read file twice
            expect(fs.readFile).toHaveBeenCalledTimes(2);
        });

        it('should invalidate cache on demand', async () => {
            const validRegistry = '{"projects": [{"name": "test"}]}';
            fs.readFile.mockResolvedValue(validRegistry);

            const { getRegistry, invalidateCache } = require('../../lib/registry-cache');

            await getRegistry();
            invalidateCache();
            await getRegistry();

            // Should read file twice due to invalidation
            expect(fs.readFile).toHaveBeenCalledTimes(2);
        });

        it('should return cache stats', () => {
            const { getCacheStats } = require('../../lib/registry-cache');
            const stats = getCacheStats();

            expect(stats).toHaveProperty('cached');
            expect(typeof stats.cached).toBe('boolean');
        });

        it('should handle concurrent getRegistry calls', async () => {
            const validRegistry = '{"projects": [{"name": "test"}]}';
            fs.readFile.mockResolvedValue(validRegistry);

            const { getRegistry } = require('../../lib/registry-cache');

            // Make multiple concurrent calls
            const promises = [
                getRegistry(),
                getRegistry(),
                getRegistry(),
            ];

            const results = await Promise.all(promises);

            // Should only read once despite concurrent calls
            expect(fs.readFile).toHaveBeenCalledTimes(1);

            // All results should be identical
            expect(results[0]).toEqual(results[1]);
            expect(results[1]).toEqual(results[2]);
        });
    });

    describe('File Watcher', () => {
        it('should handle watcher setup errors gracefully', async () => {
            const fsActual = jest.requireActual('fs');
            fsActual.watch = jest.fn(() => {
                throw new Error('Watch failed');
            });

            fs.readFile.mockResolvedValue('{"projects": []}');

            const { getRegistry } = require('../../lib/registry-cache');
            const registry = await getRegistry();

            // Should still return registry despite watcher failure
            expect(registry).toHaveProperty('projects');
        });

        it('should close watcher successfully', () => {
            const mockWatcher = {
                close: jest.fn(),
            };

            const fsActual = jest.requireActual('fs');
            fsActual.watch = jest.fn(() => mockWatcher);

            const { closeWatcher } = require('../../lib/registry-cache');

            // This may or may not throw depending on implementation
            expect(() => closeWatcher()).not.toThrow();
        });

        it('should handle watcher close errors', () => {
            const { closeWatcher } = require('../../lib/registry-cache');

            // Should not throw even if no watcher exists
            expect(() => closeWatcher()).not.toThrow();
        });
    });

    describe('Registry Path Validation', () => {
        it('should use config registry path', async () => {
            config.registryPath = '/custom/path/registry.json';
            fs.readFile.mockResolvedValue('{"projects": []}');

            const { getRegistry } = require('../../lib/registry-cache');
            await getRegistry();

            expect(fs.readFile).toHaveBeenCalledWith('/custom/path/registry.json', 'utf-8');
        });

        it('should handle absolute paths', async () => {
            config.registryPath = '/absolute/path/registry.json';
            fs.readFile.mockResolvedValue('{"projects": []}');

            const { getRegistry } = require('../../lib/registry-cache');
            await getRegistry();

            expect(fs.readFile).toHaveBeenCalledWith('/absolute/path/registry.json', 'utf-8');
        });

        it('should handle path with special characters', async () => {
            config.registryPath = '/path/with spaces/registry.json';
            fs.readFile.mockResolvedValue('{"projects": []}');

            const { getRegistry } = require('../../lib/registry-cache');
            await getRegistry();

            expect(fs.readFile).toHaveBeenCalledWith('/path/with spaces/registry.json', 'utf-8');
        });
    });

    describe('Error Recovery', () => {
        it('should recover after temporary errors', async () => {
            fs.readFile
                .mockRejectedValueOnce({ code: 'EBUSY', message: 'Resource busy' })
                .mockResolvedValueOnce('{"projects": [{"name": "test"}]}');

            const { getRegistry } = require('../../lib/registry-cache');

            const registry1 = await getRegistry();
            const registry2 = await getRegistry();

            expect(registry1).toEqual({ projects: [] }); // Error state
            expect(registry2.projects).toHaveLength(1); // Recovered
        });

        it('should handle intermittent I/O errors', async () => {
            fs.readFile
                .mockRejectedValueOnce({ code: 'EIO', message: 'I/O error' })
                .mockRejectedValueOnce({ code: 'EIO', message: 'I/O error' })
                .mockResolvedValueOnce('{"projects": []}');

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

            fs.readFile.mockResolvedValue(JSON.stringify({ projects: largeProjects }));

            const { getRegistry } = require('../../lib/registry-cache');
            const registry = await getRegistry();

            expect(registry.projects).toHaveLength(1000);
        });

        it('should handle deeply nested project structures', async () => {
            const deepProject = {
                name: 'deep',
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

            fs.readFile.mockResolvedValue(JSON.stringify({ projects: [deepProject] }));

            const { getRegistry } = require('../../lib/registry-cache');
            const registry = await getRegistry();

            expect(registry.projects[0].metadata.level1.level2.level3.data).toBe('value');
        });
    });
});
