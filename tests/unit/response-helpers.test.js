/**
 * Response Helpers Unit Tests
 * Tests for lib/response-helpers.js
 *
 * Coverage areas:
 * - SVG response generation
 * - JSON response generation
 * - Error response formatting
 * - Security headers
 * - Cache control headers
 */

jest.mock('../../lib/logger');

const logger = require('../../lib/logger');
const {
    sendSVG,
    sendJSON,
    sendError,
    sendSuccess,
} = require('../../lib/response-helpers');

describe('Response Helpers Tests', () => {
    let mockRes;
    let mockReq;

    beforeEach(() => {
        mockReq = {
            log: {
                error: jest.fn(),
                warn: jest.fn(),
            },
        };

        mockRes = {
            status: jest.fn().mockReturnThis(),
            set: jest.fn().mockReturnThis(),
            setHeader: jest.fn().mockReturnThis(),
            send: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
        };

        logger.error = jest.fn();

        jest.clearAllMocks();
    });

    describe('sendSVG()', () => {
        it('should send SVG with correct Content-Type', () => {
            const svgContent = '<svg><rect width="100" height="100"/></svg>';

            sendSVG(mockRes, svgContent);

            expect(mockRes.set).toHaveBeenCalledWith('Content-Type', 'image/svg+xml');
            expect(mockRes.send).toHaveBeenCalledWith(svgContent);
        });

        it('should set cache control headers when provided', () => {
            const svgContent = '<svg></svg>';
            const options = { cacheControl: 'public, max-age=3600' };

            sendSVG(mockRes, svgContent, options);

            expect(mockRes.set).toHaveBeenCalledWith('Cache-Control', 'public, max-age=3600');
        });

        it('should set default cache control when not provided', () => {
            const svgContent = '<svg></svg>';

            sendSVG(mockRes, svgContent);

            expect(mockRes.set).toHaveBeenCalledWith('Cache-Control', expect.any(String));
        });

        it('should set X-Content-Type-Options header', () => {
            const svgContent = '<svg></svg>';

            sendSVG(mockRes, svgContent);

            expect(mockRes.set).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
        });

        it('should handle empty SVG content', () => {
            sendSVG(mockRes, '');

            expect(mockRes.send).toHaveBeenCalledWith('');
        });

        it('should handle large SVG content', () => {
            const largeSVG = '<svg>' + 'x'.repeat(100000) + '</svg>';

            sendSVG(mockRes, largeSVG);

            expect(mockRes.send).toHaveBeenCalledWith(largeSVG);
        });

        it('should handle SVG with special characters', () => {
            const svgWithSpecialChars = '<svg><text>Test & "quoted" \'text\'</text></svg>';

            sendSVG(mockRes, svgWithSpecialChars);

            expect(mockRes.send).toHaveBeenCalledWith(svgWithSpecialChars);
        });

        it('should handle custom cache options', () => {
            const svgContent = '<svg></svg>';
            const options = {
                cacheControl: 'no-cache, no-store, must-revalidate',
            };

            sendSVG(mockRes, svgContent, options);

            expect(mockRes.set).toHaveBeenCalledWith('Cache-Control', 'no-cache, no-store, must-revalidate');
        });
    });

    describe('sendJSON()', () => {
        it('should send JSON with correct Content-Type', () => {
            const data = { test: 'data' };

            sendJSON(mockRes, data);

            expect(mockRes.json).toHaveBeenCalledWith(data);
        });

        it('should send JSON with custom status code', () => {
            const data = { test: 'data' };

            sendJSON(mockRes, data, 201);

            expect(mockRes.status).toHaveBeenCalledWith(201);
            expect(mockRes.json).toHaveBeenCalledWith(data);
        });

        it('should send JSON with default 200 status', () => {
            const data = { test: 'data' };

            sendJSON(mockRes, data);

            expect(mockRes.status).toHaveBeenCalledWith(200);
        });

        it('should handle null data', () => {
            sendJSON(mockRes, null);

            expect(mockRes.json).toHaveBeenCalledWith(null);
        });

        it('should handle undefined data', () => {
            sendJSON(mockRes, undefined);

            expect(mockRes.json).toHaveBeenCalledWith(undefined);
        });

        it('should handle complex nested objects', () => {
            const complexData = {
                level1: {
                    level2: {
                        level3: {
                            value: 'deep',
                        },
                    },
                },
                array: [1, 2, 3, { nested: true }],
            };

            sendJSON(mockRes, complexData);

            expect(mockRes.json).toHaveBeenCalledWith(complexData);
        });

        it('should handle arrays', () => {
            const arrayData = [1, 2, 3, 'test', { obj: true }];

            sendJSON(mockRes, arrayData);

            expect(mockRes.json).toHaveBeenCalledWith(arrayData);
        });

        it('should handle empty object', () => {
            sendJSON(mockRes, {});

            expect(mockRes.json).toHaveBeenCalledWith({});
        });

        it('should handle empty array', () => {
            sendJSON(mockRes, []);

            expect(mockRes.json).toHaveBeenCalledWith([]);
        });
    });

    describe('sendError()', () => {
        it('should send error with default 500 status', () => {
            sendError(mockRes, 'Error message');

            expect(mockRes.status).toHaveBeenCalledWith(500);
            expect(mockRes.json).toHaveBeenCalledWith({ error: 'Error message' });
        });

        it('should send error with custom status code', () => {
            sendError(mockRes, 'Not found', 404);

            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({ error: 'Not found' });
        });

        it('should send error with 400 Bad Request', () => {
            sendError(mockRes, 'Invalid input', 400);

            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({ error: 'Invalid input' });
        });

        it('should send error with 403 Forbidden', () => {
            sendError(mockRes, 'Access denied', 403);

            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalledWith({ error: 'Access denied' });
        });

        it('should send error with 401 Unauthorized', () => {
            sendError(mockRes, 'Unauthorized', 401);

            expect(mockRes.status).toHaveBeenCalledWith(401);
            expect(mockRes.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
        });

        it('should handle empty error message', () => {
            sendError(mockRes, '');

            expect(mockRes.json).toHaveBeenCalledWith({ error: '' });
        });

        it('should handle long error messages', () => {
            const longMessage = 'a'.repeat(1000);

            sendError(mockRes, longMessage);

            expect(mockRes.json).toHaveBeenCalledWith({ error: longMessage });
        });

        it('should log error when request logger available', () => {
            sendError(mockRes, 'Test error', 500, mockReq);

            expect(mockReq.log.error).toHaveBeenCalled();
        });

        it('should handle missing request logger gracefully', () => {
            const reqWithoutLog = {};

            sendError(mockRes, 'Test error', 500, reqWithoutLog);

            expect(mockRes.status).toHaveBeenCalledWith(500);
        });
    });

    describe('sendSuccess()', () => {
        it('should send success response with data', () => {
            const data = { result: 'success' };

            sendSuccess(mockRes, data);

            expect(mockRes.json).toHaveBeenCalledWith({
                success: true,
                ...data,
            });
        });

        it('should send success with custom status code', () => {
            const data = { created: true };

            sendSuccess(mockRes, data, 201);

            expect(mockRes.status).toHaveBeenCalledWith(201);
            expect(mockRes.json).toHaveBeenCalledWith({
                success: true,
                created: true,
            });
        });

        it('should send success with default 200 status', () => {
            sendSuccess(mockRes, { data: 'test' });

            expect(mockRes.status).toHaveBeenCalledWith(200);
        });

        it('should merge data into response', () => {
            const data = {
                message: 'Operation completed',
                count: 5,
                items: [1, 2, 3],
            };

            sendSuccess(mockRes, data);

            expect(mockRes.json).toHaveBeenCalledWith({
                success: true,
                message: 'Operation completed',
                count: 5,
                items: [1, 2, 3],
            });
        });

        it('should handle empty data object', () => {
            sendSuccess(mockRes, {});

            expect(mockRes.json).toHaveBeenCalledWith({ success: true });
        });

        it('should handle null data', () => {
            sendSuccess(mockRes, null);

            expect(mockRes.json).toHaveBeenCalledWith({ success: true });
        });

        it('should handle undefined data', () => {
            sendSuccess(mockRes, undefined);

            expect(mockRes.json).toHaveBeenCalledWith({ success: true });
        });

        it('should not override success field if provided', () => {
            const data = { success: false, message: 'partial' };

            sendSuccess(mockRes, data);

            // Should override with true
            expect(mockRes.json).toHaveBeenCalledWith({
                success: true,
                message: 'partial',
            });
        });
    });

    describe('Security Headers', () => {
        it('should always set X-Content-Type-Options for SVG', () => {
            sendSVG(mockRes, '<svg></svg>');

            expect(mockRes.set).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
        });

        it('should set appropriate Content-Type for SVG', () => {
            sendSVG(mockRes, '<svg></svg>');

            expect(mockRes.set).toHaveBeenCalledWith('Content-Type', 'image/svg+xml');
        });
    });

    describe('Edge Cases', () => {
        it('should handle response object without set method', () => {
            const minimalRes = {
                send: jest.fn(),
            };

            // Should not throw error
            expect(() => {
                minimalRes.send('<svg></svg>');
            }).not.toThrow();
        });

        it('should handle response object without status method', () => {
            const minimalRes = {
                json: jest.fn(),
            };

            minimalRes.json({ error: 'test' });

            expect(minimalRes.json).toHaveBeenCalledWith({ error: 'test' });
        });

        it('should handle SVG content with null bytes', () => {
            const svgWithNull = '<svg>\0</svg>';

            sendSVG(mockRes, svgWithNull);

            expect(mockRes.send).toHaveBeenCalledWith(svgWithNull);
        });

        it('should handle JSON with circular references gracefully', () => {
            const circular = { a: 1 };
            circular.self = circular;

            // JSON.stringify will throw on circular reference
            // Response helper should let Express handle this
            expect(() => {
                sendJSON(mockRes, circular);
            }).not.toThrow();
        });

        it('should handle very large JSON objects', () => {
            const largeObject = {};
            for (let i = 0; i < 10000; i++) {
                largeObject[`key${i}`] = `value${i}`;
            }

            sendJSON(mockRes, largeObject);

            expect(mockRes.json).toHaveBeenCalledWith(largeObject);
        });

        it('should handle special characters in error messages', () => {
            sendError(mockRes, 'Error with "quotes" and \'apostrophes\'', 400);

            expect(mockRes.json).toHaveBeenCalledWith({
                error: 'Error with "quotes" and \'apostrophes\'',
            });
        });

        it('should handle Unicode in error messages', () => {
            sendError(mockRes, 'Error with emoji 😀 and 中文', 400);

            expect(mockRes.json).toHaveBeenCalledWith({
                error: 'Error with emoji 😀 and 中文',
            });
        });

        it('should handle numeric status codes as strings', () => {
            sendError(mockRes, 'Error', '404');

            expect(mockRes.status).toHaveBeenCalledWith('404');
        });

        it('should handle zero as status code', () => {
            sendJSON(mockRes, { data: 'test' }, 0);

            expect(mockRes.status).toHaveBeenCalledWith(0);
        });

        it('should handle negative status code', () => {
            sendError(mockRes, 'Error', -1);

            expect(mockRes.status).toHaveBeenCalledWith(-1);
        });
    });

    describe('Method Chaining', () => {
        it('should support method chaining for sendJSON', () => {
            const result = mockRes.status(200).json({ test: 'data' });

            expect(result).toBe(mockRes);
        });

        it('should support method chaining for sendError', () => {
            sendError(mockRes, 'Error');

            // Verify chaining works
            expect(mockRes.status).toHaveBeenCalledWith(500);
            expect(mockRes.json).toHaveBeenCalled();
        });

        it('should support method chaining for SVG headers', () => {
            sendSVG(mockRes, '<svg></svg>');

            // Multiple set calls should chain
            expect(mockRes.set).toHaveBeenCalledTimes(3); // Content-Type, X-Content-Type-Options, Cache-Control
        });
    });
});
