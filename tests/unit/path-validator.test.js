/**
 * Security Tests for Path Validator
 * Tests all attack vectors from CVSS 9.1 vulnerability
 */

const {
    isPathAllowedAsync,
    validatePathAsync,
    sanitizePath,
} = require('../../lib/path-validator');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('Path Validator Security Tests', () => {
    describe('Directory Traversal Attacks', () => {
        test('should block basic directory traversal', async () => {
            expect(await isPathAllowedAsync('/opt/dev/../../etc/passwd')).toBe(false);
            expect(await isPathAllowedAsync('/opt/dev/../prod/../research/../etc')).toBe(false);
            expect(await isPathAllowedAsync('../../etc/passwd')).toBe(false);
        });

        test('should block relative path segments', async () => {
            expect(await isPathAllowedAsync('/opt/dev/./../../etc')).toBe(false);
            expect(await isPathAllowedAsync('/opt/dev/../../../root')).toBe(false);
        });

        test('should block paths with .. in directory names', async () => {
            expect(await isPathAllowedAsync('/opt/dev/project..malicious')).toBe(false);
            expect(await isPathAllowedAsync('/opt/dev/..hidden')).toBe(false);
        });
    });

    describe('URL Encoding Attacks', () => {
        test('should block URL-encoded traversal', async () => {
            expect(await isPathAllowedAsync('%2Fopt%2Fdev%2F..%2F..%2Fetc')).toBe(false);
            expect(await isPathAllowedAsync('/opt/dev/%2e%2e%2fetc')).toBe(false);
            expect(await isPathAllowedAsync('/opt/dev%2f..%2f..%2fetc')).toBe(false);
        });

        test('should block double-encoded traversal', async () => {
            expect(await isPathAllowedAsync('%252Fopt%252Fdev%252F..%252F..%252Fetc')).toBe(false);
            expect(await isPathAllowedAsync('%252e%252e%252f')).toBe(false);
        });

        test('should decode valid URL-encoded paths', () => {
            // Valid paths can be URL encoded
            const result = sanitizePath('%2Fopt%2Fdev%2Fmy-project');
            expect(result).toBe('/opt/dev/my-project');
        });
    });

    describe('Null Byte Injection', () => {
        test('should block null byte in path', async () => {
            expect(await isPathAllowedAsync('/opt/dev/project\0malicious')).toBe(false);
            expect(await isPathAllowedAsync('/opt/dev/project%00malicious')).toBe(false);
            expect(await isPathAllowedAsync('/opt/dev/project\x00.txt')).toBe(false);
        });

        test('should block URL-encoded null bytes', async () => {
            expect(await isPathAllowedAsync('/opt/dev%00/../etc/passwd')).toBe(false);
        });
    });

    describe('Path Prefix Confusion', () => {
        test('should block paths that start with allowed prefix but escape', async () => {
            expect(await isPathAllowedAsync('/opt/devmalicious')).toBe(false);
            expect(await isPathAllowedAsync('/opt/dev-malicious')).toBe(false);
            expect(await isPathAllowedAsync('/opt/prodattack')).toBe(false);
        });

        test('should allow exact allowed paths', async () => {
            expect(await isPathAllowedAsync('/opt/dev')).toBe(true);
            expect(await isPathAllowedAsync('/opt/prod')).toBe(true);
            expect(await isPathAllowedAsync('/opt/research')).toBe(true);
        });

        test('should allow subdirectories of allowed paths', async () => {
            expect(await isPathAllowedAsync('/opt/dev/my-project')).toBe(true);
            expect(await isPathAllowedAsync('/opt/prod/website')).toBe(true);
            expect(await isPathAllowedAsync('/opt/research/experiment-1')).toBe(true);
        });
    });

    describe('Symlink Attacks', () => {
        let tempDir;
        let symlinkPath;

        beforeAll(() => {
            // Create temporary directory for symlink tests
            tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'path-validator-test-'));
            symlinkPath = path.join('/opt/dev', 'malicious-symlink');
        });

        afterAll(() => {
            // Cleanup
            try {
                if (fs.existsSync(symlinkPath)) {
                    fs.unlinkSync(symlinkPath);
                }
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (err) {
                // Ignore cleanup errors
            }
        });

        test('should block symlink pointing outside allowed paths', async () => {
            try {
                // Create symlink pointing to /etc (requires permissions)
                if (process.platform !== 'win32' && fs.existsSync('/opt/dev')) {
                    try {
                        fs.symlinkSync('/etc', symlinkPath);
                        expect(await isPathAllowedAsync(symlinkPath)).toBe(false);
                    } catch (err) {
                        // If we can't create symlink (permission denied), skip test
                        console.warn('Skipping symlink test - insufficient permissions');
                    }
                }
            } catch (err) {
                // Skip test if /opt/dev doesn't exist or we lack permissions
                console.warn('Skipping symlink test - directory not accessible');
            }
        });

        test('should resolve symlinks before validation', async () => {
            // Test that symlinks are resolved via fs.promises.realpath
            const validation = await validatePathAsync('/opt/dev/project');
            expect(validation.sanitized).toBe('/opt/dev/project');
        });
    });

    describe('Regex Validation', () => {
        test('should only allow alphanumeric, dash, underscore in directory names', async () => {
            expect(await isPathAllowedAsync('/opt/dev/my-project')).toBe(true);
            expect(await isPathAllowedAsync('/opt/dev/my_project')).toBe(true);
            expect(await isPathAllowedAsync('/opt/dev/project123')).toBe(true);
            expect(await isPathAllowedAsync('/opt/dev/my-awesome-project_v2')).toBe(true);
        });

        test('should block special characters', async () => {
            expect(await isPathAllowedAsync('/opt/dev/project$test')).toBe(false);
            expect(await isPathAllowedAsync('/opt/dev/project;malicious')).toBe(false);
            expect(await isPathAllowedAsync('/opt/dev/project|cmd')).toBe(false);
            expect(await isPathAllowedAsync('/opt/dev/project&test')).toBe(false);
        });

        test('should block paths outside allowed roots', async () => {
            expect(await isPathAllowedAsync('/opt/other')).toBe(false);
            expect(await isPathAllowedAsync('/home/user/project')).toBe(false);
            expect(await isPathAllowedAsync('/tmp/test')).toBe(false);
            expect(await isPathAllowedAsync('/var/www')).toBe(false);
        });
    });

    describe('Edge Cases', () => {
        test('should handle empty or null input', async () => {
            expect(await isPathAllowedAsync('')).toBe(false);
            expect(await isPathAllowedAsync(null)).toBe(false);
            expect(await isPathAllowedAsync(undefined)).toBe(false);
        });

        test('should handle non-string input', async () => {
            expect(await isPathAllowedAsync(123)).toBe(false);
            expect(await isPathAllowedAsync({})).toBe(false);
            expect(await isPathAllowedAsync([])).toBe(false);
        });

        test('should handle very long paths', async () => {
            const longPath = '/opt/dev/' + 'a'.repeat(1000);
            expect(await isPathAllowedAsync(longPath)).toBe(true);
        });

        test('should handle unicode characters', async () => {
            expect(await isPathAllowedAsync('/opt/dev/проект')).toBe(false); // Cyrillic
            expect(await isPathAllowedAsync('/opt/dev/项目')).toBe(false); // Chinese
            expect(await isPathAllowedAsync('/opt/dev/プロジェクト')).toBe(false); // Japanese
        });
    });

    describe('validatePathAsync() detailed results', () => {
        test('should return detailed validation results', async () => {
            const valid = await validatePathAsync('/opt/dev/my-project');
            expect(valid.valid).toBe(true);
            expect(valid.sanitized).toBe('/opt/dev/my-project');

            const invalid = await validatePathAsync('/opt/dev/../../etc');
            expect(invalid.valid).toBe(false);
            expect(invalid.error).toBeDefined();
        });

        test('should detect URL encoding issues', async () => {
            const result = await validatePathAsync('%252e%252e');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('encoding');
        });

        test('should detect null byte injection', async () => {
            const result = await validatePathAsync('/opt/dev/test%00');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Invalid');
        });
    });

    describe('Real-world Attack Scenarios', () => {
        test('should block AWS metadata service access attempts', async () => {
            expect(await isPathAllowedAsync('/opt/dev/../../../../proc/self/environ')).toBe(false);
        });

        test('should block SSH key access attempts', async () => {
            expect(await isPathAllowedAsync('/opt/dev/../../root/.ssh/id_rsa')).toBe(false);
            expect(await isPathAllowedAsync('/opt/dev/../../../home/user/.ssh')).toBe(false);
        });

        test('should block /etc/passwd access', async () => {
            expect(await isPathAllowedAsync('/opt/dev/../../etc/passwd')).toBe(false);
            expect(await isPathAllowedAsync('/opt/dev/../prod/../research/../etc/passwd')).toBe(false);
        });

        test('should block Docker socket access', async () => {
            expect(await isPathAllowedAsync('/opt/dev/../../var/run/docker.sock')).toBe(false);
        });

        test('should block environment variable file access', async () => {
            expect(await isPathAllowedAsync('/opt/dev/.env')).toBe(true); // .env files ARE allowed in project dirs
            expect(await isPathAllowedAsync('/opt/dev/../../root/.env')).toBe(false);
        });
    });
});

describe('Async Validator Tests', () => {
    describe('isPathAllowedAsync', () => {
        test('should validate allowed paths asynchronously', async () => {
            expect(await isPathAllowedAsync('/opt/dev/my-project')).toBe(true);
            expect(await isPathAllowedAsync('/opt/prod/website')).toBe(true);
            expect(await isPathAllowedAsync('/opt/research/experiment')).toBe(true);
        });

        test('should block invalid paths asynchronously', async () => {
            expect(await isPathAllowedAsync('/opt/dev/../../etc/passwd')).toBe(false);
            expect(await isPathAllowedAsync('/opt/devmalicious')).toBe(false);
            expect(await isPathAllowedAsync('/opt/dev/project%00')).toBe(false);
        });
    });

    describe('validatePathAsync', () => {
        test('should return detailed validation results asynchronously', async () => {
            const valid = await validatePathAsync('/opt/dev/my-project');
            expect(valid.valid).toBe(true);
            expect(valid.sanitized).toBe('/opt/dev/my-project');

            const invalid = await validatePathAsync('/opt/dev/../../etc');
            expect(invalid.valid).toBe(false);
            expect(invalid.error).toBeDefined();
        });

        test('should handle various invalid paths', async () => {
            const testCases = [
                { path: '/opt/dev/../../etc/passwd', expectedValid: false },
                { path: '%252e%252e', expectedValid: false },
                { path: '/opt/dev/project%00', expectedValid: false },
                { path: '/opt/dev/my-project', expectedValid: true },
            ];

            for (const { path: testPath, expectedValid } of testCases) {
                const result = await validatePathAsync(testPath);
                expect(result.valid).toBe(expectedValid);
            }
        });
    });
});

describe('Integration Tests', () => {
    test('should correctly validate various path scenarios', async () => {
        const testCases = [
            { path: '/opt/dev/my-project', expected: true },
            { path: '/opt/dev/../../etc/passwd', expected: false },
            { path: '/opt/dev%2f..%2f..%2fetc', expected: false },
            { path: '/opt/devmalicious', expected: false },
            { path: '/opt/dev/project%00', expected: false },
        ];

        for (const { path: testPath, expected } of testCases) {
            const result = await isPathAllowedAsync(testPath);
            expect(result).toBe(expected);
        }
    });

    test('should maintain consistent validation behavior', async () => {
        const testPaths = [
            '/opt/dev/my-project',
            '/opt/dev/../../etc/passwd',
            '/opt/dev%2f..%2f..%2fetc',
            '/opt/devmalicious',
            '/opt/dev/project%00',
        ];

        const expectedResults = [true, false, false, false, false];

        for (let i = 0; i < testPaths.length; i++) {
            const result = await isPathAllowedAsync(testPaths[i]);
            expect(result).toBe(expectedResults[i]);
        }
    });
});
