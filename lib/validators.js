/**
 * Input Validation Module
 *
 * This module provides validators for use with requireValidPath middleware:
 * - validateGrayscale: Grayscale query parameter validation
 * - validateNotificationBody: Notification body fields validation (message, timestamp, metadata)
 *
 * Protects against:
 * - Injection attacks
 * - DoS via oversized payloads
 * - Type confusion
 * - Invalid data formats
 * - Storage bloat from deeply nested objects
 *
 * RECOMMENDED USAGE: Use requireValidPath middleware for path validation
 * and these validators for other input validation to avoid duplicate validation.
 */

const { body, query, validationResult } = require('express-validator');
const logger = require('./logger');
const config = require('./config');

// Import metadata validation constants from config for environment-based tuning
const MAX_METADATA_SIZE = config.maxMetadataSizeBytes;
const MAX_NESTING_DEPTH = config.maxMetadataNestingDepth;
const ALLOWED_METADATA_KEYS = config.allowedMetadataKeys;

/**
 * FIX QUA-008: Check if value is a plain object (not array, null, or other types)
 * Prevents storage bloat from arrays and other non-object types
 *
 * @param {*} value - Value to check
 * @returns {boolean} True if plain object, false otherwise
 */
function isPlainObject(value) {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    // Reject arrays
    if (Array.isArray(value)) {
        return false;
    }

    // Check if it's a plain object (not Date, RegExp, etc.)
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

/**
 * FIX QUA-008: Calculate nesting depth of an object
 * Prevents deeply nested objects that could cause performance issues
 *
 * @param {Object} obj - Object to check
 * @param {number} currentDepth - Current depth level (default 0)
 * @returns {number} Maximum nesting depth
 */
function getObjectDepth(obj, currentDepth = 0) {
    if (!isPlainObject(obj)) {
        return currentDepth;
    }

    let maxDepth = currentDepth;

    for (const key in obj) {
        // eslint-disable-next-line security/detect-object-injection
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            // eslint-disable-next-line security/detect-object-injection
            const value = obj[key];
            if (isPlainObject(value)) {
                const depth = getObjectDepth(value, currentDepth + 1);
                maxDepth = Math.max(maxDepth, depth);
            }
        }
    }

    return maxDepth;
}

/**
 * FIX QUA-012: Validate grayscale query parameter
 * Ensures only valid boolean-like values are accepted
 *
 * USAGE: Apply to favicon endpoints that support grayscale option
 * Example: app.get('/api/favicon', validateGrayscale, requireValidPath, handler)
 */
const validateGrayscale = [
    query('grayscale')
        .optional()
        .isString()
        .withMessage('grayscale must be a string')
        .isIn(['true', 'false', '1', '0'])
        .withMessage('grayscale must be "true", "false", "1", or "0"'),
];

/**
 * Validate notification POST body fields (message, timestamp, metadata)
 * Does NOT validate folder path - use requireValidPath middleware for that
 *
 * RECOMMENDED USAGE: Use with requireValidPath middleware
 * Example: app.post('/endpoint', validateNotificationBody, handleValidationErrors, requireValidPath, handler)
 */
const validateNotificationBody = [
    body('message')
        .optional({ values: 'undefined' }) // Only skip if truly undefined, not empty string
        .isString()
        .withMessage('message must be a string')
        .trim()
        .notEmpty()
        .withMessage('message cannot be empty')
        .isLength({ max: 500 })
        .withMessage('message must be 500 characters or less')
        .custom((value) => {
            // FIX SEC-011: Replace regex with character-by-character validation
            // to prevent ReDoS attacks. This has O(n) time complexity with no backtracking.
            // Allowed: alphanumeric, underscore, whitespace, and punctuation: -.,!?:;()

            const allowedPattern = /^[a-zA-Z0-9_\s\-.,!?:;()]$/;

            // SECURITY: Iterate through value string character by character
            // This prevents ReDoS attacks and has O(n) time complexity
            // eslint-disable-next-line security/detect-object-injection
            for (let i = 0; i < value.length; i++) {
                // eslint-disable-next-line security/detect-object-injection
                if (!allowedPattern.test(value[i])) {
                    throw new Error('message contains invalid characters');
                }
            }
            return true;
        }),
    body('timestamp')
        .optional()
        .isNumeric()
        .withMessage('timestamp must be a number')
        .isInt({ min: 0 })
        .withMessage('timestamp must be a positive integer')
        .custom((value) => {
            // Validate timestamp is reasonable (not in far future)
            const now = Date.now();
            const maxFuture = now + 24 * 60 * 60 * 1000; // 24 hours in future
            const minPast = now - 365 * 24 * 60 * 60 * 1000; // 1 year in past

            if (value > maxFuture || value < minPast) {
                throw new Error('timestamp outside valid range');
            }
            return true;
        }),
    // FIX QUA-008: Add metadata validation to prevent storage bloat
    body('metadata')
        .optional({ values: 'null' }) // Allow null or undefined
        .custom((value) => {
            // Allow null explicitly (optional field)
            if (value === null) {
                return true;
            }

            // Validate it's a plain object (not array, Date, etc.)
            if (!isPlainObject(value)) {
                throw new Error('metadata must be a plain object');
            }

            // Validate serialized size (prevent storage bloat)
            const serialized = JSON.stringify(value);
            if (serialized.length > MAX_METADATA_SIZE) {
                throw new Error(`metadata exceeds maximum size of ${MAX_METADATA_SIZE} bytes (got ${serialized.length} bytes)`);
            }

            // Validate nesting depth (prevent deeply nested objects)
            const depth = getObjectDepth(value);
            if (depth > MAX_NESTING_DEPTH) {
                throw new Error(`metadata nesting depth exceeds maximum of ${MAX_NESTING_DEPTH} levels (got ${depth} levels)`);
            }

            // Optional: Validate allowed keys (whitelist approach)
            // This is more strict - only enable if you want to enforce a schema
            const keys = Object.keys(value);
            const invalidKeys = keys.filter(key => !ALLOWED_METADATA_KEYS.includes(key));
            if (invalidKeys.length > 0) {
                throw new Error(`metadata contains invalid keys: ${invalidKeys.join(', ')}. Allowed keys: ${ALLOWED_METADATA_KEYS.join(', ')}`);
            }

            return true;
        }),
];

/**
 * Middleware to handle validation errors
 * Returns 400 with detailed error information
 *
 * SECURITY FIX SEC-008: Remove sensitive input values from validation responses in production
 * - Production: Error responses exclude raw input values to prevent information disclosure
 * - Development: Error responses include values for debugging
 * - All environments: Server logs always contain full details for debugging
 *
 * Note: express-validator v7+ uses e.path instead of e.param
 */
function handleValidationErrors(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        const errorArray = errors.array();

        // Log security-relevant validation failures with FULL details (including values)
        // Server logs should always contain complete information for debugging
        const logData = {
            path: req.path,
            method: req.method,
            // express-validator v7+ uses e.path (not e.param)
            errors: errorArray.map((e) => ({
                field: e.path || e.param,
                message: e.msg,
                value: e.value, // Always log the value for debugging
            })),
            ip: req.ip,
            security: 'input-validation',
        };

        // Use req.log if available (from request logger), otherwise use global logger
        const log = req.log || logger;
        log.warn(logData, 'Input validation failed');

        // Determine if we should include values in the response
        const isProduction = config.nodeEnv === 'production';

        // Build error response details based on environment
        const responseDetails = errorArray.map((e) => {
            const detail = {
                field: e.path || e.param, // express-validator v7+ uses e.path
                message: e.msg,
            };

            // SEC-008: Only include value in development mode
            // In production, omit values to prevent information disclosure
            if (!isProduction) {
                detail.value = e.value;
            }

            return detail;
        });

        return res.status(400).json({
            error: 'Validation failed',
            details: responseDetails,
        });
    }
    next();
}

module.exports = {
    validateGrayscale,
    validateNotificationBody,
    handleValidationErrors,
    // Export helper functions for testing
    isPlainObject,
    getObjectDepth,
};
