# Changelog

All notable changes to the VS Code Favicon project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [6.0.0] - 2025-12-16

### Added
- **Universal VS Code Server Support** - Extension now works with ANY VS Code Server URL, not just vs.noreika.lt
- **Auto-detection** - Automatically detects VS Code Server pages via `?folder=` URL parameter
- **Domain Management UI** - New options page section for managing allowed domains
- **Progressive Permissions** - Uses Chrome's optional_host_permissions for on-demand permission requests
- **Dynamic Content Script Injection** - Content scripts are now injected programmatically instead of statically
- **Multi-tenant Notification Isolation** - Notifications are now keyed by origin+folder to prevent conflicts between different VS Code servers
- **Domain Manager Module** - New `modules/domain-manager.js` for centralized domain handling
- **API Base URL Configuration** - Dynamic API base URL support in popup and content scripts

### Changed
- **Manifest V3 permissions model** - Switched from static `content_scripts` to dynamic `scripting` API
- **Tab queries** - All hardcoded `vs.noreika.lt` URL patterns replaced with dynamic `?folder=` detection
- **Notification routes** - All endpoints now accept optional `origin` parameter for multi-tenant support
- **Extension version** - Bumped to v6.0.0 (major release)

### Technical Details
- `manifest.json` - Added `scripting` permission, `optional_host_permissions: ["<all_urls>"]`, removed `content_scripts`
- `background.js` - Added dynamic content script injection, tab detection, injectedTabs tracking
- `modules/tab-manager.js` - New `queryVSCodeTabs()` function for universal tab queries
- `modules/message-router.js` - 7 new message types for domain management
- `content-project-favicon.js` - Added VSCODE_ORIGIN, dynamic API_BASE, origin in all API calls
- `lib/notification-store.js` - Added `getNotificationKey(folder, origin)` for composite keys
- `lib/routes/notification-routes.js` - All endpoints accept `origin` parameter

## [Unreleased]

### Fixed
- **Red dot notification now works** - Increased notification rate limit from 10 to 60 req/min to support multiple VS Code tabs
- **Path case sensitivity** - API now normalizes path case (`/Opt/dev/` → `/opt/dev/`) for macOS case-insensitive filesystem
- **PNG favicon support** - Chrome extension now correctly sets MIME type for PNG favicons (was always setting SVG)
- **PNG badge overlay** - Extension now uses canvas to add red notification badge to PNG favicons
- **Cross-origin favicon loading** - Changed `Cross-Origin-Resource-Policy` from `same-origin` to `cross-origin` to allow favicons to be loaded from vs.noreika.lt

### Removed
- **Deprecated directories removed** - `vscode-favicon-api/` and `vscode-favicon-service/` (~24MB) - functionality consolidated into `src/server.js`
- **Unused modules removed** - `lib/server-factory.js`, `lib/middleware/path-validation.js`

### Added
- Download endpoint for Chrome extension: `/download/extension`
- `addBadgeToPNG()` function in extension for canvas-based badge overlay
- Environment-based configuration system using `.env` files
- Centralized configuration module (`lib/config.js`) with validation
- `.env.example` template with comprehensive documentation
- Configuration validation on startup with detailed error messages
- Support for customizable favicon search paths via environment variables
- Support for customizable project type colors via environment variables
- Configurable rate limiting parameters
- Configurable cache settings (size and TTL)
- Debug configuration summary logging
- Configuration documentation (`docs/CONFIGURATION.md`)

### Changed
- Migrated all hard-coded values to environment variables
- Updated `vscode-favicon-service/server.js` to use centralized config
- Updated `vscode-favicon-api/server.js` to use centralized config
- Updated `lib/path-validator.js` to use dynamic allowed paths from config
- Updated `lib/cors-config.js` to use CORS origins from config
- Improved cache management with LRU eviction and statistics
- Enhanced startup logging with environment information
- Cache Control headers now use configurable TTL value

### Security
- CORS origins now explicitly documented in `.env.example` with security warnings
- Rate limiting parameters now configurable per environment
- Path traversal protection uses dynamic allowed paths from config
- All security-critical values externalized for easier auditing

### Fixed
- Cache TTL consistency across both services
- Port configuration consistency
- CORS origin configuration duplicated across files

### Documentation
- Added comprehensive `docs/CONFIGURATION.md` guide
- Updated `.env.example` with detailed comments and examples
- Added environment-specific configuration examples
- Added Docker configuration examples
- Added troubleshooting guide

## [1.2.0] - 2025-12-03

### Security
- Fixed XSS vulnerabilities (CVSS 8.7) in SVG favicon generation
- Added comprehensive input sanitization for project names
- Implemented HTML entity encoding for SVG content
- Added port number validation and sanitization
- Created security audit documentation
- Added 85+ security tests for XSS protection

### Added
- `lib/svg-sanitizer.js` module for secure SVG generation
- Comprehensive test suite for XSS protection
- Security documentation in `docs/security/`
- XSS fix quick start guide

## [1.1.0] - 2025-12-03

### Security
- Fixed critical path traversal vulnerability (CVSS 9.1)
- Implemented comprehensive path validation system
- Added symlink attack protection
- Added URL encoding bypass protection
- Added null byte injection protection
- Added path prefix confusion protection

### Added
- Centralized `lib/path-validator.js` module
- `lib/cors-config.js` with strict origin validation
- `lib/validators.js` for express-validator rules
- Rate limiting with `express-rate-limit`
- 29+ security tests for path traversal
- 28+ security tests for CORS configuration
- Security documentation (`docs/SECURITY.md`, `docs/PATH-VALIDATOR.md`)

### Changed
- Replaced inline path validation with shared validator
- Implemented strict CORS policy (no wildcards)
- Added input validation on all API endpoints
- Added JSON body size limits (10KB)

## [1.0.0] - 2025-09-24

### Added
- Initial release
- VS Code Favicon Service (port 8090)
- VS Code Favicon API (port 8091)
- Project registry integration
- SVG favicon generation with project info
- Custom favicon detection and serving
- Claude completion notification system
- Basic CORS support
- PM2 ecosystem configuration

### Features
- Generate project-specific favicons
- Support for custom favicon files
- Project type-based coloring
- Port display for development projects
- Registry-based project information
