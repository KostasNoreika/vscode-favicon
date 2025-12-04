#!/bin/bash

# Generate icon files for Chrome extension

# Create icon as base64 SVG
cat > icon.svg << 'EOF'
<svg width="128" height="128" xmlns="http://www.w3.org/2000/svg">
  <rect width="128" height="128" rx="16" fill="#007ACC"/>
  <text x="64" y="48" text-anchor="middle" fill="white" font-family="Arial" font-size="36" font-weight="bold">VS</text>
  <text x="64" y="88" text-anchor="middle" fill="white" font-family="Arial" font-size="24">Favicon</text>
</svg>
EOF

# Convert SVG to PNG using sips (built-in macOS tool)
# First convert to temporary TIFF, then to PNG

echo "Creating Chrome extension icons..."

# For 128x128
echo '<svg width="128" height="128" xmlns="http://www.w3.org/2000/svg"><rect width="128" height="128" rx="16" fill="#007ACC"/><text x="64" y="72" text-anchor="middle" fill="white" font-family="Arial" font-size="48" font-weight="bold">VS</text></svg>' > icon128.svg

# For 48x48
echo '<svg width="48" height="48" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="6" fill="#007ACC"/><text x="24" y="32" text-anchor="middle" fill="white" font-family="Arial" font-size="20" font-weight="bold">VS</text></svg>' > icon48.svg

# For 16x16
echo '<svg width="16" height="16" xmlns="http://www.w3.org/2000/svg"><rect width="16" height="16" rx="2" fill="#007ACC"/><text x="8" y="12" text-anchor="middle" fill="white" font-family="Arial" font-size="10" font-weight="bold">V</text></svg>' > icon16.svg

echo "Icon SVG files created. You can convert them to PNG using:"
echo "  - Online converter: https://cloudconvert.com/svg-to-png"
echo "  - Or install ImageMagick: brew install imagemagick"
echo "  - Then run: convert icon128.svg icon128.png"