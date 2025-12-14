require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');

/**
 * Centralized configuration for VS Code Favicon services
 *
 * All configuration values are loaded from environment variables with sensible defaults.
 * This ensures consistent configuration across both API and service servers.
 *
 * Environment variables can be set via:
 * - .env file in project root
 * - System environment variables
 * - Docker/Container environment
 */

// Create early logger for config module (before full logger is initialized)
const pino = require('pino');
const earlyLogger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport:
        process.env.NODE_ENV === 'development'
            ? { target: 'pino-pretty', options: { colorize: true } }
            : undefined,
});

// REF-008: Import validation functions from dedicated validators module
const { parseAdminIPs } = require('./validators/config-validators');

/**
 * REF-015: Get extension version from manifest.json
 * @returns {string} Extension version (e.g., "5.6.0")
 */
function getExtensionVersion() {
    try {
        const manifestPath = path.join(__dirname, '..', 'vscode-favicon-extension', 'manifest.json');
        const manifest = require(manifestPath);
        return manifest.version || '0.0.0';
    } catch (error) {
        earlyLogger.warn({ err: error }, 'Failed to read extension manifest version, using default');
        return '0.0.0';
    }
}

/**
 * REF-015: Build extension zip file path from version
 * Can be overridden via EXTENSION_ZIP_PATH environment variable
 * @returns {string} Absolute path to extension zip file
 */
function getExtensionZipPath() {
    if (process.env.EXTENSION_ZIP_PATH) {
        const envPath = process.env.EXTENSION_ZIP_PATH.trim();
        // If path is relative, resolve from project root
        return path.isAbsolute(envPath)
            ? envPath
            : path.join(__dirname, '..', envPath);
    }

    // Default: derive from manifest.json version
    const version = getExtensionVersion();
    return path.join(__dirname, '..', `vscode-favicon-extension-v${version}.zip`);
}

const config = {
    // Server Configuration
    servicePort: parseInt(process.env.SERVICE_PORT || '8090', 10),
    nodeEnv: process.env.NODE_ENV || 'development',

    // Trust Proxy Configuration
    // Controls how Express extracts client IP from X-Forwarded-For headers
    // - 1 (default): Trust first proxy (single proxy like nginx/Cloudflare)
    // - 0: Do not trust proxies (use direct connection IP)
    // - N: Trust N proxies in the chain
    trustProxy: parseInt(process.env.TRUST_PROXY, 10) || 1,

    // Paths Configuration
    registryPath: process.env.REGISTRY_PATH || '/opt/registry/projects.json',
    allowedPaths: (process.env.ALLOWED_PATHS || '/opt/dev,/opt/prod,/opt/research')
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p.length > 0),
    dataDir: process.env.DATA_DIR || '/opt/data/vscode-favicon',
    extensionZipPath: getExtensionZipPath(),

    // CORS Configuration
    corsOrigins: (
        process.env.CORS_ORIGINS ||
        'https://vs.noreika.lt,https://favicon-api.noreika.lt,http://localhost:8080,http://192.168.110.199:8080,http://192.168.110.199:8091'
    )
        .split(',')
        .map((o) => o.trim()),

    // Admin Authentication
    adminIPs: parseAdminIPs(process.env.ADMIN_IPS, earlyLogger),
    // SECURITY: API key for admin endpoints (optional, takes precedence over IP whitelist)
    // If not set, only IP-based authentication is used
    // Recommended: Use a strong random value (minimum 32 characters)
    adminApiKey: process.env.ADMIN_API_KEY || null,

    // Cache Configuration
    cacheMaxSize: parseInt(process.env.CACHE_MAX_SIZE || '100', 10),
    cacheTtl: parseInt(process.env.CACHE_TTL || '3600', 10), // seconds (for HTTP Cache-Control)
    registryCacheTtl: parseInt(process.env.REGISTRY_CACHE_TTL || '60000', 10), // ms (for registry in-memory cache)

    // Rate Limiting (increased for browser extension usage)
    rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW || '60000', 10), // 1 minute in ms
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '10000', 10), // 10000 req/min (high for multi-tab usage)
    rateLimitNotificationWindow: parseInt(
        process.env.RATE_LIMIT_NOTIFICATION_WINDOW || '60000',
        10
    ), // 1 minute in ms
    rateLimitNotificationMax: parseInt(process.env.RATE_LIMIT_NOTIFICATION_MAX || '1000', 10), // 1000 req/min

    // Logging
    logLevel:
        process.env.LOG_LEVEL && ['error', 'warn', 'info', 'debug'].includes(process.env.LOG_LEVEL)
            ? process.env.LOG_LEVEL
            : 'info',

    // Notification Store Configuration
    notificationMaxCount: parseInt(process.env.NOTIFICATION_MAX_COUNT || '1000', 10),
    notificationTtlMs: parseInt(process.env.NOTIFICATION_TTL_MS || '86400000', 10), // 24 hours
    notificationCleanupIntervalMs: parseInt(
        process.env.NOTIFICATION_CLEANUP_INTERVAL_MS || '3600000',
        10
    ), // 1 hour

    // SSE Configuration
    sseMaxConnectionsPerIP: parseInt(process.env.SSE_MAX_CONNECTIONS_PER_IP || '5', 10),
    sseGlobalLimit: parseInt(process.env.SSE_GLOBAL_LIMIT || '100', 10),
    sseKeepaliveInterval: parseInt(process.env.SSE_KEEPALIVE_INTERVAL || '30000', 10),

    // Compression Configuration
    compressionLevel: parseInt(process.env.COMPRESSION_LEVEL || '6', 10),
    compressionThreshold: parseInt(process.env.COMPRESSION_THRESHOLD || '1024', 10),

    // Graceful Shutdown
    gracefulShutdownTimeout: parseInt(process.env.GRACEFUL_SHUTDOWN_TIMEOUT || '10000', 10),

    // Favicon Cache Warming
    faviconWarmOnStartup: process.env.FAVICON_WARM_ON_STARTUP === 'true',
    faviconWarmProjectLimit: parseInt(process.env.FAVICON_WARM_PROJECT_LIMIT || '10', 10),
    faviconWarmTimeout: parseInt(process.env.FAVICON_WARM_TIMEOUT || '5000', 10),

    // Type Colors for Generated Favicons
    typeColors: {
        prod: process.env.COLOR_PROD || '#FF6B6B',
        dev: process.env.COLOR_DEV || '#4ECDC4',
        staging: process.env.COLOR_STAGING || '#FFEAA7',
        test: process.env.COLOR_TEST || '#A29BFE',
        demo: process.env.COLOR_DEMO || '#74B9FF',
        research: process.env.COLOR_RESEARCH || '#00B894',
    },

    // Default color palette for projects without type
    defaultColors: (
        process.env.DEFAULT_COLORS ||
        '#FF6B6B,#4ECDC4,#45B7D1,#96CEB4,#FFEAA7,#FD79A8,#A29BFE,#6C5CE7'
    )
        .split(',')
        .map((c) => c.trim()),
};

// REF-008: Import validation functions from validators module
const {
    validateServerConfig,
    validatePathConfig,
    validateSecurityConfig,
    validateCacheConfig,
    validateNotificationConfig,
} = require('./validators/config-validators');

/**
 * Validate favicon cache warming configuration
 * @param {Object} config - Configuration object
 * @param {Array<string>} errors - Array to collect validation errors
 */
function validateFaviconWarmingConfig(config, errors) {
    if (config.faviconWarmProjectLimit < 1) {
        errors.push('FAVICON_WARM_PROJECT_LIMIT must be at least 1');
    }
    if (config.faviconWarmTimeout < 1000) {
        errors.push('FAVICON_WARM_TIMEOUT must be at least 1000ms (1 second)');
    }
}

/**
 * Validate configuration values
 * Throws error if critical configuration is invalid
 * REF-005: Refactored to use modular validation functions
 * REF-008: Updated to use validators from validators/ module
 */
function validateConfig() {
    const errors = [];

    // REF-008: Call validation functions from validators module
    validateServerConfig(config, errors, earlyLogger);
    validatePathConfig(config, errors);
    validateSecurityConfig(config, errors, earlyLogger);
    validateCacheConfig(config, errors);
    validateNotificationConfig(config, errors);
    validateFaviconWarmingConfig(config, errors);

    if (errors.length > 0) {
        throw new Error(
            `Configuration validation failed:\n${errors.map((e) => `  - ${e}`).join('\n')}`
        );
    }
}

/**
 * Log configuration summary
 * Useful for debugging and deployment verification
 */
function logConfigSummary() {
    if (config.logLevel === 'debug' || config.nodeEnv === 'development') {
        earlyLogger.info(
            {
                environment: config.nodeEnv,
                servicePort: config.servicePort,
                trustProxy: config.trustProxy,
                registryPath: config.registryPath,
                allowedPaths: config.allowedPaths,
                corsOrigins: config.corsOrigins,
                adminAuth: {
                    ips: config.adminIPs,
                    apiKeyConfigured: config.adminApiKey !== null,
                },
                cacheMaxSize: config.cacheMaxSize,
                cacheTtl: config.cacheTtl,
                rateLimit: `${config.rateLimitMax} req/${config.rateLimitWindow}ms`,
                notificationRateLimit: `${config.rateLimitNotificationMax} req/${config.rateLimitNotificationWindow}ms`,
                notificationStore: {
                    maxCount: config.notificationMaxCount,
                    ttlHours: config.notificationTtlMs / 1000 / 60 / 60,
                    cleanupIntervalMinutes: config.notificationCleanupIntervalMs / 1000 / 60,
                },
                logLevel: config.logLevel,
            },
            'VS Code Favicon Configuration'
        );
    }
}

/**
 * REF-020: Initialize and validate configuration
 * Separated from module-level code for better testability
 * Can be called with exitOnError=false in tests
 *
 * @param {boolean} exitOnError - Whether to exit process on validation failure (default: true)
 * @returns {boolean} True if validation passed, false otherwise
 */
function initializeConfig(exitOnError = true) {
    try {
        validateConfig();
        logConfigSummary();
        return true;
    } catch (error) {
        earlyLogger.fatal({ err: error }, 'Configuration validation failed');
        if (exitOnError) {
            process.exit(1);
        }
        return false;
    }
}

// REF-020: Auto-initialize on load unless in test environment
// Tests can skip auto-init and call initializeConfig() manually with exitOnError=false
if (process.env.NODE_ENV !== 'test' || process.env.FORCE_CONFIG_INIT === 'true') {
    initializeConfig();
}

module.exports = config;
module.exports.validateConfig = validateConfig;
module.exports.initializeConfig = initializeConfig;
