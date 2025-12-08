const fs = require('fs');
const path = require('path');
const fg = require('fast-glob');
const { getCleanInitials, sanitizePort } = require('../svg-sanitizer');
const logger = require('../logger');

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
    '',           // root
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

class FaviconService {
    constructor({ config, registryCache, faviconCache }) {
        this.config = config;
        this.registryCache = registryCache;
        this.faviconCache = faviconCache;
    }

    async findFaviconFile(projectPath) {
        // First try quick search in common locations
        const quickResult = await this.quickSearch(projectPath);
        if (quickResult) return quickResult;

        // Fall back to full project scan
        return await this.fullProjectScan(projectPath);
    }

    async quickSearch(projectPath) {
        const checkPath = async (pattern, dir) => {
            const fullPath = path.join(projectPath, dir, pattern);
            try {
                await fs.promises.access(fullPath, fs.constants.R_OK);
                return fullPath;
            } catch {
                return null;
            }
        };

        const checks = FAVICON_PATTERNS.flatMap(pattern =>
            COMMON_PATHS.map(dir => checkPath(pattern, dir))
        );

        const results = await Promise.all(checks);
        return results.find(r => r !== null) || null;
    }

    async fullProjectScan(projectPath) {
        const patterns = FAVICON_PATTERNS.map(p => `**/${p}`);

        try {
            const files = await fg(patterns, {
                cwd: projectPath,
                absolute: true,
                onlyFiles: true,
                ignore: IGNORE_DIRS.map(d => `**/${d}/**`),
                deep: 5,
                followSymbolicLinks: false,
            });

            if (files.length === 0) return null;

            // Pre-compute metadata for sorting
            const filesWithMeta = files.map(f => ({
                path: f,
                depth: f.split(path.sep).length,
                priority: FAVICON_PATTERNS.findIndex(p => f.endsWith(p))
            }));

            // Sort using pre-computed values
            filesWithMeta.sort((a, b) => a.depth - b.depth || a.priority - b.priority);

            // Extract sorted paths
            return filesWithMeta.map(f => f.path)[0];
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

    generateInitials(displayName) {
        // SECURITY: Use sanitized initials from svg-sanitizer
        // This method is kept for backward compatibility with tests
        return getCleanInitials(displayName);
    }

    getTypeColor(type, projectName) {
        let bgColor = this.config.typeColors[type];
        if (!bgColor) {
            let hash = 0;
            for (let i = 0; i < projectName.length; i++) {
                hash = projectName.charCodeAt(i) + ((hash << 5) - hash);
            }
            bgColor = this.config.defaultColors[Math.abs(hash) % this.config.defaultColors.length];
        }
        return bgColor;
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
}

module.exports = FaviconService;
