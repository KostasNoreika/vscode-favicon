/**
 * FIX QUA-030: Config validation tests for favicon cache warming
 *
 * Tests the favicon warming configuration options
 */

// Load config once for read-only tests
const config = require('../../lib/config');

describe('Config - Favicon Cache Warming', () => {

    describe('FAVICON_WARM_ON_STARTUP configuration', () => {
        it('should have faviconWarmOnStartup property', () => {
            expect(config).toHaveProperty('faviconWarmOnStartup');
            expect(typeof config.faviconWarmOnStartup).toBe('boolean');
        });

        it('should be false by default in test environment', () => {
            // In test environment without FAVICON_WARM_ON_STARTUP set, should default to false
            expect(config.faviconWarmOnStartup).toBe(false);
        });
    });

    describe('FAVICON_WARM_PROJECT_LIMIT configuration', () => {
        it('should have faviconWarmProjectLimit property', () => {
            expect(config).toHaveProperty('faviconWarmProjectLimit');
            expect(typeof config.faviconWarmProjectLimit).toBe('number');
        });

        it('should default to 10', () => {
            // Without FAVICON_WARM_PROJECT_LIMIT set, should use default of 10
            expect(config.faviconWarmProjectLimit).toBe(10);
        });

        it('should be greater than or equal to 1', () => {
            expect(config.faviconWarmProjectLimit).toBeGreaterThanOrEqual(1);
        });
    });

    describe('FAVICON_WARM_TIMEOUT configuration', () => {
        it('should have faviconWarmTimeout property', () => {
            expect(config).toHaveProperty('faviconWarmTimeout');
            expect(typeof config.faviconWarmTimeout).toBe('number');
        });

        it('should default to 5000ms', () => {
            // Without FAVICON_WARM_TIMEOUT set, should use default of 5000
            expect(config.faviconWarmTimeout).toBe(5000);
        });

        it('should be greater than or equal to 1000ms', () => {
            expect(config.faviconWarmTimeout).toBeGreaterThanOrEqual(1000);
        });
    });
});
