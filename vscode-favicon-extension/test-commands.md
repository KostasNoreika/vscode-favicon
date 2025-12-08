# Terminal Detection Testing Commands

## Quick Test in Browser Console

Open VS Code Server instance with the extension loaded, then paste these commands into browser console:

### Check Current State
```javascript
// Check if terminal is detected as open
hasOpenTerminal()

// Check terminal state variable
terminalOpen

// Check observer is running
terminalObserver
```

### Manual State Check
```javascript
// Force a state check
checkTerminalState()
```

### Test Visibility Detection
```javascript
// Get terminal element
const term = document.querySelector('.xterm')

// Check if it's visible
isElementVisible(term)

// Check all terminal selectors
TERMINAL_SELECTORS.forEach(sel => {
    const els = document.querySelectorAll(sel);
    console.log(sel, '→', els.length, 'elements');
    els.forEach(el => console.log('  -', isElementVisible(el) ? 'VISIBLE' : 'hidden'));
});
```

### Monitor State Changes
```javascript
// Add custom logger
const originalLog = console.log;
console.log = function(...args) {
    if (args[0]?.includes('Terminal')) {
        const time = new Date().toLocaleTimeString();
        originalLog(`[${time}]`, ...args);
    }
    originalLog(...args);
}
```

### Test Throttling
```javascript
// Trigger multiple rapid checks (should throttle to 1 per 500ms)
for (let i = 0; i < 10; i++) {
    setTimeout(() => {
        document.querySelector('.terminal-wrapper')?.classList.toggle('hidden');
    }, i * 50);
}
```

## Expected Console Output

### On Extension Load
```
VS Code Favicon Extension v2.0: Starting
VS Code Favicon: Project: vscode-favicon
VS Code Favicon: Terminal observer initialized
VS Code Favicon: Terminal CLOSED
VS Code Favicon: Set normal
VS Code Favicon: Initialized (poll: 5s active, 30s inactive)
```

### On Terminal Open
```
VS Code Favicon: Terminal OPENED
VS Code Favicon: Set normal
```

### On Terminal Close
```
VS Code Favicon: Terminal CLOSED
VS Code Favicon: Set normal
```

## Testing in Live VS Code

1. **Load Extension**
   - Navigate to `chrome://extensions`
   - Enable Developer mode
   - Load unpacked: `/opt/tools/vscode-favicon/vscode-favicon-extension/`

2. **Open VS Code Server**
   - Go to VS Code instance (e.g., `https://vs.noreika.lt/?folder=/opt/dev/project`)
   - Open DevTools (F12)
   - Switch to Console tab

3. **Test Terminal Toggle**
   - Press `Ctrl+\`` to open terminal
   - Check console: Should log "Terminal OPENED"
   - Press `Ctrl+\`` to close terminal
   - Check console: Should log "Terminal CLOSED"

4. **Test Panel Resize**
   - Drag terminal panel height
   - Observer should detect changes
   - State should remain consistent

5. **Test Split Terminals**
   - Open multiple terminal splits
   - State should show OPENED if ANY terminal visible

## Common Issues

### Terminal Not Detected
```javascript
// Debug: Check which selectors match
TERMINAL_SELECTORS.forEach(sel => {
    console.log(sel, document.querySelectorAll(sel).length);
});
```

### Observer Not Running
```javascript
// Restart observer
setupTerminalObserver();
```

### State Stuck
```javascript
// Reset state manually
terminalOpen = false;
checkTerminalState();
```

## Performance Check

### Observer Call Frequency
```javascript
let callCount = 0;
const originalCheck = checkTerminalState;
checkTerminalState = function() {
    callCount++;
    console.log('checkTerminalState calls:', callCount);
    return originalCheck();
}
```

### Memory Leak Check
```javascript
// Before unload, check cleanup
window.addEventListener('beforeunload', () => {
    console.log('Cleanup check:');
    console.log('- pollTimer:', pollTimer !== null);
    console.log('- terminalUpdateTimeout:', terminalUpdateTimeout !== null);
    console.log('- terminalObserver:', terminalObserver !== null);
});
```

## Automated Test Page

Open local test file:
```bash
open /opt/tools/vscode-favicon/vscode-favicon-extension/test-terminal-detection.html
```

This provides interactive buttons to test all visibility scenarios.
