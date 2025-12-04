const fs = require('fs');

// Base64 encoded 1x1 transparent PNG
const transparentPNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// Create placeholder PNG files
fs.writeFileSync('icon16.png', Buffer.from(transparentPNG, 'base64'));
fs.writeFileSync('icon48.png', Buffer.from(transparentPNG, 'base64'));
fs.writeFileSync('icon128.png', Buffer.from(transparentPNG, 'base64'));

console.log('Created placeholder PNG icons');
console.log('Replace these with proper icons for better appearance');