/**
 * SVG Content Sanitizer
 *
 * Protects against XSS vulnerabilities in dynamically generated SVG favicons
 *
 * OWASP Reference:
 * - A03:2021 Injection
 * - CWE-79: Cross-site Scripting (XSS)
 *
 * CVSS 8.8 vulnerability fix
 */

const logger = require('./logger');

/**
 * Sanitize text for safe embedding in SVG
 * Escapes all HTML/XML special characters to prevent XSS
 *
 * @param {string} text - User-provided text to sanitize
 * @returns {string} - Sanitized text safe for SVG embedding
 */
function sanitizeForSVG(text) {
    if (!text || typeof text !== 'string') {
        return '';
    }

    // XML/HTML entity encoding to prevent XSS
    return text
        .replace(/&/g, '&amp;') // Must be first to avoid double-encoding
        .replace(/</g, '&lt;') // Prevent tag injection
        .replace(/>/g, '&gt;') // Prevent tag injection
        .replace(/"/g, '&quot;') // Prevent attribute injection
        .replace(/'/g, '&#x27;') // Prevent attribute injection
        .replace(/\//g, '&#x2F;'); // Prevent protocol injection
}

/**
 * Validate and sanitize project name
 * Allows only safe characters: alphanumeric, hyphen, underscore, space
 *
 * @param {string} projectName - User-provided project name
 * @returns {string} - Cleaned project name
 */
function validateProjectName(projectName) {
    if (!projectName || typeof projectName !== 'string') {
        return '';
    }

    // Remove all characters except alphanumeric, -, _, space
    // This provides defense-in-depth against XSS even before entity encoding
    const cleaned = projectName.replace(/[^a-zA-Z0-9\-_\s]/g, '');

    // Limit length to prevent DoS via extremely long names
    return cleaned.slice(0, 100);
}

/**
 * Generate safe initials from project name
 * Combines validation and sanitization for defense-in-depth
 *
 * @param {string} projectName - User-provided project name
 * @returns {string} - Sanitized initials (max 2 characters)
 */
function getCleanInitials(projectName) {
    // Step 1: Validate and clean the input
    const cleaned = validateProjectName(projectName);

    if (!cleaned) {
        return sanitizeForSVG('VS'); // Safe default
    }

    // Step 2: Extract initials from cleaned input
    const initials =
        cleaned
            .split(/[-_\s]+/) // Split on delimiters
            .map((word) => word[0]) // Take first character
            .filter(Boolean) // Remove empty values
            .join('') // Combine initials
            .toUpperCase() // Normalize case
            .slice(0, 2) || // Limit to 2 characters
        'VS'; // Fallback default

    // Step 3: Apply final sanitization (defense-in-depth)
    // Even though cleaned input should be safe, we sanitize again
    return sanitizeForSVG(initials);
}

/**
 * Validate and sanitize port number
 * Ensures only numeric values are used
 *
 * @param {string|number} port - User-provided port
 * @returns {string} - Sanitized port number or empty string
 */
function sanitizePort(port) {
    if (!port) {
        return '';
    }

    // Convert to string and validate numeric
    const portStr = String(port);

    // Only allow digits (no special characters)
    if (!/^\d{1,5}$/.test(portStr)) {
        logger.warn({ port, security: 'port-validation' }, 'Invalid port format');
        return '';
    }

    // Validate port range
    const portNum = parseInt(portStr, 10);
    if (portNum < 1 || portNum > 65535) {
        logger.warn({ port, security: 'port-validation' }, 'Port out of valid range');
        return '';
    }

    return portStr;
}

/**
 * Validate hex color code
 * Prevents color injection attacks
 *
 * @param {string} color - User-provided color
 * @returns {string} - Validated color or default
 */
function sanitizeColor(color) {
    if (!color || typeof color !== 'string') {
        return '#45B7D1'; // Safe default
    }

    // Only allow valid hex color format
    if (/^#[0-9A-Fa-f]{6}$/.test(color)) {
        return color;
    }

    logger.warn({ color, security: 'color-validation' }, 'Invalid color format');
    return '#45B7D1'; // Safe default
}

/**
 * Create safe SVG text element content
 * Ensures no executable code can be injected via SVG text
 *
 * @param {string} text - Text content
 * @returns {string} - Sanitized text for SVG
 */
function createSafeSVGText(text) {
    // Multiple layers of protection:
    // 1. Type validation
    if (typeof text !== 'string') {
        return '';
    }

    // 2. XSS pattern detection BEFORE filtering
    // Check original text for dangerous patterns
    const xssPatterns = [
        /<script/i,
        /javascript:/i,
        /on\w+=/i, // Event handlers like onload=, onclick=
        /<iframe/i,
        /<embed/i,
        /<object/i,
        /data:text\/html/i,
    ];

    for (const pattern of xssPatterns) {
        if (pattern.test(text)) {
            logger.error(
                { text: text.substring(0, 50), security: 'xss-detection' },
                'XSS pattern detected in SVG text'
            );
            return ''; // Reject entirely if XSS patterns detected
        }
    }

    // 3. Character whitelist validation
    const validated = validateProjectName(text);

    // 4. Entity encoding
    const sanitized = sanitizeForSVG(validated);

    return sanitized;
}

module.exports = {
    sanitizeForSVG,
    validateProjectName,
    getCleanInitials,
    sanitizePort,
    sanitizeColor,
    createSafeSVGText,
};
