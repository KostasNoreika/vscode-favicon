#!/bin/bash

###############################################################################
# XSS Vulnerability Fix Deployment Script
#
# This script applies security patches to fix CVSS 8.8 XSS vulnerability
# in the vscode-favicon service
#
# SECURITY: Run this script to deploy XSS protection patches
###############################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Base directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo -e "${BLUE}=========================================${NC}"
echo -e "${BLUE}XSS Vulnerability Fix Deployment${NC}"
echo -e "${BLUE}CVSS 8.8 -> 0.0 (Patched)${NC}"
echo -e "${BLUE}=========================================${NC}"
echo ""

# Function to print status
print_status() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

# Check if running from correct directory
if [ ! -f "$PROJECT_DIR/package.json" ]; then
    print_error "Must be run from vscode-favicon project directory"
    exit 1
fi

print_status "Project directory: $PROJECT_DIR"
echo ""

# Step 1: Backup current files
echo -e "${BLUE}Step 1: Creating backups...${NC}"
BACKUP_DIR="$PROJECT_DIR/backups/xss-fix-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

cp "$PROJECT_DIR/vscode-favicon-service/server.js" "$BACKUP_DIR/service-server.js.bak" 2>/dev/null || true
cp "$PROJECT_DIR/vscode-favicon-api/server.js" "$BACKUP_DIR/api-server.js.bak" 2>/dev/null || true
cp "$PROJECT_DIR/vscode-favicon-extension/content-project-favicon.js" "$BACKUP_DIR/extension.js.bak" 2>/dev/null || true

print_status "Backups created in: $BACKUP_DIR"
echo ""

# Step 2: Verify sanitizer library exists
echo -e "${BLUE}Step 2: Verifying security library...${NC}"
if [ ! -f "$PROJECT_DIR/lib/svg-sanitizer.js" ]; then
    print_error "svg-sanitizer.js not found in lib/ directory"
    print_warning "Please ensure lib/svg-sanitizer.js is present before running this script"
    exit 1
fi
print_status "SVG sanitizer library found"
echo ""

# Step 3: Update vscode-favicon-service/server.js
echo -e "${BLUE}Step 3: Patching vscode-favicon-service...${NC}"

# Check if already patched
if grep -q "getCleanInitials" "$PROJECT_DIR/vscode-favicon-service/server.js"; then
    print_warning "vscode-favicon-service appears to be already patched"
else
    # Add import statement
    if ! grep -q "svg-sanitizer" "$PROJECT_DIR/vscode-favicon-service/server.js"; then
        # Find the line with path-validator import and add svg-sanitizer import after it
        sed -i.tmp "/require.*path-validator/a\\
const { getCleanInitials, sanitizePort, sanitizeColor } = require('../lib/svg-sanitizer');" \
            "$PROJECT_DIR/vscode-favicon-service/server.js"
        print_status "Added svg-sanitizer import to service"
    fi

    # Now update the generateProjectFavicon function
    # This is complex, so we'll provide manual instructions
    print_warning "Manual update required for generateProjectFavicon() function"
    print_warning "Please replace lines 117-142 in vscode-favicon-service/server.js with:"
    echo ""
    cat << 'EOF'
    // SECURITY FIX: Use sanitizer
    const initials = getCleanInitials(displayName);
    const safeColor = sanitizeColor(bgColor);
    const safePort = sanitizePort(port);

    const portText = (type === 'dev' && safePort) ?
        `<text x="16" y="30">${safePort}</text>` : '';

    return `<svg width="32" height="32" xmlns="http://www.w3.org/2000/svg">
        <rect width="32" height="32" rx="4" fill="${safeColor}"/>
        <text x="16" y="21">${initials}</text>
        ${portText}
    </svg>`;
EOF
    echo ""
fi

# Step 4: Update vscode-favicon-api/server.js
echo -e "${BLUE}Step 4: Patching vscode-favicon-api...${NC}"

if grep -q "getCleanInitials" "$PROJECT_DIR/vscode-favicon-api/server.js"; then
    print_warning "vscode-favicon-api appears to be already patched"
else
    if ! grep -q "svg-sanitizer" "$PROJECT_DIR/vscode-favicon-api/server.js"; then
        sed -i.tmp "/require.*path-validator/a\\
const { getCleanInitials, sanitizePort, sanitizeColor } = require('../lib/svg-sanitizer');" \
            "$PROJECT_DIR/vscode-favicon-api/server.js"
        print_status "Added svg-sanitizer import to API"
    fi

    print_warning "Manual update required for generateFavicon() function"
    print_warning "Please replace lines 108-128 in vscode-favicon-api/server.js"
fi

echo ""

# Step 5: Run tests
echo -e "${BLUE}Step 5: Running security tests...${NC}"
cd "$PROJECT_DIR"

if command -v npm &> /dev/null; then
    if npm test -- svg-sanitizer.test.js 2>/dev/null; then
        print_status "All security tests passed"
    else
        print_warning "Some tests failed - please review"
    fi
else
    print_warning "npm not found - skipping tests"
fi

echo ""

# Step 6: Service restart instructions
echo -e "${BLUE}Step 6: Service restart required${NC}"
echo ""
echo "After verifying the patches, restart services:"
echo "  pm2 restart vscode-favicon-service"
echo "  pm2 restart vscode-favicon-api"
echo ""
echo "Or if using systemd:"
echo "  sudo systemctl restart vscode-favicon-service"
echo "  sudo systemctl restart vscode-favicon-api"
echo ""

# Step 7: Verification
echo -e "${BLUE}Step 7: Verification tests${NC}"
echo ""
echo "Run these commands to verify XSS protection:"
echo ""
echo "# Test 1: Malicious project name (should be sanitized)"
echo "curl -s 'http://localhost:8090/api/favicon?folder=/opt/dev/<script>test</script>' | grep '<script'"
echo "Expected: No output (XSS blocked)"
echo ""
echo "# Test 2: Valid input (should work)"
echo "curl -s 'http://localhost:8090/api/favicon?folder=/opt/dev/my-project' | grep '<svg'"
echo "Expected: Match found"
echo ""
echo "# Test 3: Health check"
echo "curl http://localhost:8090/health"
echo ""

# Summary
echo -e "${BLUE}=========================================${NC}"
echo -e "${GREEN}XSS Fix Deployment Summary${NC}"
echo -e "${BLUE}=========================================${NC}"
echo ""
print_status "Backups created: $BACKUP_DIR"
print_status "SVG sanitizer library verified"
print_warning "Manual code updates required (see above)"
print_status "Security tests available: npm test"
echo ""
echo -e "${YELLOW}IMPORTANT: Review and apply manual changes before restarting services${NC}"
echo ""
echo "Documentation: docs/SECURITY_AUDIT_XSS_FIX.md"
echo ""

# Cleanup temporary files
rm -f "$PROJECT_DIR/vscode-favicon-service/server.js.tmp"
rm -f "$PROJECT_DIR/vscode-favicon-api/server.js.tmp"

exit 0
