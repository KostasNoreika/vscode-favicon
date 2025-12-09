/**
 * Paste Routes Module
 * Routes for handling clipboard image uploads from browser extension
 *
 * Endpoints:
 * - POST /api/paste-image - Upload clipboard image to project tasks directory
 *
 * SECURITY:
 * - Path validation via requireValidPath middleware
 * - MIME type validation (Content-Type header check)
 * - Magic byte validation (actual file content verification)
 * - File size limit (10MB max)
 * - Rate limiting (10 req/min per IP)
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
        // Magic byte validation happens after upload
        const allowedMimeTypes = ['image/png', 'image/jpeg', 'image/webp'];

        if (allowedMimeTypes.includes(file.mimetype)) {
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
 *
 * @param {Buffer} buffer - File buffer to validate
 * @returns {Promise<{valid: boolean, detectedType?: string, error?: string}>}
 */
async function validateFileContent(buffer) {
    try {
        // Detect actual file type from magic bytes
        const detectedType = await fileType.fromBuffer(buffer);

        if (!detectedType) {
            logger.warn('Unable to detect file type from buffer');
            return {
                valid: false,
                error: 'Unable to determine file type',
            };
        }

        // Allowed MIME types based on magic bytes
        const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];

        if (!allowedTypes.includes(detectedType.mime)) {
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
 * Generate timestamped filename for uploaded image
 * Format: img-YYYY-MM-DD-HHmmss-mmm.png (includes milliseconds for uniqueness)
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

    // Determine file extension based on MIME type
    let ext = '.png';
    if (mimetype === 'image/jpeg') ext = '.jpg';
    else if (mimetype === 'image/webp') ext = '.webp';

    return `img-${year}-${month}-${day}-${hours}${minutes}${seconds}-${milliseconds}${ext}`;
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
                const contentValidation = await validateFileContent(req.file.buffer);

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
                const tasksDir = path.join(validatedPath, 'tasks');

                // Create tasks directory if it doesn't exist
                try {
                    await fs.promises.mkdir(tasksDir, { recursive: true });
                } catch (mkdirErr) {
                    req.log.error(
                        { err: mkdirErr, tasksDir },
                        'Failed to create tasks directory'
                    );
                    // SECURITY: Generic error message to client
                    return res.status(500).json({ error: 'Internal server error' });
                }

                // Generate timestamped filename using validated MIME type
                const filename = generateTimestampedFilename(validatedMimeType);
                const fullPath = path.join(tasksDir, filename);

                // Write file to disk
                try {
                    await fs.promises.writeFile(fullPath, req.file.buffer);
                } catch (writeErr) {
                    req.log.error(
                        { err: writeErr, fullPath },
                        'Failed to write image file'
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
                    'Image uploaded successfully'
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
