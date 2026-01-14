#!/bin/bash
# Setup script for Claude Code notification hooks
# This script configures Claude Code to send notifications to vscode-favicon API
# when Claude finishes responding.
#
# Usage:
#   curl -fsSL https://favicon-api.noreika.lt/scripts/setup-claude-hooks.sh | bash
#   # or
#   ./scripts/setup-claude-hooks.sh
#
# What it does:
#   1. Creates notification hook script in ~/.claude/hooks/
#   2. Updates ~/.claude/settings.json with hook configuration
#
# Requirements:
#   - Claude Code CLI installed (~/.claude/ directory exists)
#   - curl and jq available

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
CLAUDE_DIR="$HOME/.claude"
HOOKS_DIR="$CLAUDE_DIR/hooks"
SETTINGS_FILE="$CLAUDE_DIR/settings.json"
HOOK_SCRIPT="$HOOKS_DIR/favicon_notification.sh"
API_URL="${FAVICON_API_URL:-https://favicon-api.noreika.lt}"

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  VS Code Favicon - Claude Hooks Setup                      ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo

# Check if Claude Code is installed
if [ ! -d "$CLAUDE_DIR" ]; then
    echo -e "${RED}Error: Claude Code not found (~/.claude/ directory missing)${NC}"
    echo -e "Please install Claude Code first: ${YELLOW}npm install -g @anthropic-ai/claude-code${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} Claude Code directory found: $CLAUDE_DIR"

# Create hooks directory if needed
if [ ! -d "$HOOKS_DIR" ]; then
    echo -e "${YELLOW}Creating hooks directory...${NC}"
    mkdir -p "$HOOKS_DIR"
fi

echo -e "${GREEN}✓${NC} Hooks directory: $HOOKS_DIR"

# Create the hook script
echo -e "${YELLOW}Creating notification hook script...${NC}"

cat > "$HOOK_SCRIPT" << 'HOOKSCRIPT'
#!/bin/bash
# Claude Code Stop Hook - Sends completion notification to favicon-api
# Triggered when Claude finishes responding (Stop event)
#
# API Endpoints:
#   POST /claude-completion - Task completed (GREEN badge)
#   POST /claude-started    - Working notification (YELLOW badge)
#
# Environment:
#   CLAUDE_PROJECT_DIR - Project directory path (used as 'folder' parameter)
#   FAVICON_API_URL    - API base URL (default: https://favicon-api.noreika.lt)

set -e

# Configuration
FAVICON_API_URL="${FAVICON_API_URL:-https://favicon-api.noreika.lt}"
TIMEOUT_SECONDS=5

# Read hook input from stdin with timeout (prevents hanging if stdin is empty)
input_json=$(timeout 1 cat 2>/dev/null) || input_json="{}"

# Extract hook event and project directory
hook_event=$(echo "$input_json" | jq -r '.hook_event_name // "unknown"')
cwd=$(echo "$input_json" | jq -r '.cwd // ""')

# Use CLAUDE_PROJECT_DIR if available, otherwise use cwd from hook input
project_dir="${CLAUDE_PROJECT_DIR:-$cwd}"

# Exit if no project directory
if [ -z "$project_dir" ]; then
    exit 0
fi

# Determine endpoint based on hook event
case "$hook_event" in
    "Stop"|"SubagentStop")
        endpoint="/claude-completion"
        message="Task completed"
        ;;
    "SessionStart")
        endpoint="/claude-started"
        message="Working..."
        ;;
    *)
        # Unknown event, skip notification
        exit 0
        ;;
esac

# Send notification to favicon API
# Using X-Requested-With header for CSRF protection
curl -X POST "${FAVICON_API_URL}${endpoint}" \
    -H "Content-Type: application/json" \
    -H "X-Requested-With: XMLHttpRequest" \
    -H "Origin: https://vs.noreika.lt" \
    --max-time "$TIMEOUT_SECONDS" \
    --silent \
    --show-error \
    -d "{
        \"folder\": \"$project_dir\",
        \"message\": \"$message\"
    }" > /dev/null 2>&1 || true

# Always exit successfully - don't block Claude's operation
exit 0
HOOKSCRIPT

chmod +x "$HOOK_SCRIPT"
echo -e "${GREEN}✓${NC} Hook script created: $HOOK_SCRIPT"

# Update settings.json
echo -e "${YELLOW}Updating Claude settings...${NC}"

# Check if settings.json exists
if [ ! -f "$SETTINGS_FILE" ]; then
    echo '{}' > "$SETTINGS_FILE"
fi

# Check if jq is available
if ! command -v jq &> /dev/null; then
    echo -e "${RED}Error: jq is required but not installed${NC}"
    echo -e "Install with: ${YELLOW}sudo apt install jq${NC} or ${YELLOW}brew install jq${NC}"
    exit 1
fi

# Read current settings
current_settings=$(cat "$SETTINGS_FILE")

# Create hook configuration
hook_config='{
    "matcher": "",
    "hooks": [
        {
            "type": "command",
            "command": "'"$HOOK_SCRIPT"'",
            "timeout": 10
        }
    ]
}'

# Merge hooks into settings
# This preserves existing settings and adds/updates hooks
new_settings=$(echo "$current_settings" | jq --argjson hook "$hook_config" '
    .hooks = (.hooks // {}) |
    .hooks.Stop = [($hook)] |
    .hooks.SubagentStop = [($hook)]
')

# Write updated settings
echo "$new_settings" > "$SETTINGS_FILE"

echo -e "${GREEN}✓${NC} Settings updated: $SETTINGS_FILE"

# Verify configuration
echo
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}Setup complete!${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo
echo -e "Configuration:"
echo -e "  Hook script: ${YELLOW}$HOOK_SCRIPT${NC}"
echo -e "  Settings:    ${YELLOW}$SETTINGS_FILE${NC}"
echo -e "  API URL:     ${YELLOW}$API_URL${NC}"
echo
echo -e "When Claude finishes responding, a notification will be sent to"
echo -e "the favicon API and you'll see a green badge in the browser extension."
echo
echo -e "${YELLOW}Note:${NC} Restart Claude Code for changes to take effect."
echo

# Test API connectivity (optional)
echo -e "Testing API connectivity..."
if curl -s --max-time 5 "$API_URL/health/live" > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} API is reachable: $API_URL"
else
    echo -e "${YELLOW}⚠${NC} Could not reach API (this may be normal if you're offline)"
fi

echo
echo -e "${GREEN}Done!${NC} Happy coding with Claude!"
