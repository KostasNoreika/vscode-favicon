/**
 * Unit Tests for FIX QUA-011: Fast-glob Scan Limits
 * Tests timeout protection and result/directory limits
 */

const FaviconService = require('../../lib/services/favicon-service');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

describe('FIX QUA-011: Favicon Scan Limits', () => {
    let faviconService;
    let mockRegistryCache;
    let mockFaviconCache;
    let tempDir;

    beforeEach(() => {
        mockRegistryCache = {
            getRegistry: jest.fn().mockResolvedValue({
                projects: {},
                original: {},
            }),
        };

        mockFaviconCache = {
            get: jest.fn().mockReturnValue(null),
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
            typeColors: { dev: '#4ECDC4', prod: '#FF6B6B' },
            defaultColors: ['#FF6B6B', '#4ECDC4'],
        });
    });

    afterEach(async () => {
        // Clean up temp directory
        if (tempDir) {
            try {
                await fs.rm(tempDir, { recursive: true, force: true });
            } catch (err) {
                // Ignore cleanup errors
            }
        }
    });

    describe('Result Limit (1000 files)', () => {
        test('should abort scan when result limit is reached', async () => {
            // Create temp directory with many favicon files (more than limit)
            tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'favicon-test-'));

            // Create 1005 favicon files in different directories
            // This exceeds the MAX_RESULTS limit of 1000
            for (let i = 0; i < 1005; i++) {
                const dirPath = path.join(tempDir, `dir${i}`);
                await fs.mkdir(dirPath, { recursive: true });
                await fs.writeFile(path.join(dirPath, 'favicon.ico'), 'fake-icon');
            }

            // Run full scan - should abort at 1000 results
            const result = await faviconService.fullProjectScan(tempDir);

            // Should still return a result (best match found so far)
            expect(result).toBeTruthy();
            expect(result).toContain('favicon.ico');
        }, 15000); // Increase timeout for this test

        test('should complete normally when results are under limit', async () => {
            tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'favicon-test-'));

            // Create only 5 favicon files (well under limit)
            for (let i = 0; i < 5; i++) {
                const dirPath = path.join(tempDir, `dir${i}`);
                await fs.mkdir(dirPath, { recursive: true });
                await fs.writeFile(path.join(dirPath, 'favicon.ico'), 'fake-icon');
            }

            const result = await faviconService.fullProjectScan(tempDir);

            expect(result).toBeTruthy();
            expect(result).toContain('favicon.ico');
        });
    });

    describe('Directory Limit (50 directories)', () => {
        test('should abort scan when directory limit is reached', async () => {
            tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'favicon-test-'));

            // Create 55 unique directories with favicon files
            // This exceeds the MAX_DIRECTORIES limit of 50
            for (let i = 0; i < 55; i++) {
                const dirPath = path.join(tempDir, `dir${i}`, 'subdir');
                await fs.mkdir(dirPath, { recursive: true });
                await fs.writeFile(path.join(dirPath, 'favicon.ico'), 'fake-icon');
            }

            // Run full scan - should abort at 50 directories
            const result = await faviconService.fullProjectScan(tempDir);

            // Should still return a result (best match found before limit)
            expect(result).toBeTruthy();
            expect(result).toContain('favicon.ico');
        }, 15000);

        test('should complete normally when directories are under limit', async () => {
            tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'favicon-test-'));

            // Create only 10 directories (well under limit)
            for (let i = 0; i < 10; i++) {
                const dirPath = path.join(tempDir, `dir${i}`);
                await fs.mkdir(dirPath, { recursive: true });
                await fs.writeFile(path.join(dirPath, 'favicon.ico'), 'fake-icon');
            }

            const result = await faviconService.fullProjectScan(tempDir);

            expect(result).toBeTruthy();
            expect(result).toContain('favicon.ico');
        });
    });

    describe('Timeout Protection (5 seconds)', () => {
        test('should handle timeout gracefully', async () => {
            tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'favicon-test-'));

            // Create a moderately deep structure
            // The timeout will trigger before completion if the scan takes too long
            for (let i = 0; i < 100; i++) {
                const dirPath = path.join(tempDir, `level1_${i}`, `level2`, `level3`);
                await fs.mkdir(dirPath, { recursive: true });
                await fs.writeFile(path.join(dirPath, 'favicon.ico'), 'fake-icon');
            }

            const startTime = Date.now();
            const result = await faviconService.fullProjectScan(tempDir);
            const duration = Date.now() - startTime;

            // Should complete within reasonable time (timeout + buffer)
            expect(duration).toBeLessThan(7000); // 5s timeout + 2s buffer

            // May return result or null depending on timing
            if (result) {
                expect(result).toContain('favicon.ico');
            } else {
                // Null is acceptable if timeout was hit
                expect(result).toBeNull();
            }
        }, 10000);

        test('should complete quickly when favicon found early', async () => {
            tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'favicon-test-'));

            // Put favicon in root - should find quickly
            await fs.writeFile(path.join(tempDir, 'favicon.ico'), 'fake-icon');

            const startTime = Date.now();
            const result = await faviconService.fullProjectScan(tempDir);
            const duration = Date.now() - startTime;

            expect(result).toBeTruthy();
            expect(duration).toBeLessThan(1000); // Should be very fast
        });
    });

    describe('Single-pass Min-finding (PERF-002)', () => {
        test('should find shallowest favicon without full sort', async () => {
            tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'favicon-test-'));

            // Create favicons at different depths
            await fs.writeFile(path.join(tempDir, 'favicon.ico'), 'root');
            await fs.mkdir(path.join(tempDir, 'deep', 'nested'), { recursive: true });
            await fs.writeFile(
                path.join(tempDir, 'deep', 'nested', 'favicon.ico'),
                'deep'
            );

            const result = await faviconService.fullProjectScan(tempDir);

            // Should prefer root-level favicon (shallower)
            expect(result).toBe(path.join(tempDir, 'favicon.ico'));
        });

        test('should respect pattern priority when depth is equal', async () => {
            tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'favicon-test-'));

            // Create multiple favicons at same depth with different priorities
            await fs.writeFile(path.join(tempDir, 'logo.png'), 'logo'); // Lower priority
            await fs.writeFile(path.join(tempDir, 'favicon.ico'), 'favicon'); // Highest priority

            const result = await faviconService.fullProjectScan(tempDir);

            // Should prefer favicon.ico over logo.png (higher priority)
            expect(result).toBe(path.join(tempDir, 'favicon.ico'));
        });

        test('should handle empty directory gracefully', async () => {
            tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'favicon-test-'));

            const result = await faviconService.fullProjectScan(tempDir);

            expect(result).toBeNull();
        });

        test('should ignore common build directories', async () => {
            tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'favicon-test-'));

            // Create favicons in ignored directories
            const ignoredDirs = ['node_modules', '.git', 'dist', 'build'];
            for (const dir of ignoredDirs) {
                await fs.mkdir(path.join(tempDir, dir), { recursive: true });
                await fs.writeFile(path.join(tempDir, dir, 'favicon.ico'), 'ignored');
            }

            // Create favicon in valid location
            await fs.mkdir(path.join(tempDir, 'public'), { recursive: true });
            await fs.writeFile(path.join(tempDir, 'public', 'favicon.ico'), 'valid');

            const result = await faviconService.fullProjectScan(tempDir);

            // Should find the valid one, not the ignored ones
            expect(result).toBe(path.join(tempDir, 'public', 'favicon.ico'));
        });
    });

    describe('Quick Search Fast Path', () => {
        test('should find favicon via quickSearch before fullScan', async () => {
            tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'favicon-test-'));

            // Create favicon in common location
            await fs.mkdir(path.join(tempDir, 'public'), { recursive: true });
            await fs.writeFile(path.join(tempDir, 'public', 'favicon.ico'), 'quick');

            const result = await faviconService.findFaviconFile(tempDir);

            expect(result).toBe(path.join(tempDir, 'public', 'favicon.ico'));
        });

        test('should fall back to fullScan when quickSearch fails', async () => {
            tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'favicon-test-'));

            // Create favicon in non-common location
            await fs.mkdir(path.join(tempDir, 'custom', 'icons'), { recursive: true });
            await fs.writeFile(
                path.join(tempDir, 'custom', 'icons', 'favicon.ico'),
                'custom'
            );

            const result = await faviconService.findFaviconFile(tempDir);

            expect(result).toBe(path.join(tempDir, 'custom', 'icons', 'favicon.ico'));
        });

        test('should prefer quickSearch results over fullScan', async () => {
            tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'favicon-test-'));

            // Create favicons in both common and uncommon locations
            await fs.mkdir(path.join(tempDir, 'public'), { recursive: true });
            await fs.writeFile(path.join(tempDir, 'public', 'favicon.ico'), 'common');

            await fs.mkdir(path.join(tempDir, 'other'), { recursive: true });
            await fs.writeFile(path.join(tempDir, 'other', 'favicon.ico'), 'uncommon');

            const result = await faviconService.findFaviconFile(tempDir);

            // Should return the quick search result
            expect(result).toBe(path.join(tempDir, 'public', 'favicon.ico'));
        });
    });

    describe('Error Handling and AbortError', () => {
        test('should handle AbortError without throwing', async () => {
            tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'favicon-test-'));

            // Create enough files to potentially trigger abort
            for (let i = 0; i < 60; i++) {
                const dirPath = path.join(tempDir, `dir${i}`);
                await fs.mkdir(dirPath, { recursive: true });
                await fs.writeFile(path.join(dirPath, 'favicon.ico'), 'test');
            }

            // Should not throw even if aborted
            await expect(faviconService.fullProjectScan(tempDir)).resolves.toBeDefined();
        }, 15000);

        test('should handle non-existent directory gracefully', async () => {
            const nonExistent = '/tmp/this-directory-does-not-exist-xyz123';

            const result = await faviconService.fullProjectScan(nonExistent);

            expect(result).toBeNull();
        });

        test('should handle permission errors gracefully', async () => {
            // This test is platform-specific and may not work in all environments
            if (process.platform !== 'win32') {
                tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'favicon-test-'));

                // Create a directory with no read permissions
                const restrictedDir = path.join(tempDir, 'restricted');
                await fs.mkdir(restrictedDir);
                await fs.chmod(restrictedDir, 0o000);

                // Should handle permission error gracefully
                const result = await faviconService.fullProjectScan(tempDir);

                // Restore permissions for cleanup
                await fs.chmod(restrictedDir, 0o755);

                // Should return null or handle error gracefully
                expect(result === null || typeof result === 'string').toBe(true);
            }
        });
    });

    describe('Integration with getFavicon', () => {
        test('should cache favicon results to avoid repeated file reads', async () => {
            tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'favicon-test-'));

            await fs.mkdir(path.join(tempDir, 'public'), { recursive: true });
            await fs.writeFile(path.join(tempDir, 'public', 'favicon.ico'), 'cached');

            // First call - cache miss, should set cache
            await faviconService.getFavicon(tempDir);
            expect(mockFaviconCache.set).toHaveBeenCalledTimes(1);

            // FIX REF-026: Use new centralized cache key format
            const FaviconService = require('../../lib/services/favicon-service');
            const expectedKey = FaviconService.makeCacheKey('favicon', tempDir, '');

            expect(mockFaviconCache.set).toHaveBeenCalledWith(
                expectedKey,
                expect.objectContaining({
                    contentType: 'image/x-icon',
                    data: expect.any(Buffer),
                })
            );

            // Second call - should use cache
            mockFaviconCache.get.mockReturnValueOnce({
                contentType: 'image/x-icon',
                data: Buffer.from('cached'),
            });

            const result = await faviconService.getFavicon(tempDir);

            // Verify cache was used (no additional set calls)
            expect(mockFaviconCache.set).toHaveBeenCalledTimes(1);
            expect(result.contentType).toBe('image/x-icon');
            expect(result.data.toString()).toBe('cached');
        });

        test('should fall back to SVG generation when no favicon found', async () => {
            tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'favicon-test-'));

            // Empty directory - no favicon files
            const result = await faviconService.getFavicon(tempDir);

            expect(result.contentType).toBe('image/svg+xml');
            expect(result.data.toString()).toContain('<svg');
        });
    });
});
