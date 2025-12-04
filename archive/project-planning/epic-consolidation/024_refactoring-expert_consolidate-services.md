# 024: Consolidate Two Services into One

**Assigned Agent**: refactoring-expert
**Epic**: epic-consolidation
**Status**: TO DO
**Estimated Effort**: L
**Priority**: P2 - MEDIUM

## Vision Alignment

Two services with 70% duplicated code increases maintenance burden. Consolidation supports maintainability goal.

## Objective

Merge vscode-favicon-service and vscode-favicon-api into a single unified service.

## Requirements

- Create unified service with all endpoints
- Extract shared code into modules
- Deprecate old services
- Update deployment configuration
- Migrate to single port

## Current State

```
vscode-favicon-service/    (port 8090)
├── server.js              # 283 lines
└── package.json

vscode-favicon-api/        (port 8091)
├── server.js              # 223 lines
└── package.json

~70% duplicated code between services
```

## Target State

```
vscode-favicon/
├── src/
│   ├── server.js          # Express app setup
│   ├── routes/
│   │   ├── favicon.js     # Favicon endpoints
│   │   ├── notifications.js # Claude notification endpoints
│   │   └── health.js      # Health endpoints
│   ├── lib/
│   │   ├── registry.js    # Registry loading
│   │   ├── favicon-generator.js
│   │   ├── cache.js       # LRU cache
│   │   ├── validator.js   # Path validation
│   │   └── config.js      # Environment config
│   └── middleware/
│       ├── cors.js
│       ├── rate-limit.js
│       └── error-handler.js
├── tests/
├── package.json
└── .env.example
```

## Acceptance Criteria

- [ ] Single unified service on port 8091
- [ ] All endpoints from both services available
- [ ] Shared code extracted to lib/
- [ ] Clean module structure
- [ ] Tests updated and passing
- [ ] PM2 config updated
- [ ] Cloudflare tunnel updated
- [ ] Old services deprecated with redirect period

## Dependencies

- Depends on: 001-020 (all fixes first)
- Blocks: None

## Technical Notes

**Unified server.js:**
```javascript
const express = require('express');
const config = require('./lib/config');
const faviconRoutes = require('./routes/favicon');
const notificationRoutes = require('./routes/notifications');
const healthRoutes = require('./routes/health');
const { corsMiddleware } = require('./middleware/cors');
const { rateLimiter } = require('./middleware/rate-limit');
const { errorHandler } = require('./middleware/error-handler');

const app = express();

// Middleware
app.use(corsMiddleware);
app.use(rateLimiter);
app.use(express.json());

// Routes
app.use('/api', faviconRoutes);
app.use('/api', notificationRoutes);
app.use('/', healthRoutes);

// Legacy routes (backwards compatibility)
app.use('/favicon-api', faviconRoutes);

// Error handling
app.use(errorHandler);

module.exports = app;
```

**Migration Plan:**
1. Create new unified service
2. Run both old and new in parallel
3. Update Cloudflare tunnel to new service
4. Monitor for issues
5. Deprecate old services
6. Remove old code after 2 weeks

## Resources

- Express Best Practices: https://expressjs.com/en/advanced/best-practice-performance.html

## Testing Requirements

- [ ] All existing tests pass
- [ ] Integration tests for all endpoints
- [ ] Backwards compatibility verified
- [ ] Performance comparison

---

**Completion Instructions**:
1. When task is completed, rename file to: `done_024_refactoring-expert_consolidate-services.md`
2. After testing is verified, rename to: `tested_done_024_refactoring-expert_consolidate-services.md`
