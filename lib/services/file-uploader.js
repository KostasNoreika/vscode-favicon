/**
 * File Uploader Service Module
 * Handles file upload orchestration for paste-image endpoint
 *
 * Provides:
 * - Directory creation with symlink validation
 * - File writing with retry logic
 * - Upload success logging
 *
 * SECURITY:
 * - Validates upload destination before creating directories
 * - Prevents symlink attacks (SEC-012)
 * - Uses retry logic for transient filesystem errors
 * - Generic error messages prevent information disclosure
 *
 * REF: QUA-001 - Extracted from paste-routes.js to reduce file complexity
 */

const fs = require('fs');
const path = require('path');
const { retryFileOperation } = require('../utils/file-operations');
const { validateUploadDestination } = require('./upload-destination-validator');
const { generateTimestampedFilename } = require('./file-validator');

/**
 * Upload file to project tasks/files directory
 *
 * Process:
 * 1. Validate upload destination (symlink detection)
 * 2. Create tasks/files directory if needed
 * 3. Generate timestamped filename
 * 4. Write file to disk with retry logic
 *
 * SECURITY:
 * - Symlink validation prevents directory traversal (SEC-012)
 * - Retry logic handles transient filesystem errors
 * - Returns only filename, not full path (prevents information disclosure)
 *
 * @param {Object} params - Upload parameters
 * @param {string} params.validatedPath - Already validated project root path
 * @param {Buffer} params.fileBuffer - File content buffer
 * @param {string} params.validatedMimeType - Validated MIME type from content validation
 * @param {number} params.fileSize - File size in bytes
 * @param {string} params.declaredMimeType - Originally declared MIME type
 * @param {Object} params.logger - Pino logger instance for request
 * @returns {Promise<{success: boolean, filename?: string, error?: string, statusCode?: number}>}
 */
async function uploadFile({ validatedPath, fileBuffer, validatedMimeType, fileSize, declaredMimeType, logger }) {
    const filesDir = path.join(validatedPath, 'tasks', 'files');

    // SEC-012: Validate upload destination to prevent symlink attacks
    const destValidation = await validateUploadDestination(validatedPath, filesDir);

    if (!destValidation.valid) {
        logger.warn(
            {
                validatedPath,
                filesDir,
                error: destValidation.error,
                security: 'symlink-validation',
            },
            'SEC-012: Upload destination validation failed'
        );
        return {
            success: false,
            error: 'Access denied',
            statusCode: 403,
        };
    }

    // Create tasks/files directory if it doesn't exist
    // Safe to create now that we've verified no symlinks exist
    try {
        await retryFileOperation(
            () => fs.promises.mkdir(filesDir, { recursive: true }),
            { operationName: 'mkdir-files-dir' }
        );
    } catch (mkdirErr) {
        logger.error(
            { err: mkdirErr, filesDir },
            'Failed to create tasks/files directory'
        );
        return {
            success: false,
            error: 'Internal server error',
            statusCode: 500,
        };
    }

    // Generate timestamped filename using validated MIME type
    const filename = generateTimestampedFilename(validatedMimeType);
    const fullPath = path.join(filesDir, filename);

    // Write file to disk with retry logic for transient errors
    try {
        await retryFileOperation(
            () => fs.promises.writeFile(fullPath, fileBuffer),
            { operationName: 'write-file' }
        );
    } catch (writeErr) {
        logger.error(
            { err: writeErr, fullPath },
            'Failed to write file'
        );
        return {
            success: false,
            error: 'Internal server error',
            statusCode: 500,
        };
    }

    // Log successful upload
    logger.info(
        {
            path: fullPath,
            size: fileSize,
            declaredType: declaredMimeType,
            detectedType: validatedMimeType,
        },
        'File uploaded successfully'
    );

    // SECURITY: Return only filename, not full path
    // This prevents information disclosure about directory structure
    return {
        success: true,
        filename: filename,
    };
}

module.exports = {
    uploadFile,
};
