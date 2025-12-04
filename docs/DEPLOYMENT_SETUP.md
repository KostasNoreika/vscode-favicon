# Deployment Setup Guide

## Prerequisites

1. **Forgejo Repository** - Project must be hosted on git.noreika.lt
2. **Production Server** - SSH access to deployment target
3. **SSH Key** - Dedicated deployment key configured
4. **PM2** - Installed on production server
5. **Node.js 20** - Installed on production server

## Step 1: Generate SSH Deployment Key

If you don't have a dedicated deployment key:

```bash
# Generate new SSH key
ssh-keygen -t ed25519 -C "deploy@vscode-favicon" -f ~/.ssh/id_ed25519_vscode_favicon_deploy

# Copy public key to production server
ssh-copy-id -i ~/.ssh/id_ed25519_vscode_favicon_deploy.pub $DEPLOY_USER@$DEPLOY_HOST

# Test SSH connection
ssh -i ~/.ssh/id_ed25519_vscode_favicon_deploy $DEPLOY_USER@$DEPLOY_HOST
```

## Step 2: Configure Forgejo Secrets

1. Open repository in browser: https://git.noreika.lt/kostas/vscode-favicon
2. Navigate to **Settings** > **Secrets**
3. Add the following secrets:

### DEPLOY_HOST
```
Value: IP address or hostname of production server
Example: 192.168.1.100 or prod-vm.noreika.lt
```

### DEPLOY_USER
```
Value: SSH username for deployment
Example: kostas or deployer
```

### SSH_PRIVATE_KEY
```
Value: Full content of SSH private key file
Get it with: cat ~/.ssh/id_ed25519_vscode_favicon_deploy
```

**Important:** Copy the ENTIRE key including:
```
-----BEGIN OPENSSH PRIVATE KEY-----
[key content]
-----END OPENSSH PRIVATE KEY-----
```

### DEPLOY_PORT (Optional)
```
Value: SSH port number
Default: 22
Only add if using non-standard SSH port
```

## Step 3: Prepare Production Server

### Create Project Directory

```bash
ssh $DEPLOY_USER@$DEPLOY_HOST

# Create project directory
sudo mkdir -p /opt/tools/vscode-favicon
sudo chown $USER:$USER /opt/tools/vscode-favicon

# Create backup directory
sudo mkdir -p /opt/backups/vscode-favicon
sudo chown $USER:$USER /opt/backups/vscode-favicon
```

### Clone Repository

```bash
cd /opt/tools
git clone https://git.noreika.lt/kostas/vscode-favicon.git
cd vscode-favicon
```

### Install Dependencies

```bash
npm ci --production=false
```

### Configure Environment

```bash
# Copy example env file
cp .env.example .env

# Edit environment variables
nano .env
```

**Required environment variables:**
```bash
NODE_ENV=production
PORT=8090
API_PORT=8091
LOG_LEVEL=info
CACHE_MAX_SIZE=1000
CACHE_TTL=3600000
```

### Initial PM2 Start

```bash
# Start services
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup PM2 startup script (run as root)
sudo pm2 startup
```

### Verify Services

```bash
# Check PM2 status
pm2 list

# Test health endpoints
curl http://localhost:8090/health
curl http://localhost:8091/health

# Check logs
pm2 logs vscode-favicon-service --lines 20
pm2 logs vscode-favicon-api --lines 20
```

## Step 4: Test Deployment Pipeline

### Push to Main Branch

```bash
# On local machine
git add .
git commit -m "Test deployment pipeline"
git push origin main
```

### Monitor Pipeline

1. Go to https://git.noreika.lt/kostas/vscode-favicon
2. Click **Actions** tab
3. Watch the pipeline execution
4. Check logs for each step

### Verify Deployment

```bash
# SSH to production server
ssh $DEPLOY_USER@$DEPLOY_HOST

# Check PM2 status
pm2 list | grep vscode-favicon

# Check logs for deployment
pm2 logs vscode-favicon-service --lines 50

# Test services
curl http://localhost:8090/health
curl http://localhost:8091/health
```

## Step 5: Setup Automatic Backups (Optional)

Create automated backup script:

```bash
# Create backup script
sudo nano /opt/scripts/backup-vscode-favicon.sh
```

**Script content:**
```bash
#!/bin/bash
set -e

BACKUP_DIR="/opt/backups/vscode-favicon"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
PROJECT_DIR="/opt/tools/vscode-favicon"

# Create backup
mkdir -p "$BACKUP_DIR"
tar -czf "$BACKUP_DIR/vscode-favicon-$TIMESTAMP.tar.gz" \
    -C /opt/tools \
    --exclude='node_modules' \
    --exclude='.git' \
    vscode-favicon

# Keep only last 7 backups
cd "$BACKUP_DIR"
ls -t | tail -n +8 | xargs -r rm

echo "Backup created: vscode-favicon-$TIMESTAMP.tar.gz"
```

**Make executable and schedule:**
```bash
sudo chmod +x /opt/scripts/backup-vscode-favicon.sh

# Add to crontab (daily at 2 AM)
crontab -e
0 2 * * * /opt/scripts/backup-vscode-favicon.sh >> /var/log/vscode-favicon-backup.log 2>&1
```

## Troubleshooting

### SSH Authentication Fails

**Error:** `Host key verification failed` or `Permission denied`

**Solutions:**
1. Verify SSH_PRIVATE_KEY secret contains full key with headers/footers
2. Test SSH manually: `ssh -i ~/.ssh/key $DEPLOY_USER@$DEPLOY_HOST`
3. Check SSH key permissions on server: `chmod 600 ~/.ssh/authorized_keys`
4. Verify SSH key is added to authorized_keys on server

### PM2 Not Found

**Error:** `pm2: command not found`

**Solution:**
```bash
# Install PM2 globally
npm install -g pm2

# Verify installation
pm2 --version
```

### Health Check Fails

**Error:** `curl: (7) Failed to connect to localhost port 8090`

**Solutions:**
1. Check if service is running: `pm2 list`
2. Check logs: `pm2 logs vscode-favicon-service`
3. Verify port not blocked: `netstat -tlnp | grep 8090`
4. Check .env configuration
5. Restart services: `pm2 restart all`

### Deployment Rollback Triggered

**Error:** Tests fail during deployment

**Investigation:**
1. Check pipeline logs in Forgejo Actions
2. SSH to server and check PM2 logs
3. Verify all dependencies installed
4. Check environment variables in .env
5. Run tests manually: `npm test`

### Permission Denied on Backup Directory

**Error:** `mkdir: cannot create directory '/opt/backups'`

**Solution:**
```bash
# Create backup directory with proper permissions
sudo mkdir -p /opt/backups/vscode-favicon
sudo chown $DEPLOY_USER:$DEPLOY_USER /opt/backups/vscode-favicon
```

## Security Considerations

### SSH Key Security
- Use dedicated deployment key (not personal SSH key)
- Limit key permissions: `chmod 600 ~/.ssh/id_ed25519_vscode_favicon_deploy`
- Never commit private key to repository
- Rotate keys periodically

### Server Hardening
```bash
# Disable password authentication (SSH key only)
sudo nano /etc/ssh/sshd_config
# Set: PasswordAuthentication no
sudo systemctl restart sshd

# Setup firewall
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 8090/tcp  # Service (if external access needed)
sudo ufw allow 8091/tcp  # API (if external access needed)
sudo ufw enable
```

### Application Security
- Run services as non-root user
- Keep dependencies updated: `npm audit fix`
- Monitor logs for suspicious activity
- Limit file permissions: `chmod 755 /opt/tools/vscode-favicon`

## Maintenance

### Update Dependencies

```bash
# Check for updates
npm outdated

# Update and test locally first
npm update
npm test

# Commit and push (triggers automatic deployment)
git add package.json package-lock.json
git commit -m "Update dependencies"
git push origin main
```

### View Deployment History

```bash
# On production server
ls -lt /opt/backups/vscode-favicon/

# View recent deployments
pm2 logs vscode-favicon-service | grep "deployment"

# Check git history
cd /opt/tools/vscode-favicon
git log --oneline -10
```

### Manual Deployment (Emergency)

If CI/CD is unavailable:

```bash
# SSH to production server
ssh $DEPLOY_USER@$DEPLOY_HOST
cd /opt/tools/vscode-favicon

# Backup current version
BACKUP="/opt/backups/vscode-favicon/manual-$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP"
cp -r /opt/tools/vscode-favicon "$BACKUP/"

# Pull and deploy
git pull origin main
npm ci --production=false
npm test
pm2 reload ecosystem.config.js
```

## Monitoring and Alerts

### PM2 Monitoring

```bash
# Install PM2 monitoring (optional)
pm2 install pm2-logrotate

# Configure log rotation
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

### Health Check Cron

```bash
# Create health check script
nano /opt/scripts/health-check-vscode-favicon.sh
```

**Script:**
```bash
#!/bin/bash
if ! curl -sf http://localhost:8090/health > /dev/null; then
    echo "Service health check failed - restarting"
    pm2 restart vscode-favicon-service
fi

if ! curl -sf http://localhost:8091/health > /dev/null; then
    echo "API health check failed - restarting"
    pm2 restart vscode-favicon-api
fi
```

**Schedule:**
```bash
chmod +x /opt/scripts/health-check-vscode-favicon.sh
crontab -e
*/5 * * * * /opt/scripts/health-check-vscode-favicon.sh >> /var/log/health-check.log 2>&1
```

## Next Steps

1. **Monitoring** - Setup external monitoring (Uptime Robot, Pingdom)
2. **Logging** - Centralized logging solution (ELK, Loki)
3. **Alerts** - Configure email/Slack alerts for failures
4. **Staging** - Create staging environment for testing
5. **Load Balancing** - If scaling needed, setup nginx reverse proxy

## Documentation

- **CI/CD Overview:** `/opt/tools/vscode-favicon/docs/CI_CD.md`
- **Quick Reference:** `/opt/tools/vscode-favicon/docs/CI_CD_QUICK_REFERENCE.md`
- **Main README:** `/opt/tools/vscode-favicon/README.md`
- **Deployment Guide:** `/opt/tools/vscode-favicon/DEPLOYMENT.md`
