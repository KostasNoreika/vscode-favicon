# Architecture Documentation

This directory contains architectural documentation for the vscode-favicon project.

## Documents

### 1. Service Consolidation Plan
**File:** `service-consolidation-plan.md`

Comprehensive analysis of consolidating the two services (favicon-service and favicon-api) into one. Includes:
- Current architecture overview
- Shared infrastructure analysis
- Benefits of keeping services separate
- Four consolidation options (A, B, C, D)
- Decision matrix
- Migration scripts (if needed)
- When to reconsider consolidation

**Recommendation:** Keep services separate (Option A)

### 2. Task 024 Summary
**File:** `TASK_024_CONSOLIDATION_SUMMARY.md`

Executive summary of the consolidation analysis task. Includes:
- Decision rationale
- Code analysis (61.8% shared, 38.2% service-specific)
- Service characteristics comparison
- Benefits of current architecture
- Acceptance criteria verification

**Status:** Task completed - no consolidation needed

### 3. Current Architecture Diagrams
**File:** `current-architecture.ascii`

Visual ASCII diagrams showing:
- Overall architecture (two-service design)
- Service comparison matrix
- Shared code analysis
- Request flow diagrams (favicon, SSE notifications)
- PM2 process management
- Why keep services separate
- What consolidation would lose

## Quick Overview

### Current Architecture

```
vscode-favicon-service (8090)        vscode-favicon-api (8091)
├── Favicon generation               ├── Notification system
├── Project info API                 ├── SSE real-time streams
└── LRU caching                      └── Persistent storage

            ↓ Both share ↓

                lib/
    ├── Shared middleware (80%)
    ├── Security (path-validator, CORS)
    ├── Health checks
    └── Logging
```

### Key Metrics

- **Total Code:** 2,987 lines
- **Shared (lib/):** 1,847 lines (61.8%)
- **Service-specific:** 1,140 lines (38.2%)
- **Services:** 2 independent processes
- **Ports:** 8090 (service), 8091 (api)
- **Test Coverage:** 301 tests, 100% passing

### Why Keep Separate?

1. **Separation of Concerns** - Different responsibilities
2. **Independent Scaling** - Different scaling strategies
3. **Failure Isolation** - One service failure doesn't affect other
4. **Operational Flexibility** - Can restart/deploy independently
5. **Minimal Duplication** - 61.8% of code already shared

### When to Reconsider?

Only consider consolidation if:
- Performance issues from managing two processes
- Deployment complexity becomes error-prone
- Resource constraints require single process
- Team strongly prefers monolithic architecture

**None of these conditions currently apply.**

## Related Documentation

### Main Documentation
- `/opt/tools/vscode-favicon/README.md` - Main project README
- `/opt/tools/vscode-favicon/DEPLOYMENT.md` - Deployment guide

### Service Documentation
- `/opt/tools/vscode-favicon/vscode-favicon-service/server.js` - Service implementation
- `/opt/tools/vscode-favicon/vscode-favicon-api/server.js` - API implementation

### Shared Modules
- `/opt/tools/vscode-favicon/lib/` - All shared modules
- `/opt/tools/vscode-favicon/lib/config.js` - Centralized configuration

### Configuration
- `/opt/tools/vscode-favicon/ecosystem.config.js` - PM2 configuration
- `/opt/tools/vscode-favicon/.env` - Environment variables

### Other Documentation
- `/opt/tools/vscode-favicon/docs/CONFIGURATION.md` - Configuration guide
- `/opt/tools/vscode-favicon/docs/SECURITY.md` - Security documentation
- `/opt/tools/vscode-favicon/docs/TESTING.md` - Testing guide
- `/opt/tools/vscode-favicon/docs/HEALTH_CHECK.md` - Health check documentation

## Decision Log

### 2025-12-04: Service Consolidation Decision

**Context:** Task 024 - Evaluate consolidating two services

**Decision:** Keep services separate (no consolidation)

**Rationale:**
- Well-designed architecture with clear separation of concerns
- 61.8% of code already shared through lib/ modules
- Different performance characteristics (stateless vs stateful)
- Different scaling needs (horizontal vs sticky sessions)
- Operational benefits (failure isolation, independent deployment)
- Minimal code duplication

**Impact:** None - current architecture maintained

**Review:** Revisit if operational requirements change

## Architecture Principles

### 1. Shared Infrastructure
All common functionality (middleware, security, health checks, logging) is extracted to `lib/` modules and shared between services.

### 2. Separation of Concerns
Each service has a single, well-defined responsibility:
- **Favicon Service:** Generate and serve project favicons
- **Notification API:** Manage real-time notifications via SSE

### 3. Fail Independently
Services are isolated - failure of one doesn't cascade to the other. This improves system reliability.

### 4. Scale Independently
Services can scale differently based on their needs:
- Favicon service scales horizontally (stateless)
- Notification API needs sticky sessions (stateful SSE)

### 5. Deploy Independently
Services can be restarted, updated, and deployed independently without affecting each other.

### 6. Optimize Differently
Services have different optimization strategies:
- Favicon service focuses on caching (LRU)
- Notification API focuses on connection management (SSE)

## Testing

All architecture decisions are validated through comprehensive testing:

```bash
# Run all tests
npm test

# Run specific test suites
npm run test:unit
npm run test:integration

# Check test coverage
npm run test:coverage
```

**Current Status:** 301 tests passing, comprehensive coverage

## Monitoring

Both services expose health check endpoints:

```bash
# Favicon Service
curl http://localhost:8090/health
curl http://localhost:8090/health/live
curl http://localhost:8090/health/ready

# Notification API
curl http://localhost:8091/health
curl http://localhost:8091/health/live
curl http://localhost:8091/health/ready
```

## PM2 Management

```bash
# Start both services
pm2 start ecosystem.config.js

# View status
pm2 status

# Restart individual service
pm2 restart vscode-favicon-service
pm2 restart vscode-favicon-api

# View logs
pm2 logs vscode-favicon-service
pm2 logs vscode-favicon-api

# Monitor resources
pm2 monit
```

## Future Considerations

### If Requirements Change

If future requirements necessitate consolidation, follow the migration path documented in `service-consolidation-plan.md`.

### Potential Enhancements

Consider these enhancements while maintaining current architecture:
1. Add caching layer (Redis) for shared cache between instances
2. Add API gateway for centralized routing
3. Add metrics collection (Prometheus)
4. Add distributed tracing (Jaeger)
5. Add rate limiting per user (not just per IP)

All enhancements should maintain the two-service architecture.

## Questions?

For questions about architecture decisions or implementation details:
1. Read `service-consolidation-plan.md` for detailed analysis
2. Check `TASK_024_CONSOLIDATION_SUMMARY.md` for executive summary
3. View `current-architecture.ascii` for visual diagrams
4. Review service implementations in `vscode-favicon-service/` and `vscode-favicon-api/`

## Changelog

- **2025-12-04:** Created architecture documentation directory
- **2025-12-04:** Completed Task 024 - Service consolidation analysis
- **2025-12-04:** Decision: Keep services separate (no consolidation)
