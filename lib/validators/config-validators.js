const path = require('path');
const net = require('net');

// ========================================
// Configuration Constants
// ========================================

/** @const {number} Default HTTP port for the service */
const DEFAULT_SERVICE_PORT = 8090;
/** @const {number} Default trust proxy setting (1 = trust first proxy) */
const DEFAULT_TRUST_PROXY = 1;
/** @const {number} Default graceful shutdown timeout in milliseconds */
const DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS = 10000;
/** @const {number} Default maximum number of entries in LRU cache */
const DEFAULT_CACHE_MAX_SIZE = 100;
/** @const {number} Default HTTP Cache-Control max-age in seconds */
const DEFAULT_CACHE_TTL_SECONDS = 3600;
/** @const {number} Default registry in-memory cache TTL in milliseconds */
const DEFAULT_REGISTRY_CACHE_TTL_MS = 60000;
/** @const {number} Default rate limit time window in milliseconds (1 minute) */
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60000;
/** @const {number} Default maximum requests per window for general API endpoints */
const DEFAULT_RATE_LIMIT_MAX = 10000;
/** @const {number} Default rate limit time window for notification endpoints in milliseconds */
const DEFAULT_NOTIFICATION_RATE_LIMIT_WINDOW_MS = 60000;
/** @const {number} Default maximum requests per window for notification endpoints */
const DEFAULT_NOTIFICATION_RATE_LIMIT_MAX = 1000;
/** @const {number} Default maximum number of notifications to store */
const DEFAULT_NOTIFICATION_MAX_COUNT = 1000;
/** @const {number} Default notification time-to-live in milliseconds (24 hours) */
const DEFAULT_NOTIFICATION_TTL_MS = 86400000;
/** @const {number} Default notification cleanup interval in milliseconds (1 hour) */
const DEFAULT_NOTIFICATION_CLEANUP_INTERVAL_MS = 3600000;
/** @const {number} Default maximum SSE connections allowed per IP address */
const DEFAULT_SSE_MAX_CONNECTIONS_PER_IP = 5;
/** @const {number} Default global maximum SSE connections across all IPs */
const DEFAULT_SSE_GLOBAL_LIMIT = 100;
/** @const {number} Default SSE keepalive ping interval in milliseconds */
const DEFAULT_SSE_KEEPALIVE_INTERVAL_MS = 30000;
/** @const {number} Default gzip compression level (0-9, where 6 is balanced speed/ratio) */
const DEFAULT_COMPRESSION_LEVEL = 6;
/** @const {number} Default minimum response size in bytes to trigger compression */
const DEFAULT_COMPRESSION_THRESHOLD_BYTES = 1024;
/** @const {number} Minimum valid TCP port number */
const MIN_PORT_NUMBER = 1;
/** @const {number} Maximum valid TCP port number */
const MAX_PORT_NUMBER = 65535;
/** @const {number} Minimum graceful shutdown timeout in milliseconds (1 second) */
const MIN_GRACEFUL_SHUTDOWN_TIMEOUT_MS = 1000;
/** @const {number} Minimum gzip compression level */
const MIN_COMPRESSION_LEVEL = 0;
/** @const {number} Maximum gzip compression level */
const MAX_COMPRESSION_LEVEL = 9;
/** @const {number} Minimum compression threshold (0 = compress everything) */
const MIN_COMPRESSION_THRESHOLD = 0;
/** @const {number} Minimum trust proxy value */
const MIN_TRUST_PROXY = 0;
/** @const {number} Minimum rate limit window duration in milliseconds */
const MIN_RATE_LIMIT_WINDOW_MS = 1000;
/** @const {number} Minimum maximum requests per rate limit window */
const MIN_RATE_LIMIT_MAX = 1;
/** @const {number} Minimum SSE connections allowed per IP */
const MIN_SSE_CONNECTIONS_PER_IP = 1;
/** @const {number} Minimum global SSE connection limit */
const MIN_SSE_GLOBAL_LIMIT = 1;
/** @const {number} Minimum SSE keepalive interval in milliseconds */
const MIN_SSE_KEEPALIVE_INTERVAL_MS = 1000;
/** @const {number} Minimum cache size (0 = no caching) */
const MIN_CACHE_SIZE = 0;
/** @const {number} Minimum cache TTL (0 = no expiration) */
const MIN_CACHE_TTL = 0;
/** @const {number} Minimum notification store count */
const MIN_NOTIFICATION_COUNT = 1;
/** @const {number} Minimum notification TTL in milliseconds */
const MIN_NOTIFICATION_TTL_MS = 1000;
/** @const {number} Minimum notification cleanup interval in milliseconds */
const MIN_NOTIFICATION_CLEANUP_INTERVAL_MS = 1000;
/** @const {number} Minimum required admin API key length for production security */
const MIN_ADMIN_API_KEY_LENGTH = 32;
/** @const {number} Milliseconds per second */
const MS_PER_SECOND = 1000;
/** @const {number} Seconds per minute */
const SECONDS_PER_MINUTE = 60;
/** @const {number} Minutes per hour */
const MINUTES_PER_HOUR = 60;
/** @const {number} Default maximum number of projects to warm in favicon cache */
const DEFAULT_FAVICON_CACHE_WARM_LIMIT = 20;
/** @const {number} Minimum favicon cache warm limit */
const MIN_FAVICON_CACHE_WARM_LIMIT = 1;
/** @const {number} Maximum favicon cache warm limit */
const MAX_FAVICON_CACHE_WARM_LIMIT = 100;

// ========================================
// IP Validation Functions
// ========================================

/**
 * Validate IP address format (IPv4 and IPv6)
 * QUA-002: Uses Node.js built-in net module instead of regex to prevent ReDoS
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

    // QUA-002: Use net.isIPv4() and net.isIPv6() instead of regex
    // This eliminates ReDoS risk and improves maintainability
    // net.isIPv4() and net.isIPv6() return true for valid IPs, false otherwise
    return net.isIPv4(trimmed) || net.isIPv6(trimmed);
}

/**
 * Parse and validate admin IP addresses from environment
 * @param {string} ipString - Comma-separated list of IP addresses
 * @param {Object} logger - Logger instance for warnings
 * @returns {string[]} - Array of valid IP addresses
 */
function parseAdminIPs(ipString, logger) {
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
    if (invalidIPs.length > 0 && logger) {
        logger.warn(
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
            if (logger) {
                logger.warn('No valid ADMIN_IPS configured, using defaults: 127.0.0.1, ::1');
            }
            return ['127.0.0.1', '::1'];
        }
    }

    return validIPs;
}

// ========================================
// Validation Functions
// ========================================

/**
 * Validate server configuration (ports, logging, environment)
 * @param {Object} config - Configuration object
 * @param {Array<string>} errors - Array to collect validation errors
 * @param {Object} logger - Logger instance for warnings
 */
function validateServerConfig(config, errors, logger) {
    // Validate ports
    if (config.servicePort < MIN_PORT_NUMBER || config.servicePort > MAX_PORT_NUMBER) {
        errors.push(`SERVICE_PORT must be between ${MIN_PORT_NUMBER} and ${MAX_PORT_NUMBER}`);
    }

    // Validate log level
    const validLogLevels = ['error', 'warn', 'info', 'debug'];
    if (!validLogLevels.includes(config.logLevel)) {
        errors.push(`LOG_LEVEL must be one of: ${validLogLevels.join(', ')}`);
    }

    // Validate environment (warning only, not an error)
    const validEnvironments = ['development', 'production', 'test', 'staging'];
    if (!validEnvironments.includes(config.nodeEnv)) {
        if (logger) {
            logger.warn({ nodeEnv: config.nodeEnv, validEnvironments }, 'Non-standard NODE_ENV');
        }
    }

    // Validate graceful shutdown
    if (config.gracefulShutdownTimeout < MIN_GRACEFUL_SHUTDOWN_TIMEOUT_MS) {
        errors.push(`GRACEFUL_SHUTDOWN_TIMEOUT must be at least ${MIN_GRACEFUL_SHUTDOWN_TIMEOUT_MS}ms (1 second)`);
    }

    // Validate compression configuration
    if (config.compressionLevel < MIN_COMPRESSION_LEVEL || config.compressionLevel > MAX_COMPRESSION_LEVEL) {
        errors.push(`COMPRESSION_LEVEL must be between ${MIN_COMPRESSION_LEVEL} and ${MAX_COMPRESSION_LEVEL}`);
    }
    if (config.compressionThreshold < MIN_COMPRESSION_THRESHOLD) {
        errors.push('COMPRESSION_THRESHOLD must be a positive number');
    }

    // Validate trust proxy configuration
    if (isNaN(config.trustProxy) || config.trustProxy < MIN_TRUST_PROXY) {
        errors.push('TRUST_PROXY must be a non-negative integer');
    }
}

/**
 * Validate path configuration (allowed paths, registry)
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
 * @param {Object} logger - Logger instance for warnings
 */
function validateAdminAuth(config, errors, logger) {
    // Validate admin IPs
    if (!Array.isArray(config.adminIPs) || config.adminIPs.length === 0) {
        errors.push('ADMIN_IPS must contain at least one valid IP address');
    }

    // Validate admin API key (optional, but warn if weak)
    if (config.adminApiKey !== null) {
        if (typeof config.adminApiKey !== 'string' || config.adminApiKey.trim().length === 0) {
            errors.push('ADMIN_API_KEY must be a non-empty string if provided');
        } else if (config.adminApiKey.length < MIN_ADMIN_API_KEY_LENGTH) {
            if (logger) {
                logger.warn(
                    { keyLength: config.adminApiKey.length },
                    'ADMIN_API_KEY is shorter than recommended 32 characters - consider using a stronger key'
                );
            }
        }
    }
}

/**
 * Validate rate limiting configuration
 * @param {Object} config - Configuration object
 * @param {Array<string>} errors - Array to collect validation errors
 */
function validateRateLimits(config, errors) {
    if (config.rateLimitWindow < MIN_RATE_LIMIT_WINDOW_MS) {
        errors.push(`RATE_LIMIT_WINDOW must be at least ${MIN_RATE_LIMIT_WINDOW_MS}ms (1 second)`);
    }
    if (config.rateLimitMax < MIN_RATE_LIMIT_MAX) {
        errors.push(`RATE_LIMIT_MAX must be at least ${MIN_RATE_LIMIT_MAX}`);
    }
    if (config.rateLimitNotificationWindow < MIN_RATE_LIMIT_WINDOW_MS) {
        errors.push(`RATE_LIMIT_NOTIFICATION_WINDOW must be at least ${MIN_RATE_LIMIT_WINDOW_MS}ms (1 second)`);
    }
    if (config.rateLimitNotificationMax < MIN_RATE_LIMIT_MAX) {
        errors.push(`RATE_LIMIT_NOTIFICATION_MAX must be at least ${MIN_RATE_LIMIT_MAX}`);
    }
}

/**
 * Validate SSE configuration
 * @param {Object} config - Configuration object
 * @param {Array<string>} errors - Array to collect validation errors
 */
function validateSSEConfig(config, errors) {
    if (config.sseMaxConnectionsPerIP < MIN_SSE_CONNECTIONS_PER_IP) {
        errors.push(`SSE_MAX_CONNECTIONS_PER_IP must be at least ${MIN_SSE_CONNECTIONS_PER_IP}`);
    }
    if (config.sseGlobalLimit < MIN_SSE_GLOBAL_LIMIT) {
        errors.push(`SSE_GLOBAL_LIMIT must be at least ${MIN_SSE_GLOBAL_LIMIT}`);
    }
    if (config.sseKeepaliveInterval < MIN_SSE_KEEPALIVE_INTERVAL_MS) {
        errors.push(`SSE_KEEPALIVE_INTERVAL must be at least ${MIN_SSE_KEEPALIVE_INTERVAL_MS}ms (1 second)`);
    }
}

/**
 * Validate security configuration - delegates to focused validators
 * @param {Object} config - Configuration object
 * @param {Array<string>} errors - Array to collect validation errors
 * @param {Object} logger - Logger instance for warnings
 */
function validateSecurityConfig(config, errors, logger) {
    validateAdminAuth(config, errors, logger);
    validateRateLimits(config, errors);
    validateSSEConfig(config, errors);
}

/**
 * Validate cache configuration
 * @param {Object} config - Configuration object
 * @param {Array<string>} errors - Array to collect validation errors
 */
function validateCacheConfig(config, errors) {
    if (config.cacheMaxSize < MIN_CACHE_SIZE) {
        errors.push('CACHE_MAX_SIZE must be a positive number');
    }
    if (config.cacheTtl < MIN_CACHE_TTL) {
        errors.push('CACHE_TTL must be a positive number');
    }
    if (config.faviconCacheWarmLimit < MIN_FAVICON_CACHE_WARM_LIMIT || config.faviconCacheWarmLimit > MAX_FAVICON_CACHE_WARM_LIMIT) {
        errors.push(`FAVICON_CACHE_WARM_LIMIT must be between ${MIN_FAVICON_CACHE_WARM_LIMIT} and ${MAX_FAVICON_CACHE_WARM_LIMIT}`);
    }
}

/**
 * Validate notification configuration
 * @param {Object} config - Configuration object
 * @param {Array<string>} errors - Array to collect validation errors
 */
function validateNotificationConfig(config, errors) {
    if (config.notificationMaxCount < MIN_NOTIFICATION_COUNT) {
        errors.push(`NOTIFICATION_MAX_COUNT must be at least ${MIN_NOTIFICATION_COUNT}`);
    }
    if (config.notificationTtlMs < MIN_NOTIFICATION_TTL_MS) {
        errors.push(`NOTIFICATION_TTL_MS must be at least ${MIN_NOTIFICATION_TTL_MS}ms (1 second)`);
    }
    if (config.notificationCleanupIntervalMs < MIN_NOTIFICATION_CLEANUP_INTERVAL_MS) {
        errors.push(`NOTIFICATION_CLEANUP_INTERVAL_MS must be at least ${MIN_NOTIFICATION_CLEANUP_INTERVAL_MS}ms (1 second)`);
    }
}

// ========================================
// Exports
// ========================================

module.exports = {
    // Constants
    DEFAULT_SERVICE_PORT,
    DEFAULT_TRUST_PROXY,
    DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS,
    DEFAULT_CACHE_MAX_SIZE,
    DEFAULT_CACHE_TTL_SECONDS,
    DEFAULT_REGISTRY_CACHE_TTL_MS,
    DEFAULT_RATE_LIMIT_WINDOW_MS,
    DEFAULT_RATE_LIMIT_MAX,
    DEFAULT_NOTIFICATION_RATE_LIMIT_WINDOW_MS,
    DEFAULT_NOTIFICATION_RATE_LIMIT_MAX,
    DEFAULT_NOTIFICATION_MAX_COUNT,
    DEFAULT_NOTIFICATION_TTL_MS,
    DEFAULT_NOTIFICATION_CLEANUP_INTERVAL_MS,
    DEFAULT_SSE_MAX_CONNECTIONS_PER_IP,
    DEFAULT_SSE_GLOBAL_LIMIT,
    DEFAULT_SSE_KEEPALIVE_INTERVAL_MS,
    DEFAULT_COMPRESSION_LEVEL,
    DEFAULT_COMPRESSION_THRESHOLD_BYTES,
    DEFAULT_FAVICON_CACHE_WARM_LIMIT,
    MIN_PORT_NUMBER,
    MAX_PORT_NUMBER,
    MIN_GRACEFUL_SHUTDOWN_TIMEOUT_MS,
    MIN_COMPRESSION_LEVEL,
    MAX_COMPRESSION_LEVEL,
    MIN_COMPRESSION_THRESHOLD,
    MIN_TRUST_PROXY,
    MIN_RATE_LIMIT_WINDOW_MS,
    MIN_RATE_LIMIT_MAX,
    MIN_SSE_CONNECTIONS_PER_IP,
    MIN_SSE_GLOBAL_LIMIT,
    MIN_SSE_KEEPALIVE_INTERVAL_MS,
    MIN_CACHE_SIZE,
    MIN_CACHE_TTL,
    MIN_NOTIFICATION_COUNT,
    MIN_NOTIFICATION_TTL_MS,
    MIN_NOTIFICATION_CLEANUP_INTERVAL_MS,
    MIN_ADMIN_API_KEY_LENGTH,
    MIN_FAVICON_CACHE_WARM_LIMIT,
    MAX_FAVICON_CACHE_WARM_LIMIT,
    MS_PER_SECOND,
    SECONDS_PER_MINUTE,
    MINUTES_PER_HOUR,

    // Validation Functions
    isValidIP,
    parseAdminIPs,
    validateServerConfig,
    validatePathConfig,
    validateAdminAuth,
    validateRateLimits,
    validateSSEConfig,
    validateSecurityConfig,
    validateCacheConfig,
    validateNotificationConfig,
};
