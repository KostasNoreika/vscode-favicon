# Environment-Based Configuration Guide

## Overview

VS Code Favicon service uses environment-based configuration for flexible deployment across different environments (development, staging, production). All configuration is managed through environment variables loaded from `.env` file or system environment.

## Quick Start

1. Copy the example configuration:
```bash
cp .env.example .env
```

2. Edit `.env` with your specific settings

3. Start the services:
```bash
# Service will automatically load .env
npm start
```

## Configuration Files

### `.env` (Local Configuration)
- **Location**: Project root
- **Purpose**: Local environment-specific settings
- **Git**: Excluded (in `.gitignore`)
- **Security**: Contains sensitive values, never commit

### `.env.example` (Template)
- **Location**: Project root
- **Purpose**: Template and documentation
- **Git**: Committed to repository
- **Usage**: Copy to `.env` and customize

### `lib/config.js` (Configuration Module)
- **Location**: `lib/config.js`
- **Purpose**: Loads, validates, and exports configuration
- **Features**:
  - Type validation
  - Range checking
  - Default values
  - Startup validation

## Configuration Categories

### 1. Server Configuration

```bash
# Unified service port (favicon generation, notifications, and API)
SERVICE_PORT=8090

# Node environment
NODE_ENV=development  # development | production | staging | test
```

**Validation**:
- Port must be 1-65535
- NODE_ENV should be standard value

### 2. Path Configuration

```bash
# Project registry JSON file
REGISTRY_PATH=/opt/registry/projects.json

# Allowed base paths (comma-separated)
# SECURITY: Only projects within these paths can be accessed
ALLOWED_PATHS=/opt/dev,/opt/prod,/opt/research

# Service data directory
DATA_DIR=/opt/data/vscode-favicon
```

**Security Notes**:
- `ALLOWED_PATHS` implements path traversal protection
- All paths must be absolute
- Multiple paths separated by commas (no spaces)

### 3. CORS Configuration

```bash
# Allowed CORS origins (comma-separated)
# SECURITY CRITICAL: Only add origins you control and trust
# Format: protocol://domain:port (exact match required)
CORS_ORIGINS=https://vs.noreika.lt,https://favicon-api.noreika.lt,http://localhost:8080

# Production example:
# CORS_ORIGINS=https://vs.example.com,https://favicon-api.example.com

# Development example (includes local IPs):
# CORS_ORIGINS=https://vs.example.com,http://localhost:8080,http://192.168.1.100:8080
```

**Security Rules**:
- NO wildcards (`*`) allowed
- Exact origin matching only
- Include protocol, domain, and port
- Comma-separated, no spaces

### 4. Cache Configuration

```bash
# Maximum items in cache
CACHE_MAX_SIZE=100

# Cache TTL in seconds
CACHE_TTL=3600  # 1 hour
```

**Behavior**:
- LRU eviction when max size reached
- Cache cleared on service restart
- Health endpoint shows cache statistics

### 5. Rate Limiting

```bash
# General API rate limit window (milliseconds)
RATE_LIMIT_WINDOW=900000  # 15 minutes

# Maximum general API requests per window
RATE_LIMIT_MAX=100

# Notification endpoint rate limit window (milliseconds)
RATE_LIMIT_NOTIFICATION_WINDOW=60000  # 1 minute

# Maximum notification requests per window
RATE_LIMIT_NOTIFICATION_MAX=10
```

**Notes**:
- Applied per IP address
- Health endpoint excluded from rate limiting
- Notification endpoints have stricter limits

### 6. Logging

```bash
# Log level: error | warn | info | debug
LOG_LEVEL=info
```

**Levels**:
- `error`: Only errors
- `warn`: Errors and warnings
- `info`: Standard operation logs (default)
- `debug`: Verbose logging, configuration summary

### 7. Favicon Generation

```bash
# Comma-separated paths to search for existing favicons
FAVICON_SEARCH_PATHS=favicon.ico,public/favicon.ico,web/favicon.ico,assets/favicon.ico,static/favicon.ico,src/favicon.ico,dist/favicon.ico

# Fallback image patterns
FAVICON_IMAGE_PATTERNS=favicon.png,favicon.svg,icon.png,logo.png,logo.svg

# Directories to search for fallback images
FAVICON_IMAGE_DIRS=,public,assets,static,images,img
```

**Search Order**:
1. Search for exact paths from `FAVICON_SEARCH_PATHS`
2. Search for image patterns in directories
3. Generate SVG favicon if nothing found

### 8. Color Configuration

```bash
# Project type colors (hex format)
COLOR_PROD=#FF6B6B      # Red for production
COLOR_DEV=#4ECDC4       # Teal for development
COLOR_STAGING=#FFEAA7   # Yellow for staging
COLOR_TEST=#A29BFE      # Purple for test
COLOR_DEMO=#74B9FF      # Blue for demo
COLOR_RESEARCH=#00B894  # Green for research

# Default color palette (hash-based selection)
DEFAULT_COLORS=#FF6B6B,#4ECDC4,#45B7D1,#96CEB4,#FFEAA7,#FD79A8,#A29BFE,#6C5CE7
```

**Usage**:
- Type colors: Used when project type matches
- Default colors: Hash-based selection for unknown types

## Environment-Specific Configuration

### Development Environment

```bash
# .env.development
NODE_ENV=development
LOG_LEVEL=debug
CORS_ORIGINS=http://localhost:8080,http://localhost:3000,http://192.168.1.100:8080
CACHE_MAX_SIZE=50
CACHE_TTL=300  # 5 minutes for faster testing
```

### Production Environment

```bash
# .env.production
NODE_ENV=production
LOG_LEVEL=warn
CORS_ORIGINS=https://vs.example.com,https://favicon-api.example.com
CACHE_MAX_SIZE=500
CACHE_TTL=7200  # 2 hours
RATE_LIMIT_MAX=200
```

### Staging Environment

```bash
# .env.staging
NODE_ENV=staging
LOG_LEVEL=info
CORS_ORIGINS=https://vs-staging.example.com,https://favicon-api-staging.example.com
CACHE_MAX_SIZE=100
CACHE_TTL=3600
```

## Configuration Validation

The configuration is validated on startup. If validation fails, the service will exit with error code 1.

### Validation Checks

1. **Port validation**: 1-65535, unique ports
2. **Path validation**: Non-empty allowed paths
3. **Registry validation**: Path specified
4. **Cache validation**: Non-negative values
5. **Rate limit validation**: Sensible limits (>= 1000ms window)
6. **Log level validation**: Valid level names

### Validation Output

```bash
# Success
=== VS Code Favicon Configuration ===
Environment: development
Service Port: 8090
API Port: 8091
...
====================================

# Failure
FATAL: Configuration validation failed
  - SERVICE_PORT must be between 1 and 65535
  - ALLOWED_PATHS cannot be empty
```

## Usage in Code

### Importing Configuration

```javascript
const config = require('./lib/config');

// Access configuration values
const port = config.servicePort;
const allowedPaths = config.allowedPaths;  // Array
const typeColors = config.typeColors;      // Object
```

### Configuration Properties

```javascript
config.servicePort           // number
config.nodeEnv               // string
config.registryPath          // string
config.allowedPaths          // string[]
config.dataDir               // string
config.corsOrigins           // string[]
config.cacheMaxSize          // number
config.cacheTtl              // number (seconds)
config.rateLimitWindow       // number (ms)
config.rateLimitMax          // number
config.rateLimitNotificationWindow  // number (ms)
config.rateLimitNotificationMax     // number
config.logLevel              // string
config.typeColors            // object
config.defaultColors         // string[]
```

## Docker Configuration

### Using .env with Docker Compose

```yaml
# docker-compose.yml
services:
  vscode-favicon:
    image: vscode-favicon:latest
    env_file:
      - .env
    # OR use environment variables directly:
    environment:
      - SERVICE_PORT=8090
      - NODE_ENV=production
```

### Using Environment Variables

```bash
# Override specific values
docker run -e SERVICE_PORT=9090 -e NODE_ENV=production vscode-favicon:latest
```

## Testing Configuration

### Test with Custom Config

```bash
# Create test config
cat > .env.test <<EOF
NODE_ENV=test
SERVICE_PORT=9090
LOG_LEVEL=debug
EOF

# Load and test
NODE_ENV=test node -e "const config = require('./lib/config'); console.log(config);"
```

### Verify Configuration

```bash
# Quick validation
npm run verify-config

# Or manually
node -e "
  const config = require('./lib/config');
  console.log('✓ Configuration loaded successfully');
  console.log('Service Port:', config.servicePort);
  console.log('Environment:', config.nodeEnv);
"
```

## Security Best Practices

1. **Never commit `.env`**: Always in `.gitignore`
2. **Rotate secrets**: Change CORS origins for production
3. **Validate origins**: Use exact matches, no wildcards
4. **Limit paths**: Only include necessary directories in `ALLOWED_PATHS`
5. **Use HTTPS**: Production CORS origins should use `https://`
6. **Set NODE_ENV**: Always set to `production` in production
7. **Review logs**: Use `warn` or `error` log level in production

## Troubleshooting

### Configuration Not Loading

```bash
# Check .env exists
ls -la .env

# Check .env syntax (no quotes around values)
cat .env

# Verify dotenv is installed
npm list dotenv
```

### Validation Fails on Startup

```bash
# Enable debug logging
LOG_LEVEL=debug node vscode-favicon-service/server.js

# Check specific validation
node -e "
  const config = require('./lib/config');
  console.log('Validation passed');
" 2>&1
```

### CORS Issues

```bash
# Verify CORS origins
node -e "
  const config = require('./lib/config');
  console.log('CORS Origins:', config.corsOrigins);
"

# Test CORS middleware
curl -H "Origin: https://vs.noreika.lt" http://localhost:8090/health
```

## Migration from Hard-coded Values

If you're migrating from hard-coded configuration:

1. Copy `.env.example` to `.env`
2. Update values to match your previous hard-coded settings
3. Test startup: `npm start`
4. Verify functionality with existing tests: `npm test`
5. Remove hard-coded values from code (already done in this implementation)

## References

- [dotenv Documentation](https://github.com/motdotla/dotenv)
- [12-Factor App: Config](https://12factor.net/config)
- [OWASP: Secure Configuration](https://owasp.org/www-project-secure-coding-practices-quick-reference-guide/)
