/**
 * Upload Routes Module
 * Routes for serving uploaded files from centralized storage
 *
 * Endpoints:
 * - GET /uploads/:installationId/:fileToken/:filename - Serve uploaded file
 *
 * SECURITY:
 * - UUID validation for installation ID (prevents path traversal)
 * - Token validation (32-char hex)
 * - Filename validation against metadata
 * - Symlink detection
 * - Rate limiting
 * - Expiry enforcement
 */

const express = require('express');
const router = express.Router();
const uploadStorage = require('../services/upload-storage');
const { sendError, ErrorCodes } = require('../response-helpers');

/**
 * Create upload routes with dependencies
 *
 * @param {Function} downloadLimiter - Rate limiting middleware
 * @returns {Object} Express router with upload routes
 */
function createUploadRoutes(downloadLimiter) {
    /**
     * GET /uploads/:installationId/:fileToken/:filename
     * Serve uploaded file from centralized storage
     *
     * URL structure designed for security:
     * - installationId: UUIDv4 (128-bit random, unguessable)
     * - fileToken: 32-char hex (128-bit random, unguessable)
     * - filename: Original filename (validated against metadata)
     *
     * Combined 256-bit entropy makes brute-force infeasible.
     *
     * @example
     * GET /uploads/a7b8c9d0-1234-5678-9abc-def012345678/f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8/image.png
     */
    router.get(
        '/uploads/:installationId/:fileToken/:filename',
        downloadLimiter,
        async (req, res) => {
            const { installationId, fileToken, filename } = req.params;

            // Validate installation ID format (UUID)
            if (!uploadStorage.isValidUUID(installationId)) {
                req.log.warn({ installationId, security: 'invalid-uuid' }, 'Invalid installation ID format');
                return sendError(res, 400, ErrorCodes.INVALID_PARAMETER, 'Invalid request');
            }

            // Validate file token format (32 hex chars)
            if (!uploadStorage.isValidToken(fileToken)) {
                req.log.warn({ fileToken, security: 'invalid-token' }, 'Invalid file token format');
                return sendError(res, 400, ErrorCodes.INVALID_PARAMETER, 'Invalid request');
            }

            // Validate filename (no path traversal)
            if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('\0')) {
                req.log.warn({ filename, security: 'invalid-filename' }, 'Invalid filename');
                return sendError(res, 400, ErrorCodes.INVALID_PARAMETER, 'Invalid request');
            }

            try {
                // Get file from storage
                const file = await uploadStorage.getFile(installationId, fileToken, filename);

                if (!file) {
                    // Generic 404 - don't reveal whether file existed or expired
                    return sendError(res, 404, ErrorCodes.NOT_FOUND, 'File not found');
                }

                // Set security and caching headers
                res.setHeader('Content-Type', file.mimetype);
                res.setHeader('Content-Length', file.buffer.length);
                res.setHeader('X-Content-Type-Options', 'nosniff');
                res.setHeader('Content-Disposition', `inline; filename="${file.filename}"`);

                // Private cache - these are user-specific files
                res.setHeader('Cache-Control', 'private, max-age=86400'); // 1 day

                // Send file
                res.send(file.buffer);

                req.log.debug(
                    {
                        installationId,
                        fileToken: fileToken.substring(0, 8) + '...',
                        filename: file.filename,
                        size: file.buffer.length,
                    },
                    'File served'
                );
            } catch (error) {
                req.log.error({ err: error, installationId, fileToken }, 'Failed to serve file');
                sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Internal server error');
            }
        }
    );

    /**
     * GET /uploads/stats
     * Get upload storage statistics (admin only would be ideal, but keeping simple)
     * This is informational and doesn't expose sensitive data
     */
    router.get('/uploads/stats', async (req, res) => {
        try {
            const stats = await uploadStorage.getStats();
            res.json({
                success: true,
                stats,
            });
        } catch (error) {
            req.log.error({ err: error }, 'Failed to get upload stats');
            sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Internal server error');
        }
    });

    return router;
}

module.exports = {
    createUploadRoutes,
};
