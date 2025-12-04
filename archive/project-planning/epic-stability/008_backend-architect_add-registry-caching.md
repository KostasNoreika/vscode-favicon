# 008: Add Registry Caching with TTL

**Assigned Agent**: backend-architect
**Epic**: epic-stability
**Status**: TO DO
**Estimated Effort**: S
**Priority**: P1 - HIGH

## Vision Alignment

Registry is loaded from disk on every request (20ms overhead). Caching reduces this to <1ms, supporting the performance and scalability goals.

## Objective

Implement TTL-based caching for the project registry with file-watch invalidation.

## Requirements

- Cache registry in memory with 60-second TTL
- Invalidate cache on file changes via `fs.watch`
- Thread-safe cache access
- Graceful fallback if cache fails

## Current Code

```javascript
// Called on EVERY request - no caching
function loadProjectRegistry() {
    const data = fs.readFileSync(REGISTRY_PATH, 'utf8');
    const registry = JSON.parse(data);
    // ... processing
}
```

## Acceptance Criteria

- [ ] Registry cached in memory
- [ ] TTL of 60 seconds (configurable)
- [ ] `fs.watch` invalidates cache on file change
- [ ] Cache hit rate logged for monitoring
- [ ] Fallback to disk read if cache corrupted
- [ ] Cache stats exposed in health endpoint

## Dependencies

- Depends on: 007 (async I/O)
- Blocks: None

## Technical Notes

```javascript
let registryCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60000; // 1 minute

// Watch for file changes
fs.watch(REGISTRY_PATH, () => {
    registryCache = null;
    console.log('Registry cache invalidated');
});

async function loadProjectRegistry() {
    const now = Date.now();
    if (registryCache && (now - cacheTimestamp) < CACHE_TTL) {
        return registryCache;
    }

    const data = await fs.promises.readFile(REGISTRY_PATH, 'utf8');
    registryCache = JSON.parse(data);
    cacheTimestamp = now;
    return registryCache;
}
```

## Resources

- Node.js fs.watch: https://nodejs.org/api/fs.html#fswatchfilename-options-listener

## Testing Requirements

- [ ] Unit tests for cache behavior
- [ ] Integration tests for TTL expiration
- [ ] Tests for file-watch invalidation

---

**Completion Instructions**:
1. When task is completed, rename file to: `done_008_backend-architect_add-registry-caching.md`
2. After testing is verified, rename to: `tested_done_008_backend-architect_add-registry-caching.md`
