module.exports = {
    apps: [
        {
            name: 'vscode-favicon-vm',
            script: './src/server.js',
            instances: 1,
            exec_mode: 'fork',
            autorestart: true,
            watch: false,
            max_memory_restart: '500M',
            env: {
                NODE_ENV: 'production',
                PORT: 8024,
                SERVICE_PORT: 8024,
            },
            error_file: '~/.pm2/logs/vscode-favicon-vm-error.log',
            out_file: '~/.pm2/logs/vscode-favicon-vm-out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            merge_logs: true,
        },
    ],
};
