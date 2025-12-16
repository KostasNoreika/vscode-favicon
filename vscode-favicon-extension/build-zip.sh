#!/bin/bash
# Build production ZIP for Chrome Extension
# Only includes files necessary for the extension to work

set -e

# Get version from manifest.json
VERSION=$(grep '"version"' manifest.json | sed 's/.*"version": *"\([^"]*\)".*/\1/')
OUTPUT="../vscode-favicon-extension-v${VERSION}.zip"

echo "Building VS Code Favicon Extension v${VERSION}..."

# Remove old zip if exists
rm -f "$OUTPUT"

# Create zip with only production files
zip "$OUTPUT" \
  manifest.json \
  background.js \
  content-project-favicon.js \
  popup.js \
  popup.html \
  options.js \
  options.html \
  modules/circuit-breaker.js \
  modules/domain-manager.js \
  modules/message-router.js \
  modules/notification-poller.js \
  modules/path-utils.js \
  modules/storage-manager.js \
  modules/tab-manager.js \
  icon16.png \
  icon48.png \
  icon128.png

echo ""
echo "Created: $OUTPUT"
echo "Files: $(unzip -l "$OUTPUT" | tail -1)"
ls -la "$OUTPUT"
