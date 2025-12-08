# Deployment Instructions

## Security Updates - 2025-12-04

This guide covers deploying the security enhancements to production.

---

## Pre-Deployment Checklist

- [x] Code changes reviewed and tested
- [x] Security documentation created
- [x] Changelog documented
- [ ] Backup current production code
- [ ] Backup current browser extension
- [ ] Test environment validated

---

## Step 1: Backup Current State

```bash
# Backup service code
cp vscode-favicon-service/server.js vscode-favicon-service/server.js.backup-$(date +%Y%m%d)

# Backup API code
cp vscode-favicon-api/server.js vscode-favicon-api/server.js.backup-$(date +%Y%m%d)

# Backup extension manifest
cp vscode-favicon-extension/manifest.json vscode-favicon-extension/manifest.json.backup-$(date +%Y%m%d)

# Verify backups
ls -lh */*.backup-*
```

---

## Step 2: Deploy Server Changes

### Option A: Using PM2 (Recommended for Production)

```bash
# Navigate to project root
cd /opt/tools/vscode-favicon

# Restart services with new code
pm2 restart vscode-favicon-service
pm2 restart vscode-favicon-api

# Verify services are running
pm2 status

# Check logs for errors
pm2 logs vscode-favicon-service --lines 50
pm2 logs vscode-favicon-api --lines 50
```

### Option B: Manual Restart

```bash
# Stop services
pkill -f "node.*vscode-favicon-service/server.js"
pkill -f "node.*vscode-favicon-api/server.js"

# Start services
cd /opt/tools/vscode-favicon/vscode-favicon-service
nohup node server.js > service.log 2>&1 &

cd /opt/tools/vscode-favicon/vscode-favicon-api
nohup node server.js > api.log 2>&1 &

# Verify processes
ps aux | grep vscode-favicon
```

---

## Step 3: Verify Service Health

```bash
# Check service health
curl http://localhost:8090/health | jq '.'

# Check API health (should show SSE connection stats)
curl http://localhost:8091/health | jq '.components.sseConnections'

# Expected output:
# {
#   "status": "ok",
#   "totalIPs": 0,
#   "totalConnections": 0,
#   "maxPerIP": 5
# }
```

---

## Step 4: Test Security Enhancements

### Test 1: Cache Clear Authentication

```bash
# Should succeed (localhost)
curl -X POST http://127.0.0.1:8090/api/clear-cache
# Expected: {"success":true,"message":"All caches cleared",...}

# Should fail (external IP - simulate by using different port forwarding)
curl -X POST http://localhost:8090/api/clear-cache
# Expected: {"error":"Forbidden"}

# Check logs for warning
pm2 logs vscode-favicon-service --lines 5 | grep "Unauthorized cache clear"
```

### Test 2: SSE Connection Limits

```bash
# Open 6 concurrent SSE connections from same IP
for i in {1..6}; do
  echo "Connection $i:"
  curl -N "http://localhost:8091/notifications/stream?folder=/opt/dev/test-project" &
  sleep 0.5
done

# Connection 6 should fail with:
# {"error":"Too many concurrent connections","limit":5}

# Kill test connections
pkill -f "curl.*notifications/stream"

# Verify connection count reset
curl http://localhost:8091/health | jq '.components.sseConnections'
```

### Test 3: Error Message Sanitization

```bash
# Test in development mode (default)
curl "http://localhost:8090/api/favicon?folder=../../etc/passwd" | jq '.'
# Expected: {"error":"Access denied","details":"...path details..."}

# Test in production mode
NODE_ENV=production pm2 restart vscode-favicon-service
sleep 2
curl "http://localhost:8090/api/favicon?folder=../../etc/passwd" | jq '.'
# Expected: {"error":"Access denied"} (no details)

# Restore development mode
NODE_ENV=development pm2 restart vscode-favicon-service
```

---

## Step 5: Deploy Browser Extension

### For Development Environment

```bash
cd /opt/tools/vscode-favicon/vscode-favicon-extension

# Use development manifest (with HTTP support)
cp manifest.dev.json manifest.json

# Reload extension in Chrome
# 1. Open chrome://extensions
# 2. Enable "Developer mode"
# 3. Click "Reload" on VS Code Favicon extension
```

### For Production Environment

```bash
cd /opt/tools/vscode-favicon/vscode-favicon-extension

# Use production manifest (HTTPS only)
cp manifest.prod.json manifest.json

# Package extension
zip -r vscode-favicon-prod.zip . -x "*.backup-*" "*.git*" "node_modules/*"

# Deploy to Chrome Web Store or internal distribution
```

**Manual Installation (if not using Web Store):**
1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `/opt/tools/vscode-favicon/vscode-favicon-extension` directory
5. Verify only HTTPS permissions are shown

---

## Step 6: Smoke Testing

### Test Favicon Loading

```bash
# Visit VS Code Server in browser
open https://vs.noreika.lt/?folder=/opt/dev/test-project

# Expected:
# - Favicon loads correctly
# - No mixed-content warnings in console
# - Browser tab shows project-specific favicon
```

### Test Notifications

```bash
# Send test notification
curl -X POST http://localhost:8091/claude-completion \
  -H "Content-Type: application/json" \
  -d '{"folder":"/opt/dev/test-project","message":"Test notification"}'

# Expected: {"status":"ok",...}

# Verify notification appears in browser extension
# (check browser console or extension popup)
```

---

## Step 7: Monitoring

### Key Metrics to Watch

1. **Cache Clear Attempts:**
   ```bash
   pm2 logs vscode-favicon-service | grep "Unauthorized cache clear"
   ```

2. **SSE Connection Stats:**
   ```bash
   watch -n 5 'curl -s http://localhost:8091/health | jq ".components.sseConnections"'
   ```

3. **Path Validation Failures:**
   ```bash
   pm2 logs vscode-favicon-service | grep "Path validation failed"
   pm2 logs vscode-favicon-api | grep "Path validation failed"
   ```

4. **Rate Limit Exceeded:**
   ```bash
   pm2 logs | grep "Rate limit exceeded"
   ```

---

## Rollback Procedure

If issues are detected, rollback to previous version:

```bash
# Restore service code
cp vscode-favicon-service/server.js.backup-YYYYMMDD vscode-favicon-service/server.js

# Restore API code
cp vscode-favicon-api/server.js.backup-YYYYMMDD vscode-favicon-api/server.js

# Restore extension manifest
cp vscode-favicon-extension/manifest.json.backup-YYYYMMDD vscode-favicon-extension/manifest.json

# Restart services
pm2 restart vscode-favicon-service
pm2 restart vscode-favicon-api

# Reload browser extension
# chrome://extensions -> Reload
```

---

## Post-Deployment Verification

### Success Criteria

- Services restart without errors
- Health endpoints return 200 OK
- Favicons load correctly in browser
- Notifications work end-to-end
- Cache clear endpoint rejects external IPs
- 6th SSE connection is rejected
- No mixed-content warnings in production
- Error messages sanitized in production mode

### Failure Indicators

- Services fail to start (check logs)
- 500 errors on health endpoints
- Favicons don't load (CORS issues)
- Extension permissions errors
- SSE connections fail
- Cache clear always fails (IP detection issue)

---

## Troubleshooting

### Issue: Services Won't Start

**Symptoms:** PM2 shows "errored" status

**Solution:**
```bash
# Check detailed error
pm2 logs vscode-favicon-service --err --lines 50

# Common issues:
# - Port already in use: Change port in .env
# - Missing dependencies: npm install
# - Syntax errors: Check backup and compare
```

### Issue: Cache Clear Always Fails

**Symptoms:** Even localhost requests return 403

**Solution:**
```bash
# Check IP detection
node -e "console.log(require('express')().request.ip)"

# Verify Express trust proxy setting
# Add to server.js if behind proxy:
app.set('trust proxy', 1);
```

### Issue: SSE Connections Always Rejected

**Symptoms:** First connection returns 429

**Solution:**
```bash
# Check Map initialization
node -e "const m = new Map(); console.log(m.get('test') || 0)"

# Verify clientIP extraction
# Add debug logging:
console.log('Client IP:', req.ip, req.connection.remoteAddress);
```

### Issue: Mixed Content Warnings

**Symptoms:** Console shows "Mixed Content" errors

**Solution:**
```bash
# Verify production manifest
jq '.host_permissions' manifest.json
# Should only show https:// URLs

# Ensure correct manifest is loaded
cp manifest.prod.json manifest.json

# Reload extension completely
# chrome://extensions -> Remove -> Re-add
```

---

## Support

For issues during deployment:

1. Check logs: `pm2 logs`
2. Review `SECURITY.md` for expected behavior
3. Compare with `CHANGELOG_SECURITY.md`
4. Rollback if necessary (see above)

---

## Environment Variables

Ensure these are set in `.env`:

```bash
NODE_ENV=production  # or development
SERVICE_PORT=8090
REGISTRY_PATH=/opt/registry/projects.json
```

---

## Success!

If all tests pass, the security enhancements are successfully deployed:

- Admin endpoints protected by IP whitelist
- Production uses HTTPS-only
- SSE DoS protection active
- Error messages sanitized

Monitor logs for the first 24 hours and watch for anomalies.
