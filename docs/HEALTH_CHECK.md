# Health Check System

**Version:** 1.1.0
**Last Updated:** 2025-12-04

## Overview

Enhanced health check system with Kubernetes-style probes for monitoring VS Code Favicon services.

## Features

- **Comprehensive Health Status** - Registry, data directory, memory, cache stats
- **Kubernetes Probes** - Liveness and readiness endpoints
- **Degradation Detection** - 503 status when critical components fail
- **No Rate Limiting** - Health endpoints excluded from rate limits
- **Cache Statistics** - Real-time cache performance metrics

## Endpoints

### Main Health Check

**GET** `/health`

Returns comprehensive health status with all checks.

**Response (200 OK):**
```json
{
  "status": "ok",
  "service": "vscode-favicon-service",
  "version": "1.0.0",
  "environment": "development",
  "timestamp": "2025-12-04T08:18:05.119Z",
  "uptime": "1m 23s",
  "uptimeSeconds": 83,
  "memory": {
    "heapUsed": "9MB",
    "heapTotal": "17MB",
    "rss": "90MB",
    "external": "2MB",
    "arrayBuffers": "8MB"
  },
  "checks": {
    "registry": {
      "status": "ok",
      "path": "/opt/registry/projects.json",
      "size": 46487,
      "modified": "2025-12-04T07:47:57.688Z",
      "readable": true
    },
    "dataDir": {
      "status": "ok",
      "path": "/opt/data/vscode-favicon",
      "writable": true,
      "isDirectory": true
    },
    "faviconCache": {
      "status": "ok",
      "hits": 42,
      "misses": 8,
      "evictions": 0,
      "size": 8,
      "maxSize": 100,
      "hitRate": "84.0%",
      "utilizationPercent": "8.0%"
    },
    "registryCache": {
      "status": "ok",
      "hits": 25,
      "misses": 1,
      "invalidations": 0,
      "hitRate": "96.2%",
      "cached": true,
      "cacheAge": 45123,
      "ttl": 60000
    }
  }
}
```

**Response (503 Service Unavailable) - Degraded:**
```json
{
  "status": "degraded",
  "service": "vscode-favicon-service",
  "version": "1.0.0",
  "timestamp": "2025-12-04T08:18:33.511Z",
  "uptime": "35s",
  "uptimeSeconds": 35,
  "memory": { ... },
  "checks": {
    "registry": {
      "status": "error",
      "path": "/opt/registry/projects.json",
      "error": "ENOENT: no such file or directory",
      "readable": false
    },
    ...
  },
  "message": "Registry file is not accessible"
}
```

### Liveness Probe

**GET** `/health/live`

Kubernetes liveness probe - checks if service process is alive.

**Response (200 OK):**
```json
{
  "status": "alive",
  "timestamp": "2025-12-04T08:18:10.478Z",
  "pid": 7862,
  "uptime": "2m 34s"
}
```

**Use Case:** Kubernetes will restart pod if this returns non-200.

### Readiness Probe

**GET** `/health/ready`

Kubernetes readiness probe - checks if service is ready to accept traffic.

**Response (200 OK):**
```json
{
  "status": "ready",
  "timestamp": "2025-12-04T08:18:15.558Z",
  "message": "Service is ready to accept traffic"
}
```

**Response (503 Service Unavailable):**
```json
{
  "status": "not_ready",
  "timestamp": "2025-12-04T08:18:27.397Z",
  "message": "Registry file is not accessible",
  "error": "ENOENT: no such file or directory"
}
```

**Use Case:** Kubernetes will remove pod from load balancer if this returns 503.

## Health Check Components

### Registry Check

Verifies registry file accessibility and metadata:
- File exists and is readable
- File size and last modification time
- Returns **error** if file is not accessible

### Data Directory Check

Verifies data directory is writable:
- Directory exists and is writable
- Used for notification storage and other persistent data
- Returns **error** if not writable (degrades but doesn't fail service)

### Memory Usage

Reports Node.js process memory:
- **heapUsed** - Used heap memory
- **heapTotal** - Total heap allocated
- **rss** - Resident Set Size (total memory)
- **external** - C++ objects bound to JavaScript
- **arrayBuffers** - ArrayBuffer and SharedArrayBuffer

### Cache Statistics

#### Favicon Cache (Service only)
```json
{
  "hits": 42,
  "misses": 8,
  "evictions": 0,
  "sets": 50,
  "size": 8,
  "maxSize": 100,
  "hitRate": "84.0%",
  "utilizationPercent": "8.0%"
}
```

#### Registry Cache (Both services)
```json
{
  "hits": 25,
  "misses": 1,
  "invalidations": 0,
  "hitRate": "96.2%",
  "cached": true,
  "cacheAge": 45123,
  "ttl": 60000
}
```

#### Notifications (API only)
```json
{
  "total": 5,
  "unread": 2,
  "maxAge": 3600000,
  "maxCount": 1000,
  "ttl": 86400000
}
```

## Status Codes

| Status | HTTP Code | Meaning |
|--------|-----------|---------|
| `ok` | 200 | All checks passed |
| `degraded` | 503 | One or more critical checks failed |
| `error` | 503 | Health check itself failed |

## Degradation Logic

Service is marked **degraded** (503) if:
1. Registry file is not accessible (critical)
2. Data directory is not writable (warning)

Liveness probe **never fails** - it only indicates process death.

Readiness probe **fails** (503) if:
- Registry file is not accessible

## Rate Limiting

Health endpoints are **excluded from rate limiting**:
```javascript
skip: (req) => req.path === '/health' ||
                req.path === '/health/live' ||
                req.path === '/health/ready'
```

This allows unlimited health checks for monitoring systems.

## Monitoring Integration

### Prometheus

```yaml
scrape_configs:
  - job_name: 'vscode-favicon'
    metrics_path: '/health'
    static_configs:
      - targets: ['localhost:8090', 'localhost:8091']
```

### Kubernetes

```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: 8090
  initialDelaySeconds: 10
  periodSeconds: 30
  timeoutSeconds: 5
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /health/ready
    port: 8090
  initialDelaySeconds: 5
  periodSeconds: 10
  timeoutSeconds: 3
  failureThreshold: 2
```

### Docker Healthcheck

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:8090/health/ready"]
  interval: 30s
  timeout: 5s
  retries: 3
  start_period: 10s
```

## Testing

### Manual Testing

```bash
# Main health check
curl -s http://localhost:8090/health | jq .

# Liveness probe
curl -s http://localhost:8090/health/live | jq .

# Readiness probe
curl -s http://localhost:8090/health/ready | jq .

# Test degradation (simulate registry failure)
sudo mv /opt/registry/projects.json /tmp/projects.json.bak
curl -s -w "\nHTTP: %{http_code}\n" http://localhost:8090/health | jq .
sudo mv /tmp/projects.json.bak /opt/registry/projects.json
```

### Automated Testing

```bash
# Run health check tests
npm test -- --testPathPattern=health-check
```

## Implementation

### Module Structure

```
lib/health-check.js
├── checkRegistry()       - Verify registry file access
├── checkDataDir()        - Verify data directory writability
├── getMemoryUsage()      - Format memory statistics
├── getUptime()           - Format process uptime
├── getFullHealth()       - Comprehensive health status
├── getLivenessProbe()    - Kubernetes liveness check
└── getReadinessProbe()   - Kubernetes readiness check
```

### Integration

Both services import health check module:
```javascript
const {
  getFullHealth,
  getLivenessProbe,
  getReadinessProbe
} = require('../lib/health-check');

// Main health endpoint
app.get('/health', async (req, res) => {
  const health = await getFullHealth('service-name', extraChecks);
  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

// Kubernetes probes
app.get('/health/live', (req, res) => {
  res.json(getLivenessProbe());
});

app.get('/health/ready', async (req, res) => {
  const readiness = await getReadinessProbe();
  const statusCode = readiness.status === 'ready' ? 200 : 503;
  res.status(statusCode).json(readiness);
});
```

## Security Considerations

- Health endpoints expose **no sensitive data**
- Registry path is shown but not registry contents
- Memory usage is safe to expose
- Cache statistics don't reveal project data
- No authentication required (monitoring endpoints)

## Performance Impact

- Health checks are **lightweight** (< 1ms)
- File stat operations are **async** (non-blocking)
- Memory usage reporting is **instant** (process.memoryUsage())
- No database queries or heavy operations
- Cache statistics are **pre-calculated** (O(1) access)

## Future Enhancements

- [ ] Add database connection pool health (if DB added)
- [ ] Add external service connectivity checks
- [ ] Add custom health check metrics
- [ ] Add health history (last 10 checks)
- [ ] Add alerting thresholds

## References

- [Kubernetes Liveness/Readiness Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
- [Docker Healthcheck](https://docs.docker.com/engine/reference/builder/#healthcheck)
- [Node.js process.memoryUsage()](https://nodejs.org/api/process.html#processmemoryusage)
