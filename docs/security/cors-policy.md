# CORS Security Policy

## Overview

This document describes the Cross-Origin Resource Sharing (CORS) security configuration for the VS Code Favicon services.

## Implementation

**Module:** `/opt/tools/vscode-favicon/lib/cors-config.js`

**Applied to:**
- `vscode-favicon-api/server.js` (port 8091)
- `vscode-favicon-service/server.js` (port 8090)

## Allowed Origins

| Origin | Environment | Purpose |
|--------|-------------|---------|
| `https://vs.noreika.lt` | Production | VS Code Server web interface |
| `https://favicon-api.noreika.lt` | Production | API subdomain (cross-service) |
| `http://localhost:8080` | Development | Local VS Code development |
| `http://192.168.110.199:8080` | Development | Mac Studio LAN access |
| `http://192.168.110.199:8091` | Development | API direct access (testing) |

## Security Controls

### 1. Origin Whitelist Validation

```javascript
const ALLOWED_ORIGINS = [
    'https://vs.noreika.lt',
    'https://favicon-api.noreika.lt',
    'http://localhost:8080',
    'http://192.168.110.199:8080',
    'http://192.168.110.199:8091'
];
```

**Protection:** Only whitelisted origins receive CORS headers. Unknown origins are rejected by the browser.

### 2. Dynamic Origin Header

```javascript
if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
}
```

**Protection:** Sets `Access-Control-Allow-Origin` to the **specific requesting origin**, not `*` wildcard.

### 3. Vary: Origin Header

```javascript
res.setHeader('Vary', 'Origin');
```

**Protection:** Prevents cache poisoning by ensuring cached responses are keyed by origin.

### 4. Proper Preflight Handling

```javascript
if (req.method === 'OPTIONS') {
    return res.sendStatus(204); // No Content
}
```

**Protection:** Returns HTTP 204 for preflight requests (OPTIONS), proper HTTP semantics.

## Vulnerabilities Mitigated

| CVE/CWE | Severity | Description | Mitigation |
|---------|----------|-------------|------------|
| CWE-942 | High | CORS Misconfiguration | Whitelist validation replaces wildcard |
| - | Medium | Data Exfiltration | Untrusted sites cannot access API |
| - | Medium | CSRF Attacks | Origin validation prevents cross-site requests |
| - | Low | Cache Poisoning | Vary: Origin header prevents response reuse |

## Previous Configuration (VULNERABLE)

**vscode-favicon-api/server.js (lines 30-42):**

```javascript
// VULNERABLE - DO NOT USE
res.setHeader('Access-Control-Allow-Origin', '*');
```

**Risk:** Any website could access the API, enabling:
- Data exfiltration of project information
- Unauthorized favicon generation
- CSRF attacks on POST/DELETE endpoints

**CVSS Score:** 8.6 (High)

## Testing CORS

### Valid Origin (Should Work)

```bash
curl -H "Origin: https://vs.noreika.lt" \
     -H "Access-Control-Request-Method: GET" \
     -X OPTIONS \
     http://localhost:8091/favicon-api

# Expected: 204 No Content
# Expected Headers:
#   Access-Control-Allow-Origin: https://vs.noreika.lt
#   Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS
#   Vary: Origin
```

### Invalid Origin (Should Fail)

```bash
curl -H "Origin: https://evil.com" \
     -H "Access-Control-Request-Method: GET" \
     -X OPTIONS \
     http://localhost:8091/favicon-api

# Expected: 204 No Content
# Expected: NO CORS headers (browser will block)
```

### Actual Request

```bash
curl -H "Origin: https://vs.noreika.lt" \
     http://localhost:8091/favicon-api?folder=/opt/tools/vscode-favicon

# Expected: 200 OK with CORS headers
```

## Adding New Origins

**DO NOT** add origins without security review. Follow this process:

1. **Identify the origin:** Full URL including protocol and port
2. **Justify the need:** Why does this origin need API access?
3. **Security review:** Is the origin under your control?
4. **Update whitelist:** Add to `ALLOWED_ORIGINS` in `lib/cors-config.js`
5. **Test:** Verify CORS works and rejects unknown origins
6. **Document:** Update this file with the new origin

## Production Deployment

When deploying behind Cloudflare:

1. **DO NOT** rely on Cloudflare for CORS - implement in application
2. **DO NOT** use `Access-Control-Allow-Origin: *` behind proxy
3. **VERIFY** that origin headers are passed through by proxy
4. **TEST** CORS validation after deployment

## References

- [OWASP CORS Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Origin_Resource_Sharing_Cheat_Sheet.html)
- [MDN CORS Documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)
- [CWE-942: Overly Permissive CORS Policy](https://cwe.mitre.org/data/definitions/942.html)

## Security Contact

For security issues related to CORS configuration, contact: kostas@noreika.lt
