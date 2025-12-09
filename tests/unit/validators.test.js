/**
 * Unit Tests for Input Validators
 * Tests validation logic for folder paths, notification bodies, and timestamps
 */

const { validationResult } = require('express-validator');
const { validateNotificationBody, handleValidationErrors } = require('../../lib/validators');

describe('Input Validators', () => {
    describe('Timestamp Validation', () => {
        let mockReq;

        beforeEach(() => {
            mockReq = {
                body: {},
                path: '/test',
                method: 'POST',
                ip: '127.0.0.1',
            };
        });

        /**
         * Helper to run validators and get validation errors
         */
        const runValidation = async (bodyData) => {
            mockReq.body = bodyData;

            // Run all validators
            for (const validator of validateNotificationBody) {
                await validator.run(mockReq);
            }

            const errors = validationResult(mockReq);
            return errors;
        };

        test('should accept timestamp at exact boundary: now + 24 hours', async () => {
            const now = Date.now();
            const maxFuture = now + 24 * 60 * 60 * 1000; // Exactly 24 hours in future

            const errors = await runValidation({
                folder: '/opt/dev/test',
                message: 'Test message',
                timestamp: maxFuture,
            });

            expect(errors.isEmpty()).toBe(true);
        });

        test('should accept timestamp near boundary: now - 1 year + 100ms', async () => {
            const now = Date.now();
            const minPast = now - 365 * 24 * 60 * 60 * 1000 + 100; // 100ms after 1 year boundary (margin for execution time)

            const errors = await runValidation({
                folder: '/opt/dev/test',
                message: 'Test message',
                timestamp: minPast,
            });

            expect(errors.isEmpty()).toBe(true);
        });

        test('should reject timestamp just outside: now + 24h + 100ms', async () => {
            const now = Date.now();
            const tooFar = now + 24 * 60 * 60 * 1000 + 100; // 100ms beyond 24 hours (enough margin for execution time)

            const errors = await runValidation({
                folder: '/opt/dev/test',
                message: 'Test message',
                timestamp: tooFar,
            });

            expect(errors.isEmpty()).toBe(false);
            const errorArray = errors.array();
            expect(errorArray).toHaveLength(1);
            expect(errorArray[0].path).toBe('timestamp');
            expect(errorArray[0].msg).toBe('timestamp outside valid range');
        });

        test('should reject timestamp just outside: now - 1y - 100ms', async () => {
            const now = Date.now();
            const tooOld = now - 365 * 24 * 60 * 60 * 1000 - 100; // 100ms before 1 year (enough margin for execution time)

            const errors = await runValidation({
                folder: '/opt/dev/test',
                message: 'Test message',
                timestamp: tooOld,
            });

            expect(errors.isEmpty()).toBe(false);
            const errorArray = errors.array();
            expect(errorArray).toHaveLength(1);
            expect(errorArray[0].path).toBe('timestamp');
            expect(errorArray[0].msg).toBe('timestamp outside valid range');
        });

        test('should reject extreme future value: year 2100', async () => {
            const year2100 = new Date('2100-01-01').getTime();

            const errors = await runValidation({
                folder: '/opt/dev/test',
                message: 'Test message',
                timestamp: year2100,
            });

            expect(errors.isEmpty()).toBe(false);
            const errorArray = errors.array();
            expect(errorArray[0].path).toBe('timestamp');
            expect(errorArray[0].msg).toBe('timestamp outside valid range');
        });

        test('should reject extreme past value: year 1970', async () => {
            const year1970 = new Date('1970-01-01').getTime();

            const errors = await runValidation({
                folder: '/opt/dev/test',
                message: 'Test message',
                timestamp: year1970,
            });

            expect(errors.isEmpty()).toBe(false);
            const errorArray = errors.array();
            expect(errorArray[0].path).toBe('timestamp');
            expect(errorArray[0].msg).toBe('timestamp outside valid range');
        });

        test('should reject non-numeric string value', async () => {
            const errors = await runValidation({
                folder: '/opt/dev/test',
                message: 'Test message',
                timestamp: 'not-a-number',
            });

            expect(errors.isEmpty()).toBe(false);
            const errorArray = errors.array();
            expect(errorArray[0].path).toBe('timestamp');
            expect(errorArray[0].msg).toBe('timestamp must be a number');
        });

        test('should reject negative timestamp', async () => {
            const errors = await runValidation({
                folder: '/opt/dev/test',
                message: 'Test message',
                timestamp: -1000,
            });

            expect(errors.isEmpty()).toBe(false);
            const errorArray = errors.array();
            expect(errorArray[0].path).toBe('timestamp');
            expect(errorArray[0].msg).toBe('timestamp must be a positive integer');
        });

        test('should reject boolean value', async () => {
            const errors = await runValidation({
                folder: '/opt/dev/test',
                message: 'Test message',
                timestamp: true,
            });

            expect(errors.isEmpty()).toBe(false);
            const errorArray = errors.array();
            expect(errorArray[0].path).toBe('timestamp');
            expect(errorArray[0].msg).toBe('timestamp must be a number');
        });

        test('should reject null value', async () => {
            const errors = await runValidation({
                folder: '/opt/dev/test',
                message: 'Test message',
                timestamp: null,
            });

            expect(errors.isEmpty()).toBe(false);
            const errorArray = errors.array();
            expect(errorArray[0].path).toBe('timestamp');
            expect(errorArray[0].msg).toBe('timestamp must be a number');
        });

        test('should reject object value', async () => {
            const errors = await runValidation({
                folder: '/opt/dev/test',
                message: 'Test message',
                timestamp: { value: 123 },
            });

            expect(errors.isEmpty()).toBe(false);
            const errorArray = errors.array();
            expect(errorArray[0].path).toBe('timestamp');
            expect(errorArray[0].msg).toBe('timestamp must be a number');
        });

        test('should reject array value', async () => {
            const errors = await runValidation({
                folder: '/opt/dev/test',
                message: 'Test message',
                timestamp: [123],
            });

            expect(errors.isEmpty()).toBe(false);
            const errorArray = errors.array();
            expect(errorArray[0].path).toBe('timestamp');
            // Array [123] gets converted to number 123, which is outside valid range (too old)
            expect(errorArray[0].msg).toBe('timestamp outside valid range');
        });

        test('should accept valid timestamp within range', async () => {
            const now = Date.now();
            const validTimestamp = now - 1000; // 1 second ago

            const errors = await runValidation({
                folder: '/opt/dev/test',
                message: 'Test message',
                timestamp: validTimestamp,
            });

            expect(errors.isEmpty()).toBe(true);
        });

        test('should allow timestamp to be optional (omitted)', async () => {
            const errors = await runValidation({
                folder: '/opt/dev/test',
                message: 'Test message',
                // timestamp omitted
            });

            expect(errors.isEmpty()).toBe(true);
        });

        test('should accept current timestamp', async () => {
            const now = Date.now();

            const errors = await runValidation({
                folder: '/opt/dev/test',
                message: 'Test message',
                timestamp: now,
            });

            expect(errors.isEmpty()).toBe(true);
        });

        test('should reject floating point timestamp outside range', async () => {
            const now = Date.now();
            const tooFar = now + 24 * 60 * 60 * 1000 + 100.5; // Float value

            const errors = await runValidation({
                folder: '/opt/dev/test',
                message: 'Test message',
                timestamp: tooFar,
            });

            expect(errors.isEmpty()).toBe(false);
            const errorArray = errors.array();
            expect(errorArray[0].path).toBe('timestamp');
            // Floating point values are rejected by isInt() before custom validator runs
            expect(errorArray[0].msg).toBe('timestamp must be a positive integer');
        });
    });

    describe('Message Validation', () => {
        let mockReq;

        beforeEach(() => {
            mockReq = {
                body: {},
                path: '/test',
                method: 'POST',
                ip: '127.0.0.1',
            };
        });

        const runValidation = async (bodyData) => {
            mockReq.body = bodyData;

            for (const validator of validateNotificationBody) {
                await validator.run(mockReq);
            }

            return validationResult(mockReq);
        };

        test('should accept valid message', async () => {
            const errors = await runValidation({
                folder: '/opt/dev/test',
                message: 'Valid test message',
            });

            expect(errors.isEmpty()).toBe(true);
        });

        test('should reject message exceeding 500 characters', async () => {
            const longMessage = 'a'.repeat(501);

            const errors = await runValidation({
                folder: '/opt/dev/test',
                message: longMessage,
            });

            expect(errors.isEmpty()).toBe(false);
            const errorArray = errors.array();
            expect(errorArray[0].path).toBe('message');
            expect(errorArray[0].msg).toBe('message must be 500 characters or less');
        });

        test('should accept message with exactly 500 characters', async () => {
            const maxMessage = 'a'.repeat(500);

            const errors = await runValidation({
                folder: '/opt/dev/test',
                message: maxMessage,
            });

            expect(errors.isEmpty()).toBe(true);
        });

        test('should reject message with invalid characters', async () => {
            const errors = await runValidation({
                folder: '/opt/dev/test',
                message: 'Invalid <script> tags',
            });

            expect(errors.isEmpty()).toBe(false);
            const errorArray = errors.array();
            expect(errorArray[0].path).toBe('message');
            expect(errorArray[0].msg).toBe('message contains invalid characters');
        });

        test('should accept message with allowed special characters', async () => {
            const errors = await runValidation({
                folder: '/opt/dev/test',
                message: 'Valid message with: punctuation, dashes-and_underscores! Question? (parentheses);',
            });

            expect(errors.isEmpty()).toBe(true);
        });

        test('should allow message to be optional', async () => {
            const errors = await runValidation({
                folder: '/opt/dev/test',
                // message omitted
            });

            expect(errors.isEmpty()).toBe(true);
        });

        test('should reject non-string message', async () => {
            const errors = await runValidation({
                folder: '/opt/dev/test',
                message: 12345,
            });

            expect(errors.isEmpty()).toBe(false);
            const errorArray = errors.array();
            expect(errorArray[0].path).toBe('message');
            expect(errorArray[0].msg).toBe('message must be a string');
        });
    });

    describe('handleValidationErrors Middleware', () => {
        let mockReq, mockRes, mockNext;

        beforeEach(() => {
            mockReq = {
                body: {},
                path: '/test',
                method: 'POST',
                ip: '127.0.0.1',
            };
            mockRes = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn().mockReturnThis(),
            };
            mockNext = jest.fn();
        });

        test('should call next() when no validation errors', async () => {
            mockReq.body = {
                folder: '/opt/dev/test',
                message: 'Valid message',
                timestamp: Date.now(),
            };

            // Run validators
            for (const validator of validateNotificationBody) {
                await validator.run(mockReq);
            }

            handleValidationErrors(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalled();
            expect(mockRes.status).not.toHaveBeenCalled();
        });

        test('should return 400 with error details when validation fails', async () => {
            mockReq.body = {
                folder: '/opt/dev/test',
                message: 12345, // Invalid: not a string
            };

            // Run validators
            for (const validator of validateNotificationBody) {
                await validator.run(mockReq);
            }

            handleValidationErrors(mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({
                error: 'Validation failed',
                details: expect.arrayContaining([
                    expect.objectContaining({
                        field: 'message',
                        message: 'message must be a string',
                        value: 12345,
                    }),
                ]),
            });
            expect(mockNext).not.toHaveBeenCalled();
        });

        test('should handle multiple validation errors', async () => {
            const now = Date.now();
            mockReq.body = {
                folder: '/opt/dev/test',
                message: '<script>alert("xss")</script>', // Invalid characters
                timestamp: now + 48 * 60 * 60 * 1000, // Too far in future
            };

            // Run validators
            for (const validator of validateNotificationBody) {
                await validator.run(mockReq);
            }

            handleValidationErrors(mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalled();
            const jsonCall = mockRes.json.mock.calls[0][0];
            expect(jsonCall.details.length).toBeGreaterThanOrEqual(2);
            expect(mockNext).not.toHaveBeenCalled();
        });

        test('should use req.log if available', async () => {
            const mockLogger = {
                warn: jest.fn(),
            };
            mockReq.log = mockLogger;
            mockReq.body = {
                message: 12345, // Invalid
            };

            // Run validators
            for (const validator of validateNotificationBody) {
                await validator.run(mockReq);
            }

            handleValidationErrors(mockReq, mockRes, mockNext);

            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.objectContaining({
                    path: '/test',
                    method: 'POST',
                    security: 'input-validation',
                }),
                'Input validation failed'
            );
        });
    });
});
