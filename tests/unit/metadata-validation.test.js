/**
 * Unit Tests for Metadata Validation (QUA-008)
 *
 * Tests validation logic for notification metadata field:
 * - Plain object validation (reject arrays, null, primitives)
 * - Serialized size limit (5KB max)
 * - Nesting depth limit (3 levels max)
 * - Key whitelist validation
 */

const { validationResult } = require('express-validator');
const {
    validateNotificationBody,
    isPlainObject,
    getObjectDepth
} = require('../../lib/validators');

describe('Metadata Validation (QUA-008)', () => {
    describe('Helper Functions', () => {
        describe('isPlainObject', () => {
            test('should return true for plain object', () => {
                expect(isPlainObject({ key: 'value' })).toBe(true);
                expect(isPlainObject({})).toBe(true);
                expect(isPlainObject(Object.create(null))).toBe(true);
            });

            test('should return false for null', () => {
                expect(isPlainObject(null)).toBe(false);
            });

            test('should return false for arrays', () => {
                expect(isPlainObject([])).toBe(false);
                expect(isPlainObject([1, 2, 3])).toBe(false);
            });

            test('should return false for primitives', () => {
                expect(isPlainObject('string')).toBe(false);
                expect(isPlainObject(123)).toBe(false);
                expect(isPlainObject(true)).toBe(false);
                expect(isPlainObject(undefined)).toBe(false);
            });

            test('should return false for Date objects', () => {
                expect(isPlainObject(new Date())).toBe(false);
            });

            test('should return false for RegExp objects', () => {
                expect(isPlainObject(/test/)).toBe(false);
            });

            test('should return false for class instances', () => {
                class TestClass {}
                expect(isPlainObject(new TestClass())).toBe(false);
            });
        });

        describe('getObjectDepth', () => {
            test('should return 0 for flat object', () => {
                expect(getObjectDepth({ key: 'value' })).toBe(0);
                expect(getObjectDepth({ a: 1, b: 2, c: 3 })).toBe(0);
            });

            test('should return 1 for one level of nesting', () => {
                expect(getObjectDepth({ outer: { inner: 'value' } })).toBe(1);
            });

            test('should return 2 for two levels of nesting', () => {
                expect(getObjectDepth({
                    level1: {
                        level2: {
                            value: 'test'
                        }
                    }
                })).toBe(2);
            });

            test('should return 3 for three levels of nesting', () => {
                expect(getObjectDepth({
                    level1: {
                        level2: {
                            level3: {
                                value: 'test'
                            }
                        }
                    }
                })).toBe(3);
            });

            test('should handle multiple branches and return max depth', () => {
                const obj = {
                    shallow: 'value',
                    deep: {
                        level2: {
                            level3: 'deepest'
                        }
                    },
                    medium: {
                        level2: 'medium'
                    }
                };
                expect(getObjectDepth(obj)).toBe(2);
            });

            test('should return 0 for empty object', () => {
                expect(getObjectDepth({})).toBe(0);
            });

            test('should handle arrays as non-objects (not count as depth)', () => {
                const obj = {
                    arr: [1, 2, 3],
                    nested: {
                        arr: [4, 5, 6]
                    }
                };
                expect(getObjectDepth(obj)).toBe(1);
            });
        });
    });

    describe('Metadata Field Validation', () => {
        let mockReq;

        beforeEach(() => {
            mockReq = {
                body: {},
                path: '/claude-completion',
                method: 'POST',
                ip: '127.0.0.1',
            };
        });

        const runValidation = async (bodyData) => {
            mockReq.body = bodyData;

            for (const validator of validateNotificationBody) {
                await validator.run(mockReq);
            }

            return validationResult(mockReq);
        };

        describe('Valid Metadata', () => {
            test('should accept valid metadata with allowed keys', async () => {
                const errors = await runValidation({
                    folder: '/opt/dev/test',
                    metadata: {
                        duration: 120,
                        user: 'testuser',
                        priority: 'high'
                    }
                });

                expect(errors.isEmpty()).toBe(true);
            });

            test('should accept null metadata', async () => {
                const errors = await runValidation({
                    folder: '/opt/dev/test',
                    metadata: null
                });

                expect(errors.isEmpty()).toBe(true);
            });

            test('should accept undefined metadata (omitted)', async () => {
                const errors = await runValidation({
                    folder: '/opt/dev/test',
                    message: 'Test message'
                    // metadata omitted
                });

                expect(errors.isEmpty()).toBe(true);
            });

            test('should accept empty object metadata', async () => {
                const errors = await runValidation({
                    folder: '/opt/dev/test',
                    metadata: {}
                });

                expect(errors.isEmpty()).toBe(true);
            });

            test('should accept metadata with nested object at depth 1', async () => {
                const errors = await runValidation({
                    folder: '/opt/dev/test',
                    metadata: {
                        context: {
                            file: 'test.js',
                            line: 42
                        }
                    }
                });

                expect(errors.isEmpty()).toBe(true);
            });

            test('should accept metadata with nested object at depth 2', async () => {
                const errors = await runValidation({
                    folder: '/opt/dev/test',
                    metadata: {
                        context: {
                            location: {
                                file: 'test.js',
                                line: 42
                            }
                        }
                    }
                });

                expect(errors.isEmpty()).toBe(true);
            });

            test('should accept metadata at exact max depth of 3', async () => {
                const errors = await runValidation({
                    folder: '/opt/dev/test',
                    metadata: {
                        context: {
                            location: {
                                position: {
                                    line: 42
                                }
                            }
                        }
                    }
                });

                expect(errors.isEmpty()).toBe(true);
            });

            test('should accept metadata near max size', async () => {
                // Create metadata close to 5KB limit
                const largeValue = 'x'.repeat(4500);
                const errors = await runValidation({
                    folder: '/opt/dev/test',
                    metadata: {
                        context: largeValue
                    }
                });

                expect(errors.isEmpty()).toBe(true);
            });
        });

        describe('Invalid Metadata - Type Validation', () => {
            test('should reject array metadata', async () => {
                const errors = await runValidation({
                    folder: '/opt/dev/test',
                    metadata: [1, 2, 3]
                });

                expect(errors.isEmpty()).toBe(false);
                const errorArray = errors.array();
                expect(errorArray.some(e => e.path === 'metadata')).toBe(true);
                expect(errorArray.some(e => e.msg === 'metadata must be a plain object')).toBe(true);
            });

            test('should reject string metadata', async () => {
                const errors = await runValidation({
                    folder: '/opt/dev/test',
                    metadata: 'invalid string'
                });

                expect(errors.isEmpty()).toBe(false);
                const errorArray = errors.array();
                expect(errorArray.some(e => e.msg === 'metadata must be a plain object')).toBe(true);
            });

            test('should reject number metadata', async () => {
                const errors = await runValidation({
                    folder: '/opt/dev/test',
                    metadata: 12345
                });

                expect(errors.isEmpty()).toBe(false);
                const errorArray = errors.array();
                expect(errorArray.some(e => e.msg === 'metadata must be a plain object')).toBe(true);
            });

            test('should reject boolean metadata', async () => {
                const errors = await runValidation({
                    folder: '/opt/dev/test',
                    metadata: true
                });

                expect(errors.isEmpty()).toBe(false);
                const errorArray = errors.array();
                expect(errorArray.some(e => e.msg === 'metadata must be a plain object')).toBe(true);
            });

            test('should reject Date object metadata', async () => {
                const errors = await runValidation({
                    folder: '/opt/dev/test',
                    metadata: new Date()
                });

                expect(errors.isEmpty()).toBe(false);
                const errorArray = errors.array();
                expect(errorArray.some(e => e.msg === 'metadata must be a plain object')).toBe(true);
            });
        });

        describe('Invalid Metadata - Size Validation', () => {
            test('should reject metadata exceeding 5KB', async () => {
                // Create metadata larger than 5KB
                const largeValue = 'x'.repeat(6000);
                const errors = await runValidation({
                    folder: '/opt/dev/test',
                    metadata: {
                        context: largeValue
                    }
                });

                expect(errors.isEmpty()).toBe(false);
                const errorArray = errors.array();
                expect(errorArray.some(e => e.path === 'metadata')).toBe(true);
                expect(errorArray.some(e => e.msg.includes('exceeds maximum size'))).toBe(true);
                expect(errorArray.some(e => e.msg.includes('5120 bytes'))).toBe(true);
            });

            test('should reject metadata exactly at 5KB + 1 byte', async () => {
                // Create metadata that will be exactly 5KB + 1 byte when serialized
                // Account for JSON serialization overhead (quotes, braces, etc.)
                const targetSize = 5120; // 5KB
                const overhead = '{"context":""}'.length; // JSON overhead
                const largeValue = 'x'.repeat(targetSize - overhead + 1);

                const errors = await runValidation({
                    folder: '/opt/dev/test',
                    metadata: {
                        context: largeValue
                    }
                });

                expect(errors.isEmpty()).toBe(false);
                const errorArray = errors.array();
                expect(errorArray.some(e => e.msg.includes('exceeds maximum size'))).toBe(true);
            });

            test('should reject multiple large fields totaling over 5KB', async () => {
                const errors = await runValidation({
                    folder: '/opt/dev/test',
                    metadata: {
                        user: 'x'.repeat(2000),
                        context: 'y'.repeat(2000),
                        tags: 'z'.repeat(2000)
                    }
                });

                expect(errors.isEmpty()).toBe(false);
                const errorArray = errors.array();
                expect(errorArray.some(e => e.msg.includes('exceeds maximum size'))).toBe(true);
            });
        });

        describe('Invalid Metadata - Nesting Depth Validation', () => {
            test('should reject metadata with depth 4 (exceeds max of 3)', async () => {
                const errors = await runValidation({
                    folder: '/opt/dev/test',
                    metadata: {
                        context: {
                            location: {
                                position: {
                                    coordinates: {
                                        line: 42  // This is depth 4
                                    }
                                }
                            }
                        }
                    }
                });

                expect(errors.isEmpty()).toBe(false);
                const errorArray = errors.array();
                expect(errorArray.some(e => e.path === 'metadata')).toBe(true);
                expect(errorArray.some(e => e.msg.includes('nesting depth exceeds maximum'))).toBe(true);
                expect(errorArray.some(e => e.msg.includes('3 levels'))).toBe(true);
            });

            test('should reject deeply nested metadata (depth 5)', async () => {
                const errors = await runValidation({
                    folder: '/opt/dev/test',
                    metadata: {
                        a: {
                            b: {
                                c: {
                                    d: {
                                        e: 'too deep'  // Depth 5
                                    }
                                }
                            }
                        }
                    }
                });

                expect(errors.isEmpty()).toBe(false);
                const errorArray = errors.array();
                expect(errorArray.some(e => e.msg.includes('nesting depth exceeds maximum'))).toBe(true);
            });

            test('should handle multiple branches and reject if any exceeds depth', async () => {
                const errors = await runValidation({
                    folder: '/opt/dev/test',
                    metadata: {
                        shallow: 'ok',
                        deep: {
                            level2: {
                                level3: {
                                    level4: {
                                        tooDeep: 'value'  // Depth 4 - exceeds max of 3
                                    }
                                }
                            }
                        },
                        medium: {
                            level2: 'ok'
                        }
                    }
                });

                expect(errors.isEmpty()).toBe(false);
                const errorArray = errors.array();
                expect(errorArray.some(e => e.msg.includes('nesting depth exceeds maximum'))).toBe(true);
            });
        });

        describe('Invalid Metadata - Key Whitelist Validation', () => {
            test('should reject metadata with invalid keys', async () => {
                const errors = await runValidation({
                    folder: '/opt/dev/test',
                    metadata: {
                        invalidKey: 'value',
                        duration: 120  // Valid key
                    }
                });

                expect(errors.isEmpty()).toBe(false);
                const errorArray = errors.array();
                expect(errorArray.some(e => e.path === 'metadata')).toBe(true);
                expect(errorArray.some(e => e.msg.includes('invalid keys: invalidKey'))).toBe(true);
                expect(errorArray.some(e => e.msg.includes('Allowed keys:'))).toBe(true);
            });

            test('should reject metadata with multiple invalid keys', async () => {
                const errors = await runValidation({
                    folder: '/opt/dev/test',
                    metadata: {
                        invalidKey1: 'value1',
                        invalidKey2: 'value2',
                        duration: 120  // Valid key
                    }
                });

                expect(errors.isEmpty()).toBe(false);
                const errorArray = errors.array();
                expect(errorArray.some(e => e.msg.includes('invalid keys'))).toBe(true);
                expect(errorArray.some(e => e.msg.includes('invalidKey1'))).toBe(true);
                expect(errorArray.some(e => e.msg.includes('invalidKey2'))).toBe(true);
            });

            test('should accept all whitelisted keys', async () => {
                const errors = await runValidation({
                    folder: '/opt/dev/test',
                    metadata: {
                        duration: 120,
                        user: 'testuser',
                        context: { file: 'test.js' },
                        tags: ['tag1', 'tag2'],
                        priority: 'high'
                    }
                });

                expect(errors.isEmpty()).toBe(true);
            });

            test('should reject case-sensitive invalid keys', async () => {
                const errors = await runValidation({
                    folder: '/opt/dev/test',
                    metadata: {
                        Duration: 120  // Wrong case
                    }
                });

                expect(errors.isEmpty()).toBe(false);
                const errorArray = errors.array();
                expect(errorArray.some(e => e.msg.includes('invalid keys: Duration'))).toBe(true);
            });
        });

        describe('Combined Validation Scenarios', () => {
            test('should validate all metadata constraints together', async () => {
                const errors = await runValidation({
                    folder: '/opt/dev/test',
                    message: 'Test message',
                    metadata: {
                        duration: 120,
                        user: 'testuser',
                        context: {
                            file: 'test.js',
                            location: {
                                line: 42,
                                column: 10
                            }
                        }
                    }
                });

                expect(errors.isEmpty()).toBe(true);
            });

            test('should report multiple validation errors', async () => {
                // Create metadata that's both too deep AND too large AND has invalid keys
                const largeValue = 'x'.repeat(6000);
                const errors = await runValidation({
                    folder: '/opt/dev/test',
                    metadata: {
                        invalidKey: {  // Invalid key
                            level2: {
                                level3: {
                                    level4: largeValue  // Too deep AND too large
                                }
                            }
                        }
                    }
                });

                expect(errors.isEmpty()).toBe(false);
                const errorArray = errors.array();

                // Should fail on first validation error encountered
                expect(errorArray.some(e => e.path === 'metadata')).toBe(true);
            });

            test('should validate metadata alongside message and timestamp', async () => {
                const now = Date.now();
                const errors = await runValidation({
                    folder: '/opt/dev/test',
                    message: 'Valid test message',
                    timestamp: now,
                    metadata: {
                        duration: 120,
                        user: 'testuser'
                    }
                });

                expect(errors.isEmpty()).toBe(true);
            });

            test('should reject invalid metadata even with valid message and timestamp', async () => {
                const now = Date.now();
                const errors = await runValidation({
                    folder: '/opt/dev/test',
                    message: 'Valid test message',
                    timestamp: now,
                    metadata: 'invalid string'  // Invalid metadata
                });

                expect(errors.isEmpty()).toBe(false);
                const errorArray = errors.array();
                expect(errorArray.some(e => e.path === 'metadata')).toBe(true);
            });
        });

        describe('Edge Cases', () => {
            test('should handle metadata with special characters in keys', async () => {
                const errors = await runValidation({
                    folder: '/opt/dev/test',
                    metadata: {
                        'invalid-key-with-dashes': 'value'
                    }
                });

                expect(errors.isEmpty()).toBe(false);
                const errorArray = errors.array();
                expect(errorArray.some(e => e.msg.includes('invalid keys'))).toBe(true);
            });

            test('should handle metadata with numeric values', async () => {
                const errors = await runValidation({
                    folder: '/opt/dev/test',
                    metadata: {
                        duration: 12345,
                        priority: 1
                    }
                });

                expect(errors.isEmpty()).toBe(true);
            });

            test('should handle metadata with boolean values', async () => {
                const errors = await runValidation({
                    folder: '/opt/dev/test',
                    metadata: {
                        user: true,
                        priority: false
                    }
                });

                expect(errors.isEmpty()).toBe(true);
            });

            test('should handle metadata with null values', async () => {
                const errors = await runValidation({
                    folder: '/opt/dev/test',
                    metadata: {
                        duration: null,
                        user: 'testuser'
                    }
                });

                expect(errors.isEmpty()).toBe(true);
            });

            test('should handle metadata with array values (not rejected by type check)', async () => {
                const errors = await runValidation({
                    folder: '/opt/dev/test',
                    metadata: {
                        tags: ['tag1', 'tag2', 'tag3']
                    }
                });

                expect(errors.isEmpty()).toBe(true);
            });

            test('should handle metadata with mixed value types', async () => {
                const errors = await runValidation({
                    folder: '/opt/dev/test',
                    metadata: {
                        duration: 120,
                        user: 'testuser',
                        tags: ['tag1', 'tag2'],
                        priority: 'high',
                        context: {
                            active: true,
                            count: 42
                        }
                    }
                });

                expect(errors.isEmpty()).toBe(true);
            });
        });

        describe('Performance and DoS Prevention', () => {
            test('should quickly reject extremely nested metadata', async () => {
                // Create deeply nested object (depth 10)
                let deepObj = { value: 'test' };
                for (let i = 0; i < 10; i++) {
                    deepObj = { nested: deepObj };
                }

                const startTime = Date.now();
                const errors = await runValidation({
                    folder: '/opt/dev/test',
                    metadata: deepObj
                });
                const duration = Date.now() - startTime;

                expect(duration).toBeLessThan(100);
                expect(errors.isEmpty()).toBe(false);
                expect(errors.array().some(e => e.msg.includes('nesting depth'))).toBe(true);
            });

            test('should quickly reject extremely large metadata', async () => {
                // Create 10KB of data (double the limit)
                const largeValue = 'x'.repeat(10000);

                const startTime = Date.now();
                const errors = await runValidation({
                    folder: '/opt/dev/test',
                    metadata: {
                        context: largeValue
                    }
                });
                const duration = Date.now() - startTime;

                expect(duration).toBeLessThan(100);
                expect(errors.isEmpty()).toBe(false);
                expect(errors.array().some(e => e.msg.includes('exceeds maximum size'))).toBe(true);
            });

            test('should handle metadata with many keys efficiently', async () => {
                // Create metadata with 50 keys
                const metadata = {};
                for (let i = 0; i < 50; i++) {
                    metadata[`key${i}`] = `value${i}`;
                }

                const startTime = Date.now();
                const errors = await runValidation({
                    folder: '/opt/dev/test',
                    metadata
                });
                const duration = Date.now() - startTime;

                expect(duration).toBeLessThan(100);
                expect(errors.isEmpty()).toBe(false); // Should fail due to invalid keys
            });
        });
    });
});
