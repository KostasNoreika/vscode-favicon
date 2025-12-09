/**
 * Input Validation Module
 *
 * This module provides validators for use with requireValidPath middleware:
 * - validateFolderBasic: Basic folder parameter validation (type and format only)
 * - validateGrayscale: Grayscale query parameter validation
 * - validateNotificationBody: Notification body fields validation (message, timestamp)
 *
 * Protects against:
 * - Injection attacks
 * - DoS via oversized payloads
 * - Type confusion
 * - Invalid data formats
 *
 * RECOMMENDED USAGE: Use requireValidPath middleware for path validation
 * and these validators for other input validation to avoid duplicate validation.
 */

const { body, query, validationResult } = require('express-validator');
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
    validateFolderBasic,
    validateGrayscale,
    validateNotificationBody,
    handleValidationErrors,
};
