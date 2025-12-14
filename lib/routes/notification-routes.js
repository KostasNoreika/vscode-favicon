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
const { sendError, ErrorCodes } = require('../response-helpers');
const SSEConnectionManager = require('../sse-connection-manager');

// REF-011: Use SSEConnectionManager for all SSE lifecycle management
const sseManager = new SSEConnectionManager({
    maxConnectionsPerIP: config.sseMaxConnectionsPerIP,
    globalLimit: config.sseGlobalLimit,
    keepaliveInterval: config.sseKeepaliveInterval,
});

/**
 * Initialize notification routes with dependencies
 *
 * @param {Function} requireValidPath - Path validation middleware
 * @param {Function} notificationLimiter - Rate limiter for notification endpoints
 * @returns {Object} Express router with notification routes
 */
function createNotificationRoutes(requireValidPath, notificationLimiter) {
    // Server-Sent Events (SSE) endpoint for real-time notifications
    // REF-011: Thin orchestration layer using SSEConnectionManager for lifecycle management
    router.get(
        '/notifications/stream',
        notificationLimiter,
        requireValidPath,
        async (req, res) => {
            const { validatedPath } = req;

            // REF-011: Delegate all SSE lifecycle management to SSEConnectionManager
            const error = sseManager.establishConnection(req, res, validatedPath);
            if (error) {
                return sendError(res, error.status, error.code, error.message);
            }
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
            const { message = 'Task completed', metadata = null } = req.body;
            const { validatedPath } = req;

            notificationStore.setCompleted(validatedPath, message, metadata);

            req.log.info({ folder: validatedPath, message, hasMetadata: !!metadata }, 'Claude completion notification stored');
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

            // Add projectName and include metadata for each notification
            const notifications = unreadNotifications.map(notification => {
                const result = {
                    ...notification,
                    projectName: notification.folder.split('/').pop(),
                };
                // Include metadata if available (from full notification object)
                const fullNotification = notificationStore.get(notification.folder);
                if (fullNotification?.metadata) {
                    result.metadata = fullNotification.metadata;
                }
                return result;
            });

            res.json({
                notifications,
                count: notifications.length,
            });
        } catch (error) {
            req.log.error({ err: error }, 'Failed to get unread notifications');
            sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Internal server error');
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
                    ...(notification.metadata && { metadata: notification.metadata }),
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

    // Clear ALL notifications (for "Clear all" button)
    router.delete('/claude-status/all', notificationLimiter, async (req, res) => {
        try {
            const count = notificationStore.removeAll();
            req.log.info({ count }, 'All notifications cleared');
            res.json({ status: 'ok', count });
        } catch (error) {
            req.log.error({ err: error }, 'Failed to clear all notifications');
            sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Internal server error');
        }
    });

    return router;
}

/**
 * Get SSE connection statistics
 * REF-011: Delegates to SSEConnectionManager
 *
 * @returns {Object} SSE connection statistics
 */
function getSSEStats() {
    return sseManager.getStats();
}

module.exports = { createNotificationRoutes, getSSEStats };
