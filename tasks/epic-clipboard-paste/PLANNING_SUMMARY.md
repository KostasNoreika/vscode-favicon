# Planning Summary: Clipboard Image Paste Feature

**Date**: 2024-12-09
**Planner**: Claude AI (via /sc-plan)

## Vision

Extend VS Code Favicon browser extension to enable seamless clipboard image pasting into code-server terminal, reducing the 5-step manual workflow (screenshot → save → drag to explorer → drag to terminal) to a single keyboard shortcut (Ctrl+V).

## Scope

Add new functionality to:
1. **Server** - New `/api/paste-image` endpoint for receiving and storing images
2. **Extension** - Clipboard paste detection and terminal path injection
3. **UI** - Visual feedback during upload process

## Problem Statement

Current workflow for sharing images with Claude CLI in code-server:
1. Take screenshot (Print Screen)
2. Save to desktop
3. Drag file to VS Code file explorer
4. Drag from explorer to terminal
5. Wait for path to appear

**Target workflow**:
1. Take screenshot
2. Ctrl+V in terminal → done

## Structure

**Epic Organization**: Yes
**Total Tasks**: 7
**Epic**: clipboard-paste

## Task Breakdown by Agent

| Agent | Tasks | Description |
|-------|-------|-------------|
| `backend-architect` | 1 | API endpoint for image upload |
| `frontend-architect` | 2 | Paste handler + feedback UI |
| `security-engineer` | 1 | Security review |
| `devops-architect` | 1 | Extension manifest updates |
| `quality-engineer` | 1 | Integration tests |
| `technical-writer` | 1 | Documentation |

## Task List

| # | Agent | Task | Effort | Dependencies |
|---|-------|------|--------|--------------|
| 001 | backend-architect | Create paste-image endpoint | M | None |
| 002 | frontend-architect | Add clipboard paste handler | M | 001 |
| 003 | security-engineer | Security review | S | 001 |
| 004 | frontend-architect | Add upload feedback UI | S | 002 |
| 005 | devops-architect | Update manifest permissions | S | None |
| 006 | quality-engineer | Write integration tests | M | 001, 003 |
| 007 | technical-writer | Update documentation | S | 001, 002, 005 |

## Key Milestones

1. **Backend Ready**: Task 001 complete - API can receive images
2. **Extension Ready**: Tasks 002, 005 complete - Paste works end-to-end
3. **Production Ready**: All tasks complete - Tested, secure, documented

## Technical Stack

- **Backend**: Express.js + multer (multipart handling)
- **Extension**: Chrome Manifest V3 + Clipboard API
- **Security**: path-validator.js, file-type validation
- **Testing**: Jest + supertest

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Browser (code-server)                                  │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Chrome Extension                                │   │
│  │  ┌────────────────────────────────────────────┐  │   │
│  │  │  content-project-favicon.js                │  │   │
│  │  │  - paste event listener                    │  │   │
│  │  │  - clipboard API access                    │  │   │
│  │  │  - terminal path injection                 │  │   │
│  │  └────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                           │
                           │ POST /api/paste-image
                           │ multipart/form-data
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Server (favicon-api.noreika.lt)                        │
│  ┌──────────────────────────────────────────────────┐   │
│  │  lib/routes/paste-routes.js                      │   │
│  │  - requireValidPath middleware                   │   │
│  │  - multer file handling                          │   │
│  │  - MIME validation                               │   │
│  │  - Save to /tasks/                               │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                           │
                           │ fs.writeFile
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Project Directory                                       │
│  /opt/dev/my-project/tasks/                             │
│  └── img-2024-12-09-143052.png                          │
└─────────────────────────────────────────────────────────┘
```

## Dependencies & Risks

### Critical Path
```
005 (manifest) ─┐
                ├──► 002 (paste handler) ──► 004 (UI)
001 (endpoint) ─┴──► 003 (security) ──► 006 (tests)
                                              │
                                              ▼
                                    007 (documentation)
```

### Potential Risks

| Risk | Mitigation |
|------|------------|
| Clipboard API requires HTTPS | Server already uses HTTPS via Cloudflare |
| Large images slow upload | 10MB limit, progress indicator |
| Terminal focus detection | Use existing selector patterns |
| Path injection into xterm | Use dispatchEvent on textarea |

## Security Considerations

1. **Path Traversal** - Use existing `validatePathAsync()`
2. **File Type Spoofing** - Validate MIME via magic bytes, not headers
3. **DoS via Large Files** - 10MB limit + rate limiting
4. **XSS via Filename** - Timestamp-based names, no user input

## Next Steps

1. Review and approve this plan
2. Begin with task: **001** (backend endpoint) and **005** (manifest) in parallel
3. Follow task completion workflow:
   - Complete task
   - Rename to `done_[filename]`
   - Test task
   - Rename to `tested_done_[filename]`

## Execution Order (Parallel Where Possible)

```
Wave 1 (parallel):
  - 001_backend-architect_create-paste-image-endpoint
  - 005_devops-architect_update-manifest-permissions

Wave 2 (after 001):
  - 002_frontend-architect_add-clipboard-paste-handler
  - 003_security-engineer_security-review-paste-endpoint

Wave 3 (after 002):
  - 004_frontend-architect_add-upload-feedback-ui

Wave 4 (after 001, 003):
  - 006_quality-engineer_write-integration-tests

Wave 5 (after all):
  - 007_technical-writer_update-documentation
```

---

*Generated by /sc-plan command*
