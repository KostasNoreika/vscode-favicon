// Test for API URL validation with HTTPS enforcement
// SEC-013: Browser extension API URL configurable with HTTPS enforcement

describe('API URL Validation', () => {
    // Extract the validation function from background.js for testing
    function validateApiUrl(url) {
        if (!url || typeof url !== 'string') {
            return { valid: false, error: 'API URL must be a non-empty string' };
        }

        let parsedUrl;
        try {
            parsedUrl = new URL(url);
        } catch (e) {
            return { valid: false, error: 'Invalid URL format' };
        }

        // Enforce HTTPS except for localhost
        if (parsedUrl.protocol === 'https:') {
            return { valid: true };
        }

        if (parsedUrl.protocol === 'http:') {
            const hostname = parsedUrl.hostname.toLowerCase();
            if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') {
                return { valid: true };
            }
            return { valid: false, error: 'HTTP is only allowed for localhost. Use HTTPS for remote URLs.' };
        }

        return { valid: false, error: 'Only HTTP(S) protocols are supported' };
    }

    describe('HTTPS URLs', () => {
        it('should accept valid HTTPS URLs', () => {
            const result = validateApiUrl('https://favicon-api.noreika.lt');
            expect(result.valid).toBe(true);
        });

        it('should accept HTTPS URLs with port', () => {
            const result = validateApiUrl('https://api.example.com:8443');
            expect(result.valid).toBe(true);
        });

        it('should accept HTTPS URLs with path', () => {
            const result = validateApiUrl('https://example.com/api/v1');
            expect(result.valid).toBe(true);
        });
    });

    describe('HTTP localhost URLs', () => {
        it('should accept http://localhost', () => {
            const result = validateApiUrl('http://localhost');
            expect(result.valid).toBe(true);
        });

        it('should accept http://localhost with port', () => {
            const result = validateApiUrl('http://localhost:8090');
            expect(result.valid).toBe(true);
        });

        it('should accept http://127.0.0.1', () => {
            const result = validateApiUrl('http://127.0.0.1');
            expect(result.valid).toBe(true);
        });

        it('should accept http://127.0.0.1 with port', () => {
            const result = validateApiUrl('http://127.0.0.1:8090');
            expect(result.valid).toBe(true);
        });

        it('should accept http://[::1] (IPv6 localhost)', () => {
            const result = validateApiUrl('http://[::1]');
            expect(result.valid).toBe(true);
        });

        it('should accept http://[::1] with port', () => {
            const result = validateApiUrl('http://[::1]:8090');
            expect(result.valid).toBe(true);
        });
    });

    describe('HTTP non-localhost URLs (should reject)', () => {
        it('should reject HTTP URLs for remote hosts', () => {
            const result = validateApiUrl('http://example.com');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('HTTP is only allowed for localhost');
        });

        it('should reject HTTP URLs with IP addresses (not localhost)', () => {
            const result = validateApiUrl('http://192.168.1.1');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('HTTP is only allowed for localhost');
        });

        it('should reject HTTP URLs for public IPs', () => {
            const result = validateApiUrl('http://8.8.8.8:8090');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('HTTP is only allowed for localhost');
        });
    });

    describe('Invalid URLs', () => {
        it('should reject null', () => {
            const result = validateApiUrl(null);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('non-empty string');
        });

        it('should reject undefined', () => {
            const result = validateApiUrl(undefined);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('non-empty string');
        });

        it('should reject empty string', () => {
            const result = validateApiUrl('');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('non-empty string');
        });

        it('should reject non-string values', () => {
            const result = validateApiUrl(123);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('non-empty string');
        });

        it('should reject malformed URLs', () => {
            const result = validateApiUrl('not-a-url');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Invalid URL format');
        });

        it('should reject URLs with unsupported protocols', () => {
            const result = validateApiUrl('ftp://example.com');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Only HTTP(S) protocols are supported');
        });

        it('should reject file:// URLs', () => {
            const result = validateApiUrl('file:///etc/passwd');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Only HTTP(S) protocols are supported');
        });

        it('should reject javascript: URLs', () => {
            const result = validateApiUrl('javascript:alert(1)');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Only HTTP(S) protocols are supported');
        });
    });

    describe('Edge cases', () => {
        it('should handle URLs with query parameters', () => {
            const result = validateApiUrl('https://api.example.com/v1?key=value');
            expect(result.valid).toBe(true);
        });

        it('should handle URLs with fragments', () => {
            const result = validateApiUrl('https://api.example.com/v1#section');
            expect(result.valid).toBe(true);
        });

        it('should handle URLs with authentication', () => {
            const result = validateApiUrl('https://user:pass@api.example.com');
            expect(result.valid).toBe(true);
        });

        it('should be case-insensitive for localhost', () => {
            const result = validateApiUrl('http://LOCALHOST:8090');
            expect(result.valid).toBe(true);
        });
    });
});
