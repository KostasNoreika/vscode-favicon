/**
 * Custom Error Classes
 *
 * Provides typed errors for better error handling and appropriate HTTP status codes.
 * Each error class maps to a specific HTTP status code:
 * - FileNotFoundError: 404 Not Found
 * - PermissionError: 403 Forbidden
 * - ValidationError: 400 Bad Request
 */

/**
 * FileNotFoundError - Resource not found (404)
 * Used when a requested file or resource does not exist
 */
class FileNotFoundError extends Error {
    constructor(message = 'File not found', details = {}) {
        super(message);
        this.name = 'FileNotFoundError';
        this.statusCode = 404;
        this.details = details;
        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * PermissionError - Access forbidden (403)
 * Used when access is denied due to permissions or security constraints
 */
class PermissionError extends Error {
    constructor(message = 'Permission denied', details = {}) {
        super(message);
        this.name = 'PermissionError';
        this.statusCode = 403;
        this.details = details;
        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * ValidationError - Invalid input (400)
 * Used when input validation fails
 */
class ValidationError extends Error {
    constructor(message = 'Validation failed', details = {}) {
        super(message);
        this.name = 'ValidationError';
        this.statusCode = 400;
        this.details = details;
        Error.captureStackTrace(this, this.constructor);
    }
}

module.exports = {
    FileNotFoundError,
    PermissionError,
    ValidationError,
};
