/**
 * Circuit Breaker Pattern Implementation
 * QUA-018: Prevents extension from amplifying API outages with infinite retries
 *
 * States:
 * - CLOSED: Normal operation, all requests allowed
 * - OPEN: Too many failures, requests blocked
 * - HALF_OPEN: Testing if service recovered, single probe request allowed
 */

(function() {
'use strict';

const CIRCUIT_BREAKER_STORAGE_KEY = 'circuitBreakerState';

/**
 * Circuit Breaker class
 * Implements state machine with exponential backoff and auto-recovery
 */
class CircuitBreaker {
    constructor(config = {}) {
        this.state = 'closed';
        this.failures = 0;
        this.lastFailureTime = null;
        this.backoffDelay = config.initialBackoffDelay || 5000; // 5s initial delay
        this.maxBackoffDelay = config.maxBackoffDelay || 5 * 60 * 1000; // 5 minutes max
        this.failureThreshold = config.failureThreshold || 3;
        this.recoveryTimeout = null;
        this.initialBackoffDelay = config.initialBackoffDelay || 5000;
    }

    /**
     * Load circuit breaker state from storage
     * @returns {Promise<void>}
     */
    async loadState() {
        try {
            const data = await chrome.storage.local.get(CIRCUIT_BREAKER_STORAGE_KEY);
            const saved = data[CIRCUIT_BREAKER_STORAGE_KEY];

            if (saved) {
                this.state = saved.state || 'closed';
                this.failures = saved.failures || 0;
                this.lastFailureTime = saved.lastFailureTime || null;
                this.backoffDelay = saved.backoffDelay || this.initialBackoffDelay;

                // If we were in OPEN state, schedule recovery
                if (this.state === 'open' && this.lastFailureTime) {
                    const timeSinceFailure = Date.now() - this.lastFailureTime;
                    const remainingDelay = Math.max(0, this.backoffDelay - timeSinceFailure);

                    if (remainingDelay > 0) {
                        this._scheduleRecovery(remainingDelay);
                    } else {
                        // Recovery time already passed, transition to half-open
                        this.state = 'half-open';
                        await this.saveState();
                    }
                }

                console.log('Circuit Breaker: Loaded state:', this.state,
                    'failures:', this.failures, 'backoff:', this.backoffDelay);
            }
        } catch (error) {
            console.error('Circuit Breaker: Failed to load state:', error.message);
            // Continue with default closed state
        }
    }

    /**
     * Save circuit breaker state to storage
     * @returns {Promise<void>}
     */
    async saveState() {
        try {
            await chrome.storage.local.set({
                [CIRCUIT_BREAKER_STORAGE_KEY]: {
                    state: this.state,
                    failures: this.failures,
                    lastFailureTime: this.lastFailureTime,
                    backoffDelay: this.backoffDelay,
                },
            });
        } catch (error) {
            console.error('Circuit Breaker: Failed to save state:', error.message);
            // Continue anyway - state will be lost on restart but circuit breaker still works
        }
    }

    /**
     * Check if a request should be allowed
     * @returns {object} - { allowed: boolean, reason?: string, probing?: boolean }
     */
    shouldAllowRequest() {
        if (this.state === 'closed') {
            return { allowed: true };
        }

        if (this.state === 'open') {
            const timeSinceFailure = Date.now() - (this.lastFailureTime || 0);
            return {
                allowed: false,
                reason: `Circuit OPEN (${Math.round(timeSinceFailure / 1000)}s since failure)`,
            };
        }

        if (this.state === 'half-open') {
            return { allowed: true, probing: true };
        }

        return { allowed: false, reason: 'Unknown circuit breaker state' };
    }

    /**
     * Record a failure and potentially open the circuit
     * @returns {Promise<void>}
     */
    async recordFailure() {
        this.failures++;
        this.lastFailureTime = Date.now();

        console.log('Circuit Breaker: Failure recorded (total:', this.failures + ')');

        if (this.failures >= this.failureThreshold) {
            await this._openCircuit();
        } else {
            await this.saveState();
        }
    }

    /**
     * Record a success and close the circuit
     * @returns {Promise<void>}
     */
    async recordSuccess() {
        const wasOpen = this.state !== 'closed';

        this.state = 'closed';
        this.failures = 0;
        this.backoffDelay = this.initialBackoffDelay;
        this.lastFailureTime = null;

        if (this.recoveryTimeout) {
            clearTimeout(this.recoveryTimeout);
            this.recoveryTimeout = null;
        }

        await this.saveState();

        if (wasOpen) {
            console.log('Circuit Breaker: Circuit CLOSED - service recovered');
        }
    }

    /**
     * Open the circuit and schedule recovery
     * @private
     */
    async _openCircuit() {
        if (this.state === 'open') return;

        this.state = 'open';
        const backoff = Math.min(this.backoffDelay, this.maxBackoffDelay);

        console.log('Circuit Breaker: Circuit OPEN - blocking requests for',
            Math.round(backoff / 1000), 'seconds');

        await this.saveState();

        this._scheduleRecovery(backoff);
    }

    /**
     * Schedule transition to half-open state
     * @param {number} delay - Delay in milliseconds
     * @private
     */
    _scheduleRecovery(delay) {
        if (this.recoveryTimeout) {
            clearTimeout(this.recoveryTimeout);
        }

        this.recoveryTimeout = setTimeout(async () => {
            this.state = 'half-open';

            // Increase backoff for next potential failure
            this.backoffDelay = Math.min(
                this.backoffDelay * 2,
                this.maxBackoffDelay
            );

            await this.saveState();

            console.log('Circuit Breaker: Circuit HALF-OPEN - probing service',
                '(next backoff:', Math.round(this.backoffDelay / 1000) + 's)');
        }, delay);
    }

    /**
     * Get current circuit breaker statistics
     * @returns {object}
     */
    getStats() {
        return {
            state: this.state,
            failures: this.failures,
            lastFailureTime: this.lastFailureTime,
            backoffDelay: this.backoffDelay,
            timeSinceFailure: this.lastFailureTime
                ? Date.now() - this.lastFailureTime
                : null,
        };
    }
}

// Export for both Node.js (testing) and browser (service worker)
// Use require check to definitively detect Node.js (avoid false positives from partial module shims)
if (typeof require === 'function' && typeof module !== 'undefined') {
    module.exports = CircuitBreaker;
} else if (typeof self !== 'undefined') {
    // Service worker global
    self.CircuitBreaker = CircuitBreaker;
} else if (typeof window !== 'undefined') {
    // Browser global
    window.CircuitBreaker = CircuitBreaker;
}

})(); // End IIFE
