/**
 * Centralized Upload Storage Service
 *
 * Provides secure, centralized file storage for clipboard uploads.
 * Each browser extension installation gets isolated storage via unique installation ID.
 *
 * Features:
 * - Per-installation isolation (UUID-based folders)
 * - Unguessable URLs (random file tokens)
 * - Configurable TTL (default 7 days)
 * - Automatic cleanup of expired files
 * - Rate limiting via per-installation quotas
 *
 * Storage structure:
 *   DATA_DIR/uploads/{installationId}/{fileToken}_{timestamp}_{filename}
 *
 * Security:
 * - Installation IDs are UUIDv4 (128-bit random)
 * - File tokens are 32-char hex (128-bit random)
 * - Combined 256-bit entropy makes URLs unguessable
 * - Symlink detection prevents directory traversal
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const logger = require('../logger');

// Configuration with defaults (fallback for test environment)
const DATA_DIR = config.dataDir || process.env.DATA_DIR || '/tmp/vscode-favicon';
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const DEFAULT_TTL_DAYS = parseInt(process.env.UPLOAD_TTL_DAYS || '7', 10);
const MAX_FILES_PER_INSTALLATION = parseInt(process.env.UPLOAD_MAX_FILES || '100', 10);
const MAX_SIZE_PER_INSTALLATION = parseInt(process.env.UPLOAD_MAX_SIZE || '104857600', 10); // 100MB
const CLEANUP_INTERVAL_MS = parseInt(process.env.UPLOAD_CLEANUP_INTERVAL_MS || '3600000', 10); // 1 hour

// UUID v4 validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// File token validation regex (32 hex chars)
const TOKEN_REGEX = /^[0-9a-f]{32}$/i;

// Cleanup lock to prevent concurrent cleanup operations
let cleanupInProgress = false;

// Cleanup interval handle
let cleanupInterval = null;

/**
 * Validate UUID format (prevents path traversal)
 * @param {string} id - Installation ID to validate
 * @returns {boolean} True if valid UUIDv4
 */
function isValidUUID(id) {
    return typeof id === 'string' && UUID_REGEX.test(id);
}

/**
 * Validate file token format
 * @param {string} token - File token to validate
 * @returns {boolean} True if valid 32-char hex
 */
function isValidToken(token) {
    return typeof token === 'string' && TOKEN_REGEX.test(token);
}

/**
 * Generate random file token (128-bit / 32 hex chars)
 * @returns {string} Random hex token
 */
function generateFileToken() {
    return crypto.randomBytes(16).toString('hex');
}

/**
 * Get MIME type for file extension
 * @param {string} filename - Filename with extension
 * @returns {string} MIME type
 */
function getMimeType(filename) {
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.pdf': 'application/pdf',
        '.txt': 'text/plain',
        '.md': 'text/markdown',
        '.json': 'application/json',
        '.csv': 'text/csv',
    };
    return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Ensure uploads directory exists with secure permissions
 * @param {string} installationId - Installation UUID
 * @returns {Promise<string>} Path to installation directory
 */
async function ensureInstallationDir(installationId) {
    if (!isValidUUID(installationId)) {
        throw new Error('Invalid installation ID format');
    }

    const installDir = path.join(UPLOADS_DIR, installationId);

    try {
        await fs.promises.mkdir(installDir, { recursive: true, mode: 0o700 });

        // Set strict permissions
        try {
            await fs.promises.chmod(installDir, 0o700);
        } catch (chmodErr) {
            logger.warn({ err: chmodErr, dir: installDir }, 'Failed to set directory permissions');
        }
    } catch (err) {
        if (err.code !== 'EEXIST') {
            logger.error({ err, dir: installDir }, 'Failed to create installation directory');
            throw err;
        }
    }

    return installDir;
}

/**
 * Get metadata file path for an installation
 * @param {string} installationId - Installation UUID
 * @returns {string} Path to metadata.json
 */
function getMetadataPath(installationId) {
    return path.join(UPLOADS_DIR, installationId, 'metadata.json');
}

/**
 * Load metadata for an installation
 * @param {string} installationId - Installation UUID
 * @returns {Promise<Object>} Metadata object
 */
async function loadMetadata(installationId) {
    const metaPath = getMetadataPath(installationId);

    try {
        const data = await fs.promises.readFile(metaPath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        if (err.code !== 'ENOENT') {
            logger.warn({ err, installationId }, 'Failed to read metadata');
        }
        // Return default metadata
        return {
            installationId,
            created: Date.now(),
            lastAccess: Date.now(),
            fileCount: 0,
            totalBytes: 0,
            files: {},
        };
    }
}

/**
 * Save metadata for an installation
 * @param {string} installationId - Installation UUID
 * @param {Object} metadata - Metadata object
 */
async function saveMetadata(installationId, metadata) {
    const metaPath = getMetadataPath(installationId);

    try {
        const jsonData = process.env.NODE_ENV === 'production'
            ? JSON.stringify(metadata)
            : JSON.stringify(metadata, null, 2);

        await fs.promises.writeFile(metaPath, jsonData, 'utf8');

        // Set strict file permissions
        try {
            await fs.promises.chmod(metaPath, 0o600);
        } catch (chmodErr) {
            logger.warn({ err: chmodErr, file: metaPath }, 'Failed to set metadata file permissions');
        }
    } catch (err) {
        logger.error({ err, installationId }, 'Failed to save metadata');
        throw err;
    }
}

/**
 * Store a file in centralized storage
 *
 * @param {string} installationId - Extension installation UUID
 * @param {Buffer} fileBuffer - File content
 * @param {string} mimetype - File MIME type
 * @param {string} originalFilename - Original filename
 * @param {number} [ttlDays] - Time to live in days (default: 7)
 * @returns {Promise<Object>} { fileToken, filename, url, expiresAt }
 */
async function storeFile(installationId, fileBuffer, mimetype, originalFilename, ttlDays = DEFAULT_TTL_DAYS) {
    // Validate installation ID
    if (!isValidUUID(installationId)) {
        logger.warn({ installationId, security: 'invalid-uuid' }, 'Invalid installation ID rejected');
        throw new Error('Invalid installation ID format');
    }

    // Ensure TTL is within bounds (1-30 days)
    const effectiveTtl = Math.max(1, Math.min(30, ttlDays || DEFAULT_TTL_DAYS));

    // Ensure installation directory exists
    const installDir = await ensureInstallationDir(installationId);

    // Load current metadata
    const metadata = await loadMetadata(installationId);

    // Check per-installation limits
    if (metadata.fileCount >= MAX_FILES_PER_INSTALLATION) {
        logger.warn(
            { installationId, fileCount: metadata.fileCount, limit: MAX_FILES_PER_INSTALLATION },
            'File count limit exceeded'
        );
        throw new Error('Maximum file count exceeded for this installation');
    }

    if (metadata.totalBytes + fileBuffer.length > MAX_SIZE_PER_INSTALLATION) {
        logger.warn(
            { installationId, totalBytes: metadata.totalBytes, newSize: fileBuffer.length, limit: MAX_SIZE_PER_INSTALLATION },
            'Storage size limit exceeded'
        );
        throw new Error('Maximum storage size exceeded for this installation');
    }

    // Generate unique file token
    const fileToken = generateFileToken();
    const timestamp = Date.now();
    const expiresAt = timestamp + (effectiveTtl * 24 * 60 * 60 * 1000);

    // Sanitize filename (keep only alphanumeric, dash, underscore, dot)
    const safeFilename = originalFilename.replace(/[^a-zA-Z0-9\-_.]/g, '_');

    // Build storage filename: {token}_{timestamp}_{originalFilename}
    const storageFilename = `${fileToken}_${timestamp}_${safeFilename}`;
    const filePath = path.join(installDir, storageFilename);

    // Write file
    try {
        await fs.promises.writeFile(filePath, fileBuffer);

        // Set strict file permissions
        try {
            await fs.promises.chmod(filePath, 0o600);
        } catch (chmodErr) {
            logger.warn({ err: chmodErr, file: filePath }, 'Failed to set file permissions');
        }
    } catch (err) {
        logger.error({ err, filePath }, 'Failed to write uploaded file');
        throw new Error('Failed to store file');
    }

    // Update metadata
    metadata.lastAccess = timestamp;
    metadata.fileCount++;
    metadata.totalBytes += fileBuffer.length;
    metadata.files[fileToken] = {
        filename: safeFilename,
        storageFilename,
        uploadedAt: timestamp,
        expiresAt,
        size: fileBuffer.length,
        mimetype,
        ttlDays: effectiveTtl,
    };

    await saveMetadata(installationId, metadata);

    // Build public URL
    const baseUrl = process.env.PUBLIC_URL || `https://favicon-api.noreika.lt`;
    const url = `${baseUrl}/uploads/${installationId}/${fileToken}/${safeFilename}`;

    logger.info(
        {
            installationId,
            fileToken,
            filename: safeFilename,
            size: fileBuffer.length,
            ttlDays: effectiveTtl,
            expiresAt: new Date(expiresAt).toISOString(),
        },
        'File stored successfully'
    );

    return {
        fileToken,
        filename: safeFilename,
        url,
        expiresAt,
    };
}

/**
 * Get a file from storage
 *
 * @param {string} installationId - Extension installation UUID
 * @param {string} fileToken - File token
 * @param {string} filename - Expected filename (for validation)
 * @returns {Promise<Object|null>} { buffer, mimetype, filename } or null if not found/expired
 */
async function getFile(installationId, fileToken, filename) {
    // Validate parameters
    if (!isValidUUID(installationId)) {
        logger.warn({ installationId, security: 'invalid-uuid' }, 'Invalid installation ID in getFile');
        return null;
    }

    if (!isValidToken(fileToken)) {
        logger.warn({ fileToken, security: 'invalid-token' }, 'Invalid file token in getFile');
        return null;
    }

    // Load metadata
    const metadata = await loadMetadata(installationId);
    const fileInfo = metadata.files[fileToken];

    if (!fileInfo) {
        logger.debug({ installationId, fileToken }, 'File not found in metadata');
        return null;
    }

    // Check expiry
    if (Date.now() > fileInfo.expiresAt) {
        logger.debug({ installationId, fileToken, expiresAt: fileInfo.expiresAt }, 'File expired');
        return null;
    }

    // Verify filename matches (prevents enumeration with wrong filename)
    if (fileInfo.filename !== filename) {
        logger.warn({ installationId, fileToken, expected: fileInfo.filename, got: filename }, 'Filename mismatch');
        return null;
    }

    // Read file
    const filePath = path.join(UPLOADS_DIR, installationId, fileInfo.storageFilename);

    try {
        // Verify path is within uploads directory (symlink check)
        const realPath = await fs.promises.realpath(filePath);
        if (!realPath.startsWith(UPLOADS_DIR)) {
            logger.error({ filePath, realPath, security: 'symlink-escape' }, 'Symlink escape attempt detected');
            return null;
        }

        const buffer = await fs.promises.readFile(filePath);

        // Update last access time
        metadata.lastAccess = Date.now();
        await saveMetadata(installationId, metadata);

        return {
            buffer,
            mimetype: fileInfo.mimetype || getMimeType(filename),
            filename: fileInfo.filename,
        };
    } catch (err) {
        if (err.code === 'ENOENT') {
            logger.warn({ installationId, fileToken, filePath }, 'File missing from disk');
        } else {
            logger.error({ err, installationId, fileToken }, 'Failed to read file');
        }
        return null;
    }
}

/**
 * Cleanup expired files for a single installation
 *
 * @param {string} installationId - Installation UUID
 * @returns {Promise<number>} Number of files removed
 */
async function cleanupInstallation(installationId) {
    const metadata = await loadMetadata(installationId);
    const now = Date.now();
    let removed = 0;

    for (const [token, fileInfo] of Object.entries(metadata.files)) {
        if (now > fileInfo.expiresAt) {
            // Delete file
            const filePath = path.join(UPLOADS_DIR, installationId, fileInfo.storageFilename);
            try {
                await fs.promises.unlink(filePath);
                removed++;
            } catch (err) {
                if (err.code !== 'ENOENT') {
                    logger.warn({ err, filePath }, 'Failed to delete expired file');
                }
            }

            // Remove from metadata
            metadata.totalBytes -= fileInfo.size;
            metadata.fileCount--;
            delete metadata.files[token];
        }
    }

    if (removed > 0) {
        await saveMetadata(installationId, metadata);
        logger.debug({ installationId, removed }, 'Cleaned up expired files');
    }

    return removed;
}

/**
 * Cleanup all expired files across all installations
 * Uses mutex to prevent concurrent cleanup operations
 *
 * @returns {Promise<Object>} { filesRemoved, installationsChecked, installationsRemoved }
 */
async function cleanup() {
    // Mutex: prevent concurrent cleanup operations
    if (cleanupInProgress) {
        logger.debug('Upload cleanup already in progress, skipping');
        return { filesRemoved: 0, installationsChecked: 0, installationsRemoved: 0 };
    }

    cleanupInProgress = true;
    const startTime = Date.now();

    try {
        let filesRemoved = 0;
        let installationsChecked = 0;
        let installationsRemoved = 0;

        // Ensure uploads directory exists
        try {
            await fs.promises.mkdir(UPLOADS_DIR, { recursive: true, mode: 0o700 });
        } catch (err) {
            if (err.code !== 'EEXIST') {
                logger.error({ err }, 'Failed to create uploads directory');
                return { filesRemoved: 0, installationsChecked: 0, installationsRemoved: 0 };
            }
        }

        // List all installation directories
        let entries;
        try {
            entries = await fs.promises.readdir(UPLOADS_DIR, { withFileTypes: true });
        } catch (err) {
            logger.error({ err }, 'Failed to list uploads directory');
            return { filesRemoved: 0, installationsChecked: 0, installationsRemoved: 0 };
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            if (!isValidUUID(entry.name)) {
                logger.warn({ dir: entry.name }, 'Invalid directory in uploads (not UUID)');
                continue;
            }

            installationsChecked++;

            // Cleanup this installation
            const removed = await cleanupInstallation(entry.name);
            filesRemoved += removed;

            // Check if installation is now empty
            const metadata = await loadMetadata(entry.name);
            if (metadata.fileCount === 0 && Object.keys(metadata.files).length === 0) {
                // Remove empty installation directory
                const installDir = path.join(UPLOADS_DIR, entry.name);
                try {
                    await fs.promises.rm(installDir, { recursive: true });
                    installationsRemoved++;
                    logger.debug({ installationId: entry.name }, 'Removed empty installation directory');
                } catch (err) {
                    logger.warn({ err, installationId: entry.name }, 'Failed to remove empty installation directory');
                }
            }
        }

        const duration = Date.now() - startTime;

        if (filesRemoved > 0 || installationsRemoved > 0) {
            logger.info(
                {
                    filesRemoved,
                    installationsChecked,
                    installationsRemoved,
                    durationMs: duration,
                },
                'Upload cleanup completed'
            );
        } else {
            logger.debug(
                {
                    installationsChecked,
                    durationMs: duration,
                },
                'Upload cleanup completed (no files to remove)'
            );
        }

        return { filesRemoved, installationsChecked, installationsRemoved };
    } finally {
        // Always release lock
        cleanupInProgress = false;
    }
}

/**
 * Start periodic cleanup interval
 * @returns {NodeJS.Timeout} Interval handle
 */
function startCleanupInterval() {
    // Run initial cleanup
    cleanup().catch(err => {
        logger.error({ err }, 'Initial upload cleanup failed');
    });

    // Start periodic cleanup
    cleanupInterval = setInterval(async () => {
        logger.debug('Running scheduled upload cleanup');
        await cleanup();
    }, CLEANUP_INTERVAL_MS);

    logger.info(
        {
            intervalMinutes: CLEANUP_INTERVAL_MS / 1000 / 60,
            defaultTtlDays: DEFAULT_TTL_DAYS,
            maxFilesPerInstallation: MAX_FILES_PER_INSTALLATION,
            maxSizePerInstallation: MAX_SIZE_PER_INSTALLATION,
        },
        'Upload cleanup interval started'
    );

    return cleanupInterval;
}

/**
 * Stop cleanup interval (for graceful shutdown)
 */
function stopCleanupInterval() {
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
        logger.info('Upload cleanup interval stopped');
    }
}

/**
 * Get storage statistics
 * @returns {Promise<Object>} Storage statistics
 */
async function getStats() {
    let totalFiles = 0;
    let totalBytes = 0;
    let installationCount = 0;

    try {
        const entries = await fs.promises.readdir(UPLOADS_DIR, { withFileTypes: true });

        for (const entry of entries) {
            if (!entry.isDirectory() || !isValidUUID(entry.name)) continue;

            installationCount++;
            const metadata = await loadMetadata(entry.name);
            totalFiles += metadata.fileCount;
            totalBytes += metadata.totalBytes;
        }
    } catch (err) {
        if (err.code !== 'ENOENT') {
            logger.warn({ err }, 'Failed to get upload stats');
        }
    }

    return {
        totalFiles,
        totalBytes,
        installationCount,
        maxFilesPerInstallation: MAX_FILES_PER_INSTALLATION,
        maxSizePerInstallation: MAX_SIZE_PER_INSTALLATION,
        defaultTtlDays: DEFAULT_TTL_DAYS,
    };
}

module.exports = {
    storeFile,
    getFile,
    cleanup,
    startCleanupInterval,
    stopCleanupInterval,
    getStats,
    isValidUUID,
    isValidToken,
    // Export for testing
    UPLOADS_DIR,
    DEFAULT_TTL_DAYS,
    MAX_FILES_PER_INSTALLATION,
    MAX_SIZE_PER_INSTALLATION,
};
