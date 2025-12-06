const { validatePathAsync } = require('./path-validator');
const config = require('./config');

class ValidationError extends Error {
    constructor(message, statusCode = 403) {
        super(message);
        this.statusCode = statusCode;
        this.name = 'ValidationError';
    }
}

async function validateAndExtractPath(req) {
    const folder = req.query.folder || req.body.folder;

    if (!folder) {
        throw new ValidationError('Folder parameter required', 400);
    }

    const validation = await validatePathAsync(folder);

    if (!validation.valid) {
        req.log.error({
            input: folder,
            sanitized: validation.sanitized,
            resolved: validation.resolved,
            error: validation.error,
        }, 'Path validation failed');

        const message = config.nodeEnv === 'production'
            ? 'Access denied: path outside allowed directories'
            : `Access denied: ${validation.error}`;

        throw new ValidationError(message, 403);
    }

    return validation.resolved;
}

module.exports = { validateAndExtractPath, ValidationError };
