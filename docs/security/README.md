# Security Documentation

This directory contains security policies, vulnerability fixes, and security best practices for the VS Code Favicon project.

## Security Fixes

### December 2025

| Date | Vulnerability | CVSS | Status | Details |
|------|---------------|------|--------|---------|
| 2025-12-03 | CORS Misconfiguration (CWE-942) | 8.6 | FIXED | [SECURITY_FIX_CORS.md](SECURITY_FIX_CORS.md) |

## Active Security Policies

- **[CORS Policy](cors-policy.md)** - Cross-Origin Resource Sharing configuration and allowed origins
- **Path Validation** - `/lib/path-validator.js` - Prevents path traversal attacks
- **Rate Limiting** - `/lib/rate-limiter.js` - DDoS protection and abuse prevention

## Security Controls by Layer

### 1. Network Layer
- **Cloudflare Proxy:** DDoS protection, WAF, rate limiting
- **Firewall:** Mac Studio local firewall (ports 8090, 8091 not exposed externally)
- **HTTPS:** TLS 1.3 enforced by Cloudflare

### 2. Application Layer
- **CORS Validation:** Strict origin whitelist (lib/cors-config.js)
- **Path Traversal Protection:** Whitelist-based path validation (lib/path-validator.js)
- **Rate Limiting:** 100 req/15min per IP for general API, 10 req/min for notifications
- **Input Validation:** All user inputs sanitized and validated

### 3. Data Layer
- **No Authentication Required:** API is read-only for favicon generation
- **No Sensitive Data:** Project metadata only (paths, names, ports)
- **No Database:** In-memory storage for notifications

## Threat Model

### Assets
1. **Project metadata** (paths, names, ports)
2. **Favicon cache** (generated SVG/image files)
3. **Notification state** (Claude completion messages)

### Threats Mitigated
- **Path Traversal (CWE-22):** Prevented by whitelist validation
- **CORS Misconfiguration (CWE-942):** Fixed with strict origin whitelist
- **DDoS Attacks:** Rate limiting + Cloudflare protection
- **Cache Poisoning:** Vary: Origin header prevents CORS cache attacks

### Residual Risks
- **Enumeration:** Attackers can guess project paths (low risk - metadata only)
- **Resource Exhaustion:** Memory cache could grow unbounded (mitigated by LRU eviction)
- **Information Disclosure:** Project names/ports visible via API (accepted risk)

## Security Testing

### Manual Testing
```bash
# Test CORS validation
cd /opt/tools/vscode-favicon
node -e "
const { corsMiddleware, ALLOWED_ORIGINS } = require('./lib/cors-config');
console.log('Allowed Origins:', ALLOWED_ORIGINS);
"

# Test path validation
node -e "
const { validatePath } = require('./lib/path-validator');
console.log('Valid path:', validatePath('/opt/tools/vscode-favicon'));
console.log('Invalid path:', validatePath('/etc/passwd'));
"
```

### Automated Testing
```bash
# CORS tests
npm test -- cors-config.test.js

# Path validation tests
npm test -- path-validator.test.js
```

## Vulnerability Disclosure

If you discover a security vulnerability:

1. **DO NOT** open a public GitHub issue
2. **Email:** kostas@noreika.lt
3. **Include:**
   - Description of vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if available)

We will respond within 48 hours and coordinate disclosure.

## Security Checklist for Development

Before deploying changes:

- [ ] All user inputs validated and sanitized
- [ ] No new CORS origins added without security review
- [ ] Path validation applied to all file system operations
- [ ] Rate limiting configured for new endpoints
- [ ] No secrets/credentials in code
- [ ] Error messages don't leak sensitive information
- [ ] HTTPS enforced (Cloudflare)
- [ ] Security documentation updated

## References

### OWASP Top 10 2021
- **A01:2021 - Broken Access Control:** Mitigated by path validation
- **A03:2021 - Injection:** Prevented by input sanitization
- **A05:2021 - Security Misconfiguration:** Fixed CORS wildcard
- **A07:2021 - Identification and Authentication Failures:** N/A (no auth)

### CWE Coverage
- **CWE-22:** Path Traversal (PROTECTED)
- **CWE-942:** CORS Misconfiguration (FIXED)
- **CWE-400:** Uncontrolled Resource Consumption (MITIGATED)

### External Resources
- [OWASP CORS Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Origin_Resource_Sharing_Cheat_Sheet.html)
- [OWASP Path Traversal](https://owasp.org/www-community/attacks/Path_Traversal)
- [OWASP Rate Limiting](https://cheatsheetseries.owasp.org/cheatsheets/Denial_of_Service_Cheat_Sheet.html)

## Security Contact

**Security Lead:** Kostas Noreika
**Email:** kostas@noreika.lt
**Response Time:** 48 hours
