const fs = require('fs');
const path = require('path');

class FaviconService {
    constructor({ config, registryCache, faviconCache }) {
        this.config = config;
        this.registryCache = registryCache;
        this.faviconCache = faviconCache;
    }

    async findFaviconFile(projectPath) {
        const possiblePaths = this.buildSearchPaths(projectPath);

        const CONCURRENCY_LIMIT = 5;
        for (let i = 0; i < possiblePaths.length; i += CONCURRENCY_LIMIT) {
            const batch = possiblePaths.slice(i, i + CONCURRENCY_LIMIT);
            const checks = batch.map(async (fullPath) => {
                try {
                    await fs.promises.access(fullPath, fs.constants.R_OK);
                    return fullPath;
                } catch {
                    return null;
                }
            });

            const results = await Promise.all(checks);
            const found = results.find((r) => r !== null);
            if (found) return found;
        }

        return null;
    }

    buildSearchPaths(projectPath) {
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

        const initials = this.generateInitials(displayName);
        const bgColor = this.getTypeColor(type, projectName);
        const portText = this.generatePortText(type, port);

        return `<svg width="32" height="32" xmlns="http://www.w3.org/2000/svg">
        <rect width="32" height="32" rx="4" fill="${bgColor}"/>
        <text x="16" y="21" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-size="14" font-weight="bold">
            ${initials}
        </text>
        ${portText}
    </svg>`;
    }

    generateInitials(displayName) {
        return (
            displayName
                .split(/[-_\s]+/)
                .map((word) => word[0])
                .join('')
                .toUpperCase()
                .slice(0, 2) || displayName.slice(0, 2).toUpperCase()
        );
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

    generatePortText(type, port) {
        return type === 'dev' && port
            ? `<text x="16" y="30" text-anchor="middle" fill="white" font-family="monospace" font-size="6" opacity="0.8">${port}</text>`
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
