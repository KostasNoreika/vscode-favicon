/**
 * CORS Configuration Tests
 *
 * Tests the CORS middleware behavior:
 * 1. All origins are allowed (public API for browser extensions)
 * 2. Vary: Origin header is set to ensure proper caching
 * 3. Preflight requests return 204 No Content
 */

const {
    corsMiddleware,
    _testing: { isOriginAllowed },
} = require('../../lib/cors-config');

describe('CORS Configuration', () => {
    describe('isOriginAllowed', () => {
        test('should allow any valid origin string', () => {
            expect(isOriginAllowed('https://example.com')).toBe(true);
            expect(isOriginAllowed('https://vs.noreika.lt')).toBe(true);
            expect(isOriginAllowed('https://vm.paysera.tech')).toBe(true);
            expect(isOriginAllowed('http://localhost:8080')).toBe(true);
        });

        test('should allow chrome extension origin', () => {
            expect(isOriginAllowed('chrome-extension://abcdefghijklmnop')).toBe(true);
        });

        test('should allow firefox extension origin', () => {
            expect(isOriginAllowed('moz-extension://abcdef12-3456-7890-abcd-ef1234567890')).toBe(true);
        });

        test('should reject undefined origin', () => {
            expect(isOriginAllowed(undefined)).toBe(false);
        });

        test('should reject null origin', () => {
            expect(isOriginAllowed(null)).toBe(false);
        });

        test('should reject empty string origin', () => {
            expect(isOriginAllowed('')).toBe(false);
        });

        test('should reject non-string origin', () => {
            expect(isOriginAllowed(123)).toBe(false);
            expect(isOriginAllowed({})).toBe(false);
            expect(isOriginAllowed([])).toBe(false);
        });
    });

    describe('corsMiddleware - All Origins Allowed', () => {
        test('should set CORS headers for any origin', () => {
            const req = {
                headers: { origin: 'https://any-domain.com' },
                method: 'GET',
            };
            const res = {
                headers: {},
                setHeader(key, value) {
                    this.headers[key] = value;
                },
            };
            let nextCalled = false;
            const next = () => {
                nextCalled = true;
            };

            corsMiddleware(req, res, next);

            expect(res.headers['Access-Control-Allow-Origin']).toBe('https://any-domain.com');
            expect(res.headers['Access-Control-Allow-Methods']).toBeTruthy();
            expect(res.headers['Access-Control-Allow-Headers']).toBeTruthy();
            expect(res.headers['Vary']).toBe('Origin');
            expect(nextCalled).toBe(true);
        });

        test('should set correct methods header', () => {
            const req = {
                headers: { origin: 'https://example.com' },
                method: 'GET',
            };
            const res = {
                headers: {},
                setHeader(key, value) {
                    this.headers[key] = value;
                },
            };
            const next = () => {};

            corsMiddleware(req, res, next);

            expect(res.headers['Access-Control-Allow-Methods']).toBe('GET, POST, DELETE, OPTIONS');
        });

        test('should set correct headers header', () => {
            const req = {
                headers: { origin: 'http://localhost:8080' },
                method: 'POST',
            };
            const res = {
                headers: {},
                setHeader(key, value) {
                    this.headers[key] = value;
                },
            };
            const next = () => {};

            corsMiddleware(req, res, next);

            expect(res.headers['Access-Control-Allow-Headers']).toBe('Content-Type, X-Requested-With');
        });

        test('should reflect origin for vm.paysera.tech', () => {
            const req = {
                headers: { origin: 'https://vm.paysera.tech' },
                method: 'GET',
            };
            const res = {
                headers: {},
                setHeader(key, value) {
                    this.headers[key] = value;
                },
            };
            const next = () => {};

            corsMiddleware(req, res, next);

            expect(res.headers['Access-Control-Allow-Origin']).toBe('https://vm.paysera.tech');
        });
    });

    describe('corsMiddleware - Missing Origin', () => {
        test('should NOT set CORS headers when origin header is missing', () => {
            const req = {
                headers: {},
                method: 'GET',
            };
            const res = {
                headers: {},
                setHeader(key, value) {
                    this.headers[key] = value;
                },
            };
            const next = () => {};

            corsMiddleware(req, res, next);

            expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
        });

        test('should NOT set CORS headers for null origin', () => {
            const req = {
                headers: { origin: null },
                method: 'GET',
            };
            const res = {
                headers: {},
                setHeader(key, value) {
                    this.headers[key] = value;
                },
            };
            const next = () => {};

            corsMiddleware(req, res, next);

            expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
        });
    });

    describe('corsMiddleware - Preflight Requests', () => {
        test('should handle OPTIONS preflight with 204 status', () => {
            const req = {
                headers: { origin: 'https://example.com' },
                method: 'OPTIONS',
            };
            const res = {
                headers: {},
                statusCode: null,
                setHeader(key, value) {
                    this.headers[key] = value;
                },
                sendStatus(code) {
                    this.statusCode = code;
                },
            };
            const next = () => {};

            corsMiddleware(req, res, next);

            expect(res.statusCode).toBe(204);
            expect(res.headers['Access-Control-Allow-Origin']).toBe('https://example.com');
        });

        test('should handle OPTIONS preflight for any origin', () => {
            const req = {
                headers: { origin: 'https://any-website.com' },
                method: 'OPTIONS',
            };
            const res = {
                headers: {},
                statusCode: null,
                setHeader(key, value) {
                    this.headers[key] = value;
                },
                sendStatus(code) {
                    this.statusCode = code;
                },
            };
            const next = () => {};

            corsMiddleware(req, res, next);

            expect(res.statusCode).toBe(204);
            expect(res.headers['Access-Control-Allow-Origin']).toBe('https://any-website.com');
        });
    });

    describe('Caching: Vary Header', () => {
        test('should always set Vary: Origin header when origin is present', () => {
            const req = {
                headers: { origin: 'https://example.com' },
                method: 'GET',
            };
            const res = {
                headers: {},
                setHeader(key, value) {
                    this.headers[key] = value;
                },
            };
            const next = () => {};

            corsMiddleware(req, res, next);

            expect(res.headers['Vary']).toBe('Origin');
        });

        test('should NOT set Vary header when origin is missing', () => {
            const req = {
                headers: {},
                method: 'GET',
            };
            const res = {
                headers: {},
                setHeader(key, value) {
                    this.headers[key] = value;
                },
            };
            const next = () => {};

            corsMiddleware(req, res, next);

            expect(res.headers['Vary']).toBeUndefined();
        });
    });
});
