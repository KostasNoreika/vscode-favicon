# Graceful Shutdown

## Overview

Both `vscode-favicon-service` and `vscode-favicon-api` servers implement graceful shutdown for production reliability. This ensures:

- **No data loss** - All pending notifications are saved to disk
- **Clean resource cleanup** - File watchers and intervals are properly closed
- **PM2 compatibility** - Responds correctly to SIGTERM/SIGINT signals
- **Timeout protection** - Forces exit after 10 seconds if cleanup hangs

## Implementation

### Signal Handlers

Both servers handle the following signals:

```javascript
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (err) => gracefulShutdown('uncaughtException'));
```

### Shutdown Sequence

When a shutdown signal is received:

1. **Stop accepting new connections** - `server.close()` stops accepting new requests
2. **Wait for in-flight requests** - Existing requests complete (up to 10s timeout)
3. **Save pending data** (API server only) - Notifications are flushed to disk immediately
4. **Stop intervals** (API server only) - Cleanup interval is cleared
5. **Close file watchers** - Registry file watcher is closed
6. **Exit gracefully** - Process exits with code 0

### Timeout Protection

If cleanup takes longer than 10 seconds, the process forcefully exits with code 1:

```javascript
const forceExitTimeout = setTimeout(() => {
    logger.warn('Forcefully shutting down after timeout');
    process.exit(1);
}, 10000);
```

## API Server Specifics

The API server has additional shutdown logic:

### Notification Store

```javascript
// Save pending notifications immediately
await notificationStore.saveImmediate();
```

This bypasses the 1-second debounce and saves notifications synchronously.

### Cleanup Interval

```javascript
// Stop cleanup interval
if (cleanupInterval) {
    clearInterval(cleanupInterval);
}
```

The hourly cleanup interval is stopped to prevent any new work.

## Service Server Specifics

The service server only needs to:

1. Close HTTP connections
2. Close registry file watcher

No notification store, so shutdown is simpler.

## Error Handling

### Port Already in Use

If the port is already in use during startup, the server exits immediately:

```javascript
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        logger.fatal({ port: PORT, err }, 'Port already in use');
        process.exit(1);
    }
    throw err;
});
```

### Unhandled Errors

```javascript
process.on('unhandledRejection', (reason, promise) => {
    logger.error({ reason, promise }, 'Unhandled rejection');
});
```

Unhandled promise rejections are logged but don't trigger shutdown (for resilience).

## PM2 Integration

### Reload Strategy

PM2 sends SIGTERM when reloading. The graceful shutdown ensures:

1. Old process finishes in-flight requests
2. New process starts immediately
3. Zero downtime deployment

### PM2 Configuration

Recommended `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [{
    name: 'vscode-favicon-service',
    script: './vscode-favicon-service/server.js',
    instances: 1,
    exec_mode: 'fork',
    kill_timeout: 12000,  // Must be > 10s force exit timeout
    wait_ready: true,
    listen_timeout: 5000
  }, {
    name: 'vscode-favicon-api',
    script: './vscode-favicon-api/server.js',
    instances: 1,
    exec_mode: 'fork',
    kill_timeout: 12000,  // Must be > 10s force exit timeout
    wait_ready: true,
    listen_timeout: 5000
  }]
}
```

**Critical**: `kill_timeout` must be greater than the 10-second force exit timeout.

## Testing

### Manual Test

```bash
# Start service
pm2 start ecosystem.config.js

# Trigger graceful shutdown
pm2 reload vscode-favicon-service

# Check logs
pm2 logs vscode-favicon-service --lines 50
```

Expected log output:

```
{"signal":"SIGTERM","msg":"Shutdown signal received, starting graceful shutdown"}
{"msg":"HTTP server closed"}
{"msg":"Registry watcher closed"}
{"msg":"Graceful shutdown complete"}
```

### Signal Test (Development)

```bash
# Start service in foreground
node vscode-favicon-service/server.js

# In another terminal, send SIGTERM
kill -TERM $(pgrep -f vscode-favicon-service)
```

## Monitoring

### Health Checks

The shutdown process is logged at INFO level. Monitor these logs for:

- **Timeout warnings** - If force exit happens, investigate slow cleanup
- **Error during cleanup** - File watcher or notification save errors
- **Exit code** - Should be 0 for clean shutdown, 1 for timeout

### Metrics

Track these shutdown metrics:

| Metric | Target | Alert On |
|--------|--------|----------|
| Shutdown duration | < 2s | > 8s |
| Force exit rate | 0% | > 1% |
| Data save errors | 0 | Any |

## Troubleshooting

### Force Exit Happening

If force exit (10s timeout) is triggered:

1. Check for slow file I/O - Notification save or registry file watcher close
2. Check for hanging promises - Add logging to async operations
3. Increase timeout if needed (not recommended)

### Data Loss on Shutdown

If notifications are lost:

1. Check `saveImmediate()` logs - Should show "Notifications saved"
2. Check disk space - Save might fail silently
3. Check file permissions - Data directory must be writable

### Port Already in Use

If startup fails with `EADDRINUSE`:

1. Check PM2 status - `pm2 status`
2. Kill orphaned process - `lsof -i :PORT` then `kill -9 PID`
3. Check if another service uses the port

## Resources Modified

### Files

- `/opt/tools/vscode-favicon/vscode-favicon-service/server.js` - Added graceful shutdown
- `/opt/tools/vscode-favicon/vscode-favicon-api/server.js` - Added graceful shutdown with notification save
- `/opt/tools/vscode-favicon/lib/registry-cache.js` - Added `closeWatcher()` export
- `/opt/tools/vscode-favicon/lib/notification-store.js` - Added `saveImmediate()` export

### Dependencies

No new dependencies required. Uses built-in Node.js signal handling.

## Related Documentation

- [Configuration](./CONFIGURATION.md) - Service ports and paths
- [Testing](./TESTING.md) - Automated tests
- [Registry Cache](./registry-cache.md) - File watcher implementation
