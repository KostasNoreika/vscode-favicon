#!/bin/bash
#
# Example usage of POST /api/paste-image endpoint
# This script demonstrates how to upload an image to the vscode-favicon service
#

# Configuration
API_URL="http://localhost:8090/api/paste-image"
PROJECT_FOLDER="/opt/dev/myproject"
IMAGE_FILE="screenshot.png"

echo "Uploading image to vscode-favicon service..."
echo "API URL: $API_URL"
echo "Project folder: $PROJECT_FOLDER"
echo "Image file: $IMAGE_FILE"
echo ""

# Upload the image
response=$(curl -X POST "$API_URL" \
  -F "folder=$PROJECT_FOLDER" \
  -F "image=@$IMAGE_FILE" \
  -w "\nHTTP Status: %{http_code}\n" \
  -s)

echo "Response:"
echo "$response"

# Parse the response to extract the path
if echo "$response" | grep -q "success.*true"; then
    echo ""
    echo "Upload successful!"
    path=$(echo "$response" | grep -o '"path":"[^"]*"' | cut -d'"' -f4)
    echo "Image saved to: $path"
else
    echo ""
    echo "Upload failed. Check the error message above."
fi

# Example usage scenarios:
#
# 1. Upload PNG image:
#    curl -X POST http://localhost:8090/api/paste-image \
#      -F "folder=/opt/dev/myproject" \
#      -F "image=@screenshot.png"
#
# 2. Upload JPEG image:
#    curl -X POST http://localhost:8090/api/paste-image \
#      -F "folder=/opt/dev/myproject" \
#      -F "image=@photo.jpg"
#
# 3. Upload WebP image:
#    curl -X POST http://localhost:8090/api/paste-image \
#      -F "folder=/opt/dev/myproject" \
#      -F "image=@image.webp"
#
# Expected response (success):
# {
#   "success": true,
#   "path": "/opt/dev/myproject/tasks/img-2025-12-09-192221-123.png"
# }
#
# Expected errors:
# - 400: Missing required fields (no folder or image)
# - 403: Access denied (invalid folder path)
# - 413: File too large (> 10MB)
# - 415: Invalid file type (not png/jpeg/webp)
# - 429: Too many requests (> 10 per minute)
