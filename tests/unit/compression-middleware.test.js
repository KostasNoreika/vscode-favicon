/**
 * Compression Middleware Unit Tests
 * Tests for response compression configuration
 */

const { setupCompression } = require('../../lib/middleware/compression-middleware');

describe('Compression Middleware', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('setupCompression', () => {
        it('should create compression middleware', () => {
            const middleware = setupCompression();

            expect(middleware).toBeDefined();
            expect(typeof middleware).toBe('function');
        });

        it('should return a function with arity 3 (req, res, next)', () => {
            const middleware = setupCompression();

            // Compression middleware should accept 3 arguments
            expect(middleware.length).toBe(3);
        });

        it('should create middleware that can be called', () => {
            const middleware = setupCompression();
            const mockReq = {
                headers: {},
            };
            const mockRes = {
                setHeader: jest.fn(),
                on: jest.fn(),
                write: jest.fn(),
                end: jest.fn(),
            };
            const mockNext = jest.fn();

            // Should not throw when called
            expect(() => {
                middleware(mockReq, mockRes, mockNext);
            }).not.toThrow();
        });

        it('should bypass compression when x-no-compression header is present', () => {
            const middleware = setupCompression();
            const mockReq = {
                headers: {
                    'x-no-compression': '1',
                },
            };
            const mockRes = {
                setHeader: jest.fn(),
                on: jest.fn(),
                write: jest.fn(),
                end: jest.fn(),
                getHeader: jest.fn(),
            };
            const mockNext = jest.fn();

            middleware(mockReq, mockRes, mockNext);

            // Should call next without setting compression headers
            expect(mockNext).toHaveBeenCalled();
        });

        it('should handle requests without x-no-compression header', () => {
            const middleware = setupCompression();
            const mockReq = {
                headers: {
                    'accept-encoding': 'gzip, deflate',
                },
                method: 'GET',
            };
            const mockRes = {
                setHeader: jest.fn(),
                on: jest.fn(),
                write: jest.fn(),
                end: jest.fn(),
                getHeader: jest.fn((name) => {
                    if (name === 'Content-Type') return 'text/html';
                    return undefined;
                }),
            };
            const mockNext = jest.fn();

            middleware(mockReq, mockRes, mockNext);

            // Should call next
            expect(mockNext).toHaveBeenCalled();
        });

        it('should handle multiple invocations', () => {
            const middleware = setupCompression();

            for (let i = 0; i < 3; i++) {
                const mockReq = { headers: {} };
                const mockRes = {
                    setHeader: jest.fn(),
                    on: jest.fn(),
                    write: jest.fn(),
                    end: jest.fn(),
                };
                const mockNext = jest.fn();

                middleware(mockReq, mockRes, mockNext);
                expect(mockNext).toHaveBeenCalled();
            }
        });
    });
});
