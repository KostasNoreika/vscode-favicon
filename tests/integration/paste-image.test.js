/**
 * Integration Tests for Paste Image Endpoint
 * Tests the POST /api/paste-image endpoint with various scenarios
 */

// Use real file-type module for integration tests (not the mock)
jest.unmock('file-type');

const request = require('supertest');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { createPasteRoutes } = require('../../lib/routes/paste-routes');
const { requireValidPath } = require('../../lib/routes/favicon-routes');
const { requestLogger } = require('../../lib/logger');
const rateLimit = require('express-rate-limit');

describe('POST /api/paste-image', () => {
    let app;
    let testFolder;
    let tasksDir;

    beforeAll(() => {
        // Create test folder structure
        testFolder = '/opt/dev/test-paste-image';
        tasksDir = path.join(testFolder, 'tasks', 'files');

        // Clean up and create test directory
        if (fs.existsSync(testFolder)) {
            fs.rmSync(testFolder, { recursive: true, force: true });
        }
        fs.mkdirSync(testFolder, { recursive: true });

        // Initialize Express app with paste routes
        app = express();
        app.use(requestLogger('test'));

        // Create rate limiter (higher limit for testing)
        const testRateLimiter = rateLimit({
            windowMs: 60000,
            max: 100,
            standardHeaders: true,
            legacyHeaders: false,
        });

        const pasteRoutes = createPasteRoutes(requireValidPath, testRateLimiter);
        app.use(pasteRoutes);
    });

    afterAll(() => {
        // Clean up test directory
        if (fs.existsSync(testFolder)) {
            fs.rmSync(testFolder, { recursive: true, force: true });
        }
    });

    afterEach(() => {
        // Clean up tasks directory after each test
        if (fs.existsSync(tasksDir)) {
            fs.rmSync(tasksDir, { recursive: true, force: true });
        }
    });

    describe('Success Cases', () => {
        test('should upload PNG image successfully', async () => {
            // Create a simple 1x1 PNG image (base64 encoded)
            const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
            const pngBuffer = Buffer.from(pngBase64, 'base64');

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', pngBuffer, {
                    filename: 'test.png',
                    contentType: 'image/png',
                });

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('success', true);
            expect(response.body).toHaveProperty('filename');
            expect(response.body).not.toHaveProperty('path');
            expect(response.body.filename).toMatch(/^img-\d{4}-\d{2}-\d{2}-\d{6}-\d{3}\.(png|jpg|webp)$/);

            // Verify file was created
            const fullPath = path.join(tasksDir, response.body.filename);
            expect(fs.existsSync(fullPath)).toBe(true);
        });

        test('should create tasks directory if it does not exist', async () => {
            const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
            const pngBuffer = Buffer.from(pngBase64, 'base64');

            // Ensure tasks directory doesn't exist
            expect(fs.existsSync(tasksDir)).toBe(false);

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', pngBuffer, {
                    filename: 'test.png',
                    contentType: 'image/png',
                });

            expect(response.status).toBe(200);
            expect(fs.existsSync(tasksDir)).toBe(true);
        });

        test('should accept JPEG images', async () => {
            // Minimal JPEG header
            const jpegBuffer = Buffer.from([
                0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46,
                0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
                0x00, 0x48, 0x00, 0x00, 0xFF, 0xD9
            ]);

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', jpegBuffer, {
                    filename: 'test.jpg',
                    contentType: 'image/jpeg',
                });

            expect(response.status).toBe(200);
            expect(response.body.filename).toMatch(/\.jpg$/);
        });

        test('should accept WebP images', async () => {
            // Minimal WebP header (RIFF + WEBP)
            const webpBuffer = Buffer.from('RIFF\x00\x00\x00\x00WEBP', 'binary');

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', webpBuffer, {
                    filename: 'test.webp',
                    contentType: 'image/webp',
                });

            expect(response.status).toBe(200);
            expect(response.body.filename).toMatch(/\.webp$/);
        });

        test('should accept text files', async () => {
            const textBuffer = Buffer.from('Hello, this is a text file content');

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', textBuffer, {
                    filename: 'notes.txt',
                    contentType: 'text/plain',
                });

            expect(response.status).toBe(200);
            expect(response.body.filename).toMatch(/^file-.*\.txt$/);
        });

        test('should accept JSON files', async () => {
            const jsonBuffer = Buffer.from('{"key": "value", "number": 42}');

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', jsonBuffer, {
                    filename: 'data.json',
                    contentType: 'application/json',
                });

            expect(response.status).toBe(200);
            expect(response.body.filename).toMatch(/^data-.*\.json$/);
        });
    });

    describe('Error Cases - MIME Type Validation', () => {
        test('should reject invalid MIME type (415)', async () => {
            const buffer = Buffer.from('test video data');

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', buffer, {
                    filename: 'test.mp4',
                    contentType: 'video/mp4',
                });

            expect(response.status).toBe(415);
            expect(response.body.error).toBe(true);
            expect(response.body.message).toBe('Invalid file type');
        });

        test('should reject SVG images (415)', async () => {
            const svgBuffer = Buffer.from('<svg></svg>');

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', svgBuffer, {
                    filename: 'test.svg',
                    contentType: 'image/svg+xml',
                });

            expect(response.status).toBe(415);
            expect(response.body.error).toBe(true);
            expect(response.body.message).toBe('Invalid file type');
        });
    });

    describe('Error Cases - File Size Validation', () => {
        test('should reject files larger than 10MB (413)', async () => {
            // Create a buffer larger than 10MB
            const largeBuffer = Buffer.alloc(11 * 1024 * 1024);

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', largeBuffer, {
                    filename: 'large.png',
                    contentType: 'image/png',
                });

            expect(response.status).toBe(413);
            expect(response.body.error).toBe(true);
            expect(response.body.message).toBe('File too large');
        });
    });

    describe('Error Cases - Missing Fields', () => {
        test('should reject request without image field (400)', async () => {
            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder);

            expect(response.status).toBe(400);
            expect(response.body.error).toBe(true);
            expect(response.body.message).toBe('Missing required fields');
        });

        test('should reject request without folder field (400)', async () => {
            const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
            const pngBuffer = Buffer.from(pngBase64, 'base64');

            const response = await request(app)
                .post('/api/paste-image')
                .attach('image', pngBuffer, {
                    filename: 'test.png',
                    contentType: 'image/png',
                });

            expect(response.status).toBe(400);
            expect(response.body.error).toBe(true);
            expect(response.body.message).toBe('Folder parameter required');
        });
    });

    describe('Error Cases - Path Validation', () => {
        test('should reject path traversal attempt (403)', async () => {
            const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
            const pngBuffer = Buffer.from(pngBase64, 'base64');

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', '../../../etc/passwd')
                .attach('image', pngBuffer, {
                    filename: 'test.png',
                    contentType: 'image/png',
                });

            expect(response.status).toBe(403);
            expect(response.body.error).toBe(true);
            expect(response.body.message).toBe('Access denied');
        });

        test('should reject invalid path (403)', async () => {
            const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
            const pngBuffer = Buffer.from(pngBase64, 'base64');

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', '/invalid/path')
                .attach('image', pngBuffer, {
                    filename: 'test.png',
                    contentType: 'image/png',
                });

            expect(response.status).toBe(403);
            expect(response.body.error).toBe(true);
            expect(response.body.message).toBe('Access denied');
        });
    });

    describe('Filename Generation', () => {
        test('should generate unique timestamped filenames', async () => {
            const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
            const pngBuffer = Buffer.from(pngBase64, 'base64');

            // Upload two images in quick succession
            const response1 = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', pngBuffer, {
                    filename: 'test.png',
                    contentType: 'image/png',
                });

            const response2 = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', pngBuffer, {
                    filename: 'test.png',
                    contentType: 'image/png',
                });

            expect(response1.status).toBe(200);
            expect(response2.status).toBe(200);

            // Filenames should be different
            expect(response1.body.filename).not.toBe(response2.body.filename);

            // Both files should exist
            const fullPath1 = path.join(tasksDir, response1.body.filename);
            const fullPath2 = path.join(tasksDir, response2.body.filename);
            expect(fs.existsSync(fullPath1)).toBe(true);
            expect(fs.existsSync(fullPath2)).toBe(true);
        });

        test('should use correct file extension based on detected MIME type', async () => {
            const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
            const pngBuffer = Buffer.from(pngBase64, 'base64');

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', pngBuffer, {
                    filename: 'any-name.xxx',
                    contentType: 'image/png',
                });

            expect(response.status).toBe(200);
            expect(response.body.filename).toMatch(/\.png$/);
        });
    });

    describe('Security - MIME Type Spoofing Prevention', () => {
        test('should reject text file disguised as PNG via Content-Type (415)', async () => {
            // Plain text content with PNG Content-Type header
            const textBuffer = Buffer.from('This is a text file, not an image');

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', textBuffer, {
                    filename: 'fake.png',
                    contentType: 'image/png',
                });

            expect(response.status).toBe(415);
            expect(response.body.error).toBe(true);
            expect(response.body.message).toBe('Invalid file type');
        });

        test('should reject HTML file disguised as JPEG (415)', async () => {
            // HTML content with JPEG Content-Type header
            const htmlBuffer = Buffer.from('<html><script>alert(1)</script></html>');

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', htmlBuffer, {
                    filename: 'xss.jpg',
                    contentType: 'image/jpeg',
                });

            expect(response.status).toBe(415);
            expect(response.body.error).toBe(true);
            expect(response.body.message).toBe('Invalid file type');
        });

        test('should reject PHP script disguised as PNG (415)', async () => {
            // PHP code with PNG Content-Type header
            const phpBuffer = Buffer.from('<?php system($_GET["cmd"]); ?>');

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', phpBuffer, {
                    filename: 'webshell.png',
                    contentType: 'image/png',
                });

            expect(response.status).toBe(415);
            expect(response.body.error).toBe(true);
            expect(response.body.message).toBe('Invalid file type');
        });

        test('should reject executable disguised as WebP (415)', async () => {
            // ELF executable header with WebP Content-Type
            const elfBuffer = Buffer.from([0x7F, 0x45, 0x4C, 0x46]); // ELF magic bytes

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', elfBuffer, {
                    filename: 'malware.webp',
                    contentType: 'image/webp',
                });

            expect(response.status).toBe(415);
            expect(response.body.error).toBe(true);
            expect(response.body.message).toBe('Invalid file type');
        });
    });

    describe('Security - Information Disclosure Prevention', () => {
        test('should not return full filesystem path in response', async () => {
            const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
            const pngBuffer = Buffer.from(pngBase64, 'base64');

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', pngBuffer, {
                    filename: 'test.png',
                    contentType: 'image/png',
                });

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('filename');
            expect(response.body).not.toHaveProperty('path');

            // Filename should not contain directory information
            expect(response.body.filename).not.toContain('/');
            expect(response.body.filename).not.toContain('\\');
            expect(response.body.filename).not.toContain(testFolder);
        });
    });
});
