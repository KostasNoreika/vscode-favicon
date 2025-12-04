const pino = require('pino');
const config = require('./config');

/**
 * Centralized structured logger using Pino
 *
 * Features:
 * - JSON format in production for log aggregation
 * - Pretty format in development for readability
 * - Request-level child loggers with request ID
 * - Configurable log levels (error, warn, info, debug)
 * - Automatic service identification
 *
 * Usage:
 *   const logger = require('./lib/logger');
 *   logger.info({ port: 8090 }, 'Server started');
 *   logger.error({ err: error }, 'Operation failed');
 *   req.log.info({ duration: 123 }, 'Request completed');
 */

const logger = pino({
    level: config.logLevel || 'info',
    // Pretty printing only in development
    transport:
        config.nodeEnv === 'development'
            ? {
                  target: 'pino-pretty',
                  options: {
                      colorize: true,
                      translateTime: 'SYS:standard',
                      ignore: 'pid,hostname',
                      messageFormat: '{msg} {if req}[{req.method} {req.url}]{end}',
                      errorLikeObjectKeys: ['err', 'error'],
                  },
              }
            : undefined,
    formatters: {
        level: (label) => ({ level: label }),
    },
    base: {
        service: 'vscode-favicon',
    },
    // Serialize errors properly
    serializers: {
        err: pino.stdSerializers.err,
        error: pino.stdSerializers.err,
        req: pino.stdSerializers.req,
        res: pino.stdSerializers.res,
    },
});

/**
 * Create request logging middleware
 * Attaches a child logger with request ID to each request
 * and logs request completion with timing
 *
 * @param {string} serviceName - Name of the service (api/service)
 * @returns {Function} Express middleware
 */
function requestLogger(serviceName = 'api') {
    const crypto = require('crypto');

    return (req, res, next) => {
        // Generate unique request ID (first 8 chars of UUID)
        req.id = crypto.randomUUID().slice(0, 8);
        req.startTime = Date.now();

        // Create child logger with request context
        req.log = logger.child({
            requestId: req.id,
            service: serviceName,
        });

        // Log request completion
        res.on('finish', () => {
            const duration = Date.now() - req.startTime;
            const logLevel =
                res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

            req.log[logLevel](
                {
                    method: req.method,
                    url: req.url,
                    status: res.statusCode,
                    duration: `${duration}ms`,
                    ip: req.ip || req.connection?.remoteAddress,
                    userAgent: req.get('user-agent'),
                },
                'Request completed'
            );
        });

        next();
    };
}

module.exports = logger;
module.exports.requestLogger = requestLogger;
