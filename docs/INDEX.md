# Documentation Index

Complete documentation index for the VS Code Favicon Service project.

## Quick Start

New to the project? Start here:

1. **[README.md](../README.md)** - Project overview and quick start
2. **[DEVELOPMENT.md](DEVELOPMENT.md)** - Developer setup guide
3. **[API.md](API.md)** - API reference for both services

## Core Documentation

### Essential Guides

| Document | Description | Audience |
|----------|-------------|----------|
| **[README.md](../README.md)** | Project overview, features, quick start | Everyone |
| **[API.md](API.md)** | Complete API reference for both services | Developers, Integrators |
| **[ARCHITECTURE.md](ARCHITECTURE.md)** | System architecture and design decisions | Developers, Architects |
| **[DEVELOPMENT.md](DEVELOPMENT.md)** | Developer setup and workflow | Developers |
| **[CONFIGURATION.md](CONFIGURATION.md)** | Configuration options and environment variables | DevOps, Developers |

### Security & Testing

| Document | Description | Audience |
|----------|-------------|----------|
| **[SECURITY.md](SECURITY.md)** | Security features, policies, and best practices | Security Engineers, Developers |
| **[SECURITY_VALIDATION.md](SECURITY_VALIDATION.md)** | Security validation procedures | Security Engineers |
| **[SECURITY_AUDIT_XSS_FIX.md](SECURITY_AUDIT_XSS_FIX.md)** | XSS vulnerability audit and fixes | Security Engineers |
| **[PATH-VALIDATOR.md](PATH-VALIDATOR.md)** | Path validation and traversal protection | Security Engineers, Developers |
| **[TESTING.md](TESTING.md)** | Testing guide and coverage reports | Developers, QA |

### Performance & Caching

| Document | Description | Audience |
|----------|-------------|----------|
| **[CACHE_ARCHITECTURE.md](CACHE_ARCHITECTURE.md)** | Caching strategy, LRU cache, TTL cache | Developers, Architects |
| **[CACHE_ARCHITECTURE.ascii](CACHE_ARCHITECTURE.ascii)** | ASCII diagram of cache architecture | Developers |
| **[LRU_CACHE_SUMMARY.md](LRU_CACHE_SUMMARY.md)** | LRU cache implementation summary | Developers |
| **[LRU_CACHE_QUICK_REFERENCE.md](LRU_CACHE_QUICK_REFERENCE.md)** | Quick reference for LRU cache | Developers |
| **[registry-cache.md](registry-cache.md)** | Project registry caching details | Developers |
| **[performance-optimization-summary.md](performance-optimization-summary.md)** | Performance optimization guide | DevOps, Developers |

### Deployment & Operations

| Document | Description | Audience |
|----------|-------------|----------|
| **[DEPLOYMENT.md](../DEPLOYMENT.md)** | Manual deployment instructions | DevOps |
| **[DEPLOYMENT_SETUP.md](DEPLOYMENT_SETUP.md)** | CI/CD deployment setup guide | DevOps |
| **[CI_CD.md](CI_CD.md)** | CI/CD pipeline documentation | DevOps |
| **[CI_CD_PIPELINE.ascii](CI_CD_PIPELINE.ascii)** | ASCII diagram of CI/CD pipeline | DevOps |
| **[CI_CD_QUICK_REFERENCE.md](CI_CD_QUICK_REFERENCE.md)** | Quick CI/CD commands and tips | DevOps |
| **[CI_CD_TEST_SCENARIOS.md](CI_CD_TEST_SCENARIOS.md)** | CI/CD test scenarios | DevOps, QA |

### Health & Monitoring

| Document | Description | Audience |
|----------|-------------|----------|
| **[HEALTH_CHECK.md](HEALTH_CHECK.md)** | Health check endpoints and monitoring | DevOps, SRE |
| **[HEALTH_CHECK_QUICK_REFERENCE.md](HEALTH_CHECK_QUICK_REFERENCE.md)** | Quick health check commands | DevOps, SRE |
| **[GRACEFUL_SHUTDOWN.md](GRACEFUL_SHUTDOWN.md)** | Graceful shutdown implementation | Developers, DevOps |

### Maintenance & History

| Document | Description | Audience |
|----------|-------------|----------|
| **[CHANGELOG.md](../CHANGELOG.md)** | Version history and changes | Everyone |
| **[changelog.md](changelog.md)** | Detailed changelog (docs version) | Developers |
| **[async-io-conversion.md](async-io-conversion.md)** | Async I/O conversion history | Developers |

## Implementation Summaries

These documents summarize major implementation tasks:

| Document | Description |
|----------|-------------|
| **[ASYNC_CONVERSION_SUMMARY.md](../ASYNC_CONVERSION_SUMMARY.md)** | Async/await conversion summary |
| **[CI_CD_IMPLEMENTATION_SUMMARY.md](../CI_CD_IMPLEMENTATION_SUMMARY.md)** | CI/CD implementation summary |
| **[IMPLEMENTATION_SUMMARY.md](../IMPLEMENTATION_SUMMARY.md)** | General implementation notes |
| **[SECURITY_AUDIT_REPORT.md](../SECURITY_AUDIT_REPORT.md)** | Security audit findings |
| **[SECURITY_FIX_README.md](../SECURITY_FIX_README.md)** | Security fix overview |

### Task-specific Documentation

| Document | Description |
|----------|-------------|
| **[TASK_021_ARCHITECTURE.md](../TASK_021_ARCHITECTURE.md)** | Task 021: Architecture documentation |
| **[TASK_021_SUMMARY.md](../TASK_021_SUMMARY.md)** | Task 021: Summary |
| **[TASK_021_TESTING.md](../TASK_021_TESTING.md)** | Task 021: Testing guide |

### XSS Security Fixes

| Document | Description |
|----------|-------------|
| **[XSS_FIX_SUMMARY.md](XSS_FIX_SUMMARY.md)** | XSS fix summary |
| **[XSS_FIX_QUICK_START.md](XSS_FIX_QUICK_START.md)** | Quick start after XSS fixes |
| **[XSS_FIX_FILES.txt](../XSS_FIX_FILES.txt)** | List of files modified for XSS fixes |

## Security Documentation

Security is a top priority. Key security documents:

### Security Subsystem

Located in `docs/security/`:

- **Input validation** - Path traversal, null byte, URL encoding protection
- **XSS protection** - SVG sanitization, HTML encoding
- **CORS security** - Origin whitelisting, cache poisoning prevention
- **Rate limiting** - Per-IP limits, notification throttling

## Document Categories

### By Type

**Getting Started**:
- README.md
- DEVELOPMENT.md
- API.md

**Architecture & Design**:
- ARCHITECTURE.md
- CACHE_ARCHITECTURE.md
- CACHE_ARCHITECTURE.ascii
- CI_CD_PIPELINE.ascii

**Security**:
- SECURITY.md
- SECURITY_VALIDATION.md
- SECURITY_AUDIT_XSS_FIX.md
- PATH-VALIDATOR.md
- XSS_FIX_SUMMARY.md

**Operations**:
- DEPLOYMENT.md
- DEPLOYMENT_SETUP.md
- CI_CD.md
- HEALTH_CHECK.md
- GRACEFUL_SHUTDOWN.md

**Development**:
- DEVELOPMENT.md
- TESTING.md
- CONFIGURATION.md

**Reference**:
- API.md
- LRU_CACHE_QUICK_REFERENCE.md
- CI_CD_QUICK_REFERENCE.md
- HEALTH_CHECK_QUICK_REFERENCE.md

**History**:
- CHANGELOG.md
- changelog.md
- ASYNC_CONVERSION_SUMMARY.md
- async-io-conversion.md

### By Audience

**Developers**:
- DEVELOPMENT.md
- API.md
- ARCHITECTURE.md
- TESTING.md
- CACHE_ARCHITECTURE.md
- LRU_CACHE_SUMMARY.md
- GRACEFUL_SHUTDOWN.md

**DevOps/SRE**:
- DEPLOYMENT.md
- DEPLOYMENT_SETUP.md
- CI_CD.md
- HEALTH_CHECK.md
- CONFIGURATION.md
- performance-optimization-summary.md

**Security Engineers**:
- SECURITY.md
- SECURITY_VALIDATION.md
- SECURITY_AUDIT_XSS_FIX.md
- PATH-VALIDATOR.md
- XSS_FIX_SUMMARY.md

**Project Managers**:
- README.md
- CHANGELOG.md
- IMPLEMENTATION_SUMMARY.md
- CI_CD_IMPLEMENTATION_SUMMARY.md

**Everyone**:
- README.md
- API.md (basic usage)

## Quick Reference Guides

Quick reference cards for common tasks:

1. **[LRU_CACHE_QUICK_REFERENCE.md](LRU_CACHE_QUICK_REFERENCE.md)** - Cache operations
2. **[CI_CD_QUICK_REFERENCE.md](CI_CD_QUICK_REFERENCE.md)** - CI/CD commands
3. **[HEALTH_CHECK_QUICK_REFERENCE.md](HEALTH_CHECK_QUICK_REFERENCE.md)** - Health checks
4. **[XSS_FIX_QUICK_START.md](XSS_FIX_QUICK_START.md)** - Post-XSS-fix guide

## ASCII Diagrams

Visual documentation:

1. **[CACHE_ARCHITECTURE.ascii](CACHE_ARCHITECTURE.ascii)** - Cache system diagram
2. **[CI_CD_PIPELINE.ascii](CI_CD_PIPELINE.ascii)** - CI/CD pipeline flow

## Common Tasks

### I want to...

**...get started with development**:
→ [DEVELOPMENT.md](DEVELOPMENT.md)

**...understand the API**:
→ [API.md](API.md)

**...configure the services**:
→ [CONFIGURATION.md](CONFIGURATION.md)

**...deploy to production**:
→ [DEPLOYMENT_SETUP.md](DEPLOYMENT_SETUP.md) + [CI_CD.md](CI_CD.md)

**...understand security features**:
→ [SECURITY.md](SECURITY.md) + [PATH-VALIDATOR.md](PATH-VALIDATOR.md)

**...run tests**:
→ [TESTING.md](TESTING.md)

**...debug caching issues**:
→ [CACHE_ARCHITECTURE.md](CACHE_ARCHITECTURE.md) + [LRU_CACHE_QUICK_REFERENCE.md](LRU_CACHE_QUICK_REFERENCE.md)

**...monitor service health**:
→ [HEALTH_CHECK.md](HEALTH_CHECK.md) + [HEALTH_CHECK_QUICK_REFERENCE.md](HEALTH_CHECK_QUICK_REFERENCE.md)

**...understand the architecture**:
→ [ARCHITECTURE.md](ARCHITECTURE.md)

**...contribute to the project**:
→ [DEVELOPMENT.md](DEVELOPMENT.md) (Contributing section)

**...see what changed**:
→ [CHANGELOG.md](../CHANGELOG.md) + [changelog.md](changelog.md)

**...troubleshoot deployment issues**:
→ [CI_CD.md](CI_CD.md) + [CI_CD_TEST_SCENARIOS.md](CI_CD_TEST_SCENARIOS.md)

## Documentation Standards

### File Naming

- **Markdown**: `.md` extension
- **ASCII art**: `.ascii` extension
- **UPPERCASE**: Major docs (README, SECURITY, etc.)
- **lowercase**: Supporting docs (changelog, async-io-conversion, etc.)
- **Hyphens**: Multi-word files (CACHE_ARCHITECTURE, XSS_FIX_SUMMARY, etc.)

### Document Structure

All major docs should include:

1. **Title** - Clear, descriptive H1
2. **Overview** - Brief introduction (1-2 paragraphs)
3. **Table of Contents** - For docs > 200 lines
4. **Sections** - Logical groupings with H2/H3 headers
5. **Examples** - Code snippets and commands
6. **Related Docs** - Links to related documentation

### Code Examples

All code examples should:

- Include language identifier for syntax highlighting
- Show complete, runnable commands
- Include expected output when relevant
- Explain parameters and options

### Maintenance

Documentation should be updated when:

- API changes (update API.md)
- Configuration options added (update CONFIGURATION.md)
- Security features changed (update SECURITY.md)
- Architecture evolves (update ARCHITECTURE.md)
- Version released (update CHANGELOG.md)

## Need Help?

**Can't find what you're looking for?**

1. Search within documentation (grep or IDE search)
2. Check the README.md troubleshooting section
3. Review health check docs for operational issues
4. Email: kostas@noreika.lt

**Found a documentation bug?**

1. File an issue on Forgejo
2. Or submit a PR with the fix

**Want to contribute documentation?**

1. Follow existing document structure
2. Use clear, concise language
3. Include examples
4. Test all commands/code snippets
5. Submit a PR

---

## Document Statistics

Total documentation files: **40+**

By category:
- Core docs: 5
- Security: 7
- Performance: 6
- Operations: 10
- Development: 5
- History: 5
- Summaries: 7

Lines of documentation: **10,000+**

Last updated: 2025-12-04
