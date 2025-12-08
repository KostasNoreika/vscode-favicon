# VS Code Favicon Service

Project-specific favicon generation and serving for VS Code Server instances. Automatically generates unique, color-coded favicons based on project metadata, making it easy to distinguish between multiple VS Code Server tabs.

## Features

- **Automatic Favicon Generation**: Creates unique SVG favicons with project initials
- **Type-based Coloring**: Different colors for prod, dev, staging, test, research projects
- **Port Display**: Shows port numbers on development project favicons
- **Custom Favicon Support**: Automatically detects and serves existing favicon files
- **Project Registry Integration**: Uses `/opt/registry/projects.json` for project metadata
- **Security Hardened**: Path traversal protection, CORS validation, rate limiting, XSS protection
- **Environment-based Configuration**: Flexible configuration via `.env` files
- **Terminal Activity Indicator**: Grayscale favicons when terminal is active (Chrome extension)
## Quick Start

### 1. Installation

```bash
# Clone or navigate to project
cd /opt/tools/vscode-favicon

# Install dependencies
npm install

# Copy configuration template
cp .env.example .env

# Edit configuration (optional - defaults work for most cases)
vim .env
```

### 2. Start Service

```bash
# Start with PM2
pm2 start ecosystem.config.js

# Or start directly for development
node src/server.js  # Port 8090
```

### 3. Verify

```bash
# Check service health
curl http://localhost:8090/health

# Test favicon generation
curl "http://localhost:8090/api/favicon?folder=/opt/dev/my-project"
```

## Architecture

### Unified Service (port 8090)

Single consolidated service providing:
- Favicon generation and serving
- Claude completion notifications (SSE)
- Custom favicon detection
- Project info API
- Cache management
- Chrome extension download

### API Endpoints

```bash
# Generate/retrieve favicon
GET /api/favicon?folder=/opt/dev/project

# Get project information
GET /api/project-info?folder=/opt/dev/project

# Clear favicon cache (admin only)
POST /api/clear-cache

# Claude completion notification
POST /claude-completion
{
  "folder": "/opt/dev/project",
  "message": "Task completed",
  "timestamp": 1234567890
}

# Get completion status
GET /claude-status?folder=/opt/dev/project

# Mark notification as read
POST /claude-status/mark-read
{
  "folder": "/opt/dev/project"
}

# Clear notification
DELETE /claude-status
{
  "folder": "/opt/dev/project"
}

# SSE notification stream
GET /notifications/stream?folder=/opt/dev/project

# Download Chrome extension
GET /download/extension

# Health check
GET /health
GET /health/live
GET /health/ready
```

## Terminal Activity Indicator

The service supports grayscale favicon mode to indicate when a terminal is active in VS Code tabs. This feature is implemented via the Chrome extension.

### How It Works

1. **Terminal Detection**: Chrome extension monitors terminal activity in VS Code tabs
2. **Grayscale Conversion**: When terminal is active, favicon is requested with `grayscale=true` parameter
3. **Visual Feedback**: Color favicons → Grayscale indicates active terminal session
4. **Automatic Reset**: Returns to colored favicon when terminal closes or loses focus

### API Usage

```bash
# Get colored favicon (default)
GET /api/favicon?folder=/opt/dev/project

# Get grayscale favicon (terminal active)
GET /api/favicon?folder=/opt/dev/project&grayscale=true
```

### Grayscale Conversion

The service uses **ITU-R BT.601** luminosity formula for perceptually accurate grayscale conversion:

```
Grayscale = 0.299 × R + 0.587 × G + 0.114 × B
```

This ensures that:
- Green appears brightest (human eye perceives it as most luminous)
- Blue appears darkest (lowest perceived luminosity)
- Red has medium brightness

### Example Conversions

| Environment | Color | Grayscale |
|------------|-------|-----------|
| Dev | `#4ECDC4` (Teal) | `#a6a6a6` (Medium Gray) |
| Prod | `#FF6B6B` (Red) | `#979797` (Medium Gray) |
| Staging | `#FFEAA7` (Yellow) | `#e9e9e9` (Light Gray) |
| Test | `#A29BFE` (Purple) | `#a8a8a8` (Medium Gray) |

### Cache Behavior

- Colored and grayscale favicons are cached separately
- Cache keys: `favicon_/path/to/project` (colored) vs `favicon_/path/to/project_gray` (grayscale)
- Both versions have same TTL (default 3600s)

### Notes

- Grayscale conversion only applies to **generated SVG favicons**
- Existing favicon files (PNG, ICO) are served as-is regardless of `grayscale` parameter
- Chrome extension required for automatic terminal detection

## Configuration

Configuration is managed via environment variables loaded from `.env` file.

### Quick Configuration

```bash
# Server Port
SERVICE_PORT=8090

# Paths
REGISTRY_PATH=/opt/registry/projects.json
ALLOWED_PATHS=/opt/dev,/opt/prod,/opt/research

# CORS Origins (add your domains)
CORS_ORIGINS=https://vs.noreika.lt,https://favicon-api.noreika.lt,http://localhost:8080

# Cache
CACHE_MAX_SIZE=100
CACHE_TTL=3600

# Rate Limiting
RATE_LIMIT_WINDOW=900000
RATE_LIMIT_MAX=100
```

See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for comprehensive configuration guide.

## Security Features

### Path Traversal Protection
- Multi-layer validation
- Symlink resolution
- URL encoding bypass protection
- Null byte injection protection

### CORS Security
- Strict origin whitelist
- No wildcard origins
- Cache poisoning protection
- Proper preflight handling

### XSS Protection
- SVG content sanitization
- HTML entity encoding
- Port number validation
- Project name sanitization

### Rate Limiting
- Per-IP rate limiting
- Separate limits for notifications
- Health endpoint excluded
- Configurable windows and limits

### Input Validation
- express-validator on all inputs
- JSON body size limits (10KB)
- Type validation
- Range validation

See [docs/SECURITY.md](docs/SECURITY.md) for security documentation.

## Project Registry

The service uses `/opt/registry/projects.json` for project metadata:

```json
{
  "projects": {
    "development": [
      {
        "name": "my-project",
        "path": "/opt/dev/my-project",
        "port": "8080",
        "type": "dev",
        "url": "https://vs.noreika.lt/?folder=/opt/dev/my-project"
      }
    ],
    "production": [
      {
        "name": "prod-app",
        "path": "/opt/prod/prod-app",
        "type": "prod",
        "url": "https://vs.noreika.lt/?folder=/opt/prod/prod-app"
      }
    ]
  }
}
```

## Favicon Generation Logic

### Priority Order

1. **Existing Favicon Files**
   - Search paths: `favicon.ico`, `public/favicon.ico`, etc.
   - Image patterns: `favicon.png`, `favicon.svg`, `icon.png`, `logo.png`, `logo.svg`
   - Configurable via `FAVICON_SEARCH_PATHS` and `FAVICON_IMAGE_PATTERNS`

2. **Generated SVG Favicon**
   - Project initials (max 2 letters)
   - Type-based background color
   - Port number for dev projects
   - Cached for performance

### Type Colors

| Type | Color | Hex |
|------|-------|-----|
| Production | Red | #FF6B6B |
| Development | Teal | #4ECDC4 |
| Staging | Yellow | #FFEAA7 |
| Test | Purple | #A29BFE |
| Demo | Blue | #74B9FF |
| Research | Green | #00B894 |

Colors are configurable via `COLOR_*` environment variables.

## Development

### Running Tests

```bash
# All tests
npm test

# Specific test suite
npm test -- tests/path-validator.test.js
npm test -- tests/cors-config.test.js
npm test -- tests/svg-sanitizer.test.js

# With coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

### Project Structure

```
vscode-favicon/
├── src/                        # Main application
│   └── server.js              # Unified service (port 8090)
├── lib/                        # Shared libraries
│   ├── config.js              # Configuration module
│   ├── path-validator.js      # Security: Path validation
│   ├── cors-config.js         # Security: CORS middleware
│   ├── svg-sanitizer.js       # Security: XSS protection
│   ├── health-check.js        # Health check utilities
│   ├── logger.js              # Structured logging (pino)
│   └── validators.js          # Express validator rules
├── vscode-favicon-extension/  # Chrome extension
│   ├── manifest.json          # Extension manifest
│   ├── content-project-favicon.js  # Content script
│   └── ...
├── tests/                     # Test suites
│   ├── unit/                  # Unit tests
│   ├── integration/           # Integration tests
│   └── security/              # Security tests
├── docs/                      # Documentation (40+ docs)
│   ├── INDEX.md              # Documentation index
│   ├── API.md                # API reference
│   ├── ARCHITECTURE.md       # System architecture
│   └── ... (see docs/INDEX.md)
├── .env.example              # Configuration template
├── package.json             # Dependencies
├── ecosystem.config.js      # PM2 configuration
├── CHANGELOG.md            # Version history
└── README.md               # This file
```

## Deployment

### Automated CI/CD (Recommended)

**Forgejo Actions pipeline** automatically deploys to production on push to `main` branch.

**Pipeline features:**
- Automated testing (linting, unit tests, coverage checks)
- Security audits (npm audit, security-specific tests)
- Zero-downtime deployment with PM2 reload
- Automatic backup before deployment
- Smoke tests with automatic rollback on failure
- Health check verification

**Setup instructions:** See [`docs/DEPLOYMENT_SETUP.md`](docs/DEPLOYMENT_SETUP.md)

**Pipeline docs:**
- **Overview:** [`docs/CI_CD.md`](docs/CI_CD.md) - Full CI/CD documentation
- **Quick Reference:** [`docs/CI_CD_QUICK_REFERENCE.md`](docs/CI_CD_QUICK_REFERENCE.md)

**Workflow location:** `.forgejo/workflows/ci.yml`

### Manual Deployment with PM2

```bash
# Start
pm2 start ecosystem.config.js

# Status
pm2 status

# Logs
pm2 logs vscode-favicon-unified

# Reload (zero-downtime)
pm2 reload ecosystem.config.js

# Restart
pm2 restart vscode-favicon-unified

# Stop
pm2 stop vscode-favicon-unified
```

### With Docker

```bash
# Build
docker build -t vscode-favicon .

# Run with .env file
docker run --env-file .env -p 8090:8090 vscode-favicon

# Run with environment variables
docker run \
  -e SERVICE_PORT=8090 \
  -e NODE_ENV=production \
  -p 8090:8090 \
  vscode-favicon
```

### With Docker Compose

```yaml
version: '3.8'
services:
  vscode-favicon:
    image: vscode-favicon:latest
    env_file:
      - .env
    ports:
      - "8090:8090"
      - "8091:8091"
    volumes:
      - /opt/registry:/opt/registry:ro
      - /opt/dev:/opt/dev:ro
      - /opt/prod:/opt/prod:ro
    restart: unless-stopped
```

### Behind Cloudflare

Configure Cloudflare proxies:
- `https://vs.noreika.lt` → VS Code Server (with favicon service integration)
- `https://favicon-api.vs.noreika.lt` → localhost:8091

Add origins to `CORS_ORIGINS` in `.env`:
```bash
CORS_ORIGINS=https://vs.noreika.lt,https://favicon-api.vs.noreika.lt
```

## Troubleshooting

### Service Won't Start

```bash
# Check configuration
node -e "require('./lib/config')"

# Check port availability
lsof -ti:8090
lsof -ti:8091

# Check logs
pm2 logs vscode-favicon-service --lines 50
```

### CORS Issues

```bash
# Verify CORS configuration
node -e "console.log(require('./lib/config').corsOrigins)"

# Test CORS headers
curl -H "Origin: https://vs.noreika.lt" http://localhost:8090/health -v
```

### Path Validation Failures

```bash
# Check allowed paths
node -e "console.log(require('./lib/config').allowedPaths)"

# Test path validation
node -e "
  const { validatePath } = require('./lib/path-validator');
  console.log(validatePath('/opt/dev/my-project'));
"
```

### Cache Issues

```bash
# Clear cache
curl -X POST http://localhost:8090/api/clear-cache

# Check cache stats
curl http://localhost:8090/health
```

## Performance

### LRU Cache Architecture

The service implements a size-limited LRU (Least Recently Used) cache to prevent memory leaks and optimize performance:

- **Max Size**: Configurable via `CACHE_MAX_SIZE` (default: 100 items)
- **TTL**: HTTP Cache-Control header via `CACHE_TTL` (default: 3600s)
- **Eviction Policy**: Automatic LRU eviction when cache is full
- **Time Complexity**: O(1) for get/set operations
- **Memory Usage**: ~10 KB per favicon × 100 items = ~1 MB typical

### Cache Statistics

Real-time cache metrics available via `/health` endpoint:

```bash
curl http://localhost:8090/health | jq '.faviconCache'
```

Output:
```json
{
  "hits": 245,
  "misses": 12,
  "evictions": 5,
  "sets": 17,
  "size": 95,
  "maxSize": 100,
  "hitRate": "95.3%",
  "utilizationPercent": "95.0%"
}
```

**Metrics:**
- `hits` - Successful cache lookups
- `misses` - Cache misses (file load/generation)
- `evictions` - Items evicted due to size limit
- `hitRate` - Cache efficiency percentage
- `utilizationPercent` - Current cache capacity usage

### Cache Management

```bash
# Clear favicon cache manually
curl -X POST http://localhost:8090/api/clear-cache

# Monitor cache in real-time
watch -n 5 'curl -s http://localhost:8090/health | jq ".faviconCache"'
```

For detailed cache architecture and tuning guide, see [docs/CACHE_ARCHITECTURE.md](docs/CACHE_ARCHITECTURE.md).

### Rate Limits

- **General API**: 100 requests per 15 minutes per IP
- **Notifications**: 60 requests per minute per IP
- **Health Check**: Unlimited

All configurable via `RATE_LIMIT_*` environment variables.

## Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Make changes with tests
4. Ensure tests pass (`npm test`)
5. Commit changes (`git commit -m 'Add amazing feature'`)
6. Push to branch (`git push origin feature/amazing-feature`)
7. Open Pull Request

## License

MIT

## Security

To report security vulnerabilities, please email security@noreika.lt.

See [docs/SECURITY.md](docs/SECURITY.md) for security policy and vulnerability disclosure.

## Documentation

Comprehensive documentation is available in the `docs/` directory:

### Essential Documentation

- **[API Reference](docs/API.md)** - Complete API documentation for both services
- **[Architecture](docs/ARCHITECTURE.md)** - System architecture and design decisions
- **[Development Guide](docs/DEVELOPMENT.md)** - Developer setup and workflow
- **[Configuration](docs/CONFIGURATION.md)** - Configuration options and environment variables
- **[Testing](docs/TESTING.md)** - Testing guide and coverage reports

### Security & Performance

- **[Security](docs/SECURITY.md)** - Security features and best practices
- **[Path Validator](docs/PATH-VALIDATOR.md)** - Path traversal protection details
- **[Cache Architecture](docs/CACHE_ARCHITECTURE.md)** - Caching strategy and performance

### Operations

- **[Deployment Setup](docs/DEPLOYMENT_SETUP.md)** - CI/CD deployment guide
- **[CI/CD Pipeline](docs/CI_CD.md)** - Complete CI/CD documentation
- **[Health Checks](docs/HEALTH_CHECK.md)** - Health monitoring and probes
- **[Graceful Shutdown](docs/GRACEFUL_SHUTDOWN.md)** - Shutdown implementation

### Complete Documentation Index

See **[docs/INDEX.md](docs/INDEX.md)** for complete documentation index with 40+ documents organized by category and audience.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history and changes.

## Author

Kostas Noreika
- Email: kostas@noreika.lt
- GitHub: @kostasnoreika
- Website: https://noreika.lt
