const fs = require('fs');
const path = require('path');
const fg = require('fast-glob');
const { getCleanInitials, sanitizePort } = require('../svg-sanitizer');

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
        for (const pattern of FAVICON_PATTERNS) {
            for (const dir of COMMON_PATHS) {
                const fullPath = path.join(projectPath, dir, pattern);
                try {
                    await fs.promises.access(fullPath, fs.constants.R_OK);
                    return fullPath;
                } catch {
                    // Continue searching
                }
            }
        }
        return null;
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

            // Sort by priority: shorter path = closer to root = higher priority
            files.sort((a, b) => {
                const depthA = a.split(path.sep).length;
                const depthB = b.split(path.sep).length;
                if (depthA !== depthB) return depthA - depthB;

                const patternIndexA = FAVICON_PATTERNS.findIndex(p => a.endsWith(p));
                const patternIndexB = FAVICON_PATTERNS.findIndex(p => b.endsWith(p));
                return patternIndexA - patternIndexB;
            });

            return files[0];
        } catch {
            return null;
        }
    }

    /**
     * @deprecated Use findFaviconFile() instead - this method uses fixed config paths
     * This legacy method is kept for backward compatibility with tests/benchmarks
     */
    buildSearchPaths(projectPath) {
        // Legacy method - kept for backward compatibility
        const paths = [];
        for (const faviconPath of this.config.faviconSearchPaths) {
            paths.push(path.join(projectPath, faviconPath));
        }
        for (const pattern of this.config.faviconImagePatterns) {
            for (const dir of this.config.faviconImageDirs) {
                paths.push(path.join(projectPath, dir, pattern));
            }
        }
        return paths;
    }

    generateSvgFavicon(projectName, projectInfo = {}) {
        const displayName = projectInfo.name || projectName;
        const type = projectInfo.type || 'dev';
        const port = projectInfo.port || '';

        // SECURITY: Use sanitized initials generation from svg-sanitizer
        const initials = getCleanInitials(displayName);
        const bgColor = this.getTypeColor(type, projectName);

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

    async getFavicon(projectPath) {
        const cacheKey = `favicon_${projectPath}`;
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

        const svg = this.generateSvgFavicon(projectName, projectInfo);
        const result = {
            contentType: 'image/svg+xml',
            data: Buffer.from(svg),
        };

        this.faviconCache.set(cacheKey, result);
        return result;
    }
}

module.exports = FaviconService;
