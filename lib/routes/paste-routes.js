/**
 * Paste Routes Module
 * Routes for handling clipboard file uploads from browser extension
 *
 * Endpoints:
 * - POST /api/paste-image - Upload clipboard file to project tasks/files directory
 *
 * Supported file types:
 * - Images: PNG, JPEG, WebP, GIF
 * - Documents: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX
 * - Text: TXT, MD, CSV, JSON
 *
 * SECURITY:
 * - Path validation via requireValidPath middleware
 * - Symlink detection to prevent directory traversal (SEC-012)
 * - MIME type validation (Content-Type header check)
 * - Magic byte validation (actual file content verification)
 * - File size limit (10MB max)
 * - Rate limiting (100 req/min per IP)
 * - Generic error messages to prevent information disclosure
 *
 * REF: QUA-001 - Refactored to extract validation logic to lib/services/file-validator.js
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const logger = require('../logger');
const { sendError, ErrorCodes } = require('../response-helpers');
const { retryFileOperation, RETRYABLE_FS_ERRORS } = require('../utils/file-operations');
const {
    ALLOWED_MIME_TYPES,
    validateFileContent,
    generateTimestampedFilename,
    validateUploadDestination,
} = require('../services/file-validator');

/**
 * Transient filesystem error codes that should be retried
 * Re-exported from shared utility for backward compatibility
 * @deprecated Import from '../utils/file-operations' directly
 */
const RETRYABLE_ERROR_CODES = RETRYABLE_FS_ERRORS;

/**
 * Retry configuration for transient filesystem errors
 * @deprecated Use options parameter in retryFileOperation directly
 */
const RETRY_CONFIG = {
    maxRetries: 3,              // Maximum number of retry attempts
    initialDelayMs: 100,        // Initial retry delay in milliseconds
    backoffMultiplier: 2,       // Exponential backoff multiplier
};

/**
 * Retry wrapper for filesystem operations that may encounter transient errors
 * Delegates to shared utility lib/utils/file-operations.js
 *
 * @param {Function} operation - Async function to execute
 * @param {string} operationName - Name of operation for logging
 * @param {Object} options - Retry configuration options
 * @returns {Promise<any>} Result of the operation
 * @throws {Error} Non-retryable errors or after max retries exhausted
 */
async function retryTransientErrors(operation, operationName, options = RETRY_CONFIG) {
    return retryFileOperation(operation, {
        ...options,
        operationName,
    });
}

/**
 * Configure multer for memory storage
 * Files are stored in memory before validation and manual disk write
 * This provides better control over file naming and security
 */
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB max file size
        files: 1, // Only accept 1 file per request
    },
    fileFilter: (req, file, cb) => {
        // SECURITY: Validate MIME type at upload time (first defense layer)
        // NOTE: This only validates the Content-Type header
        // Magic byte validation happens after upload for binary files
        if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
            cb(null, true);
        } else {
            // Reject file with unsupported MIME type
            logger.warn(
                { mimetype: file.mimetype },
                'Invalid MIME type rejected'
            );
            cb(new Error('INVALID_MIME_TYPE'));
        }
    },
});

/**
 * Create paste routes with dependencies
 *
 * FIX QUA-012: Standardized error responses using sendError helper
 * REF QUA-001: Validation logic extracted to file-validator service
 *
 * @param {Function} requireValidPath - Path validation middleware
 * @param {Function} rateLimiter - Rate limiting middleware (10 req/min)
 * @returns {Object} Express router with paste routes
 */
function createPasteRoutes(requireValidPath, rateLimiter) {
    /**
     * POST /api/paste-image
     * Upload clipboard image to project tasks directory
     *
     * Request:
     * - Content-Type: multipart/form-data
     * - Body fields:
     *   - folder: Project folder path (validated)
     *   - image: Image file (png/jpeg/webp, max 10MB)
     *
     * Response:
     * - 200: { success: true, filename: "img-2025-12-09-123456-789.png" }
     * - 400: { error: true, code: "MISSING_PARAMETER", message: "Missing required fields" }
     * - 403: { error: true, code: "ACCESS_DENIED", message: "Access denied" }
     * - 413: { error: true, code: "FILE_TOO_LARGE", message: "File too large" }
     * - 415: { error: true, code: "INVALID_FILE_TYPE", message: "Invalid file type" }
     * - 500: { error: true, code: "INTERNAL_ERROR", message: "Internal server error" }
     *
     * SECURITY:
     * - Path validation prevents directory traversal attacks
     * - Symlink detection prevents directory traversal via symlink (SEC-012)
     * - MIME type validation (Content-Type header)
     * - Magic byte validation (actual file content) - SEC-010
     * - File size limit prevents DoS attacks
     * - Rate limiting prevents abuse
     * - Generic error messages prevent information disclosure
     * - No full path disclosure (returns only filename)
     * - X-Content-Type-Options: nosniff header via Helmet middleware
     *
     * @example
     * // Upload PNG image
     * POST /api/paste-image
     * Content-Type: multipart/form-data
     * folder=/opt/dev/myproject
     * image=<binary data>
     */
    router.post(
        '/api/paste-image',
        rateLimiter,
        // Handle multipart/form-data with single file upload
        (req, res, next) => {
            upload.single('image')(req, res, (err) => {
                if (err) {
                    // Handle multer-specific errors
                    if (err instanceof multer.MulterError) {
                        if (err.code === 'LIMIT_FILE_SIZE') {
                            req.log.warn(
                                { fileSize: req.headers['content-length'] },
                                'File size limit exceeded'
                            );
                            return sendError(res, 413, ErrorCodes.FILE_TOO_LARGE, 'File too large');
                        }
                        if (err.code === 'LIMIT_FILE_COUNT') {
                            req.log.warn('Too many files in upload');
                            return sendError(res, 400, ErrorCodes.TOO_MANY_FILES, 'Only one file allowed');
                        }
                        req.log.error({ err }, 'Multer error');
                        return sendError(res, 400, ErrorCodes.UPLOAD_FAILED, 'Upload failed');
                    }

                    // Handle file filter errors (MIME type validation)
                    if (err.message === 'INVALID_MIME_TYPE') {
                        return sendError(res, 415, ErrorCodes.INVALID_FILE_TYPE, 'Invalid file type');
                    }

                    // Handle unexpected errors
                    req.log.error({ err }, 'Upload middleware error');
                    return sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Internal server error');
                }
                next();
            });
        },
        // Validate path using standard middleware
        requireValidPath,
        async (req, res) => {
            try {
                // Validate that file was uploaded
                if (!req.file) {
                    req.log.warn('No file provided in upload request');
                    return sendError(res, 400, ErrorCodes.MISSING_PARAMETER, 'Missing required fields');
                }

                // SECURITY FIX SEC-010: Comprehensive magic byte validation
                // This prevents MIME type spoofing attacks for ALL binary types
                const contentValidation = await validateFileContent(req.file.buffer, req.file.mimetype);

                if (!contentValidation.valid) {
                    req.log.warn(
                        {
                            declaredType: req.file.mimetype,
                            detectedType: contentValidation.detectedType,
                            security: 'SEC-010',
                        },
                        'File content validation failed'
                    );
                    return sendError(res, 415, ErrorCodes.INVALID_FILE_TYPE, 'Invalid file type');
                }

                // Use detected MIME type instead of declared type for extension
                const validatedMimeType = contentValidation.detectedType;

                // Path has been validated by requireValidPath middleware
                const validatedPath = req.validatedPath;
                const filesDir = path.join(validatedPath, 'tasks', 'files');

                // SEC-012: Validate upload destination to prevent symlink attacks
                const destValidation = await validateUploadDestination(validatedPath, filesDir);

                if (!destValidation.valid) {
                    req.log.warn(
                        {
                            validatedPath,
                            filesDir,
                            error: destValidation.error,
                            security: 'symlink-validation',
                        },
                        'SEC-012: Upload destination validation failed'
                    );
                    // SECURITY: Generic error message to prevent information disclosure
                    return sendError(res, 403, ErrorCodes.ACCESS_DENIED, 'Access denied');
                }

                // Create tasks/files directory if it doesn't exist
                // Safe to create now that we've verified no symlinks exist
                try {
                    await retryTransientErrors(
                        () => fs.promises.mkdir(filesDir, { recursive: true }),
                        'mkdir-files-dir'
                    );
                } catch (mkdirErr) {
                    req.log.error(
                        { err: mkdirErr, filesDir },
                        'Failed to create tasks/files directory'
                    );
                    // SECURITY: Generic error message to client
                    return sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Internal server error');
                }

                // Generate timestamped filename using validated MIME type
                const filename = generateTimestampedFilename(validatedMimeType);
                const fullPath = path.join(filesDir, filename);

                // Write file to disk with retry logic for transient errors
                try {
                    await retryTransientErrors(
                        () => fs.promises.writeFile(fullPath, req.file.buffer),
                        'write-file'
                    );
                } catch (writeErr) {
                    req.log.error(
                        { err: writeErr, fullPath },
                        'Failed to write file'
                    );
                    // SECURITY: Generic error message to client
                    return sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Internal server error');
                }

                // Log successful upload
                req.log.info(
                    {
                        path: fullPath,
                        size: req.file.size,
                        declaredType: req.file.mimetype,
                        detectedType: validatedMimeType,
                    },
                    'File uploaded successfully'
                );

                // SECURITY FIX: Return only filename, not full path
                // This prevents information disclosure about directory structure
                res.status(200).json({
                    success: true,
                    filename: filename,
                });
            } catch (error) {
                // Catch any unexpected errors
                req.log.error({ err: error }, 'Image upload handler failed');
                sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Internal server error');
            }
        }
    );

    return router;
}

module.exports = {
    createPasteRoutes,
    retryTransientErrors,
    RETRYABLE_ERROR_CODES,
    RETRY_CONFIG,
    // Re-export validators for backward compatibility with tests
    // These are imported from file-validator service
    validateTextFile: require('../services/file-validator').validateTextFile,
    validateImageFile: require('../services/file-validator').validateImageFile,
    validateBinaryFile: require('../services/file-validator').validateBinaryFile,
    validateFileContent: require('../services/file-validator').validateFileContent,
};
