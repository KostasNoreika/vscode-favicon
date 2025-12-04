#!/bin/bash

# Complete VS Code Favicon Setup Script

echo "🎨 VS Code Favicon System - Complete Setup"
echo "=========================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}📦 Step 1: Starting Favicon API Service${NC}"
cd /opt/tools/vscode-favicon-api

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Stop existing service
pm2 stop vscode-favicon-api 2>/dev/null || true
pm2 delete vscode-favicon-api 2>/dev/null || true

# Start new service
pm2 start server.js --name vscode-favicon-api
pm2 save

echo -e "${GREEN}✅ API Service started on port 8091${NC}"

echo -e "${BLUE}🌐 Step 2: Cloudflare Configuration${NC}"
echo ""
echo "You need to configure Cloudflare to proxy:"
echo "  favicon-api.vs.noreika.lt -> localhost:8091"
echo ""
echo "Go to your Cloudflare dashboard and add this mapping to your tunnel."
echo ""

echo -e "${BLUE}🔧 Step 3: Chrome Extension${NC}"
echo ""
echo "IMPORTANT: Chrome Extension is REQUIRED for this to work!"
echo ""
echo "Installation steps:"
echo "1. Open Chrome: chrome://extensions/"
echo "2. Enable 'Developer mode' (top right toggle)"
echo "3. Click 'Load unpacked'"
echo "4. Select directory: /opt/tools/vscode-favicon-extension"
echo "5. Extension should appear in your extensions list"
echo ""

echo -e "${BLUE}🧪 Step 4: Testing${NC}"
echo ""
echo "Test API locally:"
echo "curl \"http://localhost:8091/favicon-api?folder=/opt/dev/project-dashboard\""
echo ""
echo "After Cloudflare setup, test remotely:"
echo "curl \"https://favicon-api.vs.noreika.lt/favicon-api?folder=/opt/dev/project-dashboard\""
echo ""

echo -e "${BLUE}🎯 Step 5: How it works${NC}"
echo ""
echo "1. Open VS Code: https://vs.noreika.lt/?folder=/opt/dev/some-project"
echo "2. Chrome Extension detects folder parameter"
echo "3. Extension fetches favicon from: https://favicon-api.vs.noreika.lt"
echo "4. Browser tab shows unique favicon with project initials"
echo "5. Title shows [PROJECT-NAME] VS Code..."
echo ""

echo -e "${GREEN}✨ Setup Complete!${NC}"
echo ""
echo "Commands:"
echo "  pm2 status                  - Check API service"
echo "  pm2 logs vscode-favicon-api - View API logs"
echo "  pm2 restart vscode-favicon-api - Restart API"
echo ""
echo -e "${YELLOW}⚠️  Remember:${NC}"
echo "1. Configure Cloudflare tunnel for favicon-api.vs.noreika.lt"
echo "2. Install Chrome Extension (REQUIRED)"
echo "3. Both must be working for favicons to appear"