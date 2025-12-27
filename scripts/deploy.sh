#!/bin/bash
# =============================================================================
# Deploy script for vscode-favicon on Mac Studio
# =============================================================================

set -e

PROJECT_DIR="/opt/tools/vscode-favicon"
PM2_APP_NAME="vscode-favicon-unified"

echo "=== vscode-favicon Deployment ==="
echo "Time: $(date)"
echo ""

cd "$PROJECT_DIR"

# 1. Pull latest code
echo ">>> Pulling latest code..."
git fetch origin
git reset --hard origin/main
git log -1 --oneline

# 2. Install dependencies
echo ""
echo ">>> Installing dependencies..."
npm ci

# 3. Run quick tests (optional)
if [ "$1" != "--skip-tests" ]; then
    echo ""
    echo ">>> Running tests..."
    npm test -- --testPathPattern="health" --maxWorkers=2 || true
fi

# 4. Reload PM2
echo ""
echo ">>> Reloading PM2..."
if pm2 list | grep -q "$PM2_APP_NAME"; then
    pm2 reload ecosystem.config.js --update-env
else
    pm2 start ecosystem.config.js
fi
pm2 save

# 5. Health check
echo ""
echo ">>> Health check..."
sleep 3
if curl -sf http://localhost:8090/health > /dev/null; then
    echo "✅ Health check passed!"
else
    echo "❌ Health check failed!"
    pm2 logs "$PM2_APP_NAME" --lines 20
    exit 1
fi

echo ""
echo "=== Deployment complete! ==="
