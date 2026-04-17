---
name: review-fix
description: Parse review report findings and auto-fix CRITICAL and HIGH issues with test verification, producing a traceability report mapping each finding to its resolution
argument-hint: "path/to/reports/review-*.md [--all] [--severity HIGH] [--dry-run]"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(git diff, git log, git status, git add, git stash, ls, find, tree, npm test, npx vitest, npx jest, pytest, npm run lint, flake8, ruff, mypy, tsc, date)
---

# Review Fix

Consume a review report (from `/review`, `/security-audit`, or `/design-review`), parse structured findings, auto-fix CRITICAL and HIGH severity issues, run tests and lint after each batch, and produce a fix traceability report.

This closes the review → fix → verify loop in the spec-driven pipeline: **Spec → Plan → Tasks → Implement → Review → Fix → Verify**.

## CRITICAL RULES

1. **Always start from a review report file.** Never guess at issues. If no report path is given, search `reports/` for the most recent review report.
2. **Only auto-fix CRITICAL and HIGH findings by default.** MEDIUM and LOW are logged for human decision unless `--all` is passed.
3. **Do not change the intent of the code.** Fixes must address exactly the finding — no refactoring, no feature additions, no scope creep. If broader refactoring would help, note it in the fix report but don't apply it.
4. **Test after every fix batch.** If tests break, revert the batch and log as BLOCKED.
5. **Never modify the review report.** The report is the source of truth. Implementation reads it; it never writes to it.
6. **Traceability is mandatory.** Every fix must trace to a finding ID. Untraced changes are not permitted.

---

## Phase 1 — Load and Parse Review Report

### 1.1 Locate the Report

If `$ARGUMENTS` includes a file path, use that report.

Otherwise, find the most recent review report:

```bash
ls -t reports/review-*.md reports/security-audit-*.md reports/design-review-*.md 2>/dev/null | head -5
```

If `--all` is passed in arguments, collect ALL recent reports (one of each type from the same date) and merge their findings.

### 1.2 Parse Report Metadata

Read the report's YAML front-matter to extract:
- `date` — when the review was run
- `scope` — what was reviewed
- `verdict` — the review outcome (if present)
- Issue counts by severity

### 1.3 Extract Structured Findings

Parse the report body for findings. Each review skill uses a consistent format:

**From `/review` reports:**
```
[CRITICAL|HIGH|MEDIUM|LOW] <file>:<line> — <description>
```

**From `/security-audit` reports:**
```
[CRITICAL|HIGH|MEDIUM|LOW] <OWASP Category>
File: <path>:<line>
Issue: <what's wrong>
Fix: <specific remediation>
```

**From `/design-review` reports:**
```
[HIGH|MEDIUM|LOW] <Category>
Location: <file(s) or module(s)>
Issue: <what's wrong>
Recommendation: <refactoring suggestion>
Effort: <small | medium | large>
```

For each finding, extract and normalize into a structured list:
- **ID:** FIX-001, FIX-002, etc. (assigned sequentially)
- **Source:** which report and finding number
- **Severity:** CRITICAL, HIGH, MEDIUM, LOW
- **File:** path and line number
- **Problem:** description of the issue
- **Suggested fix:** the remediation from the report
- **Category:** code-quality, security, design, performance, type-safety, error-handling

### 1.4 Triage Findings

Classify each finding into fix categories:

| Category | Action | Criteria |
|----------|--------|----------|
| AUTO-FIX | Fix immediately | CRITICAL or HIGH severity with a clear, mechanical fix (missing null check, bare except, hardcoded secret, missing type hint, unsafe eval) |
| PROMPT-FIX | Fix with judgment | HIGH severity where the "right" fix has multiple valid approaches — present options to user |
| DEFER | Log for human | MEDIUM/LOW severity, or HIGH findings marked `Effort: large` in design reviews |
| SKIP | Cannot auto-fix | Findings that require architectural changes, new features, or external dependencies |

Print the triage summary:
```
Review Fix — Triage Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━
Source: reports/review-latest-diff-2026-02-15.md
Findings: 12 total

AUTO-FIX (8):
  FIX-001 [CRITICAL] src/auth/service.py:42 — Missing super().__init__() call
  FIX-002 [CRITICAL] src/api/handler.py:18 — bare except catches SystemExit
  FIX-003 [HIGH]     src/models/user.py:55 — Mutable default argument
  ...

PROMPT-FIX (1):
  FIX-009 [HIGH]     src/cache/store.py:30 — Unbounded dict growth (multiple fix strategies)

DEFER (2):
  FIX-010 [MEDIUM]   src/utils/helpers.py:12 — Could extract to utility function
  FIX-011 [LOW]      src/config.py:8 — Magic number should be named constant

SKIP (1):
  FIX-012 [HIGH]     src/metrics/ — AgentMetrics is a stub (requires new feature spec)

Proceed with AUTO-FIX? (8 fixes across 6 files)
```

If `--dry-run` is passed, stop here and print the triage summary only.

---

## Phase 2 — Apply Fixes

Process AUTO-FIX findings in dependency order: fixes in the same file are batched together to avoid conflicts.

### 2.1 Pre-Fix Baseline

Before making any changes, capture the baseline:

```bash
git stash list
git status
```

Run the test suite to establish the green baseline:

```bash
npm test          # or pytest, etc.
```

Record baseline test count and pass rate. If tests are already failing, log which tests fail BEFORE fixes — these are pre-existing failures and must not be attributed to the fix process.

### 2.2 Fix Execution — File Batches

Group findings by file. For each file batch:

#### Step A — Read Current State
Read the file in full. Understand the surrounding context of each finding location (at least 10 lines above and below).

#### Step B — Apply Fixes
For each finding in the file:

1. Read the suggested fix from the review report
2. Evaluate whether the suggested fix is correct and complete
3. If the suggestion is incomplete or incorrect, use your judgment to write a proper fix — but constrain it to the same scope (the finding, nothing more)
4. Apply the fix using the Edit tool
5. Add an inline comment ONLY if the fix is non-obvious: `# FIX-001: <brief reason>`

Common fix patterns:

| Finding Type | Fix Pattern |
|---|---|
| Missing `super().__init__()` | Add the call in `__init__` |
| Bare `except:` | Change to `except Exception:` or more specific |
| Mutable default argument | Change to `None` + conditional assignment |
| Missing null/None check | Add guard clause with appropriate return/raise |
| Hardcoded secret | Move to environment variable with `os.getenv()` |
| Missing type hint | Add type annotations from context |
| Unsafe `eval()`/`exec()` | Replace with safe alternative (ast.literal_eval, etc.) |
| SQL string concatenation | Convert to parameterized query |
| Missing input validation | Add validation with appropriate error response |
| Fail-open compliance check | Invert to fail-closed with explicit allowlist |
| Missing error handling | Add try/except with appropriate error type |
| Unbounded collection growth | Add size limit / eviction policy |

#### Step C — Verify File Batch

After fixing all findings in one file:

1. Run lint on the changed file:
```bash
# Python
ruff check <file> 2>/dev/null || flake8 <file> 2>/dev/null
# TypeScript
npx tsc --noEmit <file> 2>/dev/null
```

2. If lint introduces new errors, fix them immediately (attribute to the same FIX-NNN)

3. Run the test suite:
```bash
npm test          # or pytest, etc.
```

4. Compare results to baseline:
   - **All green → proceed** to next file batch
   - **New failures → diagnose:**
     - If the fix caused the regression → revert the entire file batch, mark all findings in it as BLOCKED with reason
     - If the failure is pre-existing → note it and proceed

#### Step D — Log Batch Result

Record the outcome for each finding:

```markdown
### FIX-001: Missing super().__init__() — FIXED
**Source:** review-latest-diff-2026-02-15.md, Finding #1
**Severity:** CRITICAL
**File:** src/auth/service.py:42
**Change:** Added `super().__init__()` call in AuthService.__init__
**Lines:** +1
**Tests:** 42 passing (no change), 0 regressions
```

### 2.3 Handle PROMPT-FIX Findings

For findings classified as PROMPT-FIX (multiple valid approaches):

1. Present the options to the user:
```
FIX-009 [HIGH] src/cache/store.py:30 — Unbounded dict growth

Option A: Add maxsize parameter with LRU eviction (simple, ~15 lines)
Option B: Add TTL-based expiry with background cleanup (robust, ~40 lines)
Option C: Defer — create a spec for a proper caching strategy

Which approach?
```

2. Wait for user input
3. Apply the chosen fix following the same Step A–D process

---

## Phase 3 — Verification Pass

After all AUTO-FIX and PROMPT-FIX findings are resolved:

### 3.1 Full Test Suite

```bash
npm test          # or pytest
```

All tests must pass. Compare against pre-fix baseline — the fix process must not increase the failure count.

### 3.2 Full Lint Pass

```bash
npm run lint 2>/dev/null || ruff check . 2>/dev/null || flake8 . 2>/dev/null
```

No new lint errors introduced.

### 3.3 Diff Review

```bash
git diff --stat
git diff
```

Review the complete diff to verify:
- Every change traces to a FIX-NNN
- No unrelated changes snuck in
- No files were accidentally modified outside the finding scope

### 3.4 Re-Run Review on Changed Files

Run the relevant review skill on the changed files to verify the findings are resolved:

```bash
git diff --name-only
```

Inform the user that a verification `/review` should be run on the changed files. Do NOT invoke `/review` directly — the user should trigger it as the next step to confirm the loop is closed.

---

## Phase 4 — Fix Traceability Report

Save to: `reports/review-fix-<scope>-<YYYY-MM-DD>.md`

### Report Template

```markdown
---
date: YYYY-MM-DD
scope: <scope from source report>
source_report: <path to source review report>
findings_total: N
findings_fixed: N
findings_deferred: N
findings_skipped: N
findings_blocked: N
tests_before: N passing
tests_after: N passing
regressions: 0
files_modified: N
lines_added: N
lines_removed: N
---

# Review Fix Report: <scope>

> **Source report:** [<report name>](path/to/source/report.md)
> **Date:** YYYY-MM-DD
> **Fixer:** Claude Code /review-fix

---

## Summary

<2-3 sentences: what was fixed, outcome, any blocked items>

## Fix Traceability

| Fix ID | Severity | File:Line | Problem | Resolution | Status |
|--------|----------|-----------|---------|------------|--------|
| FIX-001 | CRITICAL | src/auth/service.py:42 | Missing super().__init__() | Added call | FIXED |
| FIX-002 | CRITICAL | src/api/handler.py:18 | Bare except | Changed to except Exception | FIXED |
| FIX-003 | HIGH | src/models/user.py:55 | Mutable default | Changed to None + guard | FIXED |
| FIX-009 | HIGH | src/cache/store.py:30 | Unbounded growth | Added LRU eviction (user chose A) | FIXED |
| FIX-010 | MEDIUM | src/utils/helpers.py:12 | Extract utility | — | DEFERRED |
| FIX-012 | HIGH | src/metrics/ | Stub implementation | Requires new spec | SKIPPED |

## Detailed Fix Log

### FIXED

<per-finding completion records from Phase 2.2 Step D>

### DEFERRED (Human Decision Required)

| Fix ID | Severity | File | Problem | Why Deferred |
|--------|----------|------|---------|--------------|
| FIX-010 | MEDIUM | src/utils/helpers.py:12 | Could extract to utility | Low severity, not urgent |
| FIX-011 | LOW | src/config.py:8 | Magic number | Low severity, cosmetic |

### SKIPPED (Out of Scope)

| Fix ID | Severity | Location | Problem | Recommended Next Step |
|--------|----------|----------|---------|----------------------|
| FIX-012 | HIGH | src/metrics/ | AgentMetrics is a stub | /spec-gen for Prometheus integration |

### BLOCKED (Fix Failed)

<If any fixes were reverted due to test regressions, document here with full error details>

## Verification Results

| Check | Before Fix | After Fix | Delta |
|-------|-----------|-----------|-------|
| Tests passing | N | N | +0 |
| Tests failing | N | N | +0 |
| Lint errors | N | N | +0 |
| Files modified | — | N | — |
| Lines changed | — | +N / -M | — |

## Change Manifest

| File | Fix IDs Applied | Lines Changed |
|------|----------------|---------------|
| src/auth/service.py | FIX-001 | +1 |
| src/api/handler.py | FIX-002 | +1, -1 |
| src/models/user.py | FIX-003 | +3, -1 |

## Next Steps

1. Run `/review` on changed files to verify findings are resolved
2. Address DEFERRED findings if desired
3. Create specs for SKIPPED findings that need new features:
   - FIX-012: `/spec-gen 'Implement real Prometheus metrics to replace AgentMetrics stub'`
4. Commit fixes: `git add -A && git commit -m "fix: resolve review findings (FIX-001 through FIX-009)"`
```

---

## Phase 5 — Console Summary

Print a concise summary:

```
Review Fix Complete
━━━━━━━━━━━━━━━━━━
Source: reports/review-latest-diff-2026-02-15.md
Findings: 12 total

  FIXED:    8  (6 CRITICAL, 2 HIGH)
  DEFERRED: 2  (1 MEDIUM, 1 LOW)
  SKIPPED:  1  (requires new spec)
  BLOCKED:  1  (caused test regression — reverted)

Tests: 42 passing → 42 passing (0 regressions)
Lint:  0 new errors
Files: 6 modified (+18, -8 lines)

📄 reports/review-fix-latest-diff-2026-02-15.md

Next: /review <changed-files> → verify findings resolved
      /spec-gen for SKIPPED items that need new features
```

---

## Modes

- `/review-fix <report.md>` — Fix findings from a specific review report
- `/review-fix --all` — Collect and fix findings from all review reports of the most recent date
- `/review-fix <report.md> --severity HIGH` — Override: only fix findings at this severity and above
- `/review-fix <report.md> --dry-run` — Triage findings and print plan without making changes
- `/review-fix <report.md> FIX-003` — Fix a single specific finding only
- `/review-fix <report.md> --include-deferred` — Also fix MEDIUM and LOW findings (normally deferred)

## Error Recovery

If a fix batch fails (tests break after applying fixes to a file):

1. Revert ALL changes to that file (`git checkout -- <file>`)
2. Mark all findings in that file as BLOCKED with the test failure details
3. Continue with the next file batch — do not let one blocked file halt the entire process
4. Log the blocking error in detail so the user can fix manually
5. The full test suite must pass after revert before proceeding

Never leave the codebase in a broken state. The test suite must be green (or at the same baseline) at every checkpoint.

## Integration with the Pipeline

The review-fix skill sits in the pipeline loop:

```
/task-implementer → /review → /review-fix → /review (verify) → /spec-review → /pr-orchestrator
                              ↑_______________|
                              (loop until clean or only DEFERRED/SKIPPED remain)
```

For findings classified as SKIP (architectural issues, missing features), the output explicitly tells the user to start a new spec-driven cycle:

```
/review-fix identifies stub → user runs /spec-gen → /plan-gen → /task-gen → /task-implementer
```

This keeps the review-fix scope tight (quality fixes) while routing feature gaps back through the proper planning pipeline.
