# Health Check - Quick Reference

## Endpoints

### Main Health Check
```bash
curl http://localhost:8090/health
```
- **200 OK** - All checks passed
- **503 Service Unavailable** - Service degraded

### Liveness Probe
```bash
curl http://localhost:8090/health/live
```
- Always returns **200 OK** if process is alive

### Readiness Probe
```bash
curl http://localhost:8090/health/ready
```
- **200 OK** - Ready to accept traffic
- **503 Service Unavailable** - Not ready (registry inaccessible)

## What's Checked

| Check | Critical | Impact |
|-------|----------|--------|
| Registry File | Yes | 503 if not accessible |
| Data Directory | No | Warning only |
| Memory Usage | Info | Always reported |
| Cache Stats | Info | Performance metrics |

## Response Format

```json
{
  "status": "ok|degraded",
  "service": "vscode-favicon-service",
  "uptime": "2m 34s",
  "memory": { "heapUsed": "11MB", ... },
  "checks": {
    "registry": { "status": "ok", ... },
    "dataDir": { "status": "ok", ... },
    "faviconCache": { "hits": 42, ... },
    "registryCache": { "hitRate": "96.2%", ... }
  }
}
```

## Kubernetes Config

```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: 8090
  initialDelaySeconds: 10
  periodSeconds: 30

readinessProbe:
  httpGet:
    path: /health/ready
    port: 8090
  initialDelaySeconds: 5
  periodSeconds: 10
```

## Docker Healthcheck

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:8090/health/ready"]
  interval: 30s
  timeout: 5s
  retries: 3
```

## Testing

```bash
# Test degradation
mv /opt/registry/projects.json /tmp/backup
curl -w "\nHTTP: %{http_code}\n" http://localhost:8090/health
mv /tmp/backup /opt/registry/projects.json

# Test rate limiting bypass
for i in {1..100}; do curl -s -o /dev/null -w "." http://localhost:8090/health; done
echo " (Should all succeed)"
```

## Files

- **Implementation**: `/opt/tools/vscode-favicon/lib/health-check.js`
- **Documentation**: `/opt/tools/vscode-favicon/docs/HEALTH_CHECK.md`
- **Changelog**: Version 1.4.0

## Ports

- **Service**: 8090
- **API**: 8091
