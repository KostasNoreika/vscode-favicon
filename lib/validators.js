/**
 * Input Validation Module
 *
 * IMPORTANT: This module provides input validation with two approaches:
 * 1. NEW: Basic validators (validateFolder, validateNotificationBody) for use with requireValidPath middleware
 * 2. DEPRECATED: Full validators with path security checks for backward compatibility
 *
 * Protects against:
 * - Injection attacks
 * - DoS via oversized payloads
 * - Type confusion
 * - Invalid data formats
 *
 * MIGRATION NOTE: New endpoints should use requireValidPath middleware for path validation
 * and validateNotificationBody for body field validation to avoid duplicate validation.
 */

const { body, query, validationResult } = require('express-validator');
const { isPathAllowedAsync } = require('./path-validator');
const logger = require('./logger');

/**
 * Basic folder parameter validation (type and format only)
 * Does NOT perform path security validation - use requireValidPath middleware for that
 *
 * RECOMMENDED USAGE: Use with requireValidPath middleware
 * Example: app.get('/endpoint', requireValidPath, handler)
 */
const validateFolderBasic = [
    query('folder')
        .exists()
        .withMessage('folder parameter required')
        .isString()
        .withMessage('folder must be a string')
        .trim()
        .notEmpty()
        .withMessage('folder cannot be empty'),
];

/**
 * Validate notification POST body fields only (message, timestamp)
 * Does NOT validate folder path - use requireValidPath middleware for that
 *
 * RECOMMENDED USAGE: Use with requireValidPath middleware
 * Example: app.post('/endpoint', validateNotificationBody, handleValidationErrors, requireValidPath, handler)
 */
const validateNotificationBody = [
    body('message')
        .optional()
        .isString()
        .withMessage('message must be a string')
        .trim()
        .isLength({ max: 500 })
        .withMessage('message must be 500 characters or less')
        .matches(/^[\w\s\-.,!?:;()]+$/)
        .withMessage('message contains invalid characters'),
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
];

// =============================================================================
// DEPRECATED VALIDATORS - Kept for backward compatibility with existing tests
// New code should use requireValidPath middleware + validateNotificationBody
// =============================================================================

/**
 * DEPRECATED: Use requireValidPath middleware instead
 *
 * Validate folder query parameter with full path security checks
 * Kept for backward compatibility with existing tests and integrations
 *
 * PERFORMANCE WARNING: This performs expensive async path validation
 * which duplicates work if used with requireValidPath middleware
 */
const validateFolder = [
    query('folder')
        .exists()
        .withMessage('folder parameter required')
        .isString()
        .withMessage('folder must be a string')
        .trim()
        .notEmpty()
        .withMessage('folder cannot be empty')
        .custom(async (value) => {
            if (!(await isPathAllowedAsync(value))) {
                throw new Error('Invalid or unauthorized folder path');
            }
            return true;
        }),
];

/**
 * DEPRECATED: Use validateNotificationBody + requireValidPath instead
 *
 * Validate notification POST body with full path security checks
 * Kept for backward compatibility with existing tests
 *
 * PERFORMANCE WARNING: This performs expensive async path validation
 */
const validateNotification = [
    body('folder')
        .exists()
        .withMessage('folder required')
        .isString()
        .withMessage('folder must be a string')
        .trim()
        .notEmpty()
        .withMessage('folder cannot be empty')
        .custom(async (value) => {
            if (!(await isPathAllowedAsync(value))) {
                throw new Error('Invalid or unauthorized folder path');
            }
            return true;
        }),
    ...validateNotificationBody,
];

/**
 * DEPRECATED: Use requireValidPath middleware instead
 *
 * Validate mark-read POST body with full path security checks
 * Kept for backward compatibility with existing tests
 */
const validateMarkRead = [
    body('folder')
        .exists()
        .withMessage('folder required')
        .isString()
        .withMessage('folder must be a string')
        .trim()
        .notEmpty()
        .withMessage('folder cannot be empty')
        .custom(async (value) => {
            if (!(await isPathAllowedAsync(value))) {
                throw new Error('Invalid or unauthorized folder path');
            }
            return true;
        }),
];

/**
 * DEPRECATED: Use requireValidPath middleware instead
 *
 * Validate delete request body with full path security checks
 * Kept for backward compatibility with existing tests
 */
const validateDelete = [
    body('folder')
        .exists()
        .withMessage('folder required')
        .isString()
        .withMessage('folder must be a string')
        .trim()
        .notEmpty()
        .withMessage('folder cannot be empty')
        .custom(async (value) => {
            if (!(await isPathAllowedAsync(value))) {
                throw new Error('Invalid or unauthorized folder path');
            }
            return true;
        }),
];

/**
 * Middleware to handle validation errors
 * Returns 400 with detailed error information
 *
 * Note: express-validator v7+ uses e.path instead of e.param
 */
function handleValidationErrors(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        // Log security-relevant validation failures
        const logData = {
            path: req.path,
            method: req.method,
            // express-validator v7+ uses e.path (not e.param)
            errors: errors.array().map((e) => ({ field: e.path || e.param, message: e.msg })),
            ip: req.ip,
            security: 'input-validation',
        };

        // Use req.log if available (from request logger), otherwise use global logger
        const log = req.log || logger;
        log.warn(logData, 'Input validation failed');

        return res.status(400).json({
            error: 'Validation failed',
            details: errors.array().map((e) => ({
                field: e.path || e.param, // express-validator v7+ uses e.path
                message: e.msg,
                value: e.value,
            })),
        });
    }
    next();
}

module.exports = {
    // RECOMMENDED: Use these with requireValidPath middleware to avoid duplicate validation
    validateFolderBasic,
    validateNotificationBody,
    handleValidationErrors,

    // DEPRECATED: These perform full path validation internally (expensive)
    // Use requireValidPath middleware instead for new code
    // Kept for backward compatibility with tests
    validateFolder,
    validateNotification,
    validateMarkRead,
    validateDelete,
};
