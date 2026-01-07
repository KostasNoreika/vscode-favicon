# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VS Code Favicon is a Node.js service that generates unique project-specific favicons for VS Code Server instances. It helps distinguish between multiple browser tabs when working with remote code-server environments.

**Key features:**
- Automatic favicon generation based on project name/type
- Environment-based color coding (dev=teal, prod=red, staging=yellow)
- Claude AI completion notifications via SSE
- Custom favicon detection (searches project for existing favicon files)
- LRU caching with configurable TTL
- Browser extension for favicon injection

## Commands

```bash
# Development
npm run dev          # Start with nodemon (auto-reload)
npm start            # Start production server

# Testing
npm test             # Run all tests
npm run test:unit    # Run unit tests only
npm run test:integration  # Run integration tests only
npm run test:coverage # Run with coverage report
npm run test:security # Run path-validator security tests

# Single test file
npx jest tests/unit/path-validator.test.js

# Debugging tests
npm run test:verbose  # Verbose output
npm run test:debug    # Run with debugger attached

# Code quality
npm run lint         # ESLint check
npm run lint:fix     # ESLint auto-fix
npm run format       # Prettier format
npm run quality      # Run format:check + lint + test:coverage

# PM2 production management
npm run pm2:start    # Start via PM2
npm run pm2:restart  # Restart service
npm run pm2:logs     # View logs
npm run pm2:status   # Check status

# Deployment (Mac Studio)
./scripts/deploy.sh           # Full deploy (pull, install, test, reload)
./scripts/deploy.sh --skip-tests  # Quick deploy without tests
```

## Deployment Architecture

**Single production instance on prod-vm:**

| Instance | Location | Port | Domain | CI/CD |
|----------|----------|------|--------|-------|
| prod-vm | `/home/kostas/tools/vscode-favicon` | 8024 | favicon-api.noreika.lt | Auto via Gitea Actions |

**Cloudflare tunnel** routes `favicon-api.noreika.lt` → `localhost:8024` on prod-vm.

**PM2 Management:**
```bash
# On prod-vm
cd ~/tools/vscode-favicon
npx pm2 start ecosystem.vm.config.js
npx pm2 save
npx pm2 logs vscode-favicon-vm
```

## Architecture

### Entry Point
- `src/server.js` - Unified Express server (port 8024 on prod-vm)

### Core Modules (lib/)
| Module | Purpose |
|--------|---------|
| `path-validator.js` | **SECURITY-CRITICAL** - Path traversal/symlink protection |
| `validators.js` | Request validation using express-validator with path-validator |
| `validators/config-validators.js` | Modular configuration validation functions |
| `errors.js` | Custom error classes (FileNotFoundError, PermissionError, ValidationError) |
| `svg-sanitizer.js` | XSS-safe SVG generation for favicons |
| `cors-config.js` | Strict CORS policy with origin whitelist |
| `config.js` | Centralized env-based configuration with startup validation |
| `lru-cache.js` | In-memory LRU cache implementation |
| `registry-cache.js` | Async project registry loader with file watching |
| `notification-store.js` | Persistent notification storage with TTL |
| `logger.js` | Structured logging with Pino (JSON prod, pretty dev) |
| `response-helpers.js` | HTTP response utilities with security headers |
| `services/favicon-service.js` | Favicon search and generation logic |
| `services/file-validator.js` | File type and magic byte validation |
| `services/file-uploader.js` | Secure file upload handling |
| `services/file-content-validators.js` | Content validation utilities |

### Middleware & Routes (lib/)
| Directory | Purpose |
|-----------|---------|
| `middleware/setup.js` | Centralized Express middleware (Helmet, CORS, rate limiting, compression) |
| `middleware/rate-limiters.js` | Rate limiter factory functions for different endpoint types |
| `routes/favicon-routes.js` | Favicon generation endpoints |
| `routes/notification-routes.js` | Claude notification and SSE endpoints |
| `routes/paste-routes.js` | Image upload endpoint for clipboard paste |
| `routes/health-routes.js` | Health check endpoints (liveness, readiness) |
| `routes/admin-routes.js` | Admin-only endpoints (cache clear) |
| `lifecycle/shutdown.js` | Graceful shutdown with resource cleanup |

### Browser Extension
`vscode-favicon-extension/` - Chrome extension for favicon injection:
- `manifest.json` - Extension manifest (v3)
- `content-project-favicon.js` - Main content script
- `background.js` - Service worker
- `popup.js/html` - Extension popup UI
- `modules/` - Modular utilities:
  - `terminal-detector.js`, `terminal-selectors.js` - Terminal activity detection
  - `notification-poller.js`, `notification-panel.js` - Claude notifications
  - `clipboard-handler.js` - Paste image functionality
  - `favicon-updater.js`, `tab-manager.js` - Favicon management
  - `circuit-breaker.js`, `storage-manager.js` - Resilience patterns
  - `dom-utils.js`, `time-utils.js`, `path-utils.js` - Shared utilities

**IMPORTANT: After modifying extension files, regenerate ZIP for distribution:**
```bash
cd ~/tools/vscode-favicon  # or your local project directory
zip -r vscode-favicon-extension.zip vscode-favicon-extension -x "*.git*" -x "*node_modules*" -x "*.DS_Store"
```
The ZIP file is used to install the extension on other machines (chrome://extensions → Load unpacked → extract ZIP first).

### API Endpoints
```
GET  /api/favicon?folder=/opt/dev/project[&grayscale=true]  - Generate/serve favicon
GET  /api/project-info?folder=...          - Get project metadata
POST /api/clear-cache                      - Clear caches (admin only)
POST /api/paste-image                      - Upload clipboard image (multipart/form-data)

GET  /favicon-api?folder=...[&grayscale=true]               - Alternative favicon endpoint
POST /claude-completion                    - Create notification
GET  /claude-status?folder=...             - Get notification status
POST /claude-status/mark-read              - Mark notification read
DELETE /claude-status                      - Delete notification
GET  /notifications/stream?folder=...      - SSE real-time notifications

GET  /health                               - Detailed health status
GET  /health/live                          - Kubernetes liveness probe
GET  /health/ready                         - Kubernetes readiness probe
```

### Security Layers
1. **Path validation** - All folder params validated via `requireValidPath` middleware using `validatePathAsync()`
2. **CORS whitelist** - Exact origin matching, no wildcards
3. **Rate limiting** - 10000 req/min API, 1000 req/min notifications, 100 req/min paste-image
4. **Helmet** - CSP, HSTS, X-Frame-Options, X-Content-Type-Options
5. **SSE limits** - Max 5 connections per IP
6. **Admin IP whitelist** - Admin endpoints require explicit IP configuration in production
7. **File upload limits** - 10MB max size, MIME type validation (png/jpeg/webp only)

### CI/CD Pipeline
Forgejo Actions workflow: `.forgejo/workflows/ci.yml`
- Automated testing (lint, unit tests, coverage) on push/PR to main/develop
- Security audit job with `npm audit` and security-specific tests
- Auto-deployment to production on main branch push with rollback on failure

## Configuration

Environment variables loaded from `.env` (see `.env.example`):

```bash
# prod-vm production example:
SERVICE_PORT=8024
ALLOWED_PATHS=/home/kostas/tools,/home/kostas/dev
REGISTRY_PATH=/home/kostas/registry/projects.json
DATA_DIR=/home/kostas/data/vscode-favicon
CORS_ORIGINS=https://vs.noreika.lt,https://favicon-api.noreika.lt
ADMIN_IPS=127.0.0.1,::1           # Required in production
LOG_LEVEL=info                     # error, warn, info, debug
NODE_ENV=production                # development, test, production
```

Key config values in `lib/config.js` - validated on startup. Production mode requires explicit `ADMIN_IPS`.

## Testing Structure

```
tests/
  setup.js            # Jest setup, env isolation
  unit/               # Unit tests (50+ files) - lib/ modules, extension modules
  integration/        # Integration tests (15+ files) - API, SSE, middleware
  security/           # Security tests - OWASP Top 10, regression suite
```

**Key test categories:**
- `tests/unit/path-validator.test.js` - Security-critical path validation
- `tests/unit/svg-sanitizer.test.js` - XSS prevention
- `tests/security/owasp-tests.test.js` - OWASP Top 10 coverage
- `tests/integration/api-endpoints.test.js` - Full API integration

**Coverage thresholds (jest.config.js):**
- Global: 70% branches/functions/lines/statements
- Security-critical (`path-validator.js`): 70% minimum
- XSS prevention (`svg-sanitizer.js`, `cors-config.js`, `lru-cache.js`): 80% minimum

## Key Patterns

### Path Validation Middleware (Standard Approach)
Use `requireValidPath` middleware for path validation - the single source of truth:

```javascript
const { createFaviconRoutes, requireValidPath } = require('../lib/routes/favicon-routes');

// Apply as middleware - validation happens before route handler
app.get('/api/endpoint', requireValidPath, async (req, res) => {
    // If we reach here, folder has been validated
    // Access validated path via req.query.folder or req.body.folder
});
```

### FaviconService Instantiation
FaviconService requires configuration objects:

```javascript
const FaviconService = require('../lib/services/favicon-service');

const faviconService = new FaviconService(
    faviconCache,     // LRUCache instance
    getRegistry,      // Registry getter function
    config.allowedPaths,
    config.typeColors,
    config.defaultColors
);
```

### Registry Access
```javascript
const { getRegistry } = require('../lib/registry-cache');
const registry = await getRegistry();  // Cached, auto-reloads on file change
```

### Structured Logging
```javascript
const logger = require('./lib/logger');
logger.info({ port: 8090 }, 'Server started');
logger.error({ err: error }, 'Operation failed');
req.log.info({ duration: 123 }, 'Request completed');  // Request-scoped
```

### SVG Response with Security Headers
```javascript
const { sendSVG } = require('../lib/response-helpers');
sendSVG(res, svgContent, { cacheControl: 'public, max-age=3600' });
```

### Favicon Generation
Uses `lib/svg-sanitizer.js` for XSS-safe SVG - never interpolate user input directly into SVG strings.

### Custom Error Classes
Use typed errors for appropriate HTTP status codes:

```javascript
const { FileNotFoundError, PermissionError, ValidationError } = require('../lib/errors');

// 404 - Resource not found
throw new FileNotFoundError('Favicon not found', { path: folderPath });

// 403 - Access denied
throw new PermissionError('Path outside allowed directories', { path: folderPath });

// 400 - Invalid input
throw new ValidationError('Invalid folder parameter', { field: 'folder' });
```

### Image Upload Pattern
Use multer with memory storage for secure file uploads:

```javascript
const multer = require('multer');
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedMimeTypes = ['image/png', 'image/jpeg', 'image/webp'];
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('INVALID_MIME_TYPE'));
        }
    },
});

// Apply to route with requireValidPath for security
router.post('/api/paste-image', rateLimiter, upload.single('image'), requireValidPath, handler);
```

## Clipboard Image Paste

Image paste feature (`POST /api/paste-image`) saves images to `{project}/tasks/` for Claude CLI usage.

**Security features:**
- Magic byte validation (actual content verified, not just MIME headers)
- SHA-256 duplicate detection (prevents re-uploading same image)
- `requireValidPath` middleware for directory traversal protection
- Rate limiting: 100 req/min per IP, 10MB max file size
- Allowed formats: PNG, JPEG, WebP only

See README.md for end-user documentation and troubleshooting.
