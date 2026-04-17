---
name: release-readiness-checker
description: Pre-release gate — aggregates signals from pipelines, tests, audits, and docs to give a go/no-go verdict
argument-hint: "[version-tag-or-branch]"
allowed-tools: Read, Write, Grep, Glob, Bash(git log, git tag, git diff, git status, npm test, npm run, pytest, cat, ls, date)
---

# Release Readiness Checker

Act as a pre-release gate that aggregates signals from across the project to answer one question: **can we ship this?** Instead of a PM manually checking 8 different dashboards, this skill produces a single go/no-go verdict with a punch list of what's outstanding.

## Step 1 — Identify the Release

If `$ARGUMENTS` is provided, use it as the version tag or branch being evaluated.
Otherwise:
- Check for the latest git tag: `git tag --sort=-v:refname | head -5`
- Use the diff between the latest tag and HEAD as the release scope
- If no tags exist, evaluate the current state of the default branch

Capture the release identifier as `$RELEASE` (e.g., `v2.4.0`, `release/2.4`, or `HEAD`).

## Step 2 — Pipeline & Build Status

### Check CI/CD Health
- Look for Azure Pipelines definitions: `Glob: azure-pipelines*.yml, .azure-pipelines/**/*.yml`
- Look for GitHub Actions: `Glob: .github/workflows/*.yml`
- Check if a build script exists and is runnable: `package.json` scripts, `Makefile`, `build.gradle`

### Run the Build (if safe)
If a build command is available and non-destructive:
```bash
npm run build 2>&1 | tail -30    # Node.js
python -m py_compile <entry>     # Python (syntax check)
dotnet build --no-restore 2>&1 | tail -30  # .NET
```

Record: **PASS** / **FAIL** / **SKIPPED** (if no build command found)

## Step 3 — Test Suite Status

### Run Tests
```bash
npm test 2>&1 | tail -50        # Node.js
pytest --tb=short 2>&1 | tail -50   # Python
dotnet test 2>&1 | tail -50     # .NET
```

Record:
- Tests passed / failed / skipped
- Test coverage percentage (if coverage tool is configured)
- Any newly skipped tests since last tag: `git diff <last-tag>..HEAD -- '*.test.*' '*.spec.*' '**/test_*'`

### Coverage Gate
- If coverage config exists (`.nycrc`, `jest.config`, `pytest.ini`, `coveragerc`), extract the threshold
- Compare actual coverage to threshold
- Record: **PASS** (above threshold) / **FAIL** (below) / **NO_THRESHOLD** (not configured)

## Step 4 — Security Findings

### Check Latest Security Audit Report
```bash
ls -t reports/security-audit-*.md 2>/dev/null | head -1
```

If a recent report exists (within 7 days), parse its YAML front-matter:
- `critical_count`: must be 0 for release
- `high_count`: should be 0, flag if > 0

If no recent report exists, flag: **STALE — security audit not run recently**

### Check Dependency Vulnerabilities
```bash
ls -t reports/dependency-update-*.md 2>/dev/null | head -1
```

Parse: `vulnerabilities_critical`, `vulnerabilities_high`
- Any critical CVEs → **BLOCK**
- High CVEs > 3 → **WARNING**

If no report exists, run a quick check:
```bash
npm audit --json 2>/dev/null | head -100
```

## Step 5 — Documentation Readiness

### Changelog
Check if changelog is updated for this release:
```
Glob: CHANGELOG.md, CHANGES.md, HISTORY.md, docs/changelog*
```
- Does it contain an entry for `$RELEASE`?
- If no changelog exists, flag: **MISSING — no changelog found**

### README
- When was README last updated? `git log -1 --format='%ci' -- README.md`
- Does it reference the correct version?

### API Documentation
- If OpenAPI/Swagger spec exists, is it current?
- `git diff <last-tag>..HEAD -- '*.openapi.*' '*.swagger.*' 'openapi.yaml' 'openapi.json'`
- Check if API routes changed but docs didn't

## Step 6 — Open Blockers & Work Items

### Git Status
```bash
git status --short   # Any uncommitted changes?
git stash list       # Any stashed work?
```

### TODO/FIXME Scan
Search for release-blocking markers:
```
Grep: "TODO.*release", "FIXME.*release", "HACK.*before.*release", "XXX"
Grep: "TODO.*$RELEASE", "FIXME.*block"
```

### Recent Commits Assessment
```bash
git log <last-tag>..HEAD --oneline
```
- Count total commits in this release
- Flag any commits with "WIP", "temp", "hack", "fixup" in message
- Flag any commits that revert other commits

## Step 7 — Tech Debt Check

### Check Latest Tech Debt Report
```bash
ls -t reports/tech-debt-audit-*.md 2>/dev/null | head -1
```

If a recent report exists (within 30 days), parse `overall_score`:
- Score ≥ 3.5/5 → **HEALTHY**
- Score 2.5-3.5 → **ACCEPTABLE** (note concerns)
- Score < 2.5 → **WARNING** (significant debt shipping)

## Step 8 — Generate Verdict

### Scoring Matrix

| Check | Status | Weight |
|-------|--------|--------|
| Build passes | PASS/FAIL/SKIP | Required |
| Tests pass | PASS/FAIL/SKIP | Required |
| Coverage above threshold | PASS/FAIL/NONE | Important |
| Zero critical security findings | PASS/FAIL/STALE | Required |
| Zero critical CVEs in deps | PASS/FAIL/STALE | Required |
| Changelog updated | PASS/FAIL/MISSING | Important |
| No WIP commits | PASS/FAIL | Advisory |
| No release-blocking TODOs | PASS/FAIL | Advisory |
| Tech debt score acceptable | PASS/WARN/STALE | Advisory |
| API docs current | PASS/FAIL/N/A | Important |

### Verdict Rules

**GO** — All Required checks PASS, no more than 1 Important check fails
**CONDITIONAL GO** — All Required checks PASS, but 2+ Important checks fail
**NO-GO** — Any Required check FAILs

### Format the Verdict

```
┌──────────────────────────────────────────────┐
│  RELEASE READINESS: <GO|CONDITIONAL GO|NO-GO> │
│  Release: <$RELEASE>                          │
│  Date: <today>                                │
└──────────────────────────────────────────────┘

REQUIRED CHECKS:
  ✅ Build passes
  ✅ Tests pass (142 passed, 0 failed)
  ❌ Zero critical security findings (1 critical found)
  ✅ Zero critical CVEs

IMPORTANT CHECKS:
  ✅ Coverage above threshold (87% > 80%)
  ⚠️  Changelog not updated for v2.4.0
  ✅ API docs current

ADVISORY CHECKS:
  ⚠️  2 commits contain "WIP" in message
  ✅ No release-blocking TODOs
  ✅ Tech debt score: 3.8/5

BLOCKERS (must fix before release):
  1. [CRITICAL] Security audit found 1 critical issue — run /security-audit for details
  2. [IMPORTANT] Changelog missing entry for v2.4.0

WARNINGS (recommended before release):
  1. 2 WIP commits should be squashed or renamed
```

## Step 9 — Save Report

Save the complete readiness check to a persistent file.

1. Create the `reports/` directory if it doesn't exist: `mkdir -p reports`
2. Get today's date: `date +%Y-%m-%d` and capture as `$DATE`
3. Save to: `reports/release-readiness-<release>-<DATE>.md`
   - Include a YAML front-matter header with: `date`, `release`, `verdict` (GO/CONDITIONAL_GO/NO_GO), `required_pass`, `required_fail`, `important_pass`, `important_fail`, `blocker_count`
4. Print the file path so the user knows where to find it

**Naming examples:**
- `reports/release-readiness-v2.4.0-2025-06-15.md`
- `reports/release-readiness-HEAD-2025-06-15.md`

**Tip:** Run this as the final step before every release tag. Integrate with `/report-trends` to track release quality over time.
