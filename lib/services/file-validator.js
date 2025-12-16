/**
 * File Validator Service Module
 * Extracted from paste-routes.js for improved maintainability
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
 * REF: QUA-001 - Extracted from paste-routes.js to reduce file complexity
 */

const fs = require('fs');
const path = require('path');
const fileType = require('file-type');
const logger = require('../logger');
const { retryFileOperation } = require('../utils/file-operations');

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

// REF-017: Derive text and binary MIME types from single source of truth
// Text files don't have magic bytes - identified by category
const TEXT_MIME_TYPES = Object.entries(ALLOWED_FILE_TYPES)
    .filter(([, info]) => info.category === 'text' || info.category === 'data')
    .map(([mime]) => mime);

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
 * @returns {Promise<{valid: boolean, detectedType?: string, error?: string}>}
 */
async function validateTextFile(buffer, declaredMimeType) {
    const MAX_LINE_LENGTH = 10 * 1024; // 10KB per line
    const MAX_CONTENT_SIZE = 10 * 1024 * 1024; // 10MB (matches multer limit)

    // Validate content size (defense-in-depth)
    if (buffer.length > MAX_CONTENT_SIZE) {
        logger.warn(
            {
                size: buffer.length,
                maxSize: MAX_CONTENT_SIZE,
                declaredMimeType,
                security: 'text-validation'
            },
            'Text content exceeds maximum size'
        );
        return {
            valid: false,
            error: 'File too large'
        };
    }

    // SECURITY: Check for null bytes (binary content or injection attempt)
    // Null bytes in text files indicate either:
    // 1. Binary file disguised as text (MIME spoofing)
    // 2. Path traversal attempt (e.g., file.txt\0.php)
    // 3. Injection attack payload
    if (buffer.includes(0x00)) {
        logger.warn(
            {
                declaredMimeType,
                security: 'null-byte-injection'
            },
            'Null byte detected in text content - potential injection attack'
        );
        return {
            valid: false,
            error: 'Invalid text content'
        };
    }

    // SECURITY: Validate UTF-8 encoding
    // Invalid UTF-8 sequences indicate binary content disguised as text
    let content;
    try {
        content = buffer.toString('utf8');

        // Verify round-trip encoding to detect invalid UTF-8
        // If buffer contains invalid UTF-8, conversion will use replacement characters
        const reEncoded = Buffer.from(content, 'utf8');

        // Check if re-encoding matches original (validates UTF-8)
        // Use Buffer.compare for accurate byte-level comparison
        if (Buffer.compare(buffer, reEncoded) !== 0) {
            logger.warn(
                {
                    declaredMimeType,
                    originalSize: buffer.length,
                    reEncodedSize: reEncoded.length,
                    security: 'utf8-validation'
                },
                'Invalid UTF-8 encoding detected in text content'
            );
            return {
                valid: false,
                error: 'Invalid text encoding'
            };
        }
    } catch (error) {
        logger.warn(
            {
                err: error,
                declaredMimeType,
                security: 'utf8-validation'
            },
            'Failed to decode text content as UTF-8'
        );
        return {
            valid: false,
            error: 'Invalid text encoding'
        };
    }

    // SECURITY: Validate line length to prevent DoS attacks
    // Extremely long lines can cause:
    // 1. Memory exhaustion in parsers/editors
    // 2. CPU exhaustion in regex operations
    // 3. Display issues in terminal/editor
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const lineLength = Buffer.byteLength(lines[i], 'utf8');
        if (lineLength > MAX_LINE_LENGTH) {
            logger.warn(
                {
                    lineNumber: i + 1,
                    lineLength,
                    maxLineLength: MAX_LINE_LENGTH,
                    declaredMimeType,
                    security: 'line-length-validation'
                },
                'Line exceeds maximum length in text content'
            );
            return {
                valid: false,
                error: 'Text content contains overly long lines'
            };
        }
    }

    // All text validation checks passed
    return {
        valid: true,
        detectedType: declaredMimeType,
    };
}

/**
 * Validate image file content using magic bytes
 * Images must have valid magic bytes that match declared type exactly
 *
 * SECURITY: No special cases - detected type must match declared type
 *
 * @param {Buffer} buffer - File buffer to validate
 * @param {string} declaredMimeType - MIME type declared in the request
 * @returns {Promise<{valid: boolean, detectedType?: string, error?: string}>}
 */
async function validateImageFile(buffer, declaredMimeType) {
    try {
        // Detect actual file type from magic bytes
        const detectedType = await fileType.fromBuffer(buffer);

        if (!detectedType) {
            logger.warn(
                { declaredMimeType, security: 'SEC-010' },
                'Image file has no valid magic bytes - potential MIME spoofing attack'
            );
            return {
                valid: false,
                detectedType: null,
                error: 'Invalid file - unable to verify file type',
            };
        }

        // Check if detected type is in allowed list
        if (!ALLOWED_MIME_TYPES.includes(detectedType.mime)) {
            logger.warn(
                {
                    declaredMimeType,
                    detectedType: detectedType.mime,
                    extension: detectedType.ext,
                    security: 'SEC-010'
                },
                'Detected file type not in allowed list'
            );
            return {
                valid: false,
                detectedType: detectedType.mime,
                error: 'File content does not match allowed types',
            };
        }

        // SECURITY: For images, detected type must match declared type exactly
        // No special cases or format variants allowed
        if (detectedType.mime !== declaredMimeType) {
            logger.warn(
                {
                    declaredMimeType,
                    detectedType: detectedType.mime,
                    security: 'SEC-010'
                },
                'Image MIME type mismatch: declared type does not match detected type'
            );
            return {
                valid: false,
                detectedType: detectedType.mime,
                error: 'File content does not match declared type',
            };
        }

        return {
            valid: true,
            detectedType: detectedType.mime,
        };

    } catch (error) {
        logger.error({ err: error }, 'Image file validation error');
        return {
            valid: false,
            error: 'File validation failed',
        };
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
 * @returns {Promise<{valid: boolean, detectedType?: string, error?: string}>}
 */
async function validateBinaryFile(buffer, declaredMimeType) {
    try {
        // Detect actual file type from magic bytes
        const detectedType = await fileType.fromBuffer(buffer);

        if (!detectedType) {
            logger.warn(
                { declaredMimeType, security: 'SEC-010' },
                'Binary file has no valid magic bytes - potential MIME spoofing attack'
            );
            return {
                valid: false,
                detectedType: null,
                error: 'Invalid file - unable to verify file type',
            };
        }

        // Check if detected type is in allowed list
        if (!ALLOWED_MIME_TYPES.includes(detectedType.mime)) {
            logger.warn(
                {
                    declaredMimeType,
                    detectedType: detectedType.mime,
                    extension: detectedType.ext,
                    security: 'SEC-010'
                },
                'Detected file type not in allowed list'
            );
            return {
                valid: false,
                detectedType: detectedType.mime,
                error: 'File content does not match allowed types',
            };
        }

        // Accept if detected type matches declared type exactly
        if (detectedType.mime === declaredMimeType) {
            return {
                valid: true,
                detectedType: detectedType.mime,
            };
        }

        // SECURITY: Special case for Office XML formats (DOCX, XLSX, PPTX)
        // These are ZIP archives internally, so file-type detects them as application/zip
        const officeZipFormats = [
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // XLSX
            'application/vnd.openxmlformats-officedocument.presentationml.presentation', // PPTX
        ];

        const isOfficeZipFormat = officeZipFormats.includes(declaredMimeType);
        const detectedAsZip = detectedType.mime === 'application/zip';

        if (isOfficeZipFormat && detectedAsZip) {
            logger.debug(
                { declaredMimeType, detectedType: detectedType.mime },
                'Accepting Office XML format detected as ZIP (valid internal structure)'
            );
            return {
                valid: true,
                detectedType: declaredMimeType, // Use declared type for correct extension
            };
        }

        // SECURITY: Detected type doesn't match declared type - potential spoofing
        logger.warn(
            {
                declaredMimeType,
                detectedType: detectedType.mime,
                security: 'SEC-010'
            },
            'Binary MIME type mismatch: declared type does not match detected type'
        );
        return {
            valid: false,
            detectedType: detectedType.mime,
            error: 'File content does not match declared type',
        };

    } catch (error) {
        logger.error({ err: error }, 'Binary file validation error');
        return {
            valid: false,
            error: 'File validation failed',
        };
    }
}

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
        return validateTextFile(buffer, declaredMimeType);
    }

    // Get file type info to determine category
    // SECURITY: declaredMimeType already validated by multer fileFilter
    // eslint-disable-next-line security/detect-object-injection
    const fileInfo = ALLOWED_FILE_TYPES[declaredMimeType];

    if (!fileInfo) {
        // Should never happen - multer validates MIME type first
        logger.error(
            { declaredMimeType },
            'Unknown MIME type - not in ALLOWED_FILE_TYPES'
        );
        return {
            valid: false,
            detectedType: null,
            error: 'File validation failed',
        };
    }

    // Route to image or binary validator based on category
    if (fileInfo.category === 'image') {
        return validateImageFile(buffer, declaredMimeType);
    } else {
        // Documents, spreadsheets, presentations, archives
        return validateBinaryFile(buffer, declaredMimeType);
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
    // It must be a key from ALLOWED_FILE_TYPES constant (safe, controlled values)
    // eslint-disable-next-line security/detect-object-injection
    const fileInfo = ALLOWED_FILE_TYPES[mimetype] || { ext: '.bin', prefix: 'file' };

    return `${fileInfo.prefix}-${year}-${month}-${day}-${hours}${minutes}${seconds}-${milliseconds}${fileInfo.ext}`;
}

/**
 * Validate upload destination to prevent symlink attacks (SEC-012)
 *
 * SECURITY: Defense against directory traversal via symlink manipulation
 * - Uses lstat() to detect symlinks without following them
 * - Resolves real path and validates it stays within project root
 * - Prevents arbitrary file write outside validated directory
 * - Retries transient filesystem errors (EAGAIN, EBUSY, ETIMEDOUT)
 *
 * Attack scenario:
 * 1. Attacker replaces tasks/ or tasks/files/ with symlink to /etc/
 * 2. Upload writes to /etc/passwd via symlink traversal
 * 3. This function detects and blocks the attack
 *
 * @param {string} validatedProjectRoot - Already validated project root path
 * @param {string} targetDir - Target directory path (e.g., {project}/tasks/files)
 * @returns {Promise<{valid: boolean, error?: string, resolvedPath?: string}>}
 */
async function validateUploadDestination(validatedProjectRoot, targetDir) {
    try {
        // Normalize project root for comparison (lowercase for case-insensitive FS)
        const normalizedRoot = path.resolve(validatedProjectRoot).toLowerCase();

        // Check each component of the path for symlinks
        const tasksDir = path.join(validatedProjectRoot, 'tasks');
        const filesDir = path.join(tasksDir, 'files');

        // Check if 'tasks' directory exists and is a symlink
        try {
            const tasksStat = await retryFileOperation(
                () => fs.promises.lstat(tasksDir),
                { operationName: 'lstat-tasks-dir' }
            );
            if (tasksStat.isSymbolicLink()) {
                logger.warn(
                    { tasksDir, security: 'symlink-attack' },
                    'SEC-012: Symlink detected at tasks/ directory'
                );
                return {
                    valid: false,
                    error: 'Symlink detected in upload path',
                };
            }
        } catch (error) {
            // Directory doesn't exist yet - this is OK, we'll create it
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }

        // Check if 'tasks/files' directory exists and is a symlink
        try {
            const filesStat = await retryFileOperation(
                () => fs.promises.lstat(filesDir),
                { operationName: 'lstat-files-dir' }
            );
            if (filesStat.isSymbolicLink()) {
                logger.warn(
                    { filesDir, security: 'symlink-attack' },
                    'SEC-012: Symlink detected at tasks/files/ directory'
                );
                return {
                    valid: false,
                    error: 'Symlink detected in upload path',
                };
            }
        } catch (error) {
            // Directory doesn't exist yet - this is OK, we'll create it
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }

        // Resolve the real path of the target directory
        // If directory doesn't exist, realpath will fail, so we check parent
        let resolvedPath;
        try {
            resolvedPath = await retryFileOperation(
                () => fs.promises.realpath(targetDir),
                { operationName: 'realpath-target-dir' }
            );
        } catch (error) {
            if (error.code === 'ENOENT') {
                // Target doesn't exist yet, resolve parent and construct path
                const parentDir = path.dirname(targetDir);
                try {
                    const resolvedParent = await retryFileOperation(
                        () => fs.promises.realpath(parentDir),
                        { operationName: 'realpath-parent-dir' }
                    );
                    resolvedPath = path.join(resolvedParent, path.basename(targetDir));
                } catch (parentError) {
                    if (parentError.code === 'ENOENT') {
                        // Parent doesn't exist either, use normalized path
                        resolvedPath = path.resolve(targetDir);
                    } else {
                        throw parentError;
                    }
                }
            } else {
                throw error;
            }
        }

        // Normalize resolved path for comparison (lowercase for case-insensitive FS)
        const normalizedResolved = resolvedPath.toLowerCase();

        // Verify resolved path is still within project root
        // Add path.sep to prevent prefix confusion attacks (/opt/dev vs /opt/devmalicious)
        const rootWithSep = normalizedRoot + path.sep;
        const isWithinRoot =
            normalizedResolved === normalizedRoot ||
            normalizedResolved.startsWith(rootWithSep);

        if (!isWithinRoot) {
            logger.warn(
                {
                    validatedRoot: validatedProjectRoot,
                    targetDir,
                    resolvedPath,
                    security: 'symlink-escape'
                },
                'SEC-012: Upload destination resolves outside project root'
            );
            return {
                valid: false,
                error: 'Upload destination outside allowed directory',
            };
        }

        // All checks passed
        return {
            valid: true,
            resolvedPath,
        };

    } catch (error) {
        logger.error(
            { err: error, validatedProjectRoot, targetDir },
            'SEC-012: Upload destination validation error'
        );
        return {
            valid: false,
            error: 'Failed to validate upload destination',
        };
    }
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
