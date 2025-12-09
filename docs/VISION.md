# VS Code Favicon - Project Vision

## Purpose

VS Code Favicon is a browser-based system that automatically assigns unique, project-specific favicon icons and titles to VS Code Server instances. It helps users distinguish between multiple VS Code projects/tabs when running code editor instances on remote servers.

## Target Users

- Developers using VS Code Server (code-server) remotely
- Users with multiple projects open simultaneously
- Teams working with development, staging, and production environments

## Key Goals

1. **Visual Distinction** - Each project gets a unique favicon based on project name/type
2. **Environment Awareness** - Color-coded by environment (dev=teal, prod=red, staging=yellow)
3. **Quick Identification** - Port numbers visible in dev favicons
4. **Notification Support** - Visual badges for Claude AI completion notifications
5. **Zero Configuration** - Works automatically via Chrome extension + API service

## Success Criteria

1. **Security** - No path traversal, XSS, or other OWASP vulnerabilities
2. **Reliability** - 99.9% uptime, graceful error handling
3. **Performance** - <50ms response time for favicon generation
4. **Scalability** - Support 100+ concurrent users without degradation
5. **Maintainability** - Single codebase, comprehensive tests, clear documentation

## Technical Context

- **Backend**: Node.js + Express (ports 8090, 8091)
- **Frontend**: Chrome Extension (Manifest V3)
- **Infrastructure**: Cloudflare Tunnel, PM2, Mac Studio server
- **Integration**: Project registry at `/opt/registry/projects.json`

## Current State (2025-12-03)

The project is functional but has critical issues:
- 5 CRITICAL security vulnerabilities
- 0% test coverage
- Blocking I/O operations
- Memory leak risks
- Code duplication (2 services, 4 extension versions)

## Target State

A production-ready, secure, and maintainable favicon service with:
- All security vulnerabilities fixed
- 80%+ test coverage
- Async I/O operations
- Redis-based caching and notifications
- Single consolidated codebase
- CI/CD pipeline with automated testing
