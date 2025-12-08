# Development Guide

Complete guide for developers working on the VS Code Favicon Service project.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Code Quality](#code-quality)
- [Debugging](#debugging)
- [Contributing](#contributing)

---

## Prerequisites

### Required Software

- **Node.js**: Version 20.x or higher
  ```bash
  node --version  # Should output v20.x.x or higher
  ```

- **npm**: Version 10.x or higher (comes with Node.js)
  ```bash
  npm --version  # Should output 10.x.x or higher
  ```

- **PM2**: Process manager (optional for development, required for production)
  ```bash
  npm install -g pm2
  ```

### Optional Tools

- **curl**: For testing API endpoints
- **jq**: For formatting JSON responses
- **git**: For version control

### System Requirements

- **OS**: macOS, Linux, or Windows (WSL recommended)
- **RAM**: Minimum 2GB available
- **Disk**: 500MB for dependencies and coverage reports

---

## Getting Started

### 1. Clone the Repository

```bash
git clone https://git.noreika.lt/kostas/vscode-favicon.git
cd vscode-favicon
```

### 2. Install Dependencies

```bash
npm install
```

This installs all production and development dependencies, including:
- Express.js and middleware
- Jest testing framework
- ESLint and Prettier
- Development tools

### 3. Configure Environment

```bash
# Copy example configuration
cp .env.example .env

# Edit configuration (optional - defaults work for local development)
vim .env
```

**Minimal development configuration** (`.env`):

```bash
# Service
SERVICE_PORT=8090

# Paths
REGISTRY_PATH=/opt/registry/projects.json
ALLOWED_PATHS=/opt/dev,/opt/prod,/opt/research

# CORS (add localhost for development)
CORS_ORIGINS=http://localhost:8080,https://vs.noreika.lt

# Cache
CACHE_MAX_SIZE=100
CACHE_TTL=3600

# Rate Limiting
RATE_LIMIT_WINDOW=900000
RATE_LIMIT_MAX=100

# Logging
LOG_LEVEL=debug
```

### 4. Create Test Registry

If `/opt/registry/projects.json` doesn't exist:

```bash
sudo mkdir -p /opt/registry

sudo tee /opt/registry/projects.json > /dev/null <<EOF
{
  "projects": {
    "development": [
      {
        "name": "test-project",
        "path": "/opt/dev/test-project",
        "port": "8080",
        "type": "dev",
        "url": "http://localhost:8080"
      }
    ]
  }
}
EOF
```

### 5. Verify Installation

```bash
# Run tests to ensure everything is working
npm test

# Check linting
npm run lint

# Verify configuration
node -e "console.log(require('./lib/config'))"
```

---

## Project Structure

```
vscode-favicon/
├── lib/                          # Shared libraries
│   ├── config.js                # Configuration management
│   ├── path-validator.js        # Path validation & security
│   ├── cors-config.js           # CORS middleware
│   ├── svg-sanitizer.js         # XSS protection
│   ├── validators.js            # Express validators
│   ├── logger.js                # Pino logger setup
│   ├── health-check.js          # Health check utilities
│   ├── lru-cache.js             # LRU cache implementation
│   ├── registry-cache.js        # Project registry cache
│   └── notification-store.js    # Notification storage
│
├── vscode-favicon-service/      # Main service (port 8090)
│   └── server.js                # Express app
│
├── vscode-favicon-api/          # API service (port 8091)
│   └── server.js                # Express app
│
├── vscode-favicon-extension/    # Browser extension
│   ├── content.js               # Content script
│   ├── manifest.json            # Extension manifest
│   └── styles.css               # Badge styles
│
├── tests/                       # Test suites
│   ├── setup.js                 # Jest setup
│   ├── unit/                    # Unit tests
│   │   ├── path-validator.test.js
│   │   ├── cors-config.test.js
│   │   ├── svg-sanitizer.test.js
│   │   ├── lru-cache.test.js
│   │   └── validators.test.js
│   ├── integration/             # Integration tests
│   │   └── api-endpoints.test.js
│   └── fixtures/                # Test data
│       └── mock-registry.json
│
├── docs/                        # Documentation
│   ├── API.md                   # API reference
│   ├── ARCHITECTURE.md          # System architecture
│   ├── DEVELOPMENT.md           # This file
│   ├── CONFIGURATION.md         # Config guide
│   ├── SECURITY.md              # Security docs
│   ├── TESTING.md               # Testing guide
│   ├── CI_CD.md                 # CI/CD pipeline
│   └── ...                      # Other docs
│
├── .env.example                 # Config template
├── .env                         # Local config (gitignored)
├── .gitignore                   # Git ignore rules
├── .eslintrc.js                 # ESLint config
├── .prettierrc                  # Prettier config
├── package.json                 # Dependencies & scripts
├── jest.config.js               # Jest config
├── ecosystem.config.js          # PM2 config
└── README.md                    # Main readme
```

---

## Development Workflow

### Start Services in Development Mode

#### Option 1: Direct Node.js (Recommended for Development)

```bash
# Terminal 1: Start Favicon Service
node vscode-favicon-service/server.js

# Terminal 2: Start Favicon API
node vscode-favicon-api/server.js
```

**Advantages**:
- Direct console output
- Easy to stop (Ctrl+C)
- No PM2 overhead
- Simpler debugging

#### Option 2: PM2 (Production-like)

```bash
# Start both services
pm2 start ecosystem.config.js

# View logs
pm2 logs

# Reload after code changes
pm2 reload ecosystem.config.js

# Stop services
pm2 stop ecosystem.config.js
```

### Verify Services are Running

```bash
# Check service health
curl http://localhost:8090/health | jq
curl http://localhost:8091/health | jq

# Test favicon generation
curl "http://localhost:8090/api/favicon?folder=/opt/dev/test-project"

# Test API endpoint
curl "http://localhost:8091/favicon-api?folder=/opt/dev/test-project"
```

### Development Cycle

1. **Make code changes** in `lib/`, `vscode-favicon-service/`, or `vscode-favicon-api/`

2. **Run linter** to check code style:
   ```bash
   npm run lint
   # Auto-fix issues:
   npm run lint:fix
   ```

3. **Format code** with Prettier:
   ```bash
   npm run format
   ```

4. **Run tests** to ensure nothing broke:
   ```bash
   # Quick test run
   npm test

   # With coverage
   npm run test:coverage

   # Watch mode (re-run on file changes)
   npm run test:watch
   ```

5. **Restart services** (if using direct Node.js):
   ```bash
   # Stop with Ctrl+C and restart
   node vscode-favicon-service/server.js
   ```

   Or (if using PM2):
   ```bash
   pm2 reload ecosystem.config.js
   ```

6. **Test manually** with curl:
   ```bash
   curl "http://localhost:8090/api/favicon?folder=/opt/dev/test-project"
   ```

### Hot Reload Setup (Optional)

Use `nodemon` for automatic restarts on file changes:

```bash
# Install nodemon
npm install -g nodemon

# Start with auto-reload
nodemon vscode-favicon-service/server.js
nodemon vscode-favicon-api/server.js
```

---

## Testing

### Run All Tests

```bash
npm test
```

### Run Specific Test Suites

```bash
# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# Security tests (path validator)
npm run test:security
```

### Run Specific Test Files

```bash
npm test -- tests/unit/path-validator.test.js
npm test -- tests/unit/lru-cache.test.js
```

### Coverage Reports

```bash
# Generate coverage report
npm run test:coverage

# Open HTML report in browser (macOS)
npm run coverage:open

# Check coverage meets thresholds
npm run coverage:check
```

### Watch Mode

```bash
# Auto-run tests on file changes
npm run test:watch
```

### Writing Tests

See [TESTING.md](TESTING.md) for complete testing guide.

**Quick example**:

```javascript
// tests/unit/my-module.test.js
const myModule = require('../../lib/my-module');

describe('My Module', () => {
  test('should do something', () => {
    const result = myModule.doSomething('input');
    expect(result).toBe('expected output');
  });

  test('should handle edge case', () => {
    expect(() => myModule.doSomething(null)).toThrow();
  });
});
```

---

## Code Quality

### Linting (ESLint)

```bash
# Check for linting errors
npm run lint

# Auto-fix fixable issues
npm run lint:fix
```

**ESLint configuration** (`.eslintrc.js`):
- Extends: `eslint:recommended`, `plugin:security/recommended`
- Plugins: `node`, `security`
- Environment: Node.js, Jest
- Rules: No unused vars, security checks, etc.

### Formatting (Prettier)

```bash
# Check formatting
npm run format:check

# Auto-format all files
npm run format
```

**Prettier configuration** (`.prettierrc`):
```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 4,
  "printWidth": 100
}
```

### Run All Quality Checks

```bash
# Format + Lint + Test with coverage
npm run quality
```

### Pre-commit Checklist

Before committing code, ensure:

1. ✅ Code is formatted: `npm run format`
2. ✅ No linting errors: `npm run lint`
3. ✅ Tests pass: `npm test`
4. ✅ Coverage meets threshold: `npm run coverage:check`

---

## Debugging

### Debug Tests

```bash
# Run tests with Node debugger
npm run test:debug

# Then in Chrome DevTools:
# 1. Open chrome://inspect
# 2. Click "Open dedicated DevTools for Node"
# 3. Set breakpoints and step through code
```

### Debug Services

```bash
# Start service with inspector
node --inspect vscode-favicon-service/server.js

# Or with break on first line
node --inspect-brk vscode-favicon-service/server.js

# Connect with Chrome DevTools (chrome://inspect)
```

### Debug with VS Code

Create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Favicon Service",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/vscode-favicon-service/server.js",
      "envFile": "${workspaceFolder}/.env"
    },
    {
      "name": "Debug Tests",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/node_modules/.bin/jest",
      "args": ["--runInBand"],
      "console": "integratedTerminal"
    }
  ]
}
```

Then press F5 to start debugging.

### Debug Logs

Set `LOG_LEVEL=trace` in `.env` for verbose logging:

```bash
LOG_LEVEL=trace node vscode-favicon-service/server.js
```

Log levels:
- `trace` - Everything (very verbose)
- `debug` - Debug info + above
- `info` - General info (default)
- `warn` - Warnings only
- `error` - Errors only
- `fatal` - Fatal errors only

### Performance Profiling

```bash
# Run performance benchmarks
npm run benchmark

# Run concurrent load test
npm run benchmark:concurrent
```

---

## Working with Shared Libraries

### Adding a New Shared Module

1. Create file in `lib/`:
   ```bash
   touch lib/my-module.js
   ```

2. Implement module:
   ```javascript
   // lib/my-module.js
   const config = require('./config');

   function myFunction(input) {
     // Implementation
     return result;
   }

   module.exports = {
     myFunction
   };
   ```

3. Add tests:
   ```bash
   touch tests/unit/my-module.test.js
   ```

4. Use in services:
   ```javascript
   // vscode-favicon-service/server.js
   const { myFunction } = require('../lib/my-module');

   app.get('/my-endpoint', (req, res) => {
     const result = myFunction(req.query.input);
     res.json(result);
   });
   ```

### Modifying Existing Modules

1. **Read existing tests** to understand expected behavior
2. **Add new tests** for your changes (TDD approach)
3. **Make changes** to implementation
4. **Run tests** to ensure nothing broke:
   ```bash
   npm test -- tests/unit/my-module.test.js
   ```
5. **Update documentation** if API changes

---

## Contributing

### Git Workflow

1. **Create feature branch**:
   ```bash
   git checkout -b feature/my-feature
   ```

2. **Make changes** and commit frequently:
   ```bash
   git add .
   git commit -m "Add feature X"
   ```

3. **Run quality checks** before push:
   ```bash
   npm run quality
   ```

4. **Push to remote**:
   ```bash
   git push origin feature/my-feature
   ```

5. **Create Pull Request** on Forgejo

### Commit Message Guidelines

Use clear, descriptive commit messages:

```
Good:
- "Fix path traversal vulnerability in path-validator"
- "Add LRU cache eviction metrics to /health endpoint"
- "Update CORS origins to include new domain"

Bad:
- "fix bug"
- "update code"
- "changes"
```

### Code Review Checklist

When reviewing PRs, check:

- [ ] Tests added/updated for changes
- [ ] Documentation updated if needed
- [ ] Code follows ESLint + Prettier rules
- [ ] No security vulnerabilities introduced
- [ ] Coverage doesn't decrease
- [ ] Commit messages are clear

---

## Troubleshooting

### Port Already in Use

```bash
# Find process using port
lsof -ti:8090

# Kill process
kill $(lsof -ti:8090)

# Or use different port in .env
SERVICE_PORT=8092
```

### Tests Failing

```bash
# Clear Jest cache
npx jest --clearCache

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Check Node version
node --version  # Should be >= 20
```

### Configuration Not Loading

```bash
# Verify .env file exists
ls -la .env

# Test config loading
node -e "console.log(require('./lib/config'))"

# Check for syntax errors in .env
cat .env
```

### Health Check Fails

```bash
# Check service is running
curl http://localhost:8090/health

# Check registry file exists
ls -la /opt/registry/projects.json

# Verify allowed paths
node -e "console.log(require('./lib/config').allowedPaths)"
```

### PM2 Issues

```bash
# Delete and restart PM2
pm2 delete ecosystem.config.js
pm2 start ecosystem.config.js

# View detailed logs
pm2 logs --lines 100

# Monitor in real-time
pm2 monit
```

---

## Performance Tips

### Optimize Cache Size

Monitor cache metrics and adjust `CACHE_MAX_SIZE`:

```bash
# Check cache utilization
curl http://localhost:8090/health | jq '.checks.faviconCache'

# If utilization > 90%, increase size in .env
CACHE_MAX_SIZE=200
```

### Reduce Log Verbosity

In production, use `LOG_LEVEL=info` to reduce I/O:

```bash
LOG_LEVEL=info
```

### Enable Compression

Compression is enabled by default. Verify:

```bash
curl -H "Accept-Encoding: gzip" http://localhost:8090/api/favicon?folder=/opt/dev/test -I
# Should see: Content-Encoding: gzip
```

---

## Related Documentation

- [README.md](../README.md) - Project overview
- [API.md](API.md) - API reference
- [ARCHITECTURE.md](ARCHITECTURE.md) - System architecture
- [CONFIGURATION.md](CONFIGURATION.md) - Configuration guide
- [TESTING.md](TESTING.md) - Testing documentation
- [SECURITY.md](SECURITY.md) - Security guidelines
- [CI_CD.md](CI_CD.md) - CI/CD pipeline
- [DEPLOYMENT_SETUP.md](DEPLOYMENT_SETUP.md) - Deployment guide

---

## Need Help?

- **Issues**: Report bugs on Forgejo issue tracker
- **Email**: kostas@noreika.lt
- **Documentation**: Check `/docs` directory
- **Logs**: Check PM2 logs (`pm2 logs`) or console output
