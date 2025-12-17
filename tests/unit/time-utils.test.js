/**
 * Unit tests for time-utils module
 * Tests the formatTimeAgo function for various time ranges
 */

describe('TimeUtils', () => {
    let TimeUtils;

    beforeEach(() => {
        // Set up window object for module
        global.window = {};

        // Load the module (simulating browser environment)
        const moduleCode = require('fs').readFileSync(
            require('path').join(__dirname, '../../vscode-favicon-extension/modules/time-utils.js'),
            'utf8'
        );

        // Execute module code in context
        eval(moduleCode);
        TimeUtils = global.window.TimeUtils;
    });

    afterEach(() => {
        delete global.window;
    });

    describe('formatTimeAgo', () => {
        test('should return "just now" for timestamps less than 60 seconds ago', () => {
            const now = Date.now();
            expect(TimeUtils.formatTimeAgo(now)).toBe('just now');
            expect(TimeUtils.formatTimeAgo(now - 30000)).toBe('just now'); // 30 seconds ago
            expect(TimeUtils.formatTimeAgo(now - 59000)).toBe('just now'); // 59 seconds ago
        });

        test('should return minutes for timestamps between 1-59 minutes ago', () => {
            const now = Date.now();
            expect(TimeUtils.formatTimeAgo(now - 60000)).toBe('1m ago'); // 1 minute
            expect(TimeUtils.formatTimeAgo(now - 120000)).toBe('2m ago'); // 2 minutes
            expect(TimeUtils.formatTimeAgo(now - 300000)).toBe('5m ago'); // 5 minutes
            expect(TimeUtils.formatTimeAgo(now - 1800000)).toBe('30m ago'); // 30 minutes
            expect(TimeUtils.formatTimeAgo(now - 3540000)).toBe('59m ago'); // 59 minutes
        });

        test('should return hours for timestamps between 1-23 hours ago', () => {
            const now = Date.now();
            expect(TimeUtils.formatTimeAgo(now - 3600000)).toBe('1h ago'); // 1 hour
            expect(TimeUtils.formatTimeAgo(now - 7200000)).toBe('2h ago'); // 2 hours
            expect(TimeUtils.formatTimeAgo(now - 18000000)).toBe('5h ago'); // 5 hours
            expect(TimeUtils.formatTimeAgo(now - 43200000)).toBe('12h ago'); // 12 hours
            expect(TimeUtils.formatTimeAgo(now - 82800000)).toBe('23h ago'); // 23 hours
        });

        test('should return days for timestamps 24 hours or more ago', () => {
            const now = Date.now();
            expect(TimeUtils.formatTimeAgo(now - 86400000)).toBe('1d ago'); // 1 day
            expect(TimeUtils.formatTimeAgo(now - 172800000)).toBe('2d ago'); // 2 days
            expect(TimeUtils.formatTimeAgo(now - 432000000)).toBe('5d ago'); // 5 days
            expect(TimeUtils.formatTimeAgo(now - 604800000)).toBe('7d ago'); // 7 days
            expect(TimeUtils.formatTimeAgo(now - 2592000000)).toBe('30d ago'); // 30 days
        });

        test('should handle edge cases at time boundaries', () => {
            const now = Date.now();
            // Right at 60 seconds
            expect(TimeUtils.formatTimeAgo(now - 60000)).toBe('1m ago');
            // Right at 60 minutes
            expect(TimeUtils.formatTimeAgo(now - 3600000)).toBe('1h ago');
            // Right at 24 hours
            expect(TimeUtils.formatTimeAgo(now - 86400000)).toBe('1d ago');
        });

        test('should handle current timestamp', () => {
            expect(TimeUtils.formatTimeAgo(Date.now())).toBe('just now');
        });

        test('should floor decimal values correctly', () => {
            const now = Date.now();
            // 1.9 minutes should be "1m ago"
            expect(TimeUtils.formatTimeAgo(now - 114000)).toBe('1m ago');
            // 2.9 hours should be "2h ago"
            expect(TimeUtils.formatTimeAgo(now - 10440000)).toBe('2h ago');
            // 3.9 days should be "3d ago"
            expect(TimeUtils.formatTimeAgo(now - 336960000)).toBe('3d ago');
        });
    });

    describe('module exports', () => {
        test('should export formatTimeAgo function', () => {
            expect(TimeUtils).toBeDefined();
            expect(TimeUtils.formatTimeAgo).toBeDefined();
            expect(typeof TimeUtils.formatTimeAgo).toBe('function');
        });

        test('should be attached to window object', () => {
            expect(global.window.TimeUtils).toBe(TimeUtils);
        });
    });
});
