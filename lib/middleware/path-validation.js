const { validatePath } = require('../path-validator');
const config = require('../config');

function createPathValidationMiddleware(paramName = 'folder', source = 'query') {
    return (req, res, next) => {
        const folder = source === 'query' ? req.query[paramName] : req.body[paramName];

        if (!folder) {
            return res.status(400).json({ error: `${paramName} parameter required` });
        }

        const validation = validatePath(folder);
        if (!validation.valid) {
            req.log.error(
                {
                    input: folder,
                    sanitized: validation.sanitized,
                    resolved: validation.resolved,
                    error: validation.error,
                },
                'Path validation failed'
            );

            // Production: don't expose details
            if (config.nodeEnv === 'production') {
                return res.status(403).json({ error: 'Access denied' });
            }

            return res.status(403).json({
                error: 'Access denied: path outside allowed directories',
                details: validation.error,
            });
        }

        req.validatedPath = validation.resolved;
        next();
    };
}

module.exports = { createPathValidationMiddleware };
