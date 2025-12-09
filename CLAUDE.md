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
npm run test:coverage # Run with coverage report
npm run test:security # Run path-validator security tests

# Single test file
npx jest tests/unit/path-validator.test.js

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
```

## Architecture

### Entry Point
- `src/server.js` - Unified Express server (port 8090)

### Core Modules (lib/)
| Module | Purpose |
|--------|---------|
| `path-validator.js` | **SECURITY-CRITICAL** - Path traversal/symlink protection |
| `validators.js` | Request validation using express-validator with path-validator |
| `svg-sanitizer.js` | XSS-safe SVG generation for favicons |
| `cors-config.js` | Strict CORS policy with origin whitelist |
| `config.js` | Centralized env-based configuration with startup validation |
| `lru-cache.js` | In-memory LRU cache implementation |
| `registry-cache.js` | Async project registry loader with file watching |
| `notification-store.js` | Persistent notification storage with TTL |
| `logger.js` | Structured logging with Pino (JSON prod, pretty dev) |
| `response-helpers.js` | HTTP response utilities with security headers |
| `services/favicon-service.js` | Favicon search and generation logic |

### Middleware & Routes (lib/)
| Directory | Purpose |
|-----------|---------|
| `middleware/setup.js` | Centralized Express middleware (Helmet, CORS, rate limiting, compression) |
| `routes/favicon-routes.js` | Favicon generation endpoints |
| `routes/notification-routes.js` | Claude notification and SSE endpoints |
| `routes/health-routes.js` | Health check endpoints (liveness, readiness) |
| `routes/admin-routes.js` | Admin-only endpoints (cache clear) |
| `lifecycle/shutdown.js` | Graceful shutdown with resource cleanup |

### Browser Extension
`vscode-favicon-extension/` - Chrome extension for favicon injection:
- `manifest.json` - Extension manifest (v3)
- `content-project-favicon.js` - Main content script
- `background.js` - Service worker
- `popup.js/html` - Extension popup UI

### API Endpoints
```
GET  /api/favicon?folder=/opt/dev/project[&grayscale=true]  - Generate/serve favicon
GET  /api/project-info?folder=...          - Get project metadata
POST /api/clear-cache                      - Clear caches (admin only)

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
3. **Rate limiting** - 100 req/15min API, 10 req/min notifications
4. **Helmet** - CSP, HSTS, X-Frame-Options, X-Content-Type-Options
5. **SSE limits** - Max 5 connections per IP
6. **Admin IP whitelist** - Admin endpoints require explicit IP configuration in production

## Configuration

Environment variables loaded from `.env` (see `.env.example`):

```bash
SERVICE_PORT=8090
ALLOWED_PATHS=/opt/dev,/opt/prod,/opt/research
REGISTRY_PATH=/opt/registry/projects.json
CORS_ORIGINS=https://vs.noreika.lt,http://localhost:8080
ADMIN_IPS=127.0.0.1,::1           # Required in production
LOG_LEVEL=info                     # error, warn, info, debug
NODE_ENV=production                # development, test, production
```

Key config values in `lib/config.js` - validated on startup. Production mode requires explicit `ADMIN_IPS`.

## Testing Structure

```
tests/
  setup.js                    # Jest setup, env isolation
  unit/
    path-validator.test.js    # Security-critical tests
    svg-sanitizer.test.js     # XSS prevention tests
    cors-config.test.js       # CORS policy tests
    lru-cache.test.js         # Cache behavior tests
    favicon-service-grayscale.test.js  # Grayscale conversion tests
    validators.test.js        # Input validation tests
  integration/
    api-endpoints.test.js     # Full API integration tests
    sse-cleanup.test.js       # SSE connection lifecycle tests
  security/
    owasp-tests.test.js       # OWASP Top 10 tests
    regression-tests.test.js  # Security regression suite
```

Coverage thresholds: 70% global, 80% for security-critical modules.

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
