# Task 021: Testing Instructions

## Quick Verification

### 1. Check if API server has SSE endpoint
```bash
cd /opt/tools/vscode-favicon
grep -A5 "notifications/stream" vscode-favicon-api/server.js | head -10
```
Expected: Should show SSE endpoint code

### 2. Check if client has SSE support
```bash
grep -c "EventSource" vscode-favicon-extension/content-project-favicon.js
```
Expected: 1 (client uses EventSource)

### 3. Check if notification store has event emitter
```bash
grep -c "EventEmitter" lib/notification-store.js
```
Expected: 7 (EventEmitter references)

## Manual Testing

### Test 1: SSE Connection Test
```bash
# Start the API server (if not running)
cd /opt/tools/vscode-favicon
pm2 start ecosystem.config.js

# Test SSE endpoint with curl
curl -N 'https://favicon-api.noreika.lt/notifications/stream?folder=/opt/dev/test-project'
```

**Expected output:**
```
event: connected
data: {"timestamp":1733308740123}

event: notification
data: {"hasNotification":false}

:keepalive
```

The connection should remain open and send keepalive every 30 seconds.

### Test 2: Real-time Notification Push
Open 2 terminals:

**Terminal 1 - Subscribe to SSE:**
```bash
curl -N 'https://favicon-api.noreika.lt/notifications/stream?folder=/opt/dev/test-project'
```

**Terminal 2 - Trigger notification:**
```bash
curl -X POST 'https://favicon-api.noreika.lt/claude-completion' \
  -H 'Content-Type: application/json' \
  -d '{
    "folder": "/opt/dev/test-project",
    "message": "Test notification from manual testing"
  }'
```

**Expected in Terminal 1:**
Within 100ms, you should see:
```
event: notification
data: {"hasNotification":true,"type":"created","timestamp":1733308755432,"message":"Test notification from manual testing"}
```

### Test 3: Browser Client Test
1. Open VS Code Server in browser (any project)
2. Open browser DevTools Console (F12)
3. Look for log messages:
   - `VS Code Favicon Extension: Starting`
   - `VS Code Favicon: Attempting SSE connection to...`
   - `VS Code Favicon: SSE connected`

4. Trigger a notification for that project:
```bash
# Replace /opt/dev/YOUR_PROJECT with actual folder path
curl -X POST 'https://favicon-api.noreika.lt/claude-completion' \
  -H 'Content-Type: application/json' \
  -d '{
    "folder": "/opt/dev/YOUR_PROJECT",
    "message": "Browser test notification"
  }'
```

5. Check browser console:
   - Should see: `VS Code Favicon: SSE notification received`
   - Favicon should update IMMEDIATELY (no 30s wait)

### Test 4: SSE Fallback to Polling
1. Stop the API server to simulate SSE failure:
```bash
pm2 stop vscode-favicon-api
```

2. Reload browser tab
3. Check console:
   - Should see 3 SSE connection attempts
   - Then: `VS Code Favicon: SSE failed 3 times, falling back to polling`
   - Then: `VS Code Favicon: Polling started`

4. Restart API server:
```bash
pm2 start vscode-favicon-api
```

### Test 5: Window Focus Behavior
1. Open VS Code tab with SSE active
2. Create a notification (use curl command from Test 2)
3. Switch to another tab (VS Code tab loses focus)
4. Wait 5 seconds
5. Switch back to VS Code tab
6. Check console: Should see `Notification marked as read`
7. Favicon badge should disappear immediately

## Performance Testing

### Monitor Network Requests
1. Open VS Code Server in browser
2. Open DevTools Network tab (F12)
3. Filter: `claude-status` OR `notifications/stream`
4. Observe requests over 5 minutes:

**With SSE (expected):**
- 1 initial SSE connection request
- Status: "pending" (keeps connection open)
- Keepalive messages every 30s (invisible in Network tab)
- **Total requests: 1**

**With Polling fallback (expected):**
- Multiple requests to `/claude-status`
- Intervals: 30s → 45s → 67.5s → ... (increasing)
- **Total requests: 10-20 over 5 minutes**

### Monitor Console Logs
Enable verbose logging:
```javascript
// In browser console
localStorage.setItem('debug', '*');
```

Then reload the page and observe detailed SSE/polling logs.

## Automated Testing

Run project tests:
```bash
cd /opt/tools/vscode-favicon
npm test
```

Expected: All tests should pass (SSE doesn't break existing functionality)

## Rollback Testing

If needed to rollback to polling-only:

1. Edit `vscode-favicon-extension/content-project-favicon.js`
2. Change: `const USE_SSE = true;` to `const USE_SSE = false;`
3. Clear browser cache and reload
4. Verify polling works (check console for "Polling started")

## Production Deployment Testing

After deploying to production:

1. Check PM2 status:
```bash
pm2 status
pm2 logs vscode-favicon-api --lines 50
```

2. Look for SSE-related logs:
```
SSE client connected
SSE notification sent
SSE client disconnected
```

3. Monitor for errors:
```bash
pm2 logs vscode-favicon-api --err --lines 50
```

4. Check health endpoint:
```bash
curl https://favicon-api.noreika.lt/health | jq
```

Expected: `"status": "ok"`

## Troubleshooting

### Issue: SSE connection keeps failing
**Possible causes:**
- Cloudflare/proxy timeout (increase timeout settings)
- Rate limit exceeded (check logs)
- CORS policy blocking (check browser console)

**Solution:**
- Check rate limit: `curl https://favicon-api.noreika.lt/health`
- Verify Cloudflare settings allow SSE
- Client will automatically fallback to polling

### Issue: Notifications not received in real-time
**Debug steps:**
1. Check if SSE is connected: Browser console should show "SSE connected"
2. Test SSE endpoint directly with curl (Test 1)
3. Check notification store: `curl https://favicon-api.noreika.lt/claude-status?folder=...`
4. Verify EventEmitter is emitting: Check server logs

### Issue: High CPU usage
**Check:**
- Is polling running when SSE is active? (Bug - should not happen)
- Are multiple tabs polling the same project? (Expected, each tab polls independently)
- Is exponential backoff working? (Intervals should increase)

## Success Criteria

✅ SSE connection established within 2 seconds  
✅ Notifications received in < 100ms  
✅ Automatic fallback to polling works  
✅ No console errors  
✅ Favicon updates instantly on notification  
✅ Network requests reduced by 80-98%  
✅ Window focus clears notification badge  
✅ PM2 logs show no errors  

---

**Note:** All tests can be run safely in development environment. No production data is affected.
