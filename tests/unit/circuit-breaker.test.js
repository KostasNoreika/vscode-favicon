/**
 * QUA-018: Circuit breaker implementation tests
 * Verifies the extension stops retrying when API is down and recovers gracefully
 */

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

// Mock console methods
global.console = {
    ...console,
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
};

const CircuitBreaker = require('../../vscode-favicon-extension/modules/circuit-breaker');

describe('Circuit Breaker', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('Initial state', () => {
        it('should start with circuit closed', () => {
            const breaker = new CircuitBreaker();
            expect(breaker.state).toBe('closed');
            expect(breaker.failures).toBe(0);
        });

        it('should allow requests when closed', () => {
            const breaker = new CircuitBreaker();
            const result = breaker.shouldAllowRequest();
            expect(result.allowed).toBe(true);
        });

        it('should use custom config values', () => {
            const breaker = new CircuitBreaker({
                failureThreshold: 5,
                initialBackoffDelay: 10000,
                maxBackoffDelay: 60000,
            });
            expect(breaker.failureThreshold).toBe(5);
            expect(breaker.backoffDelay).toBe(10000);
            expect(breaker.maxBackoffDelay).toBe(60000);
        });
    });

    describe('State persistence', () => {
        it('should save state to storage on failure', async () => {
            const breaker = new CircuitBreaker();
            await breaker.recordFailure();

            expect(chrome.storage.local.set).toHaveBeenCalledWith({
                circuitBreakerState: {
                    state: 'closed',
                    failures: 1,
                    lastFailureTime: expect.any(Number),
                    backoffDelay: 5000,
                },
            });
        });

        it('should save state to storage on success', async () => {
            const breaker = new CircuitBreaker();
            breaker.state = 'open';
            breaker.failures = 3;
            await breaker.recordSuccess();

            expect(chrome.storage.local.set).toHaveBeenCalledWith({
                circuitBreakerState: {
                    state: 'closed',
                    failures: 0,
                    lastFailureTime: null,
                    backoffDelay: 5000,
                },
            });
        });

        it('should load state from storage', async () => {
            chrome.storage.local.get.mockResolvedValue({
                circuitBreakerState: {
                    state: 'closed',
                    failures: 2,
                    lastFailureTime: Date.now() - 1000,
                    backoffDelay: 10000,
                },
            });

            const breaker = new CircuitBreaker();
            await breaker.loadState();

            expect(breaker.state).toBe('closed');
            expect(breaker.failures).toBe(2);
            expect(breaker.backoffDelay).toBe(10000);
        });

        it('should recover to half-open if recovery time passed', async () => {
            const pastTime = Date.now() - 10000; // 10 seconds ago
            chrome.storage.local.get.mockResolvedValue({
                circuitBreakerState: {
                    state: 'open',
                    failures: 3,
                    lastFailureTime: pastTime,
                    backoffDelay: 5000, // 5 second backoff, already passed
                },
            });

            const breaker = new CircuitBreaker();
            await breaker.loadState();

            expect(breaker.state).toBe('half-open');
        });

        it('should schedule recovery if still waiting', async () => {
            const recentTime = Date.now() - 1000; // 1 second ago
            chrome.storage.local.get.mockResolvedValue({
                circuitBreakerState: {
                    state: 'open',
                    failures: 3,
                    lastFailureTime: recentTime,
                    backoffDelay: 5000, // Still 4 seconds to wait
                },
            });

            const breaker = new CircuitBreaker();
            await breaker.loadState();

            expect(breaker.state).toBe('open');
            expect(breaker.recoveryTimeout).toBeTruthy();
        });

        it('should handle storage errors gracefully', async () => {
            chrome.storage.local.get.mockRejectedValue(new Error('Storage error'));

            const breaker = new CircuitBreaker();
            await breaker.loadState();

            // Should continue with default state
            expect(breaker.state).toBe('closed');
            expect(breaker.failures).toBe(0);
        });

        it('should handle missing state in storage', async () => {
            chrome.storage.local.get.mockResolvedValue({});

            const breaker = new CircuitBreaker();
            await breaker.loadState();

            expect(breaker.state).toBe('closed');
            expect(breaker.failures).toBe(0);
        });

        it('should handle save errors gracefully', async () => {
            chrome.storage.local.set.mockRejectedValue(new Error('Storage full'));

            const breaker = new CircuitBreaker();
            await breaker.recordFailure();

            // Should not throw, just log error
            expect(console.error).toHaveBeenCalledWith(
                'Circuit Breaker: Failed to save state:',
                'Storage full'
            );
        });
    });

    describe('Failure handling', () => {
        it('should track failures but stay closed for first 2 failures', async () => {
            const breaker = new CircuitBreaker();
            await breaker.recordFailure();
            expect(breaker.failures).toBe(1);
            expect(breaker.state).toBe('closed');

            await breaker.recordFailure();
            expect(breaker.failures).toBe(2);
            expect(breaker.state).toBe('closed');
        });

        it('should open circuit after 3 consecutive failures', async () => {
            const breaker = new CircuitBreaker();
            await breaker.recordFailure();
            await breaker.recordFailure();
            await breaker.recordFailure();

            expect(breaker.state).toBe('open');
            expect(breaker.failures).toBe(3);
        });

        it('should block requests when circuit is open', async () => {
            const breaker = new CircuitBreaker();
            await breaker.recordFailure();
            await breaker.recordFailure();
            await breaker.recordFailure();

            const result = breaker.shouldAllowRequest();
            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('Circuit OPEN');
        });

        it('should record last failure timestamp', async () => {
            const beforeTime = Date.now();
            const breaker = new CircuitBreaker();
            await breaker.recordFailure();
            const afterTime = Date.now();

            expect(breaker.lastFailureTime).toBeGreaterThanOrEqual(beforeTime);
            expect(breaker.lastFailureTime).toBeLessThanOrEqual(afterTime);
        });

        it('should not re-open if already open', async () => {
            const breaker = new CircuitBreaker();
            await breaker.recordFailure();
            await breaker.recordFailure();
            await breaker.recordFailure();

            const firstTimeout = breaker.recoveryTimeout;
            expect(breaker.state).toBe('open');

            // Try to open again
            await breaker._openCircuit();

            // Should not create new timeout
            expect(breaker.recoveryTimeout).toBe(firstTimeout);
        });
    });

    describe('Exponential backoff', () => {
        it('should start with 5s backoff delay', () => {
            const breaker = new CircuitBreaker();
            expect(breaker.backoffDelay).toBe(5000);
        });

        it('should double backoff after each circuit opening', async () => {
            const breaker = new CircuitBreaker();

            // First opening: 5s
            await breaker.recordFailure();
            await breaker.recordFailure();
            await breaker.recordFailure();
            expect(breaker.state).toBe('open');

            // Advance to half-open
            jest.advanceTimersByTime(5000);
            expect(breaker.state).toBe('half-open');
            expect(breaker.backoffDelay).toBe(10000); // Doubled

            // Fail again to re-open
            await breaker.recordFailure();
            expect(breaker.state).toBe('open');

            // Advance to half-open again
            jest.advanceTimersByTime(10000);
            expect(breaker.state).toBe('half-open');
            expect(breaker.backoffDelay).toBe(20000); // Doubled again
        });

        it('should cap backoff at 5 minutes', async () => {
            const breaker = new CircuitBreaker();
            breaker.backoffDelay = 4 * 60 * 1000; // 4 minutes

            await breaker.recordFailure();
            await breaker.recordFailure();
            await breaker.recordFailure();

            // Advance to half-open
            jest.advanceTimersByTime(4 * 60 * 1000);

            // Should be capped at 5 minutes
            expect(breaker.backoffDelay).toBe(5 * 60 * 1000);
        });

        it('should respect custom max backoff', async () => {
            const breaker = new CircuitBreaker({
                maxBackoffDelay: 30000, // 30 seconds
            });
            breaker.backoffDelay = 20000;

            await breaker.recordFailure();
            await breaker.recordFailure();
            await breaker.recordFailure();

            jest.advanceTimersByTime(20000);

            // Should be capped at 30 seconds
            expect(breaker.backoffDelay).toBe(30000);
        });
    });

    describe('Recovery mechanism', () => {
        it('should transition to half-open after backoff period', async () => {
            const breaker = new CircuitBreaker();
            await breaker.recordFailure();
            await breaker.recordFailure();
            await breaker.recordFailure();

            expect(breaker.state).toBe('open');

            // Advance time by backoff period (5s)
            jest.advanceTimersByTime(5000);

            expect(breaker.state).toBe('half-open');
        });

        it('should allow probe request in half-open state', async () => {
            const breaker = new CircuitBreaker();
            await breaker.recordFailure();
            await breaker.recordFailure();
            await breaker.recordFailure();

            jest.advanceTimersByTime(5000);

            const result = breaker.shouldAllowRequest();
            expect(result.allowed).toBe(true);
            expect(result.probing).toBe(true);
        });

        it('should close circuit on successful probe', async () => {
            const breaker = new CircuitBreaker();
            await breaker.recordFailure();
            await breaker.recordFailure();
            await breaker.recordFailure();

            jest.advanceTimersByTime(5000);
            expect(breaker.state).toBe('half-open');

            // Successful request
            await breaker.recordSuccess();

            expect(breaker.state).toBe('closed');
            expect(breaker.failures).toBe(0);
            expect(breaker.backoffDelay).toBe(5000); // Reset
        });

        it('should re-open circuit on failed probe', async () => {
            const breaker = new CircuitBreaker();
            await breaker.recordFailure();
            await breaker.recordFailure();
            await breaker.recordFailure();

            jest.advanceTimersByTime(5000);
            expect(breaker.state).toBe('half-open');

            // Failed probe
            await breaker.recordFailure();

            expect(breaker.state).toBe('open');
            expect(breaker.failures).toBe(4);
        });

        it('should clear recovery timeout on success', async () => {
            const breaker = new CircuitBreaker();
            await breaker.recordFailure();
            await breaker.recordFailure();
            await breaker.recordFailure();

            expect(breaker.recoveryTimeout).toBeTruthy();

            await breaker.recordSuccess();

            expect(breaker.recoveryTimeout).toBeNull();
        });

        it('should clear existing timeout when scheduling new recovery', async () => {
            const breaker = new CircuitBreaker();
            await breaker.recordFailure();
            await breaker.recordFailure();
            await breaker.recordFailure();

            const firstTimeout = breaker.recoveryTimeout;

            // Manually trigger another recovery schedule
            breaker._scheduleRecovery(10000);

            // Should have new timeout
            expect(breaker.recoveryTimeout).not.toBe(firstTimeout);
        });
    });

    describe('getStats', () => {
        it('should return current statistics', async () => {
            const breaker = new CircuitBreaker();
            await breaker.recordFailure();

            const stats = breaker.getStats();

            expect(stats).toMatchObject({
                state: 'closed',
                failures: 1,
                lastFailureTime: expect.any(Number),
                backoffDelay: 5000,
                timeSinceFailure: expect.any(Number),
            });
        });

        it('should return null timeSinceFailure when no failures', () => {
            const breaker = new CircuitBreaker();
            const stats = breaker.getStats();

            expect(stats.timeSinceFailure).toBeNull();
        });

        it('should calculate time since failure correctly', async () => {
            const breaker = new CircuitBreaker();
            await breaker.recordFailure();

            jest.advanceTimersByTime(2000);

            const stats = breaker.getStats();
            expect(stats.timeSinceFailure).toBeGreaterThanOrEqual(2000);
        });
    });

    describe('Edge cases', () => {
        it('should handle unknown state in shouldAllowRequest', () => {
            const breaker = new CircuitBreaker();
            breaker.state = 'invalid-state';

            const result = breaker.shouldAllowRequest();
            expect(result.allowed).toBe(false);
            expect(result.reason).toBe('Unknown circuit breaker state');
        });

        it('should handle missing lastFailureTime in open state', () => {
            const breaker = new CircuitBreaker();
            breaker.state = 'open';
            breaker.lastFailureTime = null;

            const result = breaker.shouldAllowRequest();
            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('Circuit OPEN');
        });

        it('should handle custom failure threshold', async () => {
            const breaker = new CircuitBreaker({ failureThreshold: 5 });

            await breaker.recordFailure();
            await breaker.recordFailure();
            await breaker.recordFailure();
            await breaker.recordFailure();
            expect(breaker.state).toBe('closed');

            await breaker.recordFailure();
            expect(breaker.state).toBe('open');
        });
    });

    describe('Integration scenarios', () => {
        it('should demonstrate complete circuit breaker lifecycle', async () => {
            const breaker = new CircuitBreaker();

            // Initial state: closed
            expect(breaker.state).toBe('closed');

            // Simulate 3 failures
            await breaker.recordFailure(); // Failure 1
            expect(breaker.failures).toBe(1);
            expect(breaker.state).toBe('closed');

            await breaker.recordFailure(); // Failure 2
            expect(breaker.failures).toBe(2);
            expect(breaker.state).toBe('closed');

            await breaker.recordFailure(); // Failure 3 - opens circuit
            expect(breaker.failures).toBe(3);
            expect(breaker.state).toBe('open');

            // Requests now blocked
            let result = breaker.shouldAllowRequest();
            expect(result.allowed).toBe(false);

            // Advance time to half-open
            jest.advanceTimersByTime(5000);
            expect(breaker.state).toBe('half-open');

            // Probe fails - stays open with increased backoff
            await breaker.recordFailure();
            expect(breaker.state).toBe('open');
            expect(breaker.backoffDelay).toBe(10000); // Doubled

            // Wait for next half-open
            jest.advanceTimersByTime(10000);
            expect(breaker.state).toBe('half-open');

            // Probe succeeds - circuit closes
            await breaker.recordSuccess();
            expect(breaker.state).toBe('closed');
            expect(breaker.failures).toBe(0);
            expect(breaker.backoffDelay).toBe(5000); // Reset
        });

        it('should persist and recover state across restarts', async () => {
            // First breaker instance - accumulate failures
            const breaker1 = new CircuitBreaker();
            await breaker1.recordFailure();
            await breaker1.recordFailure();
            await breaker1.recordFailure();
            expect(breaker1.state).toBe('open');

            // Simulate restart - load state into new instance
            const savedState = {
                circuitBreakerState: {
                    state: breaker1.state,
                    failures: breaker1.failures,
                    lastFailureTime: breaker1.lastFailureTime,
                    backoffDelay: breaker1.backoffDelay,
                },
            };

            chrome.storage.local.get.mockResolvedValue(savedState);

            const breaker2 = new CircuitBreaker();
            await breaker2.loadState();

            // Should restore state
            expect(breaker2.state).toBe('open');
            expect(breaker2.failures).toBe(3);
        });
    });
});
