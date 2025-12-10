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
 * - MIME type validation (Content-Type header check)
 * - Magic byte validation (actual file content verification)
 * - File size limit (10MB max)
 * - Rate limiting (100 req/min per IP)
 * - Generic error messages to prevent information disclosure
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const fileType = require('file-type');
const logger = require('../logger');

/**
 * Allowed file types configuration
 * Maps MIME types to file extensions and categories
 */
const ALLOWED_FILE_TYPES = {
    // Images
    'image/png': { ext: '.png', category: 'image', prefix: 'img' },
    'image/jpeg': { ext: '.jpg', category: 'image', prefix: 'img' },
    'image/webp': { ext: '.webp', category: 'image', prefix: 'img' },
    'image/gif': { ext: '.gif', category: 'image', prefix: 'img' },
    // Documents
    'application/pdf': { ext: '.pdf', category: 'document', prefix: 'doc' },
    'application/msword': { ext: '.doc', category: 'document', prefix: 'doc' },
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: '.docx', category: 'document', prefix: 'doc' },
    'application/vnd.ms-excel': { ext: '.xls', category: 'spreadsheet', prefix: 'sheet' },
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { ext: '.xlsx', category: 'spreadsheet', prefix: 'sheet' },
    'application/vnd.ms-powerpoint': { ext: '.ppt', category: 'presentation', prefix: 'slides' },
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': { ext: '.pptx', category: 'presentation', prefix: 'slides' },
    // Text files
    'text/plain': { ext: '.txt', category: 'text', prefix: 'file' },
    'text/markdown': { ext: '.md', category: 'text', prefix: 'file' },
    'text/csv': { ext: '.csv', category: 'data', prefix: 'data' },
    'application/json': { ext: '.json', category: 'data', prefix: 'data' },
    // Archives
    'application/zip': { ext: '.zip', category: 'archive', prefix: 'archive' },
};

const ALLOWED_MIME_TYPES = Object.keys(ALLOWED_FILE_TYPES);

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
 * Validate file content using magic bytes (file signature)
 * This prevents MIME type spoofing by checking actual file content
 *
 * SECURITY: Defense-in-depth - validates actual file content, not just headers
 * Note: Text files (txt, md, csv, json) cannot be validated by magic bytes,
 * so we trust the MIME type for those.
 *
 * @param {Buffer} buffer - File buffer to validate
 * @param {string} declaredMimeType - MIME type declared in the request
 * @returns {Promise<{valid: boolean, detectedType?: string, error?: string}>}
 */
async function validateFileContent(buffer, declaredMimeType) {
    // Text files don't have magic bytes - trust MIME type validation
    const textMimeTypes = ['text/plain', 'text/markdown', 'text/csv', 'application/json'];
    if (textMimeTypes.includes(declaredMimeType)) {
        return {
            valid: true,
            detectedType: declaredMimeType,
        };
    }

    // Image types MUST have valid magic bytes - no trusting MIME type alone
    const imageMimeTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    const isImageType = imageMimeTypes.includes(declaredMimeType);

    try {
        // Detect actual file type from magic bytes
        const detectedType = await fileType.fromBuffer(buffer);

        if (!detectedType) {
            // SECURITY: If claiming to be an image but no magic bytes detected, reject
            if (isImageType) {
                logger.warn(
                    { declaredMimeType },
                    'File claims to be image but has no valid magic bytes'
                );
                return {
                    valid: false,
                    detectedType: null,
                    error: 'Invalid image file',
                };
            }
            // For other binary types (documents, archives), trust MIME type
            logger.warn({ declaredMimeType }, 'Unable to detect file type from buffer, trusting MIME type');
            return {
                valid: true,
                detectedType: declaredMimeType,
            };
        }

        // SECURITY: If declared type is image, detected type MUST also be image
        if (isImageType && !detectedType.mime.startsWith('image/')) {
            logger.warn(
                { declaredMimeType, detectedType: detectedType.mime },
                'MIME type spoofing detected: declared image but content is not image'
            );
            return {
                valid: false,
                detectedType: detectedType.mime,
                error: 'File content does not match declared image type',
            };
        }

        // Check if detected type is in allowed list
        if (!ALLOWED_MIME_TYPES.includes(detectedType.mime)) {
            logger.warn(
                { detectedType: detectedType.mime, extension: detectedType.ext },
                'File content validation failed: invalid file type'
            );
            return {
                valid: false,
                detectedType: detectedType.mime,
                error: 'File content does not match allowed types',
            };
        }

        return {
            valid: true,
            detectedType: detectedType.mime,
        };
    } catch (error) {
        logger.error({ err: error }, 'File content validation error');
        return {
            valid: false,
            error: 'File validation failed',
        };
    }
}

/**
 * Generate timestamped filename for uploaded file
 * Format: {prefix}-YYYY-MM-DD-HHmmss-mmm.{ext} (includes milliseconds for uniqueness)
 *
 * @param {string} mimetype - MIME type of the uploaded file
 * @returns {string} Generated filename with appropriate extension
 */
function generateTimestampedFilename(mimetype) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const milliseconds = String(now.getMilliseconds()).padStart(3, '0');

    // Get file info from config
    const fileInfo = ALLOWED_FILE_TYPES[mimetype] || { ext: '.bin', prefix: 'file' };

    return `${fileInfo.prefix}-${year}-${month}-${day}-${hours}${minutes}${seconds}-${milliseconds}${fileInfo.ext}`;
}

/**
 * Create paste routes with dependencies
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
     * - 400: { error: "Missing required fields" }
     * - 403: { error: "Access denied" }
     * - 413: { error: "File too large" }
     * - 415: { error: "Invalid file type" }
     * - 500: { error: "Internal server error" }
     *
     * SECURITY:
     * - Path validation prevents directory traversal attacks
     * - MIME type validation (Content-Type header)
     * - Magic byte validation (actual file content)
     * - File size limit prevents DoS attacks
     * - Rate limiting prevents abuse
     * - Generic error messages prevent information disclosure
     * - No full path disclosure (returns only filename)
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
                            return res.status(413).json({ error: 'File too large' });
                        }
                        if (err.code === 'LIMIT_FILE_COUNT') {
                            req.log.warn('Too many files in upload');
                            return res.status(400).json({ error: 'Only one file allowed' });
                        }
                        req.log.error({ err }, 'Multer error');
                        return res.status(400).json({ error: 'Upload failed' });
                    }

                    // Handle file filter errors (MIME type validation)
                    if (err.message === 'INVALID_MIME_TYPE') {
                        return res.status(415).json({ error: 'Invalid file type' });
                    }

                    // Handle unexpected errors
                    req.log.error({ err }, 'Upload middleware error');
                    return res.status(500).json({ error: 'Internal server error' });
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
                    return res.status(400).json({ error: 'Missing required fields' });
                }

                // SECURITY FIX: Validate file content using magic bytes
                // This prevents MIME type spoofing attacks
                const contentValidation = await validateFileContent(req.file.buffer, req.file.mimetype);

                if (!contentValidation.valid) {
                    req.log.warn(
                        {
                            declaredType: req.file.mimetype,
                            detectedType: contentValidation.detectedType,
                            security: 'magic-byte-validation',
                        },
                        'File content validation failed'
                    );
                    return res.status(415).json({ error: 'Invalid file type' });
                }

                // Use detected MIME type instead of declared type for extension
                const validatedMimeType = contentValidation.detectedType;

                // Path has been validated by requireValidPath middleware
                const validatedPath = req.validatedPath;
                const filesDir = path.join(validatedPath, 'tasks', 'files');

                // Create tasks/files directory if it doesn't exist
                try {
                    await fs.promises.mkdir(filesDir, { recursive: true });
                } catch (mkdirErr) {
                    req.log.error(
                        { err: mkdirErr, filesDir },
                        'Failed to create tasks/files directory'
                    );
                    // SECURITY: Generic error message to client
                    return res.status(500).json({ error: 'Internal server error' });
                }

                // Generate timestamped filename using validated MIME type
                const filename = generateTimestampedFilename(validatedMimeType);
                const fullPath = path.join(filesDir, filename);

                // Write file to disk
                try {
                    await fs.promises.writeFile(fullPath, req.file.buffer);
                } catch (writeErr) {
                    req.log.error(
                        { err: writeErr, fullPath },
                        'Failed to write file'
                    );
                    // SECURITY: Generic error message to client
                    return res.status(500).json({ error: 'Internal server error' });
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
                res.status(500).json({ error: 'Internal server error' });
            }
        }
    );

    return router;
}

module.exports = { createPasteRoutes };
