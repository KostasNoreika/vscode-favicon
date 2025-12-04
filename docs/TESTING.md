# Testing Documentation

## Overview

vscode-favicon project has comprehensive test coverage using Jest testing framework. Current test coverage: **82.2%** overall.

## Test Statistics

```
Statements   : 82.2% (194/236)
Branches     : 77.86% (102/131)
Functions    : 85.71% (36/42)
Lines        : 82.12% (193/235)
```

### Module-specific Coverage

| Module | Statements | Branches | Functions | Lines | Status |
|--------|-----------|----------|-----------|-------|--------|
| cors-config.js | 100% | 100% | 100% | 100% | ✅ Complete |
| lru-cache.js | 100% | 100% | 100% | 100% | ✅ Complete |
| svg-sanitizer.js | 97.61% | 96.66% | 100% | 97.61% | ✅ Excellent |
| path-validator.js | 74.33% | 70.96% | 78.57% | 74.1% | ⚠️ Good |
| validators.js | 65.71% | 50% | 62.5% | 65.71% | ⚠️ Adequate |

**Note**: The following modules are excluded from coverage (API-specific, tested via integration):
- `notification-store.js` - Notification system (API only)
- `registry-cache.js` - Registry caching (API only)
- `config.js` - Runtime configuration (integration tested)
- `logger.js` - Logging utility (integration tested)

## Test Structure

```
tests/
├── setup.js                          # Global test setup
├── unit/                             # Unit tests (core modules)
│   ├── cors-config.test.js          # CORS configuration (100%)
│   ├── lru-cache.test.js            # LRU cache (100%)
│   ├── path-validator.test.js       # Path validation (74%)
│   └── svg-sanitizer.test.js        # SVG sanitization (97%)
├── integration/                      # Integration tests (API endpoints)
│   └── api-endpoints.test.js        # Full HTTP request/response cycle
├── fixtures/                         # Test data
│   └── mock-registry.json           # Mock project registry
├── performance-benchmark.js          # Performance benchmarks
└── concurrent-benchmark.js           # Concurrency testing
```

## Running Tests

### Quick Start

```bash
# Run all tests
npm test

# Run tests in watch mode (auto-rerun on file changes)
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Run specific test suite
npm run test:unit              # Unit tests only
npm run test:integration       # Integration tests only
npm run test:security          # Security tests (path-validator)
```

### Advanced Commands

```bash
# Verbose output
npm run test:verbose

# Silent mode (errors only)
npm run test:silent

# Debug mode (with Node inspector)
npm run test:debug

# CI mode (optimized for CI/CD)
npm run test:ci

# Coverage check (fails if below threshold)
npm run coverage:check

# Open coverage report in browser
npm run coverage:open
```

### Run Specific Tests

```bash
# Run specific test file
npm test -- tests/unit/path-validator.test.js

# Run tests matching pattern
npm test -- -t "should validate paths"

# Run single test
npm test -- -t "should reject path traversal"
```

## Coverage Thresholds

### Global Thresholds (70%)

All core lib/ modules must maintain:
- Statements: ≥ 70%
- Branches: ≥ 70%
- Functions: ≥ 70%
- Lines: ≥ 70%

### Module-specific Thresholds

**Critical Security Modules** (higher standards):

1. **svg-sanitizer.js** - 80% threshold
   - XSS protection critical
   - Currently: 97.61% ✅

2. **cors-config.js** - 80% threshold
   - CORS security critical
   - Currently: 100% ✅

3. **lru-cache.js** - 80% threshold
   - Performance-critical component
   - Currently: 100% ✅

4. **path-validator.js** - 70% threshold
   - Path traversal protection
   - Currently: 74.33% ✅

## Test Categories

### Unit Tests (5 suites, 168 tests)

**CORS Configuration** (`tests/unit/cors-config.test.js`):
- Origin whitelist validation
- CORS middleware functionality
- Cache poisoning protection
- Origin validation bypass attempts

**LRU Cache** (`tests/unit/lru-cache.test.js`):
- Constructor and initialization
- Basic operations (get/set/delete/has)
- LRU eviction logic
- Statistics tracking
- Performance characteristics

**Path Validator** (`tests/unit/path-validator.test.js`):
- Path traversal detection
- Null byte injection prevention
- URL encoding attacks
- Real-world attack scenarios
- Async/sync validator parity

**SVG Sanitizer** (`tests/unit/svg-sanitizer.test.js`):
- XSS vector detection
- Dangerous attribute removal
- Script tag elimination
- Event handler blocking
- Data URI protection

**Validators** (`tests/unit/validators.test.js`):
- express-validator v7+ compatibility
- Input validation rules
- Error message formatting

### Integration Tests (1 suite, 20 tests)

**API Endpoints** (`tests/integration/api-endpoints.test.js`):
- GET /health endpoint
- GET /favicon-api with validation
- POST /claude-completion with security checks
- GET /claude-status
- Request body size limits
- CORS headers
- Malformed JSON handling
- Error responses

### Performance Tests

**Performance Benchmark** (`tests/performance-benchmark.js`):
- Path validator throughput
- LRU cache operations
- SVG sanitizer processing

**Concurrent Benchmark** (`tests/concurrent-benchmark.js`):
- Multi-threaded request handling
- Cache contention scenarios

## Coverage Reports

### Text Report (terminal)

```bash
npm run test:coverage
```

Displays table with per-file coverage metrics.

### HTML Report (browser)

```bash
npm run test:coverage
npm run coverage:open
```

Interactive HTML report at `coverage/index.html`:
- Line-by-line coverage visualization
- Uncovered code highlighting
- Branch coverage details
- Function coverage breakdown

### LCOV Report (CI/CD)

```bash
npm run test:ci
```

Generates `coverage/lcov.info` for CI/CD integration:
- Compatible with CodeCov, Coveralls, SonarQube
- Used in automated quality gates

## Writing Tests

### Test File Template

```javascript
/**
 * Test Suite: Module Name
 * Tests module functionality, edge cases, and security
 */

describe('Module Name', () => {
    describe('Feature Category', () => {
        test('should behave as expected', () => {
            // Arrange
            const input = 'test input';

            // Act
            const result = myFunction(input);

            // Assert
            expect(result).toBe('expected output');
        });
    });

    describe('Edge Cases', () => {
        test('should handle null input', () => {
            expect(() => myFunction(null)).toThrow();
        });
    });
});
```

### Best Practices

1. **Arrange-Act-Assert Pattern**
   - Arrange: Setup test data
   - Act: Execute function
   - Assert: Verify result

2. **Descriptive Test Names**
   ```javascript
   // Good
   test('should reject path traversal with ../ sequence', () => {});

   // Bad
   test('test path validation', () => {});
   ```

3. **Test Edge Cases**
   - Null/undefined inputs
   - Empty strings
   - Very long inputs
   - Special characters
   - Boundary values

4. **Security-focused Tests**
   - Test attack vectors (XSS, path traversal, injection)
   - Validate input sanitization
   - Check authorization bypass attempts

5. **Integration Test Patterns**
   - Use `supertest` for HTTP testing
   - Mock external dependencies
   - Test complete request/response cycle

### Example: Security Test

```javascript
describe('Path Traversal Protection', () => {
    test('should block directory traversal with ../..', () => {
        const maliciousPath = '/opt/dev/../../etc/passwd';
        const result = isPathAllowed(maliciousPath);
        expect(result).toBe(false);
    });

    test('should block URL-encoded traversal', () => {
        const encodedPath = '/opt/dev/%2E%2E%2F%2E%2E%2Fetc';
        const result = isPathAllowed(encodedPath);
        expect(result).toBe(false);
    });
});
```

## Continuous Integration

### GitHub Actions / Forgejo Actions

```yaml
- name: Run tests
  run: npm test

- name: Run coverage
  run: npm run test:ci

- name: Upload coverage
  uses: codecov/codecov-action@v3
  with:
    files: ./coverage/lcov.info
```

### Pre-commit Hook

```bash
#!/bin/bash
npm run test:coverage
if [ $? -ne 0 ]; then
    echo "Tests failed. Commit aborted."
    exit 1
fi
```

## Troubleshooting

### Tests Failing

1. **Clear Jest cache**
   ```bash
   npx jest --clearCache
   npm test
   ```

2. **Check Node version**
   ```bash
   node --version  # Should be >= 18
   ```

3. **Reinstall dependencies**
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```

### Coverage Not Generated

1. **Ensure coverage directory exists**
   ```bash
   mkdir -p coverage
   ```

2. **Check jest.config.js**
   - Verify `collectCoverageFrom` patterns
   - Check `coverageDirectory` setting

### Watch Mode Not Working

```bash
# Kill any hanging processes
pkill -f "jest --watch"

# Restart watch mode
npm run test:watch
```

## Related Documentation

- [SECURITY.md](/opt/tools/vscode-favicon/docs/SECURITY.md) - Security testing guidelines
- [PATH-VALIDATOR.md](/opt/tools/vscode-favicon/docs/PATH-VALIDATOR.md) - Path validation details
- [SECURITY_VALIDATION.md](/opt/tools/vscode-favicon/docs/SECURITY_VALIDATION.md) - Security validation
- [jest.config.js](/opt/tools/vscode-favicon/jest.config.js) - Jest configuration

## Future Improvements

### Coverage Goals

- [ ] Increase path-validator.js to 85% (currently 74%)
- [ ] Add unit tests for validators.js edge cases
- [ ] Integration tests for notification-store.js
- [ ] Integration tests for registry-cache.js
- [ ] E2E tests for full API workflow

### Test Infrastructure

- [ ] Add mutation testing (Stryker)
- [ ] Property-based testing (fast-check)
- [ ] Visual regression testing for favicon rendering
- [ ] Load testing for concurrent requests
- [ ] Fuzzing for input validation

### CI/CD

- [ ] Automated coverage trend tracking
- [ ] Performance regression detection
- [ ] Security vulnerability scanning in CI
- [ ] Automated dependency updates with test verification
