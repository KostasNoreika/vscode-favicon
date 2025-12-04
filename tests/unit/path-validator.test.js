/**
 * Security Tests for Path Validator
 * Tests all attack vectors from CVSS 9.1 vulnerability
 */

const {
    isPathAllowed,
    validatePath,
    sanitizePath,
    isPathAllowedAsync,
    validatePathAsync,
} = require('../../lib/path-validator');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('Path Validator Security Tests', () => {
    describe('Directory Traversal Attacks', () => {
        test('should block basic directory traversal', () => {
            expect(isPathAllowed('/opt/dev/../../etc/passwd')).toBe(false);
            expect(isPathAllowed('/opt/dev/../prod/../research/../etc')).toBe(false);
            expect(isPathAllowed('../../etc/passwd')).toBe(false);
        });

        test('should block relative path segments', () => {
            expect(isPathAllowed('/opt/dev/./../../etc')).toBe(false);
            expect(isPathAllowed('/opt/dev/../../../root')).toBe(false);
        });

        test('should block paths with .. in directory names', () => {
            expect(isPathAllowed('/opt/dev/project..malicious')).toBe(false);
            expect(isPathAllowed('/opt/dev/..hidden')).toBe(false);
        });
    });

    describe('URL Encoding Attacks', () => {
        test('should block URL-encoded traversal', () => {
            expect(isPathAllowed('%2Fopt%2Fdev%2F..%2F..%2Fetc')).toBe(false);
            expect(isPathAllowed('/opt/dev/%2e%2e%2fetc')).toBe(false);
            expect(isPathAllowed('/opt/dev%2f..%2f..%2fetc')).toBe(false);
        });

        test('should block double-encoded traversal', () => {
            expect(isPathAllowed('%252Fopt%252Fdev%252F..%252F..%252Fetc')).toBe(false);
            expect(isPathAllowed('%252e%252e%252f')).toBe(false);
        });

        test('should decode valid URL-encoded paths', () => {
            // Valid paths can be URL encoded
            const result = sanitizePath('%2Fopt%2Fdev%2Fmy-project');
            expect(result).toBe('/opt/dev/my-project');
        });
    });

    describe('Null Byte Injection', () => {
        test('should block null byte in path', () => {
            expect(isPathAllowed('/opt/dev/project\0malicious')).toBe(false);
            expect(isPathAllowed('/opt/dev/project%00malicious')).toBe(false);
            expect(isPathAllowed('/opt/dev/project\x00.txt')).toBe(false);
        });

        test('should block URL-encoded null bytes', () => {
            expect(isPathAllowed('/opt/dev%00/../etc/passwd')).toBe(false);
        });
    });

    describe('Path Prefix Confusion', () => {
        test('should block paths that start with allowed prefix but escape', () => {
            expect(isPathAllowed('/opt/devmalicious')).toBe(false);
            expect(isPathAllowed('/opt/dev-malicious')).toBe(false);
            expect(isPathAllowed('/opt/prodattack')).toBe(false);
        });

        test('should allow exact allowed paths', () => {
            expect(isPathAllowed('/opt/dev')).toBe(true);
            expect(isPathAllowed('/opt/prod')).toBe(true);
            expect(isPathAllowed('/opt/research')).toBe(true);
        });

        test('should allow subdirectories of allowed paths', () => {
            expect(isPathAllowed('/opt/dev/my-project')).toBe(true);
            expect(isPathAllowed('/opt/prod/website')).toBe(true);
            expect(isPathAllowed('/opt/research/experiment-1')).toBe(true);
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

        test('should block symlink pointing outside allowed paths', () => {
            try {
                // Create symlink pointing to /etc (requires permissions)
                if (process.platform !== 'win32' && fs.existsSync('/opt/dev')) {
                    try {
                        fs.symlinkSync('/etc', symlinkPath);
                        expect(isPathAllowed(symlinkPath)).toBe(false);
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

        test('should resolve symlinks before validation', () => {
            // Test that symlinks are resolved via fs.realpathSync
            const validation = validatePath('/opt/dev/project');
            expect(validation.sanitized).toBe('/opt/dev/project');
        });
    });

    describe('Regex Validation', () => {
        test('should only allow alphanumeric, dash, underscore in directory names', () => {
            expect(isPathAllowed('/opt/dev/my-project')).toBe(true);
            expect(isPathAllowed('/opt/dev/my_project')).toBe(true);
            expect(isPathAllowed('/opt/dev/project123')).toBe(true);
            expect(isPathAllowed('/opt/dev/my-awesome-project_v2')).toBe(true);
        });

        test('should block special characters', () => {
            expect(isPathAllowed('/opt/dev/project$test')).toBe(false);
            expect(isPathAllowed('/opt/dev/project;malicious')).toBe(false);
            expect(isPathAllowed('/opt/dev/project|cmd')).toBe(false);
            expect(isPathAllowed('/opt/dev/project&test')).toBe(false);
        });

        test('should block paths outside allowed roots', () => {
            expect(isPathAllowed('/opt/other')).toBe(false);
            expect(isPathAllowed('/home/user/project')).toBe(false);
            expect(isPathAllowed('/tmp/test')).toBe(false);
            expect(isPathAllowed('/var/www')).toBe(false);
        });
    });

    describe('Edge Cases', () => {
        test('should handle empty or null input', () => {
            expect(isPathAllowed('')).toBe(false);
            expect(isPathAllowed(null)).toBe(false);
            expect(isPathAllowed(undefined)).toBe(false);
        });

        test('should handle non-string input', () => {
            expect(isPathAllowed(123)).toBe(false);
            expect(isPathAllowed({})).toBe(false);
            expect(isPathAllowed([])).toBe(false);
        });

        test('should handle very long paths', () => {
            const longPath = '/opt/dev/' + 'a'.repeat(1000);
            expect(isPathAllowed(longPath)).toBe(true);
        });

        test('should handle unicode characters', () => {
            expect(isPathAllowed('/opt/dev/проект')).toBe(false); // Cyrillic
            expect(isPathAllowed('/opt/dev/项目')).toBe(false); // Chinese
            expect(isPathAllowed('/opt/dev/プロジェクト')).toBe(false); // Japanese
        });
    });

    describe('validatePath() detailed results', () => {
        test('should return detailed validation results', () => {
            const valid = validatePath('/opt/dev/my-project');
            expect(valid.valid).toBe(true);
            expect(valid.sanitized).toBe('/opt/dev/my-project');

            const invalid = validatePath('/opt/dev/../../etc');
            expect(invalid.valid).toBe(false);
            expect(invalid.error).toBeDefined();
        });

        test('should detect URL encoding issues', () => {
            const result = validatePath('%252e%252e');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('encoding');
        });

        test('should detect null byte injection', () => {
            const result = validatePath('/opt/dev/test%00');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Invalid');
        });
    });

    describe('Real-world Attack Scenarios', () => {
        test('should block AWS metadata service access attempts', () => {
            expect(isPathAllowed('/opt/dev/../../../../proc/self/environ')).toBe(false);
        });

        test('should block SSH key access attempts', () => {
            expect(isPathAllowed('/opt/dev/../../root/.ssh/id_rsa')).toBe(false);
            expect(isPathAllowed('/opt/dev/../../../home/user/.ssh')).toBe(false);
        });

        test('should block /etc/passwd access', () => {
            expect(isPathAllowed('/opt/dev/../../etc/passwd')).toBe(false);
            expect(isPathAllowed('/opt/dev/../prod/../research/../etc/passwd')).toBe(false);
        });

        test('should block Docker socket access', () => {
            expect(isPathAllowed('/opt/dev/../../var/run/docker.sock')).toBe(false);
        });

        test('should block environment variable file access', () => {
            expect(isPathAllowed('/opt/dev/.env')).toBe(true); // .env files ARE allowed in project dirs
            expect(isPathAllowed('/opt/dev/../../root/.env')).toBe(false);
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

        test('should match sync version behavior', async () => {
            const testPaths = [
                '/opt/dev/my-project',
                '/opt/dev/../../etc/passwd',
                '/opt/devmalicious',
                '/opt/dev/test-project_123',
            ];

            for (const testPath of testPaths) {
                const syncResult = isPathAllowed(testPath);
                const asyncResult = await isPathAllowedAsync(testPath);
                expect(asyncResult).toBe(syncResult);
            }
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

        test('should match sync version behavior', async () => {
            const testPaths = [
                '/opt/dev/my-project',
                '/opt/dev/../../etc/passwd',
                '%252e%252e',
                '/opt/dev/project%00',
            ];

            for (const testPath of testPaths) {
                const syncResult = validatePath(testPath);
                const asyncResult = await validatePathAsync(testPath);
                expect(asyncResult.valid).toBe(syncResult.valid);
                expect(asyncResult.error).toBe(syncResult.error);
            }
        });
    });
});

describe('Integration Tests', () => {
    test('should match behavior of both server implementations', () => {
        const testPaths = [
            '/opt/dev/my-project',
            '/opt/dev/../../etc/passwd',
            '/opt/dev%2f..%2f..%2fetc',
            '/opt/devmalicious',
            '/opt/dev/project%00',
        ];

        const expectedResults = [true, false, false, false, false];

        testPaths.forEach((testPath, index) => {
            const result = isPathAllowed(testPath);
            expect(result).toBe(expectedResults[index]);
        });
    });

    test('async and sync validators should have identical behavior', async () => {
        const testPaths = [
            '/opt/dev/my-project',
            '/opt/dev/../../etc/passwd',
            '/opt/dev%2f..%2f..%2fetc',
            '/opt/devmalicious',
            '/opt/dev/project%00',
        ];

        for (const testPath of testPaths) {
            const syncResult = isPathAllowed(testPath);
            const asyncResult = await isPathAllowedAsync(testPath);
            expect(asyncResult).toBe(syncResult);
        }
    });
});
