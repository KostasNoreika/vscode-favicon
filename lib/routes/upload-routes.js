/**
 * Upload Routes Module
 * Routes for serving uploaded files from centralized storage
 *
 * Endpoints:
 * - GET /u/:token - Serve uploaded file (short URL format)
 *
 * SECURITY:
 * - Token validation (22-char base64url = 128-bit random)
 * - 128-bit entropy makes brute-force infeasible
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
     * GET /u/:token
     * Serve uploaded file using short URL format
     *
     * URL structure: /u/{22-char-base64url-token}.{ext}
     * Example: /u/A7b8C9d0E1f2G3h4I5j6K7.png
     *
     * 128-bit entropy (2^128) makes brute-force infeasible.
     *
     * @example
     * GET /u/A7b8C9d0E1f2G3h4I5j6K7.png
     */
    router.get(
        '/u/:token',
        downloadLimiter,
        async (req, res) => {
            const tokenWithExt = req.params.token;

            // Parse token and extension (e.g., "A7b8C9d0E1f2G3h4I5j6K7.png")
            const dotIndex = tokenWithExt.lastIndexOf('.');
            if (dotIndex === -1) {
                req.log.warn({ token: tokenWithExt, security: 'no-extension' }, 'Missing file extension');
                return sendError(res, 400, ErrorCodes.INVALID_PARAMETER, 'Invalid request');
            }

            const token = tokenWithExt.substring(0, dotIndex);
            const requestedExt = tokenWithExt.substring(dotIndex).toLowerCase();

            // Validate token format (22 chars base64url)
            if (!uploadStorage.isValidToken(token)) {
                req.log.warn({ token, security: 'invalid-token' }, 'Invalid file token format');
                return sendError(res, 400, ErrorCodes.INVALID_PARAMETER, 'Invalid request');
            }

            try {
                // Get file from storage by token
                const file = await uploadStorage.getFileByToken(token);

                if (!file) {
                    // Generic 404 - don't reveal whether file existed or expired
                    return sendError(res, 404, ErrorCodes.NOT_FOUND, 'File not found');
                }

                // Verify extension matches (prevents serving file with wrong type)
                const actualExt = '.' + file.filename.split('.').pop().toLowerCase();
                if (requestedExt !== actualExt) {
                    req.log.warn({ token, requestedExt, actualExt, security: 'ext-mismatch' }, 'Extension mismatch');
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
                        token: token.substring(0, 8) + '...',
                        filename: file.filename,
                        size: file.buffer.length,
                    },
                    'File served (short URL)'
                );
            } catch (error) {
                req.log.error({ err: error, token }, 'Failed to serve file');
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
