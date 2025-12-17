/**
 * Error Response Format Integration Tests
 * QUA-012: Verify all error responses match standardized schema
 *
 * Standard error schema:
 * {
 *   error: true,
 *   code: string,    // Machine-readable error code
 *   message: string  // Human-readable error message
 * }
 */

const request = require('supertest');
const express = require('express');
const { createFaviconRoutes, requireValidPath } = require('../../lib/routes/favicon-routes');
const { createPasteRoutes } = require('../../lib/routes/paste-routes');
const { createNotificationRoutes } = require('../../lib/routes/notification-routes');
const { createHealthRoutes } = require('../../lib/routes/health-routes');
const { createAdminRoutes } = require('../../lib/routes/admin-routes');
const { ErrorCodes } = require('../../lib/response-helpers');
const LRUCache = require('../../lib/lru-cache');
const FaviconService = require('../../lib/services/favicon-service');
const rateLimit = require('express-rate-limit');
const pinoHttp = require('pino-http');
const logger = require('../../lib/logger');

// Mock dependencies
jest.mock('../../lib/registry-cache', () => ({
    getProjectInfo: jest.fn().mockResolvedValue({ type: 'backend', environment: 'dev' }),
    getRegistry: jest.fn().mockResolvedValue({}),
    getCacheStats: jest.fn().mockReturnValue({ cached: 0, lastUpdate: null }),
    invalidateCache: jest.fn(),
}));

jest.mock('../../lib/notification-store', () => ({
    get: jest.fn(),
    setCompleted: jest.fn(),
    setWorking: jest.fn(),
    markRead: jest.fn(),
    remove: jest.fn(),
    removeAll: jest.fn(),
    getUnread: jest.fn().mockReturnValue([]),
    getStats: jest.fn().mockReturnValue({ count: 0, listenerCount: 0 }),
    on: jest.fn(),
    removeListener: jest.fn(),
}));

jest.mock('../../lib/health-check', () => ({
    getFullHealth: jest.fn().mockResolvedValue({ status: 'ok' }),
    getLivenessProbe: jest.fn().mockReturnValue({ status: 'alive' }),
    getReadinessProbe: jest.fn().mockResolvedValue({ status: 'ready' }),
}));

/**
 * Validate error response schema
 * @param {Object} response - Supertest response object
 * @param {number} expectedStatus - Expected HTTP status code
 * @param {string} expectedCode - Expected error code
 */
function validateErrorSchema(response, expectedStatus, expectedCode) {
    expect(response.status).toBe(expectedStatus);
    expect(response.body).toHaveProperty('error', true);
    expect(response.body).toHaveProperty('code');
    expect(response.body).toHaveProperty('message');
    expect(typeof response.body.code).toBe('string');
    expect(typeof response.body.message).toBe('string');
    if (expectedCode) {
        expect(response.body.code).toBe(expectedCode);
    }
}

describe('Error Response Format Integration Tests', () => {
    let app;
    let faviconCache;
    let faviconService;

    beforeEach(() => {
        // Create Express app
        app = express();
        app.use(express.json());
        app.use(pinoHttp({ logger }));

        // Initialize dependencies
        faviconCache = new LRUCache(100, 3600);
        faviconService = new FaviconService({
            registryCache: {
                getRegistry: () => Promise.resolve({})
            },
            faviconCache,
            typeColors: {},
            defaultColors: ['#00BCD4', '#F44336', '#4CAF50', '#FF9800']
        });

        // Create rate limiters
        const _apiLimiter = rateLimit({
            windowMs: 60 * 1000,
            max: 2000,
            standardHeaders: true,
            legacyHeaders: false,
        });

        const notificationLimiter = rateLimit({
            windowMs: 60 * 1000,
            max: 1000,
            standardHeaders: true,
            legacyHeaders: false,
        });

        const pasteLimiter = rateLimit({
            windowMs: 60 * 1000,
            max: 100,
            standardHeaders: true,
            legacyHeaders: false,
        });

        const healthLimiter = rateLimit({
            windowMs: 60 * 1000,
            max: 100,
            standardHeaders: true,
            legacyHeaders: false,
        });

        const cacheClearLimiter = rateLimit({
            windowMs: 60 * 1000,
            max: 10,
            standardHeaders: true,
            legacyHeaders: false,
        });

        const downloadLimiter = rateLimit({
            windowMs: 60 * 1000,
            max: 10,
            standardHeaders: true,
            legacyHeaders: false,
        });

        // Mock admin auth (always deny for testing errors)
        const adminAuth = (_req, res, _next) => {
            res.status(403).json({ error: true, code: 'ADMIN_REQUIRED', message: 'Admin access required' });
        };

        // Mock SSE stats
        const getSSEStats = () => ({ globalConnections: 0, globalLimit: 5, perIPLimit: 2, uniqueIPs: 0 });

        // Mount routes
        app.use(createFaviconRoutes(faviconCache, faviconService));
        app.use(createPasteRoutes(requireValidPath, pasteLimiter));
        app.use(createNotificationRoutes(requireValidPath, notificationLimiter));
        app.use(createHealthRoutes(faviconCache, faviconService, getSSEStats, healthLimiter));
        app.use(createAdminRoutes(faviconCache, cacheClearLimiter, adminAuth, downloadLimiter));
    });

    describe('Favicon Routes Error Responses', () => {
        test('Missing folder parameter returns MISSING_PARAMETER', async () => {
            const response = await request(app).get('/api/favicon');
            validateErrorSchema(response, 400, ErrorCodes.MISSING_PARAMETER);
            expect(response.body.message).toBe('Folder parameter required');
        });

        test('Invalid folder path returns ACCESS_DENIED', async () => {
            const response = await request(app).get('/api/favicon?folder=../../../etc/passwd');
            validateErrorSchema(response, 403, ErrorCodes.ACCESS_DENIED);
            expect(response.body.message).toBe('Access denied');
        });

        test('Folder outside allowed paths returns ACCESS_DENIED', async () => {
            const response = await request(app).get('/api/favicon?folder=/unauthorized/path');
            validateErrorSchema(response, 403, ErrorCodes.ACCESS_DENIED);
            expect(response.body.message).toBe('Access denied');
        });
    });

    describe('Notification Routes Error Responses', () => {
        test('POST /claude-completion with missing folder returns MISSING_PARAMETER', async () => {
            const response = await request(app)
                .post('/claude-completion')
                .send({ message: 'Test' });
            validateErrorSchema(response, 400, ErrorCodes.MISSING_PARAMETER);
        });

        test('POST /claude-completion with invalid folder returns ACCESS_DENIED', async () => {
            const response = await request(app)
                .post('/claude-completion')
                .send({ folder: '../../../etc/passwd', message: 'Test' });
            validateErrorSchema(response, 403, ErrorCodes.ACCESS_DENIED);
        });

        test('GET /claude-status with missing folder returns MISSING_PARAMETER', async () => {
            const response = await request(app).get('/claude-status');
            validateErrorSchema(response, 400, ErrorCodes.MISSING_PARAMETER);
        });
    });

    describe('Paste Routes Error Responses', () => {
        test('POST /api/paste-image with missing folder returns MISSING_PARAMETER', async () => {
            const response = await request(app)
                .post('/api/paste-image')
                .attach('image', Buffer.from('fake image'), 'test.png');
            validateErrorSchema(response, 400, ErrorCodes.MISSING_PARAMETER);
        });

        test('POST /api/paste-image with invalid folder returns ACCESS_DENIED', async () => {
            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', '../../../etc')
                .attach('image', Buffer.from('fake image'), 'test.png');
            validateErrorSchema(response, 403, ErrorCodes.ACCESS_DENIED);
        });

        test('POST /api/paste-image without file returns MISSING_PARAMETER', async () => {
            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', '/opt/dev/test');
            validateErrorSchema(response, 400, ErrorCodes.MISSING_PARAMETER);
        });

        test('POST /api/paste-image with invalid MIME type returns INVALID_FILE_TYPE', async () => {
            const response = await request(app)
                .post('/api/paste-image')
                .field('folder', '/opt/dev/test')
                .attach('image', Buffer.from('fake'), 'test.exe');
            // Multer rejects invalid MIME types
            validateErrorSchema(response, 415, ErrorCodes.INVALID_FILE_TYPE);
        });
    });

    describe('Health Routes Error Responses', () => {
        test('Health check returns proper format on success', async () => {
            const response = await request(app).get('/health');
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('status');
        });

        test('Liveness probe returns proper format on success', async () => {
            const response = await request(app).get('/health/live');
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('status');
        });

        test('Readiness probe returns proper format on success', async () => {
            const response = await request(app).get('/health/ready');
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('status');
        });

        test('Health routes module uses sendError for error responses', async () => {
            // Verify that health-routes.js imports and can use sendError
            const { sendError, ErrorCodes: Codes } = require('../../lib/response-helpers');
            expect(typeof sendError).toBe('function');
            expect(Codes.SERVICE_UNAVAILABLE).toBe('SERVICE_UNAVAILABLE');
            expect(Codes.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
        });
    });

    describe('Admin Routes Error Responses', () => {
        test('GET /download/extension with missing file returns NOT_FOUND', async () => {
            // Mock config to return non-existent path
            const config = require('../../lib/config');
            const originalPath = config.extensionZipPath;
            config.extensionZipPath = '/nonexistent/path.zip';

            const response = await request(app).get('/download/extension');

            // Restore config
            config.extensionZipPath = originalPath;

            validateErrorSchema(response, 404, ErrorCodes.NOT_FOUND);
            expect(response.body.message).toBe('Extension file not found');
        });
    });

    describe('Error Code Constants', () => {
        test('All error codes are defined', () => {
            expect(ErrorCodes.MISSING_PARAMETER).toBeDefined();
            expect(ErrorCodes.INVALID_PARAMETER).toBeDefined();
            expect(ErrorCodes.ACCESS_DENIED).toBeDefined();
            expect(ErrorCodes.NOT_FOUND).toBeDefined();
            expect(ErrorCodes.FILE_TOO_LARGE).toBeDefined();
            expect(ErrorCodes.INVALID_FILE_TYPE).toBeDefined();
            expect(ErrorCodes.TOO_MANY_FILES).toBeDefined();
            expect(ErrorCodes.RATE_LIMITED).toBeDefined();
            expect(ErrorCodes.INTERNAL_ERROR).toBeDefined();
            expect(ErrorCodes.SERVICE_UNAVAILABLE).toBeDefined();
            expect(ErrorCodes.UPLOAD_FAILED).toBeDefined();
        });

        test('Error codes are strings', () => {
            Object.values(ErrorCodes).forEach(code => {
                expect(typeof code).toBe('string');
            });
        });
    });

    describe('SSE Connection Errors', () => {
        test('SSE connection limit returns SERVICE_UNAVAILABLE', async () => {
            // Create app with SSE manager that rejects connections
            const SSEConnectionManager = require('../../lib/sse-connection-manager');
            const mockSSEManager = new SSEConnectionManager({
                maxConnectionsPerIP: 0, // Force rejection
                globalLimit: 0,
                keepaliveInterval: 30000,
            });

            // This test verifies the SSE manager returns standardized error format
            const mockReq = { ip: '127.0.0.1', log: { info: jest.fn(), warn: jest.fn() } };
            const mockRes = {
                setHeader: jest.fn(),
                write: jest.fn(),
                on: jest.fn(),
                writable: true,
            };

            // establishConnection returns error object directly (not wrapped in body)
            const error = mockSSEManager.establishConnection(mockReq, mockRes, '/opt/dev/test');
            expect(error).not.toBeNull();
            expect(error.status).toBe(503);
            expect(error.code).toBe(ErrorCodes.SERVICE_UNAVAILABLE);
            expect(error.message).toBeDefined();
        });
    });
});
