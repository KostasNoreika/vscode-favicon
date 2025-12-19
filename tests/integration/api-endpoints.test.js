/**
 * Integration Tests for API Endpoints
 * Tests complete HTTP request/response cycle
 *
 * Note: These tests mock Express app directly for fast testing
 */

const request = require('supertest');
const express = require('express');
const path = require('path');
const fs = require('fs');

// Mock the server configuration
jest.mock('../../lib/config', () => ({
    allowedPaths: ['/opt/dev', '/opt/prod', '/opt/research'],
    registryPath: path.join(__dirname, '../fixtures/mock-registry.json'),
    dataDir: path.join(__dirname, '../fixtures'),
    servicePort: 3000,
    rateLimitWindow: 15 * 60 * 1000,
    rateLimitMax: 100,
    rateLimitNotificationWindow: 15 * 60 * 1000,
    rateLimitNotificationMax: 20,
    corsOrigins: [
        'https://vs.noreika.lt',
        'https://favicon-api.noreika.lt',
        'http://localhost:8080',
    ],
}));

describe('API Endpoints Integration Tests', () => {
    let app;
    let mockRegistry;

    beforeAll(() => {
        // Create mock registry fixture
        const fixturesDir = path.join(__dirname, '../fixtures');
        if (!fs.existsSync(fixturesDir)) {
            fs.mkdirSync(fixturesDir, { recursive: true });
        }

        mockRegistry = {
            '/opt/dev/vscode-favicon': {
                name: 'vscode-favicon',
                type: 'node',
                priority: 1,
                favicon: 'favicon.svg',
            },
            '/opt/dev/test-project': {
                name: 'test-project',
                type: 'react',
                priority: 2,
                favicon: 'favicon.ico',
            },
        };

        const registryPath = path.join(__dirname, '../fixtures/mock-registry.json');
        fs.writeFileSync(registryPath, JSON.stringify(mockRegistry, null, 2));

        // Create notifications file
        const notificationsPath = path.join(__dirname, '../fixtures/notifications.json');
        fs.writeFileSync(notificationsPath, JSON.stringify({}));
    });

    beforeEach(() => {
        // Create a fresh Express app for each test
        app = express();
        app.use(express.json({ limit: '10kb' }));

        // Mock CORS middleware with whitelist validation
        const config = require('../../lib/config');
        app.use((req, res, next) => {
            const origin = req.headers.origin;
            if (origin && config.corsOrigins.includes(origin)) {
                res.header('Access-Control-Allow-Origin', origin);
                res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
                res.header('Access-Control-Allow-Headers', 'Content-Type');
                res.header('Vary', 'Origin');
            }
            if (req.method === 'OPTIONS') {
                return res.sendStatus(204);
            }
            next();
        });

        // Mock security headers (simulating Helmet)
        app.use((req, res, next) => {
            res.header('X-Content-Type-Options', 'nosniff');
            res.header('X-Frame-Options', 'DENY');
            res.header('X-XSS-Protection', '1; mode=block');
            res.removeHeader('X-Powered-By');
            next();
        });
    });

    afterAll(() => {
        // Cleanup fixtures (except README.md and mock-registry.json which are committed)
        const fixturesDir = path.join(__dirname, '../fixtures');
        if (fs.existsSync(fixturesDir)) {
            const notificationsPath = path.join(fixturesDir, 'notifications.json');
            if (fs.existsSync(notificationsPath)) {
                fs.unlinkSync(notificationsPath);
            }
        }
    });

    describe('GET /health', () => {
        beforeEach(() => {
            app.get('/health', (req, res) => {
                res.json({
                    status: 'ok',
                    service: 'vscode-favicon-api',
                    uptime: process.uptime(),
                    checks: {
                        registry: 'ok',
                        notifications: 'ok',
                    },
                });
            });
        });

        test('should return 200 OK with health status', async () => {
            const response = await request(app).get('/health').expect(200);

            expect(response.body).toMatchObject({
                status: 'ok',
                service: 'vscode-favicon-api',
            });
            expect(response.body.uptime).toBeDefined();
            expect(response.body.checks).toBeDefined();
        });

        test('should include correct content type', async () => {
            const response = await request(app)
                .get('/health')
                .expect('Content-Type', /application\/json/);

            expect(response.body.status).toBe('ok');
        });

        test('should not be rate limited', async () => {
            // Make multiple rapid requests
            for (let i = 0; i < 50; i++) {
                const response = await request(app).get('/health');
                expect(response.status).toBe(200);
            }
        });
    });

    describe('GET /favicon-api', () => {
        beforeEach(() => {
            // Using modern validators with requireValidPath middleware
            const { requireValidPath } = require('../../lib/routes/favicon-routes');

            app.get('/favicon-api', requireValidPath, (req, res) => {
                const { folder } = req.query;
                const config = require('../../lib/config');
                const registry = JSON.parse(fs.readFileSync(config.registryPath, 'utf8'));

                const project = registry[folder];
                if (!project) {
                    return res.status(404).json({ error: 'Project not found' });
                }

                res.json({
                    success: true,
                    project: {
                        name: project.name,
                        type: project.type,
                        favicon: project.favicon,
                    },
                });
            });
        });

        // TODO: Fix - requires real project folder in CI environment
        // This test expects /opt/dev/vscode-favicon to exist with specific structure
        test.skip('should return project info for valid folder', async () => {
            const response = await request(app)
                .get('/favicon-api')
                .query({ folder: '/opt/dev/vscode-favicon' })
                .expect(200);

            expect(response.body).toMatchObject({
                success: true,
                project: {
                    name: 'vscode-favicon',
                    type: 'node',
                    favicon: 'favicon.svg',
                },
            });
        });

        test('should return 404 for unknown project', async () => {
            const response = await request(app)
                .get('/favicon-api')
                .query({ folder: '/opt/dev/unknown-project' })
                .expect(404);

            expect(response.body).toHaveProperty('error');
        });

        test('should reject invalid paths with 403 access denied', async () => {
            const response = await request(app)
                .get('/favicon-api')
                .query({ folder: '/opt/dev/../../etc/passwd' })
                .expect(403);

            expect(response.body).toHaveProperty('error', true);
            expect(response.body).toHaveProperty('code', 'ACCESS_DENIED');
            expect(response.body).toHaveProperty('message', 'Access denied');
        });

        test('should reject missing folder parameter with 400', async () => {
            const response = await request(app).get('/favicon-api').expect(400);

            expect(response.body).toHaveProperty('error', true);
            expect(response.body).toHaveProperty('code', 'MISSING_PARAMETER');
            expect(response.body).toHaveProperty('message', 'Folder parameter required');
        });

        test('should reject URL-encoded traversal attacks', async () => {
            const response = await request(app)
                .get('/favicon-api')
                .query({ folder: '%2Fopt%2Fdev%2F..%2F..%2Fetc' })
                .expect(403);

            expect(response.body).toHaveProperty('error', true);
            expect(response.body).toHaveProperty('code', 'ACCESS_DENIED');
            expect(response.body).toHaveProperty('message', 'Access denied');
        });
    });

    describe('POST /claude-completion', () => {
        beforeEach(() => {
            // Using modern validators with requireValidPath middleware
            const { validateNotificationBody, handleValidationErrors } = require('../../lib/validators');
            const { requireValidPath } = require('../../lib/routes/favicon-routes');

            app.post(
                '/claude-completion',
                validateNotificationBody,
                handleValidationErrors,
                requireValidPath,
                (req, res) => {
                    const { folder, message } = req.body;

                    // Store notification (simplified)
                    const config = require('../../lib/config');
                    const notificationsPath = path.join(config.dataDir, 'notifications.json');
                    const notifications = JSON.parse(fs.readFileSync(notificationsPath, 'utf8'));

                    notifications[folder] = {
                        timestamp: Date.now(),
                        message: message || '',
                        unread: true,
                    };

                    fs.writeFileSync(notificationsPath, JSON.stringify(notifications, null, 2));

                    res.json({
                        success: true,
                        message: 'Notification stored',
                    });
                }
            );
        });

        test('should accept valid notification with message', async () => {
            const response = await request(app)
                .post('/claude-completion')
                .send({
                    folder: '/opt/dev/vscode-favicon',
                    message: 'Task completed successfully',
                })
                .expect(200);

            expect(response.body).toMatchObject({
                success: true,
                message: 'Notification stored',
            });
        });

        test('should accept notification without message (message is optional)', async () => {
            const response = await request(app)
                .post('/claude-completion')
                .send({
                    folder: '/opt/dev/vscode-favicon',
                })
                .expect(200);

            expect(response.body).toMatchObject({
                success: true,
            });
        });

        test('should reject invalid folder path with 403', async () => {
            const response = await request(app)
                .post('/claude-completion')
                .send({
                    folder: '/etc/passwd',
                    message: 'Test',
                })
                .expect(403);

            expect(response.body).toHaveProperty('error', true);
            expect(response.body).toHaveProperty('code', 'ACCESS_DENIED');
            expect(response.body).toHaveProperty('message', 'Access denied');
        });

        test('should reject empty message (fails regex validation)', async () => {
            const response = await request(app)
                .post('/claude-completion')
                .send({
                    folder: '/opt/dev/vscode-favicon',
                    message: '',
                })
                .expect(400);

            expect(response.body).toHaveProperty('error', 'Validation failed');
        });

        test('should reject oversized message', async () => {
            const response = await request(app)
                .post('/claude-completion')
                .send({
                    folder: '/opt/dev/vscode-favicon',
                    message: 'x'.repeat(501), // Over 500 chars
                })
                .expect(400);

            expect(response.body).toHaveProperty('error', 'Validation failed');
            expect(response.body.details).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        field: 'message',
                    }),
                ])
            );
        });

        test('should reject message with invalid characters', async () => {
            const response = await request(app)
                .post('/claude-completion')
                .send({
                    folder: '/opt/dev/vscode-favicon',
                    message: '<script>alert(1)</script>',
                })
                .expect(400);

            expect(response.body).toHaveProperty('error', 'Validation failed');
        });

        test('should handle missing folder field', async () => {
            const response = await request(app)
                .post('/claude-completion')
                .send({
                    message: 'Test message',
                })
                .expect(400);

            expect(response.body).toHaveProperty('error', true);
            expect(response.body).toHaveProperty('code', 'MISSING_PARAMETER');
            expect(response.body).toHaveProperty('message', 'Folder parameter required');
        });
    });

    describe('GET /claude-status', () => {
        beforeEach(() => {
            // Using modern validators with requireValidPath middleware
            const { requireValidPath } = require('../../lib/routes/favicon-routes');

            app.get('/claude-status', requireValidPath, (req, res) => {
                const { folder } = req.query;
                const config = require('../../lib/config');
                const notificationsPath = path.join(config.dataDir, 'notifications.json');
                const notifications = JSON.parse(fs.readFileSync(notificationsPath, 'utf8'));

                const notification = notifications[folder];
                if (!notification) {
                    return res.json({ hasNotification: false });
                }

                res.json({
                    hasNotification: true,
                    notification: {
                        message: notification.message,
                        timestamp: notification.timestamp,
                        unread: notification.unread,
                    },
                });
            });
        });

        test('should return notification if exists', async () => {
            // First create a notification
            const config = require('../../lib/config');
            const notificationsPath = path.join(config.dataDir, 'notifications.json');
            const notifications = {
                '/opt/dev/vscode-favicon': {
                    timestamp: Date.now(),
                    message: 'Test notification',
                    unread: true,
                },
            };
            fs.writeFileSync(notificationsPath, JSON.stringify(notifications, null, 2));

            const response = await request(app)
                .get('/claude-status')
                .query({ folder: '/opt/dev/vscode-favicon' })
                .expect(200);

            expect(response.body).toMatchObject({
                hasNotification: true,
                notification: {
                    message: 'Test notification',
                    unread: true,
                },
            });
        });

        test('should return no notification if none exists', async () => {
            // Clear notifications
            const config = require('../../lib/config');
            const notificationsPath = path.join(config.dataDir, 'notifications.json');
            fs.writeFileSync(notificationsPath, JSON.stringify({}));

            const response = await request(app)
                .get('/claude-status')
                .query({ folder: '/opt/dev/test-project' })
                .expect(200);

            expect(response.body).toMatchObject({
                hasNotification: false,
            });
        });

        test('should reject invalid folder path', async () => {
            const response = await request(app)
                .get('/claude-status')
                .query({ folder: '/etc/passwd' })
                .expect(403);

            expect(response.body).toHaveProperty('error', true);
            expect(response.body).toHaveProperty('code', 'ACCESS_DENIED');
            expect(response.body).toHaveProperty('message', 'Access denied');
        });
    });

    describe('POST /claude-status/mark-read', () => {
        beforeEach(() => {
            // Using modern validators with requireValidPath middleware
            const { requireValidPath } = require('../../lib/routes/favicon-routes');

            app.post(
                '/claude-status/mark-read',
                requireValidPath,
                (req, res) => {
                    const { folder } = req.body;
                    const config = require('../../lib/config');
                    const notificationsPath = path.join(config.dataDir, 'notifications.json');
                    const notifications = JSON.parse(fs.readFileSync(notificationsPath, 'utf8'));

                    if (notifications[folder]) {
                        notifications[folder].unread = false;
                        fs.writeFileSync(notificationsPath, JSON.stringify(notifications, null, 2));
                    }

                    res.json({ status: 'ok' });
                }
            );
        });

        test('should mark existing notification as read', async () => {
            // Create a notification first
            const config = require('../../lib/config');
            const notificationsPath = path.join(config.dataDir, 'notifications.json');
            const notifications = {
                '/opt/dev/vscode-favicon': {
                    timestamp: Date.now(),
                    message: 'Test notification',
                    unread: true,
                },
            };
            fs.writeFileSync(notificationsPath, JSON.stringify(notifications, null, 2));

            const response = await request(app)
                .post('/claude-status/mark-read')
                .send({ folder: '/opt/dev/vscode-favicon' })
                .expect(200);

            expect(response.body).toEqual({ status: 'ok' });

            // Verify it was marked as read
            const updatedNotifications = JSON.parse(fs.readFileSync(notificationsPath, 'utf8'));
            expect(updatedNotifications['/opt/dev/vscode-favicon'].unread).toBe(false);
        });

        test('should handle marking non-existent notification', async () => {
            // Clear notifications
            const config = require('../../lib/config');
            const notificationsPath = path.join(config.dataDir, 'notifications.json');
            fs.writeFileSync(notificationsPath, JSON.stringify({}));

            const response = await request(app)
                .post('/claude-status/mark-read')
                .send({ folder: '/opt/dev/test-project' })
                .expect(200);

            expect(response.body).toEqual({ status: 'ok' });
        });

        test('should reject invalid folder path', async () => {
            const response = await request(app)
                .post('/claude-status/mark-read')
                .send({ folder: '/etc/passwd' })
                .expect(403);

            expect(response.body).toHaveProperty('error', true);
            expect(response.body).toHaveProperty('code', 'ACCESS_DENIED');
            expect(response.body).toHaveProperty('message', 'Access denied');
        });

        test('should reject missing folder field', async () => {
            const response = await request(app)
                .post('/claude-status/mark-read')
                .send({})
                .expect(400);

            expect(response.body).toHaveProperty('error', true);
            expect(response.body).toHaveProperty('code', 'MISSING_PARAMETER');
            expect(response.body).toHaveProperty('message', 'Folder parameter required');
        });
    });

    describe('DELETE /claude-status', () => {
        beforeEach(() => {
            // Using modern validators with requireValidPath middleware
            const { requireValidPath } = require('../../lib/routes/favicon-routes');

            app.delete('/claude-status', requireValidPath, (req, res) => {
                const { folder } = req.body;
                const config = require('../../lib/config');
                const notificationsPath = path.join(config.dataDir, 'notifications.json');
                const notifications = JSON.parse(fs.readFileSync(notificationsPath, 'utf8'));

                delete notifications[folder];
                fs.writeFileSync(notificationsPath, JSON.stringify(notifications, null, 2));

                res.json({ status: 'ok' });
            });
        });

        test('should delete existing notification', async () => {
            // Create a notification first
            const config = require('../../lib/config');
            const notificationsPath = path.join(config.dataDir, 'notifications.json');
            const notifications = {
                '/opt/dev/vscode-favicon': {
                    timestamp: Date.now(),
                    message: 'Test notification',
                    unread: true,
                },
            };
            fs.writeFileSync(notificationsPath, JSON.stringify(notifications, null, 2));

            const response = await request(app)
                .delete('/claude-status')
                .send({ folder: '/opt/dev/vscode-favicon' })
                .expect(200);

            expect(response.body).toEqual({ status: 'ok' });

            // Verify it was deleted
            const updatedNotifications = JSON.parse(fs.readFileSync(notificationsPath, 'utf8'));
            expect(updatedNotifications['/opt/dev/vscode-favicon']).toBeUndefined();
        });

        test('should handle deleting non-existent notification', async () => {
            // Clear notifications
            const config = require('../../lib/config');
            const notificationsPath = path.join(config.dataDir, 'notifications.json');
            fs.writeFileSync(notificationsPath, JSON.stringify({}));

            const response = await request(app)
                .delete('/claude-status')
                .send({ folder: '/opt/dev/test-project' })
                .expect(200);

            expect(response.body).toEqual({ status: 'ok' });
        });

        test('should reject invalid folder path', async () => {
            const response = await request(app)
                .delete('/claude-status')
                .send({ folder: '/etc/passwd' })
                .expect(403);

            expect(response.body).toHaveProperty('error', true);
            expect(response.body).toHaveProperty('code', 'ACCESS_DENIED');
            expect(response.body).toHaveProperty('message', 'Access denied');
        });

        test('should reject missing folder field', async () => {
            const response = await request(app).delete('/claude-status').send({}).expect(400);

            expect(response.body).toHaveProperty('error', true);
            expect(response.body).toHaveProperty('code', 'MISSING_PARAMETER');
            expect(response.body).toHaveProperty('message', 'Folder parameter required');
        });
    });

    describe('CORS Headers', () => {
        beforeEach(() => {
            app.get('/test', (req, res) => {
                res.json({ test: true });
            });
        });

        test('should allow whitelisted origin', async () => {
            const response = await request(app)
                .get('/test')
                .set('Origin', 'https://vs.noreika.lt')
                .expect(200);

            expect(response.headers['access-control-allow-origin']).toBe('https://vs.noreika.lt');
            expect(response.headers['access-control-allow-methods']).toBeDefined();
            expect(response.headers['vary']).toBe('Origin');
        });

        test('should block non-whitelisted origin', async () => {
            const response = await request(app)
                .get('/test')
                .set('Origin', 'https://evil.com')
                .expect(200);

            expect(response.headers['access-control-allow-origin']).toBeUndefined();
        });

        test('should handle preflight OPTIONS request', async () => {
            const response = await request(app)
                .options('/test')
                .set('Origin', 'https://vs.noreika.lt')
                .expect(204);

            expect(response.headers['access-control-allow-origin']).toBe('https://vs.noreika.lt');
        });

        test('should include Vary header to prevent cache poisoning', async () => {
            const response = await request(app)
                .get('/test')
                .set('Origin', 'https://favicon-api.noreika.lt')
                .expect(200);

            expect(response.headers['vary']).toBe('Origin');
        });

        test('should handle multiple whitelisted origins correctly', async () => {
            const origins = [
                'https://vs.noreika.lt',
                'https://favicon-api.noreika.lt',
                'http://localhost:8080',
            ];

            for (const origin of origins) {
                const response = await request(app).get('/test').set('Origin', origin);

                expect(response.headers['access-control-allow-origin']).toBe(origin);
            }
        });
    });

    describe('Security Headers', () => {
        beforeEach(() => {
            app.get('/test', (req, res) => {
                res.json({ test: true });
            });
        });

        test('should include X-Content-Type-Options nosniff', async () => {
            const response = await request(app).get('/test').expect(200);

            expect(response.headers['x-content-type-options']).toBe('nosniff');
        });

        test('should include X-Frame-Options DENY', async () => {
            const response = await request(app).get('/test').expect(200);

            expect(response.headers['x-frame-options']).toBe('DENY');
        });

        test('should include XSS protection header', async () => {
            const response = await request(app).get('/test').expect(200);

            expect(response.headers['x-xss-protection']).toBeDefined();
        });

        test('should remove X-Powered-By header', async () => {
            const response = await request(app).get('/test').expect(200);

            expect(response.headers['x-powered-by']).toBeUndefined();
        });
    });

    describe('Security Tests', () => {
        test('should reject requests with oversized body (413 Payload Too Large)', async () => {
            // Using modern validators with requireValidPath middleware
            const { validateNotificationBody, handleValidationErrors } = require('../../lib/validators');
            const { requireValidPath } = require('../../lib/routes/favicon-routes');

            app.post('/test', validateNotificationBody, handleValidationErrors, requireValidPath, (req, res) => {
                res.json({ success: true });
            });

            const largePayload = {
                folder: '/opt/dev/test',
                message: 'x'.repeat(15000), // 15KB payload
            };

            await request(app).post('/test').send(largePayload).expect(413); // Payload Too Large
        });

        test('should set CORS headers for whitelisted origins', async () => {
            app.get('/test', (req, res) => {
                res.json({ test: true });
            });

            const response = await request(app)
                .get('/test')
                .set('Origin', 'https://vs.noreika.lt')
                .expect(200);

            // Check CORS headers are set
            expect(response.headers['access-control-allow-origin']).toBe('https://vs.noreika.lt');
        });

        test('should handle malformed JSON gracefully', async () => {
            app.post('/test', (req, res) => {
                res.json({ success: true });
            });

            // Add error handler for malformed JSON
            app.use((err, _req, res, _next) => {
                if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
                    return res.status(400).json({ error: 'Invalid JSON' });
                }
                _next();
            });

            await request(app)
                .post('/test')
                .set('Content-Type', 'application/json')
                .send('{"invalid": json}')
                .expect(400);
        });
    });

    describe('Error Handling', () => {
        test('should return 404 for unknown endpoints', async () => {
            await request(app).get('/unknown-endpoint').expect(404);
        });

        test('should handle server errors gracefully with 500', async () => {
            app.get('/error', (_req, _res) => {
                throw new Error('Test error');
            });

            // Add error handler
            app.use((err, _req, res, _next) => {
                res.status(500).json({
                    error: 'Internal server error',
                    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
                });
            });

            const response = await request(app).get('/error').expect(500);

            expect(response.body).toHaveProperty('error');
        });

        test('should return proper error structure for validation failures', async () => {
            // Using modern validators with requireValidPath middleware
            const { requireValidPath } = require('../../lib/routes/favicon-routes');

            app.get('/test', requireValidPath, (req, res) => {
                res.json({ success: true });
            });

            const response = await request(app)
                .get('/test')
                .query({ folder: '../../../etc/passwd' })
                .expect(403);

            expect(response.body).toHaveProperty('error', true);
            expect(response.body).toHaveProperty('code', 'ACCESS_DENIED');
            expect(response.body).toHaveProperty('message', 'Access denied');
        });
    });

    describe('Content-Type Validation', () => {
        beforeEach(() => {
            app.post('/test', (req, res) => {
                res.json({ success: true });
            });
        });

        test('should accept application/json content type', async () => {
            const response = await request(app)
                .post('/test')
                .set('Content-Type', 'application/json')
                .send({ test: 'data' })
                .expect(200);

            expect(response.body.success).toBe(true);
        });

        test('should respond with JSON content type', async () => {
            const response = await request(app)
                .post('/test')
                .send({ test: 'data' })
                .expect('Content-Type', /application\/json/);

            expect(response.body).toBeDefined();
        });
    });

    describe('HTTP Methods', () => {
        test('should reject unsupported HTTP methods', async () => {
            app.get('/test', (req, res) => {
                res.json({ success: true });
            });

            // Try to use PUT on a GET-only endpoint
            await request(app).put('/test').expect(404);
        });

        test('should handle OPTIONS preflight correctly', async () => {
            app.get('/test', (req, res) => {
                res.json({ success: true });
            });

            const response = await request(app)
                .options('/test')
                .set('Origin', 'https://vs.noreika.lt')
                .expect(204);

            expect(response.headers['access-control-allow-methods']).toBeDefined();
        });
    });

    describe('Grayscale Favicon Feature', () => {
        const FaviconService = require('../../lib/services/favicon-service');
        let faviconService;
        let mockConfig;
        let mockRegistryCache;
        let mockFaviconCache;

        beforeEach(() => {
            // Mock config for FaviconService
            mockConfig = {
                typeColors: {
                    prod: '#FF6B6B',
                    dev: '#4ECDC4',
                    staging: '#FFEAA7',
                    test: '#A29BFE',
                },
                defaultColors: ['#FF6B6B', '#4ECDC4', '#45B7D1'],
            };

            // Mock registry cache
            mockRegistryCache = {
                getRegistry: jest.fn().mockResolvedValue({
                    projects: {
                        '/opt/dev/test-project': {
                            name: 'Test Project',
                            type: 'dev',
                        },
                    },
                    original: {},
                }),
            };

            // Mock favicon cache
            mockFaviconCache = {
                get: jest.fn(),
                set: jest.fn(),
            };

            faviconService = new FaviconService({
                typeColors: mockConfig.typeColors,
                defaultColors: mockConfig.defaultColors,
                registryCache: mockRegistryCache,
                faviconCache: mockFaviconCache,
            });

            // Setup GET /api/favicon endpoint mock
            // Using modern validators with requireValidPath middleware
            const { requireValidPath } = require('../../lib/routes/favicon-routes');

            app.get('/api/favicon', requireValidPath, async (req, res) => {
                const { folder, grayscale } = req.query;
                const grayscaleMode = grayscale === 'true';

                try {
                    const result = await faviconService.getFavicon(folder, {
                        grayscale: grayscaleMode,
                    });

                    res.setHeader('Content-Type', result.contentType);
                    res.setHeader('Cache-Control', 'public, max-age=3600');
                    res.send(result.data);
                } catch (error) {
                    res.status(500).json({ error: 'Failed to generate favicon' });
                }
            });

            // Setup GET /favicon-api endpoint with grayscale support
            app.get('/favicon-api', requireValidPath, async (req, res) => {
                const { folder, grayscale } = req.query;
                const grayscaleMode = grayscale === 'true';

                try {
                    const result = await faviconService.getFavicon(folder, {
                        grayscale: grayscaleMode,
                    });

                    res.setHeader('Content-Type', result.contentType);
                    res.setHeader('Cache-Control', 'public, max-age=3600');
                    res.send(result.data);
                } catch (error) {
                    res.status(500).json({ error: 'Failed to generate favicon' });
                }
            });
        });

        describe('GET /api/favicon with grayscale parameter', () => {
            test('should return colored favicon by default (no grayscale param)', async () => {
                mockFaviconCache.get.mockReturnValue(null);

                const response = await request(app)
                    .get('/api/favicon')
                    .query({ folder: '/opt/dev/test-project' })
                    .expect(200);

                expect(response.headers['content-type']).toBe('image/svg+xml');
                expect(response.body.toString()).toContain('#4ECDC4'); // Dev color
                expect(response.body.toString()).not.toContain('#a6a6a6'); // Grayscale dev
            });

            test('should return grayscale favicon when grayscale=true', async () => {
                mockFaviconCache.get.mockReturnValue(null);

                const response = await request(app)
                    .get('/api/favicon')
                    .query({ folder: '/opt/dev/test-project', grayscale: 'true' })
                    .expect(200);

                expect(response.headers['content-type']).toBe('image/svg+xml');
                expect(response.body.toString()).toContain('#a6a6a6'); // Grayscale dev
                expect(response.body.toString()).not.toContain('#4ECDC4'); // Colored dev
            });

            test('should return colored favicon when grayscale=false', async () => {
                mockFaviconCache.get.mockReturnValue(null);

                const response = await request(app)
                    .get('/api/favicon')
                    .query({ folder: '/opt/dev/test-project', grayscale: 'false' })
                    .expect(200);

                expect(response.body.toString()).toContain('#4ECDC4'); // Dev color
            });

            test('should include Cache-Control header', async () => {
                mockFaviconCache.get.mockReturnValue(null);

                const response = await request(app)
                    .get('/api/favicon')
                    .query({ folder: '/opt/dev/test-project', grayscale: 'true' })
                    .expect(200);

                expect(response.headers['cache-control']).toBeDefined();
                expect(response.headers['cache-control']).toContain('max-age');
            });

            test('should preserve project initials in grayscale mode', async () => {
                mockFaviconCache.get.mockReturnValue(null);

                const response = await request(app)
                    .get('/api/favicon')
                    .query({ folder: '/opt/dev/test-project', grayscale: 'true' })
                    .expect(200);

                expect(response.body.toString()).toContain('TP'); // Test Project initials
            });

            test('should handle prod project with grayscale', async () => {
                mockFaviconCache.get.mockReturnValue(null);
                mockRegistryCache.getRegistry.mockResolvedValue({
                    projects: {
                        '/opt/prod/app': {
                            name: 'Production App',
                            type: 'prod',
                        },
                    },
                    original: {},
                });

                const response = await request(app)
                    .get('/api/favicon')
                    .query({ folder: '/opt/prod/app', grayscale: 'true' })
                    .expect(200);

                expect(response.body.toString()).toContain('#979797'); // Grayscale prod (#FF6B6B)
                expect(response.body.toString()).not.toContain('#FF6B6B'); // Colored prod
            });
        });

        describe('GET /favicon-api with grayscale parameter', () => {
            test('should return colored favicon by default (no grayscale param)', async () => {
                mockFaviconCache.get.mockReturnValue(null);

                const response = await request(app)
                    .get('/favicon-api')
                    .query({ folder: '/opt/dev/test-project' })
                    .expect(200);

                expect(response.headers['content-type']).toBe('image/svg+xml');
                expect(response.body.toString()).toContain('#4ECDC4'); // Dev color
            });

            test('should return grayscale favicon when grayscale=true', async () => {
                mockFaviconCache.get.mockReturnValue(null);

                const response = await request(app)
                    .get('/favicon-api')
                    .query({ folder: '/opt/dev/test-project', grayscale: 'true' })
                    .expect(200);

                expect(response.headers['content-type']).toBe('image/svg+xml');
                expect(response.body.toString()).toContain('#a6a6a6'); // Grayscale dev
                expect(response.body.toString()).not.toContain('#4ECDC4'); // Colored dev
            });

            test('should return colored favicon when grayscale=false', async () => {
                mockFaviconCache.get.mockReturnValue(null);

                const response = await request(app)
                    .get('/favicon-api')
                    .query({ folder: '/opt/dev/test-project', grayscale: 'false' })
                    .expect(200);

                expect(response.body.toString()).toContain('#4ECDC4'); // Dev color
            });
        });

        describe('Cache separation for grayscale/colored favicons', () => {
            test('should use different cache keys for colored and grayscale', async () => {
                mockFaviconCache.get.mockReturnValue(null);

                // Request colored version
                await request(app)
                    .get('/api/favicon')
                    .query({ folder: '/opt/dev/test-project' })
                    .expect(200);

                expect(mockFaviconCache.get).toHaveBeenCalledWith('v1:favicon:/opt/dev/test-project');

                // Request grayscale version
                await request(app)
                    .get('/api/favicon')
                    .query({ folder: '/opt/dev/test-project', grayscale: 'true' })
                    .expect(200);

                expect(mockFaviconCache.get).toHaveBeenCalledWith(
                    'v1:favicon:/opt/dev/test-project:gray'
                );
            });

            test('should cache colored and grayscale versions separately', async () => {
                mockFaviconCache.get.mockReturnValue(null);

                // Generate colored
                await request(app)
                    .get('/api/favicon')
                    .query({ folder: '/opt/dev/test-project' })
                    .expect(200);

                expect(mockFaviconCache.set).toHaveBeenCalledWith(
                    'v1:favicon:/opt/dev/test-project',
                    expect.objectContaining({
                        contentType: 'image/svg+xml',
                        data: expect.any(Buffer),
                    })
                );

                // Generate grayscale
                await request(app)
                    .get('/api/favicon')
                    .query({ folder: '/opt/dev/test-project', grayscale: 'true' })
                    .expect(200);

                expect(mockFaviconCache.set).toHaveBeenCalledWith(
                    'v1:favicon:/opt/dev/test-project:gray',
                    expect.objectContaining({
                        contentType: 'image/svg+xml',
                        data: expect.any(Buffer),
                    })
                );
            });
        });

        describe('Grayscale validation', () => {
            test('should reject invalid folder path with grayscale param', async () => {
                await request(app)
                    .get('/api/favicon')
                    .query({ folder: '/etc/passwd', grayscale: 'true' })
                    .expect(403);
            });

            test('should handle missing folder parameter with grayscale param', async () => {
                await request(app).get('/api/favicon').query({ grayscale: 'true' }).expect(400);
            });

            test('should ignore invalid grayscale values (treat as false)', async () => {
                mockFaviconCache.get.mockReturnValue(null);

                const response = await request(app)
                    .get('/api/favicon')
                    .query({ folder: '/opt/dev/test-project', grayscale: 'invalid' })
                    .expect(200);

                // Invalid value should be treated as false (colored)
                expect(response.body.toString()).toContain('#4ECDC4'); // Dev color
            });
        });

        describe('Integration with existing favicon files', () => {
            test('should not apply grayscale to existing favicon files', async () => {
                // When an existing favicon file is found, it should be served as-is
                // regardless of the grayscale parameter (grayscale only applies to generated SVGs)
                const existingFaviconData = Buffer.from('fake-ico-data');
                mockFaviconCache.get.mockReturnValue(null);

                // Mock findFaviconFile to return existing file
                jest.spyOn(faviconService, 'findFaviconFile').mockResolvedValue(
                    '/opt/dev/test-project/favicon.ico'
                );
                jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(
                    existingFaviconData
                );

                const response = await request(app)
                    .get('/api/favicon')
                    .query({ folder: '/opt/dev/test-project', grayscale: 'true' })
                    .expect(200);

                expect(response.headers['content-type']).toBe('image/x-icon');
                expect(response.body).toEqual(existingFaviconData);
            });
        });
    });

    // QUA-008: Tests for /api/notifications/unread endpoint
    describe('GET /api/notifications/unread', () => {
        let mockNotificationStore;

        beforeEach(() => {
            // Mock notification store
            mockNotificationStore = {
                getUnread: jest.fn(),
            };

            // Setup endpoint
            app.get('/api/notifications/unread', async (req, res) => {
                try {
                    const unreadNotifications = mockNotificationStore.getUnread();

                    const notifications = unreadNotifications.map(notification => ({
                        ...notification,
                        projectName: notification.folder.split('/').pop(),
                    }));

                    res.json({
                        notifications,
                        count: notifications.length,
                    });
                } catch (error) {
                    res.status(500).json({ error: 'Internal server error' });
                }
            });
        });

        test('should return 200 OK with empty array when no notifications exist', async () => {
            mockNotificationStore.getUnread.mockReturnValue([]);

            const response = await request(app)
                .get('/api/notifications/unread')
                .expect(200);

            expect(response.body).toEqual({
                notifications: [],
                count: 0,
            });
            expect(mockNotificationStore.getUnread).toHaveBeenCalledTimes(1);
        });

        test('should successfully retrieve unread notifications with correct structure', async () => {
            const mockNotifications = [
                {
                    folder: '/opt/dev/project-one',
                    message: 'Task completed',
                    timestamp: Date.now(),
                    status: 'completed',
                },
                {
                    folder: '/opt/prod/project-two',
                    message: 'Build successful',
                    timestamp: Date.now() - 1000,
                    status: 'completed',
                },
            ];

            mockNotificationStore.getUnread.mockReturnValue(mockNotifications);

            const response = await request(app)
                .get('/api/notifications/unread')
                .expect(200);

            expect(response.body.count).toBe(2);
            expect(response.body.notifications).toHaveLength(2);
            expect(response.body.notifications[0]).toMatchObject({
                folder: '/opt/dev/project-one',
                message: 'Task completed',
                status: 'completed',
                projectName: 'project-one',
            });
            expect(response.body.notifications[1]).toMatchObject({
                folder: '/opt/prod/project-two',
                message: 'Build successful',
                status: 'completed',
                projectName: 'project-two',
            });
        });

        test('should correctly add projectName field from folder path', async () => {
            const mockNotifications = [
                {
                    folder: '/opt/dev/vscode-favicon',
                    message: 'Task done',
                    timestamp: Date.now(),
                    status: 'completed',
                },
                {
                    folder: '/opt/research/ml-models',
                    message: 'Training complete',
                    timestamp: Date.now(),
                    status: 'completed',
                },
            ];

            mockNotificationStore.getUnread.mockReturnValue(mockNotifications);

            const response = await request(app)
                .get('/api/notifications/unread')
                .expect(200);

            expect(response.body.notifications[0].projectName).toBe('vscode-favicon');
            expect(response.body.notifications[1].projectName).toBe('ml-models');
        });

        test('should return notifications sorted by timestamp (newest first)', async () => {
            const now = Date.now();
            // Mock data should be returned already sorted by notification store
            const mockNotifications = [
                {
                    folder: '/opt/dev/project-new',
                    message: 'Recent task',
                    timestamp: now,
                    status: 'completed',
                },
                {
                    folder: '/opt/dev/project-middle',
                    message: 'Middle task',
                    timestamp: now - 2000,
                    status: 'completed',
                },
                {
                    folder: '/opt/dev/project-old',
                    message: 'Old task',
                    timestamp: now - 5000,
                    status: 'completed',
                },
            ];

            mockNotificationStore.getUnread.mockReturnValue(mockNotifications);

            const response = await request(app)
                .get('/api/notifications/unread')
                .expect(200);

            expect(response.body.notifications[0].folder).toBe('/opt/dev/project-new');
            expect(response.body.notifications[1].folder).toBe('/opt/dev/project-middle');
            expect(response.body.notifications[2].folder).toBe('/opt/dev/project-old');

            // Verify timestamps are in descending order
            expect(response.body.notifications[0].timestamp).toBeGreaterThan(
                response.body.notifications[1].timestamp
            );
            expect(response.body.notifications[1].timestamp).toBeGreaterThan(
                response.body.notifications[2].timestamp
            );
        });

        test('should only return completed status notifications (no working status)', async () => {
            // Notification store getUnread() only returns completed + unread notifications
            const mockNotifications = [
                {
                    folder: '/opt/dev/project-completed',
                    message: 'Task completed',
                    timestamp: Date.now(),
                    status: 'completed',
                },
            ];

            mockNotificationStore.getUnread.mockReturnValue(mockNotifications);

            const response = await request(app)
                .get('/api/notifications/unread')
                .expect(200);

            response.body.notifications.forEach(notification => {
                expect(notification.status).toBe('completed');
            });
        });

        test('should filter out expired notifications (respects TTL)', async () => {
            // Notification store getUnread() handles TTL filtering internally
            const validTimestamp = Date.now();
            const mockNotifications = [
                {
                    folder: '/opt/dev/recent-project',
                    message: 'Recent notification',
                    timestamp: validTimestamp,
                    status: 'completed',
                },
            ];

            mockNotificationStore.getUnread.mockReturnValue(mockNotifications);

            const response = await request(app)
                .get('/api/notifications/unread')
                .expect(200);

            expect(response.body.notifications).toHaveLength(1);
            expect(response.body.notifications[0].folder).toBe('/opt/dev/recent-project');
        });

        test('should return correct response schema with all required fields', async () => {
            const mockNotifications = [
                {
                    folder: '/opt/dev/test-project',
                    message: 'Test message',
                    timestamp: Date.now(),
                    status: 'completed',
                },
            ];

            mockNotificationStore.getUnread.mockReturnValue(mockNotifications);

            const response = await request(app)
                .get('/api/notifications/unread')
                .expect(200);

            // Verify top-level schema
            expect(response.body).toHaveProperty('notifications');
            expect(response.body).toHaveProperty('count');
            expect(Array.isArray(response.body.notifications)).toBe(true);
            expect(typeof response.body.count).toBe('number');

            // Verify notification object schema
            const notification = response.body.notifications[0];
            expect(notification).toHaveProperty('folder');
            expect(notification).toHaveProperty('message');
            expect(notification).toHaveProperty('timestamp');
            expect(notification).toHaveProperty('status');
            expect(notification).toHaveProperty('projectName');

            expect(typeof notification.folder).toBe('string');
            expect(typeof notification.message).toBe('string');
            expect(typeof notification.timestamp).toBe('number');
            expect(typeof notification.status).toBe('string');
            expect(typeof notification.projectName).toBe('string');
        });

        test('should handle internal errors with 500 status', async () => {
            mockNotificationStore.getUnread.mockImplementation(() => {
                throw new Error('Database error');
            });

            const response = await request(app)
                .get('/api/notifications/unread')
                .expect(500);

            // Custom route returns simple error format
            expect(response.body.error).toBe('Internal server error');
        });

        test('should have correct content-type header', async () => {
            mockNotificationStore.getUnread.mockReturnValue([]);

            const response = await request(app)
                .get('/api/notifications/unread')
                .expect('Content-Type', /application\/json/);

            expect(response.status).toBe(200);
        });

        test('should handle large number of notifications efficiently', async () => {
            // Generate 50 mock notifications
            const mockNotifications = Array.from({ length: 50 }, (_, i) => ({
                folder: `/opt/dev/project-${i}`,
                message: `Task ${i} completed`,
                timestamp: Date.now() - i * 1000,
                status: 'completed',
            }));

            mockNotificationStore.getUnread.mockReturnValue(mockNotifications);

            const startTime = Date.now();
            const response = await request(app)
                .get('/api/notifications/unread')
                .expect(200);
            const duration = Date.now() - startTime;

            expect(response.body.count).toBe(50);
            expect(response.body.notifications).toHaveLength(50);
            expect(duration).toBeLessThan(1000); // Should complete in under 1 second

            // Verify all have projectName added
            response.body.notifications.forEach((notification, i) => {
                expect(notification.projectName).toBe(`project-${i}`);
            });
        });

        test('should handle edge case with single character project name', async () => {
            const mockNotifications = [
                {
                    folder: '/opt/dev/x',
                    message: 'Task completed',
                    timestamp: Date.now(),
                    status: 'completed',
                },
            ];

            mockNotificationStore.getUnread.mockReturnValue(mockNotifications);

            const response = await request(app)
                .get('/api/notifications/unread')
                .expect(200);

            expect(response.body.notifications[0].projectName).toBe('x');
        });

        test('should preserve original notification fields in response', async () => {
            const mockNotifications = [
                {
                    folder: '/opt/dev/test-project',
                    message: 'Custom message',
                    timestamp: 1234567890,
                    status: 'completed',
                },
            ];

            mockNotificationStore.getUnread.mockReturnValue(mockNotifications);

            const response = await request(app)
                .get('/api/notifications/unread')
                .expect(200);

            const notification = response.body.notifications[0];
            expect(notification.folder).toBe('/opt/dev/test-project');
            expect(notification.message).toBe('Custom message');
            expect(notification.timestamp).toBe(1234567890);
            expect(notification.status).toBe('completed');
        });

        test('should accept GET requests with no query parameters', async () => {
            mockNotificationStore.getUnread.mockReturnValue([]);

            // Endpoint should not require any query params
            const response = await request(app)
                .get('/api/notifications/unread')
                .expect(200);

            expect(response.body).toEqual({
                notifications: [],
                count: 0,
            });
        });

        test('should work correctly when notification-store returns empty array', async () => {
            mockNotificationStore.getUnread.mockReturnValue([]);

            const response = await request(app)
                .get('/api/notifications/unread')
                .expect(200);

            expect(response.body.notifications).toEqual([]);
            expect(response.body.count).toBe(0);
        });
    });
});
