// VS Code Server Dynamic Favicon Extension v2.0
// Reliable polling-based notification system (no SSE - works through any CDN/proxy)
// Features: Claude CLI completion notifications with red badge

(function() {
    'use strict';

    console.log('VS Code Favicon Extension v2.0: Starting');

    // Configuration
    const CONFIG = {
        API_BASE: 'https://favicon-api.noreika.lt',
        POLL_ACTIVE: 5000,      // 5 seconds when tab is active
        POLL_INACTIVE: 30000,   // 30 seconds when tab is inactive
        POLL_ERROR: 60000,      // 60 seconds after error (backoff)
        API_TIMEOUT: 5000,      // 5 second timeout for API calls
        MAX_ERRORS: 5,          // Max consecutive errors before longer backoff
    };

    // Extract project folder from URL
    const urlParams = new URLSearchParams(window.location.search);
    const folder = urlParams.get('folder');

    if (!folder) {
        console.log('VS Code Favicon: No folder parameter found');
        return;
    }

    const projectName = folder.split('/').pop();
    console.log('VS Code Favicon: Project:', projectName);

    // State
    let hasNotification = false;
    let pollTimer = null;
    let consecutiveErrors = 0;
    let currentFaviconUrl = null;

    // ==========================================================================
    // FAVICON MANAGEMENT
    // ==========================================================================

    async function fetchFavicon() {
        const url = `${CONFIG.API_BASE}/favicon-api?folder=${encodeURIComponent(folder)}`;

        try {
            const response = await fetch(url, {
                method: 'GET',
                signal: AbortSignal.timeout(CONFIG.API_TIMEOUT)
            });

            if (response.ok) {
                return url;
            }
        } catch (error) {
            console.log('VS Code Favicon: API error:', error.message);
        }
        return null;
    }

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

        const svg = `<svg width="32" height="32" xmlns="http://www.w3.org/2000/svg">
            <rect width="32" height="32" rx="4" fill="${bgColor}"/>
            <text x="16" y="21" text-anchor="middle" fill="white" font-family="Arial" font-size="14" font-weight="bold">${initials}</text>
        </svg>`;

        return 'data:image/svg+xml;base64,' + btoa(svg);
    }

    // Security: Validate SVG before manipulation
    function isValidSVG(content) {
        const dangerous = [/<script/i, /javascript:/i, /on\w+\s*=/i, /<foreignObject/i, /<iframe/i, /<embed/i, /<object/i];
        return !dangerous.some(p => p.test(content)) && /<svg[^>]*>/i.test(content) && /<\/svg>/i.test(content);
    }

    function addBadgeToSVG(svgContent) {
        if (!isValidSVG(svgContent)) return svgContent;

        const badge = `
            <defs>
                <style>
                    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
                    .notify-badge { animation: pulse 1.2s ease-in-out infinite; }
                </style>
            </defs>`;

        const badgeCircle = `
            <g class="notify-badge">
                <circle cx="24" cy="8" r="9" fill="#FF0000" stroke="white" stroke-width="2"/>
                <circle cx="24" cy="8" r="4" fill="white"/>
            </g>`;

        let result = svgContent.replace(/(<svg[^>]*>)/i, `$1${badge}`);
        result = result.replace(/<\/svg>/i, `${badgeCircle}</svg>`);
        return result;
    }

    async function addBadgeToPNG(blob) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = 32;
                canvas.height = 32;
                const ctx = canvas.getContext('2d');

                ctx.drawImage(img, 0, 0, 32, 32);

                // Red badge
                ctx.beginPath();
                ctx.arc(24, 8, 8, 0, 2 * Math.PI);
                ctx.fillStyle = '#FF0000';
                ctx.fill();
                ctx.strokeStyle = 'white';
                ctx.lineWidth = 2;
                ctx.stroke();

                // White center
                ctx.beginPath();
                ctx.arc(24, 8, 3, 0, 2 * Math.PI);
                ctx.fillStyle = 'white';
                ctx.fill();

                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = () => resolve(null);
            img.src = URL.createObjectURL(blob);
        });
    }

    function setFavicon(url, isDataUrl = false, mimeType = 'image/svg+xml') {
        document.querySelectorAll("link[rel*='icon']").forEach(link => link.remove());

        const link = document.createElement('link');
        link.rel = 'icon';
        link.type = mimeType;
        link.href = isDataUrl ? url : `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
        document.head.appendChild(link);

        console.log(`VS Code Favicon: Set ${hasNotification ? 'with badge' : 'normal'}`);
    }

    async function updateFavicon() {
        const apiFavicon = await fetchFavicon();

        if (apiFavicon) {
            try {
                const response = await fetch(apiFavicon);
                const contentType = response.headers.get('content-type') || 'image/x-icon';

                if (contentType.includes('svg')) {
                    let svgText = await response.text();
                    if (hasNotification) {
                        svgText = addBadgeToSVG(svgText);
                    }
                    setFavicon('data:image/svg+xml;base64,' + btoa(svgText), true, 'image/svg+xml');
                } else if (contentType.includes('png') && hasNotification) {
                    const blob = await response.blob();
                    const dataUrl = await addBadgeToPNG(blob);
                    if (dataUrl) {
                        setFavicon(dataUrl, true, 'image/png');
                    } else {
                        setFavicon(apiFavicon, false, 'image/png');
                    }
                } else {
                    setFavicon(apiFavicon, false, contentType);
                }
                currentFaviconUrl = apiFavicon;
            } catch (e) {
                console.log('VS Code Favicon: Fetch error:', e.message);
                setFavicon(apiFavicon, false, 'image/x-icon');
            }
        } else {
            let fallback = generateFallbackFavicon();
            if (hasNotification) {
                const svgContent = atob(fallback.split(',')[1]);
                fallback = 'data:image/svg+xml;base64,' + btoa(addBadgeToSVG(svgContent));
            }
            setFavicon(fallback, true, 'image/svg+xml');
        }
    }

    function updateTitle() {
        let prefix = `[${projectName}]`;
        if (folder.includes('/opt/prod/')) {
            prefix = `[PROD: ${projectName}]`;
        } else if (folder.includes('/opt/dev/')) {
            prefix = `[DEV: ${projectName}]`;
        }

        if (!document.title.includes(prefix)) {
            document.title = `${prefix} ${document.title}`;
        }
    }

    // ==========================================================================
    // NOTIFICATION POLLING
    // ==========================================================================

    async function checkNotification() {
        const url = `${CONFIG.API_BASE}/claude-status?folder=${encodeURIComponent(folder)}`;

        try {
            const response = await fetch(url, {
                method: 'GET',
                signal: AbortSignal.timeout(CONFIG.API_TIMEOUT)
            });

            if (response.ok) {
                const data = await response.json();
                consecutiveErrors = 0;

                const hadNotification = hasNotification;
                hasNotification = data.hasNotification === true;

                if (hadNotification !== hasNotification) {
                    console.log(`VS Code Favicon: Notification ${hasNotification ? 'RECEIVED' : 'cleared'}`);
                    await updateFavicon();
                }

                return true;
            }
        } catch (error) {
            consecutiveErrors++;
            console.log(`VS Code Favicon: Poll error (${consecutiveErrors}):`, error.message);
        }

        return false;
    }

    async function markAsRead() {
        if (!hasNotification) return;

        try {
            await fetch(`${CONFIG.API_BASE}/claude-status/mark-read`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folder }),
                signal: AbortSignal.timeout(CONFIG.API_TIMEOUT)
            });

            hasNotification = false;
            console.log('VS Code Favicon: Marked as read');
            await updateFavicon();
        } catch (error) {
            console.log('VS Code Favicon: Mark read error:', error.message);
        }
    }

    function getNextPollInterval() {
        // Long backoff after too many errors
        if (consecutiveErrors >= CONFIG.MAX_ERRORS) {
            return CONFIG.POLL_ERROR * 2;
        }

        // Short backoff after error
        if (consecutiveErrors > 0) {
            return CONFIG.POLL_ERROR;
        }

        // Normal intervals based on tab visibility
        return document.hidden ? CONFIG.POLL_INACTIVE : CONFIG.POLL_ACTIVE;
    }

    function schedulePoll() {
        if (pollTimer) {
            clearTimeout(pollTimer);
        }

        const interval = getNextPollInterval();
        pollTimer = setTimeout(async () => {
            await checkNotification();
            schedulePoll();
        }, interval);
    }

    // ==========================================================================
    // INITIALIZATION
    // ==========================================================================

    async function initialize() {
        // Initial setup
        await updateFavicon();
        updateTitle();

        // Initial notification check
        await checkNotification();

        // Start polling
        schedulePoll();

        console.log(`VS Code Favicon: Initialized (poll: ${CONFIG.POLL_ACTIVE/1000}s active, ${CONFIG.POLL_INACTIVE/1000}s inactive)`);

        // Visibility change - adjust polling and check immediately
        document.addEventListener('visibilitychange', async () => {
            if (!document.hidden) {
                // Tab became visible - check immediately and reset polling
                console.log('VS Code Favicon: Tab visible - checking now');
                await checkNotification();
                schedulePoll();

                // Mark as read if focused and has notification
                if (document.hasFocus() && hasNotification) {
                    setTimeout(() => {
                        if (document.hasFocus() && hasNotification) {
                            markAsRead();
                        }
                    }, 200);
                }
            }
        });

        // Window focus - mark notification as read
        window.addEventListener('focus', () => {
            if (hasNotification) {
                setTimeout(() => {
                    if (document.hasFocus() && hasNotification) {
                        markAsRead();
                    }
                }, 200);
            }
        });

        // Cleanup on unload
        window.addEventListener('beforeunload', () => {
            if (pollTimer) {
                clearTimeout(pollTimer);
            }
        });
    }

    // Start
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

})();
