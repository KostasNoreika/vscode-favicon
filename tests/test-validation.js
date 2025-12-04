#!/usr/bin/env node

/**
 * Validation Security Tests
 * Tests comprehensive input validation implementation
 */

const axios = require('axios');

const SERVICE_URL = 'http://localhost:8090';
const API_URL = 'http://localhost:8091';

const colors = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    reset: '\x1b[0m',
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testValidation() {
    log('\n=== Testing Input Validation ===\n', 'blue');

    const tests = [
        {
            name: 'Valid folder path',
            url: `${SERVICE_URL}/api/favicon?folder=/opt/dev/test-project`,
            expectedStatus: 200,
            shouldPass: true,
        },
        {
            name: 'Missing folder parameter',
            url: `${SERVICE_URL}/api/favicon`,
            expectedStatus: 400,
            shouldPass: true,
            expectedError: 'folder parameter required',
        },
        {
            name: 'Empty folder parameter',
            url: `${SERVICE_URL}/api/favicon?folder=`,
            expectedStatus: 400,
            shouldPass: true,
            expectedError: 'folder cannot be empty',
        },
        {
            name: 'Path traversal attempt',
            url: `${SERVICE_URL}/api/favicon?folder=/opt/dev/../../etc/passwd`,
            expectedStatus: 403,
            shouldPass: true,
            expectedError: 'Access denied',
        },
        {
            name: 'URL encoded traversal',
            url: `${SERVICE_URL}/api/favicon?folder=%2Fopt%2Fdev%2F..%2F..%2Fetc%2Fpasswd`,
            expectedStatus: 403,
            shouldPass: true,
            expectedError: 'Invalid or unauthorized folder path',
        },
        {
            name: 'Invalid type (number instead of string)',
            url: `${SERVICE_URL}/api/favicon?folder=12345`,
            expectedStatus: 403,
            shouldPass: true,
            expectedError: 'Invalid or unauthorized folder path',
        },
    ];

    let passed = 0;
    let failed = 0;

    for (const test of tests) {
        try {
            const response = await axios.get(test.url, { validateStatus: () => true });

            if (response.status === test.expectedStatus) {
                if (test.expectedError) {
                    const hasError = JSON.stringify(response.data).includes(test.expectedError);
                    if (hasError) {
                        log(
                            `✓ ${test.name} - Blocked as expected (${test.expectedStatus})`,
                            'green'
                        );
                        passed++;
                    } else {
                        log(`✗ ${test.name} - Status correct but error message wrong`, 'red');
                        log(`  Expected: ${test.expectedError}`, 'yellow');
                        log(`  Got: ${JSON.stringify(response.data)}`, 'yellow');
                        failed++;
                    }
                } else {
                    log(`✓ ${test.name} - Passed (${test.expectedStatus})`, 'green');
                    passed++;
                }
            } else {
                log(`✗ ${test.name} - Wrong status code`, 'red');
                log(`  Expected: ${test.expectedStatus}, Got: ${response.status}`, 'yellow');
                failed++;
            }
        } catch (error) {
            log(`✗ ${test.name} - Request failed: ${error.message}`, 'red');
            failed++;
        }
    }

    log('\n=== Testing POST Body Validation ===\n', 'blue');

    const postTests = [
        {
            name: 'Valid notification',
            data: { folder: '/opt/dev/test', message: 'Test message', timestamp: Date.now() },
            expectedStatus: 200,
            shouldPass: true,
        },
        {
            name: 'Missing folder',
            data: { message: 'Test' },
            expectedStatus: 400,
            shouldPass: true,
            expectedError: 'folder required',
        },
        {
            name: 'Message too long (>500 chars)',
            data: {
                folder: '/opt/dev/test',
                message: 'A'.repeat(501),
            },
            expectedStatus: 400,
            shouldPass: true,
            expectedError: 'message must be 500 characters or less',
        },
        {
            name: 'Invalid timestamp (string)',
            data: {
                folder: '/opt/dev/test',
                timestamp: 'not-a-number',
            },
            expectedStatus: 400,
            shouldPass: true,
            expectedError: 'timestamp must be a number',
        },
        {
            name: 'Timestamp too far in future',
            data: {
                folder: '/opt/dev/test',
                timestamp: Date.now() + 365 * 24 * 60 * 60 * 1000,
            },
            expectedStatus: 400,
            shouldPass: true,
            expectedError: 'timestamp outside valid range',
        },
    ];

    for (const test of postTests) {
        try {
            const response = await axios.post(`${API_URL}/claude-completion`, test.data, {
                validateStatus: () => true,
            });

            if (response.status === test.expectedStatus) {
                if (test.expectedError) {
                    const hasError = JSON.stringify(response.data).includes(test.expectedError);
                    if (hasError) {
                        log(
                            `✓ ${test.name} - Blocked as expected (${test.expectedStatus})`,
                            'green'
                        );
                        passed++;
                    } else {
                        log(`✗ ${test.name} - Status correct but error message wrong`, 'red');
                        log(`  Expected: ${test.expectedError}`, 'yellow');
                        log(`  Got: ${JSON.stringify(response.data)}`, 'yellow');
                        failed++;
                    }
                } else {
                    log(`✓ ${test.name} - Passed (${test.expectedStatus})`, 'green');
                    passed++;
                }
            } else {
                log(`✗ ${test.name} - Wrong status code`, 'red');
                log(`  Expected: ${test.expectedStatus}, Got: ${response.status}`, 'yellow');
                failed++;
            }
        } catch (error) {
            log(`✗ ${test.name} - Request failed: ${error.message}`, 'red');
            failed++;
        }
    }

    log('\n=== Testing Body Size Limit ===\n', 'blue');

    try {
        const largePayload = {
            folder: '/opt/dev/test',
            message: 'A'.repeat(15000), // 15KB payload
        };

        const response = await axios.post(`${API_URL}/claude-completion`, largePayload, {
            validateStatus: () => true,
            headers: { 'Content-Type': 'application/json' },
        });

        if (response.status === 413 || response.status === 400) {
            log('✓ Large payload (15KB) rejected', 'green');
            passed++;
        } else {
            log(`✗ Large payload not rejected (status: ${response.status})`, 'red');
            failed++;
        }
    } catch (error) {
        if (error.code === 'ERR_BAD_REQUEST' || error.response?.status === 413) {
            log('✓ Large payload (15KB) rejected', 'green');
            passed++;
        } else {
            log(`✗ Large payload test failed: ${error.message}`, 'red');
            failed++;
        }
    }

    log('\n=== Summary ===\n', 'blue');
    log(`Passed: ${passed}`, 'green');
    log(`Failed: ${failed}`, failed > 0 ? 'red' : 'green');

    return failed === 0;
}

// Run tests
testValidation()
    .then((success) => {
        process.exit(success ? 0 : 1);
    })
    .catch((error) => {
        log(`\nFatal error: ${error.message}`, 'red');
        process.exit(1);
    });
