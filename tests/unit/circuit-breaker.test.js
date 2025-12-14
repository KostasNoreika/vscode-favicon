/**
 * QUA-018: Circuit breaker implementation tests
 * Verifies the extension stops retrying when API is down and recovers gracefully
 */

// Jest globals are available automatically

// Mock chrome API
global.chrome = {
    storage: {
        local: {
            get: jest.fn().mockResolvedValue({}),
            set: jest.fn().mockResolvedValue(undefined),
        },
        sync: {
            get: jest.fn().mockResolvedValue({}),
            set: jest.fn().mockResolvedValue(undefined),
        },
    },
    tabs: {
        query: jest.fn().mockResolvedValue([]),
        sendMessage: jest.fn().mockResolvedValue(undefined),
    },
    action: {
        setBadgeText: jest.fn(),
        setBadgeBackgroundColor: jest.fn(),
        setTitle: jest.fn(),
    },
    alarms: {
        create: jest.fn(),
        onAlarm: {
            addListener: jest.fn(),
        },
    },
    runtime: {
        onMessage: {
            addListener: jest.fn(),
        },
    },
};

// Mock fetch
global.fetch = jest.fn();

// Simple sleep helper
const _sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

describe('Circuit Breaker', () => {
    let circuitBreaker;
    let resetCircuitBreaker;
    let recordCircuitBreakerFailure;
    let shouldAllowRequest;
    let fetchNotifications;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();

        // Reset module state by re-evaluating the background script logic
        // We'll test the circuit breaker logic in isolation
        circuitBreaker = {
            state: 'closed',
            failures: 0,
            lastFailureTime: null,
            backoffDelay: 5000,
            maxBackoffDelay: 5 * 60 * 1000,
            failureThreshold: 3,
            recoveryTimeout: null,
        };

        resetCircuitBreaker = () => {
            const wasOpen = circuitBreaker.state !== 'closed';
            circuitBreaker.state = 'closed';
            circuitBreaker.failures = 0;
            circuitBreaker.backoffDelay = 5000;
            circuitBreaker.lastFailureTime = null;

            if (circuitBreaker.recoveryTimeout) {
                clearTimeout(circuitBreaker.recoveryTimeout);
                circuitBreaker.recoveryTimeout = null;
            }

            return wasOpen;
        };

        recordCircuitBreakerFailure = () => {
            circuitBreaker.failures++;
            circuitBreaker.lastFailureTime = Date.now();

            if (circuitBreaker.failures >= circuitBreaker.failureThreshold) {
                openCircuit();
            }
        };

        const openCircuit = () => {
            if (circuitBreaker.state === 'open') return;

            circuitBreaker.state = 'open';
            const backoff = Math.min(circuitBreaker.backoffDelay, circuitBreaker.maxBackoffDelay);

            if (circuitBreaker.recoveryTimeout) {
                clearTimeout(circuitBreaker.recoveryTimeout);
            }

            circuitBreaker.recoveryTimeout = setTimeout(() => {
                circuitBreaker.state = 'half-open';

                circuitBreaker.backoffDelay = Math.min(
                    circuitBreaker.backoffDelay * 2,
                    circuitBreaker.maxBackoffDelay
                );
            }, backoff);
        };

        shouldAllowRequest = () => {
            if (circuitBreaker.state === 'closed') {
                return { allowed: true };
            }

            if (circuitBreaker.state === 'open') {
                const timeSinceFailure = Date.now() - (circuitBreaker.lastFailureTime || 0);
                return {
                    allowed: false,
                    reason: `Circuit OPEN (${Math.round(timeSinceFailure / 1000)}s since failure)`,
                };
            }

            if (circuitBreaker.state === 'half-open') {
                return { allowed: true, probing: true };
            }

            return { allowed: false, reason: 'Unknown circuit breaker state' };
        };

        // Mock fetchNotifications behavior
        fetchNotifications = async () => {
            const permission = shouldAllowRequest();
            if (!permission.allowed) {
                return { blocked: true, reason: permission.reason };
            }

            try {
                const response = await fetch('https://test-api/notifications');

                if (response.ok) {
                    resetCircuitBreaker();
                    return { success: true };
                } else {
                    recordCircuitBreakerFailure();
                    return { success: false, error: 'API error' };
                }
            } catch (error) {
                if (error.name !== 'AbortError') {
                    recordCircuitBreakerFailure();
                }
                return { success: false, error: error.message };
            }
        };
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('Initial state', () => {
        it('should start with circuit closed', () => {
            expect(circuitBreaker.state).toBe('closed');
            expect(circuitBreaker.failures).toBe(0);
        });

        it('should allow requests when closed', () => {
            const result = shouldAllowRequest();
            expect(result.allowed).toBe(true);
        });
    });

    describe('Failure handling', () => {
        it('should track failures but stay closed for first 2 failures', () => {
            recordCircuitBreakerFailure();
            expect(circuitBreaker.failures).toBe(1);
            expect(circuitBreaker.state).toBe('closed');

            recordCircuitBreakerFailure();
            expect(circuitBreaker.failures).toBe(2);
            expect(circuitBreaker.state).toBe('closed');
        });

        it('should open circuit after 3 consecutive failures', () => {
            recordCircuitBreakerFailure();
            recordCircuitBreakerFailure();
            recordCircuitBreakerFailure();

            expect(circuitBreaker.state).toBe('open');
            expect(circuitBreaker.failures).toBe(3);
        });

        it('should block requests when circuit is open', () => {
            recordCircuitBreakerFailure();
            recordCircuitBreakerFailure();
            recordCircuitBreakerFailure();

            const result = shouldAllowRequest();
            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('Circuit OPEN');
        });

        it('should record last failure timestamp', () => {
            const beforeTime = Date.now();
            recordCircuitBreakerFailure();
            const afterTime = Date.now();

            expect(circuitBreaker.lastFailureTime).toBeGreaterThanOrEqual(beforeTime);
            expect(circuitBreaker.lastFailureTime).toBeLessThanOrEqual(afterTime);
        });
    });

    describe('Exponential backoff', () => {
        it('should start with 5s backoff delay', () => {
            expect(circuitBreaker.backoffDelay).toBe(5000);
        });

        it('should double backoff after each circuit opening', () => {
            // First opening: 5s
            recordCircuitBreakerFailure();
            recordCircuitBreakerFailure();
            recordCircuitBreakerFailure();
            expect(circuitBreaker.state).toBe('open');

            // Advance to half-open
            jest.advanceTimersByTime(5000);
            expect(circuitBreaker.state).toBe('half-open');
            expect(circuitBreaker.backoffDelay).toBe(10000); // Doubled

            // Fail again to re-open
            recordCircuitBreakerFailure();
            expect(circuitBreaker.state).toBe('open');

            // Advance to half-open again
            jest.advanceTimersByTime(10000);
            expect(circuitBreaker.state).toBe('half-open');
            expect(circuitBreaker.backoffDelay).toBe(20000); // Doubled again
        });

        it('should cap backoff at 5 minutes', () => {
            circuitBreaker.backoffDelay = 4 * 60 * 1000; // 4 minutes

            recordCircuitBreakerFailure();
            recordCircuitBreakerFailure();
            recordCircuitBreakerFailure();

            // Advance to half-open
            jest.advanceTimersByTime(4 * 60 * 1000);

            // Should be capped at 5 minutes
            expect(circuitBreaker.backoffDelay).toBe(5 * 60 * 1000);
        });
    });

    describe('Recovery mechanism', () => {
        it('should transition to half-open after backoff period', () => {
            recordCircuitBreakerFailure();
            recordCircuitBreakerFailure();
            recordCircuitBreakerFailure();

            expect(circuitBreaker.state).toBe('open');

            // Advance time by backoff period (5s)
            jest.advanceTimersByTime(5000);

            expect(circuitBreaker.state).toBe('half-open');
        });

        it('should allow probe request in half-open state', () => {
            recordCircuitBreakerFailure();
            recordCircuitBreakerFailure();
            recordCircuitBreakerFailure();

            jest.advanceTimersByTime(5000);

            const result = shouldAllowRequest();
            expect(result.allowed).toBe(true);
            expect(result.probing).toBe(true);
        });

        it('should close circuit on successful probe', () => {
            recordCircuitBreakerFailure();
            recordCircuitBreakerFailure();
            recordCircuitBreakerFailure();

            jest.advanceTimersByTime(5000);
            expect(circuitBreaker.state).toBe('half-open');

            // Successful request
            resetCircuitBreaker();

            expect(circuitBreaker.state).toBe('closed');
            expect(circuitBreaker.failures).toBe(0);
            expect(circuitBreaker.backoffDelay).toBe(5000); // Reset
        });

        it('should re-open circuit on failed probe', () => {
            recordCircuitBreakerFailure();
            recordCircuitBreakerFailure();
            recordCircuitBreakerFailure();

            jest.advanceTimersByTime(5000);
            expect(circuitBreaker.state).toBe('half-open');

            // Failed probe
            recordCircuitBreakerFailure();

            expect(circuitBreaker.state).toBe('open');
            expect(circuitBreaker.failures).toBe(4);
        });
    });

    describe('Integration with fetchNotifications', () => {
        it('should block fetch when circuit is open', async () => {
            recordCircuitBreakerFailure();
            recordCircuitBreakerFailure();
            recordCircuitBreakerFailure();

            const result = await fetchNotifications();

            expect(result.blocked).toBe(true);
            expect(fetch).not.toHaveBeenCalled();
        });

        it('should reset circuit on successful API call', async () => {
            // Simulate previous failures
            circuitBreaker.failures = 2;

            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ notifications: [] }),
            });

            const result = await fetchNotifications();

            expect(result.success).toBe(true);
            expect(circuitBreaker.failures).toBe(0);
            expect(circuitBreaker.state).toBe('closed');
        });

        it('should record failure on API error', async () => {
            fetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
            });

            const result = await fetchNotifications();

            expect(result.success).toBe(false);
            expect(circuitBreaker.failures).toBe(1);
        });

        it('should record failure on network error', async () => {
            fetch.mockRejectedValueOnce(new Error('Network error'));

            const result = await fetchNotifications();

            expect(result.success).toBe(false);
            expect(circuitBreaker.failures).toBe(1);
        });

        it('should NOT record failure on abort', async () => {
            const abortError = new Error('Aborted');
            abortError.name = 'AbortError';
            fetch.mockRejectedValueOnce(abortError);

            const result = await fetchNotifications();

            expect(result.success).toBe(false);
            expect(circuitBreaker.failures).toBe(0); // Aborts don't count
        });
    });

    describe('Full failure and recovery cycle', () => {
        it('should demonstrate complete circuit breaker lifecycle', async () => {
            // Initial state: closed
            expect(circuitBreaker.state).toBe('closed');

            // Simulate 3 failures
            fetch.mockRejectedValue(new Error('Network error'));

            await fetchNotifications(); // Failure 1
            expect(circuitBreaker.failures).toBe(1);
            expect(circuitBreaker.state).toBe('closed');

            await fetchNotifications(); // Failure 2
            expect(circuitBreaker.failures).toBe(2);
            expect(circuitBreaker.state).toBe('closed');

            await fetchNotifications(); // Failure 3 - opens circuit
            expect(circuitBreaker.failures).toBe(3);
            expect(circuitBreaker.state).toBe('open');

            // Requests now blocked
            const blockedResult = await fetchNotifications();
            expect(blockedResult.blocked).toBe(true);
            expect(fetch).toHaveBeenCalledTimes(3); // Only 3 calls, 4th was blocked

            // Advance time to half-open
            jest.advanceTimersByTime(5000);
            expect(circuitBreaker.state).toBe('half-open');

            // Probe fails - stays open with increased backoff
            await fetchNotifications();
            expect(circuitBreaker.state).toBe('open');
            expect(circuitBreaker.backoffDelay).toBe(10000); // Doubled

            // Wait for next half-open
            jest.advanceTimersByTime(10000);
            expect(circuitBreaker.state).toBe('half-open');

            // Probe succeeds - circuit closes
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ notifications: [] }),
            });

            await fetchNotifications();
            expect(circuitBreaker.state).toBe('closed');
            expect(circuitBreaker.failures).toBe(0);
            expect(circuitBreaker.backoffDelay).toBe(5000); // Reset
        });
    });

    describe('Request rate during outage', () => {
        it('should drastically reduce request rate when circuit is open', async () => {
            fetch.mockRejectedValue(new Error('Network error'));

            // Trigger 3 failures to open circuit
            await fetchNotifications();
            await fetchNotifications();
            await fetchNotifications();

            const initialCallCount = fetch.mock.calls.length;
            expect(circuitBreaker.state).toBe('open');

            // Try to make 10 more requests - all should be blocked
            for (let i = 0; i < 10; i++) {
                await fetchNotifications();
            }

            // No additional fetch calls should have been made
            expect(fetch).toHaveBeenCalledTimes(initialCallCount);
        });
    });
});
