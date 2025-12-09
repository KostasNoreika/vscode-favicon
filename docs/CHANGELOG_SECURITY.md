# Security Enhancements Changelog

## 2025-12-04 - Security Hardening Release

### Summary
Implemented four critical security enhancements to prevent unauthorized access, DoS attacks, information disclosure, and mixed-content vulnerabilities.

---

### Task 1: Cache Clear Endpoint Authentication ✅

**File:** `vscode-favicon-service/server.js`

**Changes:**
- Added `adminAuth` middleware function (lines ~379-390)
- Protected `/api/clear-cache` endpoint with IP whitelist
- Updated startup logging to show admin IP whitelist

**Whitelist:** `127.0.0.1`, `::1`, `192.168.110.199`

**Code:**
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

**Impact:**
- ✅ Prevents unauthorized cache manipulation
- ✅ Logs all unauthorized access attempts
- ✅ Clear audit trail for security monitoring

---

### Task 2: Separate Manifest Files for Dev/Prod ✅

**Files Created:**
- `vscode-favicon-extension/manifest.prod.json` - Production (HTTPS only)
- `vscode-favicon-extension/manifest.dev.json` - Development (HTTP + HTTPS)

**File Updated:**
- `vscode-favicon-extension/manifest.json` - Now uses production configuration

**Changes:**

**Production Manifest** (`manifest.prod.json` and `manifest.json`):
```json
{
  "host_permissions": [
    "https://vs.noreika.lt/*",
    "https://favicon-api.noreika.lt/*"
  ],
  "content_scripts": [
    {
      "matches": [
        "https://vs.noreika.lt/*"
      ]
    }
  ]
}
```

**Development Manifest** (`manifest.dev.json`):
```json
{
  "name": "VS Code Server Project Favicons (DEV)",
  "host_permissions": [
    "https://vs.noreika.lt/*",
    "https://favicon-api.noreika.lt/*",
    "http://192.168.110.199:8080/*",
    "http://192.168.110.199:8091/*",
    "http://localhost:8080/*"
  ]
}
```

**Impact:**
- ✅ Eliminates mixed-content warnings in production
- ✅ All production traffic uses encrypted HTTPS
- ✅ Maintains development flexibility with local HTTP support

---

### Task 3: SSE Connection Limits per IP ✅

**File:** `vscode-favicon-api/server.js`

**Changes:**
- Added `sseConnections` Map for tracking connections per IP (line ~134)
- Added `MAX_CONNECTIONS_PER_IP = 5` constant (line ~135)
- Implemented connection limit check in `/notifications/stream` endpoint (lines ~320-334)
- Automatic cleanup on client disconnect (lines ~413-424)
- Added SSE statistics to health endpoint (lines ~268-273)

**Code:**
```javascript
// Global connection tracking
const sseConnections = new Map(); // IP -> connection count
const MAX_CONNECTIONS_PER_IP = 5;

// Connection limit enforcement
const clientIP = req.ip || req.connection.remoteAddress;
const currentConnections = sseConnections.get(clientIP) || 0;

if (currentConnections >= MAX_CONNECTIONS_PER_IP) {
    req.log.warn({ ip: clientIP, connections: currentConnections }, 'SSE connection limit exceeded');
    return res.status(429).json({
        error: 'Too many concurrent connections',
        limit: MAX_CONNECTIONS_PER_IP,
    });
}

sseConnections.set(clientIP, currentConnections + 1);

// Cleanup on disconnect
req.on('close', () => {
    const connections = sseConnections.get(clientIP) || 1;
    if (connections <= 1) {
        sseConnections.delete(clientIP);
    } else {
        sseConnections.set(clientIP, connections - 1);
    }
});
```

**Health Endpoint Enhancement:**
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

**Impact:**
- ✅ Prevents SSE-based DoS attacks
- ✅ Limits resource consumption to 5 connections per IP
- ✅ Real-time monitoring via health endpoint
- ✅ Automatic connection cleanup

---

### Task 4: Sanitized Error Messages in Production ✅

**Files:** Both `vscode-favicon-service/server.js` and `vscode-favicon-api/server.js`

**Endpoints Modified:**

**Service (`vscode-favicon-service/server.js`):**
- `/api/favicon` (lines ~202-217)
- `/api/project-info` (lines ~295-310)

**API (`vscode-favicon-api/server.js`):**
- `/favicon-api` (lines ~208-223)
- `/claude-completion` (lines ~426-441)
- `/claude-status` (lines ~476-491)
- `/claude-status/mark-read` (lines ~532-547)
- `DELETE /claude-status` (lines ~582-597)
- `/notifications/stream` (lines ~327-342)

**Code Pattern:**
```javascript
// BEFORE (always leaks details)
return res.status(403).json({
    error: 'Access denied: path outside allowed directories',
    details: validation.error  // Always exposed!
});

// AFTER (sanitized in production)
const errorResponse = {
    error: 'Access denied',
};
if (config.nodeEnv !== 'production') {
    errorResponse.details = validation.error;
}
return res.status(403).json(errorResponse);
```

**Examples:**

**Development Response:**
```json
{
  "error": "Access denied",
  "details": "Path /etc/passwd is outside allowed directories [/opt/dev, /opt/prod, /opt/research]"
}
```

**Production Response:**
```json
{
  "error": "Access denied"
}
```

**Impact:**
- ✅ Prevents information disclosure in production
- ✅ Hides internal directory structure from attackers
- ✅ Maintains debugging capability in development
- ✅ Applied consistently across all 8 validation endpoints

---

## Testing Performed

### 1. Syntax Validation
```bash
# Service server
cd vscode-favicon-service && node server.js
# ✅ Server starts successfully

# API server
cd vscode-favicon-api && node server.js
# ✅ Server starts successfully
```

### 2. Manifest Validation
```bash
jq '.host_permissions' manifest.json
# ✅ Returns only HTTPS URLs
```

### 3. Code Review
- ✅ All middleware functions properly chained
- ✅ Connection tracking uses correct IP extraction
- ✅ Environment variable checks use `config.nodeEnv`
- ✅ Logging statements include relevant context

---

## Files Modified

1. `vscode-favicon-service/server.js` - Added IP auth + sanitized errors
2. `vscode-favicon-api/server.js` - Added SSE limits + sanitized errors
3. `vscode-favicon-extension/manifest.json` - Changed to HTTPS-only

## Files Created

1. `vscode-favicon-extension/manifest.prod.json` - Production manifest
2. `vscode-favicon-extension/manifest.dev.json` - Development manifest
3. `SECURITY.md` - Security documentation
4. `CHANGELOG_SECURITY.md` - This file

---

## Deployment Checklist

- [x] Service server modified with IP auth
- [x] API server modified with SSE limits
- [x] Both servers sanitize errors in production
- [x] Production manifest uses HTTPS only
- [x] Development manifest available for local testing
- [x] Security documentation created
- [x] Changelog created
- [ ] Restart services with new code
- [ ] Test cache clear endpoint with non-whitelisted IP (should fail)
- [ ] Test SSE connection limit (6th connection should fail)
- [ ] Verify error messages in production mode
- [ ] Update browser extension with new manifest

---

## Security Posture Improvement

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Public admin endpoints | 1 | 0 | ✅ 100% secured |
| HTTP permissions in prod | Yes | No | ✅ HTTPS-only |
| SSE DoS protection | None | 5/IP | ✅ Resource limited |
| Error info leakage | High | None | ✅ Sanitized |

---

## Next Steps

1. **Deploy to Production:**
   ```bash
   # Restart services
   pm2 restart vscode-favicon-service
   pm2 restart vscode-favicon-api

   # Reload browser extension
   chrome://extensions -> Developer mode -> Reload
   ```

2. **Monitoring:**
   - Watch logs for "Unauthorized cache clear attempt" warnings
   - Monitor SSE connection stats in health endpoint
   - Track 403 error rate for suspicious activity

3. **Future Enhancements:**
   - Replace IP whitelist with API key authentication
   - Implement distributed rate limiting with Redis
   - Add anomaly detection for SSE patterns
   - Centralized security event logging
