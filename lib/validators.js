/**
 * Input Validation Module
 *
 * Protects against:
 * - Injection attacks
 * - DoS via oversized payloads
 * - Type confusion
 * - Invalid data formats
 */

const { body, query, validationResult } = require('express-validator');
const { isPathAllowed } = require('./path-validator');
const logger = require('./logger');

/**
 * Validate folder query parameter
 * Uses path-validator for comprehensive security
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
        .custom((value) => {
            if (!isPathAllowed(value)) {
                throw new Error('Invalid or unauthorized folder path');
            }
            return true;
        }),
];

/**
 * Validate notification POST body
 * Limits message size and validates timestamp
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
        .custom((value) => {
            if (!isPathAllowed(value)) {
                throw new Error('Invalid or unauthorized folder path');
            }
            return true;
        }),
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
 * Validate mark-read POST body
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
        .custom((value) => {
            if (!isPathAllowed(value)) {
                throw new Error('Invalid or unauthorized folder path');
            }
            return true;
        }),
];

/**
 * Validate delete request body
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
        .custom((value) => {
            if (!isPathAllowed(value)) {
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
    validateFolder,
    validateNotification,
    validateMarkRead,
    validateDelete,
    handleValidationErrors,
};
