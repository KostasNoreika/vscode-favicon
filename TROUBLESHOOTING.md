# Troubleshooting Guide

## Issue: Favicons showing fallback (letters) instead of custom icons

### Symptoms
- Browser console shows `net::ERR_FAILED 530` errors
- CORS errors: "No 'Access-Control-Allow-Origin' header"
- Favicons display project initials instead of PNG/SVG icons

### Root Cause
Cloudflare tunnel not running or wrong tunnel active.

Two tunnels exist:
1. **Config-based** (`7a498d84-84bc-47c1-bbb3-14386ab9a457`) - has `favicon-api.noreika.lt` route
2. **Remotely-managed** (token-based) - may NOT have favicon-api route

### Solution

1. Check if correct tunnel is running:
```bash
curl -sI "https://favicon-api.noreika.lt/health" | head -3
# Should return HTTP/2 200, not 530
```

2. If 530 error, start the config-based tunnel:
```bash
nohup /opt/homebrew/bin/cloudflared tunnel --config /opt/cloudflare-tunnel/mac-studio-local.yml run > /tmp/cloudflared-config.log 2>&1 &
```

3. Verify tunnel is connected:
```bash
tail -20 /tmp/cloudflared-config.log
# Look for "Registered tunnel connection" messages
```

4. Test favicon endpoint:
```bash
curl -sI "https://favicon-api.noreika.lt/favicon-api?folder=/opt/dev/app-pos-api" | head -5
# Should return HTTP/2 200, content-type: image/png
```

### Additional Fix Applied (2025-12-08)

CORS middleware was positioned AFTER rate limiters in `src/server.js`. This caused 429 responses to lack CORS headers, triggering browser blocks.

**Fix:** Moved `app.use(corsMiddleware)` BEFORE rate limiter middleware so all responses (including 429) include CORS headers.

```javascript
// CORRECT ORDER:
app.use(corsMiddleware);           // CORS first
app.use('/api/', apiLimiter);      // Rate limiters after
app.use('/favicon-api', apiLimiter);
```

## Issue: Clicking notification doesn't switch to correct tab

### Symptoms
- Click on notification in floating panel
- Nothing happens, or wrong tab is activated
- Console shows "Tab not found for folder"

### Root Cause (Fixed 2025-12-08)
The `SWITCH_TO_TAB` handler in `background.js` had weak folder path matching:
- Only checked if URL had trailing slash, not notification folder
- Missing URL decoding on notification folder
- No error handling for malformed URLs

### Solution Applied
Updated `background.js` to normalize both sides:

```javascript
// Before (broken):
if (urlFolder === targetFolder ||
    urlFolder === targetFolder + '/' ||
    decodeURIComponent(urlFolder || '') === targetFolder)

// After (fixed):
const normalizedTarget = decodeURIComponent(targetFolder || '').replace(/\/+$/, '');
const normalizedUrlFolder = (urlFolder || '').replace(/\/+$/, '');
if (normalizedUrlFolder === normalizedTarget)
```

### Debugging
If issue recurs, check browser console:
```
VS Code Favicon: Switching to tab: /opt/dev/project
VS Code Favicon: Switch tab response: {success: true, tabId: 123}
```

Check background script console (Extensions → Inspect service worker):
```
VS Code Favicon BG: Tab not found for folder: /path (normalized: /path)
```
