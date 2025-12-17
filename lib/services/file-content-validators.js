/**
 * File Content Validators Module
 * Type-specific file validation logic
 *
 * Provides:
 * - Text file validation (UTF-8, null bytes, line length)
 * - Image file validation (magic bytes, exact type matching)
 * - Binary file validation (magic bytes, Office format support)
 *
 * SECURITY:
 * - Prevents MIME type spoofing via magic byte validation
 * - Detects binary content disguised as text
 * - Validates file signatures match declared types
 *
 * REF: QUA-001 - Extracted from file-validator.js to reduce file complexity
 */

const fileType = require('file-type');
const logger = require('../logger');

/**
 * Validate text file content for security issues
 *
 * SECURITY CHECKS:
 * - Valid UTF-8 encoding (detects binary disguised as text)
 * - Null byte detection (prevents path traversal and injection attacks)
 * - Line length limits (prevents DoS via extremely long lines)
 * - Content size verification (defense-in-depth with multer limits)
 *
 * @param {Buffer} buffer - File buffer to validate
 * @param {string} declaredMimeType - MIME type declared in the request
 * @param {Object} constants - Validation constants
 * @returns {Promise<{valid: boolean, detectedType?: string, error?: string}>}
 */
async function validateTextFile(buffer, declaredMimeType, constants = {}) {
    const MAX_LINE_LENGTH = constants.MAX_LINE_LENGTH || 10 * 1024;
    const MAX_CONTENT_SIZE = constants.MAX_CONTENT_SIZE || 10 * 1024 * 1024;

    if (buffer.length > MAX_CONTENT_SIZE) {
        logger.warn({ size: buffer.length, maxSize: MAX_CONTENT_SIZE, declaredMimeType, security: 'text-validation' }, 'Text content exceeds maximum size');
        return { valid: false, error: 'File too large' };
    }

    if (buffer.includes(0x00)) {
        logger.warn({ declaredMimeType, security: 'null-byte-injection' }, 'Null byte detected in text content - potential injection attack');
        return { valid: false, error: 'Invalid text content' };
    }

    let content;
    try {
        content = buffer.toString('utf8');
        const reEncoded = Buffer.from(content, 'utf8');
        if (Buffer.compare(buffer, reEncoded) !== 0) {
            logger.warn({ declaredMimeType, originalSize: buffer.length, reEncodedSize: reEncoded.length, security: 'utf8-validation' }, 'Invalid UTF-8 encoding detected in text content');
            return { valid: false, error: 'Invalid text encoding' };
        }
    } catch (error) {
        logger.warn({ err: error, declaredMimeType, security: 'utf8-validation' }, 'Failed to decode text content as UTF-8');
        return { valid: false, error: 'Invalid text encoding' };
    }

    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const lineLength = Buffer.byteLength(lines[i], 'utf8');
        if (lineLength > MAX_LINE_LENGTH) {
            logger.warn({ lineNumber: i + 1, lineLength, maxLineLength: MAX_LINE_LENGTH, declaredMimeType, security: 'line-length-validation' }, 'Line exceeds maximum length in text content');
            return { valid: false, error: 'Text content contains overly long lines' };
        }
    }

    return { valid: true, detectedType: declaredMimeType };
}

/**
 * Validate image file content using magic bytes
 * Images must have valid magic bytes that match declared type exactly
 *
 * SECURITY: No special cases - detected type must match declared type
 *
 * @param {Buffer} buffer - File buffer to validate
 * @param {string} declaredMimeType - MIME type declared in the request
 * @param {string[]} allowedMimeTypes - List of allowed MIME types
 * @returns {Promise<{valid: boolean, detectedType?: string, error?: string}>}
 */
async function validateImageFile(buffer, declaredMimeType, allowedMimeTypes) {
    try {
        const detectedType = await fileType.fromBuffer(buffer);

        if (!detectedType) {
            logger.warn({ declaredMimeType, security: 'SEC-010' }, 'Image file has no valid magic bytes - potential MIME spoofing attack');
            return { valid: false, detectedType: null, error: 'Invalid file - unable to verify file type' };
        }

        if (!allowedMimeTypes.includes(detectedType.mime)) {
            logger.warn({ declaredMimeType, detectedType: detectedType.mime, extension: detectedType.ext, security: 'SEC-010' }, 'Detected file type not in allowed list');
            return { valid: false, detectedType: detectedType.mime, error: 'File content does not match allowed types' };
        }

        if (detectedType.mime !== declaredMimeType) {
            logger.warn({ declaredMimeType, detectedType: detectedType.mime, security: 'SEC-010' }, 'Image MIME type mismatch: declared type does not match detected type');
            return { valid: false, detectedType: detectedType.mime, error: 'File content does not match declared type' };
        }

        return { valid: true, detectedType: detectedType.mime };
    } catch (error) {
        logger.error({ err: error }, 'Image file validation error');
        return { valid: false, error: 'File validation failed' };
    }
}

/**
 * Validate binary file content using magic bytes
 * Handles documents and archives with special cases for Office formats
 *
 * SECURITY: Office XML formats (DOCX, XLSX, PPTX) are ZIP-based
 * file-type library detects them as application/zip, which is technically correct
 *
 * @param {Buffer} buffer - File buffer to validate
 * @param {string} declaredMimeType - MIME type declared in the request
 * @param {string[]} allowedMimeTypes - List of allowed MIME types
 * @returns {Promise<{valid: boolean, detectedType?: string, error?: string}>}
 */
async function validateBinaryFile(buffer, declaredMimeType, allowedMimeTypes) {
    try {
        const detectedType = await fileType.fromBuffer(buffer);

        if (!detectedType) {
            logger.warn({ declaredMimeType, security: 'SEC-010' }, 'Binary file has no valid magic bytes - potential MIME spoofing attack');
            return { valid: false, detectedType: null, error: 'Invalid file - unable to verify file type' };
        }

        if (!allowedMimeTypes.includes(detectedType.mime)) {
            logger.warn({ declaredMimeType, detectedType: detectedType.mime, extension: detectedType.ext, security: 'SEC-010' }, 'Detected file type not in allowed list');
            return { valid: false, detectedType: detectedType.mime, error: 'File content does not match allowed types' };
        }

        if (detectedType.mime === declaredMimeType) {
            return { valid: true, detectedType: detectedType.mime };
        }

        // SECURITY: Special case for Office XML formats (DOCX, XLSX, PPTX)
        const officeZipFormats = [
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        ];

        if (officeZipFormats.includes(declaredMimeType) && detectedType.mime === 'application/zip') {
            logger.debug({ declaredMimeType, detectedType: detectedType.mime }, 'Accepting Office XML format detected as ZIP (valid internal structure)');
            return { valid: true, detectedType: declaredMimeType };
        }

        logger.warn({ declaredMimeType, detectedType: detectedType.mime, security: 'SEC-010' }, 'Binary MIME type mismatch: declared type does not match detected type');
        return { valid: false, detectedType: detectedType.mime, error: 'File content does not match declared type' };
    } catch (error) {
        logger.error({ err: error }, 'Binary file validation error');
        return { valid: false, error: 'File validation failed' };
    }
}

module.exports = {
    validateTextFile,
    validateImageFile,
    validateBinaryFile,
};
