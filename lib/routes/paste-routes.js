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
const logger = require('../logger');
const { sendError, ErrorCodes } = require('../response-helpers');
const { ALLOWED_MIME_TYPES, validateFileContent } = require('../services/file-validator');
const { uploadFile } = require('../services/file-uploader');

/**
 * Configure multer for memory storage
 * Files are stored in memory before validation and manual disk write
 */
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
        if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
            cb(null, true);
        } else {
            logger.warn({ mimetype: file.mimetype }, 'Invalid MIME type rejected');
            cb(new Error('INVALID_MIME_TYPE'));
        }
    },
});

/**
 * Handle multer upload errors with appropriate error responses
 */
function handleMulterError(err, req, res) {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            req.log.warn({ fileSize: req.headers['content-length'] }, 'File size limit exceeded');
            return sendError(res, 413, ErrorCodes.FILE_TOO_LARGE, 'File too large');
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
            req.log.warn('Too many files in upload');
            return sendError(res, 400, ErrorCodes.TOO_MANY_FILES, 'Only one file allowed');
        }
        req.log.error({ err }, 'Multer error');
        return sendError(res, 400, ErrorCodes.UPLOAD_FAILED, 'Upload failed');
    }
    if (err.message === 'INVALID_MIME_TYPE') {
        return sendError(res, 415, ErrorCodes.INVALID_FILE_TYPE, 'Invalid file type');
    }
    req.log.error({ err }, 'Upload middleware error');
    return sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Internal server error');
}

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
        (req, res, next) => {
            upload.single('image')(req, res, (err) => {
                if (err) return handleMulterError(err, req, res);
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

                // Upload file to tasks/files directory
                const uploadResult = await uploadFile({
                    validatedPath: req.validatedPath,
                    fileBuffer: req.file.buffer,
                    validatedMimeType: validatedMimeType,
                    fileSize: req.file.size,
                    declaredMimeType: req.file.mimetype,
                    logger: req.log,
                });

                if (!uploadResult.success) {
                    return sendError(
                        res,
                        uploadResult.statusCode,
                        uploadResult.statusCode === 403 ? ErrorCodes.ACCESS_DENIED : ErrorCodes.INTERNAL_ERROR,
                        uploadResult.error
                    );
                }

                res.status(200).json({
                    success: true,
                    filename: uploadResult.filename,
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
    // Re-export validators for backward compatibility with tests
    // These are imported from file-validator service
    validateTextFile: require('../services/file-validator').validateTextFile,
    validateImageFile: require('../services/file-validator').validateImageFile,
    validateBinaryFile: require('../services/file-validator').validateBinaryFile,
    validateFileContent: require('../services/file-validator').validateFileContent,
};
