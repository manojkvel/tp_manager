---
name: release-notes
description: Auto-generate categorized release notes from pipeline artifacts — features added (traced to specs), bugs fixed (traced to tasks), breaking changes (from /api-contract-analyzer), known issues, and upgrade instructions. Produces markdown, CHANGELOG entry, or structured JSON for a release page.
argument-hint: "[--format markdown|changelog|json] [--since tag-or-date] [--version v2.4.0] path/to/spec-or-all"
allowed-tools: Read, Write, Grep, Glob, Bash(git log, git diff, git tag, git show, git shortlog, ls, find, cat, wc, date, jq)
---

# Release Notes — Automated Changelog Generation

Every release needs release notes. Writing them by hand means cross-referencing PRs, tasks, spec ACs, board items, and git commits — easily 2+ hours of PM time. The pipeline already has all this information in structured form. `/release-notes` assembles it automatically.

## Sources

| Source | What It Provides |
|--------|-----------------|
| `spec.md` (all versions) | Feature titles, AC descriptions, business context |
| `tasks.md` + `board-mapping.json` | Completed tasks → feature list, task type classification |
| `pipeline-state.json` | Which specs were completed in this release |
| `spec-review.md` | Compliance score, known gaps |
| `/api-contract-analyzer` report | Breaking changes, deprecations |
| `git log --since` | Commit history, PR references |
| `triage-log.json` | Bug fixes (from TEST_FAILURE and SECURITY_FINDING recoveries) |
| `/release-readiness-checker` report | Known issues, deferred items |

## CRITICAL RULES

1. **User-facing language.** Release notes are for end users and operators, not developers. Translate "TASK-005: Implement token refresh with sliding window" into "OAuth token refresh now uses a sliding window, preventing unnecessary re-authentication during active sessions."
2. **Categorize clearly.** Features, bug fixes, breaking changes, deprecations, security fixes, known issues — each in its own section.
3. **Breaking changes are prominent.** These go at the top with migration instructions. Users skim release notes; they must not miss breaking changes.
4. **Trace to specs.** Each feature references the spec that defined it, so users can find detailed documentation.
5. **Don't include internal pipeline details.** Users don't need to know about `/review-fix` cycles or gate failures.

---

## Phase 0 — Determine Release Scope

### 0.1 Identify What's in the Release

```
If --since tag: compare current state to the tagged release
If --since date: compare current state to that date
If neither: find the most recent git tag and compare from there
```

### 0.2 Collect Completed Specs

```
Glob: specs/*/pipeline-state.json
Filter: completed between --since and now
For each: load spec.md, tasks.md, board-mapping.json, spec-review.md
```

### 0.3 Collect Git History

```bash
git log --since="$SINCE" --format="%H %s" --no-merges
git log --since="$SINCE" --format="%H %s" --merges  # PR merges
```

---

## Phase 1 — Categorize Changes

### 1.1 Features

For each completed spec:
```
Title: from spec.md title
Description: from spec.md summary, rewritten in user-facing language
ACs satisfied: from spec-review.md
Spec reference: link to spec directory
```

### 1.2 Bug Fixes

From triage-log.json, extract recoveries where:
- Classification == TEST_FAILURE and the fix changed production code (not just tests)
- Classification == SECURITY_FINDING and a CVE was patched
- Classification == BUILD_FAILURE from a regression

### 1.3 Breaking Changes

From `/api-contract-analyzer` reports (if available):
- Removed endpoints
- Changed request/response schemas
- Authentication changes
- Behavior changes in existing endpoints

### 1.4 Security Fixes

From `/security-audit` reports and triage recoveries:
- CVEs patched (with CVE reference)
- Vulnerability categories addressed
- Dependency updates for security

### 1.5 Deprecations

From plan.md and implementation reports:
- APIs marked deprecated
- Features scheduled for removal
- Migration paths provided

### 1.6 Known Issues

From `/release-readiness-checker` report and deferred findings:
- Open deferred findings with workarounds
- Spec compliance gaps below 100%
- Performance caveats

---

## Phase 2 — Generate Release Notes

### 2.1 Markdown Format

```markdown
# Release Notes — v2.4.0
**Release Date:** 2026-02-16

## Breaking Changes

### OAuth Token Format Updated
The OAuth access token format has changed from opaque tokens to JWT.
Applications that inspect token contents must update their parsing logic.

**Migration:** Update your token validation to use the JWKS endpoint at
`/.well-known/jwks.json` instead of the introspection endpoint.
See: specs/049-jwt-migration/spec.md

## New Features

### SSO Login for Enterprise Customers
Enterprise customers can now configure Single Sign-On using SAML 2.0 or
OAuth 2.0 identity providers. Supports IdP-initiated and SP-initiated flows
with automatic certificate rotation.
See: specs/047-sso-login/spec.md

### Admin Dashboard for SSO Configuration
Self-service admin dashboard for managing SSO provider configuration,
certificate uploads, and login health monitoring.
See: specs/048-sso-admin-dashboard/spec.md

## Bug Fixes

- Fixed token refresh failure during concurrent sessions (#1234)
- Fixed race condition in session management under high load (#1238)
- Fixed incorrect error message when SAML assertion is expired (#1241)

## Security Fixes

- **CVE-2026-1234:** Patched XSS vulnerability in OAuth callback handler
- Updated `jsonwebtoken` dependency to address token validation bypass

## Deprecations

- The `/api/v1/auth/introspect` endpoint is deprecated. Use JWKS-based
  validation instead. Removal scheduled for v3.0.0.

## Known Issues

- SSO login with Azure AD sometimes requires a second attempt when the
  IdP response is slow (>5 seconds). Workaround: retry the login.
- Audit logging for SSO events is not yet implemented (deferred to v2.5.0).

---
*Generated by /release-notes from SDLC pipeline artifacts*
```

### 2.2 CHANGELOG Format

Append to CHANGELOG.md in standard keepachangelog format:

```markdown
## [2.4.0] - 2026-02-16

### Added
- SSO Login for Enterprise Customers (SAML 2.0 + OAuth 2.0)
- Admin Dashboard for SSO Configuration

### Changed
- OAuth token format updated to JWT (BREAKING)

### Fixed
- Token refresh failure during concurrent sessions (#1234)
- Race condition in session management (#1238)
- Incorrect error message for expired SAML assertions (#1241)

### Security
- CVE-2026-1234: XSS in OAuth callback handler
- Updated jsonwebtoken dependency

### Deprecated
- `/api/v1/auth/introspect` endpoint (removal in v3.0.0)
```

### 2.3 JSON Format

For programmatic consumption (release pages, API responses):

```json
{
  "version": "2.4.0",
  "date": "2026-02-16",
  "breaking_changes": [...],
  "features": [...],
  "bug_fixes": [...],
  "security_fixes": [...],
  "deprecations": [...],
  "known_issues": [...]
}
```

---

## Modes

```
/release-notes --version v2.4.0 --since v2.3.0
/release-notes --version v2.4.0 --since 2026-01-15
/release-notes --version v2.4.0 --format changelog
/release-notes --version v2.4.0 --format json
/release-notes --dry-run --version v2.4.0 --since v2.3.0
```

---

## Output

1. **Primary:** `RELEASE-NOTES-v{version}.md` or CHANGELOG.md entry or release-notes.json
2. **Console summary:** Feature count, bug fix count, breaking change count
3. **Side effects:** CHANGELOG.md updated if `--format changelog`
