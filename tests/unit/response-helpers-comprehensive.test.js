/**
 * Response Helpers Comprehensive Unit Tests
 * Complete coverage for response helper functions
 */

const { sendSVG, sendErrorResponse, sendError, ErrorCodes } = require('../../lib/response-helpers');

describe('Response Helpers', () => {
    let mockRes;

    beforeEach(() => {
        mockRes = {
            setHeader: jest.fn(),
            send: jest.fn(),
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
        };
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('sendSVG', () => {
        it('should send SVG with default cache control', () => {
            const svgContent = '<svg>test</svg>';

            sendSVG(mockRes, svgContent);

            expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'image/svg+xml');
            expect(mockRes.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
            expect(mockRes.setHeader).toHaveBeenCalledWith('Cache-Control', 'public, max-age=3600');
            expect(mockRes.send).toHaveBeenCalledWith(svgContent);
        });

        it('should send SVG with custom cache control', () => {
            const svgContent = '<svg>test</svg>';
            const options = { cacheControl: 'no-cache' };

            sendSVG(mockRes, svgContent, options);

            expect(mockRes.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
        });

        it('should send SVG Buffer content', () => {
            const svgBuffer = Buffer.from('<svg>test</svg>');

            sendSVG(mockRes, svgBuffer);

            expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'image/svg+xml');
            expect(mockRes.send).toHaveBeenCalledWith(svgBuffer);
        });

        it('should handle empty options object', () => {
            const svgContent = '<svg>test</svg>';

            sendSVG(mockRes, svgContent, {});

            expect(mockRes.setHeader).toHaveBeenCalledWith('Cache-Control', 'public, max-age=3600');
        });

        it('should set all required security headers', () => {
            sendSVG(mockRes, '<svg></svg>');

            // Verify all security headers are set
            const headers = mockRes.setHeader.mock.calls.map((call) => call[0]);
            expect(headers).toContain('Content-Type');
            expect(headers).toContain('X-Content-Type-Options');
            expect(headers).toContain('Cache-Control');
        });

        it('should handle long-lived cache control', () => {
            const svgContent = '<svg>test</svg>';
            const options = { cacheControl: 'public, max-age=31536000, immutable' };

            sendSVG(mockRes, svgContent, options);

            expect(mockRes.setHeader).toHaveBeenCalledWith(
                'Cache-Control',
                'public, max-age=31536000, immutable'
            );
        });
    });

    describe('sendErrorResponse', () => {
        it('should send error response with default details', () => {
            sendErrorResponse(mockRes, 404, 'Not found');

            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalled();

            const jsonCall = mockRes.json.mock.calls[0][0];
            expect(jsonCall).toHaveProperty('error', 'Not found');
            expect(jsonCall).toHaveProperty('details');
            expect(jsonCall.details).toHaveProperty('timestamp');
        });

        it('should send error response with custom details', () => {
            const details = { field: 'username', reason: 'invalid' };

            sendErrorResponse(mockRes, 400, 'Validation failed', details);

            expect(mockRes.status).toHaveBeenCalledWith(400);

            const jsonCall = mockRes.json.mock.calls[0][0];
            expect(jsonCall.details).toHaveProperty('field', 'username');
            expect(jsonCall.details).toHaveProperty('reason', 'invalid');
            expect(jsonCall.details).toHaveProperty('timestamp');
        });

        it('should include timestamp in ISO format', () => {
            sendErrorResponse(mockRes, 500, 'Internal error');

            const jsonCall = mockRes.json.mock.calls[0][0];
            expect(jsonCall.details.timestamp).toMatch(
                /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
            );
        });

        it('should handle various status codes', () => {
            const testCases = [
                { status: 400, message: 'Bad Request' },
                { status: 401, message: 'Unauthorized' },
                { status: 403, message: 'Forbidden' },
                { status: 404, message: 'Not Found' },
                { status: 500, message: 'Internal Server Error' },
            ];

            testCases.forEach(({ status, message }) => {
                const res = {
                    status: jest.fn().mockReturnThis(),
                    json: jest.fn().mockReturnThis(),
                };

                sendErrorResponse(res, status, message);

                expect(res.status).toHaveBeenCalledWith(status);
                expect(res.json).toHaveBeenCalled();
            });
        });
    });

    describe('sendError', () => {
        it('should send standardized error with code', () => {
            sendError(mockRes, 400, ErrorCodes.MISSING_PARAMETER, 'Folder parameter is required');

            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({
                error: true,
                code: 'MISSING_PARAMETER',
                message: 'Folder parameter is required',
            });
        });

        it('should handle all error codes', () => {
            const testCases = [
                { code: ErrorCodes.MISSING_PARAMETER, status: 400 },
                { code: ErrorCodes.INVALID_PARAMETER, status: 400 },
                { code: ErrorCodes.ACCESS_DENIED, status: 403 },
                { code: ErrorCodes.NOT_FOUND, status: 404 },
                { code: ErrorCodes.FILE_TOO_LARGE, status: 413 },
                { code: ErrorCodes.INVALID_FILE_TYPE, status: 415 },
                { code: ErrorCodes.TOO_MANY_FILES, status: 400 },
                { code: ErrorCodes.RATE_LIMITED, status: 429 },
                { code: ErrorCodes.INTERNAL_ERROR, status: 500 },
                { code: ErrorCodes.SERVICE_UNAVAILABLE, status: 503 },
                { code: ErrorCodes.UPLOAD_FAILED, status: 500 },
            ];

            testCases.forEach(({ code, status }) => {
                const res = {
                    status: jest.fn().mockReturnThis(),
                    json: jest.fn().mockReturnThis(),
                };

                sendError(res, status, code, 'Test message');

                expect(res.status).toHaveBeenCalledWith(status);
                expect(res.json).toHaveBeenCalledWith({
                    error: true,
                    code,
                    message: 'Test message',
                });
            });
        });
    });

    describe('ErrorCodes', () => {
        it('should export all error codes', () => {
            expect(ErrorCodes).toHaveProperty('MISSING_PARAMETER');
            expect(ErrorCodes).toHaveProperty('INVALID_PARAMETER');
            expect(ErrorCodes).toHaveProperty('ACCESS_DENIED');
            expect(ErrorCodes).toHaveProperty('NOT_FOUND');
            expect(ErrorCodes).toHaveProperty('FILE_TOO_LARGE');
            expect(ErrorCodes).toHaveProperty('INVALID_FILE_TYPE');
            expect(ErrorCodes).toHaveProperty('TOO_MANY_FILES');
            expect(ErrorCodes).toHaveProperty('RATE_LIMITED');
            expect(ErrorCodes).toHaveProperty('INTERNAL_ERROR');
            expect(ErrorCodes).toHaveProperty('SERVICE_UNAVAILABLE');
            expect(ErrorCodes).toHaveProperty('UPLOAD_FAILED');
        });

        it('should have consistent naming convention', () => {
            Object.keys(ErrorCodes).forEach((key) => {
                expect(key).toMatch(/^[A-Z_]+$/);
                expect(ErrorCodes[key]).toBe(key);
            });
        });
    });
});
