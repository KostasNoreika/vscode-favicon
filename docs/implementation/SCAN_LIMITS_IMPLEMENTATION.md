# FIX QUA-011: Fast-glob Scan Limits Implementation

## Summary
Added comprehensive scan limits and timeout protection to prevent memory leaks in fast-glob filesystem scans during favicon discovery.

## Changes Made

### 1. lib/services/favicon-service.js
**Added scan limit constants (lines 52-57):**
- MAX_RESULTS: 1000 files
- MAX_DIRECTORIES: 50 unique directories  
- TIMEOUT_MS: 5000ms (5 seconds)

**Modified fullProjectScan() method (lines 198-284):**
- Implemented AbortController for timeout protection
- Changed from batch scan to streaming scan using `fg.stream()`
- Added incremental limit checking during scan
- Track unique directories to enforce directory limit
- Log warnings when limits are hit (result, directory, or timeout)
- Gracefully handle AbortError without throwing
- Clear timeout on normal completion
- Return best result found even when limits hit

**Key safeguards:**
1. **Timeout Protection**: 5-second max scan time via AbortController
2. **Result Limit**: Max 1000 files processed to prevent memory exhaustion
3. **Directory Limit**: Max 50 unique directories scanned to bound I/O operations
4. **Graceful Degradation**: Returns best result found before limit/timeout
5. **Error Logging**: Structured logging when limits are enforced

### 2. tests/unit/favicon-service-scan-limits.test.js (NEW)
Comprehensive test suite with 18 tests covering:
- Result limit enforcement (1000 files)
- Directory limit enforcement (50 directories)
- Timeout protection (5 seconds)
- Single-pass min-finding algorithm
- Quick search fast path preference
- Error handling and AbortError recovery
- Cache integration
- Edge cases (empty dirs, permission errors, non-existent paths)

## Test Results
All 61 favicon-service tests pass:
- 18 new scan limit tests
- 43 existing grayscale/color tests

## Performance Impact
**Before:**
- Unbounded scan on large projects
- Potential for memory leaks
- No timeout protection
- Risk of hanging on deep directory structures

**After:**
- Bounded resource usage (max 1000 results, 50 directories)
- 5-second timeout guarantees responsiveness
- Streaming scan reduces memory footprint
- Quick search path still preferred (no performance regression)
- Single-pass algorithm maintains O(n) complexity

## Security Benefits
- Prevents DoS via deep directory structures
- Limits resource consumption on shared systems
- Timeout prevents hung processes
- Structured logging for monitoring

## Files Modified
- `/opt/tools/vscode-favicon/lib/services/favicon-service.js`
- `/opt/tools/vscode-favicon/tests/unit/favicon-service-scan-limits.test.js` (NEW)

## Verification
```bash
npx jest tests/unit/favicon-service-scan-limits.test.js
# PASS - All 18 tests passing

npx jest tests/unit/favicon-service-grayscale.test.js  
# PASS - All 43 existing tests still passing
```
