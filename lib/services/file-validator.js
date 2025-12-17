/**
 * File Validator Service Module
 * Main coordinator for file validation
 *
 * Provides comprehensive file validation including:
 * - MIME type validation (Content-Type header check)
 * - Magic byte validation (actual file content verification)
 * - Text file security checks (UTF-8, null bytes, line length)
 * - Upload destination validation (symlink detection)
 * - Filename generation
 *
 * SECURITY:
 * - Defense-in-depth validation strategy
 * - Prevents MIME type spoofing attacks (SEC-010)
 * - Prevents directory traversal via symlinks (SEC-012)
 * - XSS prevention through content validation
 * - DoS prevention through size and line length limits
 *
 * REF: QUA-001 - Refactored to reduce file complexity by extracting:
 * - file-content-validators.js - Type-specific validation functions
 * - upload-destination-validator.js - Symlink detection logic
 */

const logger = require('../logger');
const {
    validateTextFile: validateText,
    validateImageFile: validateImage,
    validateBinaryFile: validateBinary,
} = require('./file-content-validators');
const { validateUploadDestination } = require('./upload-destination-validator');

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

// Text files don't have magic bytes - identified by category
const TEXT_MIME_TYPES = Object.entries(ALLOWED_FILE_TYPES)
    .filter(([, info]) => info.category === 'text' || info.category === 'data')
    .map(([mime]) => mime);

/**
 * Validate file content using magic bytes (file signature)
 * This prevents MIME type spoofing by checking actual file content
 *
 * SECURITY FIX SEC-010: Comprehensive magic byte validation for ALL binary types
 * - Text files (txt, md, csv, json) - No magic bytes possible, trust MIME after validation
 * - ALL binary files (images, documents, archives) - REQUIRE valid magic bytes
 * - Reject any binary file claiming to be supported type without detectable signature
 *
 * Defense-in-depth strategy:
 * 1. Multer validates Content-Type header (first layer)
 * 2. This function validates actual file content via magic bytes (second layer)
 * 3. Detected type must match declared type or be in allowed list
 *
 * REF-016: Refactored from single complex function into type-specific validators
 * - validateTextFile() - handles text/plain and data files
 * - validateImageFile() - handles image/* with strict matching
 * - validateBinaryFile() - handles documents/archives with Office format support
 *
 * @param {Buffer} buffer - File buffer to validate
 * @param {string} declaredMimeType - MIME type declared in the request
 * @returns {Promise<{valid: boolean, detectedType?: string, error?: string}>}
 */
async function validateFileContent(buffer, declaredMimeType) {
    // Route to appropriate validator based on MIME type category
    if (TEXT_MIME_TYPES.includes(declaredMimeType)) {
        return validateText(buffer, declaredMimeType);
    }

    // Get file type info to determine category
    // SECURITY: declaredMimeType already validated by multer fileFilter
    // eslint-disable-next-line security/detect-object-injection
    const fileInfo = ALLOWED_FILE_TYPES[declaredMimeType];

    if (!fileInfo) {
        logger.error({ declaredMimeType }, 'Unknown MIME type - not in ALLOWED_FILE_TYPES');
        return { valid: false, detectedType: null, error: 'File validation failed' };
    }

    // Route to image or binary validator based on category
    if (fileInfo.category === 'image') {
        return validateImage(buffer, declaredMimeType, ALLOWED_MIME_TYPES);
    } else {
        return validateBinary(buffer, declaredMimeType, ALLOWED_MIME_TYPES);
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

    // SECURITY: mimetype is validated by validateFileContent() before calling this function
    // eslint-disable-next-line security/detect-object-injection
    const fileInfo = ALLOWED_FILE_TYPES[mimetype] || { ext: '.bin', prefix: 'file' };

    return `${fileInfo.prefix}-${year}-${month}-${day}-${hours}${minutes}${seconds}-${milliseconds}${fileInfo.ext}`;
}

// Re-export type-specific validators for backward compatibility with tests
// Wrapper functions provide default allowedMimeTypes for tests that don't pass it
function validateTextFile(buffer, declaredMimeType, constants) {
    return validateText(buffer, declaredMimeType, constants);
}

function validateImageFile(buffer, declaredMimeType, allowedMimeTypes = ALLOWED_MIME_TYPES) {
    return validateImage(buffer, declaredMimeType, allowedMimeTypes);
}

function validateBinaryFile(buffer, declaredMimeType, allowedMimeTypes = ALLOWED_MIME_TYPES) {
    return validateBinary(buffer, declaredMimeType, allowedMimeTypes);
}

module.exports = {
    // Constants
    ALLOWED_FILE_TYPES,
    ALLOWED_MIME_TYPES,
    TEXT_MIME_TYPES,

    // Validation functions
    validateTextFile,
    validateImageFile,
    validateBinaryFile,
    validateFileContent,

    // Helper functions
    generateTimestampedFilename,
    validateUploadDestination,
};
