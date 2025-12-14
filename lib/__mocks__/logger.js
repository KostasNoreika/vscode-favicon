/**
 * Mock logger for tests
 * Provides no-op implementations of all logger methods
 */

const mockLogger = {
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
    child: jest.fn(() => mockLogger),
    level: 'silent',
};

// Export as both default and named exports
module.exports = mockLogger;
module.exports.requestLogger = jest.fn(() => (req, res, next) => {
    req.id = 'test-id';
    req.log = mockLogger;
    next();
});
