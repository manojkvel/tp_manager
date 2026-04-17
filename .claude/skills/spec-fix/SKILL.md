---
name: spec-fix
description: Close spec compliance gaps by implementing missing acceptance criteria, resolving scope creep, enforcing business rules, and adding missing tests — producing a traceability report mapping each gap to its resolution
argument-hint: "path/to/specs/<NNN>-<slug>/spec-review.md [--dry-run] [--scope-creep-only] [--ac AC-3]"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(git diff, git log, git status, git add, git stash, ls, find, tree, npm test, npx vitest, npx jest, pytest, npm run lint, flake8, ruff, mypy, tsc, date)
---

# Spec Compliance Fix

Consume a `/spec-review` compliance report and close the gaps: implement missing acceptance criteria, resolve scope creep decisions, enforce unenforced business rules, handle uncovered edge cases, and add missing test coverage. Produce a traceability report mapping every gap to its resolution.

This closes the compliance loop in the spec-driven pipeline: **Spec → Plan → Tasks → Implement → Review → Review-Fix → Spec-Review → Spec-Fix → Spec-Review (verify) → PR**.

## CRITICAL RULES

1. **Always start from a spec-review report.** Never guess at compliance gaps. If no report path is given, search `specs/` for the most recent `spec-review.md`.
2. **The spec is the source of truth.** Every fix must bring the implementation closer to the spec — never change the spec to match the code without explicit user approval.
3. **Scope discipline is absolute.** Fixes must address exactly the gap identified. No refactoring, no bonus features, no "while I'm here" improvements.
4. **Test every fix.** New implementations must have test coverage. Existing tests must not break.
5. **Never modify the spec-review report.** The report is the source of truth for gaps. This skill reads it; it never writes to it.
6. **Traceability is mandatory.** Every change must trace to a gap ID (GAP-NNN). Untraced changes are not permitted.

---

## Phase 1 — Load and Parse Spec-Review Report

### 1.1 Locate the Report

If `$ARGUMENTS` includes a file path, use that report.

Otherwise, find the most recent spec-review report:

```bash
ls -t specs/*/spec-review.md 2>/dev/null | head -5
```

### 1.2 Load the Source Spec

Read the original spec referenced in the spec-review report header. Extract:
- All acceptance criteria (AC-1, AC-2, ...)
- All business rules (BR-1, BR-2, ...)
- All edge cases
- All constraints (security, performance, compliance)
- Non-goals

This is the source of truth for what the implementation should do.

### 1.3 Load the Plan and Tasks (if they exist)

Check the same directory for `plan.md` and `tasks.md`. If they exist, extract:
- Architecture decisions that inform how fixes should be implemented
- File change summary to understand the project structure
- Task IDs that map to ACs (useful for traceability)

### 1.4 Extract Compliance Gaps

Parse the spec-review report for all non-compliant items. The report uses structured tables:

**From Acceptance Criteria Verification:**
```
| AC | Description | Code | Test | Status |
| AC-1 | <desc> | IMPLEMENTED | TESTED | ✓ |
| AC-2 | <desc> | PARTIALLY | NOT TESTED | Gap |
| AC-3 | <desc> | NOT IMPLEMENTED | NOT TESTED | Gap |
| AC-4 | <desc> | DIFFERENTLY IMPLEMENTED | TESTED | Deviation |
```

**From Business Rules Verification:**
```
| BR | Rule | Enforced In | Matches Spec? | Tested? |
| BR-1 | <rule> | src/validator.ts:23 | YES | YES |
| BR-2 | <rule> | NOT FOUND | — | — |
```

**From Edge Cases Verification:**
```
| # | Scenario | Handled? | Matches Spec? | Tested? |
| 1 | <scenario> | NO | — | NO |
```

**From Constraint Verification:**
```
| Constraint | Verified? | Evidence |
| <constraint> | NO | — |
```

**From Scope Creep Detection:**
```
| # | Description | Files | Severity | Recommendation |
| 1 | <what was added beyond spec> | <files> | MED | Keep / Remove / Add to spec |
```

**From Spec Update Recommendations:**
```
| Section | Current Spec Says | Code Actually Does | Recommended Update |
```

For each gap, extract and normalize into a structured list:
- **ID:** GAP-001, GAP-002, etc.
- **Type:** AC-GAP, BR-GAP, EDGE-GAP, CONSTRAINT-GAP, SCOPE-CREEP, SPEC-DRIFT
- **Source:** which AC/BR/edge case/constraint
- **Severity:** derived from the compliance impact
- **Current state:** what exists now (PARTIAL, NOT IMPLEMENTED, DIFFERENTLY IMPLEMENTED)
- **Required state:** what the spec says should exist
- **Files involved:** from the report evidence

### 1.5 Triage Gaps

Classify each gap into fix categories:

| Category | Action | Criteria |
|----------|--------|----------|
| AUTO-FIX | Implement now | Missing edge case handling, unenforced business rule, missing input validation, missing test for existing code, constraint not met (small scope) |
| IMPLEMENT | Implement with care | AC partially implemented — complete the missing parts. Requires reading existing code, understanding the partial implementation, and extending it |
| PROMPT | Needs human decision | Scope creep (remove code or update spec?), AC differently implemented (keep deviation or rewrite?), spec update recommendations |
| SKIP | Too large for this skill | AC not implemented at all (0% done) — this is a full task, not a fix. Route back to `/task-gen` |
| TEST-ONLY | Add missing test | Code is IMPLEMENTED but NOT TESTED — generate test coverage |

Print the triage summary:
```
Spec Fix — Triage Summary
━━━━━━━━━━━━━━━━━━━━━━━━
Source: specs/047-sso-login/spec-review.md
Verdict: MOSTLY COMPLIANT (82%)
Gaps: 11 total

AUTO-FIX (3):
  GAP-001 [BR-GAP]        BR-2 not enforced — add validation in src/auth/handler.ts
  GAP-002 [EDGE-GAP]      Edge case #3 not handled — timeout without user error page
  GAP-003 [CONSTRAINT-GAP] Rate limiting not applied to /auth/login endpoint

IMPLEMENT (2):
  GAP-004 [AC-GAP]        AC-4 partially implemented — timeout caught but no error page
  GAP-005 [AC-GAP]        AC-6 partially implemented — happy path works, error path missing

PROMPT (3):
  GAP-006 [SCOPE-CREEP]   "Remember my IdP" cookie added but not in spec
  GAP-007 [SCOPE-CREEP]   Admin dashboard endpoint /admin/sso-config not in spec
  GAP-008 [SPEC-DRIFT]    AC-2 implemented differently — uses session cookie instead of JWT

TEST-ONLY (2):
  GAP-009 [AC-GAP]        AC-1 implemented but only 2 of 5 test scenarios covered
  GAP-010 [AC-GAP]        AC-3 implemented but zero test coverage

SKIP (1):
  GAP-011 [AC-GAP]        AC-7 not implemented at all — needs full task cycle

Proceed? (7 auto-fixable, 3 need your input, 1 skipped)
```

If `--dry-run` is passed, stop here and print the triage summary only.
If `--ac AC-3` is passed, filter to only gaps related to that specific AC.
If `--scope-creep-only` is passed, show only SCOPE-CREEP and SPEC-DRIFT gaps for human decision.

---

## Phase 2 — Resolve PROMPT Gaps (Human Decisions)

Before implementing anything, resolve all gaps that require human decisions. This avoids wasted work.

### 2.1 Scope Creep Decisions

For each SCOPE-CREEP gap, present the options:

```
GAP-006 [SCOPE-CREEP] "Remember my IdP" cookie
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Files: src/auth/sso-handler.ts:87-104, src/auth/cookie-utils.ts (new file)
Lines added: +42

This functionality is NOT in the spec. Options:

  A) REMOVE — Delete the cookie code. Implementation returns to spec compliance.
  B) KEEP + UPDATE SPEC — Keep the code and I will add an AC to the spec
     documenting this behavior (you must review the spec update).
  C) DEFER — Leave as-is for now. Flag in the report as known scope creep.

Which approach for GAP-006?
```

Wait for user input on each SCOPE-CREEP gap.

### 2.2 Spec Drift Decisions

For each SPEC-DRIFT gap:

```
GAP-008 [SPEC-DRIFT] AC-2: Session cookie vs JWT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Spec says: "User receives a JWT token valid for 24 hours"
Code does: "User receives a session cookie managed by express-session"

  A) REWRITE — Change implementation to use JWT as spec'd
  B) UPDATE SPEC — Keep session cookie, update AC-2 to reflect this
  C) DEFER — Leave as-is, flag as known deviation

Which approach for GAP-008?
```

### 2.3 Record Decisions

Store each decision for the traceability report:
```
GAP-006: User chose B (KEEP + UPDATE SPEC)
GAP-007: User chose A (REMOVE)
GAP-008: User chose B (UPDATE SPEC)
```

---

## Phase 3 — Pre-Fix Baseline

Before making any code changes:

### 3.1 Capture Test Baseline

```bash
npm test 2>&1 | tail -5    # or pytest
```

Record: total tests, passing, failing, skipped. Any pre-existing failures are not attributed to spec-fix.

### 3.2 Capture Compliance Baseline

From the spec-review report header:
- Compliance score: X%
- ACs verified: X/Y
- BRs enforced: X/Y
- Edge cases handled: X/Y

---

## Phase 4 — Apply Fixes

Process gaps in this order: TEST-ONLY → AUTO-FIX → IMPLEMENT → PROMPT decisions (REMOVE/REWRITE). This order minimizes risk — tests first, then simple fixes, then complex implementations, then removals.

### 4.1 TEST-ONLY Gaps

For each gap where code exists but tests are missing:

1. Read the existing implementation code
2. Read the AC/BR it satisfies from the spec
3. Generate tests following the project's test patterns:
   - Happy path
   - Error/edge cases described in the spec
   - Boundary values from constraints
4. Run the tests — they should PASS against existing code
5. If any tests FAIL, the implementation has a bug. Log it as a bonus finding.

### 4.2 AUTO-FIX Gaps

For each gap classified as AUTO-FIX:

#### Step A — Understand Context
Read the relevant source files. Understand the existing implementation patterns:
- How are other business rules enforced? (validation middleware? inline checks?)
- How are other edge cases handled? (try/catch? guard clauses? error boundaries?)
- How are constraints implemented? (middleware? decorators? config?)

#### Step B — Implement the Fix
Follow the existing patterns. For each gap type:

| Gap Type | Implementation Pattern |
|----------|----------------------|
| BR not enforced | Add validation in the same layer as other BRs (validator, middleware, service) |
| Edge case not handled | Add guard clause or try/catch following existing error handling patterns |
| Constraint not met | Add middleware/decorator/config following existing constraint patterns |
| Missing input validation | Add validation at the API boundary, matching existing validation style |

#### Step C — Write Tests
For every fix, write at least one test proving the gap is closed:
- BR enforcement: test that invalid input is rejected
- Edge case: test the specific scenario from the spec
- Constraint: test the constraint is enforced (e.g., rate limit returns 429)

#### Step D — Verify
After each file batch:

```bash
npm test    # or pytest
```

Compare to baseline. If new failures appear:
- If the fix caused it → revert, mark as BLOCKED
- If pre-existing → note and proceed

### 4.3 IMPLEMENT Gaps

For AC-GAP items that are partially implemented:

1. Read the spec's AC description carefully — understand the full requirement
2. Read the existing partial implementation — understand what's already done
3. Identify exactly what's missing (the delta between current and required)
4. Implement only the delta:
   - If the AC says "show a user-friendly error page on timeout" and the code catches the timeout but returns a generic 500, add the error page rendering
   - If the AC says "send email notification on status change" and the code changes status but doesn't send email, add the email notification
5. Write tests for the new behavior
6. Run full test suite — verify no regressions

For each IMPLEMENT gap, log the implementation approach:
```
GAP-004: AC-4 partially implemented
  Existing: timeout caught in src/auth/sso-handler.ts:67, returns generic error
  Missing: user-friendly error page with retry option
  Fix: Added error page template, updated handler to render it on timeout
  Files: src/auth/sso-handler.ts (+8), src/templates/sso-error.html (new, +32)
  Tests: test/auth/sso-timeout.test.ts (new, +24) — 3 tests passing
```

### 4.4 PROMPT Decision Execution

For gaps where the user chose an action in Phase 2:

**REMOVE (scope creep):**
1. Identify all files/lines that implement the scope-creep feature
2. Remove the code carefully — check for dependencies from other code
3. Run tests — remove any tests that only test the removed feature
4. Verify the removal doesn't break anything

**REWRITE (spec drift):**
1. Read the spec requirement carefully
2. Read the current (deviating) implementation
3. Rewrite to match the spec
4. Update tests to match the new implementation
5. Run full test suite

**UPDATE SPEC:**
1. Read the current spec file
2. Add or modify the relevant AC/BR to document the deviation
3. Add a note: `Updated by /spec-fix on <date> — implementation uses <X> instead of <Y>`
4. This is the ONE case where we modify the spec — and only with explicit user approval from Phase 2

**DEFER:**
Log as DEFERRED in the traceability report. No code changes.

---

## Phase 5 — Verification

### 5.1 Full Test Suite

```bash
npm test    # or pytest
```

All tests must pass. Compare to Phase 3 baseline — the fix process must not decrease the pass count.

### 5.2 Lint Pass

```bash
npm run lint 2>/dev/null || ruff check . 2>/dev/null
```

No new lint errors.

### 5.3 Diff Review

```bash
git diff --stat
git diff
```

Verify every change traces to a GAP-NNN. No unrelated modifications.

### 5.4 Compliance Delta

Estimate the new compliance score based on gaps resolved:
- Each resolved AC-GAP increases the AC compliance percentage
- Each resolved BR-GAP increases the BR compliance percentage
- Each resolved EDGE-GAP increases the edge case percentage

Print the projected delta:
```
Compliance Delta (projected)
━━━━━━━━━━━━━━━━━━━━━━━━━━━
ACs verified:    4/7 → 6/7  (+2)
BRs enforced:    2/3 → 3/3  (+1)
Edge cases:      3/5 → 4/5  (+1)
Constraints:     2/3 → 3/3  (+1)
Compliance:      82% → 95%  (+13%)

Remaining gaps: 1 SKIPPED (AC-7), 1 DEFERRED (GAP-006)
```

Inform the user that a verification `/spec-review` should be run to confirm the actual compliance improvement.

---

## Phase 6 — Spec Fix Traceability Report

Save to: `specs/<NNN>-<feature-slug>/spec-fix-<YYYY-MM-DD>.md`

### Report Template

```markdown
---
date: YYYY-MM-DD
spec: path/to/spec.md
spec_review: path/to/spec-review.md
compliance_before: N%
compliance_after_projected: N%
gaps_total: N
gaps_fixed: N
gaps_deferred: N
gaps_skipped: N
gaps_blocked: N
scope_creep_removed: N
scope_creep_kept: N
spec_updates: N
tests_added: N
files_created: N
files_modified: N
---

# Spec Fix Report: <Feature Title>

> **Spec:** [<Spec ID>](spec.md)
> **Spec Review:** [Compliance Report](spec-review.md)
> **Date:** YYYY-MM-DD
> **Fixer:** Claude Code /spec-fix

---

## Summary

<2-3 sentences: what was fixed, compliance improvement, any items remaining>

## Gap Traceability

| Gap ID | Type | Source | Problem | Resolution | Status |
|--------|------|--------|---------|------------|--------|
| GAP-001 | BR-GAP | BR-2 | Not enforced | Added validation in handler | FIXED |
| GAP-002 | EDGE-GAP | Edge #3 | Not handled | Added timeout error page | FIXED |
| GAP-004 | AC-GAP | AC-4 | Partial — no error page | Implemented error rendering | FIXED |
| GAP-006 | SCOPE-CREEP | — | Cookie not in spec | User chose: keep + update spec | KEPT |
| GAP-007 | SCOPE-CREEP | — | Admin endpoint not in spec | User chose: remove | REMOVED |
| GAP-008 | SPEC-DRIFT | AC-2 | Session cookie vs JWT | User chose: update spec | SPEC UPDATED |
| GAP-011 | AC-GAP | AC-7 | Not implemented | Too large — needs /task-gen | SKIPPED |

## Detailed Fix Log

### FIXED

<per-gap implementation details from Phase 4>

### SCOPE CREEP RESOLVED

| Gap ID | Description | Decision | Action Taken |
|--------|-------------|----------|-------------|
| GAP-006 | Remember-my-IdP cookie | KEEP + UPDATE SPEC | Added AC-8 to spec |
| GAP-007 | Admin SSO config endpoint | REMOVE | Deleted 3 files, -89 lines |

### SPEC UPDATES

| Gap ID | Section Modified | Change |
|--------|-----------------|--------|
| GAP-006 | Acceptance Criteria | Added AC-8: "User can opt to remember IdP selection" |
| GAP-008 | AC-2 | Changed "JWT token" to "session cookie" |

### TESTS ADDED

| Gap ID | Test File | Tests | Status |
|--------|-----------|-------|--------|
| GAP-001 | test/auth/validation.test.ts | 2 | PASSING |
| GAP-002 | test/auth/sso-timeout.test.ts | 3 | PASSING |
| GAP-009 | test/auth/login.test.ts | 3 (added to existing) | PASSING |
| GAP-010 | test/auth/token.test.ts | 4 (new) | PASSING |

### SKIPPED (Needs Full Task Cycle)

| Gap ID | Source | Problem | Recommended Next Step |
|--------|--------|---------|----------------------|
| GAP-011 | AC-7 | Not implemented at all | /task-gen from spec with AC-7 focus |

### BLOCKED (Fix Failed)

<If any fixes caused regressions and were reverted>

## Compliance Delta

| Metric | Before | After (Projected) | Delta |
|--------|--------|-------------------|-------|
| ACs verified | 4/7 | 6/7 | +2 |
| BRs enforced | 2/3 | 3/3 | +1 |
| Edge cases handled | 3/5 | 4/5 | +1 |
| Constraints met | 2/3 | 3/3 | +1 |
| Overall compliance | 82% | 95% | +13% |
| Scope creep items | 2 | 0 | -2 (1 removed, 1 spec'd) |

## Verification Results

| Check | Before Fix | After Fix | Delta |
|-------|-----------|-----------|-------|
| Tests passing | N | N+M | +M |
| Tests failing | N | N | 0 |
| Lint errors | N | N | 0 |
| Files created | — | N | — |
| Files modified | — | N | — |

## Change Manifest

| File | Gap IDs | Action | Lines Changed |
|------|---------|--------|---------------|
| src/auth/handler.ts | GAP-001, GAP-004 | MODIFIED | +18, -2 |
| src/templates/sso-error.html | GAP-002 | CREATED | +32 |
| src/admin/sso-config.ts | GAP-007 | DELETED | -45 |
| specs/047-sso-login/spec.md | GAP-006, GAP-008 | MODIFIED | +8, -2 |

## Next Steps

1. Run `/spec-review` on the updated implementation to verify compliance improvement
2. Address SKIPPED gaps if needed:
   - GAP-011: `/task-gen` from spec with focus on AC-7
3. Review spec updates (GAP-006, GAP-008) for accuracy
4. Commit: `git add -A && git commit -m "fix: close spec compliance gaps (GAP-001 through GAP-010)"`
```

---

## Phase 7 — Console Summary

```
Spec Fix Complete
━━━━━━━━━━━━━━━━━
Source: specs/047-sso-login/spec-review.md
Gaps: 11 total

  FIXED:      5  (2 AC, 1 BR, 1 edge case, 1 constraint)
  TEST-ONLY:  2  (added 7 tests for existing code)
  REMOVED:    1  (scope creep — admin endpoint deleted)
  SPEC UPDATED: 2  (AC-8 added, AC-2 revised)
  DEFERRED:   0
  SKIPPED:    1  (AC-7 — needs full /task-gen cycle)

Compliance: 82% → 95% (projected, +13%)
Tests: 42 → 54 (+12 new), 0 regressions
Files: 3 created, 4 modified, 1 deleted

📄 specs/047-sso-login/spec-fix-2026-02-15.md

Next: /spec-review specs/047-sso-login/spec.md → verify compliance
      /task-gen for SKIPPED items (AC-7)
```

---

## Modes

- `/spec-fix <spec-review.md>` — Fix all gaps from a specific spec-review report
- `/spec-fix <spec-review.md> --dry-run` — Triage gaps and print plan without making changes
- `/spec-fix <spec-review.md> --ac AC-4` — Fix gaps related to a specific acceptance criterion only
- `/spec-fix <spec-review.md> --scope-creep-only` — Only handle scope creep decisions (no code fixes)
- `/spec-fix <spec-review.md> --no-spec-updates` — Fix code gaps but never modify the spec file
- `/spec-fix <spec-review.md> --test-only` — Only add missing test coverage, no implementation fixes

## Error Recovery

If a fix fails (tests break):
1. Revert ALL changes for that gap (`git checkout -- <files>`)
2. Mark as BLOCKED with full error details
3. Continue with next gap — do not let one blocked gap halt the process
4. The test suite must pass after revert before proceeding

Never leave the codebase in a broken state. Tests must be green (or at baseline) at every checkpoint.

## Relationship to Other Skills

```
/spec-review finds the gaps
     │
     ▼
/spec-fix closes the gaps
     │
     ├── Code quality issues found during fix? → /review-fix
     ├── AC not implemented at all? → /task-gen → /task-implementer
     ├── Scope creep removed, spec updated? → /spec-review (verify)
     └── All gaps closed? → /pr-orchestrator → merge
```

The key distinction from `/review-fix`:
- `/review-fix` = code quality bugs (mechanical: null checks, bare excepts, type hints)
- `/spec-fix` = spec compliance gaps (functional: missing features, business rules, edge cases)

Both produce traceability reports. Both run tests. But `/spec-fix` implements new behavior while `/review-fix` fixes existing behavior.
