# Logging Standards

This document establishes consistent logging practices across the VS Code Favicon service.

## Log Level Guidelines

### ERROR - Actual Attacks / Security Violations

Use `logger.error()` for confirmed security violations and attack attempts that pose immediate risk:

- **XSS attempts detected** - Malicious SVG content injection
- **Path traversal attacks** - Attempts to access files outside allowed paths
- **Symlink attacks** - Attempts to bypass path restrictions via symlinks
- **Authentication failures** - Invalid admin API keys or IP spoofing
- **Critical system errors** - Database corruption, file permission issues

**Examples:**
```javascript
// SVG XSS detection in svg-sanitizer.js
logger.error(
    { input, sanitized, detected: 'script tag' },
    'XSS attempt detected in SVG content'
);

// Path traversal attempt in path-validator.js
logger.error(
    { input, sanitized, resolved, error: 'path traversal' },
    'Path traversal attack detected'
);
```

### WARN - Suspicious Activity / Validation Failures

Use `logger.warn()` for suspicious behavior and validation failures that may indicate attacks:

- **Path validation failures** - Invalid paths that don't match allowed patterns
- **Rate limit exceeded** - Clients hitting rate limits (potential DoS)
- **Malformed requests** - Invalid input that fails validation
- **Resource exhaustion** - SSE connection limits reached
- **Configuration issues** - Missing or stale cache, degraded services

**Examples:**
```javascript
// Path validation failure in path-validator.js
logger.warn(
    { input, sanitized, resolved },
    'Path validation failed - suspicious input'
);

// Rate limit in server.js
logger.warn(
    { ip: req.ip, path: req.path, limit: 'api' },
    'Rate limit exceeded'
);

// SSE connection limit in server.js
logger.warn(
    { ip: clientIP, connections: currentConnections },
    'SSE connection limit exceeded'
);
```

### INFO - Normal Operations / Audit Trail

Use `logger.info()` for normal operations that should be auditable:

- **Service lifecycle** - Startup, shutdown, initialization
- **Configuration changes** - Cache cleared, registry reloaded
- **Successful operations** - Notifications created/read, cache hits
- **Connection events** - SSE clients connected/disconnected
- **Resource monitoring** - Registry loaded, cleanup completed

**Examples:**
```javascript
// Service startup in server.js
logger.info(
    { port: PORT, environment: config.nodeEnv },
    'VS Code Favicon Unified Service started'
);

// Registry cache loaded in registry-cache.js
logger.info(
    { projectCount, registryPath, ttl },
    'Registry loaded and cached'
);

// Notification created in server.js
logger.info(
    { folder: validatedPath, message },
    'Claude completion notification stored'
);
```

### DEBUG - Development / Troubleshooting

Use `logger.debug()` for detailed information useful during development:

- **Cache operations** - Cache hits/misses, evictions
- **File operations** - Favicon searches, file reads
- **Request details** - Query parameters, headers
- **Performance metrics** - Response times, payload sizes

**Examples:**
```javascript
// Cache warming in registry-cache.js
logger.debug(
    { registryPath: config.registryPath },
    'Warming registry cache'
);

// SSE event sent in server.js
logger.debug(
    { folder: validatedPath, event: event.type },
    'SSE notification sent'
);
```

## Security Event Matrix

| Event Type | Log Level | When to Use | Example |
|------------|-----------|-------------|---------|
| XSS Attempt | ERROR | Malicious content detected | Script/event handler in SVG |
| Path Traversal | ERROR | Directory traversal attempt | `../../../etc/passwd` |
| Symlink Attack | ERROR | Symlink resolves outside allowed | Link to `/etc/passwd` |
| Invalid Path | WARN | Path validation failure | Non-existent or forbidden path |
| Rate Limit Hit | WARN | Client exceeds rate limit | 100+ requests in 15 minutes |
| SSE Overflow | WARN | Too many connections | 5+ concurrent SSE per IP |
| Validation Error | WARN | Input fails validation | Malformed folder parameter |
| Successful Auth | INFO | Admin operation authorized | Cache cleared by admin |
| Service Start | INFO | Process initialization | Server listening on port |
| Normal Operation | INFO | Standard request handled | Favicon generated |

## Context Requirements

All security-related logs must include:

1. **Input** - Original user input (sanitized for logging)
2. **IP Address** - Client IP from request object
3. **Timestamp** - Automatic via logger
4. **Action** - What operation was attempted
5. **Result** - Success or failure reason

**Example:**
```javascript
logger.warn(
    {
        input: folder,
        ip: req.ip,
        path: req.path,
        error: validation.error
    },
    'Path validation failed'
);
```

## Log Message Format

Follow these conventions for log messages:

- **Be specific**: "Rate limit exceeded" not "Too many requests"
- **Use present tense**: "Validation failed" not "Validation has failed"
- **Include context**: "XSS attempt detected in SVG content" not "XSS detected"
- **Avoid technical jargon in ERROR**: Use "Security violation" not "Buffer overflow"
- **No sensitive data**: Never log passwords, API keys, or file contents

## Alerting Configuration

Based on these standards, configure alerting:

- **ERROR logs** - Immediate alert to security team
- **WARN logs** - Aggregate and review hourly
- **INFO logs** - Audit trail only, no alerts
- **DEBUG logs** - Development only, not in production

## Module-Specific Guidelines

### path-validator.js
- **ERROR**: Confirmed attacks (traversal, symlink)
- **WARN**: Validation failures, suspicious paths

### svg-sanitizer.js
- **ERROR**: XSS content detected
- **WARN**: Sanitization applied

### server.js
- **WARN**: Rate limits, SSE limits
- **INFO**: Requests completed, notifications created

### registry-cache.js
- **INFO**: Cache loaded, invalidated
- **DEBUG**: Cache hits/misses

## Migration Checklist

- [ ] Audit all `logger.error()` calls - confirm they indicate attacks
- [ ] Audit all `logger.warn()` calls - confirm they indicate suspicious activity
- [ ] Ensure all security events include required context
- [ ] Update tests to verify log levels
- [ ] Configure monitoring alerts based on levels
- [ ] Document any module-specific exceptions

---

**Last Updated**: 2025-12-08
**Applies To**: VS Code Favicon Service v2.0+
