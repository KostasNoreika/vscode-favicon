# 007: Convert Blocking I/O to Async Operations

**Assigned Agent**: backend-architect
**Epic**: epic-stability
**Status**: TO DO
**Estimated Effort**: M
**Priority**: P0 - CRITICAL

## Vision Alignment

Blocking I/O operations cause 50-100ms delays per request, directly violating the "<50ms response time" performance goal. Async operations are essential for scalability.

## Objective

Replace all synchronous file system operations with asynchronous equivalents.

## Requirements

- Convert `fs.readFileSync` to `fs.promises.readFile`
- Convert `fs.existsSync` to `fs.promises.access`
- Convert `fs.realpathSync` to `fs.promises.realpath`
- Make all route handlers async
- Implement proper error handling for async operations

## Current Blocking Code

**File**: `/opt/tools/vscode-favicon/vscode-favicon-service/server.js`

```javascript
// Line 41 - Blocks event loop
const data = fs.readFileSync(REGISTRY_PATH, 'utf8');

// Lines 89, 99 - Multiple blocking checks
if (fs.existsSync(fullPath)) { ... }

// Line 208 - Blocks on image read
const data = fs.readFileSync(existingFavicon);
```

## Acceptance Criteria

- [ ] All `fs.*Sync` calls replaced with async equivalents
- [ ] Route handlers are async functions
- [ ] Proper try/catch error handling
- [ ] Parallel operations use `Promise.all` where possible
- [ ] No callback-style async (use async/await)
- [ ] Performance improvement measurable (>50% reduction in blocking time)

## Dependencies

- Depends on: 001-006 (security first)
- Blocks: 008, 009

## Technical Notes

```javascript
// Before (blocking)
function loadProjectRegistry() {
    const data = fs.readFileSync(REGISTRY_PATH, 'utf8');
    return JSON.parse(data);
}

// After (async)
async function loadProjectRegistry() {
    const data = await fs.promises.readFile(REGISTRY_PATH, 'utf8');
    return JSON.parse(data);
}

// Parallel file checks
async function findProjectFavicon(projectPath) {
    const checks = possiblePaths.map(async (faviconPath) => {
        const fullPath = path.join(projectPath, faviconPath);
        try {
            await fs.promises.access(fullPath);
            return fullPath;
        } catch {
            return null;
        }
    });
    const results = await Promise.all(checks);
    return results.find(r => r !== null) || null;
}
```

## Resources

- Node.js fs promises: https://nodejs.org/api/fs.html#fspromisesreadfilepath-options

## Testing Requirements

- [ ] Unit tests for async functions
- [ ] Performance benchmarks before/after
- [ ] Integration tests with slow filesystem simulation

---

**Completion Instructions**:
1. When task is completed, rename file to: `done_007_backend-architect_convert-async-io.md`
2. After testing is verified, rename to: `tested_done_007_backend-architect_convert-async-io.md`
