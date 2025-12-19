/**
 * Admin IP Validation Tests
 * Tests for QUA-008: IP validation, IPv4/IPv6 support, and empty string handling
 */

const { execSync } = require('child_process');

/**
 * Strip ANSI color codes from string
 */
function stripAnsi(str) {
    // eslint-disable-next-line no-control-regex
    return str.replace(/\x1B\[[0-9;]*m/g, '');
}

/**
 * Helper to extract JSON from output that may contain log lines
 */
function extractJSON(output) {
    const lines = output.trim().split('\n');
    // Find the last line that starts with [ or contains adminIPs array
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (line.startsWith('[')) {
            try {
                return JSON.parse(line);
            } catch (e) {
                // Continue searching
            }
        }
    }
    throw new Error('Could not find JSON in output: ' + output);
}

describe('Config - Admin IP Validation', () => {
    describe('IP Format Validation', () => {
        test('should accept valid IPv4 addresses', () => {
            const result = execSync(
                'ADMIN_IPS="127.0.0.1,192.168.1.1,10.0.0.1" node -e "const c = require(\'./lib/config.js\'); console.log(JSON.stringify(c.adminIPs));"',
                { encoding: 'utf-8' }
            );
            const ips = extractJSON(result);
            expect(ips).toEqual(['127.0.0.1', '192.168.1.1', '10.0.0.1']);
        });

        test('should accept valid IPv6 addresses', () => {
            const result = execSync(
                'ADMIN_IPS="::1,2001:0db8:85a3:0000:0000:8a2e:0370:7334,fe80::1" node -e "const c = require(\'./lib/config.js\'); console.log(JSON.stringify(c.adminIPs));"',
                { encoding: 'utf-8' }
            );
            const ips = extractJSON(result);
            expect(ips).toContain('::1');
            expect(ips).toContain('2001:0db8:85a3:0000:0000:8a2e:0370:7334');
            expect(ips).toContain('fe80::1');
        });

        test('should accept mixed IPv4 and IPv6 addresses', () => {
            const result = execSync(
                'ADMIN_IPS="127.0.0.1,::1,192.168.1.1" node -e "const c = require(\'./lib/config.js\'); console.log(JSON.stringify(c.adminIPs));"',
                { encoding: 'utf-8' }
            );
            const ips = extractJSON(result);
            expect(ips).toEqual(['127.0.0.1', '::1', '192.168.1.1']);
        });

        test('should filter out invalid IP formats', () => {
            const result = execSync(
                'ADMIN_IPS="127.0.0.1,invalid,notanip,192.168.1" node -e "const c = require(\'./lib/config.js\'); console.log(JSON.stringify(c.adminIPs));"',
                { encoding: 'utf-8' }
            );
            const ips = extractJSON(result);
            expect(ips).toEqual(['127.0.0.1']);
        });

        test('should filter out empty strings', () => {
            const result = execSync(
                'ADMIN_IPS="127.0.0.1,,,  ,," node -e "const c = require(\'./lib/config.js\'); console.log(JSON.stringify(c.adminIPs));"',
                { encoding: 'utf-8' }
            );
            const ips = extractJSON(result);
            expect(ips).toEqual(['127.0.0.1']);
        });

        test('should trim whitespace from IP addresses', () => {
            const result = execSync(
                'ADMIN_IPS="  127.0.0.1  ,  192.168.1.1  " node -e "const c = require(\'./lib/config.js\'); console.log(JSON.stringify(c.adminIPs));"',
                { encoding: 'utf-8' }
            );
            const ips = extractJSON(result);
            expect(ips).toEqual(['127.0.0.1', '192.168.1.1']);
        });
    });

    describe('Default Behavior', () => {
        test('should use secure defaults when ADMIN_IPS is not set', () => {
            const result = execSync(
                'unset ADMIN_IPS; node -e "const c = require(\'./lib/config.js\'); console.log(JSON.stringify(c.adminIPs));"',
                { encoding: 'utf-8', shell: '/bin/bash' }
            );
            const ips = extractJSON(result);
            expect(ips).toEqual(['127.0.0.1', '::1']);
        });

        test('should use defaults when ADMIN_IPS contains only invalid IPs', () => {
            const result = execSync(
                'ADMIN_IPS="invalid,notanip,999.999.999.999" node -e "const c = require(\'./lib/config.js\'); console.log(JSON.stringify(c.adminIPs));"',
                { encoding: 'utf-8' }
            );
            const ips = extractJSON(result);
            expect(ips).toEqual(['127.0.0.1', '::1']);
        });

        test('should use defaults when ADMIN_IPS is empty string', () => {
            const result = execSync(
                'ADMIN_IPS="" node -e "const c = require(\'./lib/config.js\'); console.log(JSON.stringify(c.adminIPs));"',
                { encoding: 'utf-8' }
            );
            const ips = extractJSON(result);
            expect(ips).toEqual(['127.0.0.1', '::1']);
        });
    });

    describe('Edge Cases', () => {
        test('should reject IP addresses with invalid octets', () => {
            const result = execSync(
                'ADMIN_IPS="256.1.1.1,192.168.1.300,999.999.999.999" node -e "const c = require(\'./lib/config.js\'); console.log(JSON.stringify(c.adminIPs));"',
                { encoding: 'utf-8' }
            );
            const ips = extractJSON(result);
            // Should fall back to defaults since all are invalid
            expect(ips).toEqual(['127.0.0.1', '::1']);
        });

        test('should reject partial IPv4 addresses', () => {
            const result = execSync(
                'ADMIN_IPS="192.168.1,10.0,127" node -e "const c = require(\'./lib/config.js\'); console.log(JSON.stringify(c.adminIPs));"',
                { encoding: 'utf-8' }
            );
            const ips = extractJSON(result);
            expect(ips).toEqual(['127.0.0.1', '::1']);
        });

        test('should handle localhost variations', () => {
            const result = execSync(
                'ADMIN_IPS="127.0.0.1,::1,0.0.0.0" node -e "const c = require(\'./lib/config.js\'); console.log(JSON.stringify(c.adminIPs));"',
                { encoding: 'utf-8' }
            );
            const ips = extractJSON(result);
            expect(ips).toContain('127.0.0.1');
            expect(ips).toContain('::1');
            expect(ips).toContain('0.0.0.0');
        });
    });

    describe('Configuration Validation', () => {
        test('should validate that adminIPs is an array', () => {
            const result = execSync(
                'ADMIN_IPS="127.0.0.1,::1" node -e "const c = require(\'./lib/config.js\'); console.log(Array.isArray(c.adminIPs));"',
                { encoding: 'utf-8' }
            );
            expect(stripAnsi(result.trim().split('\n').pop())).toBe('true');
        });

        test('should validate that adminIPs has at least one entry', () => {
            const result = execSync(
                'ADMIN_IPS="127.0.0.1" node -e "const c = require(\'./lib/config.js\'); console.log(c.adminIPs.length > 0);"',
                { encoding: 'utf-8' }
            );
            expect(stripAnsi(result.trim().split('\n').pop())).toBe('true');
        });
    });
});
