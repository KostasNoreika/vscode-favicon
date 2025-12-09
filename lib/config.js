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

/**
 * Validate IP address format (IPv4 and IPv6)
 * @param {string} ip - IP address to validate
 * @returns {boolean} - True if valid IP format
 */
function isValidIP(ip) {
    if (!ip || typeof ip !== 'string') {
        return false;
    }

    const trimmed = ip.trim();
    if (trimmed.length === 0) {
        return false;
    }

    // IPv4 validation: 0-255.0-255.0-255.0-255
    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    if (ipv4Regex.test(trimmed)) {
        return true;
    }

    // IPv6 validation: Support standard and compressed formats
    // ::1 (localhost), fe80::1, 2001:db8::1, etc.
    const ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
    if (ipv6Regex.test(trimmed)) {
        return true;
    }

    return false;
}

/**
 * Parse and validate admin IP addresses from environment
 * @param {string} ipString - Comma-separated list of IP addresses
 * @returns {string[]} - Array of valid IP addresses
 */
function parseAdminIPs(ipString) {
    const ips = (ipString || '127.0.0.1,::1')
        .split(',')
        .map((ip) => ip.trim())
        .filter((ip) => ip.length > 0);

    const validIPs = [];
    const invalidIPs = [];

    for (const ip of ips) {
        if (isValidIP(ip)) {
            validIPs.push(ip);
        } else {
            invalidIPs.push(ip);
        }
    }

    // Log warnings for invalid IPs but don't fail
    if (invalidIPs.length > 0) {
        earlyLogger.warn(
            { invalidIPs, validIPs },
            'Invalid IP addresses found in ADMIN_IPS, they will be ignored'
        );
    }

    // SECURITY FIX SEC-006: In production, require explicit admin IP configuration
    // Prevent startup if no valid IPs are configured in production environment
    const isProduction = process.env.NODE_ENV === 'production';

    if (validIPs.length === 0) {
        if (isProduction) {
            // In production: FAIL - force explicit configuration
            throw new Error(
                'SECURITY: No valid ADMIN_IPS configured in production mode. ' +
                'Admin endpoints require explicit IP whitelist configuration. ' +
                'Set ADMIN_IPS environment variable with valid IP addresses.'
            );
        } else {
            // In development/test: WARN and use localhost defaults
            earlyLogger.warn('No valid ADMIN_IPS configured, using defaults: 127.0.0.1, ::1');
            return ['127.0.0.1', '::1'];
        }
    }

    return validIPs;
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

    // CORS Configuration
    corsOrigins: (
        process.env.CORS_ORIGINS ||
        'https://vs.noreika.lt,https://favicon-api.noreika.lt,http://localhost:8080,http://192.168.110.199:8080,http://192.168.110.199:8091'
    )
        .split(',')
        .map((o) => o.trim()),

    // Admin Authentication
    adminIPs: parseAdminIPs(process.env.ADMIN_IPS),
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
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '2000', 10), // 2000 req/min
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
 * REF-005: Validate server configuration (ports, logging, environment)
 * @param {Object} config - Configuration object
 * @param {Array<string>} errors - Array to collect validation errors
 */
function validateServerConfig(config, errors) {
    // Validate ports
    if (config.servicePort < 1 || config.servicePort > 65535) {
        errors.push('SERVICE_PORT must be between 1 and 65535');
    }

    // Validate log level
    const validLogLevels = ['error', 'warn', 'info', 'debug'];
    if (!validLogLevels.includes(config.logLevel)) {
        errors.push(`LOG_LEVEL must be one of: ${validLogLevels.join(', ')}`);
    }

    // Validate environment (warning only, not an error)
    const validEnvironments = ['development', 'production', 'test', 'staging'];
    if (!validEnvironments.includes(config.nodeEnv)) {
        earlyLogger.warn({ nodeEnv: config.nodeEnv, validEnvironments }, 'Non-standard NODE_ENV');
    }

    // Validate graceful shutdown
    if (config.gracefulShutdownTimeout < 1000) {
        errors.push('GRACEFUL_SHUTDOWN_TIMEOUT must be at least 1000ms (1 second)');
    }

    // Validate compression configuration
    if (config.compressionLevel < 0 || config.compressionLevel > 9) {
        errors.push('COMPRESSION_LEVEL must be between 0 and 9');
    }
    if (config.compressionThreshold < 0) {
        errors.push('COMPRESSION_THRESHOLD must be a positive number');
    }

    // Validate trust proxy configuration
    if (isNaN(config.trustProxy) || config.trustProxy < 0) {
        errors.push('TRUST_PROXY must be a non-negative integer');
    }
}

/**
 * REF-005: Validate path configuration (allowed paths, registry)
 * @param {Object} config - Configuration object
 * @param {Array<string>} errors - Array to collect validation errors
 */
function validatePathConfig(config, errors) {
    // Validate allowed paths
    if (config.allowedPaths.length === 0) {
        errors.push('ALLOWED_PATHS cannot be empty');
    }

    // Validate that all allowed paths are absolute
    config.allowedPaths.forEach((p) => {
        if (!path.isAbsolute(p)) {
            errors.push(`ALLOWED_PATHS must contain absolute paths, got: ${p}`);
        }
    });

    // Validate registry path
    if (!config.registryPath || config.registryPath.trim() === '') {
        errors.push('REGISTRY_PATH must be specified');
    }
}

/**
 * Validate admin authentication configuration
 * @param {Object} config - Configuration object
 * @param {Array<string>} errors - Array to collect validation errors
 */
function validateAdminAuth(config, errors) {
    // Validate admin IPs
    if (!Array.isArray(config.adminIPs) || config.adminIPs.length === 0) {
        errors.push('ADMIN_IPS must contain at least one valid IP address');
    }

    // Validate admin API key (optional, but warn if weak)
    if (config.adminApiKey !== null) {
        if (typeof config.adminApiKey !== 'string' || config.adminApiKey.trim().length === 0) {
            errors.push('ADMIN_API_KEY must be a non-empty string if provided');
        } else if (config.adminApiKey.length < 32) {
            earlyLogger.warn(
                { keyLength: config.adminApiKey.length },
                'ADMIN_API_KEY is shorter than recommended 32 characters - consider using a stronger key'
            );
        }
    }
}

/**
 * Validate rate limiting configuration
 * @param {Object} config - Configuration object
 * @param {Array<string>} errors - Array to collect validation errors
 */
function validateRateLimits(config, errors) {
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
}

/**
 * Validate SSE configuration
 * @param {Object} config - Configuration object
 * @param {Array<string>} errors - Array to collect validation errors
 */
function validateSSEConfig(config, errors) {
    if (config.sseMaxConnectionsPerIP < 1) {
        errors.push('SSE_MAX_CONNECTIONS_PER_IP must be at least 1');
    }
    if (config.sseGlobalLimit < 1) {
        errors.push('SSE_GLOBAL_LIMIT must be at least 1');
    }
    if (config.sseKeepaliveInterval < 1000) {
        errors.push('SSE_KEEPALIVE_INTERVAL must be at least 1000ms (1 second)');
    }
}

/**
 * REF-005: Validate security configuration - delegates to focused validators
 * @param {Object} config - Configuration object
 * @param {Array<string>} errors - Array to collect validation errors
 */
function validateSecurityConfig(config, errors) {
    validateAdminAuth(config, errors);
    validateRateLimits(config, errors);
    validateSSEConfig(config, errors);
}

/**
 * REF-005: Validate cache configuration
 * @param {Object} config - Configuration object
 * @param {Array<string>} errors - Array to collect validation errors
 */
function validateCacheConfig(config, errors) {
    if (config.cacheMaxSize < 0) {
        errors.push('CACHE_MAX_SIZE must be a positive number');
    }
    if (config.cacheTtl < 0) {
        errors.push('CACHE_TTL must be a positive number');
    }
}

/**
 * REF-005: Validate notification configuration
 * @param {Object} config - Configuration object
 * @param {Array<string>} errors - Array to collect validation errors
 */
function validateNotificationConfig(config, errors) {
    if (config.notificationMaxCount < 1) {
        errors.push('NOTIFICATION_MAX_COUNT must be at least 1');
    }
    if (config.notificationTtlMs < 1000) {
        errors.push('NOTIFICATION_TTL_MS must be at least 1000ms (1 second)');
    }
    if (config.notificationCleanupIntervalMs < 1000) {
        errors.push('NOTIFICATION_CLEANUP_INTERVAL_MS must be at least 1000ms (1 second)');
    }
}

/**
 * Validate configuration values
 * Throws error if critical configuration is invalid
 * REF-005: Refactored to use modular validation functions
 */
function validateConfig() {
    const errors = [];

    // REF-005: Call modular validation functions
    validateServerConfig(config, errors);
    validatePathConfig(config, errors);
    validateSecurityConfig(config, errors);
    validateCacheConfig(config, errors);
    validateNotificationConfig(config, errors);

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
