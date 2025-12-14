const path = require('path');
const { getCleanInitials, sanitizePort } = require('../svg-sanitizer');
const LRUCache = require('../lru-cache');

/**
 * FaviconGenerator - Responsible for generating SVG favicons and color selection
 *
 * Separates SVG/color generation concerns from file searching and caching.
 * Handles type-based and hash-based color selection with memoization.
 */
class FaviconGenerator {
    /**
     * @param {Object} options - Generator configuration
     * @param {Object} options.typeColors - Color mapping for project types (dev, prod, staging, etc.)
     * @param {Array<string>} options.defaultColors - Default color palette for hash-based selection
     */
    constructor({ typeColors, defaultColors }) {
        if (!typeColors || typeof typeColors !== 'object') {
            throw new Error('FaviconGenerator requires typeColors object');
        }
        if (!defaultColors || !Array.isArray(defaultColors)) {
            throw new Error('FaviconGenerator requires defaultColors array');
        }

        this.typeColors = typeColors;
        this.defaultColors = defaultColors;

        // PERF-009: Add LRU cache for computed colors
        this.colorCache = new LRUCache(50);
    }

    /**
     * Generate SVG favicon for project
     *
     * @param {string} projectName - Project name
     * @param {Object} projectInfo - Project metadata (name, type, port)
     * @param {Object} options - Generation options (grayscale)
     * @returns {string} SVG markup
     */
    generateSvgFavicon(projectName, projectInfo = {}, options = {}) {
        const displayName = projectInfo.name || projectName;
        const type = projectInfo.type || 'dev';
        const port = projectInfo.port || '';

        // SECURITY: Use sanitized initials generation from svg-sanitizer
        const initials = getCleanInitials(displayName);
        let bgColor = this.getTypeColor(type, projectName);

        // Convert to grayscale if requested
        if (options.grayscale) {
            bgColor = this.toGrayscale(bgColor);
        }

        // SECURITY: Sanitize port value before embedding in SVG
        const sanitizedPort = sanitizePort(port);
        const portText = this.generatePortText(type, sanitizedPort);

        return `<svg width="32" height="32" xmlns="http://www.w3.org/2000/svg">
        <rect width="32" height="32" rx="4" fill="${bgColor}"/>
        <text x="16" y="21" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-size="14" font-weight="bold">
            ${initials}
        </text>
        ${portText}
    </svg>`;
    }

    /**
     * PERF-009: Get type color with LRU caching for hash-based colors
     * Cache computed colors to avoid recalculating hash on every call
     *
     * @param {string} type - Project type
     * @param {string} projectName - Project name (for hash-based color)
     * @returns {string} Hex color code
     */
    getTypeColor(type, projectName) {
        // SECURITY: type comes from projectInfo.type (from registry, controlled values)
        // If not in typeColors, we compute a hash-based color (defensive coding pattern)
        // eslint-disable-next-line security/detect-object-injection
        if (this.typeColors[type]) {
            // eslint-disable-next-line security/detect-object-injection
            return this.typeColors[type];
        }

        // FIX REF-026: Use centralized cache key generation
        const FaviconService = require('./favicon-service');
        const cacheKey = FaviconService.makeCacheKey('color', projectName);

        // Check cache for computed color
        const cached = this.colorCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        // Compute hash-based color
        let hash = 0;
        for (let i = 0; i < projectName.length; i++) {
            hash = projectName.charCodeAt(i) + ((hash << 5) - hash);
        }
        const color = this.defaultColors[Math.abs(hash) % this.defaultColors.length];

        // FIX REF-026: Use centralized cache key generation
        this.colorCache.set(cacheKey, color);

        return color;
    }

    /**
     * Convert hex color to grayscale using luminosity formula
     *
     * @param {string} hexColor - Hex color (#RRGGBB)
     * @returns {string} Grayscale hex color (#GGGGGG)
     */
    toGrayscale(hexColor) {
        // Remove # if present
        const hex = hexColor.replace('#', '');

        // Parse RGB components
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);

        // Calculate grayscale using luminosity formula
        // Human eye perceives green as brightest, blue as darkest
        const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);

        // Convert back to hex
        const grayHex = gray.toString(16).padStart(2, '0');

        return `#${grayHex}${grayHex}${grayHex}`;
    }

    /**
     * Generate port text for dev projects
     *
     * @param {string} type - Project type
     * @param {string|number} sanitizedPort - Sanitized port number
     * @returns {string} SVG text element or empty string
     */
    generatePortText(type, sanitizedPort) {
        return type === 'dev' && sanitizedPort
            ? `<text x="16" y="30" text-anchor="middle" fill="white" font-family="monospace" font-size="6" opacity="0.8">${sanitizedPort}</text>`
            : '';
    }

    /**
     * Determine content type from file extension
     *
     * @param {string} filePath - File path
     * @returns {string} MIME type
     */
    getContentType(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.png') return 'image/png';
        if (ext === '.svg') return 'image/svg+xml';
        return 'image/x-icon';
    }

    /**
     * Get color cache statistics
     *
     * @returns {Object} Cache statistics
     */
    getColorCacheStats() {
        return this.colorCache.getStats();
    }
}

module.exports = FaviconGenerator;
