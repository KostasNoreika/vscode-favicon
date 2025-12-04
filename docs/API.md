# API Reference

Complete API documentation for VS Code Favicon Service and Favicon API.

## Overview

The system consists of two independent services:

1. **Favicon Service** (port 8090) - Full-featured favicon generation with caching
2. **Favicon API** (port 8091) - Lightweight API with Claude notification support

Both services provide similar favicon generation capabilities but with different feature sets.

---

## Favicon Service (Port 8090)

Full-featured favicon generation service with advanced caching and project registry integration.

### Endpoints

#### GET /api/favicon

Generate or retrieve a project-specific favicon.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `folder` | string | Yes | Absolute path to project directory (e.g., `/opt/dev/my-project`) |

**Response:**

- **Content-Type**: `image/svg+xml` or `image/png` or `image/x-icon`
- **Status Codes**:
  - `200` - Success
  - `400` - Invalid folder parameter
  - `403` - Access denied (path validation failed)
  - `500` - Internal server error

**Example:**

```bash
# Request
curl "http://localhost:8090/api/favicon?folder=/opt/dev/my-project"

# Response (SVG)
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="#4ECDC4"/>
  <text x="16" y="20" font-family="Arial" font-size="14"
        fill="white" text-anchor="middle" font-weight="bold">MP</text>
  <text x="16" y="30" font-family="Arial" font-size="6"
        fill="white" text-anchor="middle">8080</text>
</svg>
```

**Favicon Priority:**

1. Existing favicon file (if found in project)
2. Generated SVG with project initials and type color

**Cache Behavior:**

- Cached in memory (LRU cache)
- HTTP Cache-Control: `public, max-age=3600` (configurable)

---

#### GET /api/project-info

Retrieve project metadata from registry.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `folder` | string | Yes | Absolute path to project directory |

**Response:**

```json
{
  "name": "my-project",
  "path": "/opt/dev/my-project",
  "port": "8080",
  "type": "dev",
  "url": "https://vs.noreika.lt/?folder=/opt/dev/my-project",
  "color": "#4ECDC4"
}
```

**Status Codes:**

- `200` - Success
- `400` - Invalid folder parameter
- `403` - Access denied
- `404` - Project not found in registry
- `500` - Internal server error

**Example:**

```bash
curl "http://localhost:8090/api/project-info?folder=/opt/dev/my-project"
```

---

#### POST /api/clear-cache

Clear the favicon cache manually.

**Request:**

- **Method**: POST
- **Body**: None required

**Response:**

```json
{
  "status": "ok",
  "message": "Cache cleared successfully"
}
```

**Status Codes:**

- `200` - Success
- `500` - Internal server error

**Example:**

```bash
curl -X POST http://localhost:8090/api/clear-cache
```

---

#### GET /health

Comprehensive health check with detailed service status.

**Response:**

```json
{
  "status": "ok",
  "service": "vscode-favicon-service",
  "timestamp": "2025-12-04T10:30:00.000Z",
  "uptime": 3600.5,
  "version": "1.0.0",
  "checks": {
    "registry": {
      "status": "ok",
      "path": "/opt/registry/projects.json",
      "projects": 42
    },
    "faviconCache": {
      "hits": 245,
      "misses": 12,
      "evictions": 5,
      "sets": 17,
      "size": 95,
      "maxSize": 100,
      "hitRate": "95.3%",
      "utilizationPercent": "95.0%"
    },
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
}
```

**Status Codes:**

- `200` - All checks passed
- `503` - Service degraded (some checks failed)

**Example:**

```bash
curl http://localhost:8090/health | jq
```

---

#### GET /health/live

Kubernetes liveness probe - checks if service process is alive.

**Response:**

```json
{
  "status": "alive",
  "timestamp": "2025-12-04T10:30:00.000Z"
}
```

**Example:**

```bash
curl http://localhost:8090/health/live
```

---

#### GET /health/ready

Kubernetes readiness probe - checks if service can accept traffic.

**Response:**

```json
{
  "status": "ready",
  "timestamp": "2025-12-04T10:30:00.000Z",
  "checks": {
    "registry": "ok"
  }
}
```

**Status Codes:**

- `200` - Ready to accept traffic
- `503` - Not ready (registry unavailable, etc.)

**Example:**

```bash
curl http://localhost:8090/health/ready
```

---

## Favicon API (Port 8091)

Lightweight API service with Claude completion notification support.

### Endpoints

#### GET /favicon-api

Generate a simple SVG favicon (lightweight version).

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `folder` | string | Yes | Absolute path to project directory |

**Response:**

- **Content-Type**: `image/svg+xml`
- **Status Codes**:
  - `200` - Success
  - `400` - Invalid folder parameter
  - `403` - Access denied
  - `500` - Internal server error

**Example:**

```bash
curl "http://localhost:8091/favicon-api?folder=/opt/dev/my-project"
```

**Note**: This endpoint always generates SVG (does not check for existing favicon files).

---

#### POST /claude-completion

Store a Claude completion notification for a project.

**Request Body:**

```json
{
  "folder": "/opt/dev/my-project",
  "message": "Task completed successfully",
  "timestamp": 1733310000000
}
```

**Request Body Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `folder` | string | Yes | - | Absolute path to project |
| `message` | string | No | `"Task completed"` | Notification message |
| `timestamp` | number | No | `Date.now()` | Unix timestamp (milliseconds) |

**Response:**

```json
{
  "status": "ok",
  "folder": "/opt/dev/my-project",
  "message": "Task completed successfully"
}
```

**Status Codes:**

- `200` - Success
- `400` - Invalid request body
- `403` - Access denied
- `429` - Rate limit exceeded (10 req/min)
- `500` - Internal server error

**Example:**

```bash
curl -X POST http://localhost:8091/claude-completion \
  -H "Content-Type: application/json" \
  -d '{
    "folder": "/opt/dev/my-project",
    "message": "Task completed"
  }'
```

---

#### GET /claude-status

Get Claude completion notification status for a project.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `folder` | string | Yes | Absolute path to project |

**Response (with notification):**

```json
{
  "hasNotification": true,
  "timestamp": 1733310000000,
  "message": "Task completed successfully"
}
```

**Response (no notification):**

```json
{
  "hasNotification": false
}
```

**Status Codes:**

- `200` - Success
- `400` - Invalid folder parameter
- `403` - Access denied
- `429` - Rate limit exceeded
- `500` - Internal server error

**Example:**

```bash
curl "http://localhost:8091/claude-status?folder=/opt/dev/my-project"
```

---

#### POST /claude-status/mark-read

Mark a notification as read (keeps the notification but marks it as read).

**Request Body:**

```json
{
  "folder": "/opt/dev/my-project"
}
```

**Response:**

```json
{
  "status": "ok"
}
```

**Status Codes:**

- `200` - Success
- `400` - Invalid request body
- `403` - Access denied
- `429` - Rate limit exceeded
- `500` - Internal server error

**Example:**

```bash
curl -X POST http://localhost:8091/claude-status/mark-read \
  -H "Content-Type: application/json" \
  -d '{"folder": "/opt/dev/my-project"}'
```

---

#### DELETE /claude-status

Delete a notification completely.

**Request Body:**

```json
{
  "folder": "/opt/dev/my-project"
}
```

**Response:**

```json
{
  "status": "ok"
}
```

**Status Codes:**

- `200` - Success
- `400` - Invalid request body
- `403` - Access denied
- `429` - Rate limit exceeded
- `500` - Internal server error

**Example:**

```bash
curl -X DELETE http://localhost:8091/claude-status \
  -H "Content-Type: application/json" \
  -d '{"folder": "/opt/dev/my-project"}'
```

---

#### GET /notifications/stream

Server-Sent Events (SSE) stream for real-time notifications.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `folder` | string | Yes | Absolute path to project |

**Response:**

- **Content-Type**: `text/event-stream`
- **Events**: Continuous stream of notification events

**Event Format:**

```
event: notification
data: {"hasNotification":true,"type":"created","timestamp":1733310000000,"message":"Task completed"}

event: notification
data: {"hasNotification":false,"type":"deleted"}
```

**Example:**

```bash
# Using curl
curl -N "http://localhost:8091/notifications/stream?folder=/opt/dev/my-project"

# Using EventSource in JavaScript
const eventSource = new EventSource('http://localhost:8091/notifications/stream?folder=/opt/dev/my-project');

eventSource.addEventListener('notification', (event) => {
  const data = JSON.parse(event.data);
  console.log('Notification:', data);
});
```

---

#### GET /health

Health check endpoint (same format as Favicon Service).

**Example:**

```bash
curl http://localhost:8091/health | jq
```

---

#### GET /health/live

Liveness probe (same format as Favicon Service).

---

#### GET /health/ready

Readiness probe (same format as Favicon Service).

---

## Common Behaviors

### Security

All endpoints implement the following security measures:

1. **Path Validation**:
   - Multi-layer path traversal protection
   - Null byte injection prevention
   - URL encoding bypass protection
   - Allowed path whitelist

2. **CORS**:
   - Strict origin whitelist (no wildcards)
   - Configurable via `CORS_ORIGINS` environment variable
   - Cache poisoning protection

3. **Rate Limiting**:
   - General API: 100 requests per 15 minutes per IP
   - Notifications: 10 requests per minute per IP
   - Health endpoints: Unlimited

4. **Input Validation**:
   - Express-validator on all inputs
   - JSON body size limit: 10KB
   - Type and range validation

5. **Headers**:
   - Helmet security headers
   - Content Security Policy
   - HSTS enabled
   - XSS protection

### Error Responses

All endpoints return consistent error format:

```json
{
  "error": "Error message",
  "details": "Additional context (optional)"
}
```

Common error codes:

- `400` - Bad Request (invalid input)
- `403` - Forbidden (path validation failed)
- `404` - Not Found (resource doesn't exist)
- `429` - Too Many Requests (rate limit exceeded)
- `500` - Internal Server Error
- `503` - Service Unavailable (health check failure)

### Rate Limit Response

When rate limit is exceeded:

```json
{
  "error": "Too many requests, please try again later",
  "retryAfter": 900
}
```

Headers:

- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Requests remaining
- `X-RateLimit-Reset`: Timestamp when limit resets
- `Retry-After`: Seconds until retry allowed

---

## Type Colors

Favicon background colors by project type:

| Type | Color | Hex |
|------|-------|-----|
| Production | Red | #FF6B6B |
| Development | Teal | #4ECDC4 |
| Staging | Yellow | #FFEAA7 |
| Test | Purple | #A29BFE |
| Demo | Blue | #74B9FF |
| Research | Green | #00B894 |

Colors are configurable via environment variables (`COLOR_PROD`, `COLOR_DEV`, etc.).

---

## Configuration

All endpoints respect environment configuration:

- `SERVICE_PORT` - Favicon Service port (default: 8090)
- `API_PORT` - Favicon API port (default: 8091)
- `CORS_ORIGINS` - Comma-separated allowed origins
- `RATE_LIMIT_WINDOW` - Rate limit window (ms)
- `RATE_LIMIT_MAX` - Max requests per window
- `CACHE_MAX_SIZE` - LRU cache size (items)
- `CACHE_TTL` - HTTP cache TTL (seconds)

See [CONFIGURATION.md](CONFIGURATION.md) for complete configuration guide.

---

## Client Examples

### JavaScript (Fetch API)

```javascript
// Get favicon
const response = await fetch('http://localhost:8090/api/favicon?folder=/opt/dev/my-project');
const svgText = await response.text();

// Post notification
await fetch('http://localhost:8091/claude-completion', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    folder: '/opt/dev/my-project',
    message: 'Task completed'
  })
});

// Check notification status
const status = await fetch('http://localhost:8091/claude-status?folder=/opt/dev/my-project')
  .then(r => r.json());

if (status.hasNotification) {
  console.log('Notification:', status.message);
}
```

### Python

```python
import requests

# Get favicon
response = requests.get('http://localhost:8090/api/favicon',
                       params={'folder': '/opt/dev/my-project'})
svg_content = response.text

# Post notification
requests.post('http://localhost:8091/claude-completion',
             json={
                 'folder': '/opt/dev/my-project',
                 'message': 'Task completed'
             })

# Check status
status = requests.get('http://localhost:8091/claude-status',
                     params={'folder': '/opt/dev/my-project'}).json()
```

### cURL

```bash
# Get favicon
curl "http://localhost:8090/api/favicon?folder=/opt/dev/my-project" > favicon.svg

# Post notification
curl -X POST http://localhost:8091/claude-completion \
  -H "Content-Type: application/json" \
  -d '{"folder":"/opt/dev/my-project","message":"Done"}'

# Clear cache
curl -X POST http://localhost:8090/api/clear-cache

# Health check
curl http://localhost:8090/health | jq '.checks.faviconCache'
```

---

## Related Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) - System architecture overview
- [CONFIGURATION.md](CONFIGURATION.md) - Configuration guide
- [SECURITY.md](SECURITY.md) - Security documentation
- [CACHE_ARCHITECTURE.md](CACHE_ARCHITECTURE.md) - Caching details
- [TESTING.md](TESTING.md) - Testing documentation
