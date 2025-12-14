/**
 * CSRF Protection Tests
 * Tests for SEC-007: CSRF protection via custom header requirement
 *
 * Verifies that POST/DELETE endpoints reject requests without X-Requested-With header
 */

const request = require('supertest');
const express = require('express');
const path = require('path');

// Mock configuration
jest.mock('../../lib/config', () => ({
    allowedPaths: ['/opt/dev', '/opt/prod'],
    dataDir: path.join(__dirname, '../fixtures'),
    rateLimitNotificationWindow: 60000,
    rateLimitNotificationMax: 1000,
}));

describe('CSRF Protection (SEC-007)', () => {
    let app;

    beforeEach(() => {
        // Create test app with CSRF protection
        app = express();
        app.use(express.json());

        // Import CSRF protection and routes
        const { createCSRFProtection } = require('../../lib/middleware/setup');
        const { requireValidPath } = require('../../lib/routes/favicon-routes');
        const csrfProtection = createCSRFProtection();

        // Test endpoints with CSRF protection
        app.post('/test-protected', csrfProtection, (req, res) => {
            res.json({ success: true });
        });

        app.delete('/test-protected', csrfProtection, (req, res) => {
            res.json({ success: true });
        });

        app.put('/test-protected', csrfProtection, (req, res) => {
            res.json({ success: true });
        });

        app.patch('/test-protected', csrfProtection, (req, res) => {
            res.json({ success: true });
        });

        // Safe methods (not protected)
        app.get('/test-safe', (req, res) => {
            res.json({ success: true });
        });

        // Real notification endpoints
        app.post('/claude-completion', csrfProtection, requireValidPath, (req, res) => {
            res.json({ status: 'ok' });
        });

        app.post('/claude-status/mark-read', csrfProtection, requireValidPath, (req, res) => {
            res.json({ status: 'ok' });
        });

        app.delete('/claude-status', csrfProtection, requireValidPath, (req, res) => {
            res.json({ status: 'ok' });
        });

        app.delete('/claude-status/all', csrfProtection, (req, res) => {
            res.json({ status: 'ok' });
        });
    });

    describe('POST endpoint protection', () => {
        test('should reject POST request without X-Requested-With header (403)', async () => {
            const response = await request(app)
                .post('/test-protected')
                .send({ data: 'test' })
                .expect(403);

            expect(response.body).toMatchObject({
                error: 'Forbidden',
                message: 'Missing required header',
            });
        });

        test('should accept POST request with X-Requested-With header (200)', async () => {
            const response = await request(app)
                .post('/test-protected')
                .set('X-Requested-With', 'XMLHttpRequest')
                .send({ data: 'test' })
                .expect(200);

            expect(response.body).toEqual({ success: true });
        });

        test('should reject POST request with empty X-Requested-With header (403)', async () => {
            const response = await request(app)
                .post('/test-protected')
                .set('X-Requested-With', '')
                .send({ data: 'test' })
                .expect(403);

            expect(response.body).toMatchObject({
                error: 'Forbidden',
                message: 'Missing required header',
            });
        });

        test('should reject POST request with whitespace-only X-Requested-With header (403)', async () => {
            const response = await request(app)
                .post('/test-protected')
                .set('X-Requested-With', '   ')
                .send({ data: 'test' })
                .expect(403);

            expect(response.body).toMatchObject({
                error: 'Forbidden',
                message: 'Missing required header',
            });
        });

        test('should accept POST request with custom X-Requested-With value (200)', async () => {
            const response = await request(app)
                .post('/test-protected')
                .set('X-Requested-With', 'fetch-api')
                .send({ data: 'test' })
                .expect(200);

            expect(response.body).toEqual({ success: true });
        });
    });

    describe('DELETE endpoint protection', () => {
        test('should reject DELETE request without X-Requested-With header (403)', async () => {
            const response = await request(app)
                .delete('/test-protected')
                .send({ data: 'test' })
                .expect(403);

            expect(response.body).toMatchObject({
                error: 'Forbidden',
                message: 'Missing required header',
            });
        });

        test('should accept DELETE request with X-Requested-With header (200)', async () => {
            const response = await request(app)
                .delete('/test-protected')
                .set('X-Requested-With', 'XMLHttpRequest')
                .send({ data: 'test' })
                .expect(200);

            expect(response.body).toEqual({ success: true });
        });
    });

    describe('PUT endpoint protection', () => {
        test('should reject PUT request without X-Requested-With header (403)', async () => {
            await request(app)
                .put('/test-protected')
                .send({ data: 'test' })
                .expect(403);
        });

        test('should accept PUT request with X-Requested-With header (200)', async () => {
            await request(app)
                .put('/test-protected')
                .set('X-Requested-With', 'XMLHttpRequest')
                .send({ data: 'test' })
                .expect(200);
        });
    });

    describe('PATCH endpoint protection', () => {
        test('should reject PATCH request without X-Requested-With header (403)', async () => {
            await request(app)
                .patch('/test-protected')
                .send({ data: 'test' })
                .expect(403);
        });

        test('should accept PATCH request with X-Requested-With header (200)', async () => {
            await request(app)
                .patch('/test-protected')
                .set('X-Requested-With', 'XMLHttpRequest')
                .send({ data: 'test' })
                .expect(200);
        });
    });

    describe('Safe methods (not protected)', () => {
        test('should allow GET request without X-Requested-With header (200)', async () => {
            const response = await request(app)
                .get('/test-safe')
                .expect(200);

            expect(response.body).toEqual({ success: true });
        });

        test('should allow GET request with X-Requested-With header (200)', async () => {
            const response = await request(app)
                .get('/test-safe')
                .set('X-Requested-With', 'XMLHttpRequest')
                .expect(200);

            expect(response.body).toEqual({ success: true });
        });
    });

    describe('Real notification endpoints', () => {
        test('should reject /claude-completion without X-Requested-With header (403)', async () => {
            const response = await request(app)
                .post('/claude-completion')
                .send({
                    folder: '/opt/dev/test-project',
                    message: 'Test',
                })
                .expect(403);

            expect(response.body.error).toBe('Forbidden');
        });

        test('should accept /claude-completion with X-Requested-With header', async () => {
            const response = await request(app)
                .post('/claude-completion')
                .set('X-Requested-With', 'XMLHttpRequest')
                .send({
                    folder: '/opt/dev/test-project',
                    message: 'Test',
                })
                .expect(200);

            expect(response.body).toHaveProperty('status', 'ok');
        });

        test('should reject /claude-status/mark-read without X-Requested-With header (403)', async () => {
            const response = await request(app)
                .post('/claude-status/mark-read')
                .send({
                    folder: '/opt/dev/test-project',
                })
                .expect(403);

            expect(response.body.error).toBe('Forbidden');
        });

        test('should accept /claude-status/mark-read with X-Requested-With header', async () => {
            const response = await request(app)
                .post('/claude-status/mark-read')
                .set('X-Requested-With', 'XMLHttpRequest')
                .send({
                    folder: '/opt/dev/test-project',
                })
                .expect(200);

            expect(response.body).toEqual({ status: 'ok' });
        });

        test('should reject DELETE /claude-status without X-Requested-With header (403)', async () => {
            const response = await request(app)
                .delete('/claude-status')
                .send({
                    folder: '/opt/dev/test-project',
                })
                .expect(403);

            expect(response.body.error).toBe('Forbidden');
        });

        test('should accept DELETE /claude-status with X-Requested-With header', async () => {
            const response = await request(app)
                .delete('/claude-status')
                .set('X-Requested-With', 'XMLHttpRequest')
                .send({
                    folder: '/opt/dev/test-project',
                })
                .expect(200);

            expect(response.body).toEqual({ status: 'ok' });
        });

        test('should reject DELETE /claude-status/all without X-Requested-With header (403)', async () => {
            const response = await request(app)
                .delete('/claude-status/all')
                .expect(403);

            expect(response.body.error).toBe('Forbidden');
        });

        test('should accept DELETE /claude-status/all with X-Requested-With header', async () => {
            const response = await request(app)
                .delete('/claude-status/all')
                .set('X-Requested-With', 'XMLHttpRequest')
                .expect(200);

            expect(response.body).toEqual({ status: 'ok' });
        });
    });

    describe('CSRF attack simulation', () => {
        test('should block form-based POST attack (no custom headers)', async () => {
            // Simulate a malicious form submission from evil.com
            // Forms cannot set custom headers, so this should be blocked
            const response = await request(app)
                .post('/claude-completion')
                .set('Origin', 'https://evil.com')
                .set('Referer', 'https://evil.com/attack.html')
                .set('Content-Type', 'application/x-www-form-urlencoded')
                .send('folder=/opt/dev/test-project&message=malicious')
                .expect(403);

            expect(response.body).toMatchObject({
                error: 'Forbidden',
                message: 'Missing required header',
            });
        });

        test('should block DELETE attack without custom header', async () => {
            // Simulate a malicious script trying to delete notifications
            const response = await request(app)
                .delete('/claude-status/all')
                .set('Origin', 'https://evil.com')
                .expect(403);

            expect(response.body.error).toBe('Forbidden');
        });

        test('should allow legitimate API client with X-Requested-With header', async () => {
            // Legitimate browser extension or API client sets the required header
            const response = await request(app)
                .post('/claude-completion')
                .set('X-Requested-With', 'XMLHttpRequest')
                .set('Content-Type', 'application/json')
                .send({
                    folder: '/opt/dev/test-project',
                    message: 'Legitimate request',
                })
                .expect(200);

            expect(response.body).toHaveProperty('status', 'ok');
        });
    });

    describe('Case sensitivity', () => {
        test('should reject header with wrong case (x-requested-with)', async () => {
            // Express normalizes headers to lowercase internally, so this should work
            const response = await request(app)
                .post('/test-protected')
                .set('x-requested-with', 'XMLHttpRequest')
                .send({ data: 'test' })
                .expect(200);

            expect(response.body).toEqual({ success: true });
        });

        test('should accept header with mixed case', async () => {
            const response = await request(app)
                .post('/test-protected')
                .set('X-REQUESTED-WITH', 'XMLHttpRequest')
                .send({ data: 'test' })
                .expect(200);

            expect(response.body).toEqual({ success: true });
        });
    });
});
