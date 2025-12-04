module.exports = {
    env: {
        node: true,
        es2022: true,
        jest: true,
    },
    extends: [
        'eslint:recommended',
        'plugin:node/recommended',
        'plugin:security/recommended-legacy',
        'prettier',
    ],
    parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
    },
    rules: {
        'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
        'no-console': 'off', // Allow console for server logs
        'node/no-unsupported-features/es-syntax': 'off',
        'node/no-unsupported-features/node-builtins': [
            'error',
            {
                version: '>=18.0.0', // Modern Node.js version
                ignores: [],
            },
        ],
        'node/no-missing-require': 'error',
        'node/no-unpublished-require': 'off', // Allow devDependencies in tests
        'node/shebang': 'off', // Allow scripts without shebang
        'security/detect-object-injection': 'warn', // Often false positives
        'security/detect-non-literal-fs-filename': 'off', // Too many false positives with validated paths
        'security/detect-non-literal-regexp': 'warn',
        'no-eval': 'error',
        'no-implied-eval': 'error',
        'no-new-func': 'error',
        'no-process-exit': 'warn', // Warn but allow in scripts
        'no-useless-escape': 'error',
    },
    overrides: [
        {
            // Relax rules for test files
            files: ['tests/**/*.js', '**/*.test.js', '**/*.spec.js'],
            rules: {
                'no-unused-vars': [
                    'error',
                    {
                        argsIgnorePattern: '^_',
                        varsIgnorePattern: '^_',
                    },
                ],
                'no-process-exit': 'off',
                'node/no-unpublished-require': 'off',
            },
        },
        {
            // Allow process.exit in scripts
            files: ['**/*benchmark*.js', 'tests/test-*.js'],
            rules: {
                'no-process-exit': 'off',
            },
        },
        {
            // Server files - express is in devDependencies for testing
            files: ['**/server.js', 'lib/server-factory.js'],
            rules: {
                'node/no-extraneous-require': 'off',
                'node/no-unpublished-require': 'off',
            },
        },
    ],
};
