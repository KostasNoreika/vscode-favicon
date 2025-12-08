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
| `config.js` | Centralized env-based configuration |
| `lru-cache.js` | In-memory LRU cache implementation |
| `registry-cache.js` | Async project registry loader with file watching |
| `notification-store.js` | Persistent notification storage with TTL |
| `services/favicon-service.js` | Favicon search and generation logic |

### API Endpoints
```
GET  /api/favicon?folder=/opt/dev/project[&grayscale=true]  - Generate/serve favicon
GET  /api/project-info?folder=...          - Get project metadata
POST /api/clear-cache                      - Clear caches (admin only)

GET  /favicon-api?folder=...[&grayscale=true]               - Alternative favicon endpoint
POST /claude-completion                    - Create notification
GET  /claude-status?folder=...             - Get notification status
POST /claude-status/mark-read              - Mark notification read
GET  /notifications/stream?folder=...      - SSE real-time notifications

GET  /health                               - Detailed health status
GET  /health/live                          - Kubernetes liveness probe
GET  /health/ready                         - Kubernetes readiness probe
```

### Security Layers
1. **Path validation** - All folder params validated via express-validator middleware with `isPathAllowedAsync()`
2. **CORS whitelist** - Exact origin matching, no wildcards
3. **Rate limiting** - 100 req/15min API, 10 req/min notifications
4. **Helmet** - CSP, HSTS, X-Frame-Options, X-Content-Type-Options
5. **SSE limits** - Max 5 connections per IP

## Configuration

Environment variables loaded from `.env` (see `.env.example`):

```bash
SERVICE_PORT=8090
ALLOWED_PATHS=/opt/dev,/opt/prod,/opt/research
REGISTRY_PATH=/opt/registry/projects.json
CORS_ORIGINS=https://vs.noreika.lt,http://localhost:8080
```

Key config values in `lib/config.js` - validated on startup.

## Testing Structure

```
tests/
  setup.js                    # Jest setup, env isolation
  unit/
    path-validator.test.js    # Security-critical tests
    svg-sanitizer.test.js     # XSS prevention tests
    cors-config.test.js       # CORS policy tests
    lru-cache.test.js         # Cache behavior tests
  integration/
    api-endpoints.test.js     # Full API integration tests
  security/
    owasp-tests.test.js       # OWASP Top 10 tests
    regression-tests.test.js  # Security regression suite
```

Coverage thresholds: 70% global, 80% for security-critical modules.

## Key Patterns

### Path Validation with Express Middleware
```javascript
const { validateFolder, handleValidationErrors } = require('../lib/validators');

// Apply validators as middleware - validation happens before route handler
app.get('/api/endpoint', validateFolder, handleValidationErrors, async (req, res) => {
    // If we reach here, req.query.folder has been validated
    const folder = req.query.folder; // Safe to use

    // Your endpoint logic here
});
```

For POST endpoints with body parameters:
```javascript
const { validateNotification, handleValidationErrors } = require('../lib/validators');

app.post('/api/notification', validateNotification, handleValidationErrors, async (req, res) => {
    const { folder, message, timestamp } = req.body; // Already validated
    // Your endpoint logic here
});
```

### Registry Access
```javascript
const { getRegistry } = require('../lib/registry-cache');
const registry = await getRegistry();  // Cached, auto-reloads on file change
```

### Favicon Generation
Uses `lib/svg-sanitizer.js` for XSS-safe SVG - never interpolate user input directly into SVG strings.
