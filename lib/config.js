require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

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

const config = {
    // Server Configuration
    servicePort: parseInt(process.env.SERVICE_PORT || '8090', 10),
    apiPort: parseInt(process.env.API_PORT || '8091', 10),
    nodeEnv: process.env.NODE_ENV || 'development',

    // Paths Configuration
    registryPath: process.env.REGISTRY_PATH || '/opt/registry/projects.json',
    allowedPaths: (process.env.ALLOWED_PATHS || '/opt/dev,/opt/prod,/opt/research')
        .split(',')
        .map((p) => p.trim()),
    dataDir: process.env.DATA_DIR || '/opt/data/vscode-favicon',

    // CORS Configuration
    corsOrigins: (
        process.env.CORS_ORIGINS ||
        'https://vs.noreika.lt,https://favicon-api.noreika.lt,http://localhost:8080,http://192.168.110.199:8080,http://192.168.110.199:8091'
    )
        .split(',')
        .map((o) => o.trim()),

    // Cache Configuration
    cacheMaxSize: parseInt(process.env.CACHE_MAX_SIZE || '100', 10),
    cacheTtl: parseInt(process.env.CACHE_TTL || '3600', 10), // seconds (for HTTP Cache-Control)
    registryCacheTtl: parseInt(process.env.REGISTRY_CACHE_TTL || '60000', 10), // ms (for registry in-memory cache)

    // Rate Limiting
    rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW || '900000', 10), // 15 minutes in ms
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
    rateLimitNotificationWindow: parseInt(
        process.env.RATE_LIMIT_NOTIFICATION_WINDOW || '60000',
        10
    ), // 1 minute in ms
    rateLimitNotificationMax: parseInt(process.env.RATE_LIMIT_NOTIFICATION_MAX || '10', 10),

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

    // Favicon Generation (DEPRECATED - now uses dynamic fast-glob search)
    // @deprecated These config values are only used by legacy buildSearchPaths() method
    // New code should use FaviconService.findFaviconFile() which dynamically scans project directories
    faviconSearchPaths: (
        process.env.FAVICON_SEARCH_PATHS ||
        'favicon.ico,public/favicon.ico,web/favicon.ico,assets/favicon.ico,static/favicon.ico,src/favicon.ico,dist/favicon.ico'
    )
        .split(',')
        .map((p) => p.trim()),

    faviconImagePatterns: (
        process.env.FAVICON_IMAGE_PATTERNS || 'favicon.png,favicon.svg,icon.png,logo.png,logo.svg'
    )
        .split(',')
        .map((p) => p.trim()),

    faviconImageDirs: (process.env.FAVICON_IMAGE_DIRS || ',public,assets,static,images,img')
        .split(',')
        .map((d) => d.trim()),

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

/**
 * Validate configuration values
 * Throws error if critical configuration is invalid
 */
function validateConfig() {
    const errors = [];

    // Validate ports
    if (config.servicePort < 1 || config.servicePort > 65535) {
        errors.push('SERVICE_PORT must be between 1 and 65535');
    }
    if (config.apiPort < 1 || config.apiPort > 65535) {
        errors.push('API_PORT must be between 1 and 65535');
    }
    if (config.servicePort === config.apiPort) {
        errors.push('SERVICE_PORT and API_PORT must be different');
    }

    // Validate allowed paths
    if (config.allowedPaths.length === 0) {
        errors.push('ALLOWED_PATHS cannot be empty');
    }

    // Validate registry path
    if (!config.registryPath || config.registryPath.trim() === '') {
        errors.push('REGISTRY_PATH must be specified');
    }

    // Validate cache configuration
    if (config.cacheMaxSize < 0) {
        errors.push('CACHE_MAX_SIZE must be a positive number');
    }
    if (config.cacheTtl < 0) {
        errors.push('CACHE_TTL must be a positive number');
    }

    // Validate rate limiting
    if (config.rateLimitWindow < 1000) {
        errors.push('RATE_LIMIT_WINDOW must be at least 1000ms (1 second)');
    }
    if (config.rateLimitMax < 1) {
        errors.push('RATE_LIMIT_MAX must be at least 1');
    }
    if (config.rateLimitNotificationWindow < 1000) {
        errors.push('RATE_LIMIT_NOTIFICATION_WINDOW must be at least 1000ms (1 second)');
    }
    if (config.rateLimitNotificationMax < 1) {
        errors.push('RATE_LIMIT_NOTIFICATION_MAX must be at least 1');
    }

    // Validate notification store configuration
    if (config.notificationMaxCount < 1) {
        errors.push('NOTIFICATION_MAX_COUNT must be at least 1');
    }
    if (config.notificationTtlMs < 1000) {
        errors.push('NOTIFICATION_TTL_MS must be at least 1000ms (1 second)');
    }
    if (config.notificationCleanupIntervalMs < 1000) {
        errors.push('NOTIFICATION_CLEANUP_INTERVAL_MS must be at least 1000ms (1 second)');
    }

    // Validate log level
    const validLogLevels = ['error', 'warn', 'info', 'debug'];
    if (!validLogLevels.includes(config.logLevel)) {
        errors.push(`LOG_LEVEL must be one of: ${validLogLevels.join(', ')}`);
    }

    // Validate environment
    const validEnvironments = ['development', 'production', 'test', 'staging'];
    if (!validEnvironments.includes(config.nodeEnv)) {
        earlyLogger.warn({ nodeEnv: config.nodeEnv, validEnvironments }, 'Non-standard NODE_ENV');
    }

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
                apiPort: config.apiPort,
                registryPath: config.registryPath,
                allowedPaths: config.allowedPaths,
                corsOrigins: config.corsOrigins,
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

// Validate on load
try {
    validateConfig();
    logConfigSummary();
} catch (error) {
    earlyLogger.fatal({ err: error }, 'Configuration validation failed');
    process.exit(1);
}

module.exports = config;
