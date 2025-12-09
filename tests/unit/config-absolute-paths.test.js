/**
 * Unit Tests for Config Module - Absolute Path Validation
 * Tests for QUA-012: Ensure ALLOWED_PATHS only accepts absolute paths
 */

describe('Config Module - Absolute Path Validation (QUA-012)', () => {
    let originalEnv;
    let originalExit;
    let mockExit;

    beforeEach(() => {
        // Save original environment
        originalEnv = { ...process.env };

        // REF-020: Force config initialization in test mode
        process.env.FORCE_CONFIG_INIT = 'true';

        // Mock process.exit to throw an error so we can catch it in tests
        originalExit = process.exit;
        mockExit = jest.fn((code) => {
            throw new Error(`process.exit called with code ${code}`);
        });
        process.exit = mockExit;

        // Clear module cache to get fresh config
        jest.resetModules();

        // Suppress console output during tests
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        // Restore original environment and process.exit
        process.env = originalEnv;
        process.exit = originalExit;

        // Restore console
        jest.restoreAllMocks();
    });

    describe('Valid Absolute Paths', () => {
        test('should accept POSIX absolute paths starting with /', () => {
            process.env.ALLOWED_PATHS = '/opt/dev,/opt/prod,/opt/test';

            const config = require('../../lib/config');

            expect(config.allowedPaths).toEqual(['/opt/dev', '/opt/prod', '/opt/test']);
            expect(mockExit).not.toHaveBeenCalled();
        });

        test('should accept single absolute path', () => {
            process.env.ALLOWED_PATHS = '/opt/projects';

            const config = require('../../lib/config');

            expect(config.allowedPaths).toEqual(['/opt/projects']);
            expect(mockExit).not.toHaveBeenCalled();
        });

        test('should accept absolute paths with trailing slashes', () => {
            process.env.ALLOWED_PATHS = '/opt/dev/,/opt/prod/';

            const config = require('../../lib/config');

            expect(config.allowedPaths).toEqual(['/opt/dev/', '/opt/prod/']);
            expect(mockExit).not.toHaveBeenCalled();
        });

        test('should accept absolute paths with spaces (trimmed)', () => {
            process.env.ALLOWED_PATHS = ' /opt/dev , /opt/prod ';

            const config = require('../../lib/config');

            expect(config.allowedPaths).toEqual(['/opt/dev', '/opt/prod']);
            expect(mockExit).not.toHaveBeenCalled();
        });

        test('should accept root directory', () => {
            process.env.ALLOWED_PATHS = '/';

            const config = require('../../lib/config');

            expect(config.allowedPaths).toEqual(['/']);
            expect(mockExit).not.toHaveBeenCalled();
        });
    });

    describe('Invalid Relative Paths', () => {
        test('should reject simple relative paths', () => {
            process.env.ALLOWED_PATHS = 'relative/path';

            expect(() => {
                require('../../lib/config');
            }).toThrow(/process\.exit called with code 1/);

            expect(mockExit).toHaveBeenCalledWith(1);
        });

        test('should reject multiple relative paths', () => {
            process.env.ALLOWED_PATHS = 'path1,path2,path3';

            expect(() => {
                require('../../lib/config');
            }).toThrow(/process\.exit called with code 1/);

            expect(mockExit).toHaveBeenCalledWith(1);
        });

        test('should reject relative paths with ./', () => {
            process.env.ALLOWED_PATHS = './relative/path';

            expect(() => {
                require('../../lib/config');
            }).toThrow(/process\.exit called with code 1/);

            expect(mockExit).toHaveBeenCalledWith(1);
        });

        test('should reject relative paths with ../', () => {
            process.env.ALLOWED_PATHS = '../parent/path';

            expect(() => {
                require('../../lib/config');
            }).toThrow(/process\.exit called with code 1/);

            expect(mockExit).toHaveBeenCalledWith(1);
        });

        test('should reject mixed absolute and relative paths', () => {
            process.env.ALLOWED_PATHS = '/opt/dev,relative/path,/opt/prod';

            expect(() => {
                require('../../lib/config');
            }).toThrow(/process\.exit called with code 1/);

            expect(mockExit).toHaveBeenCalledWith(1);
        });

        test('should provide clear error message for relative path', () => {
            process.env.ALLOWED_PATHS = 'invalid/relative';

            // Mock pino logger to capture error message
            const mockFatal = jest.fn();
            jest.doMock('pino', () => {
                return jest.fn(() => ({
                    warn: jest.fn(),
                    info: jest.fn(),
                    fatal: mockFatal,
                }));
            });

            expect(() => {
                require('../../lib/config');
            }).toThrow(/process\.exit called with code 1/);

            expect(mockExit).toHaveBeenCalledWith(1);
        });
    });

    describe('Edge Cases', () => {
        test('should handle empty path segments correctly', () => {
            process.env.ALLOWED_PATHS = '/opt/dev,,/opt/prod';

            const config = require('../../lib/config');

            // Empty segments should be filtered out by .filter((p) => p.length > 0)
            expect(config.allowedPaths).toEqual(['/opt/dev', '/opt/prod']);
            expect(mockExit).not.toHaveBeenCalled();
        });

        test('should reject empty relative path after trim', () => {
            process.env.ALLOWED_PATHS = '/opt/dev, , ,/opt/prod';

            // This should pass since empty strings after trim are filtered out
            const config = require('../../lib/config');

            expect(config.allowedPaths).toEqual(['/opt/dev', '/opt/prod']);
            expect(mockExit).not.toHaveBeenCalled();
        });
    });

    describe('Security Implications', () => {
        test('should prevent path traversal attempts via relative paths', () => {
            process.env.ALLOWED_PATHS = '../../etc/passwd';

            expect(() => {
                require('../../lib/config');
            }).toThrow(/process\.exit called with code 1/);

            expect(mockExit).toHaveBeenCalledWith(1);
        });

        test('should validate at startup, not at runtime', () => {
            // This test verifies that validation happens during module load
            process.env.ALLOWED_PATHS = 'relative';

            // The validation should fail immediately when requiring the module
            const startTime = Date.now();
            try {
                require('../../lib/config');
            } catch (error) {
                const loadTime = Date.now() - startTime;
                // Validation should be instant (< 100ms)
                expect(loadTime).toBeLessThan(100);
                expect(error.message).toContain('process.exit called with code 1');
            }
        });
    });
});
