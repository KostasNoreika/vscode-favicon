/**
 * Admin Authentication Integration Tests
 * Tests for lib/middleware/security-middleware.js - createAdminAuth()
 *
 * Coverage areas:
 * - IP-based authentication
 * - API key authentication
 * - Combined IP + API key authentication
 * - Edge cases and security scenarios
 * - Constant-time comparison protection
 * - Header validation
 */

const express = require('express');
const request = require('supertest');

// Clear module cache to allow config mocking
jest.resetModules();

// Mock dependencies before requiring
jest.mock('../../lib/logger');
jest.mock('../../lib/config');

const logger = require('../../lib/logger');
const config = require('../../lib/config');
const { createAdminAuth } = require('../../lib/middleware/security-middleware');

describe('Admin Authentication Integration Tests', () => {
    let app;

    beforeEach(() => {
        app = express();

        // Mock logger
        logger.warn = jest.fn();
        logger.error = jest.fn();
        logger.debug = jest.fn();

        // Setup request logger
        app.use((req, res, next) => {
            req.log = {
                warn: jest.fn(),
                error: jest.fn(),
                debug: jest.fn(),
            };
            next();
        });

        jest.clearAllMocks();
    });

    describe('IP-based Authentication Only', () => {
        beforeEach(() => {
            config.adminIPs = ['127.0.0.1', '::1'];
            config.adminApiKey = null;
        });

        it('should allow request from whitelisted IP', async () => {
            app.use(createAdminAuth());
            app.post('/test', (req, res) => res.json({ success: true }));

            await request(app)
                .post('/test')
                .set('X-Forwarded-For', '127.0.0.1')
                .expect(200);
        });

        it('should block request from non-whitelisted IP', async () => {
            app.use(createAdminAuth());
            app.post('/test', (req, res) => res.json({ success: true }));

            await request(app)
                .post('/test')
                .set('X-Forwarded-For', '192.168.1.100')
                .expect(403);
        });

        it('should allow IPv6 localhost', async () => {
            app.use(createAdminAuth());
            app.post('/test', (req, res) => res.json({ success: true }));

            await request(app)
                .post('/test')
                .set('X-Forwarded-For', '::1')
                .expect(200);
        });

        it('should handle multiple IPs in allowlist', async () => {
            config.adminIPs = ['127.0.0.1', '10.0.0.1', '172.16.0.1'];

            app.use(createAdminAuth());
            app.post('/test', (req, res) => res.json({ success: true }));

            await request(app)
                .post('/test')
                .set('X-Forwarded-For', '10.0.0.1')
                .expect(200);
        });

        it('should block unknown IP when client IP cannot be determined', async () => {
            app.use((req, res, next) => {
                // Simulate inability to determine IP
                Object.defineProperty(req, 'ip', { value: 'unknown', writable: false });
                Object.defineProperty(req, 'connection', { value: null });
                next();
            });

            app.use(createAdminAuth());
            app.post('/test', (req, res) => res.json({ success: true }));

            await request(app)
                .post('/test')
                .expect(403);
        });
    });

    describe('API Key Authentication', () => {
        beforeEach(() => {
            config.adminIPs = ['127.0.0.1'];
            config.adminApiKey = 'test-secret-api-key-12345';
        });

        it('should require both IP and API key when API key is configured', async () => {
            app.use(createAdminAuth());
            app.post('/test', (req, res) => res.json({ success: true }));

            // Correct IP but no API key
            await request(app)
                .post('/test')
                .set('X-Forwarded-For', '127.0.0.1')
                .expect(403);
        });

        it('should accept valid API key via X-API-Key header', async () => {
            app.use(createAdminAuth());
            app.post('/test', (req, res) => res.json({ success: true }));

            await request(app)
                .post('/test')
                .set('X-Forwarded-For', '127.0.0.1')
                .set('X-API-Key', 'test-secret-api-key-12345')
                .expect(200);
        });

        it('should accept valid API key via Authorization Bearer header', async () => {
            app.use(createAdminAuth());
            app.post('/test', (req, res) => res.json({ success: true }));

            await request(app)
                .post('/test')
                .set('X-Forwarded-For', '127.0.0.1')
                .set('Authorization', 'Bearer test-secret-api-key-12345')
                .expect(200);
        });

        it('should reject invalid API key', async () => {
            app.use(createAdminAuth());
            app.post('/test', (req, res) => res.json({ success: true }));

            await request(app)
                .post('/test')
                .set('X-Forwarded-For', '127.0.0.1')
                .set('X-API-Key', 'wrong-key')
                .expect(403);
        });

        it('should reject empty API key', async () => {
            app.use(createAdminAuth());
            app.post('/test', (req, res) => res.json({ success: true }));

            await request(app)
                .post('/test')
                .set('X-Forwarded-For', '127.0.0.1')
                .set('X-API-Key', '')
                .expect(403);
        });

        it('should reject request without API key header', async () => {
            app.use(createAdminAuth());
            app.post('/test', (req, res) => res.json({ success: true }));

            await request(app)
                .post('/test')
                .set('X-Forwarded-For', '127.0.0.1')
                .expect(403);
        });

        it('should reject malformed Authorization header', async () => {
            app.use(createAdminAuth());
            app.post('/test', (req, res) => res.json({ success: true }));

            await request(app)
                .post('/test')
                .set('X-Forwarded-For', '127.0.0.1')
                .set('Authorization', 'Basic some-credentials')
                .expect(403);
        });

        it('should prefer X-API-Key over Authorization header', async () => {
            app.use(createAdminAuth());
            app.post('/test', (req, res) => res.json({ success: true }));

            await request(app)
                .post('/test')
                .set('X-Forwarded-For', '127.0.0.1')
                .set('X-API-Key', 'test-secret-api-key-12345')
                .set('Authorization', 'Bearer wrong-key')
                .expect(200); // Should use X-API-Key
        });
    });

    describe('Security: Constant-Time Comparison', () => {
        beforeEach(() => {
            config.adminIPs = ['127.0.0.1'];
            config.adminApiKey = 'correct-api-key-12345';
        });

        it('should reject API key with different length', async () => {
            app.use(createAdminAuth());
            app.post('/test', (req, res) => res.json({ success: true }));

            await request(app)
                .post('/test')
                .set('X-Forwarded-For', '127.0.0.1')
                .set('X-API-Key', 'short')
                .expect(403);
        });

        it('should reject API key with partial match', async () => {
            app.use(createAdminAuth());
            app.post('/test', (req, res) => res.json({ success: true }));

            await request(app)
                .post('/test')
                .set('X-Forwarded-For', '127.0.0.1')
                .set('X-API-Key', 'correct-api-key-12346') // Last char different
                .expect(403);
        });

        it('should reject API key with prefix match only', async () => {
            app.use(createAdminAuth());
            app.post('/test', (req, res) => res.json({ success: true }));

            await request(app)
                .post('/test')
                .set('X-Forwarded-For', '127.0.0.1')
                .set('X-API-Key', 'correct-api-key')
                .expect(403);
        });

        it('should accept exact match only', async () => {
            app.use(createAdminAuth());
            app.post('/test', (req, res) => res.json({ success: true }));

            await request(app)
                .post('/test')
                .set('X-Forwarded-For', '127.0.0.1')
                .set('X-API-Key', 'correct-api-key-12345')
                .expect(200);
        });
    });

    describe('Combined IP and API Key Requirements', () => {
        beforeEach(() => {
            config.adminIPs = ['127.0.0.1', '10.0.0.1'];
            config.adminApiKey = 'secure-key-abc123';
        });

        it('should require both valid IP and valid API key', async () => {
            app.use(createAdminAuth());
            app.post('/test', (req, res) => res.json({ success: true }));

            await request(app)
                .post('/test')
                .set('X-Forwarded-For', '127.0.0.1')
                .set('X-API-Key', 'secure-key-abc123')
                .expect(200);
        });

        it('should reject valid IP with invalid API key', async () => {
            app.use(createAdminAuth());
            app.post('/test', (req, res) => res.json({ success: true }));

            await request(app)
                .post('/test')
                .set('X-Forwarded-For', '127.0.0.1')
                .set('X-API-Key', 'wrong-key')
                .expect(403);
        });

        it('should reject invalid IP with valid API key', async () => {
            app.use(createAdminAuth());
            app.post('/test', (req, res) => res.json({ success: true }));

            await request(app)
                .post('/test')
                .set('X-Forwarded-For', '192.168.1.1')
                .set('X-API-Key', 'secure-key-abc123')
                .expect(403);
        });

        it('should reject invalid IP and invalid API key', async () => {
            app.use(createAdminAuth());
            app.post('/test', (req, res) => res.json({ success: true }));

            await request(app)
                .post('/test')
                .set('X-Forwarded-For', '192.168.1.1')
                .set('X-API-Key', 'wrong-key')
                .expect(403);
        });

        it('should work with multiple whitelisted IPs', async () => {
            app.use(createAdminAuth());
            app.post('/test', (req, res) => res.json({ success: true }));

            // Test first IP
            await request(app)
                .post('/test')
                .set('X-Forwarded-For', '127.0.0.1')
                .set('X-API-Key', 'secure-key-abc123')
                .expect(200);

            // Test second IP
            await request(app)
                .post('/test')
                .set('X-Forwarded-For', '10.0.0.1')
                .set('X-API-Key', 'secure-key-abc123')
                .expect(200);
        });
    });

    describe('Edge Cases', () => {
        beforeEach(() => {
            config.adminIPs = ['127.0.0.1'];
            config.adminApiKey = 'test-key';
        });

        it('should handle null IP gracefully', async () => {
            app.use((req, res, next) => {
                Object.defineProperty(req, 'ip', { value: null });
                Object.defineProperty(req, 'connection', { value: null });
                next();
            });

            app.use(createAdminAuth());
            app.post('/test', (req, res) => res.json({ success: true }));

            await request(app)
                .post('/test')
                .set('X-API-Key', 'test-key')
                .expect(403);
        });

        it('should handle undefined IP gracefully', async () => {
            app.use((req, res, next) => {
                Object.defineProperty(req, 'ip', { value: undefined });
                Object.defineProperty(req, 'connection', { value: {} });
                next();
            });

            app.use(createAdminAuth());
            app.post('/test', (req, res) => res.json({ success: true }));

            await request(app)
                .post('/test')
                .set('X-API-Key', 'test-key')
                .expect(403);
        });

        it('should handle case-sensitive API keys', async () => {
            config.adminApiKey = 'CaseSensitiveKey';

            app.use(createAdminAuth());
            app.post('/test', (req, res) => res.json({ success: true }));

            // Wrong case
            await request(app)
                .post('/test')
                .set('X-Forwarded-For', '127.0.0.1')
                .set('X-API-Key', 'casesensitivekey')
                .expect(403);

            // Correct case
            await request(app)
                .post('/test')
                .set('X-Forwarded-For', '127.0.0.1')
                .set('X-API-Key', 'CaseSensitiveKey')
                .expect(200);
        });

        it('should handle API key with special characters', async () => {
            config.adminApiKey = 'key-with-special!@#$%^&*()_+chars';

            app.use(createAdminAuth());
            app.post('/test', (req, res) => res.json({ success: true }));

            await request(app)
                .post('/test')
                .set('X-Forwarded-For', '127.0.0.1')
                .set('X-API-Key', 'key-with-special!@#$%^&*()_+chars')
                .expect(200);
        });

        it('should handle API key with whitespace trimming', async () => {
            config.adminApiKey = 'trimmed-key';

            app.use(createAdminAuth());
            app.post('/test', (req, res) => res.json({ success: true }));

            // API key with leading/trailing whitespace should fail
            await request(app)
                .post('/test')
                .set('X-Forwarded-For', '127.0.0.1')
                .set('X-API-Key', ' trimmed-key ')
                .expect(403);
        });

        it('should handle empty admin IPs array', async () => {
            config.adminIPs = [];
            config.adminApiKey = null;

            app.use(createAdminAuth());
            app.post('/test', (req, res) => res.json({ success: true }));

            await request(app)
                .post('/test')
                .set('X-Forwarded-For', '127.0.0.1')
                .expect(403);
        });
    });

    describe('Logging and Monitoring', () => {
        beforeEach(() => {
            config.adminIPs = ['127.0.0.1'];
            config.adminApiKey = 'test-key';
        });

        it('should log warning for unauthorized IP access', async () => {
            app.use(createAdminAuth());
            app.post('/test', (req, res) => res.json({ success: true }));

            await request(app)
                .post('/test')
                .set('X-Forwarded-For', '192.168.1.1')
                .set('X-API-Key', 'test-key')
                .expect(403);

            expect(logger.warn).toHaveBeenCalled();
        });

        it('should log warning for invalid API key', async () => {
            app.use(createAdminAuth());
            app.post('/test', (req, res) => res.json({ success: true }));

            await request(app)
                .post('/test')
                .set('X-Forwarded-For', '127.0.0.1')
                .set('X-API-Key', 'wrong-key')
                .expect(403);

            expect(logger.warn).toHaveBeenCalled();
        });

        it('should log debug on successful API key validation', async () => {
            app.use(createAdminAuth());
            app.post('/test', (req, res) => res.json({ success: true }));

            await request(app)
                .post('/test')
                .set('X-Forwarded-For', '127.0.0.1')
                .set('X-API-Key', 'test-key')
                .expect(200);

            expect(logger.debug).toHaveBeenCalled();
        });

        it('should log error when IP cannot be determined', async () => {
            app.use((req, res, next) => {
                Object.defineProperty(req, 'ip', { value: 'unknown' });
                Object.defineProperty(req, 'connection', { value: null });
                next();
            });

            app.use(createAdminAuth());
            app.post('/test', (req, res) => res.json({ success: true }));

            await request(app)
                .post('/test')
                .set('X-API-Key', 'test-key')
                .expect(403);

            expect(logger.error).toHaveBeenCalled();
        });
    });

    describe('Response Format', () => {
        beforeEach(() => {
            config.adminIPs = ['127.0.0.1'];
            config.adminApiKey = null;
        });

        it('should return JSON error for unauthorized access', async () => {
            app.use(createAdminAuth());
            app.post('/test', (req, res) => res.json({ success: true }));

            const response = await request(app)
                .post('/test')
                .set('X-Forwarded-For', '192.168.1.1')
                .expect(403);

            expect(response.body).toEqual({ error: 'Forbidden' });
            expect(response.headers['content-type']).toMatch(/json/);
        });

        it('should return 403 status code for all auth failures', async () => {
            config.adminApiKey = 'test-key';

            app.use(createAdminAuth());
            app.post('/test', (req, res) => res.json({ success: true }));

            // IP failure
            await request(app)
                .post('/test')
                .set('X-Forwarded-For', '192.168.1.1')
                .set('X-API-Key', 'test-key')
                .expect(403);

            // API key failure
            await request(app)
                .post('/test')
                .set('X-Forwarded-For', '127.0.0.1')
                .set('X-API-Key', 'wrong-key')
                .expect(403);
        });
    });
});
