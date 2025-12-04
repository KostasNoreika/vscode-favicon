# CI/CD Pipeline Documentation

## Overview

Automated CI/CD pipeline using Forgejo Actions for continuous integration, testing, security audits, and deployment to production.

## Workflow File

Location: `.forgejo/workflows/ci.yml`

## Pipeline Triggers

### Push Events
- **main** branch - Triggers full CI/CD pipeline including deployment
- **develop** branch - Triggers CI tests only (no deployment)

### Pull Requests
- PRs to **main** branch - Triggers full test suite and security checks

## Pipeline Jobs

### 1. Test Job (`test`)

**Environment:** Ubuntu Latest with Node.js 20

**Steps:**
1. **Checkout code** - Uses `actions/checkout@v4`
2. **Setup Node.js** - Version 20 with npm cache
3. **Install dependencies** - `npm ci` for reproducible builds
4. **Run ESLint** - Code quality and style checks
5. **Run tests with coverage** - Uses `npm run test:ci` (Jest with CI optimizations)
6. **Check coverage threshold** - Enforces 70% coverage minimum
7. **Security audit** - `npm audit --audit-level=high` (continues on error)
8. **Upload artifacts** - Coverage reports and test results (30 days retention)

**Coverage Threshold:** 70% for branches, functions, lines, statements

### 2. Deploy Job (`deploy`)

**Runs only when:**
- Test job passes successfully
- Push event to `main` branch
- NOT on pull requests

**Environment:** Production server via SSH

**Deployment Steps:**
1. **Backup current version** - Creates timestamped backup in `/opt/backups/vscode-favicon/`
2. **Pull latest changes** - `git reset --hard origin/main`
3. **Install dependencies** - `npm ci --production=false`
4. **Smoke tests** - Runs unit tests to verify deployment
5. **Rollback on failure** - Automatic rollback if tests fail
6. **PM2 reload** - Zero-downtime restart of services
7. **Health checks** - Verifies services are responding
   - Service: http://localhost:8090/health
   - API: http://localhost:8091/health
8. **Deployment notification** - Reports success/failure status

**Zero-Downtime Strategy:**
- Uses `pm2 reload` instead of `pm2 restart`
- PM2 graceful reload keeps old process running until new one is ready
- Automatic rollback if smoke tests fail

### 3. Security Job (`security`)

**Runs in parallel with test job**

**Steps:**
1. **Checkout code**
2. **Setup Node.js 20**
3. **Install dependencies**
4. **Run security tests** - `npm run test:security` (path validator tests)
5. **Audit dependencies** - `npm audit --audit-level=moderate`
6. **Check outdated packages** - `npm outdated` (informational only)

## Required Secrets

Configure these secrets in Forgejo repository settings:

| Secret | Description | Example |
|--------|-------------|---------|
| `DEPLOY_HOST` | Production server hostname/IP | `192.168.1.100` or `prod.example.com` |
| `DEPLOY_USER` | SSH username for deployment | `deployer` or `kostas` |
| `SSH_PRIVATE_KEY` | Private SSH key for authentication | Full SSH private key content |
| `DEPLOY_PORT` | SSH port (optional, defaults to 22) | `22` or custom port |

### Setting Up Secrets

1. Go to repository settings in Forgejo (git.noreika.lt)
2. Navigate to **Secrets** section
3. Add each secret with corresponding value
4. SSH key should be the full content of private key file (e.g., `~/.ssh/id_ed25519_vm_deploy`)

## PM2 Configuration

The deployment uses PM2 ecosystem configuration at `/opt/tools/vscode-favicon/ecosystem.config.js`

**Services managed:**
- `vscode-favicon-service` - Main favicon service (port 8090)
- `vscode-favicon-api` - API service (port 8091)

## Artifacts

### Coverage Reports
- **Name:** `coverage-report`
- **Path:** `coverage/`
- **Retention:** 30 days
- **Format:** LCOV HTML report

### Test Results
- **Name:** `test-results`
- **Path:** `junit.xml`
- **Retention:** 30 days
- **Format:** JUnit XML

## Local Testing

Test CI pipeline locally before pushing:

```bash
# Run full quality check (same as CI)
npm run quality

# Run CI-specific test command
npm run test:ci

# Check coverage threshold
npm run coverage:check

# Run security audit
npm audit --audit-level=high
```

## Rollback Procedures

### Automatic Rollback
If smoke tests fail during deployment, pipeline automatically:
1. Resets git to previous commit
2. Reinstalls previous dependencies
3. Restarts PM2 with previous version
4. Exits with error

### Manual Rollback
If you need to manually rollback:

```bash
# SSH to production server
ssh $DEPLOY_USER@$DEPLOY_HOST

# Navigate to project
cd /opt/tools/vscode-favicon

# Find backup timestamp
ls -lt /opt/backups/vscode-favicon/

# Restore from backup
BACKUP_DIR="/opt/backups/vscode-favicon/20231204_103045"
cd /opt/tools
rm -rf vscode-favicon
cp -r "$BACKUP_DIR/vscode-favicon" .
cd vscode-favicon
npm ci
pm2 reload ecosystem.config.js
```

## Deployment Verification

After successful deployment, verify services:

```bash
# Check PM2 status
pm2 list | grep vscode-favicon

# Test health endpoints
curl http://localhost:8090/health
curl http://localhost:8091/health

# Check logs
pm2 logs vscode-favicon-service --lines 50
pm2 logs vscode-favicon-api --lines 50
```

## Pipeline Status

Monitor pipeline status in Forgejo:
- Repository > Actions tab
- View running/completed workflows
- Download artifacts (coverage reports, test results)
- View detailed logs for each step

## Troubleshooting

### Pipeline Fails at Lint Step
- Run `npm run lint:fix` locally
- Commit fixes and push

### Tests Fail in CI but Pass Locally
- Ensure using Node.js 20
- Run `npm ci` (not `npm install`)
- Check for environment-specific issues
- Review test output in artifacts

### Deployment Fails at Health Check
- Check PM2 logs on server
- Verify services started correctly
- Check ports 8090/8091 not blocked
- Review ecosystem.config.js configuration

### SSH Authentication Fails
- Verify SSH_PRIVATE_KEY secret is correct
- Check DEPLOY_HOST and DEPLOY_USER values
- Test SSH access manually
- Verify SSH key has proper permissions on server

## Best Practices

1. **Test locally first** - Run `npm run quality` before pushing
2. **Small commits** - Easier to identify issues and rollback
3. **Monitor first deployment** - Watch logs during initial setup
4. **Keep dependencies updated** - Review security audit results
5. **Check artifacts** - Review coverage reports regularly
6. **Backup awareness** - Know where backups are stored

## Future Enhancements

Potential improvements to consider:

- [ ] Integration with external monitoring (Sentry, Datadog)
- [ ] Slack/email notifications for deployment status
- [ ] Automated performance testing in pipeline
- [ ] Canary deployments with gradual rollout
- [ ] Database migration steps if needed
- [ ] Multi-environment support (staging, production)
- [ ] Container-based deployment (Docker)
