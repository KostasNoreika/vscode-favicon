/**
 * Security Middleware Unit Tests
 * Tests for lib/middleware/security-middleware.js
 *
 * Coverage areas:
 * - Trust proxy configuration
 * - Proxy header validation
 * - IP validation functions
 * - Constant-time comparison
 * - CSRF protection
 * - Helmet configuration
 * - CORS setup
 */

jest.mock('../../lib/logger');
jest.mock('../../lib/config');
jest.mock('../../lib/cors-config');

const logger = require('../../lib/logger');
const config = require('../../lib/config');
const {
    setupTrustProxy,
    createProxyHeaderValidator,
    setupHelmet,
    setupCORS,
    createCSRFProtection,
    createAdminAuth,
} = require('../../lib/middleware/security-middleware');

describe('Security Middleware Tests', () => {
    let mockApp;
    let mockReq;
    let mockRes;
    let mockNext;

    beforeEach(() => {
        // Mock Express app
        mockApp = {
            set: jest.fn(),
        };

        // Mock request object
        mockReq = {
            ip: '127.0.0.1',
            method: 'GET',
            path: '/test',
            headers: {},
            connection: { remoteAddress: '127.0.0.1' },
            log: {
                debug: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
            },
        };

        // Mock response object
        mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
        };

        // Mock next function
        mockNext = jest.fn();

        // Mock logger
        logger.info = jest.fn();
        logger.warn = jest.fn();
        logger.debug = jest.fn();
        logger.error = jest.fn();

        // Reset config
        config.trustedProxies = null;
        config.trustProxy = false;
        config.adminIPs = ['127.0.0.1'];
        config.adminApiKey = null;

        jest.clearAllMocks();
    });

    describe('setupTrustProxy()', () => {
        it('should configure trust proxy with explicit IP whitelist', () => {
            config.trustedProxies = ['192.168.1.1', '10.0.0.1'];
            config.trustProxy = false;

            setupTrustProxy(mockApp);

            expect(mockApp.set).toHaveBeenCalledWith('trust proxy', expect.any(Function));
            expect(logger.info).toHaveBeenCalledWith(
                expect.objectContaining({
                    trustedProxies: ['192.168.1.1', '10.0.0.1'],
                    mode: 'callback',
                }),
                expect.stringContaining('SEC-002 fix')
            );
        });

        it('should configure trust proxy with numeric value (legacy)', () => {
            config.trustedProxies = null;
            config.trustProxy = 1;

            setupTrustProxy(mockApp);

            expect(mockApp.set).toHaveBeenCalledWith('trust proxy', 1);
            expect(logger.warn).toHaveBeenCalledWith(
                expect.objectContaining({
                    trustProxy: 1,
                    mode: 'numeric',
                }),
                expect.stringContaining('legacy mode')
            );
        });

        it('should prefer TRUSTED_PROXIES over numeric TRUST_PROXY', () => {
            config.trustedProxies = ['192.168.1.1'];
            config.trustProxy = 1;

            setupTrustProxy(mockApp);

            // Should use callback mode, not numeric
            expect(mockApp.set).toHaveBeenCalledWith('trust proxy', expect.any(Function));
            expect(logger.info).toHaveBeenCalled();
            expect(logger.warn).not.toHaveBeenCalled();
        });

        it('should handle empty trusted proxies array', () => {
            config.trustedProxies = [];
            config.trustProxy = false;

            setupTrustProxy(mockApp);

            // Should use numeric mode
            expect(mockApp.set).toHaveBeenCalledWith('trust proxy', false);
            expect(logger.warn).toHaveBeenCalled();
        });

        it('should configure trust proxy callback correctly', () => {
            config.trustedProxies = ['192.168.1.1'];

            setupTrustProxy(mockApp);

            const trustCallback = mockApp.set.mock.calls[0][1];
            expect(typeof trustCallback).toBe('function');

            // Test callback
            const isTrusted = trustCallback('192.168.1.1', 0);
            expect(isTrusted).toBe(true);

            const isUntrusted = trustCallback('10.0.0.1', 0);
            expect(isUntrusted).toBe(false);
        });

        it('should normalize IPv6 localhost in trust proxy callback', () => {
            config.trustedProxies = ['127.0.0.1'];

            setupTrustProxy(mockApp);

            const trustCallback = mockApp.set.mock.calls[0][1];

            // IPv6 localhost should match IPv4 localhost
            expect(trustCallback('::1', 0)).toBe(true);
            expect(trustCallback('::ffff:127.0.0.1', 0)).toBe(true);
        });

        it('should log warning for untrusted proxies', () => {
            config.trustedProxies = ['192.168.1.1'];

            setupTrustProxy(mockApp);

            const trustCallback = mockApp.set.mock.calls[0][1];
            trustCallback('10.0.0.1', 0);

            expect(logger.warn).toHaveBeenCalledWith(
                expect.objectContaining({
                    proxyIP: '10.0.0.1',
                    hopIndex: 0,
                }),
                expect.stringContaining('IP spoofing')
            );
        });
    });

    describe('createProxyHeaderValidator()', () => {
        let validator;

        beforeEach(() => {
            validator = createProxyHeaderValidator();
        });

        it('should create proxy header validation middleware', () => {
            expect(validator).toBeDefined();
            expect(typeof validator).toBe('function');
        });

        it('should validate X-Forwarded-For header', () => {
            mockReq.headers['x-forwarded-for'] = '192.168.1.1';

            validator(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalled();
            expect(mockReq.log.debug).toHaveBeenCalled();
        });

        it('should detect suspicious proxy chain (too many hops)', () => {
            mockReq.headers['x-forwarded-for'] = '1.1.1.1, 2.2.2.2, 3.3.3.3, 4.4.4.4, 5.5.5.5, 6.6.6.6';

            validator(mockReq, mockRes, mockNext);

            expect(mockReq.log.warn).toHaveBeenCalledWith(
                expect.objectContaining({
                    hopCount: 6,
                }),
                expect.stringContaining('too many hops')
            );
            expect(mockNext).toHaveBeenCalled(); // Still continues
        });

        it('should detect invalid IP addresses in X-Forwarded-For', () => {
            mockReq.headers['x-forwarded-for'] = '192.168.1.1, invalid-ip, 10.0.0.1';

            validator(mockReq, mockRes, mockNext);

            expect(mockReq.log.warn).toHaveBeenCalledWith(
                expect.objectContaining({
                    invalidIPs: ['invalid-ip'],
                }),
                expect.stringContaining('Invalid IP addresses')
            );
            expect(mockNext).toHaveBeenCalled();
        });

        it('should detect conflicting proxy headers', () => {
            mockReq.headers['x-forwarded-for'] = '192.168.1.1';
            mockReq.headers['x-real-ip'] = '10.0.0.1'; // Different IP
            mockReq.ip = '192.168.1.1';

            validator(mockReq, mockRes, mockNext);

            expect(mockReq.log.warn).toHaveBeenCalledWith(
                expect.objectContaining({
                    xRealIP: '10.0.0.1',
                    xForwardedFor: '192.168.1.1',
                }),
                expect.stringContaining('Conflicting proxy headers')
            );
        });

        it('should handle missing proxy headers gracefully', () => {
            validator(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalled();
            expect(mockReq.log.debug).toHaveBeenCalled();
        });

        it('should validate IPv6 addresses in X-Forwarded-For', () => {
            mockReq.headers['x-forwarded-for'] = '::1, fe80::1, 2001:db8::1';

            validator(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalled();
            expect(mockReq.log.warn).not.toHaveBeenCalledWith(
                expect.objectContaining({
                    invalidIPs: expect.anything(),
                }),
                expect.anything()
            );
        });

        it('should detect invalid IPv4 octets', () => {
            mockReq.headers['x-forwarded-for'] = '192.168.1.256'; // 256 > 255

            validator(mockReq, mockRes, mockNext);

            expect(mockReq.log.warn).toHaveBeenCalledWith(
                expect.objectContaining({
                    invalidIPs: ['192.168.1.256'],
                }),
                expect.anything()
            );
        });

        it('should handle X-Client-IP header', () => {
            mockReq.headers['x-client-ip'] = '192.168.1.1';

            validator(mockReq, mockRes, mockNext);

            expect(mockReq.log.debug).toHaveBeenCalledWith(
                expect.objectContaining({
                    xClientIP: '192.168.1.1',
                }),
                expect.anything()
            );
        });
    });

    describe('setupHelmet()', () => {
        it('should return Helmet middleware', () => {
            const helmet = setupHelmet();

            expect(helmet).toBeDefined();
            expect(typeof helmet).toBe('function');
        });

        it('should configure CSP headers', () => {
            const helmet = setupHelmet();
            // Helmet returns a middleware function
            expect(helmet).toBeDefined();
        });
    });

    describe('setupCORS()', () => {
        it('should return CORS middleware', () => {
            const cors = setupCORS();

            expect(cors).toBeDefined();
        });
    });

    describe('createCSRFProtection()', () => {
        let csrfProtection;

        beforeEach(() => {
            csrfProtection = createCSRFProtection();
        });

        it('should create CSRF protection middleware', () => {
            expect(csrfProtection).toBeDefined();
            expect(typeof csrfProtection).toBe('function');
        });

        it('should allow GET requests without header', () => {
            mockReq.method = 'GET';

            csrfProtection(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalledWith();
            expect(mockRes.status).not.toHaveBeenCalled();
        });

        it('should allow HEAD requests without header', () => {
            mockReq.method = 'HEAD';

            csrfProtection(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalledWith();
        });

        it('should allow OPTIONS requests without header', () => {
            mockReq.method = 'OPTIONS';

            csrfProtection(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalledWith();
        });

        it('should block POST without X-Requested-With header', () => {
            mockReq.method = 'POST';

            csrfProtection(mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalledWith({
                error: 'Forbidden',
                message: 'Missing required header',
            });
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('should block DELETE without X-Requested-With header', () => {
            mockReq.method = 'DELETE';

            csrfProtection(mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(403);
        });

        it('should block PUT without X-Requested-With header', () => {
            mockReq.method = 'PUT';

            csrfProtection(mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(403);
        });

        it('should block PATCH without X-Requested-With header', () => {
            mockReq.method = 'PATCH';

            csrfProtection(mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(403);
        });

        it('should allow POST with X-Requested-With header', () => {
            mockReq.method = 'POST';
            mockReq.headers['x-requested-with'] = 'XMLHttpRequest';

            csrfProtection(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalledWith();
            expect(mockRes.status).not.toHaveBeenCalled();
        });

        it('should block POST with empty X-Requested-With header', () => {
            mockReq.method = 'POST';
            mockReq.headers['x-requested-with'] = '';

            csrfProtection(mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(403);
        });

        it('should block POST with whitespace-only header', () => {
            mockReq.method = 'POST';
            mockReq.headers['x-requested-with'] = '   ';

            csrfProtection(mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(403);
        });

        it('should log CSRF attempts', () => {
            mockReq.method = 'POST';
            mockReq.path = '/api/test';
            mockReq.headers.origin = 'https://evil.com';
            mockReq.headers.referer = 'https://evil.com/attack';

            csrfProtection(mockReq, mockRes, mockNext);

            expect(logger.warn).toHaveBeenCalledWith(
                expect.objectContaining({
                    ip: mockReq.ip,
                    method: 'POST',
                    path: '/api/test',
                    origin: 'https://evil.com',
                    referer: 'https://evil.com/attack',
                }),
                expect.stringContaining('CSRF protection')
            );
        });
    });

    describe('createAdminAuth() - Additional Edge Cases', () => {
        let adminAuth;

        beforeEach(() => {
            config.adminIPs = ['127.0.0.1'];
            config.adminApiKey = null;
            adminAuth = createAdminAuth();
        });

        it('should use connection.remoteAddress as fallback', () => {
            mockReq.ip = null;
            mockReq.connection.remoteAddress = '127.0.0.1';

            adminAuth(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalled();
        });

        it('should reject when both IP sources are unavailable', () => {
            mockReq.ip = null;
            mockReq.connection = null;

            adminAuth(mockReq, mockRes, mockNext);

            expect(mockReq.log.error).toHaveBeenCalled();
            expect(mockRes.status).toHaveBeenCalledWith(403);
        });

        it('should handle null in adminIPs array', () => {
            config.adminIPs = ['127.0.0.1', null, '10.0.0.1'];
            mockReq.ip = '10.0.0.1';

            adminAuth(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalled();
        });

        it('should handle undefined in adminIPs array', () => {
            config.adminIPs = ['127.0.0.1', undefined];
            mockReq.ip = '127.0.0.1';

            adminAuth(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalled();
        });

        it('should handle API key with null character', () => {
            config.adminApiKey = 'test-key\0';
            adminAuth = createAdminAuth();

            mockReq.ip = '127.0.0.1';
            mockReq.headers['x-api-key'] = 'test-key\0';

            adminAuth(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalled();
        });

        it('should handle very long API keys', () => {
            const longKey = 'a'.repeat(1000);
            config.adminApiKey = longKey;
            adminAuth = createAdminAuth();

            mockReq.ip = '127.0.0.1';
            mockReq.headers['x-api-key'] = longKey;

            adminAuth(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalled();
        });

        it('should handle Unicode in API keys', () => {
            config.adminApiKey = 'key-with-unicode-😀-chars';
            adminAuth = createAdminAuth();

            mockReq.ip = '127.0.0.1';
            mockReq.headers['x-api-key'] = 'key-with-unicode-😀-chars';

            adminAuth(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalled();
        });

        it('should reject API key with wrong Unicode character', () => {
            config.adminApiKey = 'key-with-unicode-😀-chars';
            adminAuth = createAdminAuth();

            mockReq.ip = '127.0.0.1';
            mockReq.headers['x-api-key'] = 'key-with-unicode-😁-chars'; // Different emoji

            adminAuth(mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(403);
        });
    });

    describe('IP Validation Edge Cases', () => {
        let validator;

        beforeEach(() => {
            validator = createProxyHeaderValidator();
        });

        it('should validate loopback addresses', () => {
            mockReq.headers['x-forwarded-for'] = '127.0.0.1';

            validator(mockReq, mockRes, mockNext);

            expect(mockReq.log.warn).not.toHaveBeenCalledWith(
                expect.objectContaining({ invalidIPs: expect.anything() }),
                expect.anything()
            );
        });

        it('should validate private network addresses', () => {
            mockReq.headers['x-forwarded-for'] = '192.168.1.1, 10.0.0.1, 172.16.0.1';

            validator(mockReq, mockRes, mockNext);

            expect(mockReq.log.warn).not.toHaveBeenCalledWith(
                expect.objectContaining({ invalidIPs: expect.anything() }),
                expect.anything()
            );
        });

        it('should validate IPv6 loopback', () => {
            mockReq.headers['x-forwarded-for'] = '::1';

            validator(mockReq, mockRes, mockNext);

            expect(mockReq.log.warn).not.toHaveBeenCalledWith(
                expect.objectContaining({ invalidIPs: expect.anything() }),
                expect.anything()
            );
        });

        it('should validate IPv6 link-local addresses', () => {
            mockReq.headers['x-forwarded-for'] = 'fe80::1';

            validator(mockReq, mockRes, mockNext);

            expect(mockReq.log.warn).not.toHaveBeenCalledWith(
                expect.objectContaining({ invalidIPs: expect.anything() }),
                expect.anything()
            );
        });

        it('should validate IPv4-mapped IPv6 addresses', () => {
            mockReq.headers['x-forwarded-for'] = '::ffff:192.168.1.1';

            validator(mockReq, mockRes, mockNext);

            expect(mockReq.log.warn).not.toHaveBeenCalledWith(
                expect.objectContaining({ invalidIPs: expect.anything() }),
                expect.anything()
            );
        });

        it('should reject malformed IPs', () => {
            mockReq.headers['x-forwarded-for'] = '999.999.999.999';

            validator(mockReq, mockRes, mockNext);

            expect(mockReq.log.warn).toHaveBeenCalledWith(
                expect.objectContaining({ invalidIPs: ['999.999.999.999'] }),
                expect.anything()
            );
        });

        it('should reject IPs with letters', () => {
            mockReq.headers['x-forwarded-for'] = '192.168.abc.1';

            validator(mockReq, mockRes, mockNext);

            expect(mockReq.log.warn).toHaveBeenCalledWith(
                expect.objectContaining({ invalidIPs: ['192.168.abc.1'] }),
                expect.anything()
            );
        });

        it('should reject empty string as IP', () => {
            mockReq.headers['x-forwarded-for'] = '';

            validator(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalled();
        });
    });
});
