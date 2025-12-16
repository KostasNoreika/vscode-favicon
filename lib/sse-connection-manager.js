/**
 * SSE Connection Manager Module
 *
 * Centralized SSE lifecycle management with clear separation of concerns.
 * Handles validation, setup, subscription, keepalive, and cleanup for SSE connections.
 *
 * Key responsibilities:
 * - Connection limit validation (per-IP and global)
 * - SSE header configuration
 * - Initial state transmission
 * - Notification subscription management
 * - Keepalive interval management
 * - Resource cleanup on disconnect
 *
 * REF-011: Extracted from notification-routes.js to reduce complexity
 * SEC-006: Fixed TOCTOU race condition in connection limit enforcement
 * PERF-006: Use pre-serialized SSE payloads to avoid repeated JSON.stringify per client
 * PERF-001: SSE broadcasts use pre-serialized event.serializedPayload from notification-events
 * PERF-011: Pre-serialize static SSE payloads as module-level constants
 * QUA-007: Fixed race conditions in SSE cleanup to prevent resource leaks
 * QUA-012: Standardized error response format
 */

const config = require('./config');
const notificationStore = require('./notification-store');
const { sseConnectionsActive } = require('./metrics');
const { ErrorCodes } = require('./response-helpers');

// PERF-011: Pre-serialize static SSE payloads to avoid repeated JSON.stringify
const EMPTY_NOTIFICATION_PAYLOAD = JSON.stringify({ hasNotification: false });

/**
 * SSE Connection Manager
 * Manages the complete lifecycle of Server-Sent Events connections
 */
class SSEConnectionManager {
    /**
     * Initialize SSE Connection Manager
     * @param {Object} options - Configuration options
     * @param {number} options.maxConnectionsPerIP - Maximum connections per IP address
     * @param {number} options.globalLimit - Global connection limit
     * @param {number} options.keepaliveInterval - Keepalive ping interval in milliseconds
     */
    constructor(options = {}) {
        // Connection tracking
        this.sseConnections = new Map(); // IP -> connection count
        this.globalSSEConnections = 0;

        // Configuration - use !== undefined to allow 0 as valid value
        this.maxConnectionsPerIP = options.maxConnectionsPerIP !== undefined
            ? options.maxConnectionsPerIP
            : config.sseMaxConnectionsPerIP;
        this.globalLimit = options.globalLimit !== undefined
            ? options.globalLimit
            : config.sseGlobalLimit;
        this.keepaliveInterval = options.keepaliveInterval !== undefined
            ? options.keepaliveInterval
            : config.sseKeepaliveInterval;
    }

    /**
     * Validates SSE connection limits (global and per-IP)
     * Uses atomic increment-first-then-validate pattern to prevent TOCTOU race conditions
     *
     * SEC-006: Fixed TOCTOU vulnerability by removing pre-check and using atomic increment pattern
     * QUA-012: Standardized error response format
     *
     * @param {Object} req - Express request object
     * @param {string} ip - Client IP address
     * @returns {Object|null} Returns error response object if limit exceeded, null if valid
     */
    validateConnectionLimits(req, ip) {
        // SECURITY: Atomic increment-first-then-validate pattern for global limit
        // SEC-006: Removed pre-check to prevent TOCTOU race condition
        // Under concurrent requests, this ensures limit is enforced atomically:
        //   Request A: increment (5), check (5 > 5? no), proceed
        //   Request B: increment (6), check (6 > 5? yes), rollback to (5), reject
        this.globalSSEConnections++;

        if (this.globalSSEConnections > this.globalLimit) {
            // Exceeded limit - rollback and reject
            this.globalSSEConnections--;
            req.log.warn(
                { globalConnections: this.globalSSEConnections, limit: this.globalLimit },
                'Global SSE connection limit exceeded'
            );
            return {
                status: 503,
                code: ErrorCodes.SERVICE_UNAVAILABLE,
                message: 'Service at capacity',
            };
        }

        // SECURITY: Atomic increment-first-then-validate pattern for per-IP limit
        // SEC-006: Same atomic pattern for per-IP limit
        const currentConnections = this.sseConnections.get(ip) || 0;
        this.sseConnections.set(ip, currentConnections + 1);

        if (currentConnections + 1 > this.maxConnectionsPerIP) {
            // Exceeded per-IP limit - rollback both counters and reject
            this.sseConnections.set(ip, currentConnections); // Rollback per-IP
            this.globalSSEConnections--; // Rollback global

            req.log.warn(
                { ip, connections: currentConnections, limit: this.maxConnectionsPerIP },
                'SSE connection limit exceeded for IP'
            );
            return {
                status: 429,
                code: ErrorCodes.RATE_LIMITED,
                message: 'Too many concurrent connections',
            };
        }

        // Update Prometheus gauge with current active connections
        sseConnectionsActive.set(this.globalSSEConnections);

        return null; // Valid - no error, counters already incremented
    }

    /**
     * Sets up SSE-specific response headers
     *
     * @param {Object} res - Express response object
     */
    setupHeaders(res) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    }

    /**
     * Sends initial SSE connection state and current notification status
     * PERF-011: Uses pre-serialized payloads for static content
     *
     * @param {Object} res - Express response object
     * @param {string} folder - Validated project folder path
     */
    sendInitialState(res, folder) {
        // Send initial connection event (timestamp is dynamic, must serialize each time)
        res.write('event: connected\n');
        res.write(`data: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);

        // Send current notification state immediately
        const currentNotification = notificationStore.get(folder);
        if (currentNotification && currentNotification.unread) {
            // Dynamic payload - must serialize with current notification data
            res.write('event: notification\n');
            res.write(
                `data: ${JSON.stringify({
                    hasNotification: true,
                    timestamp: currentNotification.timestamp,
                    message: currentNotification.message,
                    status: currentNotification.status || 'completed',
                    ...(currentNotification.metadata && { metadata: currentNotification.metadata }),
                })}\n\n`
            );
        } else {
            // PERF-011: Use pre-serialized static payload
            res.write('event: notification\n');
            res.write(`data: ${EMPTY_NOTIFICATION_PAYLOAD}\n\n`);
        }
    }

    /**
     * Subscribes to notification events for a specific folder
     * Uses optimized event emitter pattern with folder filtering
     * PERF-001: Uses pre-serialized event.serializedPayload from notification-events
     *
     * @param {Object} res - Express response object
     * @param {string} folder - Validated project folder path
     * @returns {Function} Cleanup function to unsubscribe
     */
    subscribeToNotifications(res, folder) {
        // Create listener that filters events for this specific folder
        const listener = (event) => {
            // Only process events for this folder
            if (event.folder !== folder) {
                return;
            }

            // Check if response is still writable before sending
            if (!res.writable) {
                return;
            }

            // PERF-001: Use pre-serialized payload from notification-events.js
            // The notification-events module already serializes the payload in buildSSEPayload(),
            // avoiding redundant JSON.stringify() calls for each connected SSE client
            if (event.serializedPayload) {
                res.write('event: notification\n');
                res.write(`data: ${event.serializedPayload}\n\n`);
            }
        };

        // Subscribe using notification-store's subscribe API
        return notificationStore.subscribe(listener);
    }

    /**
     * Starts SSE keepalive interval to prevent connection timeouts
     * Task REF-011: Extracted helper for keepalive setup
     *
     * @param {Object} res - Express response object
     * @returns {NodeJS.Timeout} Interval ID for cleanup
     */
    startKeepalive(res) {
        return setInterval(() => {
            res.write(':keepalive\n\n');
        }, this.keepaliveInterval);
    }

    /**
     * Creates cleanup function for SSE connection
     * Task REF-011: Extracted helper for cleanup setup
     *
     * Handles interval clearing, unsubscription, and counter management
     * QUA-007: Fixed race conditions by ensuring cleanup runs exactly once
     *
     * @param {string} ip - Client IP address
     * @param {string} folder - Project folder path
     * @param {Object} req - Express request object (for logging)
     * @returns {Object} Object with cleanup function and setters for resources
     */
    createCleanupHandler(ip, folder, req) {
        // QUA-007: Initialize resources to safe defaults (null)
        let keepaliveInterval = null;
        let unsubscribe = null;
        let cleanedUp = false; // Flag to ensure cleanup runs exactly once

        // Return cleanup function that will be called on disconnect
        const cleanup = () => {
            // QUA-007: Guarantee cleanup runs exactly once to prevent race conditions
            if (cleanedUp) {
                return;
            }
            cleanedUp = true;

            // QUA-007: Clear keepalive interval with null check
            if (keepaliveInterval !== null) {
                clearInterval(keepaliveInterval);
                keepaliveInterval = null;
            }

            // QUA-007: Unsubscribe from notifications with null check
            if (unsubscribe !== null) {
                try {
                    unsubscribe();
                    unsubscribe = null;
                } catch (err) {
                    req.log.warn({ err, folder }, 'Error during unsubscribe');
                }
            }

            // Decrement global connection count with edge case handling
            this.globalSSEConnections = Math.max(0, this.globalSSEConnections - 1);

            // Decrement per-IP connection count with proper edge case handling
            const connections = this.sseConnections.get(ip) || 0;
            if (connections <= 1) {
                this.sseConnections.delete(ip);
            } else {
                this.sseConnections.set(ip, connections - 1);
            }

            // Update Prometheus gauge with current active connections
            sseConnectionsActive.set(this.globalSSEConnections);

            req.log.info(
                { folder, ip, remainingConnections: Math.max(0, connections - 1) },
                'SSE client disconnected'
            );
        };

        // Return object with cleanup function and setters for resources
        return {
            cleanup,
            // QUA-007: Setters check cleanedUp flag to prevent setting resources after cleanup
            setKeepaliveInterval: (interval) => {
                if (!cleanedUp) {
                    keepaliveInterval = interval;
                } else {
                    // Cleanup already ran, immediately clean the interval
                    clearInterval(interval);
                }
            },
            setUnsubscribe: (unsub) => {
                if (!cleanedUp) {
                    unsubscribe = unsub;
                } else {
                    // Cleanup already ran, immediately call unsubscribe
                    try {
                        unsub();
                    } catch (err) {
                        req.log.warn({ err, folder }, 'Error during late unsubscribe');
                    }
                }
            },
        };
    }

    /**
     * Establishes SSE connection with complete lifecycle management
     * Task REF-011: Main orchestration method - delegates to extracted helpers
     *
     * QUA-007: Fixed race conditions in cleanup by ensuring idempotency and proper resource handling
     *
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     * @param {string} validatedPath - Validated project folder path
     * @returns {Object|null} Returns error object if connection rejected, null if successful
     */
    establishConnection(req, res, validatedPath) {
        const ip = req.ip;

        // Step 1: Validate connection limits (atomic increment + validate)
        const limitError = this.validateConnectionLimits(req, ip);
        if (limitError) {
            return limitError; // Connection rejected
        }

        // Step 2: Create cleanup handler to manage resource cleanup on disconnect
        const cleanupHandler = this.createCleanupHandler(ip, validatedPath, req);

        // Register close handler to trigger cleanup
        res.on('close', cleanupHandler.cleanup);

        // Step 3: Setup SSE headers
        this.setupHeaders(res);

        // Step 4: Send initial connection state
        this.sendInitialState(res, validatedPath);

        req.log.info(
            { folder: validatedPath, ip, connections: this.sseConnections.get(ip) },
            'SSE client connected'
        );

        // Step 5: Subscribe to notifications
        const unsubscribe = this.subscribeToNotifications(res, validatedPath);
        cleanupHandler.setUnsubscribe(unsubscribe);

        // Step 6: Start keepalive interval
        const keepaliveInterval = this.startKeepalive(res);
        cleanupHandler.setKeepaliveInterval(keepaliveInterval);

        return null; // Success - no error
    }

    /**
     * Get connection statistics for health monitoring
     * Task REF-011: Returns stats in consistent format for tests
     *
     * @returns {Object} Connection statistics
     */
    getStats() {
        return {
            totalConnections: this.globalSSEConnections,
            globalConnections: this.globalSSEConnections, // Alias for backward compatibility
            totalIPs: this.sseConnections.size,
            uniqueIPs: this.sseConnections.size, // Alias for backward compatibility
            maxPerIP: this.maxConnectionsPerIP,
            globalLimit: this.globalLimit,
        };
    }

    /**
     * Reset connection tracking (for testing)
     * WARNING: Only use in tests, not in production code
     */
    reset() {
        this.sseConnections.clear();
        this.globalSSEConnections = 0;
    }
}

module.exports = SSEConnectionManager;
