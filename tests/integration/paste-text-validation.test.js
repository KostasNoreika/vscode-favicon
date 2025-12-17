/**
 * Integration Tests for Text Upload Content Validation
 * Tests deep content validation for text file uploads (UTF-8, null bytes, line length)
 */

const request = require('supertest');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { createPasteRoutes } = require('../../lib/routes/paste-routes');
const { requireValidPath } = require('../../lib/routes/favicon-routes');
const { requestLogger } = require('../../lib/logger');
const rateLimit = require('express-rate-limit');

describe('POST /api/paste-image - Text Content Validation', () => {
    let app;
    let testFolder;
    let tasksDir;

    beforeAll(() => {
        // Create test folder structure
        testFolder = '/opt/dev/test-paste-text-validation';
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

    describe('Valid Text Files', () => {
        test('should accept valid UTF-8 text file', async () => {
            const validText = 'Hello World\nThis is valid UTF-8 text\nWith multiple lines';
            const textBuffer = Buffer.from(validText, 'utf8');

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', textBuffer, {
                    filename: 'valid.txt',
                    contentType: 'text/plain',
                });

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('success', true);
            expect(response.body).toHaveProperty('filename');
            expect(response.body.filename).toMatch(/^file-.*\.txt$/);

            // Verify file was created and content is correct
            const fullPath = path.join(tasksDir, response.body.filename);
            expect(fs.existsSync(fullPath)).toBe(true);
            const savedContent = fs.readFileSync(fullPath, 'utf8');
            expect(savedContent).toBe(validText);
        });

        test('should accept text with Unicode characters', async () => {
            const unicodeText = 'Hello 世界 🌍\nEmojis and Chinese characters\nΔικαιοσύνη justice справедливость';
            const textBuffer = Buffer.from(unicodeText, 'utf8');

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', textBuffer, {
                    filename: 'unicode.txt',
                    contentType: 'text/plain',
                });

            expect(response.status).toBe(200);
            expect(response.body.filename).toMatch(/^file-.*\.txt$/);
        });

        test('should accept JSON with proper encoding', async () => {
            const jsonData = JSON.stringify({
                name: 'Test',
                value: 42,
                unicode: '世界 🌍',
                nested: { key: 'value' }
            }, null, 2);
            const jsonBuffer = Buffer.from(jsonData, 'utf8');

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

        test('should accept markdown with code blocks', async () => {
            const markdown = '# Header\n\n```javascript\nconst x = 42;\n```\n\n- List item 1\n- List item 2';
            const mdBuffer = Buffer.from(markdown, 'utf8');

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', mdBuffer, {
                    filename: 'readme.md',
                    contentType: 'text/markdown',
                });

            expect(response.status).toBe(200);
            expect(response.body.filename).toMatch(/^file-.*\.md$/);
        });

        test('should accept CSV data', async () => {
            const csvData = 'Name,Age,City\nAlice,30,New York\nBob,25,San Francisco\nCharlie,35,Boston';
            const csvBuffer = Buffer.from(csvData, 'utf8');

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', csvBuffer, {
                    filename: 'data.csv',
                    contentType: 'text/csv',
                });

            expect(response.status).toBe(200);
            expect(response.body.filename).toMatch(/^data-.*\.csv$/);
        });

        test('should accept text with long but acceptable lines (< 10KB)', async () => {
            // Create a line that's 8KB (well under the 10KB limit)
            const longLine = 'x'.repeat(8 * 1024);
            const textBuffer = Buffer.from(`Header\n${longLine}\nFooter`, 'utf8');

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', textBuffer, {
                    filename: 'long-lines.txt',
                    contentType: 'text/plain',
                });

            expect(response.status).toBe(200);
            expect(response.body.filename).toMatch(/^file-.*\.txt$/);
        });
    });

    describe('Null Byte Detection', () => {
        test('should reject text file with null byte at start (415)', async () => {
            // Null byte at the beginning
            const maliciousBuffer = Buffer.from('\x00Hello World', 'binary');

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', maliciousBuffer, {
                    filename: 'malicious.txt',
                    contentType: 'text/plain',
                });

            expect(response.status).toBe(415);
            expect(response.body.error).toBe(true);
            expect(response.body.message).toBe('Invalid file type');
        });

        test('should reject text file with null byte in middle (415)', async () => {
            // Null byte injection in middle (e.g., file.txt\0.php)
            const maliciousBuffer = Buffer.from('Hello\x00World', 'binary');

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', maliciousBuffer, {
                    filename: 'injection.txt',
                    contentType: 'text/plain',
                });

            expect(response.status).toBe(415);
            expect(response.body.error).toBe(true);
            expect(response.body.message).toBe('Invalid file type');
        });

        test('should reject text file with null byte at end (415)', async () => {
            // Null byte at the end
            const maliciousBuffer = Buffer.from('Hello World\x00', 'binary');

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', maliciousBuffer, {
                    filename: 'trailing.txt',
                    contentType: 'text/plain',
                });

            expect(response.status).toBe(415);
            expect(response.body.error).toBe(true);
            expect(response.body.message).toBe('Invalid file type');
        });

        test('should reject text file with multiple null bytes (415)', async () => {
            const maliciousBuffer = Buffer.from('Hello\x00\x00\x00World', 'binary');

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', maliciousBuffer, {
                    filename: 'multiple.txt',
                    contentType: 'text/plain',
                });

            expect(response.status).toBe(415);
            expect(response.body.error).toBe(true);
            expect(response.body.message).toBe('Invalid file type');
        });

        test('should reject JSON with null byte (415)', async () => {
            const maliciousBuffer = Buffer.from('{"key": "value\x00"}', 'binary');

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', maliciousBuffer, {
                    filename: 'malicious.json',
                    contentType: 'application/json',
                });

            expect(response.status).toBe(415);
            expect(response.body.error).toBe(true);
            expect(response.body.message).toBe('Invalid file type');
        });
    });

    describe('Invalid UTF-8 Encoding', () => {
        test('should reject text with invalid UTF-8 sequences (415)', async () => {
            // Invalid UTF-8: 0xFF is not valid in UTF-8
            const invalidBuffer = Buffer.from([
                0x48, 0x65, 0x6C, 0x6C, 0x6F, // "Hello"
                0xFF, 0xFE, // Invalid UTF-8 bytes
                0x57, 0x6F, 0x72, 0x6C, 0x64  // "World"
            ]);

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', invalidBuffer, {
                    filename: 'invalid-utf8.txt',
                    contentType: 'text/plain',
                });

            expect(response.status).toBe(415);
            expect(response.body.error).toBe(true);
            expect(response.body.message).toBe('Invalid file type');
        });

        test('should reject text with truncated multi-byte UTF-8 character (415)', async () => {
            // Start of 3-byte UTF-8 sequence but incomplete
            const invalidBuffer = Buffer.from([
                0x48, 0x65, 0x6C, 0x6C, 0x6F, // "Hello"
                0xE0, 0xA0, // Incomplete 3-byte sequence (missing last byte)
                0x57, 0x6F, 0x72, 0x6C, 0x64  // "World"
            ]);

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', invalidBuffer, {
                    filename: 'truncated-utf8.txt',
                    contentType: 'text/plain',
                });

            expect(response.status).toBe(415);
            expect(response.body.error).toBe(true);
            expect(response.body.message).toBe('Invalid file type');
        });

        test('should reject binary data disguised as text (415)', async () => {
            // Random binary data (e.g., part of a compiled binary)
            const binaryBuffer = Buffer.from([
                0x7F, 0x45, 0x4C, 0x46, // ELF magic bytes
                0x01, 0x01, 0x01, 0x00,
                0xFF, 0xFE, 0xFD, 0xFC
            ]);

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', binaryBuffer, {
                    filename: 'binary.txt',
                    contentType: 'text/plain',
                });

            expect(response.status).toBe(415);
            expect(response.body.error).toBe(true);
            expect(response.body.message).toBe('Invalid file type');
        });

        test('should reject text with overlong UTF-8 encoding (415)', async () => {
            // Overlong encoding: 0xC0 0x80 represents NULL but is invalid UTF-8
            const invalidBuffer = Buffer.from([
                0x48, 0x65, 0x6C, 0x6C, 0x6F, // "Hello"
                0xC0, 0x80, // Overlong encoding (invalid)
                0x57, 0x6F, 0x72, 0x6C, 0x64  // "World"
            ]);

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', invalidBuffer, {
                    filename: 'overlong.txt',
                    contentType: 'text/plain',
                });

            expect(response.status).toBe(415);
            expect(response.body.error).toBe(true);
            expect(response.body.message).toBe('Invalid file type');
        });
    });

    describe('Line Length Validation', () => {
        test('should reject text with line exceeding 10KB (415)', async () => {
            // Create a line that's exactly 10KB + 1 byte
            const tooLongLine = 'x'.repeat(10 * 1024 + 1);
            const textBuffer = Buffer.from(`Header\n${tooLongLine}\nFooter`, 'utf8');

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', textBuffer, {
                    filename: 'too-long.txt',
                    contentType: 'text/plain',
                });

            expect(response.status).toBe(415);
            expect(response.body.error).toBe(true);
            expect(response.body.message).toBe('Invalid file type');
        });

        test('should reject text with multiple overly long lines (415)', async () => {
            // Multiple lines exceeding the limit
            const longLine1 = 'a'.repeat(11 * 1024);
            const longLine2 = 'b'.repeat(12 * 1024);
            const textBuffer = Buffer.from(`${longLine1}\n${longLine2}`, 'utf8');

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', textBuffer, {
                    filename: 'multiple-long.txt',
                    contentType: 'text/plain',
                });

            expect(response.status).toBe(415);
            expect(response.body.error).toBe(true);
            expect(response.body.message).toBe('Invalid file type');
        });

        test('should reject JSON with overly long field value (415)', async () => {
            // JSON with a field value that's too long
            const longValue = 'x'.repeat(11 * 1024);
            const jsonData = JSON.stringify({ key: longValue });
            const jsonBuffer = Buffer.from(jsonData, 'utf8');

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', jsonBuffer, {
                    filename: 'long-field.json',
                    contentType: 'application/json',
                });

            expect(response.status).toBe(415);
            expect(response.body.error).toBe(true);
            expect(response.body.message).toBe('Invalid file type');
        });

        test('should accept text at exactly 10KB line limit', async () => {
            // Line that's exactly 10KB (should pass)
            const maxLine = 'x'.repeat(10 * 1024);
            const textBuffer = Buffer.from(`Header\n${maxLine}\nFooter`, 'utf8');

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', textBuffer, {
                    filename: 'max-line.txt',
                    contentType: 'text/plain',
                });

            expect(response.status).toBe(200);
            expect(response.body.filename).toMatch(/^file-.*\.txt$/);
        });
    });

    describe('Content Size Validation', () => {
        test('should accept text file near max size (< 10MB)', async () => {
            // Create a file that's ~9.5MB with proper line breaks (< 10KB per line)
            const lineLength = 8 * 1024; // 8KB per line to stay under 10KB limit
            const numLines = Math.ceil((9.5 * 1024 * 1024) / (lineLength + 1)); // +1 for newline
            const largeText = Array(numLines).fill('x'.repeat(lineLength)).join('\n');
            const textBuffer = Buffer.from(largeText, 'utf8');

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', textBuffer, {
                    filename: 'large.txt',
                    contentType: 'text/plain',
                });

            expect(response.status).toBe(200);
            expect(response.body.filename).toMatch(/^file-.*\.txt$/);
        });

        test('should reject text file exceeding max size (> 10MB)', async () => {
            // Create a file that's 11MB (should fail at multer level)
            const tooLargeText = 'x'.repeat(11 * 1024 * 1024);
            const textBuffer = Buffer.from(tooLargeText, 'utf8');

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', textBuffer, {
                    filename: 'too-large.txt',
                    contentType: 'text/plain',
                });

            expect(response.status).toBe(413);
            expect(response.body.error).toBe(true);
            expect(response.body.message).toBe('File too large');
        });
    });

    describe('Edge Cases', () => {
        test('should accept empty text file', async () => {
            const emptyBuffer = Buffer.from('', 'utf8');

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', emptyBuffer, {
                    filename: 'empty.txt',
                    contentType: 'text/plain',
                });

            expect(response.status).toBe(200);
            expect(response.body.filename).toMatch(/^file-.*\.txt$/);
        });

        test('should accept single character file', async () => {
            const singleChar = Buffer.from('x', 'utf8');

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', singleChar, {
                    filename: 'single.txt',
                    contentType: 'text/plain',
                });

            expect(response.status).toBe(200);
            expect(response.body.filename).toMatch(/^file-.*\.txt$/);
        });

        test('should accept text with only newlines', async () => {
            const newlinesBuffer = Buffer.from('\n\n\n\n', 'utf8');

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', newlinesBuffer, {
                    filename: 'newlines.txt',
                    contentType: 'text/plain',
                });

            expect(response.status).toBe(200);
            expect(response.body.filename).toMatch(/^file-.*\.txt$/);
        });

        test('should accept text with CRLF line endings', async () => {
            const crlfText = 'Line 1\r\nLine 2\r\nLine 3';
            const crlfBuffer = Buffer.from(crlfText, 'utf8');

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', crlfBuffer, {
                    filename: 'crlf.txt',
                    contentType: 'text/plain',
                });

            expect(response.status).toBe(200);
            expect(response.body.filename).toMatch(/^file-.*\.txt$/);
        });

        test('should accept text with mixed line endings', async () => {
            const mixedText = 'Line 1\nLine 2\r\nLine 3\rLine 4';
            const mixedBuffer = Buffer.from(mixedText, 'utf8');

            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', testFolder)
                .attach('image', mixedBuffer, {
                    filename: 'mixed.txt',
                    contentType: 'text/plain',
                });

            expect(response.status).toBe(200);
            expect(response.body.filename).toMatch(/^file-.*\.txt$/);
        });
    });
});
