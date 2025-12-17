module.exports = {
    apps: [
        {
            name: 'vscode-favicon-unified',
            script: './src/server.js',
            cwd: '/opt/tools/vscode-favicon',
            instances: 1,
            exec_mode: 'fork',
            autorestart: true,
            watch: false,
            max_memory_restart: '500M',
            kill_timeout: 5000,
            listen_timeout: 10000,
            max_restarts: 10,
            min_uptime: 5000,
            restart_delay: 4000,
            env: {
                NODE_ENV: 'production',
                PORT: 8090,
            },
            error_file: '~/.pm2/logs/vscode-favicon-unified-error.log',
            out_file: '~/.pm2/logs/vscode-favicon-unified-out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            merge_logs: true,
        },
    ],
};
