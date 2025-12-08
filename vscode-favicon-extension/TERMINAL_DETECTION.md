# Terminal Detection Implementation

## Overview
Chrome extension now detects VS Code Server terminal state and can update favicon accordingly.

## Implementation Details

### Files Modified
- `/opt/tools/vscode-favicon/vscode-favicon-extension/content-project-favicon.js`

### New Configuration
```javascript
CONFIG.TERMINAL_UPDATE_THROTTLE = 500  // Terminal state check throttle (ms)
```

### Terminal CSS Selectors
The extension searches for these selectors to detect open terminals:
```javascript
const TERMINAL_SELECTORS = [
    '.terminal-wrapper',
    '.xterm',
    '.xterm-viewport',
    '.panel .terminal',
    '.part.panel .terminal-outer-container',
    '[id*="workbench.panel.terminal"]'
];
```

### New State Variables
```javascript
let terminalOpen = false;           // Current terminal state
let terminalObserver = null;        // MutationObserver instance
let terminalUpdateTimeout = null;   // Throttle timeout handle
```

### Core Functions

#### `isElementVisible(element)`
Checks if element is actually visible to the user:
- Validates `display`, `visibility`, `opacity` styles
- Checks `getBoundingClientRect()` for non-zero dimensions
- Returns `true` only if element is truly visible

#### `hasOpenTerminal()`
Iterates through all terminal selectors:
- Finds all matching elements
- Returns `true` if ANY terminal is visible
- Returns `false` if no visible terminals found

#### `checkTerminalState()`
Updates state and triggers favicon refresh:
- Compares current state with previous
- Logs state changes to console
- Calls `updateFavicon()` on state change

#### `setupTerminalObserver()`
Sets up MutationObserver:
- Targets `.part.panel` or `document.body`
- Observes `childList`, `subtree`, `attributes` changes
- Throttles updates to max 1 per 500ms
- Performs initial terminal state check

### Initialization
Terminal observer is initialized in `initialize()` function:
```javascript
async function initialize() {
    // ... existing code ...
    setupTerminalObserver();  // NEW
    // ... existing code ...
}
```

### Cleanup
Observer is properly cleaned up on page unload:
```javascript
window.addEventListener('beforeunload', () => {
    if (terminalUpdateTimeout) clearTimeout(terminalUpdateTimeout);
    if (terminalObserver) terminalObserver.disconnect();
});
```

## Console Logs
Extension logs terminal state changes:
```
VS Code Favicon: Terminal observer initialized
VS Code Favicon: Terminal OPENED
VS Code Favicon: Terminal CLOSED
```

## Testing

### Manual Testing
1. Open test file: `/opt/tools/vscode-favicon/vscode-favicon-extension/test-terminal-detection.html`
2. Click buttons to simulate different terminal states
3. Observe console logs and status indicator
4. Verify detection works for:
   - Visible terminals ✓
   - Hidden terminals (display: none) ✓
   - Invisible terminals (visibility: hidden) ✓
   - Transparent terminals (opacity: 0) ✓
   - Zero-size terminals (0x0 dimensions) ✓

### Live Testing in VS Code
1. Load extension in Chrome
2. Open VS Code Server instance
3. Open browser console (F12)
4. Toggle terminal panel (Ctrl+`)
5. Verify console logs show state changes
6. Verify `terminalOpen` state variable updates

### Debug Commands
```javascript
// Check current state
hasOpenTerminal()

// Check specific element
isElementVisible(document.querySelector('.xterm'))

// View observer
terminalObserver

// Force update
checkTerminalState()
```

## Performance Considerations
- **Throttling**: Updates max once per 500ms to prevent excessive calls
- **Targeted observation**: Watches `.part.panel` when available (smaller DOM)
- **Attribute filtering**: Only watches `style` and `class` changes
- **Cleanup**: Proper observer disconnection prevents memory leaks

## Future Enhancements
1. **Favicon dimming**: Make favicon grayscale when terminal is closed
2. **Badge indicator**: Add terminal icon badge to favicon
3. **Configuration**: Allow users to disable terminal detection
4. **Multi-terminal**: Detect number of open terminals

## Known Limitations
- Relies on VS Code DOM structure (may break with major VS Code updates)
- 500ms throttle means slight delay in detection
- Does not detect terminal content changes (only open/close state)

## Compatibility
- **Chrome**: ✓ (primary target)
- **Edge**: ✓ (Chromium-based)
- **Firefox**: Untested (should work with WebExtensions API)
- **Safari**: Untested

## Rollback
To disable terminal detection, comment out in `initialize()`:
```javascript
// setupTerminalObserver();  // DISABLED
```
