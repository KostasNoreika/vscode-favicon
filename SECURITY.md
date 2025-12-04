# Security Enhancements

This document describes the security improvements implemented in the VS Code Favicon project.

## 1. Cache Clear Endpoint Authentication (Task 1)

**File:** `vscode-favicon-service/server.js`

**Vulnerability:** The `/api/clear-cache` endpoint was publicly accessible, allowing any client to clear server caches.

**Fix:** Implemented IP whitelist authentication middleware:
- Only allows access from: `127.0.0.1`, `::1`, `192.168.110.199`
- Logs unauthorized access attempts
- Returns 403 Forbidden for non-whitelisted IPs

```javascript
const adminAuth = (req, res, next) => {
    const allowedIPs = ['127.0.0.1', '::1', '192.168.110.199'];
    const clientIP = req.ip || req.connection.remoteAddress;

    if (!allowedIPs.includes(clientIP)) {
        req.log.warn({ ip: clientIP }, 'Unauthorized cache clear attempt');
        return res.status(403).json({ error: 'Forbidden' });
    }

    next();
};

app.post('/api/clear-cache', adminAuth, (req, res) => { ... });
```

**Security Impact:** Prevents unauthorized cache manipulation by external attackers.

---

## 2. Separate Manifest Files for Dev/Prod (Task 2)

**Files:**
- `vscode-favicon-extension/manifest.prod.json` (production - HTTPS only)
- `vscode-favicon-extension/manifest.dev.json` (development - HTTP + HTTPS)
- `vscode-favicon-extension/manifest.json` (default - production version)

**Vulnerability:** Mixed HTTP/HTTPS permissions in production could expose traffic to man-in-the-middle attacks.

**Fix:**
- **Production manifest** (`manifest.prod.json` and `manifest.json`):
  - ONLY HTTPS origins: `https://vs.noreika.lt/*`, `https://favicon-api.noreika.lt/*`
  - No HTTP permissions

- **Development manifest** (`manifest.dev.json`):
  - Includes HTTP for local testing: `http://192.168.110.199:8080/*`, `http://localhost:8080/*`

**Usage:**
```bash
# For production deployment
cp manifest.prod.json manifest.json

# For local development
cp manifest.dev.json manifest.json
```

**Security Impact:** Eliminates mixed-content warnings and ensures all production traffic uses encrypted HTTPS.

---

## 3. SSE Connection Limits per IP (Task 3)

**File:** `vscode-favicon-api/server.js`

**Vulnerability:** Unlimited Server-Sent Events (SSE) connections per IP could enable DoS attacks.

**Fix:** Implemented per-IP connection tracking:
- Maximum 5 concurrent SSE connections per IP address
- Tracks connections in a `Map<IP, count>`
- Returns 429 Too Many Requests when limit exceeded
- Automatically decrements count on client disconnect

```javascript
const sseConnections = new Map(); // IP -> connection count
const MAX_CONNECTIONS_PER_IP = 5;

// On new SSE connection
const currentConnections = sseConnections.get(clientIP) || 0;
if (currentConnections >= MAX_CONNECTIONS_PER_IP) {
    return res.status(429).json({
        error: 'Too many concurrent connections',
        limit: MAX_CONNECTIONS_PER_IP,
    });
}
sseConnections.set(clientIP, currentConnections + 1);

// On disconnect
req.on('close', () => {
    const connections = sseConnections.get(clientIP) || 1;
    if (connections <= 1) {
        sseConnections.delete(clientIP);
    } else {
        sseConnections.set(clientIP, connections - 1);
    }
});
```

**Monitoring:** Health endpoint now includes SSE connection statistics:
```json
{
  "sseConnections": {
    "status": "ok",
    "totalIPs": 3,
    "totalConnections": 8,
    "maxPerIP": 5
  }
}
```

**Security Impact:** Prevents SSE-based DoS attacks by limiting resource consumption per client.

---

## 4. Sanitized Error Messages in Production (Task 4)

**Files:**
- `vscode-favicon-service/server.js`
- `vscode-favicon-api/server.js`

**Vulnerability:** Detailed path validation errors could leak internal directory structure to attackers.

**Fix:** Environment-aware error message sanitization:
- **Production (`NODE_ENV=production`)**: Generic "Access denied" message without details
- **Development**: Full error details for debugging

```javascript
// Before (leaked internal paths)
return res.status(403).json({
    error: 'Access denied: path outside allowed directories',
    details: validation.error  // Always included!
});

// After (sanitized in production)
const errorResponse = {
    error: 'Access denied',
};
if (config.nodeEnv !== 'production') {
    errorResponse.details = validation.error;
}
return res.status(403).json(errorResponse);
```

**Applied to:**
- `/api/favicon` (service)
- `/api/project-info` (service)
- `/favicon-api` (API)
- `/claude-completion` (API)
- `/claude-status` (API)
- `/claude-status/mark-read` (API)
- `DELETE /claude-status` (API)
- `/notifications/stream` (API)

**Security Impact:** Prevents information disclosure attacks by hiding internal directory structure in production.

---

## Testing Security Fixes

### 1. Test Cache Clear Authentication

```bash
# Should fail (external IP)
curl -X POST http://localhost:8080/api/clear-cache

# Should succeed (localhost)
curl -X POST http://127.0.0.1:8080/api/clear-cache

# Should succeed (whitelisted IP)
curl -X POST http://192.168.110.199:8080/api/clear-cache
```

### 2. Test Manifest Isolation

```bash
# Check production manifest (should have ONLY HTTPS)
jq '.host_permissions' manifest.json

# Check dev manifest (should include HTTP)
jq '.host_permissions' manifest.dev.json
```

### 3. Test SSE Connection Limits

```bash
# Open 6 simultaneous SSE connections from same IP
# First 5 should succeed, 6th should return 429
for i in {1..6}; do
  curl -N http://localhost:8091/notifications/stream?folder=/opt/tools/test &
done

# Check health endpoint for connection stats
curl http://localhost:8091/health | jq '.components.sseConnections'
```

### 4. Test Error Message Sanitization

```bash
# Development (NODE_ENV=development) - should show details
curl "http://localhost:8080/api/favicon?folder=../../etc/passwd"

# Production (NODE_ENV=production) - should hide details
NODE_ENV=production curl "http://localhost:8080/api/favicon?folder=../../etc/passwd"
```

---

## Security Checklist

- [x] Admin endpoints protected by IP whitelist
- [x] Production manifests use HTTPS-only permissions
- [x] SSE connections limited per IP (5 max)
- [x] Error messages sanitized in production
- [x] All path traversal attempts logged
- [x] Rate limiting on all API endpoints
- [x] Input validation on all endpoints
- [x] CORS whitelist enforced
- [x] Helmet security headers enabled
- [x] JSON body size limited (10KB)

---

## Threat Model Coverage

| Threat | Mitigation | Status |
|--------|-----------|--------|
| Unauthorized cache manipulation | IP whitelist on `/api/clear-cache` | ✅ Fixed |
| Man-in-the-middle attacks | HTTPS-only in production manifests | ✅ Fixed |
| SSE-based DoS attacks | Per-IP connection limits (5 max) | ✅ Fixed |
| Information disclosure | Sanitized error messages in production | ✅ Fixed |
| Path traversal attacks | Path validation + logging | ✅ Already implemented |
| Rate limit bypass | Per-IP rate limiting | ✅ Already implemented |
| XSS attacks | Helmet CSP headers | ✅ Already implemented |
| CSRF attacks | CORS whitelist | ✅ Already implemented |

---

## Future Enhancements

1. **API Key Authentication:** Replace IP whitelist with API key authentication for `/api/clear-cache`
2. **Distributed Rate Limiting:** Use Redis for rate limiting across multiple service instances
3. **Anomaly Detection:** Monitor SSE connection patterns for suspicious behavior
4. **Security Audit Logging:** Centralized logging of all security events to SIEM system
5. **Automated Security Scanning:** Integrate Snyk/Dependabot for dependency vulnerability scanning
