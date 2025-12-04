#!/bin/bash

# VS Code Favicon Service Setup Script

echo "🎨 VS Code Favicon Service Setup"
echo "================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if running on Mac
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo -e "${RED}❌ This script is designed for macOS${NC}"
    exit 1
fi

# Service directory
SERVICE_DIR="/opt/tools/vscode-favicon-service"
EXTENSION_DIR="/opt/tools/vscode-favicon-extension"

echo -e "${BLUE}📦 Step 1: Installing Node.js dependencies${NC}"
cd "$SERVICE_DIR"
npm install

echo -e "${BLUE}🚀 Step 2: Starting favicon service with PM2${NC}"
# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo -e "${YELLOW}Installing PM2 globally...${NC}"
    npm install -g pm2
fi

# Stop existing service if running
pm2 stop vscode-favicon 2>/dev/null || true
pm2 delete vscode-favicon 2>/dev/null || true

# Start the service
pm2 start server.js --name vscode-favicon
pm2 save
pm2 startup

echo -e "${GREEN}✅ Favicon service started on port 8090${NC}"

echo -e "${BLUE}🌐 Step 3: Chrome Extension Setup${NC}"
echo ""
echo "To install the Chrome extension:"
echo "1. Open Chrome and go to: chrome://extensions/"
echo "2. Enable 'Developer mode' (top right)"
echo "3. Click 'Load unpacked'"
echo "4. Select directory: $EXTENSION_DIR"
echo ""

echo -e "${BLUE}🔧 Step 4: Testing the service${NC}"
# Test the API
echo -n "Testing favicon API... "
if curl -s "http://localhost:8090/health" | grep -q "ok"; then
    echo -e "${GREEN}✅ Service is running${NC}"
else
    echo -e "${RED}❌ Service not responding${NC}"
    echo "Check logs with: pm2 logs vscode-favicon"
    exit 1
fi

echo ""
echo -e "${GREEN}✨ Setup Complete!${NC}"
echo ""
echo "The favicon service will now:"
echo "• Check your project registry at /opt/registry/projects.json"
echo "• Look for existing favicons in project folders"
echo "• Generate unique favicons if none exist"
echo "• Show project type (dev/prod) and port numbers"
echo ""
echo "Commands:"
echo "  pm2 status          - Check service status"
echo "  pm2 logs vscode-favicon - View logs"
echo "  pm2 restart vscode-favicon - Restart service"
echo ""
echo -e "${YELLOW}⚠️  Note: Make sure Chrome extension is loaded for browser integration${NC}"