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
