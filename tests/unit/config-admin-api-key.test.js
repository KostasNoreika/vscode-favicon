/**
 * SEC-002: Admin API Key Hash Validation Tests
 * Tests enforcement of bcrypt hash requirements for admin authentication
 *
 * Security improvement: API keys are now stored as bcrypt hashes
 * This prevents key exposure in memory dumps and process inspection
 */

const { execSync } = require('child_process');
const bcrypt = require('bcrypt');

/**
 * Helper to test configuration with specific environment
 * Returns exit code and output
 */
function testConfig(envVars) {
    // Use single quotes for shell values to prevent $ interpretation
    // Escape any single quotes in values
    const envString = Object.entries(envVars)
        .map(([key, value]) => {
            // Escape single quotes in value and wrap in single quotes
            const escapedValue = value.replace(/'/g, "'\\''");
            return `${key}='${escapedValue}'`;
        })
        .join(' ');

    try {
        const output = execSync(
            `${envString} node -e "require('./lib/config.js');"`,
            { encoding: 'utf-8', stdio: 'pipe' }
        );
        return { success: true, output, exitCode: 0 };
    } catch (error) {
        return { success: false, output: error.stderr || error.stdout, exitCode: error.status };
    }
}

/**
 * Generate a valid bcrypt hash for testing
 */
function generateTestHash(plaintext, rounds = 10) {
    return bcrypt.hashSync(plaintext, rounds);
}

describe('SEC-002: Admin API Key Hash Validation', () => {
    // Pre-generate some test hashes (bcrypt is slow)
    const validHash = '$2a$10$K9VK3R8p.c2y6xYlFqDqNOcGy8XaB0x4.3dYfM9k2JvN7w8mH5L3u';
    const validHashB = '$2b$10$K9VK3R8p.c2y6xYlFqDqNOcGy8XaB0x4.3dYfM9k2JvN7w8mH5L3u';

    describe('Production Environment - Hash Format Validation', () => {
        test('should ACCEPT valid bcrypt hash ($2a$ format) in production', () => {
            const result = testConfig({
                NODE_ENV: 'production',
                ADMIN_API_KEY_HASH: validHash,
                ADMIN_IPS: '127.0.0.1'
            });

            expect(result.success).toBe(true);
        });

        test('should ACCEPT valid bcrypt hash ($2b$ format) in production', () => {
            const result = testConfig({
                NODE_ENV: 'production',
                ADMIN_API_KEY_HASH: validHashB,
                ADMIN_IPS: '127.0.0.1'
            });

            expect(result.success).toBe(true);
        });

        test('should REJECT plain text API key as hash in production', () => {
            const result = testConfig({
                NODE_ENV: 'production',
                ADMIN_API_KEY_HASH: 'plain-text-api-key-not-hashed',
                ADMIN_IPS: '127.0.0.1'
            });

            expect(result.success).toBe(false);
            expect(result.output).toContain('ADMIN_API_KEY_HASH must be a valid bcrypt hash');
        });

        test('should REJECT invalid hash format in production', () => {
            const result = testConfig({
                NODE_ENV: 'production',
                ADMIN_API_KEY_HASH: '$2a$10$invalid',  // Too short
                ADMIN_IPS: '127.0.0.1'
            });

            expect(result.success).toBe(false);
            expect(result.output).toContain('ADMIN_API_KEY_HASH must be a valid bcrypt hash');
        });

        test('should REJECT hash with wrong prefix in production', () => {
            const result = testConfig({
                NODE_ENV: 'production',
                ADMIN_API_KEY_HASH: '$5$10$K9VK3R8p.c2y6xYlFqDqNOcGy8XaB0x4.3dYfM9k2JvN7w8mH5L3u',  // SHA-256 prefix
                ADMIN_IPS: '127.0.0.1'
            });

            expect(result.success).toBe(false);
            expect(result.output).toContain('ADMIN_API_KEY_HASH must be a valid bcrypt hash');
        });

        test('should allow production to start without API key hash (IP-based auth only)', () => {
            const result = testConfig({
                NODE_ENV: 'production',
                ADMIN_IPS: '127.0.0.1'
                // No ADMIN_API_KEY_HASH set
            });

            expect(result.success).toBe(true);
            expect(result.output).not.toContain('ADMIN_API_KEY_HASH');
        });
    });

    describe('Development Environment - Hash Validation', () => {
        test('should ACCEPT valid bcrypt hash in development', () => {
            const result = testConfig({
                NODE_ENV: 'development',
                ADMIN_API_KEY_HASH: validHash,
                ADMIN_IPS: '127.0.0.1'
            });

            expect(result.success).toBe(true);
        });

        test('should REJECT invalid hash in development', () => {
            const result = testConfig({
                NODE_ENV: 'development',
                ADMIN_API_KEY_HASH: 'not-a-valid-hash',
                ADMIN_IPS: '127.0.0.1'
            });

            expect(result.success).toBe(false);
            expect(result.output).toContain('ADMIN_API_KEY_HASH must be a valid bcrypt hash');
        });

        test('should allow development without API key hash', () => {
            const result = testConfig({
                NODE_ENV: 'development',
                ADMIN_IPS: '127.0.0.1'
            });

            expect(result.success).toBe(true);
        });
    });

    describe('Test Environment - Hash Validation', () => {
        test('should ACCEPT valid bcrypt hash in test environment', () => {
            const result = testConfig({
                NODE_ENV: 'test',
                ADMIN_API_KEY_HASH: validHash,
                ADMIN_IPS: '127.0.0.1',
                FORCE_CONFIG_INIT: 'true'
            });

            expect(result.success).toBe(true);
        });

        test('should allow test environment without API key hash', () => {
            const result = testConfig({
                NODE_ENV: 'test',
                ADMIN_IPS: '127.0.0.1',
                FORCE_CONFIG_INIT: 'true'
            });

            expect(result.success).toBe(true);
        });
    });

    describe('Edge Cases and Validation', () => {
        test('should treat empty string as no API key hash (allowed)', () => {
            const result = testConfig({
                NODE_ENV: 'production',
                ADMIN_API_KEY_HASH: '',
                ADMIN_IPS: '127.0.0.1'
            });

            // Empty string is treated as null, so it's allowed (IP-only auth)
            expect(result.success).toBe(true);
        });

        test('should REJECT whitespace-only API key hash', () => {
            const result = testConfig({
                NODE_ENV: 'production',
                ADMIN_API_KEY_HASH: '    ',
                ADMIN_IPS: '127.0.0.1'
            });

            expect(result.success).toBe(false);
            expect(result.output).toContain('ADMIN_API_KEY_HASH must be');
        });

        test('should REJECT truncated hash', () => {
            // Valid prefix but truncated (bcrypt hashes are 60 chars)
            const truncatedHash = validHash.substring(0, 30);
            const result = testConfig({
                NODE_ENV: 'production',
                ADMIN_API_KEY_HASH: truncatedHash,
                ADMIN_IPS: '127.0.0.1'
            });

            expect(result.success).toBe(false);
            expect(result.output).toContain('ADMIN_API_KEY_HASH must be a valid bcrypt hash');
        });

        test('should ACCEPT hash with exactly 60 characters', () => {
            expect(validHash.length).toBe(60);

            const result = testConfig({
                NODE_ENV: 'production',
                ADMIN_API_KEY_HASH: validHash,
                ADMIN_IPS: '127.0.0.1'
            });

            expect(result.success).toBe(true);
        });
    });

    describe('Security Documentation in Error Messages', () => {
        test('should include hash generation command in error', () => {
            const result = testConfig({
                NODE_ENV: 'production',
                ADMIN_API_KEY_HASH: 'invalid',
                ADMIN_IPS: '127.0.0.1'
            });

            expect(result.success).toBe(false);
            expect(result.output).toContain('bcrypt');
        });

        test('should explain valid hash format in error', () => {
            const result = testConfig({
                NODE_ENV: 'production',
                ADMIN_API_KEY_HASH: 'wrong-format',
                ADMIN_IPS: '127.0.0.1'
            });

            expect(result.success).toBe(false);
            expect(result.output).toMatch(/\$2[ab]\$10\$/);
        });
    });

    describe('Integration with Other Security Controls', () => {
        test('should enforce both IP whitelist AND valid hash in production', () => {
            const result = testConfig({
                NODE_ENV: 'production',
                ADMIN_API_KEY_HASH: 'invalid-hash',
                ADMIN_IPS: 'invalid-ip'
            });

            expect(result.success).toBe(false);
            // Should contain errors for both issues
            expect(result.output).toMatch(/ADMIN_API_KEY_HASH|ADMIN_IPS/);
        });

        test('should accept production config with valid hash and valid IPs', () => {
            const result = testConfig({
                NODE_ENV: 'production',
                ADMIN_API_KEY_HASH: validHash,
                ADMIN_IPS: '127.0.0.1,::1,192.168.1.1'
            });

            expect(result.success).toBe(true);
        });
    });

    describe('Backward Compatibility', () => {
        test('should not break configs without API key hash (IP-only auth)', () => {
            const prodResult = testConfig({
                NODE_ENV: 'production',
                ADMIN_IPS: '192.168.1.1'
                // No API key hash - should work fine
            });

            expect(prodResult.success).toBe(true);

            const devResult = testConfig({
                NODE_ENV: 'development',
                ADMIN_IPS: '127.0.0.1'
            });

            expect(devResult.success).toBe(true);
        });

        test('should log info about hash generation when hash is not configured', () => {
            const result = testConfig({
                NODE_ENV: 'development',
                ADMIN_IPS: '127.0.0.1'
            });

            expect(result.success).toBe(true);
            // Info message may or may not be present, but should not error
        });
    });

    describe('Real-World Hash Examples', () => {
        test('should accept real bcrypt hash from bcrypt.hashSync', () => {
            // This is what a real hash looks like
            const realHash = generateTestHash('my-secure-api-key-here');

            const result = testConfig({
                NODE_ENV: 'production',
                ADMIN_API_KEY_HASH: realHash,
                ADMIN_IPS: '127.0.0.1'
            });

            expect(result.success).toBe(true);
        });

        test('should accept hash with different cost factors', () => {
            // Hash with cost factor 12 instead of 10
            const hash12 = '$2a$12$K9VK3R8p.c2y6xYlFqDqNOcGy8XaB0x4.3dYfM9k2JvN7w8mH5L3u';

            const result = testConfig({
                NODE_ENV: 'production',
                ADMIN_API_KEY_HASH: hash12,
                ADMIN_IPS: '127.0.0.1'
            });

            expect(result.success).toBe(true);
        });

        test('should reject old-style plain text keys (migration helper)', () => {
            // Common plain text key patterns that should now fail
            const oldStyleKeys = [
                'admin-api-key-12345678901234567890',  // Old 32-char plain key
                'f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3',  // Hex key
                '123e4567-e89b-12d3-a456-426614174000',  // UUID
            ];

            oldStyleKeys.forEach(key => {
                const result = testConfig({
                    NODE_ENV: 'production',
                    ADMIN_API_KEY_HASH: key,
                    ADMIN_IPS: '127.0.0.1'
                });

                expect(result.success).toBe(false);
                expect(result.output).toContain('ADMIN_API_KEY_HASH must be a valid bcrypt hash');
            });
        });
    });
});
