const fs = require('fs');
const path = require('path');
const fg = require('fast-glob');
const { getCleanInitials, sanitizePort } = require('../svg-sanitizer');
const logger = require('../logger');
const LRUCache = require('../lru-cache');

// Favicon file patterns to search for (priority order)
const FAVICON_PATTERNS = [
    'favicon.ico',
    'favicon.png',
    'favicon.svg',
    'icon.png',
    'icon.ico',
    'logo.png',
    'logo.svg',
];

// Common directories to check first (fast path)
const COMMON_PATHS = [
    '', // root
    'public',
    'static',
    'assets',
    'frontend/public',
    'client/public',
    'src/assets',
    'web',
    'www',
    'images',
    'img',
];

// Directories to ignore during full scan
const IGNORE_DIRS = [
    'node_modules',
    '.git',
    'vendor',
    '.next',
    '.nuxt',
    'dist',
    'build',
    'coverage',
    '.cache',
    '__pycache__',
    '.pytest_cache',
    'venv',
    '.venv',
    'target',
];

/**
 * FIX QUA-022: FaviconService with explicit dependencies
 *
 * Decoupled from global config object for better testability.
 * Dependencies are now injected via constructor.
 */
class FaviconService {
    /**
     * FIX QUA-022: Constructor with explicit dependency injection
     *
     * @param {Object} options - Service configuration options
     * @param {Object} options.registryCache - Registry cache interface with getRegistry() method
     * @param {Object} options.faviconCache - LRU cache for favicons
     * @param {Object} options.typeColors - Color mapping for project types (dev, prod, staging, etc.)
     * @param {Array<string>} options.defaultColors - Default color palette for projects without type
     */
    constructor({ registryCache, faviconCache, typeColors, defaultColors }) {
        // Validate required dependencies
        if (!registryCache || typeof registryCache.getRegistry !== 'function') {
            throw new Error('FaviconService requires registryCache with getRegistry method');
        }
        if (
            !faviconCache ||
            typeof faviconCache.get !== 'function' ||
            typeof faviconCache.set !== 'function'
        ) {
            throw new Error('FaviconService requires faviconCache with get and set methods');
        }
        if (!typeColors || typeof typeColors !== 'object') {
            throw new Error('FaviconService requires typeColors object');
        }
        if (!defaultColors || !Array.isArray(defaultColors)) {
            throw new Error('FaviconService requires defaultColors array');
        }

        this.registryCache = registryCache;
        this.faviconCache = faviconCache;
        this.typeColors = typeColors;
        this.defaultColors = defaultColors;

        // PERF-009: Add LRU cache for computed colors
        this.colorCache = new LRUCache(50);
    }

    async findFaviconFile(projectPath) {
        // First try quick search in common locations
        const quickResult = await this.quickSearch(projectPath);
        if (quickResult) return quickResult;

        // Fall back to full project scan
        return await this.fullProjectScan(projectPath);
    }

    /**
     * PERF-004: Quick search with sequential checking for early exit
     * Check priority paths sequentially and return on first match
     */
    async quickSearch(projectPath) {
        try {
            // Check patterns in priority order, return on first match
            for (const pattern of FAVICON_PATTERNS) {
                for (const dir of COMMON_PATHS) {
                    const fullPath = path.join(projectPath, dir, pattern);
                    try {
                        await fs.promises.access(fullPath, fs.constants.R_OK);
                        // Found a favicon - return immediately
                        return fullPath;
                    } catch {
                        // Path doesn't exist or not readable, continue to next
                    }
                }
            }

            return null;
        } catch (err) {
            logger.warn({ err, projectPath }, 'Favicon quick search failed');
            return null;
        }
    }

    /**
     * PERF-002: Full project scan with single-pass min-finding
     * Use single-pass algorithm instead of sorting entire array
     */
    async fullProjectScan(projectPath) {
        const patterns = FAVICON_PATTERNS.map((p) => `**/${p}`);

        try {
            const files = await fg(patterns, {
                cwd: projectPath,
                absolute: true,
                onlyFiles: true,
                ignore: IGNORE_DIRS.map((d) => `**/${d}/**`),
                deep: 5,
                followSymbolicLinks: false,
            });

            if (files.length === 0) return null;

            // Single-pass min-finding: find best file without sorting all files
            let best = null;
            for (const file of files) {
                const candidate = {
                    path: file,
                    depth: file.split(path.sep).length,
                    priority: FAVICON_PATTERNS.findIndex((p) => file.endsWith(p)),
                };

                // Update best if this is better (shallower depth or better priority)
                if (
                    !best ||
                    candidate.depth < best.depth ||
                    (candidate.depth === best.depth && candidate.priority < best.priority)
                ) {
                    best = candidate;
                }
            }

            return best?.path || null;
        } catch (err) {
            logger.warn({ err, projectPath, patterns }, 'Favicon full scan failed');
            return null;
        }
    }

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
     */
    getTypeColor(type, projectName) {
        // Check if type has predefined color
        if (this.typeColors[type]) {
            return this.typeColors[type];
        }

        // Check cache for computed color
        const cached = this.colorCache.get(projectName);
        if (cached) {
            return cached;
        }

        // Compute hash-based color
        let hash = 0;
        for (let i = 0; i < projectName.length; i++) {
            hash = projectName.charCodeAt(i) + ((hash << 5) - hash);
        }
        const color = this.defaultColors[Math.abs(hash) % this.defaultColors.length];

        // Cache the result
        this.colorCache.set(projectName, color);

        return color;
    }

    /**
     * Convert hex color to grayscale using luminosity formula
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

    generatePortText(type, sanitizedPort) {
        return type === 'dev' && sanitizedPort
            ? `<text x="16" y="30" text-anchor="middle" fill="white" font-family="monospace" font-size="6" opacity="0.8">${sanitizedPort}</text>`
            : '';
    }

    getContentType(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.png') return 'image/png';
        if (ext === '.svg') return 'image/svg+xml';
        return 'image/x-icon';
    }

    async getFavicon(projectPath, options = {}) {
        const cacheKey = `favicon_${projectPath}${options.grayscale ? '_gray' : ''}`;
        const cached = this.faviconCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        const existingFavicon = await this.findFaviconFile(projectPath);
        if (existingFavicon) {
            const data = await fs.promises.readFile(existingFavicon);
            const contentType = this.getContentType(existingFavicon);
            const result = { contentType, data };
            this.faviconCache.set(cacheKey, result);
            return result;
        }

        const registry = await this.registryCache.getRegistry();
        const projectName = path.basename(projectPath);
        const projectInfo =
            registry.projects?.[projectPath] || registry.projects?.[projectName] || {};

        const svg = this.generateSvgFavicon(projectName, projectInfo, options);
        const result = {
            contentType: 'image/svg+xml',
            data: Buffer.from(svg),
        };

        this.faviconCache.set(cacheKey, result);
        return result;
    }

    /**
     * FIX QUA-030: Get combined cache statistics for monitoring
     * Returns stats from both favicon cache and color cache
     * @returns {Object} Combined cache statistics
     */
    getStats() {
        const faviconStats = this.faviconCache.getStats();
        const colorStats = this.colorCache.getStats();

        return {
            faviconCache: {
                hits: faviconStats.hits,
                misses: faviconStats.misses,
                evictions: faviconStats.evictions,
                size: faviconStats.size,
                maxSize: faviconStats.maxSize,
                hitRate: faviconStats.hitRate,
                utilizationPercent: faviconStats.utilizationPercent,
            },
            colorCache: {
                hits: colorStats.hits,
                misses: colorStats.misses,
                evictions: colorStats.evictions,
                size: colorStats.size,
                maxSize: colorStats.maxSize,
                hitRate: colorStats.hitRate,
                utilizationPercent: colorStats.utilizationPercent,
            },
            combined: {
                totalHits: faviconStats.hits + colorStats.hits,
                totalMisses: faviconStats.misses + colorStats.misses,
                totalEvictions: faviconStats.evictions + colorStats.evictions,
                overallHitRate:
                    faviconStats.hits + colorStats.hits + faviconStats.misses + colorStats.misses > 0
                        ? (
                              ((faviconStats.hits + colorStats.hits) /
                                  (faviconStats.hits +
                                      colorStats.hits +
                                      faviconStats.misses +
                                      colorStats.misses)) *
                              100
                          ).toFixed(1) + '%'
                        : 'N/A',
            },
        };
    }
}

module.exports = FaviconService;
