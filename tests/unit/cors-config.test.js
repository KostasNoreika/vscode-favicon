/**
 * CORS Configuration Security Tests
 *
 * Tests the CORS middleware to ensure:
 * 1. Only whitelisted origins receive CORS headers
 * 2. Unknown origins are blocked (no CORS headers)
 * 3. Vary: Origin header is set to prevent cache poisoning
 * 4. Preflight requests return 204 No Content
 */

const { corsMiddleware, isOriginAllowed, ALLOWED_ORIGINS } = require('../../lib/cors-config');

describe('CORS Configuration Security', () => {
    describe('Origin Whitelist', () => {
        test('should have expected production origins', () => {
            expect(ALLOWED_ORIGINS).toContain('https://vs.noreika.lt');
            expect(ALLOWED_ORIGINS).toContain('https://favicon-api.noreika.lt');
        });

        test('should have expected development origins', () => {
            expect(ALLOWED_ORIGINS).toContain('http://localhost:8080');
            expect(ALLOWED_ORIGINS).toContain('http://192.168.110.199:8080');
        });

        test('should not be empty', () => {
            expect(ALLOWED_ORIGINS.length).toBeGreaterThan(0);
        });

        test('should not contain wildcard', () => {
            expect(ALLOWED_ORIGINS).not.toContain('*');
        });
    });

    describe('isOriginAllowed', () => {
        test('should allow whitelisted production origin', () => {
            expect(isOriginAllowed('https://vs.noreika.lt')).toBe(true);
        });

        test('should allow whitelisted API subdomain', () => {
            expect(isOriginAllowed('https://favicon-api.noreika.lt')).toBe(true);
        });

        test('should allow whitelisted development origin', () => {
            expect(isOriginAllowed('http://localhost:8080')).toBe(true);
        });

        test('should block unknown origin', () => {
            expect(isOriginAllowed('https://evil.com')).toBe(false);
        });

        test('should block undefined origin', () => {
            expect(isOriginAllowed(undefined)).toBe(false);
        });

        test('should block null origin', () => {
            expect(isOriginAllowed(null)).toBe(false);
        });

        test('should block empty string origin', () => {
            expect(isOriginAllowed('')).toBe(false);
        });
    });

    describe('corsMiddleware - Allowed Origins', () => {
        test('should set CORS headers for whitelisted origin', () => {
            const req = {
                headers: { origin: 'https://vs.noreika.lt' },
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

            expect(res.headers['Access-Control-Allow-Origin']).toBe('https://vs.noreika.lt');
            expect(res.headers['Access-Control-Allow-Methods']).toBeTruthy();
            expect(res.headers['Access-Control-Allow-Headers']).toBeTruthy();
            expect(res.headers['Vary']).toBe('Origin');
            expect(nextCalled).toBe(true);
        });

        test('should set correct methods header', () => {
            const req = {
                headers: { origin: 'https://vs.noreika.lt' },
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

            expect(res.headers['Access-Control-Allow-Headers']).toBe('Content-Type');
        });
    });

    describe('corsMiddleware - Blocked Origins', () => {
        test('should NOT set CORS headers for unknown origin', () => {
            const req = {
                headers: { origin: 'https://evil.com' },
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

            expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
            expect(res.headers['Access-Control-Allow-Methods']).toBeUndefined();
            expect(res.headers['Access-Control-Allow-Headers']).toBeUndefined();
            expect(res.headers['Vary']).toBeUndefined();
            expect(nextCalled).toBe(true);
        });

        test('should NOT set CORS headers for missing origin', () => {
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
                headers: { origin: 'https://vs.noreika.lt' },
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
            expect(res.headers['Access-Control-Allow-Origin']).toBe('https://vs.noreika.lt');
        });

        test('should handle OPTIONS preflight for unknown origin without CORS headers', () => {
            const req = {
                headers: { origin: 'https://evil.com' },
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
            expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
        });
    });

    describe('Security: Cache Poisoning Protection', () => {
        test('should always set Vary: Origin header for whitelisted origins', () => {
            const req = {
                headers: { origin: 'https://vs.noreika.lt' },
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

        test('should NOT set Vary header for unknown origins', () => {
            const req = {
                headers: { origin: 'https://evil.com' },
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

    describe('Security: Origin Validation Bypass Attempts', () => {
        test('should block origin with path traversal attempt', () => {
            expect(isOriginAllowed('https://vs.noreika.lt/../evil.com')).toBe(false);
        });

        test('should block origin with encoded characters', () => {
            expect(isOriginAllowed('https://vs.noreika.lt%00.evil.com')).toBe(false);
        });

        test('should block origin with subdomain variation', () => {
            expect(isOriginAllowed('https://fake.vs.noreika.lt')).toBe(false);
        });

        test('should block origin with different protocol', () => {
            expect(isOriginAllowed('http://vs.noreika.lt')).toBe(false);
        });

        test('should block origin with port variation', () => {
            expect(isOriginAllowed('http://localhost:8081')).toBe(false);
        });
    });

    describe('Regression Tests', () => {
        test('should not accept wildcard origin', () => {
            const req = {
                headers: { origin: '*' },
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

        test('should not leak CORS headers via preflight for blocked origins', () => {
            const req = {
                headers: { origin: 'https://attacker.com' },
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

            expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
            expect(res.headers['Access-Control-Allow-Methods']).toBeUndefined();
            expect(res.headers['Access-Control-Allow-Headers']).toBeUndefined();
        });
    });
});
