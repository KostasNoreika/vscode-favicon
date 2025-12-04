# CI/CD Test Scenarios

## Pre-Deployment Testing

### Scenario 1: Verify Pipeline Locally

**Before pushing to main, ensure all CI checks pass locally:**

```bash
# Run full quality check
npm run quality

# Expected output:
# ✓ Prettier check passes
# ✓ ESLint passes
# ✓ Tests pass with 70%+ coverage

# Run security audit
npm audit --audit-level=high

# Expected: No high/critical vulnerabilities
```

**Pass criteria:**
- All linting passes with 0 errors
- All tests pass (336 tests)
- Coverage >= 70% for branches, functions, lines, statements
- No high-severity security vulnerabilities

### Scenario 2: Test Workflow YAML Syntax

```bash
# Validate YAML syntax
python3 -c "import yaml; yaml.safe_load(open('.forgejo/workflows/ci.yml'))"

# Expected: YAML syntax is valid
```

**Pass criteria:**
- No Python YAML parsing errors
- File is valid YAML

## Pipeline Testing

### Scenario 3: Test Job Execution

**Trigger:** Push to `develop` branch

**Expected behavior:**
1. Test job runs
2. Security job runs in parallel
3. Deploy job skipped (not main branch)

**Verification:**
```bash
# After push
git push origin develop

# Check Forgejo Actions
# Navigate to: https://git.noreika.lt/kostas/vscode-favicon/actions
```

**Pass criteria:**
- Test job: success
- Security job: success
- Deploy job: skipped
- Artifacts uploaded: coverage-report, test-results

### Scenario 4: Pull Request Testing

**Trigger:** Create PR from develop to main

**Expected behavior:**
1. Test job runs on PR commit
2. Security job runs
3. Deploy job skipped (PR, not push)

**Verification:**
```bash
# Create PR
git checkout -b feature/test-ci
echo "# Test" >> README.md
git add README.md
git commit -m "Test CI on PR"
git push origin feature/test-ci

# Create PR in Forgejo UI
# Check Actions tab
```

**Pass criteria:**
- All jobs pass before PR can be merged
- Coverage reports available
- No security audit failures

### Scenario 5: Main Branch Deployment

**Trigger:** Push to `main` branch (or merge PR)

**Expected behavior:**
1. Test job runs
2. Security job runs
3. Deploy job executes after test passes
4. SSH deploys to production server
5. PM2 reload with zero downtime

**Verification:**
```bash
# After merge to main
git checkout main
git pull origin main

# Monitor in Forgejo Actions
# Expected timeline:
# [0s] Test job starts
# [0s] Security job starts (parallel)
# [30s] Test job completes
# [35s] Deploy job starts
# [2m] Deploy completes
```

**Pass criteria:**
- Test job: success
- Security job: success
- Deploy job: success
- Services health checks pass
- No downtime observed

## Deployment Testing

### Scenario 6: Zero-Downtime Verification

**Test zero-downtime deployment:**

```bash
# Terminal 1: Monitor requests during deployment
while true; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8090/health)
  echo "$(date +%H:%M:%S) - Status: $STATUS"
  sleep 1
done

# Terminal 2: Trigger deployment
git commit --allow-empty -m "Test zero-downtime deployment"
git push origin main

# Expected: All requests return 200, no 503 errors
```

**Pass criteria:**
- No 503 Service Unavailable errors
- All health checks return 200
- Response time < 100ms throughout

### Scenario 7: Smoke Test Failure & Rollback

**Intentionally break tests to verify rollback:**

```bash
# Create failing test
echo "test('intentional fail', () => { expect(true).toBe(false); });" >> tests/unit/test-rollback.test.js

git add tests/unit/test-rollback.test.js
git commit -m "Test rollback mechanism"
git push origin main

# Expected: Deploy job fails, automatic rollback
```

**Pass criteria:**
- Smoke tests fail
- Deployment aborts
- Git resets to previous commit
- PM2 restarts with previous version
- Services remain operational

**Cleanup:**
```bash
git revert HEAD
git push origin main
```

### Scenario 8: Health Check Failure Detection

**Test health check verification:**

```bash
# SSH to production
ssh $DEPLOY_USER@$DEPLOY_HOST

# Stop one service temporarily
pm2 stop vscode-favicon-api

# Wait for deployment
# Expected: Health check fails, deployment marked as warning

# Restore service
pm2 start vscode-favicon-api
```

**Pass criteria:**
- Deployment detects health check failure
- Warning message appears in logs
- Deployment continues (health check is warning, not failure)

## Secrets Testing

### Scenario 9: SSH Authentication

**Verify SSH secrets are configured correctly:**

```bash
# Test SSH connection manually with same credentials
ssh -i ~/.ssh/id_ed25519_vm_deploy $DEPLOY_USER@$DEPLOY_HOST "echo 'SSH works'"

# Expected: "SSH works" output
```

**Pass criteria:**
- SSH connection succeeds
- No password prompt
- No host key errors

### Scenario 10: Missing Secrets

**Test graceful failure when secrets missing:**

1. Remove one secret (e.g., DEPLOY_HOST) in Forgejo
2. Push to main
3. Expected: Deploy job fails with clear error message

**Pass criteria:**
- Deploy job fails immediately
- Error message mentions missing secret
- Test job still passes (independent)

**Cleanup:** Re-add the secret

## Artifact Testing

### Scenario 11: Coverage Report Access

**Verify coverage artifacts are generated:**

```bash
# After successful pipeline run:
# 1. Go to Forgejo Actions
# 2. Click on completed workflow
# 3. Download "coverage-report" artifact

# Extract and view
unzip coverage-report.zip
open coverage/lcov-report/index.html

# Expected: Coverage report loads in browser
```

**Pass criteria:**
- Artifact is available for download
- Coverage report is complete
- Shows 70%+ coverage

### Scenario 12: Test Results JUnit XML

**Verify test results artifact:**

```bash
# Download "test-results" artifact from Forgejo
# Extract junit.xml

# Validate XML
xmllint junit.xml

# Expected: Valid JUnit XML format
```

**Pass criteria:**
- JUnit XML is valid
- Contains test results
- Shows passed/failed tests

## Monitoring & Alerts

### Scenario 13: Pipeline Failure Notification

**Test notification on failure:**

1. Push commit with failing lint
2. Watch Forgejo Actions
3. Check for failure status

**Expected:**
- Pipeline shows failed status
- Red X icon on commit
- Email notification (if configured)

### Scenario 14: Deployment Success Verification

**Verify successful deployment:**

```bash
# After successful deployment
ssh $DEPLOY_USER@$DEPLOY_HOST

# Check PM2 status
pm2 list | grep vscode-favicon

# Check recent logs
pm2 logs vscode-favicon-service --lines 20 | grep "deployment"

# Verify git commit
cd /opt/tools/vscode-favicon
git log -1 --oneline

# Expected: Latest commit matches pushed commit
```

**Pass criteria:**
- PM2 shows both services running
- Logs show successful deployment
- Git commit hash matches

## Load Testing During Deployment

### Scenario 15: High Load Zero-Downtime

**Test deployment under load:**

```bash
# Terminal 1: Start load test
npm run benchmark:concurrent

# Terminal 2: Trigger deployment
git commit --allow-empty -m "Deploy under load"
git push origin main

# Expected: Benchmark continues, no failures
```

**Pass criteria:**
- Load test completes successfully
- No request failures during deployment
- Response times remain < 100ms
- No 503 errors

## Rollback Testing

### Scenario 16: Manual Rollback

**Test manual rollback procedure:**

```bash
# SSH to production
ssh $DEPLOY_USER@$DEPLOY_HOST

# List backups
ls -lt /opt/backups/vscode-favicon/

# Perform rollback to previous version
BACKUP="/opt/backups/vscode-favicon/20231204_103045"
cd /opt/tools
sudo rm -rf vscode-favicon
sudo cp -r "$BACKUP/vscode-favicon" .
cd vscode-favicon
npm ci
pm2 reload ecosystem.config.js

# Verify services
curl http://localhost:8090/health
curl http://localhost:8091/health
```

**Pass criteria:**
- Rollback completes in < 2 minutes
- Services start successfully
- Health checks pass
- No data loss

## Edge Cases

### Scenario 17: Concurrent Deployments

**Test behavior with multiple pushes:**

```bash
# Push two commits rapidly
git commit --allow-empty -m "Deploy 1"
git push origin main

git commit --allow-empty -m "Deploy 2"
git push origin main

# Expected: Deployments queue, run sequentially
```

**Pass criteria:**
- Both deployments complete
- No conflicts or race conditions
- Final state matches latest commit

### Scenario 18: Network Timeout

**Test SSH timeout handling:**

```bash
# Temporarily block SSH on server (requires server access)
# Or set very low timeout in workflow

# Expected: Deploy job fails with timeout error
# Test and Security jobs still pass
```

**Pass criteria:**
- Timeout is detected
- Deploy job fails gracefully
- Previous version remains operational

## Cleanup

### Scenario 19: Artifact Retention

**Verify 30-day retention:**

```bash
# After 30 days:
# Check Forgejo Actions
# Expected: Old artifacts are removed

# Verify recent artifacts remain
```

**Pass criteria:**
- Artifacts older than 30 days are removed
- Recent artifacts remain accessible
- Storage is managed automatically

## Summary Checklist

Before considering CI/CD pipeline production-ready:

- [ ] All local tests pass (`npm run quality`)
- [ ] YAML syntax validated
- [ ] Push to develop triggers test/security jobs
- [ ] PR triggers pipeline without deploy
- [ ] Push to main triggers full pipeline with deploy
- [ ] Zero-downtime verified (no 503 errors)
- [ ] Rollback works on test failure
- [ ] Health checks verify deployment
- [ ] SSH authentication works
- [ ] Coverage artifacts generated
- [ ] JUnit test results available
- [ ] Pipeline failures are visible
- [ ] Manual rollback procedure works
- [ ] Load testing during deployment passes
- [ ] Concurrent deployments handled correctly

## Troubleshooting Test Failures

### Test Job Fails

```bash
# Run locally to debug
npm run lint
npm run test:ci
npm run coverage:check
```

### Deploy Job Fails

```bash
# Check SSH connection
ssh -i ~/.ssh/key $DEPLOY_USER@$DEPLOY_HOST

# Check secrets in Forgejo
# Verify server has enough disk space
df -h /opt/tools

# Check PM2 status
pm2 status
```

### Artifacts Not Generated

```bash
# Check if coverage directory exists
ls -la coverage/

# Check if tests generated junit.xml
ls -la junit.xml

# Re-run locally
npm run test:ci
```
