# DEPRECATED: vscode-favicon-service

This service has been **deprecated** and consolidated into the unified service.

## Migration

All endpoints from this service are now available in the unified service at `/opt/tools/vscode-favicon/src/server.js`.

### Old Endpoints (port 8090)
- `GET /api/favicon` - Generate/serve project favicons
- `GET /api/project-info` - Get project metadata
- `POST /api/clear-cache` - Clear favicon cache (admin only)
- `GET /health`, `/health/live`, `/health/ready` - Health checks

### New Location
All endpoints now available on **port 8090** via the unified service:
- Same endpoints
- Same functionality
- Enhanced with notification API features

## What Changed

The `vscode-favicon-service` and `vscode-favicon-api` have been merged into a single service:
- **Old services:** Two separate processes (ports 8090, 8091)
- **New service:** Single unified process (port 8090)
- **Benefits:**
  - Reduced resource usage
  - Simplified deployment
  - Shared middleware stack
  - Single configuration

## Running the New Service

```bash
# Start unified service
pm2 start ecosystem.config.js

# Check status
pm2 status

# View logs
pm2 logs vscode-favicon-unified
```

## Removal

This directory will be removed in a future release. Please update any references to use the unified service.

**Migration Date:** December 4, 2024
**Deprecation Period:** 30 days
**Planned Removal:** January 4, 2025
