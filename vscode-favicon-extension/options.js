// Options page script for VS Code Favicon Extension

const DEFAULT_API_URL = 'https://favicon-api.noreika.lt';

// DOM elements
const form = document.getElementById('settingsForm');
const apiUrlInput = document.getElementById('apiUrl');
const urlHint = document.getElementById('urlHint');
const saveBtn = document.getElementById('saveBtn');
const resetBtn = document.getElementById('resetBtn');
const testBtn = document.getElementById('testBtn');
const statusDiv = document.getElementById('status');

// Load current settings
async function loadSettings() {
    try {
        const response = await chrome.runtime.sendMessage({ type: 'GET_API_BASE_URL' });
        if (response && response.apiBaseUrl) {
            apiUrlInput.value = response.apiBaseUrl;
        } else {
            apiUrlInput.value = DEFAULT_API_URL;
        }
    } catch (error) {
        console.error('Failed to load settings:', error);
        showStatus('Failed to load settings: ' + error.message, 'error');
    }
}

// Show status message
function showStatus(message, type = 'success') {
    statusDiv.textContent = message;
    statusDiv.className = 'status show ' + type;

    // Auto-hide after 5 seconds for success messages
    if (type === 'success') {
        setTimeout(() => {
            statusDiv.className = 'status';
        }, 5000);
    }
}

// Use validateApiUrl from storage-manager.js
const validateUrl = window.StorageManager.validateApiUrl;

// Update URL hint based on validation
function updateUrlHint() {
    const url = apiUrlInput.value.trim();

    if (!url) {
        urlHint.textContent = 'HTTPS required (or http://localhost for development)';
        urlHint.className = 'hint';
        apiUrlInput.className = '';
        return;
    }

    const validation = validateUrl(url);

    if (validation.valid) {
        urlHint.textContent = 'Valid URL';
        urlHint.className = 'hint success';
        apiUrlInput.className = '';
    } else {
        urlHint.textContent = validation.error;
        urlHint.className = 'hint error';
        apiUrlInput.className = 'error';
    }
}

// Save settings
async function saveSettings(event) {
    event.preventDefault();

    const url = apiUrlInput.value.trim();
    const validation = validateUrl(url);

    if (!validation.valid) {
        showStatus(validation.error, 'error');
        apiUrlInput.className = 'error';
        return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
        const response = await chrome.runtime.sendMessage({
            type: 'SET_API_BASE_URL',
            url: validation.url
        });

        if (response && response.success) {
            showStatus('Settings saved successfully! API URL: ' + response.apiBaseUrl, 'success');
            apiUrlInput.className = '';
        } else {
            throw new Error(response.error || 'Failed to save settings');
        }
    } catch (error) {
        console.error('Save error:', error);
        showStatus('Failed to save: ' + error.message, 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Settings';
    }
}

// Reset to default
async function resetToDefault() {
    if (!confirm('Reset API URL to default? This will set it to: ' + DEFAULT_API_URL)) {
        return;
    }

    apiUrlInput.value = DEFAULT_API_URL;
    updateUrlHint();

    try {
        const response = await chrome.runtime.sendMessage({
            type: 'SET_API_BASE_URL',
            url: DEFAULT_API_URL
        });

        if (response && response.success) {
            showStatus('Reset to default URL successfully', 'success');
        } else {
            throw new Error(response.error || 'Failed to reset');
        }
    } catch (error) {
        console.error('Reset error:', error);
        showStatus('Failed to reset: ' + error.message, 'error');
    }
}

// Test API connection
async function testConnection() {
    const url = apiUrlInput.value.trim();
    const validation = validateUrl(url);

    if (!validation.valid) {
        showStatus('Cannot test: ' + validation.error, 'error');
        return;
    }

    testBtn.disabled = true;
    testBtn.textContent = 'Testing...';

    try {
        const testUrl = `${validation.url}/health`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

        const response = await fetch(testUrl, {
            method: 'GET',
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
            const data = await response.json();
            showStatus(
                `Connection successful! Server status: ${data.status || 'healthy'}`,
                'success'
            );
        } else {
            showStatus(
                `Server responded with error: ${response.status} ${response.statusText}`,
                'error'
            );
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            showStatus('Connection timeout - server did not respond within 10 seconds', 'error');
        } else {
            showStatus('Connection failed: ' + error.message, 'error');
        }
    } finally {
        testBtn.disabled = false;
        testBtn.textContent = 'Test Connection';
    }
}

// Event listeners
form.addEventListener('submit', saveSettings);
resetBtn.addEventListener('click', resetToDefault);
testBtn.addEventListener('click', testConnection);
apiUrlInput.addEventListener('input', updateUrlHint);
apiUrlInput.addEventListener('blur', updateUrlHint);

// Load settings on page load
loadSettings();

// ============================================================================
// Domain Management
// ============================================================================

const domainListEl = document.getElementById('domainList');
const newDomainInput = document.getElementById('newDomain');
const addDomainBtn = document.getElementById('addDomainBtn');
const autoDetectCheckbox = document.getElementById('autoDetect');
const domainStatusDiv = document.getElementById('domainStatus');

// Show domain status message
function showDomainStatus(message, type = 'success') {
    domainStatusDiv.textContent = message;
    domainStatusDiv.className = 'status show ' + type;

    // Auto-hide after 5 seconds for success messages
    if (type === 'success') {
        setTimeout(() => {
            domainStatusDiv.className = 'status';
        }, 5000);
    }
}

// Load domains from background
async function loadDomains() {
    try {
        const response = await chrome.runtime.sendMessage({ type: 'GET_VSCODE_DOMAINS' });
        const domains = response?.domains || [];
        renderDomainList(domains);
    } catch (error) {
        console.error('Failed to load domains:', error);
        showDomainStatus('Failed to load domains: ' + error.message, 'error');
    }
}

// Render domain list
function renderDomainList(domains) {
    domainListEl.innerHTML = '';

    if (domains.length === 0) {
        // The CSS ::before pseudo-element will show "No domains configured"
        return;
    }

    domains.forEach(domain => {
        const li = document.createElement('li');

        const domainSpan = document.createElement('span');
        domainSpan.className = 'domain-name';
        domainSpan.textContent = domain;

        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-btn';
        removeBtn.textContent = 'Remove';
        removeBtn.dataset.domain = domain;

        li.appendChild(domainSpan);
        li.appendChild(removeBtn);
        domainListEl.appendChild(li);
    });
}

// Add domain
async function addDomain() {
    const domain = newDomainInput.value.trim();

    if (!domain) {
        showDomainStatus('Please enter a domain', 'error');
        return;
    }

    // Validate URL format
    try {
        const url = new URL(domain);
        // Ensure it's a valid origin (protocol + hostname + optional port)
        if (!url.protocol || !url.hostname) {
            throw new Error('Invalid URL');
        }
    } catch (error) {
        showDomainStatus('Invalid URL format. Example: https://code.example.com', 'error');
        return;
    }

    addDomainBtn.disabled = true;
    addDomainBtn.textContent = 'Adding...';

    try {
        // Request permission first
        const permResult = await chrome.runtime.sendMessage({
            type: 'REQUEST_DOMAIN_PERMISSION',
            origin: domain
        });

        if (!permResult?.granted) {
            showDomainStatus('Permission denied. Cannot add domain.', 'error');
            return;
        }

        // Add to whitelist
        const addResult = await chrome.runtime.sendMessage({
            type: 'ADD_VSCODE_DOMAIN',
            domain: domain
        });

        if (addResult?.success) {
            showDomainStatus('Domain added successfully', 'success');
            newDomainInput.value = '';
            loadDomains();
        } else {
            throw new Error(addResult?.error || 'Failed to add domain');
        }
    } catch (error) {
        console.error('Add domain error:', error);
        showDomainStatus('Failed to add domain: ' + error.message, 'error');
    } finally {
        addDomainBtn.disabled = false;
        addDomainBtn.textContent = 'Add Domain';
    }
}

// Remove domain
async function removeDomain(domain) {
    if (!confirm(`Remove domain: ${domain}?`)) {
        return;
    }

    try {
        const response = await chrome.runtime.sendMessage({
            type: 'REMOVE_VSCODE_DOMAIN',
            domain: domain
        });

        if (response?.success) {
            showDomainStatus('Domain removed successfully', 'success');
            loadDomains();
        } else {
            throw new Error(response?.error || 'Failed to remove domain');
        }
    } catch (error) {
        console.error('Remove domain error:', error);
        showDomainStatus('Failed to remove domain: ' + error.message, 'error');
    }
}

// Load auto-detect setting
async function loadAutoDetectSetting() {
    try {
        const response = await chrome.runtime.sendMessage({ type: 'GET_AUTO_DETECT_SETTING' });
        const enabled = response?.enabled ?? true;
        autoDetectCheckbox.checked = enabled;
    } catch (error) {
        console.error('Failed to load auto-detect setting:', error);
        // Default to checked if error
        autoDetectCheckbox.checked = true;
    }
}

// Save auto-detect setting
async function saveAutoDetectSetting(enabled) {
    try {
        const response = await chrome.runtime.sendMessage({
            type: 'SET_AUTO_DETECT_SETTING',
            enabled: enabled
        });

        if (response?.success) {
            showDomainStatus(`Auto-detect ${enabled ? 'enabled' : 'disabled'}`, 'success');
        } else {
            throw new Error(response?.error || 'Failed to save setting');
        }
    } catch (error) {
        console.error('Save auto-detect error:', error);
        showDomainStatus('Failed to save auto-detect setting: ' + error.message, 'error');
    }
}

// Event listeners for domain management
autoDetectCheckbox.addEventListener('change', (e) => {
    saveAutoDetectSetting(e.target.checked);
});

addDomainBtn.addEventListener('click', addDomain);

// Handle Enter key in domain input
newDomainInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        addDomain();
    }
});

// Remove domain delegation
domainListEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('remove-btn')) {
        removeDomain(e.target.dataset.domain);
    }
});

// Load domain settings on page load
loadDomains();
loadAutoDetectSetting();

// ============================================================================
// Upload Settings (CENT-001)
// ============================================================================

const ttlSlider = document.getElementById('ttlSlider');
const ttlValueEl = document.getElementById('ttlValue');
const installationIdEl = document.getElementById('installationId');
const uploadStatusDiv = document.getElementById('uploadStatus');

// Show upload status message
function showUploadStatus(message, type = 'success') {
    uploadStatusDiv.textContent = message;
    uploadStatusDiv.className = 'status show ' + type;

    // Auto-hide after 5 seconds for success messages
    if (type === 'success') {
        setTimeout(() => {
            uploadStatusDiv.className = 'status';
        }, 5000);
    }
}

// Load upload settings
async function loadUploadSettings() {
    try {
        // Load TTL
        const ttl = await window.StorageManager.getUploadTtl();
        ttlSlider.value = ttl;
        ttlValueEl.textContent = ttl;

        // Load installation ID
        const installationId = await window.StorageManager.getOrCreateInstallationId();
        installationIdEl.textContent = installationId;
    } catch (error) {
        console.error('Failed to load upload settings:', error);
        showUploadStatus('Failed to load upload settings: ' + error.message, 'error');
    }
}

// Save TTL setting
async function saveTtlSetting(days) {
    try {
        await window.StorageManager.setUploadTtl(days);
        showUploadStatus(`File retention set to ${days} days`, 'success');
    } catch (error) {
        console.error('Save TTL error:', error);
        showUploadStatus('Failed to save retention setting: ' + error.message, 'error');
    }
}

// Event listeners for upload settings
ttlSlider.addEventListener('input', (e) => {
    // Update display immediately
    ttlValueEl.textContent = e.target.value;
});

ttlSlider.addEventListener('change', (e) => {
    // Save when user releases slider
    saveTtlSetting(parseInt(e.target.value, 10));
});

// Load upload settings on page load
loadUploadSettings();

// ============================================================================
// Claude Code Integration
// ============================================================================

const copySetupBtn = document.getElementById('copySetupBtn');
const setupCommandEl = document.getElementById('setupCommand');
const claudeStatusDiv = document.getElementById('claudeStatus');

const SETUP_COMMAND = 'curl -fsSL https://git.noreika.lt/kostas/vscode-favicon/raw/branch/main/scripts/setup-claude-hooks.sh | bash';

// Show Claude status message
function showClaudeStatus(message, type = 'success') {
    claudeStatusDiv.textContent = message;
    claudeStatusDiv.className = 'status show ' + type;

    // Auto-hide after 3 seconds for success messages
    if (type === 'success') {
        setTimeout(() => {
            claudeStatusDiv.className = 'status';
        }, 3000);
    }
}

// Copy setup command to clipboard
async function copySetupCommand() {
    try {
        await navigator.clipboard.writeText(SETUP_COMMAND);
        showClaudeStatus('Copied to clipboard!', 'success');

        // Visual feedback
        copySetupBtn.textContent = 'Copied!';
        setTimeout(() => {
            copySetupBtn.textContent = 'Copy Setup Command';
        }, 2000);
    } catch (error) {
        console.error('Copy failed:', error);
        showClaudeStatus('Copy failed. Please select and copy manually.', 'error');
    }
}

// Event listeners for Claude Code Integration
copySetupBtn.addEventListener('click', copySetupCommand);

// Also copy when clicking on the command text
setupCommandEl.addEventListener('click', copySetupCommand);
