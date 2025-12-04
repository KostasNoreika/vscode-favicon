# Changelog

## [1.5.0] - 2025-12-04

### CI/CD Pipeline

#### Forgejo Actions Workflow
- **Automated testing on push** to main/develop branches and PRs to main
- **Three-job pipeline:** Test, Security, Deploy
- **Test job:** Linting, coverage tests (70% threshold), security audit
- **Security job:** Security-specific tests and dependency auditing (parallel execution)
- **Deploy job:** Zero-downtime deployment to production (main branch only)

#### Deployment Features
- **SSH-based deployment** using secrets (DEPLOY_HOST, DEPLOY_USER, SSH_PRIVATE_KEY)
- **Automatic backup** before deployment with timestamp (`/opt/backups/vscode-favicon/`)
- **Smoke tests** after deployment with automatic rollback on failure
- **PM2 reload** for zero-downtime service restart
- **Health check verification** for both service and API endpoints
- **Git reset to origin/main** ensuring clean deployment state

#### Artifacts & Reporting
- **Coverage reports** uploaded (30-day retention)
- **Test results** in JUnit XML format (30-day retention)
- **Deployment notifications** with success/failure status
- **Build logs** available in Forgejo Actions interface

#### Configuration
- Node.js 20 with npm caching
- `npm ci` for reproducible builds
- `npm run lint`, `npm run test:ci`, `npm run coverage:check`
- `npm audit --audit-level=high` with continue-on-error
- SSH action with configurable port (default: 22)

#### Rollback Safety
- Pre-deployment backup creation
- Smoke test verification before PM2 reload
- Automatic git reset on test failure
- Previous dependencies reinstallation on rollback
- PM2 restart with previous version on failure

#### Documentation
- **CI/CD Overview:** `docs/CI_CD.md` - Complete pipeline documentation
- **Quick Reference:** `docs/CI_CD_QUICK_REFERENCE.md` - Command cheat sheet
- **Setup Guide:** `docs/DEPLOYMENT_SETUP.md` - Step-by-step deployment setup
- Secrets configuration instructions
- Troubleshooting guide for common issues

---

## [1.4.0] - 2025-12-04

### Enhanced Health Check System

#### Kubernetes-Style Probes
- **Liveness Probe** (`/health/live`) - Checks if service process is alive
- **Readiness Probe** (`/health/ready`) - Checks if service is ready to accept traffic
- **Main Health Endpoint** (`/health`) - Comprehensive health status with all checks

#### Health Check Components
- **Registry File Check** - Verifies accessibility and reports file metadata (size, modified time)
- **Data Directory Check** - Verifies write permissions for persistent storage
- **Memory Usage Reporting** - Heap, RSS, external memory statistics
- **Cache Statistics** - Real-time cache performance metrics
- **Uptime Tracking** - Human-readable uptime (e.g., "2m 34s")

#### Degradation Detection
- Returns **503 Service Unavailable** when critical components fail
- **Degraded Status** when registry file is not accessible
- **Error Details** included in response for troubleshooting
- Graceful degradation with detailed error messages

#### Monitoring Features
- **No Rate Limiting** - Health endpoints excluded from rate limits
- **Lightweight Checks** - < 1ms response time, non-blocking async operations
- **Pre-calculated Metrics** - Cache stats with O(1) access
- **Prometheus-ready** - JSON format compatible with Prometheus scraping

#### Implementation
- New `lib/health-check.js` module with reusable health check functions
- Integrated into both service (8090) and API (8091) servers
- Full test coverage with degraded state scenarios
- Comprehensive documentation in `docs/HEALTH_CHECK.md`

#### Docker/Kubernetes Integration
```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:8090/health/ready"]
  interval: 30s
  timeout: 5s
  retries: 3
```

---

## [1.3.0] - 2025-12-04

### Graceful Shutdown

#### Signal Handling
- **SIGTERM and SIGINT handlers** for PM2 compatibility
- **Graceful connection closure** - Stops accepting new connections, waits for in-flight requests
- **10-second timeout protection** - Forces exit if cleanup hangs
- **Uncaught exception handling** - Triggers graceful shutdown on fatal errors

#### Resource Cleanup
- **Notification persistence** (API server) - Pending notifications saved immediately on shutdown
- **File watcher cleanup** (both servers) - Registry file watcher properly closed
- **Interval cleanup** (API server) - Hourly cleanup interval stopped
- **Port error handling** - Exits immediately if port already in use

#### Implementation Details
- `closeWatcher()` added to `lib/registry-cache.js` for file watcher cleanup
- `saveImmediate()` added to `lib/notification-store.js` for synchronous notification save
- Both servers track server instance for clean HTTP shutdown
- API server tracks cleanup interval handle for proper cleanup

#### Production Benefits
- **Zero downtime deployments** - PM2 reload works seamlessly
- **No data loss** - All notifications saved before exit
- **Clean resource cleanup** - No orphaned file watchers or intervals
- **Reliable restarts** - Predictable shutdown behavior

#### Documentation
- Added `docs/GRACEFUL_SHUTDOWN.md` with comprehensive shutdown documentation
- PM2 configuration guidelines (kill_timeout > 10s)
- Testing procedures for manual and automated testing
- Troubleshooting guide for common shutdown issues

---

## [1.2.0] - 2025-12-04

### Cache Architecture

#### LRU Cache Implementation
- **Implemented LRU (Least Recently Used) cache** with configurable size limits
- Prevents memory leaks from unbounded cache growth
- Automatic eviction of least-recently-used items when cache is full
- O(1) time complexity for get/set operations using JavaScript Map

#### Cache Statistics & Monitoring
- **Comprehensive cache metrics** exposed via `/health` endpoint
- Tracks hits, misses, evictions, and hit rate
- Reports cache utilization percentage
- Registry cache statistics with TTL and invalidation tracking

#### Configuration
- `CACHE_MAX_SIZE` environment variable (default: 100 items)
- `CACHE_TTL` for HTTP Cache-Control headers (default: 3600s)
- `REGISTRY_CACHE_TTL` for registry file caching (default: 60000ms)

#### Testing
- Full test suite for LRU cache behavior (336 tests total)
- Eviction policy verification tests
- Edge case coverage (maxSize=1, large datasets)
- Performance benchmarks (10K operations < 1 second)

#### Documentation
- Added `docs/CACHE_ARCHITECTURE.md` with detailed cache design
- Algorithm explanations and usage examples
- Performance characteristics and monitoring guidelines
- Best practices for cache sizing and tuning

---

## [1.1.0] - 2025-12-03

### Performance Improvements

#### Async I/O Conversion
- **Converted all blocking I/O to async operations** to prevent event loop blocking
- Service server: `loadProjectRegistry()`, `findProjectFavicon()` now fully async
- API server: `loadProjectRegistry()`, `generateFavicon()` now fully async
- Path validator: Added `validatePathAsync()` and `isPathAllowedAsync()` functions
- All route handlers now use `async/await` with comprehensive error handling

#### Performance Impact
- **33x higher throughput** under concurrent load (100 concurrent users)
- **97% faster** total response time under heavy load
- **P95 latency: 25ms** (was 502ms with blocking I/O)
- **P99 latency: 40ms** (was 502ms with blocking I/O)
- Production load test: **9807 req/sec** sustained throughput

#### Scalability
- No event loop blocking - server remains responsive under load
- Parallel file existence checks (35+ paths checked concurrently)
- Can handle 50+ concurrent users without performance degradation
- Meets <50ms response time target even under heavy load

### Testing
- Added async validator test suite (104 total tests passing)
- Created performance benchmark suite
- Created concurrent load test suite
- All existing security tests pass with async implementation

### Documentation
- Added `docs/async-io-conversion.md` with detailed analysis
- Performance benchmarks documented
- Backward compatibility notes

### Backward Compatibility
- Synchronous validators retained for middleware compatibility
- All existing API contracts unchanged
- Security validation logic identical between sync/async versions

---

## [1.0.0] - 2025-11-28

### Initial Release

#### Security Features
- Path traversal protection (CVSS 9.1 vulnerability fix)
- Input validation with express-validator
- Rate limiting (100 req/15min general, 10 req/min notifications)
- CORS whitelist protection
- Helmet security headers (CSP, HSTS, X-Frame-Options)
- SVG sanitization
- JSON body size limits (10KB)

#### Core Features
- Dynamic SVG favicon generation with project initials
- Project type color coding (dev/prod)
- Port number display for dev projects
- Custom favicon support (PNG, SVG, ICO)
- Project registry integration
- In-memory caching with LRU eviction
- Health check endpoints

#### APIs
- Favicon Service API (port 8090)
  - `GET /api/favicon?folder=<path>` - Get project favicon
  - `GET /api/project-info?folder=<path>` - Get project metadata
  - `POST /api/clear-cache` - Clear favicon cache
  - `GET /health` - Service health check

- Favicon API (port 8091)
  - `GET /favicon-api?folder=<path>` - Generate favicon
  - `POST /claude-completion` - Claude task completion notification
  - `GET /claude-status?folder=<path>` - Check completion status
  - `POST /claude-status/mark-read` - Mark notification as read
  - `DELETE /claude-status` - Clear notification
  - `GET /health` - Service health check

#### Infrastructure
- Centralized configuration (`lib/config.js`)
- Environment-based settings (.env support)
- Comprehensive test suite (Jest)
- Security-first architecture
- Production-ready error handling
