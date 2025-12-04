# Service Consolidation Plan

## Current Architecture

The vscode-favicon project currently runs two separate Express servers:

### 1. vscode-favicon-service (Port 8090)
**Purpose:** Core favicon generation and project information

**Endpoints:**
- `GET /api/favicon?folder=<path>` - Generate/serve project favicon
- `GET /api/project-info?folder=<path>` - Get project metadata
- `POST /api/clear-cache` - Clear favicon cache
- `GET /health`, `/health/live`, `/health/ready` - Health checks

**Key Features:**
- Favicon generation (SVG with initials)
- Existing favicon file search
- LRU cache for favicons
- Registry integration for project metadata

### 2. vscode-favicon-api (Port 8091)
**Purpose:** Notification system with real-time updates

**Endpoints:**
- `GET /favicon-api?folder=<path>` - Alternative favicon endpoint
- `POST /claude-completion` - Create completion notification
- `GET /claude-status?folder=<path>` - Check notification status
- `POST /claude-status/mark-read` - Mark notification as read
- `DELETE /claude-status` - Clear notification
- `GET /notifications/stream?folder=<path>` - SSE real-time stream
- `GET /health`, `/health/live`, `/health/ready` - Health checks

**Key Features:**
- SSE (Server-Sent Events) for real-time notifications
- Persistent notification storage
- Stricter rate limiting (10 req/min vs 100 req/15min)
- Event subscription system

## Shared Infrastructure

Both services already share common modules from `lib/`:

```
lib/
├── config.js              # Centralized configuration
├── cors-config.js         # CORS middleware
├── health-check.js        # Health check utilities
├── logger.js              # Pino logging with request logging
├── lru-cache.js           # LRU cache implementation
├── notification-store.js  # Notification persistence
├── path-validator.js      # Security path validation
├── registry-cache.js      # Project registry caching
├── svg-sanitizer.js       # SVG sanitization
└── validators.js          # Express validators
```

**Middleware Shared:**
- Compression (gzip, level 6, >1KB threshold)
- Helmet security headers (CSP, HSTS, XSS protection)
- Rate limiting (configurable per endpoint)
- CORS with origin whitelist
- Request logging (pino)
- JSON body size limit (10KB)
- Graceful shutdown handlers

## Why Services Are Currently Separate

### Architectural Benefits

1. **Separation of Concerns**
   - Favicon generation is stateless and cacheable
   - Notifications are stateful and require persistent connections (SSE)

2. **Different Performance Characteristics**
   - Service: Fast response, heavy caching (LRU cache)
   - API: Long-lived connections (SSE), memory for subscribers

3. **Different Rate Limiting Needs**
   - Service: 100 requests/15min (generous for CDN-like usage)
   - API: 10 requests/1min (stricter for notifications)

4. **Independent Scaling**
   - Can scale favicon service horizontally (stateless)
   - Notification API needs sticky sessions (SSE connections)

5. **Deployment Flexibility**
   - Can deploy one without affecting the other
   - Easier to debug and monitor separately
   - Independent restart/upgrade cycles

### Operational Benefits

1. **PM2 Management**
   - Each service gets own PM2 process
   - Independent memory limits (500M each)
   - Separate log files for easier debugging
   - Can restart one without dropping connections on other

2. **Resource Isolation**
   - Memory leaks in one don't affect other
   - CPU spikes isolated
   - Easier to identify performance issues

3. **Security Isolation**
   - Different attack surfaces
   - Can have different firewall rules
   - Notification API can be more restricted

## Consolidation Options

### Option A: Keep Separate (Recommended)
**Status:** Current implementation

**Pros:**
- Already working well
- Clean separation of concerns
- Easy to understand and maintain
- Independent scaling and deployment
- Minimal code duplication (shared lib/)

**Cons:**
- Two PM2 processes
- Two ports to manage
- Slightly more complex deployment

**Recommendation:** Keep as-is unless there's a compelling reason to consolidate.

### Option B: Single Server with Separate Routers
**Effort:** Medium (2-3 hours)

Merge into single Express server with route modules:

```
src/
├── server.js           # Main entry point
├── routes/
│   ├── favicon.js      # Favicon routes (from service)
│   ├── notifications.js # Notification routes (from api)
│   └── health.js       # Combined health checks
└── middleware/
    └── rate-limits.js  # Different limiters per route
```

**Implementation:**
```javascript
// src/server.js
const express = require('express');
const faviconRouter = require('./routes/favicon');
const notificationsRouter = require('./routes/notifications');
const healthRouter = require('./routes/health');

const app = express();

// Shared middleware (compression, helmet, cors, logging)
app.use(/* ... */);

// Mount routers
app.use('/api', faviconRouter);           // /api/favicon, /api/project-info
app.use('/notifications', notificationsRouter); // /notifications/stream
app.use('/claude', notificationsRouter);   // /claude-completion, /claude-status
app.use('/health', healthRouter);

// Single port
app.listen(config.servicePort);
```

**Pros:**
- Single PM2 process
- Single port
- Easier deployment
- Shared middleware initialization

**Cons:**
- Lost separation of concerns
- Shared memory limits
- SSE connections affect favicon performance
- Need to manage different rate limits per route
- More complex to scale independently
- Harder to debug when issues arise

**Migration Path:**
1. Create `src/` directory
2. Extract routes from both servers
3. Create unified server.js
4. Update ecosystem.config.js (single app)
5. Update tests
6. Test SSE connections
7. Update documentation

### Option C: Gateway with Backend Services
**Effort:** High (4-6 hours)

Add nginx/traefik gateway in front:

```
Gateway (nginx)
├── /api/* → service:8090
└── /notifications/* → api:8091
```

**Pros:**
- Best of both worlds
- Centralized SSL/auth
- Can add caching layer
- Load balancing ready

**Cons:**
- Additional complexity
- More moving parts
- Requires nginx/traefik setup
- Overkill for current scale

### Option D: Microservices Architecture
**Effort:** Very High (1-2 days)

Separate into independent services with message queue:

```
Favicon Service (8090) ←→ Redis/RabbitMQ ←→ Notification Service (8091)
                                ↓
                          API Gateway (8080)
```

**Pros:**
- True microservices
- Can use different languages
- Best scalability

**Cons:**
- Massive overkill for current needs
- Operational complexity
- Need message queue infrastructure
- Much harder to debug

## Decision Matrix

| Criteria | Keep Separate | Single Server | Gateway | Microservices |
|----------|--------------|---------------|---------|---------------|
| Effort | **None** | Medium | High | Very High |
| Maintainability | **High** | Medium | Low | Very Low |
| Scalability | **Good** | Limited | Very Good | Excellent |
| Debugging | **Easy** | Medium | Hard | Very Hard |
| Resource Usage | Medium | **Low** | High | Very High |
| Deployment | Simple | **Simple** | Complex | Very Complex |
| Current Fit | **Perfect** | Good | Over-engineered | Over-engineered |

## Recommendation

**Keep services separate (Option A)** for the following reasons:

1. **Current implementation works well** - No performance or operational issues
2. **Clean architecture** - Clear separation of concerns
3. **Easy to understand** - New developers can quickly grasp structure
4. **Minimal duplication** - Shared lib/ modules eliminate redundancy
5. **Future-ready** - Can easily add more services (e.g., analytics)
6. **Right size** - Not over-engineered, not under-engineered

## When to Reconsider

Consider consolidation if:

1. **Performance issues** - If managing two processes becomes a bottleneck (unlikely)
2. **Deployment complexity** - If coordinating two services becomes error-prone
3. **Resource constraints** - If running on very limited hardware (unlikely with 500M limit each)
4. **Team preference** - If team strongly prefers monolithic architecture

## Migration Script (If Consolidating)

If you decide to consolidate in the future, here's the approach:

```bash
# 1. Create new structure
mkdir -p src/routes src/middleware

# 2. Extract routes (preserve git history)
git mv vscode-favicon-service/server.js src/routes/favicon.js
git mv vscode-favicon-api/server.js src/routes/notifications.js

# 3. Create unified server
cat > src/server.js << 'EOF'
#!/usr/bin/env node
const express = require('express');
const config = require('../lib/config');
// ... (see Option B above)
EOF

# 4. Update PM2 config
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'vscode-favicon',
    script: './src/server.js',
    instances: 1,
    // ...
  }]
};
EOF

# 5. Run tests
npm test

# 6. Deploy
pm2 reload ecosystem.config.js
```

## Testing Strategy (If Consolidating)

1. **Unit tests** - Ensure all routes still work
2. **Integration tests** - Test SSE connections
3. **Load tests** - Verify performance under load
4. **Smoke tests** - Check health endpoints
5. **Rollback plan** - Keep old config for quick revert

## Conclusion

The current two-service architecture is **well-designed** and **appropriate for the scale**. The shared `lib/` modules already eliminate most code duplication. The separation provides clear benefits in terms of maintainability, debuggability, and operational flexibility.

**Recommendation: No action needed. Current architecture is optimal.**

If future requirements change (e.g., need for API gateway, different scaling needs), revisit this plan.

## References

- PM2 Config: `/opt/tools/vscode-favicon/ecosystem.config.js`
- Service Implementation: `/opt/tools/vscode-favicon/vscode-favicon-service/server.js`
- API Implementation: `/opt/tools/vscode-favicon/vscode-favicon-api/server.js`
- Shared Modules: `/opt/tools/vscode-favicon/lib/`
