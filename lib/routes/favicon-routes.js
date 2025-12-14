/**
 * Favicon Routes Module
 * Routes for favicon generation and project info
 *
 * Endpoints:
 * - GET /api/favicon - Generate/serve project favicons
 * - GET /api/project-info - Get project metadata
 * - GET /favicon-api - Alternative favicon endpoint (allows missing folder)
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getProjectInfo } = require('../registry-cache');
const { validateGrayscale, handleValidationErrors } = require('../validators');
const { sendSVG, sendError, ErrorCodes } = require('../response-helpers');
const { getDefaultFavicon } = require('../svg-sanitizer');
const logger = require('../logger');

/**
 * Express middleware for path validation
 * Validates folder parameter and attaches results to req object
 * This is the STANDARD validation approach - single source of truth for path validation
 *
 * FIX QUA-004 & REF-007: Consolidated path validation logic into middleware.
 * All endpoints should use this instead of chaining express-validator path checks.
 *
 * FIX QUA-003: Added try-catch wrapper to handle async validation errors
 *
 * SECURITY: Performs comprehensive path validation including:
 * - Directory traversal protection
 * - Symlink attack prevention
 * - URL encoding bypass detection
 * - Allowed path verification
 * - Always returns generic error messages to prevent information disclosure
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 * @returns {Promise<void>}
 */
const requireValidPath = async (req, res, next) => {
    try {
        const { validatePathAsync } = require('../path-validator');
        const folder = req.query.folder || req.body.folder;
        if (!folder) {
            return sendError(res, 400, ErrorCodes.MISSING_PARAMETER, 'Folder parameter required');
        }

        const validation = await validatePathAsync(folder);
        if (!validation.valid) {
            // SECURITY: Log detailed error information server-side for debugging
            // Use req.log if available (from request logger), otherwise use global logger
            const log = req.log || logger;
            log.error(
                {
                    input: folder,
                    sanitized: validation.sanitized,
                    resolved: validation.resolved,
                    error: validation.error,
                },
                'Path validation failed'
            );

            // SECURITY: Always return generic error message to client
            // Never expose path details, validation errors, or file system structure
            return sendError(res, 403, ErrorCodes.ACCESS_DENIED, 'Access denied');
        }

        req.validatedPath = validation.resolved;
        req.projectName = path.basename(validation.resolved);
        next();
    } catch (error) {
        // FIX QUA-003: Catch any unexpected errors during path validation
        // Use req.log if available (from request logger), otherwise use global logger
        const log = req.log || logger;
        log.error({ err: error }, 'Path validation middleware error');
        sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Internal server error');
    }
};

/**
 * Shared favicon request handler to eliminate code duplication
 * Handles both /api/favicon and /favicon-api endpoints
 *
 * FIX REF-007: Refactored to use req.validatedPath from requireValidPath middleware
 * FIX QUA-027: Enhanced JSDoc documentation for complex function
 * FIX QUA-029: Use sendSVG helper for consistent security headers
 *
 * @param {Object} faviconCache - LRU cache instance for favicons
 * @param {Object} faviconService - FaviconService instance
 * @returns {Function} Express request handler
 *
 * @security
 * - Path validation handled by requireValidPath middleware (prevents path traversal)
 * - Returns generic error messages to clients (detailed errors logged server-side only)
 * - Uses SVG sanitizer to prevent XSS attacks in generated favicons
 *
 * @example
 * // Generate favicon for a project
 * GET /api/favicon?folder=/opt/dev/myproject
 *
 * // Generate grayscale favicon
 * GET /api/favicon?folder=/opt/dev/myproject&grayscale=true
 *
 * @see {@link requireValidPath} for path validation details
 * @see {@link FaviconService#generateSvgFavicon} for SVG generation
 */
function createFaviconHandler(faviconCache, faviconService) {
    return async function handleFaviconRequest(req, res) {
        try {
            // Path validation is now handled by requireValidPath middleware
            const validatedPath = req.validatedPath;
            const projectName = req.projectName;

            // Parse grayscale option
            const grayscale = req.query.grayscale === 'true';

            // Check cache first
            const cacheKey = `favicon_${validatedPath}${grayscale ? '_gray' : ''}`;
            const cached = faviconCache.get(cacheKey);
            if (cached) {
                res.setHeader('Content-Type', cached.contentType);
                res.setHeader('Cache-Control', `public, max-age=${config.cacheTtl}`);
                return res.send(cached.data);
            }

            // FIX QUA-013: Use centralized getProjectInfo helper
            const projectInfo = await getProjectInfo(validatedPath);

            // Try to find existing favicon (async)
            const existingFavicon = await faviconService.findFaviconFile(validatedPath);

            if (existingFavicon) {
                const ext = path.extname(existingFavicon).toLowerCase();
                let contentType = 'image/x-icon';

                if (ext === '.png') contentType = 'image/png';
                else if (ext === '.svg') contentType = 'image/svg+xml';

                const data = await fs.promises.readFile(existingFavicon);

                // Cache the favicon
                faviconCache.set(cacheKey, { contentType, data });

                res.setHeader('Content-Type', contentType);
                res.setHeader('Cache-Control', `public, max-age=${config.cacheTtl}`);
                return res.send(data);
            }

            // Generate SVG favicon
            const svgFavicon = faviconService.generateSvgFavicon(projectName, projectInfo, {
                grayscale,
            });
            const svgBuffer = Buffer.from(svgFavicon);

            // Cache the generated SVG
            faviconCache.set(cacheKey, {
                contentType: 'image/svg+xml',
                data: svgBuffer,
            });

            // FIX QUA-029: Use sendSVG helper for defense-in-depth security headers
            sendSVG(res, svgBuffer, { cacheControl: `public, max-age=${config.cacheTtl}` });
        } catch (error) {
            const log = req.log || logger;
            log.error({ err: error }, 'Favicon request failed');
            sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Internal server error');
        }
    };
}

/**
 * Initialize favicon routes with dependencies
 *
 * @param {Object} faviconCache - LRU cache instance for favicons
 * @param {Object} faviconService - FaviconService instance
 * @returns {Object} Express router with favicon routes
 */
function createFaviconRoutes(faviconCache, faviconService) {
    const handleFaviconRequest = createFaviconHandler(faviconCache, faviconService);

    // API endpoint for favicon - requires folder parameter
    // FIX REF-007: Using requireValidPath middleware for consistent validation
    // FIX QUA-012: Added validateGrayscale for input validation
    router.get('/api/favicon', validateGrayscale, handleValidationErrors, requireValidPath, handleFaviconRequest);

    // API endpoint to get project info (async)
    router.get('/api/project-info', requireValidPath, async (req, res) => {
        try {
            const { validatedPath } = req;

            // FIX QUA-013: Use centralized getProjectInfo helper
            const projectInfo = await getProjectInfo(validatedPath);

            res.json({
                name: path.basename(validatedPath),
                ...projectInfo,
                hasCustomFavicon: !!(await faviconService.findFaviconFile(validatedPath)),
            });
        } catch (error) {
            const log = req.log || logger;
            log.error({ err: error }, 'Project info request failed');
            sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Internal server error');
        }
    });

    // Alternative favicon API endpoint - allows missing folder (returns default SVG)
    // FIX REF-007: Conditional requireValidPath - only validates if folder is provided
    // FIX QUA-004: Use getDefaultFavicon() from svg-sanitizer.js
    // FIX QUA-012: Added validateGrayscale for input validation
    // FIX QUA-029: Use sendSVG helper for default SVG response
    router.get('/favicon-api', validateGrayscale, handleValidationErrors, async (req, res, next) => {
        // If folder is provided, validate it with requireValidPath
        if (req.query.folder) {
            return requireValidPath(req, res, next);
        }
        // If no folder, return default SVG using centralized function
        const defaultSvg = getDefaultFavicon();
        sendSVG(res, defaultSvg);
    }, handleFaviconRequest);

    return router;
}

module.exports = { createFaviconRoutes, requireValidPath };
