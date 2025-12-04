# Path Validator Module

## Overview

The `path-validator` module provides secure path validation to prevent directory traversal attacks and other path-based vulnerabilities in the VS Code Favicon system.

## Installation

The module is located at `/opt/tools/vscode-favicon/lib/path-validator.js` and is used by both:
- `vscode-favicon-service` (port 8090)
- `vscode-favicon-api` (port 8091)

## Usage

### Basic Example

```javascript
const { isPathAllowed, validatePath } = require('../lib/path-validator');

// Simple boolean check
if (isPathAllowed('/opt/dev/my-project')) {
    // Path is safe to use
    console.log('Access granted');
} else {
    // Path is malicious or outside allowed directories
    console.log('Access denied');
}

// Detailed validation with error information
const validation = validatePath('/opt/dev/../../etc/passwd');
if (validation.valid) {
    console.log('Safe path:', validation.resolved);
} else {
    console.error('Security violation:', validation.error);
}
```

### Integration in Express

```javascript
const express = require('express');
const { validatePath } = require('../lib/path-validator');

const app = express();

app.get('/api/resource', (req, res) => {
    const folder = req.query.folder;

    // Validate path
    const validation = validatePath(folder);
    if (!validation.valid) {
        console.error(`[SECURITY] ${validation.error}`, {
            input: folder,
            sanitized: validation.sanitized
        });
        return res.status(403).json({
            error: 'Access denied: path outside allowed directories',
            details: validation.error
        });
    }

    // Use validated path
    const safePath = validation.resolved;
    // ... continue with safe path
});
```

## API Reference

### Functions

#### `isPathAllowed(folder: string): boolean`

Validates if a given path is within allowed directories.

**Parameters**:
- `folder` (string): User-provided path to validate

**Returns**:
- `true` if path is safe and within allowed directories
- `false` if path is malicious or outside allowed directories

**Example**:
```javascript
isPathAllowed('/opt/dev/my-project')  // true
isPathAllowed('/opt/dev/../../etc')   // false
```

#### `validatePath(folder: string): ValidationResult`

Detailed validation with error information.

**Parameters**:
- `folder` (string): User-provided path to validate

**Returns**: `ValidationResult` object
```typescript
{
    valid: boolean,
    error?: string,
    sanitized?: string,
    resolved?: string
}
```

**Example**:
```javascript
const result = validatePath('/opt/dev/test');
// {
//   valid: true,
//   sanitized: '/opt/dev/test',
//   resolved: '/opt/dev/test'
// }

const result = validatePath('/opt/dev/../../etc');
// {
//   valid: false,
//   error: 'Directory traversal pattern detected',
//   sanitized: null
// }
```

#### `sanitizePath(folder: string): string | null`

Sanitizes and decodes user input.

**Parameters**:
- `folder` (string): Raw user input

**Returns**:
- Sanitized path string if valid
- `null` if input is malicious or invalid

**Example**:
```javascript
sanitizePath('%2Fopt%2Fdev%2Fproject')  // '/opt/dev/project'
sanitizePath('/opt/dev/../../etc')      // null
```

### Constants

#### `ALLOWED_PATHS: string[]`

Array of allowed root directories.

```javascript
const ALLOWED_PATHS = ['/opt/dev', '/opt/prod', '/opt/research'];
```

## Security Features

### 1. URL Decoding

Automatically decodes URL-encoded paths and detects double-encoding attempts:

```javascript
// Single encoding - OK
sanitizePath('%2Fopt%2Fdev%2Fproject')
// Returns: '/opt/dev/project'

// Double encoding - BLOCKED
sanitizePath('%252Fopt%252Fdev')
// Returns: null
// Logs: [SECURITY] Double URL encoding detected
```

### 2. Null Byte Protection

Blocks null byte injection in both raw and URL-encoded forms:

```javascript
isPathAllowed('/opt/dev/project\0malicious')  // false
isPathAllowed('/opt/dev/project%00test')      // false
```

### 3. Directory Traversal Protection

Blocks all directory traversal patterns:

```javascript
isPathAllowed('/opt/dev/../etc')              // false
isPathAllowed('/opt/dev/../../root')          // false
isPathAllowed('/opt/dev/./../../tmp')         // false
```

### 4. Symlink Resolution

Resolves symbolic links before validation:

```bash
# Create malicious symlink
ln -s /etc /opt/dev/malicious

# Validator resolves symlink and blocks access
isPathAllowed('/opt/dev/malicious')  // false
# Logs: [SECURITY] Symlink resolved outside allowed paths
```

### 5. Regex Pattern Validation

Only allows alphanumeric, dash, underscore, and dot:

```javascript
isPathAllowed('/opt/dev/my-project')     // true
isPathAllowed('/opt/dev/project_v2')     // true
isPathAllowed('/opt/dev/test;malicious') // false
isPathAllowed('/opt/dev/cmd|inject')     // false
```

### 6. Path Prefix Confusion Prevention

Uses `path.sep` to prevent prefix confusion:

```javascript
isPathAllowed('/opt/dev')           // true
isPathAllowed('/opt/dev/project')   // true
isPathAllowed('/opt/devmalicious')  // false
```

## Configuration

### Allowed Directories

To add or remove allowed directories, modify `ALLOWED_PATHS` in `lib/path-validator.js`:

```javascript
const ALLOWED_PATHS = [
    '/opt/dev',
    '/opt/prod',
    '/opt/research',
    '/opt/staging'  // Add new directory
];
```

### Regex Pattern

To modify allowed characters in directory names, update `PATH_REGEX`:

```javascript
// Current: alphanumeric, dash, underscore, dot
const PATH_REGEX = /^\/opt\/(dev|prod|research)(\/[\w\-\.]+)*$/;

// Example: Allow spaces (NOT RECOMMENDED)
const PATH_REGEX = /^\/opt\/(dev|prod|research)(\/[\w\-\.\s]+)*$/;
```

## Testing

### Run Security Tests

```bash
cd /opt/tools/vscode-favicon
npm test
```

### Test Coverage

```bash
npm run test:coverage
```

### Test Specific Scenarios

```bash
# Test only path-validator
npm run test:security

# Watch mode for development
npm run test:watch
```

### Manual Testing

```bash
# Test with curl
curl -v "http://localhost:8090/api/favicon?folder=/opt/dev/../../etc/passwd"
# Expected: HTTP 403 Forbidden

curl -v "http://localhost:8090/api/favicon?folder=/opt/dev/my-project"
# Expected: HTTP 200 OK
```

## Error Handling

### Security Warnings

All security violations are logged with `[SECURITY]` prefix:

```javascript
[SECURITY] Directory traversal pattern detected: /opt/dev/../../etc
[SECURITY] Double URL encoding detected: %252e%252e
[SECURITY] Null byte injection attempt: /opt/dev/test%00
[SECURITY] Path failed regex validation: /opt/dev/test;cmd
[SECURITY] Symlink resolved outside allowed paths: /opt/dev/link -> /etc
```

### Monitor Security Events

```bash
# Real-time monitoring
pm2 logs vscode-favicon-service | grep SECURITY

# Historical logs
grep SECURITY ~/.pm2/logs/vscode-favicon-service-out.log
```

## Performance

### Caching Considerations

The validator does **NOT** cache results because:
1. Validation is fast (< 1ms per call)
2. Filesystem state can change (symlinks, mounts)
3. Security-critical code should not be cached

### Benchmark

```javascript
const { performance } = require('perf_hooks');

const start = performance.now();
isPathAllowed('/opt/dev/my-project');
const end = performance.now();

console.log(`Validation took ${end - start}ms`);
// Typical: 0.1 - 0.5ms
```

## Migration Guide

### From Old Validation Logic

**Before** (VULNERABLE):
```javascript
const normalizedPath = path.resolve(folder);
const allowedPaths = ['/opt/dev', '/opt/prod'];

const isAllowed = allowedPaths.some(allowed => {
    return normalizedPath.startsWith(allowed);
});
```

**After** (SECURE):
```javascript
const { validatePath } = require('../lib/path-validator');

const validation = validatePath(folder);
if (!validation.valid) {
    return res.status(403).json({ error: validation.error });
}

// Use validation.resolved for safe path
```

## Troubleshooting

### Issue: Valid paths are blocked

**Symptom**: Legitimate paths like `/opt/dev/my-project` return 403

**Solutions**:
1. Check if path exists: `ls -la /opt/dev/my-project`
2. Check for symlinks: `ls -laL /opt/dev/my-project`
3. Verify regex pattern allows path characters
4. Check logs for specific security warning

### Issue: Symlink is blocked

**Symptom**: Symlinked project directory returns 403

**Explanation**: This is **intentional** security behavior. Symlinks are resolved and validated.

**Solutions**:
1. **Recommended**: Use real paths instead of symlinks
2. **Alternative**: Create symlink inside allowed directory:
   ```bash
   # BAD: Symlink to outside directory
   ln -s /home/user/project /opt/dev/project

   # GOOD: Real project inside allowed directory
   mv /home/user/project /opt/dev/project
   ```

### Issue: Unicode paths are blocked

**Symptom**: Paths with non-ASCII characters return 403

**Explanation**: Security policy restricts to ASCII alphanumeric + dash/underscore

**Solutions**:
1. Rename directories to use ASCII only
2. If Unicode is required, update `PATH_REGEX` (carefully!)

## Best Practices

### DO ✓

- Always validate user input before filesystem operations
- Use `validatePath()` for detailed error information
- Log all security violations
- Monitor security logs regularly
- Test with attack vectors after any changes

### DON'T ✗

- Don't bypass validation for "trusted" input
- Don't cache validation results
- Don't suppress security warnings
- Don't modify regex without security review
- Don't allow symlinks to untrusted locations

## Examples

### Example 1: File Download

```javascript
app.get('/api/download', (req, res) => {
    const folder = req.query.folder;
    const filename = req.query.file;

    // Validate folder path
    const validation = validatePath(folder);
    if (!validation.valid) {
        return res.status(403).json({ error: validation.error });
    }

    // Construct safe file path
    const safePath = path.join(validation.resolved, filename);

    // Double-check final path is still within allowed directory
    if (!isPathAllowed(safePath)) {
        return res.status(403).json({ error: 'Invalid file path' });
    }

    res.sendFile(safePath);
});
```

### Example 2: Directory Listing

```javascript
app.get('/api/list', (req, res) => {
    const folder = req.query.folder;

    const validation = validatePath(folder);
    if (!validation.valid) {
        return res.status(403).json({ error: validation.error });
    }

    try {
        const files = fs.readdirSync(validation.resolved);
        res.json({ files });
    } catch (error) {
        res.status(500).json({ error: 'Failed to read directory' });
    }
});
```

### Example 3: Middleware

```javascript
const { validatePath } = require('../lib/path-validator');

function validateFolderMiddleware(req, res, next) {
    const folder = req.query.folder || req.body.folder;

    if (!folder) {
        return res.status(400).json({ error: 'Folder parameter required' });
    }

    const validation = validatePath(folder);
    if (!validation.valid) {
        console.error(`[SECURITY] ${validation.error}`, {
            ip: req.ip,
            user: req.user?.id,
            input: folder
        });
        return res.status(403).json({ error: 'Access denied' });
    }

    // Attach validated path to request
    req.validatedPath = validation.resolved;
    next();
}

// Use middleware
app.get('/api/resource', validateFolderMiddleware, (req, res) => {
    // req.validatedPath is safe to use
    const safePath = req.validatedPath;
    // ...
});
```

## Support

For security issues or questions:
- Email: security@noreika.lt
- Documentation: `/opt/tools/vscode-favicon/docs/SECURITY.md`
- Tests: `/opt/tools/vscode-favicon/tests/path-validator.test.js`
