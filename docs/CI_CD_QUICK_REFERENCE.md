# CI/CD Quick Reference

## Pipeline Overview

```
Push to main → Test → Security → Deploy to Production
Push to develop → Test → Security (no deploy)
PR to main → Test → Security (no deploy)
```

## Required Secrets

Configure in Forgejo repository settings:

```bash
DEPLOY_HOST        # Production server IP/hostname
DEPLOY_USER        # SSH username
SSH_PRIVATE_KEY    # Full SSH private key content
DEPLOY_PORT        # Optional, defaults to 22
```

## Pre-Push Checklist

```bash
# Run full quality check
npm run quality

# Equivalent to:
npm run format:check  # Check code formatting
npm run lint          # Check code quality
npm run test:coverage # Run tests with coverage

# Check security
npm audit --audit-level=high
```

## Deployment Flow

1. **Backup** - Automatic backup to `/opt/backups/vscode-favicon/YYYYMMDD_HHMMSS`
2. **Pull** - `git reset --hard origin/main`
3. **Install** - `npm ci --production=false`
4. **Smoke Test** - Unit tests verification
5. **PM2 Reload** - Zero-downtime restart
6. **Health Check** - Verify services responding
7. **Rollback** - Automatic if any step fails

## PM2 Services

```bash
vscode-favicon-service  # Port 8090
vscode-favicon-api      # Port 8091
```

## Health Endpoints

```bash
curl http://localhost:8090/health  # Service
curl http://localhost:8091/health  # API
```

## Manual Rollback

```bash
ssh $DEPLOY_USER@$DEPLOY_HOST
cd /opt/tools/vscode-favicon
ls -lt /opt/backups/vscode-favicon/  # Find backup
BACKUP="/opt/backups/vscode-favicon/20231204_103045"
cd /opt/tools && rm -rf vscode-favicon
cp -r "$BACKUP/vscode-favicon" .
cd vscode-favicon && npm ci
pm2 reload ecosystem.config.js
```

## Coverage Threshold

- **Minimum:** 70% (branches, functions, lines, statements)
- **Check:** `npm run coverage:check`
- **View:** `npm run coverage:open`

## Artifacts (30 days retention)

- **Coverage reports:** `coverage/` directory
- **Test results:** `junit.xml` (JUnit format)

## Common Issues

| Issue | Solution |
|-------|----------|
| Lint fails | `npm run lint:fix` |
| Tests fail | Check Node.js 20, run `npm ci` |
| SSH fails | Verify SSH_PRIVATE_KEY secret |
| Health check fails | Check PM2 logs, verify ports |
| Deployment fails | Check artifacts for detailed logs |

## Local Testing

```bash
# Same commands as CI
npm ci
npm run lint
npm run test:ci
npm run coverage:check
npm audit --audit-level=high
```

## Monitoring Pipeline

1. Go to repository in Forgejo (git.noreika.lt)
2. Click **Actions** tab
3. View workflow runs
4. Download artifacts
5. Check detailed logs

## Pipeline Jobs

| Job | Runs On | Purpose |
|-----|---------|---------|
| `test` | All pushes/PRs | Lint, test, coverage, audit |
| `security` | All pushes/PRs | Security tests, dependency audit |
| `deploy` | Only main pushes | Zero-downtime production deployment |

## Zero-Downtime Details

- Uses `pm2 reload` (not restart)
- Old process stays alive until new one ready
- Automatic rollback on failure
- No service interruption

## Documentation

- **Full docs:** `/opt/tools/vscode-favicon/docs/CI_CD.md`
- **Testing:** `/opt/tools/vscode-favicon/docs/TESTING.md`
- **Security:** `/opt/tools/vscode-favicon/docs/SECURITY.md`
