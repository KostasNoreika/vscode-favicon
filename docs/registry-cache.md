# Registry Cache Implementation

## Overview

Centralized registry caching system with TTL (Time-To-Live) and automatic file watch invalidation. Both API and Service servers share the same cache implementation via `/lib/registry-cache.js` module.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  /lib/registry-cache.js (Shared Module)        │
│  ┌─────────────────────────────────────────┐   │
│  │ In-Memory Cache                         │   │
│  │  - registryCache: Object                │   │
│  │  - cacheTimestamp: Number               │   │
│  │  - cacheStats: { hits, misses, inv }    │   │
│  └─────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────┐   │
│  │ fs.watch() File Monitor                 │   │
│  │  - Watches: /opt/registry/projects.json│   │
│  │  - On change: invalidates cache         │   │
│  └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
           │                       │
           ▼                       ▼
    ┌─────────────┐         ┌─────────────┐
    │ API Server  │         │   Service   │
    │  (port 8091)│         │  (port 8090)│
    └─────────────┘         └─────────────┘
```

## Features

### 1. TTL-Based Caching

- **Default TTL**: 60 seconds (60000ms)
- **Configurable**: Via `REGISTRY_CACHE_TTL` environment variable
- **Behavior**:
  - First request: Cache miss, loads from disk
  - Subsequent requests within TTL: Cache hit, returns from memory
  - After TTL expires: Cache miss, reloads from disk

### 2. File Watch Invalidation

- **Automatic**: Uses `fs.watch()` to monitor registry file
- **Events**: Detects `change` events on `/opt/registry/projects.json`
- **Action**: Immediately invalidates cache on file modification
- **Graceful**: If watch fails, falls back to TTL-only mode

### 3. Cache Statistics

Available via `/health` endpoint:

```json
{
  "registryCache": {
    "hits": 15,
    "misses": 3,
    "invalidations": 1,
    "hitRate": "83.3%",
    "cached": true,
    "cacheAge": 5230,
    "ttl": 60000
  }
}
```

**Metrics:**
- `hits`: Number of requests served from cache
- `misses`: Number of requests that required disk read
- `invalidations`: Number of times cache was cleared (file changes + manual)
- `hitRate`: Percentage of cache hits
- `cached`: Whether cache currently has data
- `cacheAge`: Time (ms) since last cache update
- `ttl`: Configured TTL in milliseconds

### 4. Graceful Degradation

If registry file read fails:
1. Returns stale cache if available (logs warning)
2. Returns empty registry `{ projects: {}, original: {} }` if no cache

### 5. Multi-Format Support

Supports both registry formats:
- **Array format**: `[metadata, { development: [...], production: [...] }]`
- **Legacy format**: `{ projects: { development: [...], production: [...] } }`

## API

### `getRegistry()`

```javascript
const { getRegistry } = require('../lib/registry-cache');

const registry = await getRegistry();
// Returns: { projects: {...}, original: {...} }

// Access project by path
const project = registry.projects['/opt/dev/my-project'];

// Access project by name
const project = registry.projects['my-project'];
```

### `getCacheStats()`

```javascript
const { getCacheStats } = require('../lib/registry-cache');

const stats = getCacheStats();
// Returns: { hits, misses, invalidations, hitRate, cached, cacheAge, ttl }
```

### `invalidateCache()`

```javascript
const { invalidateCache } = require('../lib/registry-cache');

invalidateCache();
// Manually clears cache, increments invalidations counter
```

### `resetStats()`

```javascript
const { resetStats } = require('../lib/registry-cache');

resetStats();
// Resets all statistics counters to 0
```

## Configuration

### Environment Variables

```bash
# Registry cache TTL in milliseconds (default: 60000 = 60 seconds)
REGISTRY_CACHE_TTL=60000

# Registry file path (default: /opt/registry/projects.json)
REGISTRY_PATH=/opt/registry/projects.json
```

### Config File

Settings in `/lib/config.js`:

```javascript
registryCacheTtl: parseInt(process.env.REGISTRY_CACHE_TTL || '60000', 10),
registryPath: process.env.REGISTRY_PATH || '/opt/registry/projects.json'
```

## Usage Examples

### Example 1: Basic Usage

```javascript
const { getRegistry } = require('../lib/registry-cache');

async function getFaviconInfo(projectPath) {
    const registry = await getRegistry();
    const projectInfo = registry.projects[projectPath] || {};

    return {
        name: projectInfo.name || path.basename(projectPath),
        port: projectInfo.port,
        type: projectInfo.type || 'dev'
    };
}
```

### Example 2: Cache Statistics Monitoring

```javascript
const { getCacheStats } = require('../lib/registry-cache');

app.get('/health', (req, res) => {
    const cacheStats = getCacheStats();

    res.json({
        status: 'ok',
        registryCache: cacheStats
    });
});
```

### Example 3: Manual Cache Invalidation

```javascript
const { invalidateCache } = require('../lib/registry-cache');

app.post('/api/clear-cache', (req, res) => {
    invalidateCache();

    res.json({
        success: true,
        message: 'Registry cache invalidated'
    });
});
```

## Performance Benefits

### Before Cache (Direct File Reads)

```
Request 1: Read /opt/registry/projects.json (5-10ms)
Request 2: Read /opt/registry/projects.json (5-10ms)
Request 3: Read /opt/registry/projects.json (5-10ms)
...
Total for 100 requests: 500-1000ms
```

### After Cache (In-Memory)

```
Request 1: Read /opt/registry/projects.json (5-10ms) - MISS
Request 2: Read from memory (0.01ms) - HIT
Request 3: Read from memory (0.01ms) - HIT
...
Total for 100 requests: ~10ms (50-100x faster)
```

### Real-World Performance

```bash
# Cache miss (first request)
curl "http://localhost:8090/api/project-info?folder=/opt/dev/KAGI-AI"
# Response time: 5-10ms

# Cache hit (subsequent requests within TTL)
curl "http://localhost:8090/api/project-info?folder=/opt/dev/other-project"
# Response time: <1ms (instant from memory)
```

## Testing

### Test Cache TTL

```bash
# First request - cache miss
curl -s "http://localhost:8090/api/project-info?folder=/opt/dev/test" | jq .name

# Second request - cache hit
curl -s "http://localhost:8090/api/project-info?folder=/opt/dev/test" | jq .name

# Check stats
curl -s "http://localhost:8090/health" | jq .registryCache
# Should show: hits=1, misses=1, hitRate="50.0%"
```

### Test File Watch Invalidation

```bash
# Load cache
curl -s "http://localhost:8090/api/project-info?folder=/opt/dev/test" > /dev/null

# Check cache
curl -s "http://localhost:8090/health" | jq '.registryCache.cached'
# Should show: true

# Modify registry file
touch /opt/registry/projects.json

# Wait 1 second for fs.watch event
sleep 1

# Check cache again
curl -s "http://localhost:8090/health" | jq '.registryCache'
# Should show: cached=false, invalidations=1
```

## Monitoring

### Health Endpoint

```bash
curl -s http://localhost:8090/health | jq '.registryCache'
```

**Healthy Cache:**
```json
{
  "hits": 150,
  "misses": 5,
  "invalidations": 2,
  "hitRate": "96.8%",
  "cached": true,
  "cacheAge": 15000,
  "ttl": 60000
}
```

**Cache Invalidated:**
```json
{
  "hits": 150,
  "misses": 5,
  "invalidations": 3,
  "hitRate": "96.8%",
  "cached": false,
  "cacheAge": null,
  "ttl": 60000
}
```

### Logs

Registry cache events are logged via pino logger:

```
[INFO] Registry file watch enabled
       registryPath: "/opt/registry/projects.json"

[INFO] Registry loaded and cached
       projectCount: 63
       registryPath: "/opt/registry/projects.json"
       ttl: 60000

[INFO] Registry file changed, invalidating cache
       registryPath: "/opt/registry/projects.json"
       cacheAge: 25000

[WARN] Using stale registry cache due to error
       cacheAge: 65000
       ttl: 60000
```

## Troubleshooting

### Cache Not Working

**Symptoms:** `hitRate: "0.0%"` or all requests show `misses`

**Causes:**
1. TTL too short (cache expires between requests)
2. File watch triggering on every request
3. Different server instances (each has its own cache)

**Solution:**
```bash
# Check TTL
echo $REGISTRY_CACHE_TTL

# Increase TTL if needed
export REGISTRY_CACHE_TTL=120000  # 2 minutes

# Check file watch events
tail -f /tmp/service.log | grep "Registry file changed"
```

### File Watch Not Working

**Symptoms:** Cache not invalidating after registry file changes

**Causes:**
1. File system doesn't support `fs.watch()` (rare)
2. Registry file path incorrect
3. Permissions issue

**Solution:**
```bash
# Verify registry path
cat /opt/registry/projects.json | head -10

# Check permissions
ls -la /opt/registry/projects.json

# Manual invalidation via API
curl -X POST http://localhost:8090/api/clear-cache
```

### High Miss Rate

**Symptoms:** `hitRate: "20%"` or lower

**Causes:**
1. Registry file changing frequently
2. TTL too short
3. Heavy load with many different projects

**Solution:**
```bash
# Increase TTL
export REGISTRY_CACHE_TTL=300000  # 5 minutes

# Monitor invalidations
curl -s http://localhost:8090/health | jq '.registryCache.invalidations'

# If invalidations > 10/minute, registry is changing too frequently
```

## Migration Guide

### From Old Inline Cache

**Before:**
```javascript
// In server.js
let registryCache = null;
let registryCacheTime = 0;

async function loadProjectRegistry() {
    // ... cache logic
}
```

**After:**
```javascript
// Import centralized cache
const { getRegistry, getCacheStats } = require('../lib/registry-cache');

// Use it
const registry = await getRegistry();
const stats = getCacheStats();
```

### Breaking Changes

None - API is compatible with previous inline implementation.

## Future Enhancements

1. **Shared Cache** - Redis/Memcached for multi-instance deployments
2. **Selective Invalidation** - Only invalidate specific projects
3. **Cache Warming** - Pre-load cache on startup
4. **Cache Serialization** - Persist cache to disk for faster restarts
5. **Metrics Export** - Prometheus/StatsD integration

## Related Files

- `/opt/tools/vscode-favicon/lib/registry-cache.js` - Cache implementation
- `/opt/tools/vscode-favicon/lib/config.js` - Configuration
- `/opt/tools/vscode-favicon/vscode-favicon-service/server.js` - Service consumer
- `/opt/tools/vscode-favicon/vscode-favicon-api/server.js` - API consumer
- `/opt/registry/projects.json` - Registry data source
