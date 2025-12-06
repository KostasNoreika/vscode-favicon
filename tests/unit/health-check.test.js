/**
 * Unit Tests for Health Check Module
 * Tests health monitoring, liveness/readiness probes, and system metrics
 */

const fs = require('fs');
const path = require('path');
const {
    checkRegistry,
    checkDataDir,
    getMemoryUsage,
    getUptime,
    getFullHealth,
    getLivenessProbe,
    getReadinessProbe,
} = require('../../lib/health-check');
const config = require('../../lib/config');

// Mock logger to prevent console output during tests
jest.mock('../../lib/logger', () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
}));

describe('Health Check Module', () => {
    describe('getMemoryUsage()', () => {
        test('should return valid memory stats with MB suffix', () => {
            const stats = getMemoryUsage();

            expect(stats).toHaveProperty('heapUsed');
            expect(stats).toHaveProperty('heapTotal');
            expect(stats).toHaveProperty('rss');
            expect(stats).toHaveProperty('external');
            expect(stats).toHaveProperty('arrayBuffers');

            // All values should be strings ending with 'MB'
            expect(stats.heapUsed).toMatch(/^\d+MB$/);
            expect(stats.heapTotal).toMatch(/^\d+MB$/);
            expect(stats.rss).toMatch(/^\d+MB$/);
            expect(stats.external).toMatch(/^\d+MB$/);
            expect(stats.arrayBuffers).toMatch(/^\d+MB$/);
        });

        test('should return non-zero memory values', () => {
            const stats = getMemoryUsage();

            // Extract numeric values
            const heapUsed = parseInt(stats.heapUsed);
            const heapTotal = parseInt(stats.heapTotal);
            const rss = parseInt(stats.rss);

            expect(heapUsed).toBeGreaterThan(0);
            expect(heapTotal).toBeGreaterThan(0);
            expect(rss).toBeGreaterThan(0);
        });

        test('should have heapUsed <= heapTotal', () => {
            const stats = getMemoryUsage();

            const heapUsed = parseInt(stats.heapUsed);
            const heapTotal = parseInt(stats.heapTotal);

            expect(heapUsed).toBeLessThanOrEqual(heapTotal);
        });
    });

    describe('getUptime()', () => {
        test('should return uptime string in correct format', () => {
            const uptime = getUptime();

            // Should match one of: "Xs", "Xm Ys", "Xh Ym Zs"
            expect(uptime).toMatch(/^(\d+h \d+m \d+s|\d+m \d+s|\d+s)$/);
        });

        test('should return non-empty string', () => {
            const uptime = getUptime();
            expect(uptime).toBeTruthy();
            expect(typeof uptime).toBe('string');
        });

        test('should format seconds-only uptime correctly', () => {
            // Mock process.uptime to return a small value
            const originalUptime = process.uptime;
            process.uptime = jest.fn(() => 5);

            const uptime = getUptime();
            expect(uptime).toBe('5s');

            process.uptime = originalUptime;
        });

        test('should format minutes uptime correctly', () => {
            const originalUptime = process.uptime;
            process.uptime = jest.fn(() => 125); // 2m 5s

            const uptime = getUptime();
            expect(uptime).toBe('2m 5s');

            process.uptime = originalUptime;
        });

        test('should format hours uptime correctly', () => {
            const originalUptime = process.uptime;
            process.uptime = jest.fn(() => 3665); // 1h 1m 5s

            const uptime = getUptime();
            expect(uptime).toBe('1h 1m 5s');

            process.uptime = originalUptime;
        });
    });

    describe('checkRegistry()', () => {
        test('should return healthy status when registry file exists', async () => {
            // Use actual registry path from config
            const result = await checkRegistry();

            if (fs.existsSync(config.registryPath)) {
                expect(result.status).toBe('ok');
                expect(result.path).toBe(config.registryPath);
                expect(result.readable).toBe(true);
                expect(result).toHaveProperty('size');
                expect(result).toHaveProperty('modified');
                expect(typeof result.size).toBe('number');
                expect(result.modified).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO timestamp
            } else {
                // If registry doesn't exist in test env, it should return error
                expect(result.status).toBe('error');
                expect(result.readable).toBe(false);
            }
        });

        test('should return error status when registry file is missing', async () => {
            // Mock config to point to non-existent file
            const originalPath = config.registryPath;
            config.registryPath = '/nonexistent/path/registry.json';

            const result = await checkRegistry();

            expect(result.status).toBe('error');
            expect(result.path).toBe('/nonexistent/path/registry.json');
            expect(result.readable).toBe(false);
            expect(result).toHaveProperty('error');
            expect(typeof result.error).toBe('string');

            // Restore
            config.registryPath = originalPath;
        });

        test('should return error when registry path is not readable', async () => {
            // Create a temporary file with no read permissions
            const tmpDir = require('os').tmpdir();
            const tmpFile = path.join(tmpDir, 'test-registry-no-read.json');

            // Create file
            fs.writeFileSync(tmpFile, '{}');

            // Remove read permissions (chmod 000)
            try {
                fs.chmodSync(tmpFile, 0o000);

                const originalPath = config.registryPath;
                config.registryPath = tmpFile;

                const result = await checkRegistry();

                expect(result.status).toBe('error');
                expect(result.readable).toBe(false);

                config.registryPath = originalPath;
            } finally {
                // Cleanup: restore permissions and delete
                try {
                    fs.chmodSync(tmpFile, 0o644);
                    fs.unlinkSync(tmpFile);
                } catch (err) {
                    // Ignore cleanup errors
                }
            }
        });
    });

    describe('checkDataDir()', () => {
        test('should return healthy status when data dir exists and is writable', async () => {
            const result = await checkDataDir();

            if (fs.existsSync(config.dataDir)) {
                expect(result.status).toBe('ok');
                expect(result.path).toBe(config.dataDir);
                expect(result.writable).toBe(true);
                expect(result.isDirectory).toBe(true);
            } else {
                // If data dir doesn't exist, should return error
                expect(result.status).toBe('error');
                expect(result.writable).toBe(false);
            }
        });

        test('should return error when data dir does not exist', async () => {
            const originalPath = config.dataDir;
            config.dataDir = '/nonexistent/data/dir';

            const result = await checkDataDir();

            expect(result.status).toBe('error');
            expect(result.path).toBe('/nonexistent/data/dir');
            expect(result.writable).toBe(false);
            expect(result).toHaveProperty('error');

            config.dataDir = originalPath;
        });

        test('should return error when data dir is not writable', async () => {
            // Create temp directory with no write permissions
            const tmpDir = require('os').tmpdir();
            const tmpSubDir = path.join(tmpDir, 'test-data-no-write');

            try {
                fs.mkdirSync(tmpSubDir, { recursive: true });
                fs.chmodSync(tmpSubDir, 0o444); // Read-only

                const originalPath = config.dataDir;
                config.dataDir = tmpSubDir;

                const result = await checkDataDir();

                expect(result.status).toBe('error');
                expect(result.writable).toBe(false);

                config.dataDir = originalPath;
            } finally {
                // Cleanup
                try {
                    fs.chmodSync(tmpSubDir, 0o755);
                    fs.rmdirSync(tmpSubDir);
                } catch (err) {
                    // Ignore cleanup errors
                }
            }
        });
    });

    describe('getLivenessProbe()', () => {
        test('should return alive status', () => {
            const result = getLivenessProbe();

            expect(result.status).toBe('alive');
            expect(result).toHaveProperty('timestamp');
            expect(result).toHaveProperty('pid');
            expect(result).toHaveProperty('uptime');

            expect(result.pid).toBe(process.pid);
            expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO timestamp
            expect(typeof result.uptime).toBe('string');
        });

        test('should always return alive (never fails)', () => {
            // Call multiple times
            for (let i = 0; i < 5; i++) {
                const result = getLivenessProbe();
                expect(result.status).toBe('alive');
            }
        });

        test('should return current process ID', () => {
            const result = getLivenessProbe();
            expect(result.pid).toBeGreaterThan(0);
            expect(Number.isInteger(result.pid)).toBe(true);
        });
    });

    describe('getReadinessProbe()', () => {
        test('should check registry accessibility', async () => {
            const result = await getReadinessProbe();

            expect(result).toHaveProperty('status');
            expect(result).toHaveProperty('timestamp');
            expect(result).toHaveProperty('message');

            // Status should be 'ready' or 'not_ready'
            expect(['ready', 'not_ready']).toContain(result.status);

            if (result.status === 'ready') {
                expect(result.message).toBe('Service is ready to accept traffic');
            } else {
                expect(result.message).toBe('Registry file is not accessible');
                expect(result).toHaveProperty('error');
            }
        });

        test('should return ready when registry is accessible', async () => {
            // Only run if registry exists
            if (fs.existsSync(config.registryPath)) {
                const result = await getReadinessProbe();

                expect(result.status).toBe('ready');
                expect(result.message).toBe('Service is ready to accept traffic');
            }
        });

        test('should return not_ready when registry is missing', async () => {
            const originalPath = config.registryPath;
            config.registryPath = '/nonexistent/registry.json';

            const result = await getReadinessProbe();

            expect(result.status).toBe('not_ready');
            expect(result.message).toBe('Registry file is not accessible');
            expect(result).toHaveProperty('error');

            config.registryPath = originalPath;
        });

        test('should include timestamp in ISO format', async () => {
            const result = await getReadinessProbe();

            expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        });
    });

    describe('getFullHealth()', () => {
        test('should return comprehensive health status', async () => {
            const result = await getFullHealth('test-service');

            expect(result).toHaveProperty('status');
            expect(result).toHaveProperty('service');
            expect(result).toHaveProperty('version');
            expect(result).toHaveProperty('environment');
            expect(result).toHaveProperty('timestamp');
            expect(result).toHaveProperty('uptime');
            expect(result).toHaveProperty('uptimeSeconds');
            expect(result).toHaveProperty('memory');
            expect(result).toHaveProperty('checks');

            expect(result.service).toBe('test-service');
            expect(['ok', 'degraded']).toContain(result.status);
        });

        test('should include registry and dataDir checks', async () => {
            const result = await getFullHealth('test-service');

            expect(result.checks).toHaveProperty('registry');
            expect(result.checks).toHaveProperty('dataDir');

            expect(result.checks.registry).toHaveProperty('status');
            expect(result.checks.dataDir).toHaveProperty('status');
        });

        test('should include memory usage metrics', async () => {
            const result = await getFullHealth('test-service');

            expect(result.memory).toHaveProperty('heapUsed');
            expect(result.memory).toHaveProperty('heapTotal');
            expect(result.memory).toHaveProperty('rss');
        });

        test('should include uptime in seconds', async () => {
            const result = await getFullHealth('test-service');

            expect(typeof result.uptimeSeconds).toBe('number');
            expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
        });

        test('should include version from package.json or default', async () => {
            const result = await getFullHealth('test-service');

            expect(typeof result.version).toBe('string');
            expect(result.version.length).toBeGreaterThan(0);
        });

        test('should include environment from config', async () => {
            const result = await getFullHealth('test-service');

            expect(result.environment).toBe(config.nodeEnv);
        });

        test('should mark as degraded when registry check fails', async () => {
            const originalPath = config.registryPath;
            config.registryPath = '/nonexistent/registry.json';

            const result = await getFullHealth('test-service');

            expect(result.status).toBe('degraded');
            expect(result.message).toBe('Registry file is not accessible');
            expect(result.checks.registry.status).toBe('error');

            config.registryPath = originalPath;
        });

        test('should mark as degraded when any check fails', async () => {
            const originalDataDir = config.dataDir;
            config.dataDir = '/nonexistent/data';

            const result = await getFullHealth('test-service');

            if (result.checks.dataDir.status === 'error') {
                expect(result.status).toBe('degraded');
                expect(result.message).toMatch(/check\(s\) failed/);
            }

            config.dataDir = originalDataDir;
        });

        test('should accept extra checks parameter', async () => {
            const extraChecks = {
                customCheck: {
                    status: 'ok',
                    message: 'Custom check passed',
                },
            };

            const result = await getFullHealth('test-service', extraChecks);

            expect(result.checks).toHaveProperty('customCheck');
            expect(result.checks.customCheck.status).toBe('ok');
        });

        test('should mark as degraded when extra check fails', async () => {
            const extraChecks = {
                customCheck: {
                    status: 'error',
                    message: 'Custom check failed',
                },
            };

            const result = await getFullHealth('test-service', extraChecks);

            expect(result.status).toBe('degraded');
            expect(result.checks.customCheck.status).toBe('error');
        });

        test('should include timestamp in ISO format', async () => {
            const result = await getFullHealth('test-service');

            expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        });

        test('should prioritize registry error message over generic error count', async () => {
            const originalPath = config.registryPath;
            const originalDataDir = config.dataDir;

            config.registryPath = '/nonexistent/registry.json';
            config.dataDir = '/nonexistent/data';

            const result = await getFullHealth('test-service');

            expect(result.status).toBe('degraded');
            expect(result.message).toBe('Registry file is not accessible');

            config.registryPath = originalPath;
            config.dataDir = originalDataDir;
        });
    });

    describe('Edge Cases', () => {
        test('should handle missing service name in getFullHealth', async () => {
            const result = await getFullHealth();

            expect(result.service).toBeUndefined();
            expect(result).toHaveProperty('status');
        });

        test('should handle empty extra checks object', async () => {
            const result = await getFullHealth('test-service', {});

            expect(result.checks).toHaveProperty('registry');
            expect(result.checks).toHaveProperty('dataDir');
        });

        test('should handle null extra checks', async () => {
            const result = await getFullHealth('test-service', null);

            expect(result.checks).toHaveProperty('registry');
            expect(result.checks).toHaveProperty('dataDir');
        });
    });

    describe('Integration', () => {
        test('liveness probe should succeed even when readiness fails', async () => {
            const originalPath = config.registryPath;
            config.registryPath = '/nonexistent/registry.json';

            const liveness = getLivenessProbe();
            const readiness = await getReadinessProbe();

            expect(liveness.status).toBe('alive');
            expect(readiness.status).toBe('not_ready');

            config.registryPath = originalPath;
        });

        test('readiness probe should align with full health check', async () => {
            const readiness = await getReadinessProbe();
            const fullHealth = await getFullHealth('test-service');

            if (readiness.status === 'ready') {
                // If ready, registry check should be ok
                expect(fullHealth.checks.registry.status).toBe('ok');
            } else {
                // If not ready, registry check should fail
                expect(fullHealth.checks.registry.status).toBe('error');
            }
        });
    });
});
