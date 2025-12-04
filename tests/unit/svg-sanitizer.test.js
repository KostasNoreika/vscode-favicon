/**
 * Security Tests for SVG Sanitizer
 *
 * Tests XSS vulnerability fixes (CVSS 8.8)
 * Covers OWASP A03:2021 - Injection / CWE-79
 */

const {
    sanitizeForSVG,
    validateProjectName,
    getCleanInitials,
    sanitizePort,
    sanitizeColor,
    createSafeSVGText,
} = require('../../lib/svg-sanitizer');

describe('SVG Sanitizer - XSS Protection', () => {
    describe('sanitizeForSVG()', () => {
        test('should escape HTML special characters', () => {
            expect(sanitizeForSVG('<script>')).toBe('&lt;script&gt;');
            expect(sanitizeForSVG('alert("xss")')).toBe('alert(&quot;xss&quot;)');
            expect(sanitizeForSVG("alert('xss')")).toBe('alert(&#x27;xss&#x27;)');
        });

        test('should prevent XSS via tag injection', () => {
            const payload = '<script>alert(1)</script>';
            const sanitized = sanitizeForSVG(payload);
            expect(sanitized).not.toContain('<script');
            expect(sanitized).toBe('&lt;script&gt;alert(1)&lt;&#x2F;script&gt;');
        });

        test('should prevent XSS via SVG event handlers', () => {
            const payload = '"><svg onload=alert(1)>';
            const sanitized = sanitizeForSVG(payload);
            // "onload" will still be present but escaped context prevents execution
            expect(sanitized).toBe('&quot;&gt;&lt;svg onload=alert(1)&gt;');
            // Verify tags are escaped
            expect(sanitized).toContain('&lt;');
            expect(sanitized).toContain('&gt;');
        });

        test('should prevent XSS via closing tag injection', () => {
            const payload = '</svg><script>alert(1)</script>';
            const sanitized = sanitizeForSVG(payload);
            expect(sanitized).not.toContain('</svg>');
            expect(sanitized).toBe('&lt;&#x2F;svg&gt;&lt;script&gt;alert(1)&lt;&#x2F;script&gt;');
        });

        test('should handle ampersand encoding first to prevent double-encoding', () => {
            const payload = '&<>"\'';
            const sanitized = sanitizeForSVG(payload);
            expect(sanitized).toBe('&amp;&lt;&gt;&quot;&#x27;');
        });

        test('should handle null/undefined input safely', () => {
            expect(sanitizeForSVG(null)).toBe('');
            expect(sanitizeForSVG(undefined)).toBe('');
            expect(sanitizeForSVG('')).toBe('');
        });

        test('should handle non-string input', () => {
            expect(sanitizeForSVG(123)).toBe('');
            expect(sanitizeForSVG({})).toBe('');
            expect(sanitizeForSVG([])).toBe('');
        });

        test('should preserve safe text content', () => {
            expect(sanitizeForSVG('MyProject')).toBe('MyProject');
            expect(sanitizeForSVG('my-project-123')).toBe('my-project-123');
        });
    });

    describe('validateProjectName()', () => {
        test('should allow safe characters only', () => {
            expect(validateProjectName('my-project')).toBe('my-project');
            expect(validateProjectName('project_name_123')).toBe('project_name_123');
            expect(validateProjectName('Project ABC')).toBe('Project ABC');
        });

        test('should remove dangerous characters', () => {
            expect(validateProjectName('<script>evil</script>')).toBe('scriptevilscript');
            expect(validateProjectName('project&nbsp;test')).toBe('projectnbsptest');
            expect(validateProjectName('test<>"\'/;')).toBe('test');
        });

        test('should limit length to 100 characters', () => {
            const longName = 'a'.repeat(200);
            const validated = validateProjectName(longName);
            expect(validated.length).toBe(100);
        });

        test('should handle empty/null input', () => {
            expect(validateProjectName('')).toBe('');
            expect(validateProjectName(null)).toBe('');
            expect(validateProjectName(undefined)).toBe('');
        });
    });

    describe('getCleanInitials()', () => {
        test('should generate safe initials from project name', () => {
            expect(getCleanInitials('my-project')).toBe('MP');
            expect(getCleanInitials('vscode_favicon')).toBe('VF');
            expect(getCleanInitials('Test Project')).toBe('TP');
        });

        test('should prevent XSS in initials generation', () => {
            const payload = '<script>alert(1)</script>';
            const initials = getCleanInitials(payload);
            expect(initials).not.toContain('<');
            expect(initials).not.toContain('>');
            // After validation: "scriptalertscript" -> "S" (first char of first word)
            expect(initials).toBe('S');
        });

        test('should return default VS for empty names', () => {
            expect(getCleanInitials('')).toBe('VS');
            expect(getCleanInitials(null)).toBe('VS');
            expect(getCleanInitials(undefined)).toBe('VS');
            expect(getCleanInitials('---')).toBe('VS');
        });

        test('should limit to 2 characters', () => {
            expect(getCleanInitials('one two three four').length).toBe(2);
            expect(getCleanInitials('one two three four')).toBe('OT');
        });

        test('should handle Unicode and special characters safely', () => {
            expect(getCleanInitials('проект-test')).toBe('T'); // non-latin removed
            expect(getCleanInitials('项目-test')).toBe('T');
        });
    });

    describe('sanitizePort()', () => {
        test('should allow valid port numbers', () => {
            expect(sanitizePort(8080)).toBe('8080');
            expect(sanitizePort('3000')).toBe('3000');
            expect(sanitizePort('80')).toBe('80');
        });

        test('should reject out-of-range ports', () => {
            expect(sanitizePort(0)).toBe('');
            expect(sanitizePort(70000)).toBe('');
            expect(sanitizePort(-1)).toBe('');
        });

        test('should reject non-numeric ports', () => {
            expect(sanitizePort('8080; rm -rf /')).toBe('');
            expect(sanitizePort('8080<script>')).toBe('');
            expect(sanitizePort('abc')).toBe('');
        });

        test('should handle null/undefined', () => {
            expect(sanitizePort(null)).toBe('');
            expect(sanitizePort(undefined)).toBe('');
            expect(sanitizePort('')).toBe('');
        });

        test('should reject injection attempts in port', () => {
            expect(sanitizePort('8080"></text><script>alert(1)</script>')).toBe('');
            expect(sanitizePort("8080' OR '1'='1")).toBe('');
        });
    });

    describe('sanitizeColor()', () => {
        test('should allow valid hex colors', () => {
            expect(sanitizeColor('#FF6B6B')).toBe('#FF6B6B');
            expect(sanitizeColor('#4ECDC4')).toBe('#4ECDC4');
            expect(sanitizeColor('#000000')).toBe('#000000');
            expect(sanitizeColor('#FFFFFF')).toBe('#FFFFFF');
        });

        test('should reject invalid color formats', () => {
            expect(sanitizeColor('red')).toBe('#45B7D1'); // default
            expect(sanitizeColor('#FFF')).toBe('#45B7D1'); // short format not allowed
            expect(sanitizeColor('rgb(255,0,0)')).toBe('#45B7D1');
        });

        test('should prevent injection via color parameter', () => {
            expect(sanitizeColor('#FF0000"/><script>alert(1)</script>')).toBe('#45B7D1');
            expect(sanitizeColor('#FF0000; background: url(evil)')).toBe('#45B7D1');
        });

        test('should handle null/undefined', () => {
            expect(sanitizeColor(null)).toBe('#45B7D1');
            expect(sanitizeColor(undefined)).toBe('#45B7D1');
            expect(sanitizeColor('')).toBe('#45B7D1');
        });

        test('should be case-insensitive for hex colors', () => {
            expect(sanitizeColor('#ff6b6b')).toBe('#ff6b6b');
            expect(sanitizeColor('#FF6B6B')).toBe('#FF6B6B');
            expect(sanitizeColor('#Ff6B6b')).toBe('#Ff6B6b');
        });
    });

    describe('createSafeSVGText()', () => {
        test('should create safe SVG text content', () => {
            const safe = createSafeSVGText('MyProject');
            expect(safe).toBe('MyProject');
            expect(safe).not.toContain('<');
            expect(safe).not.toContain('>');
        });

        test('should reject XSS patterns in text', () => {
            // XSS patterns detected BEFORE filtering
            expect(createSafeSVGText('<script>alert(1)</script>')).toBe('');
            expect(createSafeSVGText('javascript:alert(1)')).toBe('');
            expect(createSafeSVGText('<iframe src="evil">')).toBe('');
            expect(createSafeSVGText('onload=alert(1)')).toBe('');
        });

        test('should apply multiple layers of protection', () => {
            const payload = '<img src=x onerror=alert(1)>';
            const result = createSafeSVGText(payload);
            // Contains "onerror=" pattern, should be rejected
            expect(result).toBe('');
        });

        test('should handle data URI attacks', () => {
            expect(createSafeSVGText('data:text/html,<script>alert(1)</script>')).toBe('');
        });

        test('should allow safe text after pattern check', () => {
            // Text without XSS patterns passes pattern check, then gets filtered
            const safe = createSafeSVGText('my-project-2024');
            expect(safe).toBe('my-project-2024');
        });
    });
});

describe('Integration Tests - Real XSS Payloads', () => {
    test('should block OWASP XSS examples', () => {
        const payloads = [
            '<script>alert("XSS")</script>',
            '<img src=x onerror=alert(1)>',
            '"><script>alert(String.fromCharCode(88,83,83))</script>',
            '<svg/onload=alert(1)>',
            '<iframe src="javascript:alert(1)">',
            '<body onload=alert(1)>',
            '<input onfocus=alert(1) autofocus>',
            '<select onfocus=alert(1) autofocus>',
            '<textarea onfocus=alert(1) autofocus>',
            '<marquee onstart=alert(1)>',
            '</svg><script>alert(1)</script><svg>',
        ];

        payloads.forEach((payload) => {
            const initials = getCleanInitials(payload);
            // Should not contain any script tags or event handlers after processing
            expect(initials).not.toMatch(/<script/i);
            expect(initials).not.toMatch(/on\w+=/i);
            expect(initials).not.toMatch(/javascript:/i);
            // Should return safe initials or default
            expect(initials.length).toBeGreaterThan(0);
        });
    });

    test('should handle encoded XSS attempts', () => {
        // URL-encoded payloads should be handled at path-validator level
        // But sanitizer should still protect against them
        const encoded = '%3Cscript%3Ealert(1)%3C/script%3E';
        const initials = getCleanInitials(encoded);
        expect(initials).not.toContain('script');
        // After filtering: "3Cscript3Ealert13Cscript3E" -> first chars
        expect(initials).toBe('3'); // Single word, first char
    });

    test('should prevent polyglot payloads', () => {
        const polyglot =
            'jaVasCript:/*-/*`/*\\`/*\'/*"/**/(/* */oNcliCk=alert() )//%0D%0A%0d%0a//</stYle/</titLe/</teXtarEa/</scRipt/--!>\\x3csVg/<sVg/oNloAd=alert()/>';
        const initials = getCleanInitials(polyglot);
        expect(initials).not.toMatch(/javascript/i);
        expect(initials).not.toMatch(/onclick/i);
        expect(initials).not.toMatch(/<svg/i);
        // Should return filtered initials
        expect(initials.length).toBeGreaterThan(0);
    });
});

describe('Defense-in-Depth Validation', () => {
    test('should validate → sanitize → encode in correct order', () => {
        const malicious = '<script>alert(1)</script>';

        // Step 1: Validation removes dangerous chars
        const validated = validateProjectName(malicious);
        expect(validated).not.toContain('<');
        expect(validated).not.toContain('>');
        expect(validated).toBe('scriptalert1script');

        // Step 2: Sanitization encodes (but validated string is already safe)
        const sanitized = sanitizeForSVG(validated);
        expect(sanitized).toBe('scriptalert1script');

        // Step 3: Final check via getCleanInitials
        const initials = getCleanInitials(malicious);
        // "scriptalert1script" -> "S" (single word, first char only)
        expect(initials).toBe('S');
    });

    test('should protect against double-encoding bypass', () => {
        const doubleEncoded = '&lt;script&gt;';
        const result = sanitizeForSVG(doubleEncoded);
        // Should encode the already-encoded ampersands
        expect(result).toBe('&amp;lt;script&amp;gt;');
    });

    test('createSafeSVGText should reject before filtering', () => {
        // XSS pattern detected in original text -> rejected
        expect(createSafeSVGText('<script>test</script>')).toBe('');
        expect(createSafeSVGText('onclick=alert(1)')).toBe('');
        expect(createSafeSVGText('javascript:void(0)')).toBe('');

        // Safe text passes pattern check -> filtered and sanitized
        expect(createSafeSVGText('my-safe-project')).toBe('my-safe-project');
    });
});

describe('Practical Usage Scenarios', () => {
    test('should handle typical project names safely', () => {
        const projects = [
            'my-awesome-project',
            'vscode_extension_2024',
            'API Gateway v2',
            'test-123',
            'Project X',
        ];

        projects.forEach((name) => {
            const initials = getCleanInitials(name);
            expect(initials.length).toBeGreaterThan(0);
            expect(initials.length).toBeLessThanOrEqual(2);
            expect(initials).toMatch(/^[A-Z0-9]{1,2}$/);
        });
    });

    test('should handle edge cases gracefully', () => {
        expect(getCleanInitials('123')).toBe('1');
        expect(getCleanInitials('a')).toBe('A');
        expect(getCleanInitials('---test---')).toBe('T');
        expect(getCleanInitials('   ')).toBe('VS');
    });

    test('should sanitize complete SVG generation flow', () => {
        const projectName = '<script>evil</script>';
        const port = '8080';
        const color = '#FF0000';

        const initials = getCleanInitials(projectName);
        const safePort = sanitizePort(port);
        const safeColor = sanitizeColor(color);

        // All values should be safe
        expect(initials).not.toContain('<script');
        expect(safePort).toBe('8080');
        expect(safeColor).toBe('#FF0000');

        // Can safely embed in SVG
        const svg = `<svg><rect fill="${safeColor}"/><text>${initials}</text><text>${safePort}</text></svg>`;
        expect(svg).not.toContain('<script');
        expect(svg).toContain('fill="#FF0000"');
        expect(svg).toContain('8080');
    });
});
