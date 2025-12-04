const express = require('express');
const compression = require('compression');
const { corsMiddleware } = require('./cors-config');
const { requestLogger } = require('./logger');

const COMPRESSION_CONFIG = {
    level: 6,
    threshold: 1024,
    filter: (req, res) => {
        if (req.headers['x-no-compression']) {
            return false;
        }
        return compression.filter(req, res);
    },
};

function createServer(serviceName) {
    const app = express();

    app.use(requestLogger(serviceName));
    app.use(compression(COMPRESSION_CONFIG));
    app.use(express.json({ limit: '10kb' }));
    app.use(corsMiddleware);

    return app;
}

module.exports = {
    createServer,
    COMPRESSION_CONFIG,
};
