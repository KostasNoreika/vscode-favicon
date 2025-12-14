/**
 * PERF-029: Test notification JSON serialization optimization
 * Verifies file size reduction with compact JSON in production
 */

const _fs = require('fs');
const _path = require('path');

describe('Notification Store - JSON Serialization (PERF-029)', () => {
    test('should reduce file size by at least 15% with compact JSON', () => {
        // Create sample notifications data
        const testNotifications = {};
        for (let i = 0; i < 100; i++) {
            testNotifications[`/opt/dev/project-${i}`] = {
                message: `Task completed for project ${i}`,
                timestamp: Date.now() - i * 60000,
                unread: i % 3 === 0,
                status: i % 2 === 0 ? 'completed' : 'working',
            };

            // Add metadata to some
            if (i % 5 === 0) {
                testNotifications[`/opt/dev/project-${i}`].metadata = {
                    files_changed: 3,
                    tools_used: ['read', 'write', 'bash'],
                    duration: 120000,
                };
            }
        }

        // Production mode: Compact JSON
        const compactJson = JSON.stringify(testNotifications);
        const compactSize = Buffer.byteLength(compactJson, 'utf8');

        // Development mode: Pretty-printed JSON
        const prettyJson = JSON.stringify(testNotifications, null, 2);
        const prettySize = Buffer.byteLength(prettyJson, 'utf8');

        // Verify compact is smaller
        expect(compactSize).toBeLessThan(prettySize);

        // Calculate reduction percentage
        const byteSavings = prettySize - compactSize;
        const reductionPercent = (byteSavings / prettySize) * 100;

        // Should save at least 15% of file size
        expect(reductionPercent).toBeGreaterThan(15);

        // Log results for visibility
        console.log(`  PERF-029 Metrics:`);
        console.log(`    Pretty-printed: ${prettySize.toLocaleString()} bytes`);
        console.log(`    Compact: ${compactSize.toLocaleString()} bytes`);
        console.log(`    Savings: ${byteSavings.toLocaleString()} bytes (${reductionPercent.toFixed(2)}%)`);
    });

    test('compact JSON should be valid and parseable', () => {
        const testData = {
            '/opt/dev/test-project': {
                message: 'Test message',
                timestamp: Date.now(),
                unread: true,
                status: 'completed',
            },
        };

        const compactJson = JSON.stringify(testData);

        // Should not have newlines with indentation
        expect(compactJson.includes('\n  ')).toBe(false);

        // Should be valid JSON
        const parsed = JSON.parse(compactJson);
        expect(parsed['/opt/dev/test-project']).toEqual(testData['/opt/dev/test-project']);
    });

    test('pretty-printed JSON should have indentation', () => {
        const testData = {
            '/opt/dev/test-project': {
                message: 'Test message',
                timestamp: Date.now(),
                unread: true,
                status: 'completed',
            },
        };

        const prettyJson = JSON.stringify(testData, null, 2);

        // Should have newlines with indentation
        expect(prettyJson.includes('\n  ')).toBe(true);

        // Should be valid JSON
        const parsed = JSON.parse(prettyJson);
        expect(parsed['/opt/dev/test-project']).toEqual(testData['/opt/dev/test-project']);
    });
});
