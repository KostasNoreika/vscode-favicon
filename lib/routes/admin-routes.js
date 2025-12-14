/**
 * Admin Routes Module
 * Routes for administrative operations and downloads
 *
 * Endpoints:
 * - POST /api/clear-cache - Clear all caches (requires admin authentication)
 * - GET /download/extension - Download Chrome extension ZIP
 */

const express = require('express');
const router = express.Router();
const config = require('../config');
const { getCacheStats: getRegistryCacheStats, invalidateCache } = require('../registry-cache');

/**
 * Initialize admin routes with dependencies
 *
 * @param {Object} faviconCache - LRU cache instance for favicons
 * @param {Function} cacheClearLimiter - Rate limiter for cache clear endpoint
 * @param {Function} adminAuth - Admin authentication middleware
 * @param {Function} downloadLimiter - Rate limiter for download endpoint
 * @returns {Object} Express router with admin routes
 */
function createAdminRoutes(faviconCache, cacheClearLimiter, adminAuth, downloadLimiter) {
    // Clear cache endpoint with rate limit + IP whitelist authentication
    router.post('/api/clear-cache', cacheClearLimiter, adminAuth, (req, res) => {
        const faviconSizeBefore = faviconCache.size;
        const statsBeforeClear = getRegistryCacheStats();

        faviconCache.clear();
        invalidateCache();

        res.json({
            success: true,
            message: 'All caches cleared',
            faviconItemsCleared: faviconSizeBefore,
            registryCacheCleared: statsBeforeClear.cached,
        });
    });

    // Download Chrome extension ZIP
    // REF-015: Uses config.extensionZipPath instead of hardcoded path
    // Path is derived from manifest.json version or EXTENSION_ZIP_PATH env variable
    router.get('/download/extension', downloadLimiter, (req, res) => {
        const extensionPath = config.extensionZipPath;
        res.download(extensionPath, 'vscode-favicon-extension.zip', (err) => {
            if (err) {
                req.log.error({ err, extensionPath }, 'Extension download failed');
                res.status(404).json({ error: 'Extension file not found' });
            }
        });
    });

    return router;
}

module.exports = { createAdminRoutes };
