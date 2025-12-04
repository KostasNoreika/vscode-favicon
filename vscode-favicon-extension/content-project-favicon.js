// VS Code Server Dynamic Favicon Extension - Uses Project's Own Favicon
// Priority: 1) Project's favicon.ico, 2) Generate if not found
// Features: Claude CLI completion notifications with red badge
// Optimized: SSE with exponential backoff polling fallback (30s to 5min)

(function() {
    'use strict';

    console.log('VS Code Favicon Extension: Starting');

    // Configuration constants
    const CONSTANTS = {
        POLL_BASE_INTERVAL: 30000,      // 30 seconds
        POLL_MAX_INTERVAL: 300000,      // 5 minutes
        POLL_BACKOFF_MULTIPLIER: 1.5,
        SSE_RECONNECT_DELAY: 5000,      // 5 seconds
        SSE_MAX_RECONNECT_ATTEMPTS: 3,
        API_TIMEOUT: 3000,              // 3 seconds
    };

    // Extract project folder from URL
    const urlParams = new URLSearchParams(window.location.search);
    const folder = urlParams.get('folder');

    if (!folder) {
        console.log('VS Code Favicon: No folder parameter found');
        return;
    }

    const projectName = folder.split('/').pop();
    console.log('VS Code Favicon: Processing project:', projectName);

    // Track notification state
    let hasNotification = false;
    let notificationTimeout = null;
    let eventSource = null;

    // Exponential backoff configuration
    let pollInterval = CONSTANTS.POLL_BASE_INTERVAL; // Start with base interval

    // SSE configuration
    const USE_SSE = true; // Feature flag for SSE
    let sseReconnectAttempts = 0;

    // Try to get favicon from API first
    async function tryApiFavicon() {
        // Only use HTTPS API (no HTTP fallback to avoid mixed content)
        const apiUrl = 'https://favicon-api.noreika.lt/favicon-api';

        console.log(`VS Code Favicon: Trying API: ${apiUrl}?folder=${folder}`);

        try {
            const response = await fetch(`${apiUrl}?folder=${encodeURIComponent(folder)}`, {
                method: 'GET',
                signal: AbortSignal.timeout(CONSTANTS.API_TIMEOUT)
            });

            if (response.ok) {
                console.log(`VS Code Favicon: API responded successfully`);
                return `${apiUrl}?folder=${encodeURIComponent(folder)}`;
            } else {
                console.log(`VS Code Favicon: API responded with status ${response.status}`);
            }
        } catch (error) {
            console.log(`VS Code Favicon: API failed:`, error.message);
        }

        return null;
    }

    // Generate fallback favicon only if project doesn't have one
    function generateFallbackFavicon() {
        const initials = projectName
            .split(/[-_\s]+/)
            .map(word => word[0])
            .join('')
            .toUpperCase()
            .slice(0, 2) || projectName.slice(0, 2).toUpperCase();

        // Color based on project type
        let bgColor = '#45B7D1'; // default blue
        if (folder.includes('/opt/prod/')) {
            bgColor = '#FF6B6B'; // red for production
        } else if (folder.includes('/opt/dev/')) {
            bgColor = '#4ECDC4'; // teal for development
        }

        const svgFavicon = `
            <svg width="32" height="32" xmlns="http://www.w3.org/2000/svg">
                <rect width="32" height="32" rx="4" fill="${bgColor}"/>
                <text x="16" y="21" text-anchor="middle" fill="white" font-family="Arial" font-size="14" font-weight="bold">
                    ${initials}
                </text>
            </svg>
        `;

        const svgDataUrl = 'data:image/svg+xml;base64,' + btoa(svgFavicon);
        console.log(`VS Code Favicon: Generated fallback favicon with initials ${initials}`);
        return svgDataUrl;
    }

    // Check for Claude CLI completion notifications
    async function checkNotifications() {
        const apiUrl = 'https://favicon-api.noreika.lt/claude-status';

        console.log(`VS Code Favicon: Checking notifications for folder: ${folder} (interval: ${pollInterval/1000}s)`);

        try {
            const response = await fetch(`${apiUrl}?folder=${encodeURIComponent(folder)}`, {
                method: 'GET',
                signal: AbortSignal.timeout(CONSTANTS.API_TIMEOUT)
            });

            if (response.ok) {
                const data = await response.json();
                console.log('VS Code Favicon: Notification response:', data);

                const prevHasNotification = hasNotification;
                hasNotification = data.hasNotification;

                // If notification received, reset polling interval to base
                if (hasNotification && !prevHasNotification) {
                    console.log(`VS Code Favicon: New notification received - resetting poll interval to ${CONSTANTS.POLL_BASE_INTERVAL/1000}s`);
                    pollInterval = CONSTANTS.POLL_BASE_INTERVAL;
                    setupFavicon();
                } else if (prevHasNotification !== hasNotification) {
                    console.log(`VS Code Favicon: Notification status changed from ${prevHasNotification} to ${hasNotification}`);
                    setupFavicon();
                } else if (hasNotification) {
                    console.log('VS Code Favicon: Notification still active');
                }

                // Return true if notification exists
                return hasNotification;
            } else {
                console.log(`VS Code Favicon: API returned status ${response.status}`);
                return false;
            }
        } catch (error) {
            console.log('VS Code Favicon: Failed to check notifications:', error.message);
            return false;
        }
    }

    // Start polling with exponential backoff
    async function startPolling() {
        try {
            const hasNotif = await checkNotifications();

            if (hasNotif) {
                // Reset to base interval when notification is found
                pollInterval = CONSTANTS.POLL_BASE_INTERVAL;
            } else {
                // Increase interval with backoff multiplier when no notifications
                const newInterval = Math.min(pollInterval * CONSTANTS.POLL_BACKOFF_MULTIPLIER, CONSTANTS.POLL_MAX_INTERVAL);
                if (newInterval !== pollInterval) {
                    console.log(`VS Code Favicon: No notifications - increasing poll interval from ${pollInterval/1000}s to ${newInterval/1000}s`);
                }
                pollInterval = newInterval;
            }
        } catch (error) {
            console.log('VS Code Favicon: Error in polling:', error.message);
        } finally {
            // Schedule next poll
            notificationTimeout = setTimeout(startPolling, pollInterval);
        }
    }


    // Setup SSE connection for real-time notifications
    function setupSSE() {
        if (!USE_SSE) {
            console.log('VS Code Favicon: SSE disabled, using polling only');
            return false;
        }

        const sseUrl = `https://favicon-api.noreika.lt/notifications/stream?folder=${encodeURIComponent(folder)}`;
        console.log(`VS Code Favicon: Attempting SSE connection to ${sseUrl}`);

        try {
            eventSource = new EventSource(sseUrl);

            eventSource.addEventListener('connected', (event) => {
                console.log('VS Code Favicon: SSE connected', JSON.parse(event.data));
                sseReconnectAttempts = 0; // Reset reconnect counter on success

                // Stop polling when SSE is active
                if (notificationTimeout) {
                    clearTimeout(notificationTimeout);
                    notificationTimeout = null;
                }
            });

            eventSource.addEventListener('notification', (event) => {
                const data = JSON.parse(event.data);
                console.log('VS Code Favicon: SSE notification received:', data);

                const prevHasNotification = hasNotification;
                hasNotification = data.hasNotification;

                if (prevHasNotification !== hasNotification) {
                    console.log(`VS Code Favicon: Notification status changed via SSE to ${hasNotification}`);
                    setupFavicon();
                }
            });

            eventSource.onerror = (error) => {
                console.log('VS Code Favicon: SSE error', error);
                eventSource.close();
                eventSource = null;

                // Fallback to polling if SSE fails repeatedly
                sseReconnectAttempts++;
                if (sseReconnectAttempts >= CONSTANTS.SSE_MAX_RECONNECT_ATTEMPTS) {
                    console.log(`VS Code Favicon: SSE failed ${CONSTANTS.SSE_MAX_RECONNECT_ATTEMPTS} times, falling back to polling`);
                    startPolling();
                } else {
                    console.log(`VS Code Favicon: SSE reconnect attempt ${sseReconnectAttempts} in ${CONSTANTS.SSE_RECONNECT_DELAY/1000}s`);
                    setTimeout(setupSSE, CONSTANTS.SSE_RECONNECT_DELAY);
                }
            };

            return true;
        } catch (error) {
            console.log('VS Code Favicon: Failed to setup SSE:', error.message);
            return false;
        }
    }

    // Mark notification as read when tab becomes visible
    async function markNotificationAsRead() {
        if (!hasNotification) return;

        const apiUrl = 'https://favicon-api.noreika.lt/claude-status/mark-read';

        try {
            // Mark both global and folder-specific as read
            await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folder, global: true }),
                signal: AbortSignal.timeout(CONSTANTS.API_TIMEOUT)
            });

            hasNotification = false;
            console.log('VS Code Favicon: Notification marked as read (global and local)');
            setupFavicon(); // Update favicon to remove badge
        } catch (error) {
            console.log('VS Code Favicon: Failed to mark as read:', error.message);
        }
    }

    // SECURITY: Validate SVG content before manipulation to prevent XSS
    function isValidSVG(svgContent) {
        // Reject SVG with dangerous elements
        const dangerousPatterns = [
            /<script/i,
            /javascript:/i,
            /on\w+\s*=/i,  // onclick, onerror, onload, etc.
            /<foreignObject/i,
            /<iframe/i,
            /<embed/i,
            /<object/i,
        ];

        for (const pattern of dangerousPatterns) {
            if (pattern.test(svgContent)) {
                console.log('VS Code Favicon: Rejected unsafe SVG content');
                return false;
            }
        }

        // Validate basic SVG structure
        if (!/<svg[^>]*>/i.test(svgContent) || !/<\/svg>/i.test(svgContent)) {
            console.log('VS Code Favicon: Invalid SVG structure');
            return false;
        }

        return true;
    }

    // Add red notification badge to SVG favicon - OPTIMIZED with string operations
    function addNotificationBadge(svgContent) {
        if (!hasNotification) {
            console.log('VS Code Favicon: No notification, not adding badge');
            return svgContent;
        }

        // SECURITY: Validate SVG before manipulation
        if (!isValidSVG(svgContent)) {
            console.log('VS Code Favicon: SVG validation failed, returning original');
            return svgContent;
        }

        console.log('VS Code Favicon: Adding notification badge');

        // Badge SVG elements to inject
        const badgeDefs = `
                <style>
                    @keyframes strongPulse {
                        0%, 100% {
                            opacity: 1;
                            transform: scale(1);
                        }
                        50% {
                            opacity: 0.3;
                            transform: scale(0.95);
                        }
                    }
                    .badge-group {
                        animation: strongPulse 1s ease-in-out infinite;
                        transform-origin: 24px 8px;
                    }
                </style>
            `;

        const badgeGroup = `
            <g class="badge-group">
                <circle cx="24" cy="8" r="9" fill="#FF0000" stroke="white" stroke-width="2"/>
                <circle cx="24" cy="8" r="4" fill="white"/>
            </g>`;

        // Fast string operations instead of DOMParser
        // 1. Insert defs with animation styles after opening <svg> tag
        let result = svgContent.replace(
            /(<svg[^>]*>)/i,
            `$1<defs>${badgeDefs}</defs>`
        );

        // 2. Insert badge group before closing </svg> tag
        result = result.replace(
            /<\/svg>/i,
            `${badgeGroup}</svg>`
        );

        return result;
    }

    // Set favicon in the page (modified to handle badge)
    function setFavicon(faviconUrl, isDataUrl = false) {
        // Remove all existing favicon links first
        const existingLinks = document.querySelectorAll("link[rel*='icon']");
        existingLinks.forEach(link => link.remove());

        // Create new favicon link
        const link = document.createElement('link');
        link.rel = 'icon';
        link.type = 'image/svg+xml';

        // For data URLs, use directly; for URLs, add cache buster
        if (isDataUrl) {
            link.href = faviconUrl;
        } else {
            const cacheBuster = Date.now();
            link.href = faviconUrl + (faviconUrl.includes('?') ? '&' : '?') + 't=' + cacheBuster;
        }

        document.head.appendChild(link);
        console.log(`VS Code Favicon: Favicon set for ${projectName} ${hasNotification ? 'with notification badge' : ''}`);
    }

    // Update page title
    function updateTitle() {
        let prefix = `[${projectName}]`;
        if (folder.includes('/opt/prod/')) {
            prefix = `[PROD: ${projectName}]`;
        } else if (folder.includes('/opt/dev/')) {
            prefix = `[DEV: ${projectName}]`;
        }

        if (!document.title.includes(prefix)) {
            document.title = `${prefix} ${document.title}`;
            console.log(`VS Code Favicon: Title updated with ${prefix}`);
        }
    }

    // Main execution
    async function setupFavicon() {
        // First, try the favicon API (handles both project favicons and generation)
        const apiFavicon = await tryApiFavicon();

        if (apiFavicon) {
            // If we have a notification, we need to add badge to any favicon type
            if (hasNotification) {
                try {
                    const response = await fetch(apiFavicon);
                    const contentType = response.headers.get('content-type');

                    if (contentType && contentType.includes('svg')) {
                        // SVG - can modify directly
                        const svgText = await response.text();
                        const modifiedSvg = addNotificationBadge(svgText);
                        const dataUrl = 'data:image/svg+xml;base64,' + btoa(modifiedSvg);
                        setFavicon(dataUrl, true);
                    } else {
                        // ICO/PNG - use API URL directly, overlay badge with CSS later
                        setFavicon(apiFavicon);
                        // For non-SVG, we'd need canvas to overlay badge (future enhancement)
                    }
                } catch (e) {
                    setFavicon(apiFavicon);
                }
            } else {
                setFavicon(apiFavicon);
            }
            console.log('VS Code Favicon: Using API favicon (project or generated)');
        } else {
            // Fallback to local generation if API is unavailable
            let fallbackFavicon = generateFallbackFavicon();

            // Add badge if needed (fallback is already base64 SVG)
            if (hasNotification) {
                const svgContent = atob(fallbackFavicon.split(',')[1]);
                const modifiedSvg = addNotificationBadge(svgContent);
                fallbackFavicon = 'data:image/svg+xml;base64,' + btoa(modifiedSvg);
            }

            setFavicon(fallbackFavicon, true);
            console.log('VS Code Favicon: API unavailable, using local fallback');
        }

        updateTitle();
    }

    // Initialize
    async function initialize() {
        // Setup favicon first
        await setupFavicon();

        // Try SSE first for real-time notifications
        const sseConnected = setupSSE();

        // If SSE fails immediately, fall back to polling
        if (!sseConnected) {
            console.log('VS Code Favicon: SSE not available, starting polling');
            // Check for notifications first
            await checkNotifications();
            // Start exponential backoff polling
            notificationTimeout = setTimeout(startPolling, pollInterval);
        }

        console.log(`VS Code Favicon: Initialized with ${sseConnected ? 'SSE' : 'polling'} (base interval: ${CONSTANTS.POLL_BASE_INTERVAL/1000}s, max: ${CONSTANTS.POLL_MAX_INTERVAL/1000}s)`);

        // Track if tab is already focused
        let isTabFocused = document.hasFocus();

        // Listen for tab visibility changes
        document.addEventListener('visibilitychange', () => {
            console.log(`VS Code Favicon: Visibility changed to: ${document.visibilityState}, has notification: ${hasNotification}`);
            if (document.visibilityState === 'visible' && hasNotification) {
                // Small delay to ensure tab is truly focused
                setTimeout(() => {
                    if (document.hasFocus()) {
                        markNotificationAsRead();
                    }
                }, 100);
            }
        });

        // Listen for window focus - immediate check and reset polling interval
        window.addEventListener('focus', async () => {
            console.log(`VS Code Favicon: Window focused`);

            // If using polling (not SSE), reset interval and check immediately
            if (!eventSource) {
                console.log(`VS Code Favicon: Resetting poll interval and checking immediately`);
                // Clear current timeout and reset interval
                if (notificationTimeout) {
                    clearTimeout(notificationTimeout);
                }
                pollInterval = CONSTANTS.POLL_BASE_INTERVAL;

                // Immediate check on focus
                await checkNotifications();

                // Restart polling
                notificationTimeout = setTimeout(startPolling, pollInterval);
            }

            // Mark as read if notification exists
            if (!isTabFocused && hasNotification) {
                isTabFocused = true;
                setTimeout(() => {
                    if (document.hasFocus() && hasNotification) {
                        markNotificationAsRead();
                    }
                }, 100);
            }
        });

        // Track when window loses focus
        window.addEventListener('blur', () => {
            isTabFocused = false;
        });

        // Cleanup on page unload
        window.addEventListener('beforeunload', () => {
            if (notificationTimeout) {
                clearTimeout(notificationTimeout);
            }
            if (eventSource) {
                eventSource.close();
            }
        });
    }

    initialize();

    // Also retry after page load
    window.addEventListener('load', () => {
        setTimeout(() => {
            if (eventSource) {
                // SSE is handling notifications
                console.log('VS Code Favicon: Page loaded, SSE active');
            } else {
                // Using polling, do a check
                checkNotifications();
            }
            setupFavicon();
        }, 1000);
    });

})();
