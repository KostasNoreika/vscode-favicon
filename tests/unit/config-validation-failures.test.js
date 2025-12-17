/**
 * QUA-004: Unit Tests for Config Validation Failures
 * Tests that config validation throws errors instead of calling process.exit()
 *
 * These tests verify that invalid configuration values throw catchable errors
 * rather than terminating the process, enabling better error handling and testability.
 */

describe('Config Validation Failures - QUA-004', () => {
    let config;
    let originalValues = {};

    beforeAll(() => {
        // Load config module once (NODE_ENV=test prevents auto-init)
        config = require('../../lib/config');
    });

    beforeEach(() => {
        // Save original config values before each test
        originalValues = {
            servicePort: config.servicePort,
            allowedPaths: config.allowedPaths,
            registryPath: config.registryPath,
            rateLimitWindow: config.rateLimitWindow,
            rateLimitMax: config.rateLimitMax,
            rateLimitNotificationWindow: config.rateLimitNotificationWindow,
            rateLimitNotificationMax: config.rateLimitNotificationMax,
            notificationMaxCount: config.notificationMaxCount,
            notificationTtlMs: config.notificationTtlMs,
            notificationCleanupIntervalMs: config.notificationCleanupIntervalMs,
            sseMaxConnectionsPerIP: config.sseMaxConnectionsPerIP,
            sseGlobalLimit: config.sseGlobalLimit,
            sseKeepaliveInterval: config.sseKeepaliveInterval,
            compressionLevel: config.compressionLevel,
            compressionThreshold: config.compressionThreshold,
            gracefulShutdownTimeout: config.gracefulShutdownTimeout,
            cacheMaxSize: config.cacheMaxSize,
            cacheTtl: config.cacheTtl,
            trustProxy: config.trustProxy,
            logLevel: config.logLevel,
            adminIPs: config.adminIPs,
            adminApiKey: config.adminApiKey,
            nodeEnv: config.nodeEnv,
        };
    });

    afterEach(() => {
        // Restore original config values after each test
        Object.assign(config, originalValues);
    });

    describe('Port Validation', () => {
        test('should throw error for port below 1', () => {
            config.servicePort = 0;
            expect(() => config.validateConfig()).toThrow(/SERVICE_PORT must be between 1 and 65535/);
        });

        test('should throw error for port above 65535', () => {
            config.servicePort = 65536;
            expect(() => config.validateConfig()).toThrow(/SERVICE_PORT must be between 1 and 65535/);
        });

        test('should throw error for negative port', () => {
            config.servicePort = -1;
            expect(() => config.validateConfig()).toThrow(/SERVICE_PORT must be between 1 and 65535/);
        });
    });

    describe('Path Validation', () => {
        test('should throw error for empty ALLOWED_PATHS', () => {
            config.allowedPaths = [];
            expect(() => config.validateConfig()).toThrow(/ALLOWED_PATHS cannot be empty/);
        });

        test('should throw error for non-absolute paths in ALLOWED_PATHS', () => {
            config.allowedPaths = ['relative/path', '/absolute/path'];
            expect(() => config.validateConfig()).toThrow(/ALLOWED_PATHS must contain absolute paths.*relative\/path/);
        });

        test('should throw error for empty REGISTRY_PATH', () => {
            config.registryPath = '';
            expect(() => config.validateConfig()).toThrow(/REGISTRY_PATH must be specified/);
        });

        test('should throw error for whitespace-only REGISTRY_PATH', () => {
            config.registryPath = '   ';
            expect(() => config.validateConfig()).toThrow(/REGISTRY_PATH must be specified/);
        });
    });

    describe('Rate Limit Validation', () => {
        test('should throw error for RATE_LIMIT_WINDOW below 1000ms', () => {
            config.rateLimitWindow = 999;
            expect(() => config.validateConfig()).toThrow(/RATE_LIMIT_WINDOW must be at least 1000ms/);
        });

        test('should throw error for RATE_LIMIT_MAX below 1', () => {
            config.rateLimitMax = 0;
            expect(() => config.validateConfig()).toThrow(/RATE_LIMIT_MAX must be at least 1/);
        });

        test('should throw error for RATE_LIMIT_NOTIFICATION_WINDOW below 1000ms', () => {
            config.rateLimitNotificationWindow = 500;
            expect(() => config.validateConfig()).toThrow(/RATE_LIMIT_NOTIFICATION_WINDOW must be at least 1000ms/);
        });

        test('should throw error for RATE_LIMIT_NOTIFICATION_MAX below 1', () => {
            config.rateLimitNotificationMax = 0;
            expect(() => config.validateConfig()).toThrow(/RATE_LIMIT_NOTIFICATION_MAX must be at least 1/);
        });
    });

    describe('Notification Validation', () => {
        test('should throw error for NOTIFICATION_MAX_COUNT below 1', () => {
            config.notificationMaxCount = 0;
            expect(() => config.validateConfig()).toThrow(/NOTIFICATION_MAX_COUNT must be at least 1/);
        });

        test('should throw error for NOTIFICATION_TTL_MS below 1000ms', () => {
            config.notificationTtlMs = 999;
            expect(() => config.validateConfig()).toThrow(/NOTIFICATION_TTL_MS must be at least 1000ms/);
        });

        test('should throw error for NOTIFICATION_CLEANUP_INTERVAL_MS below 1000ms', () => {
            config.notificationCleanupIntervalMs = 500;
            expect(() => config.validateConfig()).toThrow(/NOTIFICATION_CLEANUP_INTERVAL_MS must be at least 1000ms/);
        });
    });

    describe('SSE Validation', () => {
        test('should throw error for SSE_MAX_CONNECTIONS_PER_IP below 1', () => {
            config.sseMaxConnectionsPerIP = 0;
            expect(() => config.validateConfig()).toThrow(/SSE_MAX_CONNECTIONS_PER_IP must be at least 1/);
        });

        test('should throw error for SSE_GLOBAL_LIMIT below 1', () => {
            config.sseGlobalLimit = 0;
            expect(() => config.validateConfig()).toThrow(/SSE_GLOBAL_LIMIT must be at least 1/);
        });

        test('should throw error for SSE_KEEPALIVE_INTERVAL below 1000ms', () => {
            config.sseKeepaliveInterval = 999;
            expect(() => config.validateConfig()).toThrow(/SSE_KEEPALIVE_INTERVAL must be at least 1000ms/);
        });
    });

    describe('Compression Validation', () => {
        test('should throw error for COMPRESSION_LEVEL below 0', () => {
            config.compressionLevel = -1;
            expect(() => config.validateConfig()).toThrow(/COMPRESSION_LEVEL must be between 0 and 9/);
        });

        test('should throw error for COMPRESSION_LEVEL above 9', () => {
            config.compressionLevel = 10;
            expect(() => config.validateConfig()).toThrow(/COMPRESSION_LEVEL must be between 0 and 9/);
        });

        test('should throw error for negative COMPRESSION_THRESHOLD', () => {
            config.compressionThreshold = -100;
            expect(() => config.validateConfig()).toThrow(/COMPRESSION_THRESHOLD must be a positive number/);
        });
    });

    describe('Graceful Shutdown Validation', () => {
        test('should throw error for GRACEFUL_SHUTDOWN_TIMEOUT below 1000ms', () => {
            config.gracefulShutdownTimeout = 999;
            expect(() => config.validateConfig()).toThrow(/GRACEFUL_SHUTDOWN_TIMEOUT must be at least 1000ms/);
        });

        test('should throw error for GRACEFUL_SHUTDOWN_TIMEOUT of 0', () => {
            config.gracefulShutdownTimeout = 0;
            expect(() => config.validateConfig()).toThrow(/GRACEFUL_SHUTDOWN_TIMEOUT must be at least 1000ms/);
        });
    });

    describe('Cache Validation', () => {
        test('should throw error for negative CACHE_MAX_SIZE', () => {
            config.cacheMaxSize = -10;
            expect(() => config.validateConfig()).toThrow(/CACHE_MAX_SIZE must be a positive number/);
        });

        test('should throw error for negative CACHE_TTL', () => {
            config.cacheTtl = -1;
            expect(() => config.validateConfig()).toThrow(/CACHE_TTL must be a positive number/);
        });
    });

    describe('Trust Proxy Validation', () => {
        test('should throw error for negative TRUST_PROXY', () => {
            config.trustProxy = -1;
            expect(() => config.validateConfig()).toThrow(/TRUST_PROXY must be a non-negative integer/);
        });
    });

    describe('Admin Authentication Validation', () => {
        test('should throw error with empty ADMIN_IPS array', () => {
            config.adminIPs = [];
            expect(() => config.validateConfig()).toThrow(/ADMIN_IPS must contain at least one valid IP address/);
        });

        test('should accept null ADMIN_API_KEY_HASH (IP-only auth)', () => {
            // SEC-002: API key is now stored as bcrypt hash
            // null is valid - means IP-only authentication
            config.adminApiKeyHash = null;
            expect(() => config.validateConfig()).not.toThrow();
        });

        test('should accept valid bcrypt hash for ADMIN_API_KEY_HASH', () => {
            // SEC-002: Valid bcrypt hash format
            config.adminApiKeyHash = '$2b$10$VWjtLrWWKuz0G8eaoUTiEuMFgDmC8ddtLl3uCeSv6pfKdI4M5hxL2';
            expect(() => config.validateConfig()).not.toThrow();
        });
    });

    describe('Log Level Validation', () => {
        test('should throw error for invalid LOG_LEVEL', () => {
            config.logLevel = 'invalid';
            expect(() => config.validateConfig()).toThrow(/LOG_LEVEL must be one of: error, warn, info, debug/);
        });

        test('should accept valid log levels', () => {
            const validLevels = ['error', 'warn', 'info', 'debug'];
            for (const level of validLevels) {
                config.logLevel = level;
                expect(() => config.validateConfig()).not.toThrow();
            }
        });
    });

    describe('Multiple Validation Errors', () => {
        test('should throw error listing all validation failures', () => {
            config.servicePort = 0;
            config.cacheMaxSize = -10;
            config.rateLimitWindow = 500;

            expect(() => config.validateConfig()).toThrow(/Configuration validation failed/);
        });

        test('should include all error messages in thrown error', () => {
            config.servicePort = 100000;
            config.cacheTtl = -5;

            try {
                config.validateConfig();
                throw new Error('Should have thrown error');
            } catch (error) {
                expect(error.message).toContain('SERVICE_PORT must be between 1 and 65535');
                expect(error.message).toContain('CACHE_TTL must be a positive number');
            }
        });
    });

    describe('initializeConfig Function', () => {
        test('should return false when validation fails', () => {
            config.servicePort = 0;

            // When exitOnError=false, initializeConfig returns false instead of throwing
            const result = config.initializeConfig(false);
            expect(result).toBe(false);
        });

        test('should return true when validation passes', () => {
            // Config is already valid from initial load
            const result = config.initializeConfig(false);
            expect(result).toBe(true);
        });
    });

    describe('Error Handling Without process.exit()', () => {
        test('should throw catchable Error object', () => {
            config.servicePort = 0;

            let caughtError = null;
            try {
                config.validateConfig();
            } catch (error) {
                caughtError = error;
            }

            expect(caughtError).toBeInstanceOf(Error);
            expect(caughtError.message).toContain('Configuration validation failed');
        });

        test('should not call process.exit during validation', () => {
            const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

            config.servicePort = 0;

            try {
                config.validateConfig();
            } catch (error) {
                // Expected to throw
            }

            expect(exitSpy).not.toHaveBeenCalled();
            exitSpy.mockRestore();
        });

        test('should not call process.exit during initializeConfig', () => {
            const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

            config.servicePort = 0;

            try {
                config.initializeConfig(false); // exitOnError=false to get catchable error
            } catch (error) {
                // Expected to throw
            }

            expect(exitSpy).not.toHaveBeenCalled();
            exitSpy.mockRestore();
        });
    });

    describe('Valid Configuration', () => {
        test('should pass validation with default config values', () => {
            // All original values should be valid
            expect(() => config.validateConfig()).not.toThrow();
        });

        test('should pass validation at boundary values', () => {
            config.servicePort = 1;
            config.rateLimitWindow = 1000;
            config.compressionLevel = 0;
            config.cacheMaxSize = 0;

            expect(() => config.validateConfig()).not.toThrow();
        });
    });
});
