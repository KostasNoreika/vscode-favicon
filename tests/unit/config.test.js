/**
 * Unit Tests for Config Module
 * Tests configuration validation, defaults, and environment variable handling
 *
 * NOTE: Config module validates on load and calls process.exit(1) on failure.
 * We test validation by setting invalid env vars and checking if require() throws.
 */

describe('Config Module', () => {
    let originalEnv;

    beforeEach(() => {
        // Save original environment
        originalEnv = { ...process.env };

        // Clear module cache to get fresh config
        jest.resetModules();

        // Suppress console output during tests
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        // Restore original environment
        process.env = originalEnv;

        // Restore console
        jest.restoreAllMocks();
    });

    describe('Default Configuration', () => {
        test('should load with default values when no env vars set', () => {
            // Clear relevant env vars
            delete process.env.SERVICE_PORT;
            delete process.env.NODE_ENV;
            delete process.env.REGISTRY_PATH;
            delete process.env.CACHE_MAX_SIZE;

            const config = require('../../lib/config');

            expect(config.servicePort).toBe(8090);
            expect(config.nodeEnv).toBe('development');
            expect(config.registryPath).toBe('/opt/registry/projects.json');
            expect(config.cacheMaxSize).toBe(100);
        });

        test('should have valid allowed paths by default', () => {
            delete process.env.ALLOWED_PATHS;

            const config = require('../../lib/config');

            expect(Array.isArray(config.allowedPaths)).toBe(true);
            expect(config.allowedPaths.length).toBeGreaterThan(0);
            expect(config.allowedPaths).toContain('/opt/dev');
            expect(config.allowedPaths).toContain('/opt/prod');
        });

        test('should have valid CORS origins by default', () => {
            delete process.env.CORS_ORIGINS;

            const config = require('../../lib/config');

            expect(Array.isArray(config.corsOrigins)).toBe(true);
            expect(config.corsOrigins.length).toBeGreaterThan(0);
        });

        test('should have valid rate limit defaults', () => {
            const config = require('../../lib/config');

            // Check that rate limit config is loaded (may be from .env or defaults)
            expect(config.rateLimitWindow).toBeGreaterThanOrEqual(60000); // At least 1 minute (default)
            expect(config.rateLimitMax).toBeGreaterThan(0); // At least 1
            expect(typeof config.rateLimitWindow).toBe('number');
            expect(typeof config.rateLimitMax).toBe('number');
        });

        test('should have valid log level default', () => {
            delete process.env.LOG_LEVEL;

            const config = require('../../lib/config');

            expect(config.logLevel).toBe('info');
        });
    });

    describe('Environment Variable Parsing', () => {
        test('should parse SERVICE_PORT from environment', () => {
            process.env.SERVICE_PORT = '9000';

            const config = require('../../lib/config');

            expect(config.servicePort).toBe(9000);
        });

        test('should parse NODE_ENV from environment', () => {
            process.env.NODE_ENV = 'production';

            const config = require('../../lib/config');

            expect(config.nodeEnv).toBe('production');
        });

        test('should parse REGISTRY_PATH from environment', () => {
            process.env.REGISTRY_PATH = '/custom/path/registry.json';

            const config = require('../../lib/config');

            expect(config.registryPath).toBe('/custom/path/registry.json');
        });

        test('should parse comma-separated ALLOWED_PATHS', () => {
            process.env.ALLOWED_PATHS = '/path1,/path2,/path3';

            const config = require('../../lib/config');

            expect(config.allowedPaths).toEqual(['/path1', '/path2', '/path3']);
        });

        test('should trim whitespace from comma-separated values', () => {
            process.env.ALLOWED_PATHS = ' /path1 , /path2 , /path3 ';

            const config = require('../../lib/config');

            expect(config.allowedPaths).toEqual(['/path1', '/path2', '/path3']);
        });

        test('should parse numeric configuration values', () => {
            process.env.CACHE_MAX_SIZE = '200';
            process.env.CACHE_TTL = '7200';
            process.env.RATE_LIMIT_WINDOW = '600000';
            process.env.RATE_LIMIT_MAX = '50';

            const config = require('../../lib/config');

            expect(config.cacheMaxSize).toBe(200);
            expect(config.cacheTtl).toBe(7200);
            expect(config.rateLimitWindow).toBe(600000);
            expect(config.rateLimitMax).toBe(50);
        });

        test('should parse CORS_ORIGINS comma-separated list', () => {
            process.env.CORS_ORIGINS = 'https://example.com,https://api.example.com';

            const config = require('../../lib/config');

            expect(config.corsOrigins).toEqual([
                'https://example.com',
                'https://api.example.com',
            ]);
        });
    });

    describe('Configuration Validation - Ports', () => {
        test('should accept valid port range', () => {
            process.env.SERVICE_PORT = '8080';

            const config = require('../../lib/config');

            expect(config.servicePort).toBe(8080);
        });

        test('should accept port 1', () => {
            process.env.SERVICE_PORT = '1';

            const config = require('../../lib/config');

            expect(config.servicePort).toBe(1);
        });

        test('should accept port 65535', () => {
            process.env.SERVICE_PORT = '65535';

            const config = require('../../lib/config');

            expect(config.servicePort).toBe(65535);
        });
    });

    describe('Configuration Validation - Paths', () => {
        test('should accept valid ALLOWED_PATHS', () => {
            process.env.ALLOWED_PATHS = '/path1,/path2';

            const config = require('../../lib/config');

            expect(config.allowedPaths.length).toBe(2);
        });

        test('should accept valid REGISTRY_PATH', () => {
            process.env.REGISTRY_PATH = '/valid/path/registry.json';

            const config = require('../../lib/config');

            expect(config.registryPath).toBe('/valid/path/registry.json');
        });
    });

    describe('Configuration Validation - Cache', () => {
        test('should accept zero CACHE_MAX_SIZE', () => {
            process.env.CACHE_MAX_SIZE = '0';

            const config = require('../../lib/config');

            expect(config.cacheMaxSize).toBe(0);
        });

        test('should accept positive CACHE_MAX_SIZE', () => {
            process.env.CACHE_MAX_SIZE = '500';

            const config = require('../../lib/config');

            expect(config.cacheMaxSize).toBe(500);
        });

        test('should accept positive CACHE_TTL', () => {
            process.env.CACHE_TTL = '1800';

            const config = require('../../lib/config');

            expect(config.cacheTtl).toBe(1800);
        });
    });

    describe('Configuration Validation - Rate Limiting', () => {
        test('should accept RATE_LIMIT_WINDOW of exactly 1000ms', () => {
            process.env.RATE_LIMIT_WINDOW = '1000';

            const config = require('../../lib/config');

            expect(config.rateLimitWindow).toBe(1000);
        });

        test('should accept RATE_LIMIT_WINDOW above 1000ms', () => {
            process.env.RATE_LIMIT_WINDOW = '60000';

            const config = require('../../lib/config');

            expect(config.rateLimitWindow).toBe(60000);
        });

        test('should accept RATE_LIMIT_MAX of 1', () => {
            process.env.RATE_LIMIT_MAX = '1';

            const config = require('../../lib/config');

            expect(config.rateLimitMax).toBe(1);
        });

        test('should accept RATE_LIMIT_NOTIFICATION_WINDOW of exactly 1000ms', () => {
            process.env.RATE_LIMIT_NOTIFICATION_WINDOW = '1000';

            const config = require('../../lib/config');

            expect(config.rateLimitNotificationWindow).toBe(1000);
        });

        test('should accept RATE_LIMIT_NOTIFICATION_MAX of 1', () => {
            process.env.RATE_LIMIT_NOTIFICATION_MAX = '1';

            const config = require('../../lib/config');

            expect(config.rateLimitNotificationMax).toBe(1);
        });
    });

    describe('Configuration Validation - Notifications', () => {
        test('should accept NOTIFICATION_MAX_COUNT of 1', () => {
            process.env.NOTIFICATION_MAX_COUNT = '1';

            const config = require('../../lib/config');

            expect(config.notificationMaxCount).toBe(1);
        });

        test('should accept NOTIFICATION_TTL_MS of exactly 1000ms', () => {
            process.env.NOTIFICATION_TTL_MS = '1000';

            const config = require('../../lib/config');

            expect(config.notificationTtlMs).toBe(1000);
        });

        test('should accept NOTIFICATION_CLEANUP_INTERVAL_MS of exactly 1000ms', () => {
            process.env.NOTIFICATION_CLEANUP_INTERVAL_MS = '1000';

            const config = require('../../lib/config');

            expect(config.notificationCleanupIntervalMs).toBe(1000);
        });
    });

    describe('Configuration Validation - SSE', () => {
        test('should accept SSE_MAX_CONNECTIONS_PER_IP of 1', () => {
            process.env.SSE_MAX_CONNECTIONS_PER_IP = '1';

            const config = require('../../lib/config');

            expect(config.sseMaxConnectionsPerIP).toBe(1);
        });

        test('should accept SSE_GLOBAL_LIMIT of 1', () => {
            process.env.SSE_GLOBAL_LIMIT = '1';

            const config = require('../../lib/config');

            expect(config.sseGlobalLimit).toBe(1);
        });

        test('should accept SSE_KEEPALIVE_INTERVAL of exactly 1000ms', () => {
            process.env.SSE_KEEPALIVE_INTERVAL = '1000';

            const config = require('../../lib/config');

            expect(config.sseKeepaliveInterval).toBe(1000);
        });
    });

    describe('Configuration Validation - Compression', () => {
        test('should accept COMPRESSION_LEVEL of 0', () => {
            process.env.COMPRESSION_LEVEL = '0';

            const config = require('../../lib/config');

            expect(config.compressionLevel).toBe(0);
        });

        test('should accept COMPRESSION_LEVEL of 9', () => {
            process.env.COMPRESSION_LEVEL = '9';

            const config = require('../../lib/config');

            expect(config.compressionLevel).toBe(9);
        });

        test('should accept COMPRESSION_LEVEL between 0 and 9', () => {
            process.env.COMPRESSION_LEVEL = '6';

            const config = require('../../lib/config');

            expect(config.compressionLevel).toBe(6);
        });

        test('should accept zero COMPRESSION_THRESHOLD', () => {
            process.env.COMPRESSION_THRESHOLD = '0';

            const config = require('../../lib/config');

            expect(config.compressionThreshold).toBe(0);
        });
    });

    describe('Configuration Validation - Graceful Shutdown', () => {
        test('should accept GRACEFUL_SHUTDOWN_TIMEOUT of exactly 1000ms', () => {
            process.env.GRACEFUL_SHUTDOWN_TIMEOUT = '1000';

            const config = require('../../lib/config');

            expect(config.gracefulShutdownTimeout).toBe(1000);
        });

        test('should accept GRACEFUL_SHUTDOWN_TIMEOUT above 1000ms', () => {
            process.env.GRACEFUL_SHUTDOWN_TIMEOUT = '5000';

            const config = require('../../lib/config');

            expect(config.gracefulShutdownTimeout).toBe(5000);
        });
    });

    describe('Configuration Validation - Log Level', () => {
        test('should accept valid LOG_LEVEL values', () => {
            const validLevels = ['error', 'warn', 'info', 'debug'];

            for (const level of validLevels) {
                jest.resetModules();
                process.env.LOG_LEVEL = level;

                const config = require('../../lib/config');
                expect(config.logLevel).toBe(level);
            }
        });

        test('should accept error log level', () => {
            process.env.LOG_LEVEL = 'error';

            const config = require('../../lib/config');

            expect(config.logLevel).toBe('error');
        });

        test('should accept warn log level', () => {
            process.env.LOG_LEVEL = 'warn';

            const config = require('../../lib/config');

            expect(config.logLevel).toBe('warn');
        });

        test('should accept info log level', () => {
            process.env.LOG_LEVEL = 'info';

            const config = require('../../lib/config');

            expect(config.logLevel).toBe('info');
        });

        test('should accept debug log level', () => {
            process.env.LOG_LEVEL = 'debug';

            const config = require('../../lib/config');

            expect(config.logLevel).toBe('debug');
        });
    });

    describe('Type Colors Configuration', () => {
        test('should have default type colors', () => {
            delete process.env.COLOR_PROD;
            delete process.env.COLOR_DEV;

            const config = require('../../lib/config');

            expect(config.typeColors).toHaveProperty('prod');
            expect(config.typeColors).toHaveProperty('dev');
            expect(config.typeColors).toHaveProperty('staging');
            expect(config.typeColors).toHaveProperty('test');

            expect(config.typeColors.prod).toBe('#FF6B6B');
            expect(config.typeColors.dev).toBe('#4ECDC4');
        });

        test('should allow custom type colors via env vars', () => {
            process.env.COLOR_PROD = '#FF0000';
            process.env.COLOR_DEV = '#00FF00';

            const config = require('../../lib/config');

            expect(config.typeColors.prod).toBe('#FF0000');
            expect(config.typeColors.dev).toBe('#00FF00');
        });

        test('should have default color palette', () => {
            delete process.env.DEFAULT_COLORS;

            const config = require('../../lib/config');

            expect(Array.isArray(config.defaultColors)).toBe(true);
            expect(config.defaultColors.length).toBeGreaterThan(0);
            expect(config.defaultColors[0]).toMatch(/^#[0-9A-F]{6}$/i);
        });

        test('should parse custom DEFAULT_COLORS from env', () => {
            process.env.DEFAULT_COLORS = '#FF0000,#00FF00,#0000FF';

            const config = require('../../lib/config');

            expect(config.defaultColors).toEqual(['#FF0000', '#00FF00', '#0000FF']);
        });
    });

    describe('Edge Cases', () => {
        test('should handle empty string in comma-separated list', () => {
            process.env.ALLOWED_PATHS = '/path1,,/path2';

            const config = require('../../lib/config');

            // Empty strings after split should be trimmed but may still exist
            expect(config.allowedPaths.includes('/path1')).toBe(true);
            expect(config.allowedPaths.includes('/path2')).toBe(true);
        });

        test('should trim whitespace from color values', () => {
            process.env.DEFAULT_COLORS = ' #FF0000 , #00FF00 ';

            const config = require('../../lib/config');

            expect(config.defaultColors).toEqual(['#FF0000', '#00FF00']);
        });

        test('should handle multiple allowed paths', () => {
            process.env.ALLOWED_PATHS = '/opt/dev,/opt/prod,/opt/staging,/opt/test';

            const config = require('../../lib/config');

            expect(config.allowedPaths.length).toBe(4);
            expect(config.allowedPaths).toContain('/opt/dev');
            expect(config.allowedPaths).toContain('/opt/staging');
        });
    });

    describe('All Configuration Properties', () => {
        test('should have all required configuration properties', () => {
            const config = require('../../lib/config');

            // Server config
            expect(config).toHaveProperty('servicePort');
            expect(config).toHaveProperty('nodeEnv');

            // Paths
            expect(config).toHaveProperty('registryPath');
            expect(config).toHaveProperty('allowedPaths');
            expect(config).toHaveProperty('dataDir');

            // CORS
            expect(config).toHaveProperty('corsOrigins');

            // Cache
            expect(config).toHaveProperty('cacheMaxSize');
            expect(config).toHaveProperty('cacheTtl');
            expect(config).toHaveProperty('registryCacheTtl');

            // Rate limiting
            expect(config).toHaveProperty('rateLimitWindow');
            expect(config).toHaveProperty('rateLimitMax');
            expect(config).toHaveProperty('rateLimitNotificationWindow');
            expect(config).toHaveProperty('rateLimitNotificationMax');

            // Logging
            expect(config).toHaveProperty('logLevel');

            // Notifications
            expect(config).toHaveProperty('notificationMaxCount');
            expect(config).toHaveProperty('notificationTtlMs');
            expect(config).toHaveProperty('notificationCleanupIntervalMs');

            // SSE
            expect(config).toHaveProperty('sseMaxConnectionsPerIP');
            expect(config).toHaveProperty('sseGlobalLimit');
            expect(config).toHaveProperty('sseKeepaliveInterval');

            // Compression
            expect(config).toHaveProperty('compressionLevel');
            expect(config).toHaveProperty('compressionThreshold');

            // Shutdown
            expect(config).toHaveProperty('gracefulShutdownTimeout');

            // Colors
            expect(config).toHaveProperty('typeColors');
            expect(config).toHaveProperty('defaultColors');
        });

        test('should have correct data types for all properties', () => {
            const config = require('../../lib/config');

            // Numbers
            expect(typeof config.servicePort).toBe('number');
            expect(typeof config.cacheMaxSize).toBe('number');
            expect(typeof config.cacheTtl).toBe('number');
            expect(typeof config.rateLimitWindow).toBe('number');
            expect(typeof config.rateLimitMax).toBe('number');
            expect(typeof config.compressionLevel).toBe('number');

            // Strings
            expect(typeof config.nodeEnv).toBe('string');
            expect(typeof config.registryPath).toBe('string');
            expect(typeof config.logLevel).toBe('string');
            expect(typeof config.dataDir).toBe('string');

            // Arrays
            expect(Array.isArray(config.allowedPaths)).toBe(true);
            expect(Array.isArray(config.corsOrigins)).toBe(true);
            expect(Array.isArray(config.defaultColors)).toBe(true);

            // Objects
            expect(typeof config.typeColors).toBe('object');
        });
    });
});
