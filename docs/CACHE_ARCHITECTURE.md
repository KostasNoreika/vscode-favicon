# Cache Architecture

## Overview

The VS Code Favicon Service implements a two-tier caching strategy to optimize performance and prevent memory leaks:

1. **LRU Cache** (Favicon Cache) - In-memory cache for generated and loaded favicons
2. **TTL Cache** (Registry Cache) - Time-based cache for project registry data

## LRU Cache (Favicon Cache)

### Purpose

Caches generated SVG favicons and loaded image favicons to avoid:
- Redundant file I/O operations
- Repeated SVG generation
- Memory leaks from unbounded growth

### Implementation

**Location:** `/opt/tools/vscode-favicon/lib/lru-cache.js`

**Key Features:**
- Configurable maximum size limit (`CACHE_MAX_SIZE`, default: 100)
- Automatic eviction of least-recently-used items
- O(1) get/set operations using JavaScript Map
- Comprehensive statistics tracking

### Configuration

```bash
# .env file
CACHE_MAX_SIZE=100        # Maximum number of cached favicons
CACHE_TTL=3600            # HTTP Cache-Control header (seconds)
```

### Algorithm

The LRU cache uses JavaScript Map's insertion-order guarantee:

1. **Get Operation:**
   - If key exists: Move to end (most recently used) and return value
   - If key missing: Increment miss counter, return undefined

2. **Set Operation:**
   - If key exists: Delete old entry, add to end
   - If key new and cache full: Delete first entry (LRU), add to end
   - Always increment set counter

3. **Eviction:**
   - First entry in Map is always the least recently used (oldest)
   - Automatic eviction when `size >= maxSize`
   - Eviction counter incremented for monitoring

### Statistics

Available via `/health` endpoint:

```json
{
  "faviconCache": {
    "hits": 245,
    "misses": 12,
    "evictions": 5,
    "sets": 17,
    "size": 95,
    "maxSize": 100,
    "hitRate": "95.3%",
    "utilizationPercent": "95.0%"
  }
}
```

**Metrics:**
- `hits` - Number of successful cache lookups
- `misses` - Number of cache misses
- `evictions` - Number of items evicted due to size limit
- `sets` - Total number of cache writes (including updates)
- `size` - Current number of items in cache
- `maxSize` - Maximum allowed items
- `hitRate` - Percentage of successful lookups
- `utilizationPercent` - Current cache utilization

### Usage in Code

```javascript
const LRUCache = require('../lib/lru-cache');
const config = require('../lib/config');

// Initialize cache with configured size
const faviconCache = new LRUCache(config.cacheMaxSize);

// Cache lookup
const cacheKey = `favicon_${projectPath}`;
const cached = faviconCache.get(cacheKey);
if (cached) {
    return cached.data;
}

// Cache store
faviconCache.set(cacheKey, {
    contentType: 'image/svg+xml',
    data: Buffer.from(svgContent)
});

// Get statistics
const stats = faviconCache.getStats();
console.log(`Cache hit rate: ${stats.hitRate}`);
```

## TTL Cache (Registry Cache)

### Purpose

Caches parsed project registry data to avoid:
- Redundant file reads and JSON parsing
- Registry file I/O on every request
- Performance bottlenecks at high request rates

### Implementation

**Location:** `/opt/tools/vscode-favicon/vscode-favicon-service/server.js`

**Key Features:**
- Time-based cache invalidation (TTL: 60 seconds)
- File watch invalidation (automatic on registry change)
- Graceful degradation (serves stale data on error)
- Flattened lookup structure for O(1) project access

### Configuration

```bash
# .env file
REGISTRY_PATH=/opt/registry/projects.json
REGISTRY_CACHE_TTL=60000  # 60 seconds in milliseconds
```

### Cache Flow

1. **Load Request:**
   - Check if cached and TTL not expired
   - If valid cache: Return cached data (increment hit counter)
   - If expired/missing: Load from file, parse, cache, return

2. **File Watch:**
   - Monitors registry file for changes
   - Automatically invalidates cache on file modification
   - Logs invalidation events

3. **Error Handling:**
   - On load failure: Return stale cache if available
   - Log error but continue serving (graceful degradation)
   - Prevents service disruption from transient file errors

### Statistics

Available via `/health` endpoint:

```json
{
  "registryCache": {
    "hits": 1234,
    "misses": 5,
    "invalidations": 2,
    "hitRate": "99.6%",
    "cached": true,
    "cacheAge": 45000,
    "ttl": 60000
  }
}
```

**Metrics:**
- `hits` - Number of successful cache lookups
- `misses` - Number of cache loads from file
- `invalidations` - Number of file-watch invalidations
- `hitRate` - Percentage of successful lookups
- `cached` - Whether data is currently cached
- `cacheAge` - Age of current cache (ms)
- `ttl` - Cache TTL configuration (ms)

## Cache Invalidation

### Favicon Cache

**Manual Invalidation:**
```bash
curl -X POST http://localhost:8090/api/clear-cache
```

**Automatic Invalidation:**
- None (relies on LRU eviction)
- Consider manual clear after major project changes

### Registry Cache

**Manual Invalidation:**
```bash
curl -X POST http://localhost:8090/api/clear-cache
```

**Automatic Invalidation:**
- File system watch triggers immediate invalidation
- TTL expiration after 60 seconds

## Performance Characteristics

### LRU Cache

**Time Complexity:**
- Get: O(1)
- Set: O(1)
- Eviction: O(1)

**Space Complexity:**
- O(n) where n = maxSize (bounded)
- Prevents unbounded memory growth
- Typical memory per favicon: 2-50 KB (SVG/PNG)

**Benchmark Results:**
```
10,000 set operations: < 1000ms (< 0.1ms per operation)
10,000 get operations: < 500ms  (< 0.05ms per operation)
```

### Registry Cache

**Time Complexity:**
- Get: O(1) (from cache)
- Load: O(n) where n = project count (file I/O + JSON parse)

**Space Complexity:**
- O(n) where n = number of projects
- Flattened structure: 2 entries per project (by name + by path)

## Monitoring & Observability

### Health Check

```bash
curl http://localhost:8090/health | jq '.faviconCache'
```

### Key Metrics to Monitor

1. **Hit Rate:**
   - Target: > 90%
   - Low hit rate indicates cache thrashing or insufficient size

2. **Eviction Count:**
   - Rising evictions suggest `CACHE_MAX_SIZE` too small
   - Consider increasing if eviction rate is high

3. **Utilization:**
   - Target: 60-90%
   - 100% utilization indicates cache is at capacity
   - 0-20% indicates cache may be oversized

### Alerting Recommendations

- **Alert:** Hit rate < 80% for extended period
  - **Action:** Investigate request patterns, consider cache size increase

- **Alert:** Evictions > 1000/hour
  - **Action:** Increase `CACHE_MAX_SIZE` or optimize eviction patterns

- **Alert:** Registry cache invalidations > 10/minute
  - **Action:** Investigate excessive registry file modifications

## Best Practices

### Sizing the Cache

1. **Estimate Project Count:**
   - Development projects: ~50-100
   - Production projects: ~20-50
   - Research/temporary: ~20-30

2. **Calculate Cache Size:**
   - Total projects: ~150
   - Headroom: 50%
   - **Recommended:** 200-300

3. **Memory Budget:**
   - Average favicon size: ~10 KB
   - 100 items: ~1 MB
   - 500 items: ~5 MB
   - 1000 items: ~10 MB

### Cache Warming

Not implemented - cache is demand-driven:
- First request loads and caches
- Subsequent requests hit cache
- Acceptable for this use case (low latency requirements)

### Testing Cache Behavior

See `/opt/tools/vscode-favicon/tests/unit/lru-cache.test.js` for comprehensive test coverage:

- Basic operations (get/set/delete)
- LRU eviction policy verification
- Statistics tracking accuracy
- Edge cases (maxSize=1, large datasets)
- Performance benchmarks

## Future Enhancements

Potential improvements for high-scale deployments:

1. **Persistent Cache:**
   - Redis/Memcached for multi-instance deployments
   - Shared cache across service replicas

2. **Cache Warming:**
   - Pre-populate cache at startup
   - Background refresh of popular items

3. **Adaptive Sizing:**
   - Dynamically adjust maxSize based on memory pressure
   - Auto-tune based on access patterns

4. **Advanced Eviction:**
   - LFU (Least Frequently Used) hybrid
   - TTL-based expiration for stale favicons

5. **Distributed Cache:**
   - Cache coordination across multiple service instances
   - Eventual consistency guarantees

## References

- [LRU Cache Implementation](../lib/lru-cache.js)
- [Configuration Guide](./CONFIGURATION.md)
- [Unit Tests](../tests/unit/lru-cache.test.js)
- [Health Check Endpoint](http://localhost:8090/health)
