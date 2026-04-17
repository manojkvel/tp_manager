---
name: spec-review
description: Validate that an implementation matches its original spec — flag drift, missing acceptance criteria, and undocumented behavior
argument-hint: "path/to/spec.md [path/to/implementation-branch-or-dir]"
allowed-tools: Read, Write, Grep, Glob, Bash(git log, git diff, git show, ls, find, tree, wc)
---

# Spec Compliance Review

Validate that the actual implementation matches the original specification. This is the closing-the-loop skill — it answers the question: **"Did we build what we said we'd build?"**

Run this after implementation is complete (or during PR review) to catch spec drift, missing acceptance criteria, undocumented behavior, and scope creep.

## CRITICAL RULES

1. **The spec is the source of truth.** If the code does something the spec doesn't describe, that's either scope creep or a missing spec update.
2. **Every acceptance criterion must be verified.** Not "looks like it works" — verified through code inspection or test evidence.
3. **Flag drift, don't judge.** Sometimes drift is intentional and correct (requirements changed during implementation). The goal is to surface it, not block it.

---

## Phase 1 — Load the Spec and Plan

### 1.1 Read the Spec

Read the spec file. Extract into a checklist:
- All acceptance criteria (AC-1, AC-2, ...)
- All business rules (BR-1, BR-2, ...)
- All edge cases
- All constraints (security, performance, compliance)
- Non-goals (to detect scope creep)
- Data requirements

### 1.2 Read the Plan (if exists)

```
Check same directory for plan.md and tasks.md
```

If a plan exists, extract:
- All file changes (CREATE/MODIFY) with their expected paths
- Architecture decisions
- The dependency graph

### 1.3 Determine Implementation Scope

If a branch or directory is specified, scope the review to those files. Otherwise, use the file change list from the plan.

If neither plan nor branch is provided, use git to find recent changes:

```bash
# Find the most recent feature branch or recent commits
git log --oneline -30
git diff --name-only main...HEAD 2>/dev/null || git diff --name-only HEAD~10..HEAD
```

---

## Phase 2 — Acceptance Criteria Verification

For EACH acceptance criterion from the spec:

### 2.1 Code Evidence

Find the code that implements this criterion:

```
Grep for domain-specific terms from the AC in the codebase
Read the relevant handler/service/model files
```

Classify:
- **IMPLEMENTED** — Code clearly satisfies this criterion
- **PARTIALLY IMPLEMENTED** — Some aspects are present, others are missing
- **NOT IMPLEMENTED** — No code found that addresses this criterion
- **DIFFERENTLY IMPLEMENTED** — Code addresses the intent but deviates from the spec

For PARTIALLY and DIFFERENTLY, note exactly what's different.

### 2.2 Test Evidence

For each AC, check if there's a test that validates it:

```
Grep for test descriptions matching the AC
Glob: **/*.test.*, **/*.spec.*, **/test_*.py
```

Classify:
- **TESTED** — Test exists and covers this criterion
- **PARTIALLY TESTED** — Test exists but doesn't cover all conditions
- **NOT TESTED** — No test found for this criterion

### 2.3 Build the AC Verification Table

| AC | Description | Code Status | Test Status | Evidence | Notes |
|----|-------------|-------------|-------------|----------|-------|
| AC-1 | <from spec> | IMPLEMENTED | TESTED | `src/service.ts:45` | |
| AC-2 | <from spec> | PARTIALLY | NOT TESTED | `src/handler.ts:12` | Missing error case |

---

## Phase 3 — Business Rule Verification

For each business rule from the spec:

1. Find where the rule is enforced in code
2. Verify it matches the spec exactly (values, conditions, edge cases)
3. Check if the rule is tested

| BR | Rule | Enforced In | Matches Spec? | Tested? | Notes |
|----|------|-------------|---------------|---------|-------|
| BR-1 | <rule> | `src/validator.ts:23` | YES | YES | |
| BR-2 | <rule> | NOT FOUND | — | — | Rule not enforced in code |

---

## Phase 4 — Edge Case Verification

For each edge case from the spec:

1. Find handling code
2. Check if behavior matches the spec's "Expected Behavior" column
3. Verify test coverage

| # | Scenario | Handled? | Matches Spec? | Tested? | Notes |
|---|----------|----------|---------------|---------|-------|
| 1 | <scenario> | YES | YES | YES | |
| 2 | <scenario> | NO | — | NO | Not implemented |

---

## Phase 5 — Constraint Verification

### 5.1 Security Constraints

For each security constraint in the spec:

```
Grep for auth middleware, permission checks, encryption,
input validation on the relevant endpoints
```

| Constraint | Verified? | Evidence | Notes |
|-----------|-----------|----------|-------|
| <constraint> | YES/NO | <file:line> | |

### 5.2 Performance Constraints

Check if performance-sensitive code has:
- Pagination for list endpoints
- Caching where specified
- Index hints for database queries
- Rate limiting where specified

### 5.3 Compliance Constraints

For each compliance requirement (GDPR, HIPAA, PCI-DSS, etc.):
- Is audit logging implemented?
- Is data encryption applied?
- Is data retention handled?

---

## Phase 6 — Scope Creep Detection

### 6.1 Undocumented Behavior

Find code changes that do things NOT described in the spec:

```bash
# Get all files changed in the implementation
git diff --name-only main...HEAD 2>/dev/null
```

For each changed file, read the diff and check:
- Does this change serve an acceptance criterion?
- Does this change serve a business rule?
- Does this change serve an edge case?

If a change doesn't trace to any spec item, it's either:
- **Scope creep** — Functionality not in the spec
- **Refactoring** — Code quality improvement (acceptable if it doesn't change behavior)
- **Infrastructure** — Necessary plumbing (config, imports, types)

Flag scope creep items for discussion.

### 6.2 Non-Goal Violation

Check if any implementation touches areas listed in the spec's "Non-Goals" section. This is the strongest signal of scope creep.

### 6.3 New Endpoints or Data

Check for:
- API endpoints not mentioned in the spec
- Database columns/tables not mentioned in the spec
- New environment variables not anticipated by the spec

---

## Phase 7 — Spec Drift Report

### 7.1 Generate the Report

Write the report to: `specs/<NNN>-<feature-slug>/spec-review.md`

```markdown
# Spec Compliance Review: <Feature Title>

> **Spec:** [<Spec ID>](spec.md)
> **Plan:** [Implementation Plan](plan.md)
> **Reviewed:** <date>
> **Verdict:** COMPLIANT | MOSTLY COMPLIANT | SIGNIFICANT DRIFT | NON-COMPLIANT

---

## Compliance Score: <X>%

Calculated as: (verified items / total items) across ACs, BRs, edge cases, and constraints.

## Summary

<3-5 sentence executive summary of findings>

## Acceptance Criteria: <X>/<Y> Verified (<Z>%)

| AC | Description | Code | Test | Status |
|----|-------------|------|------|--------|
<table from Phase 2>

### Missing Implementations
<list ACs not implemented, with impact assessment>

### Deviations
<list ACs implemented differently than spec'd, with explanation>

## Business Rules: <X>/<Y> Enforced (<Z>%)

<table from Phase 3>

## Edge Cases: <X>/<Y> Handled (<Z>%)

<table from Phase 4>

## Constraints: <X>/<Y> Met (<Z>%)

<tables from Phase 5>

## Scope Creep: <N> Items Found

| # | Description | Files | Severity | Recommendation |
|---|-------------|-------|----------|----------------|
| 1 | <what was added beyond spec> | <files> | LOW/MED/HIGH | Keep / Remove / Add to spec |

## Non-Goal Violations

<any areas where Non-Goals from the spec were violated>

## Spec Update Recommendations

If the implementation intentionally deviates from the spec, the spec should be updated to reflect reality:

| Section | Current Spec Says | Code Actually Does | Recommended Update |
|---------|------------------|-------------------|--------------------|
| <section> | <spec text> | <what code does> | <new spec text> |

## Verdict

**<VERDICT>**: <justification>

### Required Actions Before Merge
<items that must be fixed>

### Recommended Actions
<items that should be fixed but aren't blockers>

### Spec Updates Needed
<spec sections that should be updated to match intentional deviations>
```

### 7.2 Verdict Criteria

- **COMPLIANT** — All ACs implemented and tested, all BRs enforced, no scope creep, all constraints met
- **MOSTLY COMPLIANT** — >90% ACs verified, minor deviations documented, no critical gaps
- **SIGNIFICANT DRIFT** — 70-90% ACs verified, or critical ACs missing, or major scope creep
- **NON-COMPLIANT** — <70% ACs verified, or spec fundamentally not followed

---

## Output

1. **Primary:** `specs/<NNN>-<feature-slug>/spec-review.md` — The compliance report
2. **Console summary:** Verdict, compliance percentage, count of missing ACs, count of scope creep items
3. **Next action:**
   - If COMPLIANT: "Ready to merge. Consider updating spec with any minor deviations."
   - If MOSTLY COMPLIANT: "Review the <N> deviations before merging."
   - If SIGNIFICANT DRIFT: "Address <N> missing ACs and review <N> scope creep items before merging."
   - If NON-COMPLIANT: "Implementation does not match spec. Revisit the plan or update the spec."
