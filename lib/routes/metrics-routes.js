/**
 * Metrics Routes Module
 * Prometheus metrics exposition endpoint
 *
 * Endpoints:
 * - GET /metrics - Prometheus metrics in exposition format
 */

const express = require('express');
const router = express.Router();
const { register } = require('../metrics');
const logger = require('../logger');
const { sendError, ErrorCodes } = require('../response-helpers');

/**
 * Initialize metrics routes
 *
 * @returns {Object} Express router with metrics routes
 */
function createMetricsRoutes() {
    /**
     * Prometheus metrics endpoint
     * Returns metrics in Prometheus exposition format
     *
     * This endpoint is typically scraped by Prometheus server
     * at regular intervals (e.g., every 15 seconds)
     *
     * Response format: text/plain; version=0.0.4
     */
    router.get('/metrics', async (req, res) => {
        try {
            // Get all metrics in Prometheus format
            const metrics = await register.metrics();

            // Set content type to Prometheus exposition format
            res.setHeader('Content-Type', register.contentType);
            res.send(metrics);
        } catch (error) {
            // Use request logger if available, otherwise use global logger
            const log = req.log || logger;
            log.error({ err: error }, 'Failed to generate metrics');
            sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to generate metrics');
        }
    });

    return router;
}

module.exports = { createMetricsRoutes };
