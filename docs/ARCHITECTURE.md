# System Architecture

High-level architecture overview of the VS Code Favicon Service system.

## Overview

VS Code Favicon Service is a dual-service system that generates project-specific favicons for VS Code Server instances, making it easy to visually distinguish between multiple open project tabs.

## System Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           VS Code Server Tabs                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐│
│  │ Project A    │  │ Project B    │  │ Project C    │  │ Project D    ││
│  │  [PA] 8080   │  │  [PB] 8081   │  │  [PC] Prod   │  │  [PD] Test   ││
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘│
│         │                  │                  │                  │        │
└─────────┼──────────────────┼──────────────────┼──────────────────┼────────┘
          │                  │                  │                  │
          ▼                  ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Cloudflare Proxy Layer                            │
│  ┌──────────────────────────┐  ┌──────────────────────────────────────┐ │
│  │  vs.noreika.lt           │  │  favicon-api.noreika.lt              │ │
│  │  (VS Code Server + Ext)  │  │  (Notification API)                  │ │
│  └────────────┬─────────────┘  └───────────────┬──────────────────────┘ │
└───────────────┼────────────────────────────────┼────────────────────────┘
                │                                 │
                ▼                                 ▼
┌───────────────────────────────┐  ┌────────────────────────────────────┐
│   Favicon Service (8090)      │  │   Favicon API (8091)               │
│                               │  │                                    │
│  ┌─────────────────────────┐ │  │  ┌──────────────────────────────┐ │
│  │  Endpoints:             │ │  │  │  Endpoints:                  │ │
│  │  • /api/favicon         │ │  │  │  • /favicon-api              │ │
│  │  • /api/project-info    │ │  │  │  • /claude-completion       │ │
│  │  • /api/clear-cache     │ │  │  │  • /claude-status           │ │
│  │  • /health              │ │  │  │  • /notifications/stream    │ │
│  └─────────────────────────┘ │  │  │  • /health                   │ │
│                               │  │  └──────────────────────────────┘ │
│  ┌─────────────────────────┐ │  │                                    │
│  │  Core Modules:          │ │  │  ┌──────────────────────────────┐ │
│  │  • LRU Cache            │ │  │  │  Core Modules:               │ │
│  │  • Registry Cache       │ │  │  │  • Notification Store        │ │
│  │  • Path Validator       │ │  │  │  • Registry Cache            │ │
│  │  • SVG Sanitizer        │ │  │  │  • Path Validator            │ │
│  │  • CORS Config          │ │  │  │  • CORS Config               │ │
│  └─────────────────────────┘ │  │  └──────────────────────────────┘ │
└───────────┬───────────────────┘  └────────────┬───────────────────────┘
            │                                   │
            └───────────────┬───────────────────┘
                            │
                ┌───────────▼────────────┐
                │  Shared Libraries      │
                │  (/lib/)               │
                │                        │
                │  • config.js           │
                │  • path-validator.js   │
                │  • cors-config.js      │
                │  • svg-sanitizer.js    │
                │  • validators.js       │
                │  • logger.js           │
                │  • health-check.js     │
                │  • lru-cache.js        │
                │  • registry-cache.js   │
                │  • notification-store  │
                └────────────┬───────────┘
                             │
            ┌────────────────┼────────────────┐
            │                │                │
            ▼                ▼                ▼
    ┌───────────────┐  ┌──────────┐  ┌─────────────┐
    │   Registry    │  │  Favicon │  │ Notification│
    │  projects.json│  │  Files   │  │   Store     │
    │               │  │          │  │  (in-memory)│
    │ /opt/registry/│  │ Custom   │  │             │
    └───────────────┘  │ images   │  └─────────────┘
                       └──────────┘
```

## Components

### 1. Favicon Service (Port 8090)

**Purpose**: Full-featured favicon generation service with advanced caching and registry integration.

**Key Features**:
- Automatic detection of existing favicon files
- SVG generation with project initials
- Type-based color coding
- LRU cache for performance
- Registry cache with TTL
- Comprehensive health checks

**Technology Stack**:
- Node.js 20+
- Express.js 5
- Pino logger
- Custom LRU cache implementation

**Process Management**: PM2 (`vscode-favicon-service`)

---

### 2. Favicon API (Port 8091)

**Purpose**: Lightweight API service optimized for Cloudflare proxy integration and Claude notifications.

**Key Features**:
- Simple SVG generation (no file detection)
- Claude completion notifications
- Server-Sent Events (SSE) for real-time updates
- Minimal dependencies
- Independent deployment

**Technology Stack**:
- Node.js 20+
- Express.js 5
- Pino logger
- In-memory notification store

**Process Management**: PM2 (`vscode-favicon-api`)

---

### 3. VS Code Extension

**Location**: `/vscode-favicon-extension/`

**Purpose**: Browser integration that injects favicons into VS Code Server tabs.

**Key Features**:
- Automatic favicon injection on page load
- Real-time notification polling
- Badge overlay for Claude notifications
- Tab title enhancement
- Configurable polling intervals

**Technology**: Vanilla JavaScript (no build step)

**Integration**: Injected via nginx or served as static extension

---

## Shared Libraries

All core logic is centralized in `/lib/` for consistency and maintainability:

### config.js
- Centralized configuration management
- Environment variable parsing
- Default values
- Validation

### path-validator.js
- Path traversal protection
- Null byte injection prevention
- URL encoding attack mitigation
- Allowed path whitelist
- Symlink resolution

### cors-config.js
- CORS middleware factory
- Origin whitelist validation
- Cache poisoning protection
- No wildcard origins

### svg-sanitizer.js
- XSS protection for SVG content
- Dangerous element removal
- Event handler blocking
- Data URI sanitization

### validators.js
- Express-validator rules
- Input validation schemas
- Error handling middleware

### logger.js
- Structured logging with Pino
- Request logging middleware
- Performance tracking
- Error logging

### health-check.js
- Kubernetes liveness/readiness probes
- Component health checks
- Metric aggregation

### lru-cache.js
- Size-limited LRU cache
- O(1) operations
- Statistics tracking
- Automatic eviction

### registry-cache.js
- TTL-based caching
- File watch invalidation
- Graceful degradation

### notification-store.js
- In-memory notification storage
- Event emitter for SSE
- Mark read/delete operations
- Statistics tracking

---

## Data Flow

### Favicon Generation Flow

```
1. Browser Tab Load
   └─> VS Code Extension detects page
       └─> Extension requests: GET /api/favicon?folder=/opt/dev/project
           └─> Service checks LRU cache
               ├─> Cache Hit: Return cached favicon
               └─> Cache Miss:
                   ├─> Check for existing favicon file
                   │   └─> Found: Load and cache
                   └─> Not found:
                       └─> Load registry data
                           └─> Generate SVG with initials + type color
                               └─> Cache and return
```

### Notification Flow

```
1. Claude Task Completion
   └─> POST /claude-completion
       └─> Validate path
           └─> Store notification in memory
               └─> Emit event to SSE subscribers
                   └─> Browser extension receives event
                       └─> Shows badge on tab
                           └─> User clicks badge
                               └─> POST /claude-status/mark-read
```

---

## Caching Architecture

### Two-Tier Caching Strategy

1. **LRU Cache (Favicon Cache)**
   - **Purpose**: Cache generated/loaded favicons
   - **Type**: Size-limited (default: 100 items)
   - **Eviction**: Least Recently Used
   - **Key**: `favicon_${projectPath}`
   - **Value**: `{ contentType, data }`
   - **Metrics**: hits, misses, evictions, hit rate

2. **TTL Cache (Registry Cache)**
   - **Purpose**: Cache parsed project registry
   - **Type**: Time-based (default: 60 seconds)
   - **Invalidation**: TTL expiry + file watch
   - **Key**: Project path or name
   - **Value**: Project metadata object
   - **Metrics**: hits, misses, invalidations

See [CACHE_ARCHITECTURE.md](CACHE_ARCHITECTURE.md) for detailed caching documentation.

---

## Security Layers

### 1. Path Validation (Multi-layer)

```
Input: /opt/dev/../../etc/passwd

Layer 1: URL decode
  └─> Detect encoded traversal sequences

Layer 2: Null byte check
  └─> Reject \x00 injection attempts

Layer 3: Resolve symlinks
  └─> Get real canonical path

Layer 4: Whitelist validation
  └─> Ensure path within allowed directories

Result: REJECT (traversal detected)
```

### 2. CORS Protection

- Strict origin whitelist (no `*`)
- Origin header validation
- Cache poisoning prevention
- Proper preflight handling

### 3. Rate Limiting

- Per-IP sliding window
- Separate limits for different endpoint types
- Health endpoints excluded
- 429 responses with Retry-After

### 4. Input Validation

- Express-validator on all endpoints
- JSON body size limits (10KB)
- Type validation
- Range validation

### 5. XSS Protection

- SVG sanitization
- HTML entity encoding
- Dangerous tag removal
- Event handler blocking

See [SECURITY.md](SECURITY.md) for complete security documentation.

---

## Deployment Architecture

### Development Environment

```
┌──────────────────────────────────────┐
│  Mac Studio (prod-vm-macstudio)      │
│                                      │
│  PM2 Process Manager                 │
│  ├─ vscode-favicon-service (8090)   │
│  └─ vscode-favicon-api (8091)       │
│                                      │
│  nginx (reverse proxy)               │
│  └─ VS Code Server + Extension      │
└──────────────────────────────────────┘
```

### Production Environment

```
┌─────────────────────────────────────────────────────────────────────┐
│  Cloudflare Tunnels                                                  │
│                                                                      │
│  vs.noreika.lt ──────────────┐                                      │
│  favicon-api.noreika.lt ─────┼──→ dev-macstudio tunnel (Mac Studio) │
│                              │                                       │
└──────────────────────────────┼───────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│  Mac Studio (dev-macstudio)                                          │
│                                                                      │
│  PM2 Ecosystem                                                       │
│  └─ vscode-favicon (8090) - Unified service                         │
│     ├─ Favicon generation (/api/favicon, /favicon-api)              │
│     ├─ Claude notifications (/claude-completion, /notifications)    │
│     └─ Paste image (/api/paste-image)                               │
│                                                                      │
│  Paths:                                                              │
│  └─ /opt/tools/vscode-favicon (project files + favicon.svg)         │
│                                                                      │
│  Monitoring                                                          │
│  ├─ PM2 status                                                       │
│  ├─ Health checks (/health, /health/ready)                          │
│  └─ Logs (Pino JSON structured)                                     │
└──────────────────────────────────────────────────────────────────────┘

Note: Production VM (prod-vm-macstudio) is available for backup/redundancy.
      Current production traffic routes through Mac Studio via dev-macstudio tunnel.
```

### Cloudflare Tunnel Routing

| Domain | Tunnel | Target |
|--------|--------|--------|
| `vs.noreika.lt` | dev-macstudio | VS Code Server |
| `favicon-api.noreika.lt` | dev-macstudio | `127.0.0.1:8090` (Mac Studio) |
| `mac-favicon-api.noreika.lt` | dev-macstudio | `127.0.0.1:8090` (alias) |

**DNS Configuration:**
- CNAME: `favicon-api.noreika.lt` → `7a498d84-84bc-47c1-bbb3-14386ab9a457.cfargotunnel.com`

**Why Mac Studio?**
- VS Code Server runs on Mac Studio with paths like `/opt/tools/...`
- Extension sends these paths to API
- Mac Studio has direct access to these paths for custom favicon detection

### CI/CD Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│  Forgejo Actions (git.noreika.lt)                           │
│                                                             │
│  1. Quality Checks                                          │
│     ├─ npm run lint                                        │
│     ├─ npm run format:check                                │
│     └─ npm run test:ci                                     │
│                                                             │
│  2. Security Audits                                         │
│     ├─ npm audit (severity: high+)                         │
│     └─ npm run test:security                               │
│                                                             │
│  3. Deploy                                                  │
│     ├─ SSH to prod-vm-macstudio                            │
│     ├─ git pull                                            │
│     ├─ npm install --production                            │
│     ├─ pm2 reload ecosystem.config.js                      │
│     └─ Wait 10s for health check                           │
│                                                             │
│  4. Smoke Tests                                             │
│     ├─ curl /health (expect 200)                           │
│     ├─ curl /health/ready (expect 200)                     │
│     └─ curl /api/favicon?folder=/opt/dev/test (expect 200) │
│                                                             │
│  5. Rollback on Failure                                     │
│     └─ pm2 reload from backup                              │
└─────────────────────────────────────────────────────────────┘
```

See [CI_CD.md](CI_CD.md) for complete CI/CD documentation.

---

## Technology Stack

### Backend Services

- **Runtime**: Node.js 20.x
- **Framework**: Express.js 5.x
- **Logging**: Pino (structured JSON)
- **Validation**: express-validator 7.x
- **Security**: Helmet, custom path validator
- **Compression**: gzip (70-90% reduction)
- **Process Manager**: PM2

### Development Tools

- **Testing**: Jest 29.x (unit + integration)
- **Linting**: ESLint 8.x + security plugin
- **Formatting**: Prettier 3.x
- **Coverage**: Jest built-in (>80% target)
- **CI/CD**: Forgejo Actions

### External Dependencies

- **Project Registry**: `/opt/registry/projects.json`
- **Favicon Storage**: Project directories (custom images)
- **Notification Store**: In-memory (not persisted)

---

## Scalability Considerations

### Current Design

- Single instance per service (sufficient for personal use)
- In-memory caching (no shared state)
- No database requirements
- Lightweight resource usage

### Future Scaling Options

1. **Horizontal Scaling**
   - Multiple service instances behind load balancer
   - Shared Redis cache for favicons
   - Shared Redis pub/sub for notifications

2. **Persistent Storage**
   - Redis for notification persistence
   - Database for project registry (vs JSON file)
   - Object storage for custom favicon files

3. **CDN Integration**
   - Cache favicons at edge (Cloudflare)
   - Edge computing for generation
   - WebSocket for notifications (vs SSE)

---

## Monitoring & Observability

### Health Checks

- **Liveness**: `/health/live` - Is process alive?
- **Readiness**: `/health/ready` - Can accept traffic?
- **Detailed**: `/health` - Full system status

### Metrics Available

- Cache hit rates (favicon + registry)
- Request counts (per endpoint)
- Error rates
- Response times (via Pino)
- Notification statistics
- PM2 process metrics

### Logs

- Structured JSON (Pino)
- Levels: trace, debug, info, warn, error, fatal
- Request/response logging
- Error stack traces
- Performance timings

---

## Design Decisions

### Why Two Services?

1. **Separation of Concerns**:
   - Favicon service: Full-featured, heavier
   - API service: Lightweight, notification-focused

2. **Independent Deployment**:
   - Can deploy/restart independently
   - Different resource requirements
   - Different Cloudflare routing

3. **Security Isolation**:
   - API service exposed to internet
   - Favicon service can be internal-only

### Why LRU Cache?

- Bounded memory usage (vs unlimited cache)
- O(1) operations (vs O(log n) TTL expiry)
- Simple implementation (no external dependencies)
- Predictable eviction behavior

### Why In-Memory Notifications?

- Low latency (no database round-trip)
- Simple implementation (no persistence layer)
- Acceptable data loss (notifications are ephemeral)
- Easy to clear/reset

### Why JSON Registry?

- Simple to edit (human-readable)
- No database required
- Version control friendly (git)
- Fast to parse (small file)

---

## Related Documentation

- [API.md](API.md) - Complete API reference
- [CONFIGURATION.md](CONFIGURATION.md) - Configuration guide
- [SECURITY.md](SECURITY.md) - Security documentation
- [CACHE_ARCHITECTURE.md](CACHE_ARCHITECTURE.md) - Caching details
- [TESTING.md](TESTING.md) - Testing guide
- [CI_CD.md](CI_CD.md) - CI/CD pipeline
- [DEPLOYMENT_SETUP.md](DEPLOYMENT_SETUP.md) - Deployment guide
