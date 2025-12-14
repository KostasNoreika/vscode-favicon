/**
 * Unit Tests for Health Routes Module
 * Tests status code mapping helper and route logic
 */

const { getStatusCode } = require('../../lib/routes/health-routes');

describe('Health Routes Module', () => {
    describe('getStatusCode()', () => {
        describe('Healthy states return 200', () => {
            test('should return 200 for "healthy" status', () => {
                expect(getStatusCode('healthy')).toBe(200);
            });

            test('should return 200 for "ok" status', () => {
                expect(getStatusCode('ok')).toBe(200);
            });

            test('should return 200 for "ready" status', () => {
                expect(getStatusCode('ready')).toBe(200);
            });

            test('should return 200 for "alive" status', () => {
                expect(getStatusCode('alive')).toBe(200);
            });
        });

        describe('Degraded state returns 200', () => {
            test('should return 200 for "degraded" status', () => {
                expect(getStatusCode('degraded')).toBe(200);
            });
        });

        describe('Unhealthy states return 503', () => {
            test('should return 503 for "unhealthy" status', () => {
                expect(getStatusCode('unhealthy')).toBe(503);
            });

            test('should return 503 for "not_ready" status', () => {
                expect(getStatusCode('not_ready')).toBe(503);
            });

            test('should return 503 for "error" status', () => {
                expect(getStatusCode('error')).toBe(503);
            });

            test('should return 503 for unknown status', () => {
                expect(getStatusCode('unknown')).toBe(503);
            });

            test('should return 503 for null status', () => {
                expect(getStatusCode(null)).toBe(503);
            });

            test('should return 503 for undefined status', () => {
                expect(getStatusCode(undefined)).toBe(503);
            });

            test('should return 503 for empty string status', () => {
                expect(getStatusCode('')).toBe(503);
            });
        });

        describe('Case insensitivity', () => {
            test('should handle uppercase "HEALTHY"', () => {
                expect(getStatusCode('HEALTHY')).toBe(200);
            });

            test('should handle mixed case "Ok"', () => {
                expect(getStatusCode('Ok')).toBe(200);
            });

            test('should handle uppercase "READY"', () => {
                expect(getStatusCode('READY')).toBe(200);
            });

            test('should handle mixed case "Degraded"', () => {
                expect(getStatusCode('Degraded')).toBe(200);
            });

            test('should handle uppercase "NOT_READY"', () => {
                expect(getStatusCode('NOT_READY')).toBe(503);
            });
        });

        describe('Edge cases', () => {
            test('should handle status with leading/trailing spaces', () => {
                expect(getStatusCode('  ok  ')).toBe(503); // Won't match without explicit trim
            });

            test('should handle numeric input', () => {
                expect(getStatusCode(200)).toBe(503);
            });

            test('should handle object input', () => {
                expect(getStatusCode({ status: 'ok' })).toBe(503);
            });

            test('should handle array input that stringifies to valid status', () => {
                // String(['ok']) becomes 'ok' which is a valid status
                expect(getStatusCode(['ok'])).toBe(200);
            });

            test('should handle array input that stringifies to invalid status', () => {
                // String(['invalid']) becomes 'invalid' which is not a valid status
                expect(getStatusCode(['invalid'])).toBe(503);
            });
        });
    });
});
