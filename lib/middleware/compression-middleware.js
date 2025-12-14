/**
 * Compression Middleware Module
 * Centralized configuration for response compression
 *
 * Exports compression middleware for:
 * - Gzip compression for responses > 1KB
 * - Configurable compression level and threshold
 * - Optional compression bypass via x-no-compression header
 */

const compression = require('compression');
const config = require('../config');

/**
 * Configure compression middleware
 *
 * @returns {Function} Compression middleware
 */
function setupCompression() {
    // COMPRESSION: Gzip compression for responses > 1KB (70-90% reduction)
    return compression({
        level: config.compressionLevel, // Balanced speed/compression
        threshold: config.compressionThreshold, // Only compress responses > 1KB
        filter: (req, res) => {
            if (req.headers['x-no-compression']) {
                return false;
            }
            return compression.filter(req, res);
        },
    });
}

module.exports = {
    setupCompression,
};
