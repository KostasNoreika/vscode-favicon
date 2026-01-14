/**
 * Favicon updater module
 * Handles favicon fetching, SVG manipulation, badge addition, and grayscale filtering
 */

/**
 * Create favicon updater
 * @param {object} deps - Dependencies
 * @param {object} deps.config - Configuration object with API_BASE, API_TIMEOUT
 * @param {string} deps.folder - Project folder path
 * @param {string} deps.projectName - Project name
 * @param {string} deps.vscodeOrigin - VS Code origin URL
 * @param {Function} deps.getTerminalState - Get terminal open/closed state
 * @param {Function} deps.getNotificationStatus - Get notification status
 * @returns {object} - Favicon updater instance
 */
function createFaviconUpdater(deps) {
    const { config, folder, projectName, vscodeOrigin, getTerminalState, getNotificationStatus } = deps;

    let currentFaviconUrl = null;
    let badgeStatus = 'normal';
    let customFaviconUrl = null; // Cached custom favicon URL from local search
    let customFaviconSearched = false; // Flag to avoid repeated searches
    let ourFaviconHref = null; // Track our favicon to detect VS Code overwrites
    let faviconObserver = null; // MutationObserver for favicon guard

    // Favicon finder disabled - VS Code Server doesn't serve workspace files via HTTP
    // The extension can't access local files, and the server doesn't expose them
    // TODO: Investigate vscode.workspace.fs API or other methods to access files
    const faviconFinder = null;

    /**
     * Search for custom favicon in VS Code Server
     * @returns {Promise<string|null>} - Custom favicon URL or null
     */
    async function findCustomFavicon() {
        if (!faviconFinder) {
            return null;
        }

        // Only search once per session (finder has its own persistent cache)
        if (customFaviconSearched) {
            return customFaviconUrl;
        }

        customFaviconSearched = true;

        try {
            customFaviconUrl = await faviconFinder.findFavicon();
            return customFaviconUrl;
        } catch (error) {
            console.log('Favicon Updater: Custom favicon search failed:', error.message);
            return null;
        }
    }

    /**
     * Fetch favicon - first tries custom favicon, then falls back to API
     * @returns {Promise<string|null>} - Favicon URL or null
     */
    async function fetchFavicon() {
        // First, try to find custom favicon from VS Code Server
        const customFavicon = await findCustomFavicon();
        if (customFavicon) {
            console.log('Favicon Updater: Using custom favicon from project');
            return customFavicon;
        }

        // Fall back to API-generated favicon
        const needsGrayscale = !getTerminalState();
        const grayscaleParam = needsGrayscale ? '&grayscale=true' : '';

        if (!config.API_BASE) {
            console.warn('Favicon Updater: API_BASE not set');
            return null;
        }

        const url = `${config.API_BASE}/favicon-api?folder=${encodeURIComponent(folder)}${grayscaleParam}&origin=${encodeURIComponent(vscodeOrigin)}`;

        try {
            const response = await fetch(url, {
                method: 'GET',
                signal: AbortSignal.timeout(config.API_TIMEOUT)
            });

            if (response.ok) {
                return url;
            }
        } catch (error) {
            // Network error - silently fail
        }
        return null;
    }

    /**
     * Convert hex color to grayscale
     * @param {string} hexColor - Hex color string
     * @returns {string} - Grayscale hex color
     */
    function toGrayscale(hexColor) {
        const hex = hexColor.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);

        const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        const grayHex = gray.toString(16).padStart(2, '0');

        return `#${grayHex}${grayHex}${grayHex}`;
    }

    /**
     * Generate fallback favicon
     * @returns {string} - Data URL for fallback SVG
     */
    function generateFallbackFavicon() {
        const initials = projectName
            .split(/[-_\s]+/)
            .map(word => word[0])
            .join('')
            .toUpperCase()
            .slice(0, 2) || projectName.slice(0, 2).toUpperCase();

        let bgColor = '#45B7D1';
        if (folder.includes('/opt/prod/')) {
            bgColor = '#FF6B6B';
        } else if (folder.includes('/opt/dev/')) {
            bgColor = '#4ECDC4';
        }

        const needsGrayscale = !getTerminalState();
        if (needsGrayscale) {
            const originalColor = bgColor;
            bgColor = toGrayscale(bgColor);
            console.log(`Favicon Updater: Fallback favicon - converting ${originalColor} → ${bgColor} (terminal closed)`);
        }

        const svg = `<svg width="32" height="32" xmlns="http://www.w3.org/2000/svg">
            <rect width="32" height="32" rx="4" fill="${bgColor}"/>
            <text x="16" y="21" text-anchor="middle" fill="white" font-family="Arial" font-size="14" font-weight="bold">${initials}</text>
        </svg>`;

        return 'data:image/svg+xml;base64,' + btoa(svg);
    }

    /**
     * Validate SVG content
     * @param {string} content - SVG content
     * @returns {boolean} - True if valid
     */
    function isValidSVG(content) {
        const dangerous = [/<script/i, /javascript:/i, /on\w+\s*=/i, /<foreignObject/i, /<iframe/i, /<embed/i, /<object/i];
        return !dangerous.some(p => p.test(content)) && /<svg[^>]*>/i.test(content) && /<\/svg>/i.test(content);
    }

    /**
     * Add badge to SVG
     * @param {string} svgContent - SVG content
     * @param {string} badgeType - Badge type (working, completed)
     * @returns {string} - Modified SVG content
     */
    function addBadgeToSVG(svgContent, badgeType = 'completed') {
        if (!isValidSVG(svgContent)) {
            console.warn('Favicon Updater: Invalid SVG content, skipping badge');
            return svgContent;
        }

        const colors = {
            working: '#FFD700',
            completed: '#00E676'
        };
        const fillColor = colors[badgeType] || colors.completed;

        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(svgContent, 'image/svg+xml');
            const svg = doc.documentElement;

            const parseError = svg.querySelector('parsererror');
            if (parseError) {
                console.warn('Favicon Updater: SVG parse error, returning original content');
                return svgContent;
            }

            const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
            style.textContent = '@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } } .status-badge { animation: pulse 1.5s ease-in-out infinite; }';
            defs.appendChild(style);

            svg.insertBefore(defs, svg.firstChild);

            const badgeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            badgeGroup.setAttribute('class', 'status-badge');

            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', '24');
            circle.setAttribute('cy', '8');
            circle.setAttribute('r', '12');
            circle.setAttribute('fill', fillColor);
            circle.setAttribute('stroke', 'white');
            circle.setAttribute('stroke-width', '3');

            badgeGroup.appendChild(circle);
            svg.appendChild(badgeGroup);

            const serializer = new XMLSerializer();
            return serializer.serializeToString(svg);
        } catch (error) {
            console.warn('Favicon Updater: Error adding badge to SVG:', error.message);
            return svgContent;
        }
    }

    /**
     * Apply grayscale filter to SVG
     * @param {string} svgContent - SVG content
     * @returns {string} - Modified SVG content
     */
    function applyGrayscaleFilterToSVG(svgContent) {
        if (!isValidSVG(svgContent)) {
            console.warn('Favicon Updater: Invalid SVG content, skipping grayscale filter');
            return svgContent;
        }

        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(svgContent, 'image/svg+xml');
            const svg = doc.documentElement;

            const parseError = svg.querySelector('parsererror');
            if (parseError) {
                console.warn('Favicon Updater: SVG parse error, returning original content');
                return svgContent;
            }

            let defs = svg.querySelector('defs');
            if (!defs) {
                defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
                svg.insertBefore(defs, svg.firstChild);
            }

            const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
            filter.setAttribute('id', 'grayscale');

            const colorMatrix = document.createElementNS('http://www.w3.org/2000/svg', 'feColorMatrix');
            colorMatrix.setAttribute('type', 'saturate');
            colorMatrix.setAttribute('values', '0');

            filter.appendChild(colorMatrix);
            defs.appendChild(filter);

            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.setAttribute('filter', 'url(#grayscale)');

            while (svg.firstChild && svg.firstChild !== defs) {
                if (svg.firstChild === defs) {
                    break;
                }
                g.appendChild(svg.firstChild);
            }

            while (svg.childNodes.length > 1) {
                g.appendChild(svg.childNodes[1]);
            }

            svg.appendChild(g);

            const serializer = new XMLSerializer();
            return serializer.serializeToString(svg);
        } catch (error) {
            console.warn('Favicon Updater: Error applying grayscale filter to SVG:', error.message);
            return svgContent;
        }
    }

    /**
     * Process PNG/ICO with grayscale and/or badge
     * @param {Blob} blob - Image blob
     * @param {boolean} applyGrayscale - Apply grayscale filter
     * @param {string|null} badgeType - Badge type
     * @returns {Promise<string|null>} - Data URL or null
     */
    async function processPNG(blob, applyGrayscale, badgeType = null) {
        return new Promise((resolve) => {
            const img = new Image();
            const objectUrl = URL.createObjectURL(blob);

            // Cleanup function to revoke Object URL (prevents memory leak)
            const cleanup = () => URL.revokeObjectURL(objectUrl);

            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = 32;
                canvas.height = 32;
                const ctx = canvas.getContext('2d');

                if (applyGrayscale) {
                    ctx.filter = 'grayscale(100%)';
                }

                ctx.drawImage(img, 0, 0, 32, 32);

                ctx.filter = 'none';

                if (badgeType) {
                    const colors = {
                        working: '#FFD700',
                        completed: '#00E676'
                    };
                    const fillColor = colors[badgeType] || colors.completed;

                    ctx.beginPath();
                    ctx.arc(24, 8, 12, 0, 2 * Math.PI);
                    ctx.fillStyle = fillColor;
                    ctx.fill();
                    ctx.strokeStyle = 'white';
                    ctx.lineWidth = 3;
                    ctx.stroke();
                }

                cleanup();
                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = () => {
                cleanup();
                resolve(null);
            };
            img.src = objectUrl;
        });
    }

    /**
     * Convert SVG to PNG using canvas
     * This helps with browser favicon caching issues
     * @param {string} svgText - SVG content
     * @returns {Promise<string|null>} - PNG data URL or null
     */
    async function svgToPng(svgText) {
        return new Promise((resolve) => {
            const img = new Image();

            // Use data URL instead of Blob URL to avoid security restrictions
            const svgBase64 = btoa(unescape(encodeURIComponent(svgText)));
            const dataUrl = 'data:image/svg+xml;base64,' + svgBase64;

            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = 32;
                    canvas.height = 32;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, 32, 32);
                    const pngDataUrl = canvas.toDataURL('image/png');
                    console.log('Favicon Updater: SVG to PNG conversion successful, length:', pngDataUrl.length);
                    resolve(pngDataUrl);
                } catch (e) {
                    console.warn('Favicon Updater: Canvas error:', e.message);
                    resolve(null);
                }
            };

            img.onerror = (e) => {
                console.warn('Favicon Updater: SVG to PNG conversion failed - image load error', e);
                resolve(null);
            };

            img.src = dataUrl;
        });
    }

    /**
     * Set favicon
     * @param {string} url - Favicon URL
     * @param {boolean} isDataUrl - Is data URL
     * @param {string} mimeType - MIME type
     */
    function setFavicon(url, isDataUrl = false, mimeType = 'image/svg+xml') {
        // Remove ALL existing favicon links (including shortcut icon, apple-touch-icon, etc.)
        document.querySelectorAll("link[rel*='icon'], link[rel='shortcut icon'], link[rel='apple-touch-icon']").forEach(link => link.remove());

        const href = isDataUrl ? url : `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;

        // Create primary favicon link
        const link = document.createElement('link');
        link.rel = 'icon';
        link.type = mimeType;
        link.sizes = '32x32';
        if (!isDataUrl) {
            link.crossOrigin = 'anonymous';
        }
        link.href = href;
        document.head.appendChild(link);

        // Also add shortcut icon for older browsers
        const shortcut = document.createElement('link');
        shortcut.rel = 'shortcut icon';
        shortcut.type = mimeType;
        shortcut.href = href;
        document.head.appendChild(shortcut);

        // Store our favicon href for the guard
        ourFaviconHref = href;

        // Force Chrome to refresh favicon by briefly changing title
        const originalTitle = document.title;
        document.title = originalTitle + ' ';
        setTimeout(() => { document.title = originalTitle; }, 100);

        console.log(`Favicon Updater: Set ${badgeStatus || 'normal'}`, {
            href: link.href.substring(0, 100) + (link.href.length > 100 ? '...' : ''),
            type: link.type,
            isDataUrl,
        });
    }

    /**
     * Get badge type based on notification status
     * @returns {string|null} - Badge type or null
     */
    function getBadgeType() {
        return getNotificationStatus();
    }

    /**
     * Update favicon
     * @returns {Promise<void>}
     */
    async function updateFavicon() {
        const apiFavicon = await fetchFavicon();
        const needsGrayscale = !getTerminalState();
        const badgeType = getBadgeType();

        if (badgeType === 'completed') {
            badgeStatus = 'GREEN badge (completed)';
        } else if (badgeType === 'working') {
            badgeStatus = 'YELLOW badge (working)';
        } else if (!getTerminalState()) {
            badgeStatus = 'grayscale (no terminal)';
        } else {
            badgeStatus = 'color (terminal open, idle)';
        }

        console.log(`Favicon Updater: Updating - ${badgeStatus}`);

        if (apiFavicon) {
            try {
                const response = await fetch(apiFavicon);
                const contentType = response.headers.get('content-type') || 'image/x-icon';
                console.log('Favicon Updater: API response', { url: apiFavicon, status: response.status, contentType });

                if (contentType.includes('svg')) {
                    let svgText = await response.text();

                    if (needsGrayscale) {
                        svgText = applyGrayscaleFilterToSVG(svgText);
                    }

                    if (badgeType) {
                        svgText = addBadgeToSVG(svgText, badgeType);
                    }

                    // Convert SVG to PNG for better browser compatibility
                    const pngDataUrl = await svgToPng(svgText);
                    if (pngDataUrl) {
                        setFavicon(pngDataUrl, true, 'image/png');
                    } else {
                        // Fallback to SVG if conversion fails
                        setFavicon('data:image/svg+xml;base64,' + btoa(svgText), true, 'image/svg+xml');
                    }
                } else {
                    const blob = await response.blob();
                    const dataUrl = await processPNG(blob, needsGrayscale, badgeType);
                    if (dataUrl) {
                        setFavicon(dataUrl, true, 'image/png');
                    } else {
                        setFavicon(apiFavicon, false, contentType);
                    }
                }
                currentFaviconUrl = apiFavicon;
            } catch (e) {
                console.error('Favicon Updater: Fetch error:', e.message, e);
                setFavicon(apiFavicon, false, 'image/x-icon');
            }
        } else {
            let svgContent = atob(generateFallbackFavicon().split(',')[1]);
            if (badgeType) {
                svgContent = addBadgeToSVG(svgContent, badgeType);
            }
            // Convert fallback SVG to PNG for better browser compatibility
            const pngDataUrl = await svgToPng(svgContent);
            if (pngDataUrl) {
                setFavicon(pngDataUrl, true, 'image/png');
            } else {
                setFavicon('data:image/svg+xml;base64,' + btoa(svgContent), true, 'image/svg+xml');
            }
        }
    }

    /**
     * Update title to short project name only
     * This keeps tab titles minimal for better organization with tab groups
     */
    function updateTitle() {
        // Set title to just the project name for minimal tab width
        document.title = projectName;
    }

    /**
     * Start watching for favicon changes by VS Code
     * Re-applies our favicon if VS Code tries to change it
     */
    function startFaviconGuard() {
        if (faviconObserver) return; // Already watching

        faviconObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                // Check if a new favicon link was added
                if (mutation.type === 'childList') {
                    for (const node of mutation.addedNodes) {
                        if (node.tagName === 'LINK' && node.rel && node.rel.includes('icon')) {
                            // Check if this is NOT our favicon
                            if (ourFaviconHref && node.href !== ourFaviconHref) {
                                console.log('Favicon Updater: VS Code tried to change favicon, re-applying ours');
                                // Remove VS Code's favicon and re-apply ours
                                node.remove();
                                updateFavicon();
                                return;
                            }
                        }
                    }
                }
            }
        });

        faviconObserver.observe(document.head, {
            childList: true,
            subtree: false
        });

        console.log('Favicon Updater: Favicon guard started');
    }

    return {
        updateFavicon,
        updateTitle,
        startFaviconGuard,
    };
}

// Export for both Node.js and browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createFaviconUpdater };
} else if (typeof window !== 'undefined') {
    window.FaviconUpdater = { createFaviconUpdater };
}
