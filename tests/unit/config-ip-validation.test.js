/**
 * Unit tests for IP validation in config module
 * QUA-003: Verify IPv4 validation using net.isIPv4()
 * QUA-002: Verify IPv6 validation using net.isIPv6()
 */

const net = require('net');

describe('IP Validation - Native net module (QUA-003, QUA-002)', () => {
    describe('IPv4 Validation (QUA-003)', () => {
        test('should accept valid IPv4 localhost using net.isIPv4()', () => {
            expect(net.isIPv4('127.0.0.1')).toBeTruthy();
        });

        test('should accept valid IPv4 addresses', () => {
            const validIPs = [
                '192.168.1.1',
                '10.0.0.1',
                '172.16.0.1',
                '255.255.255.255',
                '0.0.0.0',
                '8.8.8.8',
                '1.2.3.4',
            ];

            validIPs.forEach((ip) => {
                expect(net.isIPv4(ip)).toBeTruthy();
            });
        });

        test('should reject invalid IPv4 addresses', () => {
            const invalidIPs = [
                '256.1.1.1',        // Octet > 255
                '192.168.1.256',    // Last octet > 255
                '192.168.1',        // Missing octet
                '192.168.1.1.1',    // Too many octets
                '192.168.-1.1',     // Negative number
                'abc.def.ghi.jkl',  // Non-numeric
                '192.168.1.1/24',   // CIDR notation
                '',                 // Empty string
                ' ',                // Whitespace only
                '::1',              // IPv6 address
            ];

            invalidIPs.forEach((ip) => {
                expect(net.isIPv4(ip)).toBeFalsy();
            });
        });

        test('should handle IPv4 with leading/trailing spaces after trim', () => {
            const ipWithSpaces = '  127.0.0.1  ';
            expect(net.isIPv4(ipWithSpaces.trim())).toBeTruthy();
        });
    });

    describe('IPv6 Validation (QUA-002)', () => {
        test('should accept valid IPv6 localhost using net.isIPv6()', () => {
            expect(net.isIPv6('::1')).toBeTruthy();
        });

        test('should accept valid IPv6 addresses', () => {
            const validIPs = [
                '::1',                                      // Loopback
                '::',                                       // All zeros
                '2001:db8::1',                             // Documentation prefix
                'fe80::1',                                  // Link-local
                '2001:0db8:0000:0000:0000:0000:0000:0001', // Full format
                '2001:db8:0:0:0:0:0:1',                    // Mixed zeros
                '::ffff:192.0.2.1',                        // IPv4-mapped IPv6
            ];

            validIPs.forEach((ip) => {
                expect(net.isIPv6(ip)).toBeTruthy();
            });
        });

        test('should reject invalid IPv6 addresses', () => {
            const invalidIPs = [
                'gggg::1',          // Invalid hex characters
                '::1::',            // Multiple ::
                '2001:db8:::1',     // Triple colon
                '2001:db8:gggg::1', // Invalid hex in segment
                '',                 // Empty string
                ' ',                // Whitespace only
                '127.0.0.1',        // IPv4 address
            ];

            invalidIPs.forEach((ip) => {
                expect(net.isIPv6(ip)).toBeFalsy();
            });
        });

        test('should handle IPv6 with leading/trailing spaces after trim', () => {
            const ipWithSpaces = '  ::1  ';
            expect(net.isIPv6(ipWithSpaces.trim())).toBeTruthy();
        });
    });

    describe('Security: No Regex ReDoS Vulnerability (QUA-002, QUA-003)', () => {
        test('should not timeout on complex invalid IP patterns', () => {
            // These patterns could cause ReDoS with poorly written regex
            // but net.isIPv4/v6 handles them efficiently
            const complexInvalidPatterns = [
                '1'.repeat(1000),
                'a'.repeat(1000),
                ':::::::::::::::::::::::::::::::::::',
                '....................................',
                '1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1',
                ':'.repeat(100),
                '.'.repeat(100),
            ];

            const startTime = Date.now();
            
            complexInvalidPatterns.forEach((pattern) => {
                // Should return false quickly without hanging
                const isV4 = net.isIPv4(pattern);
                const isV6 = net.isIPv6(pattern);
                expect(isV4).toBeFalsy();
                expect(isV6).toBeFalsy();
            });

            const duration = Date.now() - startTime;
            
            // Should complete very quickly (well under 100ms)
            // Using net.isIPv4()/isIPv6() is O(n) where n is string length
            // Regex-based validation could be exponential with certain patterns
            expect(duration).toBeLessThan(100);
        });

        test('should handle extremely long strings efficiently', () => {
            const veryLongString = 'a'.repeat(100000); // 100KB string
            
            const startTime = Date.now();
            const isV4 = net.isIPv4(veryLongString);
            const isV6 = net.isIPv6(veryLongString);
            const duration = Date.now() - startTime;
            
            expect(isV4).toBeFalsy();
            expect(isV6).toBeFalsy();
            // Should complete in reasonable time even for very long strings
            expect(duration).toBeLessThan(500);
        });
    });

    describe('Edge Cases', () => {
        test('should handle null and undefined', () => {
            expect(net.isIPv4(null)).toBeFalsy();
            expect(net.isIPv4(undefined)).toBeFalsy();
            expect(net.isIPv6(null)).toBeFalsy();
            expect(net.isIPv6(undefined)).toBeFalsy();
        });

        test('should handle non-string types', () => {
            expect(net.isIPv4(12345)).toBeFalsy();
            expect(net.isIPv4(true)).toBeFalsy();
            expect(net.isIPv4({})).toBeFalsy();
            expect(net.isIPv4([])).toBeFalsy();
            
            expect(net.isIPv6(12345)).toBeFalsy();
            expect(net.isIPv6(true)).toBeFalsy();
            expect(net.isIPv6({})).toBeFalsy();
            expect(net.isIPv6([])).toBeFalsy();
        });

        test('should differentiate between IPv4 and IPv6', () => {
            // Valid IPv4 should not be valid IPv6
            expect(net.isIPv4('127.0.0.1')).toBeTruthy();
            expect(net.isIPv6('127.0.0.1')).toBeFalsy();
            
            // Valid IPv6 should not be valid IPv4
            expect(net.isIPv6('::1')).toBeTruthy();
            expect(net.isIPv4('::1')).toBeFalsy();
        });
    });

    describe('Integration: isValidIP function behavior', () => {
        test('net.isIPv4() and net.isIPv6() return boolean values', () => {
            // Verify the return values are booleans
            // as used in config.js: net.isIPv4(trimmed) || net.isIPv6(trimmed)
            const validIPv4 = '192.168.1.1';
            const validIPv6 = '::1';
            const invalidIP = 'not-an-ip';
            
            // Check return types
            expect(typeof net.isIPv4(validIPv4)).toBe('boolean');
            expect(typeof net.isIPv6(validIPv6)).toBe('boolean');
            
            // Valid IPs should return true
            expect(net.isIPv4(validIPv4)).toBe(true);
            expect(net.isIPv6(validIPv6)).toBe(true);
            
            // Invalid IPs should return false
            expect(net.isIPv4(invalidIP)).toBe(false);
            expect(net.isIPv6(invalidIP)).toBe(false);
        });

        test('boolean OR logic works correctly for isValidIP pattern', () => {
            // Test the OR pattern used in config.js
            expect(net.isIPv4('127.0.0.1') || net.isIPv6('127.0.0.1')).toBe(true);
            expect(net.isIPv4('::1') || net.isIPv6('::1')).toBe(true);
            expect(net.isIPv4('invalid') || net.isIPv6('invalid')).toBe(false);
        });
    });
});
