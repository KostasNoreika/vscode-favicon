/**
 * Security Middleware Module
 * Centralized configuration for security-related middleware
 *
 * Exports security middleware functions for:
 * - Trust Proxy Configuration (IP spoofing prevention)
 * - Proxy Header Validation (SEC-002 fix)
 * - Helmet Security Headers
 * - CORS Policy
 * - CSRF Protection (SEC-007 fix)
 * - Admin Authentication (SEC-001 fix)
 */

const crypto = require('crypto');
const helmet = require('helmet');
const { corsMiddleware } = require('../cors-config');
const config = require('../config');
const logger = require('../logger');

/**
 * SECURITY: Constant-time string comparison to prevent timing attacks
 *
 * This function compares two strings in constant time, preventing attackers
 * from using timing differences to guess API keys character by character.
 *
 * @param {string} a - First string to compare
 * @param {string} b - Second string to compare
 * @returns {boolean} True if strings are equal
 */
function secureCompare(a, b) {
    if (!a || !b) return false;

    // Convert strings to buffers for crypto.timingSafeEqual
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));

    // Ensure same length to prevent timing leaks
    if (bufA.length !== bufB.length) {
        // Still do a comparison to maintain constant time
        crypto.timingSafeEqual(bufA, bufA);
        return false;
    }

    return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * SECURITY FIX SEC-002: Validate IP address format (IPv4 and IPv6)
 *
 * This function validates that an IP address string is in a valid format.
 * Used by proxy validation to detect malformed IPs in X-Forwarded-For headers.
 *
 * @param {string} ip - IP address to validate
 * @returns {boolean} True if valid IP format
 */
function isValidIPFormat(ip) {
    if (!ip || typeof ip !== 'string') {
        return false;
    }

    const trimmed = ip.trim();
    if (trimmed.length === 0) {
        return false;
    }

    // IPv4 validation: 0-255.0-255.0-255.0-255
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (ipv4Regex.test(trimmed)) {
        // Validate each octet is 0-255
        const octets = trimmed.split('.');
        return octets.every(octet => {
            const num = parseInt(octet, 10);
            return num >= 0 && num <= 255;
        });
    }

    // IPv6 validation (simplified - accepts most common formats)
    // Covers: ::1, fe80::1, 2001:db8::1, ::ffff:192.168.1.1, etc.
    const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
    if (ipv6Regex.test(trimmed) || trimmed === '::1' || trimmed.startsWith('::ffff:')) {
        return true;
    }

    return false;
}

/**
 * SECURITY FIX SEC-002: Validate if an IP is a trusted proxy
 *
 * This function checks if a given IP address is in the list of trusted proxy IPs.
 * Used by the trust proxy callback to validate the proxy chain.
 *
 * @param {string} ip - IP address to validate
 * @param {string[]} trustedProxies - Array of trusted proxy IP addresses
 * @returns {boolean} True if IP is trusted
 */
function isTrustedProxy(ip, trustedProxies) {
    if (!ip || !trustedProxies || trustedProxies.length === 0) {
        return false;
    }

    // Direct match (most common case)
    if (trustedProxies.includes(ip)) {
        return true;
    }

    // Normalize IPv6 localhost variations
    // Handle ::1, ::ffff:127.0.0.1, etc.
    const normalizedIP = ip.toLowerCase();
    const isLocalhost =
        normalizedIP === '::1' ||
        normalizedIP === '::ffff:127.0.0.1' ||
        ip === '127.0.0.1';

    if (isLocalhost && (trustedProxies.includes('127.0.0.1') || trustedProxies.includes('::1'))) {
        return true;
    }

    return false;
}

/**
 * SECURITY FIX SEC-002: Create trust proxy callback function
 *
 * This function creates a callback for Express trust proxy that validates
 * each proxy in the chain against a whitelist of known proxy IPs.
 *
 * Benefits over numeric trust proxy:
 * - Only trusts explicitly configured proxy IPs
 * - Prevents IP spoofing from untrusted sources
 * - Logs rejected proxy IPs for security monitoring
 *
 * @param {string[]} trustedProxies - Array of trusted proxy IP addresses
 * @returns {Function} Trust proxy callback function
 */
function createTrustProxyCallback(trustedProxies) {
    return (ip, hopIndex) => {
        const isTrusted = isTrustedProxy(ip, trustedProxies);

        // Log proxy validation for security monitoring (debug level)
        logger.debug({
            proxyIP: ip,
            hopIndex,
            trusted: isTrusted,
        }, 'Trust proxy validation');

        // Log warning for rejected proxies (potential spoofing attempt)
        if (!isTrusted) {
            logger.warn({
                proxyIP: ip,
                hopIndex,
                trustedProxies,
            }, 'Untrusted proxy IP rejected - potential IP spoofing attempt');
        }

        return isTrusted;
    };
}

/**
 * SECURITY FIX SEC-002: Configure trust proxy settings for accurate client IP detection
 *
 * This function configures Express trust proxy to prevent IP spoofing attacks.
 * Three configuration modes are supported:
 *
 * 1. TRUSTED_PROXIES (recommended): Explicit list of trusted proxy IPs
 *    - Example: TRUSTED_PROXIES=127.0.0.1,::1,192.168.1.100
 *    - Most secure: only trusts known proxy IPs via callback validation
 *    - Logs rejected proxies for security monitoring
 *
 * 2. TRUST_PROXY with numeric value (legacy):
 *    - 0 or false: Do not trust any proxies (use direct connection IP)
 *    - 1: Trust first proxy (single proxy setup)
 *    - N: Trust N proxies in chain
 *    - Less secure: vulnerable to spoofing if misconfigured
 *
 * 3. No configuration: Defaults to localhost proxies only (127.0.0.1, ::1)
 *    - Safe default for development
 *    - Production requires explicit configuration
 *
 * @param {Object} app - Express application instance
 */
function setupTrustProxy(app) {
    // SEC-002: Prefer TRUSTED_PROXIES over numeric TRUST_PROXY for security
    if (config.trustedProxies && config.trustedProxies.length > 0) {
        // RECOMMENDED: Use explicit proxy IP whitelist with callback validation
        const trustCallback = createTrustProxyCallback(config.trustedProxies);
        app.set('trust proxy', trustCallback);

        logger.info({
            trustedProxies: config.trustedProxies,
            mode: 'callback',
        }, 'Trust proxy configured with explicit IP whitelist (SEC-002 fix)');
    } else {
        // LEGACY: Use numeric trust proxy setting (less secure)
        // Retained for backward compatibility but should migrate to TRUSTED_PROXIES
        app.set('trust proxy', config.trustProxy);

        logger.warn({
            trustProxy: config.trustProxy,
            mode: 'numeric',
            recommendation: 'Set TRUSTED_PROXIES environment variable for better security',
            risk: 'Numeric trust proxy is vulnerable to IP spoofing if misconfigured',
        }, 'Trust proxy configured with numeric value (legacy mode)');
    }
}

/**
 * SECURITY FIX SEC-002: Proxy header validation middleware
 *
 * Validates proxy-related headers and logs suspicious patterns that may
 * indicate IP spoofing attempts. This middleware should be applied early
 * in the middleware chain (after trust proxy configuration).
 *
 * Detects:
 * - Suspicious X-Forwarded-For chains (too many hops)
 * - Invalid IP addresses in X-Forwarded-For
 * - Conflicting proxy headers (X-Real-IP vs X-Forwarded-For)
 *
 * @returns {Function} Express middleware function
 */
function createProxyHeaderValidator() {
    const MAX_PROXY_HOPS = 5; // Reasonable limit for proxy chain length

    return (req, res, next) => {
        const xForwardedFor = req.headers['x-forwarded-for'];
        const xRealIP = req.headers['x-real-ip'];
        const xClientIP = req.headers['x-client-ip'];

        // Extract client IP as determined by Express (after trust proxy processing)
        const clientIP = req.ip || req.connection?.remoteAddress || 'unknown';

        // Log all proxy-related headers for monitoring (debug level for normal requests)
        req.log.debug({
            clientIP,
            xForwardedFor,
            xRealIP,
            xClientIP,
            remoteAddress: req.connection?.remoteAddress,
        }, 'Client IP detection');

        // Validate X-Forwarded-For if present
        if (xForwardedFor) {
            const forwardedIPs = xForwardedFor.split(',').map(ip => ip.trim());

            // Check for suspicious proxy chain length
            if (forwardedIPs.length > MAX_PROXY_HOPS) {
                req.log.warn({
                    xForwardedFor,
                    hopCount: forwardedIPs.length,
                    maxHops: MAX_PROXY_HOPS,
                    clientIP,
                }, 'Suspicious X-Forwarded-For chain detected (too many hops) - potential IP spoofing');
            }

            // Validate IP format for each hop
            const invalidIPs = forwardedIPs.filter(ip => !isValidIPFormat(ip));
            if (invalidIPs.length > 0) {
                req.log.warn({
                    invalidIPs,
                    xForwardedFor,
                    clientIP,
                }, 'Invalid IP addresses in X-Forwarded-For header - potential IP spoofing');
            }
        }

        // Check for conflicting proxy headers
        if (xRealIP && xForwardedFor) {
            const forwardedIPs = xForwardedFor.split(',').map(ip => ip.trim());
            const firstForwarded = forwardedIPs[0];

            if (xRealIP !== firstForwarded && xRealIP !== clientIP) {
                req.log.warn({
                    xRealIP,
                    xForwardedFor,
                    clientIP,
                }, 'Conflicting proxy headers detected (X-Real-IP != X-Forwarded-For)');
            }
        }

        next();
    };
}

/**
 * Configure Helmet security headers
 *
 * @returns {Function} Helmet middleware
 */
function setupHelmet() {
    // SECURITY: Helmet security headers
    return helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"], // Required for SVG inline styles
                scriptSrc: ["'self'"],
                imgSrc: ["'self'", 'data:'], // Allow data: URIs for favicons
                objectSrc: ["'none'"],
                upgradeInsecureRequests: [],
            },
        },
        crossOriginEmbedderPolicy: false, // Allow embedding favicons
        crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow favicons to be loaded from vs.noreika.lt
        hsts: {
            maxAge: 31536000, // 1 year
            includeSubDomains: true,
            preload: true,
        },
        frameguard: { action: 'deny' },
        noSniff: true,
        xssFilter: true,
    });
}

/**
 * Configure CORS middleware
 *
 * @returns {Function} CORS middleware
 */
function setupCORS() {
    // SECURITY: Strict CORS policy with origin whitelist validation
    // IMPORTANT: Must be BEFORE rate limiters so 429 responses include CORS headers
    return corsMiddleware;
}

/**
 * Create CSRF protection middleware for state-changing operations
 *
 * SECURITY FIX SEC-007: CSRF protection via custom header requirement
 *
 * Browsers cannot set custom headers via HTML forms (cross-origin), making this
 * an effective CSRF mitigation. Only legitimate JavaScript clients (extension, API)
 * can add the required header.
 *
 * Defense mechanism:
 * - Requires X-Requested-With header on POST/DELETE/PUT/PATCH requests
 * - Header value must be non-empty (commonly set to 'XMLHttpRequest')
 * - Blocks form-based CSRF attacks (forms cannot set custom headers)
 * - Works in conjunction with CORS policy (defense-in-depth)
 *
 * Compatibility:
 * - Browser extension: Must add header to all state-changing requests
 * - API clients: Must add header to POST/DELETE/PUT/PATCH requests
 * - Safe methods (GET, HEAD, OPTIONS): Not protected (idempotent by design)
 *
 * @returns {Function} CSRF protection middleware
 */
function createCSRFProtection() {
    return (req, res, next) => {
        // Only protect state-changing methods
        const protectedMethods = ['POST', 'DELETE', 'PUT', 'PATCH'];

        if (!protectedMethods.includes(req.method)) {
            // Safe methods (GET, HEAD, OPTIONS) don't need CSRF protection
            return next();
        }

        // Check for X-Requested-With header
        const requestedWith = req.headers['x-requested-with'];

        if (!requestedWith || requestedWith.trim() === '') {
            // Log CSRF attempt
            logger.warn(
                {
                    ip: req.ip,
                    method: req.method,
                    path: req.path,
                    origin: req.headers.origin,
                    referer: req.headers.referer,
                },
                'CSRF protection: blocked request without X-Requested-With header'
            );

            return res.status(403).json({
                error: 'Forbidden',
                message: 'Missing required header',
            });
        }

        // Header present, allow request through
        next();
    };
}

/**
 * Create admin authentication middleware
 *
 * @returns {Function} Admin authentication middleware
 */
function createAdminAuth() {
    // SECURITY: Admin authentication middleware for cache clear endpoint
    // FIX SEC-001: Enhanced with API key authentication
    return (req, res, next) => {
        // Get allowed IPs from validated config (centralized in lib/config.js)
        const allowedIPs = config.adminIPs;

        // Extract client IP with fallback
        const clientIP = req.ip || req.connection?.remoteAddress || 'unknown';

        // SECURITY: Reject if client IP cannot be determined
        if (clientIP === 'unknown') {
            req.log.error('Unable to determine client IP for admin authentication');
            return res.status(403).json({ error: 'Forbidden' });
        }

        // SECURITY FIX SEC-001: API key authentication with constant-time comparison
        // If adminApiKey is configured, require BOTH IP whitelist AND API key
        if (config.adminApiKey) {
            // Extract API key from headers (supports X-API-Key and Authorization: Bearer)
            const apiKeyHeader = req.headers['x-api-key'];
            const authHeader = req.headers['authorization'];
            const providedKey = apiKeyHeader ||
                (authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null);

            // SECURITY: Use constant-time comparison to prevent timing attacks
            // This prevents attackers from guessing the API key character by character
            // by measuring response times
            if (!providedKey || !secureCompare(providedKey, config.adminApiKey)) {
                req.log.warn(
                    {
                        ip: clientIP,
                        hasApiKey: !!providedKey,
                        headerUsed: req.headers['x-api-key'] ? 'X-API-Key' :
                                   (req.headers['authorization'] ? 'Authorization' : 'none')
                    },
                    'Admin authentication failed: invalid or missing API key'
                );
                return res.status(403).json({ error: 'Forbidden' });
            }

            req.log.debug({ ip: clientIP }, 'API key validation successful');
        }

        // Check if client IP is in the allowed list
        if (!allowedIPs.includes(clientIP)) {
            req.log.warn({ ip: clientIP, allowedIPs }, 'Unauthorized cache clear attempt');
            return res.status(403).json({ error: 'Forbidden' });
        }

        next();
    };
}

module.exports = {
    setupTrustProxy,
    createProxyHeaderValidator,
    setupHelmet,
    setupCORS,
    createCSRFProtection,
    createAdminAuth,
};
