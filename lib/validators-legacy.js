/**
 * REF-011: Legacy Input Validators (DEPRECATED)
 *
 * These validators perform full path security validation internally,
 * which duplicates work if used with requireValidPath middleware.
 *
 * MIGRATION: New code should use requireValidPath middleware + validateNotificationBody
 * These are kept ONLY for backward compatibility with existing tests.
 *
 * DO NOT use these validators in new endpoints.
 */

const { body, query } = require('express-validator');
const { isPathAllowedAsync } = require('./path-validator');

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

module.exports = {
    validateFolder,
    validateNotification,
    validateMarkRead,
    validateDelete,
};
