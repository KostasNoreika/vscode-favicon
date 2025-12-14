/**
 * Unit Tests for Browser Extension Notification Deduplication
 * Tests stable notification ID generation and version-based change detection
 * Addresses QUA-020: Missing notification deduplication
 */

describe('Extension Notification Deduplication', () => {
    // Extract the functions from background.js for testing
    // In real implementation, these would be imported if the extension used modules

    /**
     * Generate stable notification ID
     * @param {Object} notification - Notification object with folder and timestamp
     * @returns {string} Stable notification ID
     */
    function getNotificationId(notification) {
        if (!notification || !notification.folder) {
            return '';
        }
        return `${notification.folder}:${notification.timestamp}`;
    }

    /**
     * Generate version hash from notification set
     * @param {Array} notifications - Array of notification objects
     * @returns {string} Version string of sorted notification IDs
     */
    function getNotificationsVersion(notifications) {
        if (!notifications || notifications.length === 0) {
            return '';
        }

        const ids = notifications
            .map(n => getNotificationId(n))
            .filter(id => id)
            .sort()
            .join('|');

        return ids;
    }

    describe('getNotificationId', () => {
        test('should generate stable ID from folder and timestamp', () => {
            const notification = {
                folder: '/opt/dev/project1',
                timestamp: 1702345678901,
                message: 'Task completed',
                status: 'completed',
            };

            const id = getNotificationId(notification);
            expect(id).toBe('/opt/dev/project1:1702345678901');
        });

        test('should return empty string for null notification', () => {
            expect(getNotificationId(null)).toBe('');
        });

        test('should return empty string for notification without folder', () => {
            const notification = {
                timestamp: 1702345678901,
                message: 'Task completed',
            };

            expect(getNotificationId(notification)).toBe('');
        });

        test('should generate same ID for notifications with same folder and timestamp', () => {
            const notification1 = {
                folder: '/opt/dev/project1',
                timestamp: 1702345678901,
                message: 'Task completed',
                status: 'completed',
            };

            const notification2 = {
                folder: '/opt/dev/project1',
                timestamp: 1702345678901,
                message: 'Different message',
                status: 'working',
                metadata: { extra: 'data' },
            };

            expect(getNotificationId(notification1)).toBe(getNotificationId(notification2));
        });

        test('should generate different IDs for different folders', () => {
            const notification1 = {
                folder: '/opt/dev/project1',
                timestamp: 1702345678901,
            };

            const notification2 = {
                folder: '/opt/dev/project2',
                timestamp: 1702345678901,
            };

            expect(getNotificationId(notification1)).not.toBe(getNotificationId(notification2));
        });

        test('should generate different IDs for different timestamps', () => {
            const notification1 = {
                folder: '/opt/dev/project1',
                timestamp: 1702345678901,
            };

            const notification2 = {
                folder: '/opt/dev/project1',
                timestamp: 1702345678902,
            };

            expect(getNotificationId(notification1)).not.toBe(getNotificationId(notification2));
        });
    });

    describe('getNotificationsVersion', () => {
        test('should return empty string for empty array', () => {
            expect(getNotificationsVersion([])).toBe('');
        });

        test('should return empty string for null', () => {
            expect(getNotificationsVersion(null)).toBe('');
        });

        test('should generate version string for single notification', () => {
            const notifications = [
                {
                    folder: '/opt/dev/project1',
                    timestamp: 1702345678901,
                    message: 'Task completed',
                },
            ];

            const version = getNotificationsVersion(notifications);
            expect(version).toBe('/opt/dev/project1:1702345678901');
        });

        test('should generate version string for multiple notifications', () => {
            const notifications = [
                {
                    folder: '/opt/dev/project1',
                    timestamp: 1702345678901,
                },
                {
                    folder: '/opt/dev/project2',
                    timestamp: 1702345678902,
                },
            ];

            const version = getNotificationsVersion(notifications);
            // IDs should be sorted alphabetically
            expect(version).toBe('/opt/dev/project1:1702345678901|/opt/dev/project2:1702345678902');
        });

        test('should generate same version regardless of array order (QUA-020 fix)', () => {
            const notifications1 = [
                {
                    folder: '/opt/dev/project1',
                    timestamp: 1702345678901,
                    message: 'First',
                },
                {
                    folder: '/opt/dev/project2',
                    timestamp: 1702345678902,
                    message: 'Second',
                },
            ];

            const notifications2 = [
                {
                    folder: '/opt/dev/project2',
                    timestamp: 1702345678902,
                    message: 'Second',
                },
                {
                    folder: '/opt/dev/project1',
                    timestamp: 1702345678901,
                    message: 'First',
                },
            ];

            const version1 = getNotificationsVersion(notifications1);
            const version2 = getNotificationsVersion(notifications2);

            expect(version1).toBe(version2);
        });

        test('should generate same version regardless of JSON key order (QUA-020 fix)', () => {
            // Simulate notifications with different key orders from server
            const notifications1 = [
                {
                    folder: '/opt/dev/project1',
                    timestamp: 1702345678901,
                    message: 'Task completed',
                    status: 'completed',
                    metadata: { files: 3 },
                },
            ];

            const notifications2 = [
                {
                    metadata: { files: 3 },
                    status: 'completed',
                    message: 'Task completed',
                    timestamp: 1702345678901,
                    folder: '/opt/dev/project1',
                },
            ];

            const version1 = getNotificationsVersion(notifications1);
            const version2 = getNotificationsVersion(notifications2);

            // Should be equal because version is based on folder:timestamp, not JSON structure
            expect(version1).toBe(version2);
        });

        test('should detect change when notification added', () => {
            const notifications1 = [
                {
                    folder: '/opt/dev/project1',
                    timestamp: 1702345678901,
                },
            ];

            const notifications2 = [
                {
                    folder: '/opt/dev/project1',
                    timestamp: 1702345678901,
                },
                {
                    folder: '/opt/dev/project2',
                    timestamp: 1702345678902,
                },
            ];

            const version1 = getNotificationsVersion(notifications1);
            const version2 = getNotificationsVersion(notifications2);

            expect(version1).not.toBe(version2);
        });

        test('should detect change when notification removed', () => {
            const notifications1 = [
                {
                    folder: '/opt/dev/project1',
                    timestamp: 1702345678901,
                },
                {
                    folder: '/opt/dev/project2',
                    timestamp: 1702345678902,
                },
            ];

            const notifications2 = [
                {
                    folder: '/opt/dev/project1',
                    timestamp: 1702345678901,
                },
            ];

            const version1 = getNotificationsVersion(notifications1);
            const version2 = getNotificationsVersion(notifications2);

            expect(version1).not.toBe(version2);
        });

        test('should detect change when notification updated (new timestamp)', () => {
            const notifications1 = [
                {
                    folder: '/opt/dev/project1',
                    timestamp: 1702345678901,
                    message: 'Working...',
                    status: 'working',
                },
            ];

            const notifications2 = [
                {
                    folder: '/opt/dev/project1',
                    timestamp: 1702345678999, // Updated timestamp
                    message: 'Task completed',
                    status: 'completed',
                },
            ];

            const version1 = getNotificationsVersion(notifications1);
            const version2 = getNotificationsVersion(notifications2);

            expect(version1).not.toBe(version2);
        });

        test('should filter out notifications without folder', () => {
            const notifications = [
                {
                    folder: '/opt/dev/project1',
                    timestamp: 1702345678901,
                },
                {
                    // Missing folder - should be filtered out
                    timestamp: 1702345678902,
                    message: 'Invalid',
                },
            ];

            const version = getNotificationsVersion(notifications);
            expect(version).toBe('/opt/dev/project1:1702345678901');
        });

        test('should handle complex notification set with multiple projects', () => {
            const notifications = [
                {
                    folder: '/opt/dev/project-alpha',
                    timestamp: 1702345678901,
                    message: 'Alpha completed',
                    status: 'completed',
                    metadata: { files_changed: 5 },
                },
                {
                    folder: '/opt/dev/project-beta',
                    timestamp: 1702345678902,
                    message: 'Beta working',
                    status: 'working',
                },
                {
                    folder: '/opt/prod/deployment',
                    timestamp: 1702345678903,
                    message: 'Deployment completed',
                    status: 'completed',
                },
            ];

            const version = getNotificationsVersion(notifications);
            const expectedIds = [
                '/opt/dev/project-alpha:1702345678901',
                '/opt/dev/project-beta:1702345678902',
                '/opt/prod/deployment:1702345678903',
            ].sort().join('|');

            expect(version).toBe(expectedIds);
        });
    });

    describe('Integration: Change Detection', () => {
        test('should not trigger false change when server returns notifications in different order', () => {
            // Simulate first API response
            const response1 = {
                notifications: [
                    { folder: '/opt/dev/project1', timestamp: 100, message: 'Done 1' },
                    { folder: '/opt/dev/project2', timestamp: 200, message: 'Done 2' },
                ],
            };

            // Simulate second API response with same notifications but different order
            const response2 = {
                notifications: [
                    { folder: '/opt/dev/project2', timestamp: 200, message: 'Done 2' },
                    { folder: '/opt/dev/project1', timestamp: 100, message: 'Done 1' },
                ],
            };

            const version1 = getNotificationsVersion(response1.notifications);
            const version2 = getNotificationsVersion(response2.notifications);

            // Should be considered identical (no change)
            expect(version1).toBe(version2);
        });

        test('should not trigger false change when JSON key order differs', () => {
            // This is the main QUA-020 fix - JSON.stringify would fail this test
            const response1 = {
                notifications: [
                    {
                        folder: '/opt/dev/project1',
                        timestamp: 100,
                        message: 'Done',
                        status: 'completed',
                    },
                ],
            };

            const response2 = {
                notifications: [
                    {
                        status: 'completed',
                        message: 'Done',
                        timestamp: 100,
                        folder: '/opt/dev/project1',
                    },
                ],
            };

            const version1 = getNotificationsVersion(response1.notifications);
            const version2 = getNotificationsVersion(response2.notifications);

            // Should be considered identical
            expect(version1).toBe(version2);

            // Verify JSON.stringify would have failed (showing the bug we fixed)
            const jsonStringifyChanged = JSON.stringify(response1.notifications) !== JSON.stringify(response2.notifications);
            expect(jsonStringifyChanged).toBe(true); // JSON.stringify sees a change (false positive)
            expect(version1 === version2).toBe(true); // Our version comparison correctly sees no change
        });

        test('should detect real changes when notification content updates', () => {
            const response1 = {
                notifications: [
                    { folder: '/opt/dev/project1', timestamp: 100, status: 'working' },
                ],
            };

            const response2 = {
                notifications: [
                    { folder: '/opt/dev/project1', timestamp: 200, status: 'completed' }, // New timestamp = real update
                ],
            };

            const version1 = getNotificationsVersion(response1.notifications);
            const version2 = getNotificationsVersion(response2.notifications);

            // Should detect the change (different timestamp)
            expect(version1).not.toBe(version2);
        });
    });
});
