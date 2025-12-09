/**
 * Notification Routes Module
 * Routes for Claude AI completion notifications and SSE streaming
 *
 * Endpoints:
 * - POST /claude-completion - Create completion notification
 * - POST /claude-started - Create working notification
 * - GET /claude-status - Get notification status for a project
 * - POST /claude-status/mark-read - Mark notification as read
 * - DELETE /claude-status - Delete notification
 * - GET /api/notifications/unread - Get all unread notifications
 * - GET /notifications/stream - SSE stream for real-time notifications
 */

const express = require('express');
const router = express.Router();
const config = require('../config');
const notificationStore = require('../notification-store');
const { validateNotificationBody, handleValidationErrors } = require('../validators');

// SECURITY: SSE connection tracking per IP
const sseConnections = new Map(); // IP -> connection count
const MAX_CONNECTIONS_PER_IP = config.sseMaxConnectionsPerIP;
const SSE_GLOBAL_LIMIT = config.sseGlobalLimit;
let globalSSEConnections = 0;

/**
 * Validates SSE connection limits (global and per-IP)
 * Uses atomic increment pattern to prevent TOCTOU race conditions
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} ip - Client IP address
 * @returns {Object|null} Returns error response object if limit exceeded, null if valid
 */
function validateSSEConnectionLimits(req, res, ip) {
    // SECURITY: Check global SSE connection limit with atomic increment
    // FIX QUA-009: Use post-check pattern to prevent TOCTOU race condition
    if (globalSSEConnections >= SSE_GLOBAL_LIMIT) {
        req.log.warn(
            { globalConnections: globalSSEConnections },
            'Global SSE connection limit exceeded'
        );
        // QUA-010: Standardized error format with details
        return {
            status: 503,
            body: {
                error: 'Service at capacity',
                details: {
                    limit: SSE_GLOBAL_LIMIT,
                    current: globalSSEConnections,
                },
            },
        };
    }

    // Increment first, then check if we exceeded limit
    globalSSEConnections++;
    if (globalSSEConnections > SSE_GLOBAL_LIMIT) {
        // We exceeded the limit, decrement and reject
        globalSSEConnections--;
        req.log.warn(
            { globalConnections: globalSSEConnections },
            'Global SSE connection limit exceeded (atomic check)'
        );
        // QUA-010: Standardized error format with details
        return {
            status: 503,
            body: {
                error: 'Service at capacity',
                details: {
                    limit: SSE_GLOBAL_LIMIT,
                    current: globalSSEConnections,
                },
            },
        };
    }

    // SECURITY: Check SSE connection limit per IP
    const currentConnections = sseConnections.get(ip) || 0;

    if (currentConnections >= MAX_CONNECTIONS_PER_IP) {
        // FIX QUA-009: Decrement global counter since we already incremented it
        globalSSEConnections--;
        req.log.warn(
            { ip, connections: currentConnections },
            'SSE connection limit exceeded'
        );
        // QUA-010: Standardized error format with details
        return {
            status: 429,
            body: {
                error: 'Too many concurrent connections',
                details: {
                    limit: MAX_CONNECTIONS_PER_IP,
                    current: currentConnections,
                },
            },
        };
    }

    return null; // Valid - no error
}

/**
 * Sets up SSE-specific response headers
 *
 * @param {Object} res - Express response object
 */
function setupSSEHeaders(res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
}

/**
 * Sends initial SSE connection state and current notification status
 *
 * @param {Object} res - Express response object
 * @param {string} folder - Validated project folder path
 */
function sendInitialSSEState(res, folder) {
    // Send initial connection event
    res.write('event: connected\n');
    res.write(`data: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);

    // Send current notification state immediately
    const currentNotification = notificationStore.get(folder);
    if (currentNotification && currentNotification.unread) {
        res.write('event: notification\n');
        res.write(
            `data: ${JSON.stringify({
                hasNotification: true,
                timestamp: currentNotification.timestamp,
                message: currentNotification.message,
            })}\n\n`
        );
    } else {
        res.write('event: notification\n');
        res.write(`data: ${JSON.stringify({ hasNotification: false })}\n\n`);
    }
}

/**
 * Sets up SSE subscription to notification events for a specific folder
 *
 * @param {string} folder - Project folder path
 * @param {Object} res - Express response object
 * @param {Object} req - Express request object (for logging)
 * @returns {Function} Unsubscribe function to clean up the subscription
 */
function setupSSESubscription(folder, res, req) {
    return notificationStore.subscribe((event) => {
        // Only send events relevant to this folder
        if (event.folder === folder) {
            const payload = {
                hasNotification: event.type === 'created',
                type: event.type,
            };

            if (event.notification) {
                payload.timestamp = event.notification.timestamp;
                payload.message = event.notification.message;
            }

            res.write('event: notification\n');
            res.write(`data: ${JSON.stringify(payload)}\n\n`);

            req.log.debug(
                { folder, event: event.type },
                'SSE notification sent'
            );
        }
    });
}

/**
 * Starts SSE keepalive interval to prevent connection timeouts
 *
 * @param {Object} res - Express response object
 * @returns {NodeJS.Timeout} Interval ID for cleanup
 */
function startSSEKeepalive(res) {
    return setInterval(() => {
        res.write(':keepalive\n\n');
    }, config.sseKeepaliveInterval);
}

/**
 * Initialize notification routes with dependencies
 *
 * @param {Function} requireValidPath - Path validation middleware
 * @param {Function} notificationLimiter - Rate limiter for notification endpoints
 * @returns {Object} Express router with notification routes
 */
function createNotificationRoutes(requireValidPath, notificationLimiter) {
    // Server-Sent Events (SSE) endpoint for real-time notifications with per-IP connection limits
    // FIX QUA-004: Removed duplicate validateFolder+handleValidationErrors, using only requireValidPath
    // FIX REF-003: Refactored complex handler into smaller, focused functions
    router.get(
        '/notifications/stream',
        notificationLimiter,
        requireValidPath,
        async (req, res) => {
            const { validatedPath } = req;
            const clientIP = req.ip || req.connection.remoteAddress;

            // Step 1: Validate SSE connection limits (global and per-IP)
            const limitError = validateSSEConnectionLimits(req, res, clientIP);
            if (limitError) {
                return res.status(limitError.status).json(limitError.body);
            }

            // Get current connections for logging and cleanup
            const currentConnections = sseConnections.get(clientIP) || 0;

            // FIX QUA-014: Declare variables for resources that need cleanup
            let keepaliveInterval = null;
            let unsubscribe = null;

            // FIX QUA-014: Register cleanup handler FIRST, before incrementing counts
            // This ensures cleanup always runs if counts are incremented, preventing connection leaks
            const cleanup = () => {
                if (keepaliveInterval) {
                    clearInterval(keepaliveInterval);
                }
                if (unsubscribe) {
                    unsubscribe();
                }

                // Decrement global connection count with edge case handling
                globalSSEConnections = Math.max(0, globalSSEConnections - 1);

                // Decrement per-IP connection count with proper edge case handling
                const connections = sseConnections.get(clientIP) || 0;
                if (connections <= 1) {
                    sseConnections.delete(clientIP);
                } else {
                    sseConnections.set(clientIP, connections - 1);
                }

                req.log.info(
                    { folder: validatedPath, ip: clientIP, remainingConnections: Math.max(0, connections - 1) },
                    'SSE client disconnected'
                );
            };

            // Register close handler BEFORE incrementing counts
            req.on('close', cleanup);

            // FIX QUA-014: Increment per-IP connection count after cleanup handler is registered
            // Note: globalSSEConnections already incremented earlier for atomic check (QUA-009)
            sseConnections.set(clientIP, currentConnections + 1);

            // Step 2: Set up SSE-specific headers
            setupSSEHeaders(res);

            // Step 3: Send initial connection state and current notification
            sendInitialSSEState(res, validatedPath);

            req.log.info(
                { folder: validatedPath, ip: clientIP, connections: currentConnections + 1 },
                'SSE client connected'
            );

            // Step 4: Set up subscription to notification events
            unsubscribe = setupSSESubscription(validatedPath, res, req);

            // Step 5: Start keepalive interval
            keepaliveInterval = startSSEKeepalive(res);
        }
    );

    // Claude completion notification endpoints with comprehensive validation
    // FIX QUA-004: Removed duplicate validateNotification, using validateNotificationBody + requireValidPath
    router.post(
        '/claude-completion',
        notificationLimiter,
        validateNotificationBody,
        handleValidationErrors,
        requireValidPath,
        async (req, res) => {
            const { message = 'Task completed' } = req.body;
            const { validatedPath } = req;

            notificationStore.setCompleted(validatedPath, message);

            req.log.info({ folder: validatedPath, message }, 'Claude completion notification stored');
            res.json({ status: 'ok', folder: validatedPath, message, state: 'completed' });
        }
    );

    // Claude started working notification (YELLOW badge)
    // FIX QUA-004: Removed duplicate validateNotification, using validateNotificationBody + requireValidPath
    router.post(
        '/claude-started',
        notificationLimiter,
        validateNotificationBody,
        handleValidationErrors,
        requireValidPath,
        async (req, res) => {
            const { message = 'Working...' } = req.body;
            const { validatedPath } = req;

            notificationStore.setWorking(validatedPath, message);

            req.log.info({ folder: validatedPath, message }, 'Claude started notification stored');
            res.json({ status: 'ok', folder: validatedPath, message, state: 'working' });
        }
    );

    // Get ALL unread notifications (for extension floating panel)
    // PERF-006: Optimized to use efficient getUnread() method from notification-store
    router.get('/api/notifications/unread', notificationLimiter, async (req, res) => {
        try {
            // Use efficient getUnread() method - handles filtering, TTL check, and sorting
            const unreadNotifications = notificationStore.getUnread();

            // Add projectName to each notification
            const notifications = unreadNotifications.map(notification => ({
                ...notification,
                projectName: notification.folder.split('/').pop(),
            }));

            res.json({
                notifications,
                count: notifications.length,
            });
        } catch (error) {
            req.log.error({ err: error }, 'Failed to get unread notifications');
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // Get completion status for a project with validation
    // FIX QUA-004: Removed duplicate validateFolder+handleValidationErrors, using only requireValidPath
    router.get(
        '/claude-status',
        notificationLimiter,
        requireValidPath,
        async (req, res) => {
            const { validatedPath } = req;
            const notification = notificationStore.get(validatedPath);

            if (notification && notification.unread) {
                res.json({
                    hasNotification: true,
                    status: notification.status || 'completed', // 'working' or 'completed'
                    timestamp: notification.timestamp,
                    message: notification.message,
                });
            } else {
                res.json({
                    hasNotification: false,
                });
            }
        }
    );

    // Mark notification as read with validation
    // FIX QUA-004: Removed duplicate validateMarkRead+handleValidationErrors, using only requireValidPath
    router.post(
        '/claude-status/mark-read',
        notificationLimiter,
        requireValidPath,
        async (req, res) => {
            const { validatedPath } = req;

            if (notificationStore.markRead(validatedPath)) {
                req.log.info({ folder: validatedPath }, 'Notification marked as read');
            }

            res.json({ status: 'ok' });
        }
    );

    // Clear notification with validation
    // FIX QUA-004: Removed duplicate validateDelete+handleValidationErrors, using only requireValidPath
    router.delete(
        '/claude-status',
        notificationLimiter,
        requireValidPath,
        async (req, res) => {
            const { validatedPath } = req;

            if (notificationStore.remove(validatedPath)) {
                req.log.info({ folder: validatedPath }, 'Notification cleared');
            }
            res.json({ status: 'ok' });
        }
    );

    return router;
}

/**
 * Get SSE connection statistics
 *
 * @returns {Object} SSE connection statistics
 */
function getSSEStats() {
    return {
        totalIPs: sseConnections.size,
        totalConnections: globalSSEConnections,
        maxPerIP: MAX_CONNECTIONS_PER_IP,
        globalLimit: SSE_GLOBAL_LIMIT,
    };
}

module.exports = { createNotificationRoutes, getSSEStats };
