---
name: task-implementer
description: Implement agent-ready tasks from a task breakdown — writing code, tests, and producing a traceability report that maps every change back to its task and acceptance criterion
argument-hint: "path/to/tasks.md"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(git diff, git log, git status, git add, git stash, ls, find, tree, npm test, npx vitest, npx jest, pytest, make, date)
---

# Task Implementer

Execute agent-ready tasks from a `/task-gen` task breakdown, writing production code and tests while maintaining full traceability from every line changed back to its originating task, acceptance criterion, and spec requirement.

This is Phase 4 of the spec-driven pipeline: **Spec → Plan → Tasks → Implement → Review**.

## CRITICAL RULES

1. **Always start from a tasks.md file.** Never implement from a spec or plan directly. If no task file exists, tell the user to run `/task-gen` first.
2. **Only implement tasks tagged `Agent-ready: YES`.** Tasks tagged `PARTIAL` require human review of the ambiguous step before proceeding — flag them. Tasks tagged `NO` are skipped entirely and logged.
3. **Follow the task order.** Respect the dependency graph. Never implement a task before its dependencies are complete.
4. **TDD is mandatory.** For every IMPLEMENT task, the corresponding TEST task must pass before moving on. If a TEST task is missing, create the tests first.
5. **Do not modify tasks.md or spec** unless instructed by the user. These are source-of-truth documents. Implementation reads them; it does not write to them.
6. **Traceability is non-negotiable.** Every file touched must trace back to a TASK-NNN. Every TASK-NNN must trace to an AC-N. Untraced changes are bugs.

---

## Phase 1 — Load Context

### 1.1 Read the Task File

Read the task file provided as argument. Extract:
- All tasks with their IDs (TASK-001, TASK-002, etc.)
- Task types (TEST, IMPLEMENT, MIGRATE, INTEGRATE, CONFIGURE, DOCUMENT)
- Dependency ordering (the dependency graph)
- Agent-readiness tags (YES, PARTIAL, NO)
- Files to touch per task
- Definitions of Done per task
- The Traceability Matrix (which ACs each task covers)

### 1.2 Read the Spec and Plan

Follow the links in the task file header to read:
- **Spec:** Extract all acceptance criteria (AC-1, AC-2, ...) and business rules (BR-1, BR-2, ...)
- **Plan:** Extract architecture decisions, phase structure, and file change summary

### 1.3 Understand the Codebase

```
Glob: CLAUDE.md
```
Read project conventions.

Scan current state:
```bash
git status
git log --oneline -5
```

For each file listed in task "Files to touch":
- If action is MODIFY: Read the file to understand current state
- If action is CREATE: Read the parent directory to understand naming conventions

### 1.4 Build the Execution Plan

From the dependency graph, compute the execution order:
1. Topological sort of all agent-ready tasks
2. Group tasks into waves (tasks within a wave have no inter-dependencies)
3. Identify the critical path

Print the execution plan:
```
Execution Plan
━━━━━━━━━━━━━━
Wave 1: TASK-001 (TEST), TASK-005 (CONFIGURE)
Wave 2: TASK-002 (IMPLEMENT) — depends on TASK-001
Wave 3: TASK-003 (MIGRATE) — depends on TASK-002
Wave 4: TASK-004 (TEST), TASK-006 (TEST)
Wave 5: TASK-007 (IMPLEMENT) — depends on TASK-004, TASK-006

Skipped (Agent-ready: NO):  TASK-010, TASK-012
Flagged (Agent-ready: PARTIAL): TASK-008

Total: 7 to implement, 2 skipped, 1 flagged
```

---

## Phase 2 — Implement Tasks

Process tasks in dependency order, one at a time. For each task:

### 2.1 Pre-Implementation Checklist

Before writing any code for TASK-NNN:
- [ ] All dependency tasks are complete and their tests pass
- [ ] The task's "Files to touch" are all accessible
- [ ] The acceptance criteria this task traces to are understood
- [ ] The Definition of Done conditions are clear

### 2.2 Implementation by Task Type

#### TEST Tasks

1. Read the corresponding IMPLEMENT task to understand what will be built
2. Write test file(s) following project conventions (pytest / Vitest / Jest)
3. Structure tests using Arrange-Act-Assert
4. Cover: happy path, edge cases, error paths, boundary values
5. Run the tests — they should FAIL (red phase of TDD) since implementation doesn't exist yet
6. Log: test file path, test count, all currently failing (expected)

#### IMPLEMENT Tasks

1. Verify the corresponding TEST task is complete (tests exist and fail as expected)
2. Read the task description, steps, and files to touch
3. Write the minimal production code to make all tests pass
4. Follow existing codebase patterns (naming, structure, error handling)
5. Run the test suite:
   - Task-specific tests must pass (green phase)
   - All existing tests must still pass (no regressions)
6. Run linting if configured (`npm run lint`, `flake8`, `ruff`, etc.)
7. Log: files created/modified, lines changed, tests passing

#### MIGRATE Tasks

1. Create migration file following project conventions
2. If a local database exists, run the migration
3. Verify rollback works (if reversible migration)
4. Log: migration file path, tables/columns affected

#### INTEGRATE Tasks

1. Wire components together as described in the task
2. Write integration tests if not covered by existing test tasks
3. Run the full test suite to verify integration
4. Log: integration points, test results

#### CONFIGURE Tasks

1. Update configuration files as specified
2. Verify the configuration is valid (lint, dry-run if applicable)
3. Log: config files changed, settings modified

#### DOCUMENT Tasks

1. Update documentation as specified
2. Verify links are valid, code examples compile
3. Log: doc files updated, sections added/modified

### 2.3 Per-Task Completion

After each task, immediately record in the traceability log:

```markdown
### TASK-NNN: <title> — DONE

**Type:** <type>
**Traces to:** AC-<N>, BR-<N>
**Status:** COMPLETE | PARTIAL | BLOCKED

**Changes made:**
| File | Action | Lines | Description |
|------|--------|-------|-------------|
| src/auth/service.ts | CREATED | +85 | Auth service with JWT validation |
| tests/auth/service.test.ts | CREATED | +120 | 8 tests: happy path, expiry, invalid token... |

**Tests:**
- 8 written, 8 passing, 0 failing
- Existing suite: 142 passing, 0 failing (no regressions)

**Definition of Done:**
- [x] JWT tokens are validated on every protected route
- [x] Expired tokens return 401 with clear error message
- [x] All existing tests still pass
- [x] No linting errors introduced

**Duration:** ~12 minutes
```

---

## Phase 3 — Continuous Validation

After completing each wave of tasks, run a validation checkpoint:

### 3.1 Test Suite Health

```bash
# Run full test suite
npm test          # or pytest, etc.
```

All tests must pass. If a newly implemented task broke an existing test:
1. Stop implementation
2. Diagnose the regression
3. Fix it (attributing the fix to the task that caused it)
4. Re-run the full suite
5. Only proceed when green

### 3.2 Lint & Type Check

```bash
# Run whatever the project uses
npm run lint      # or flake8, ruff, mypy, tsc --noEmit
```

Fix any issues before proceeding to the next wave.

### 3.3 Incremental Git Checkpoint

After each wave, create a checkpoint (if the user has opted in to commits):
```bash
git add -A
git stash  # or commit — depending on user preference
```

This allows rollback to the last known-good state if a later wave fails.

---

## Phase 4 — Traceability Report

After all agent-ready tasks are implemented (or when blocked), generate the implementation report.

Save to: `reports/task-implementer-<scope>-<YYYY-MM-DD>.md`

### Report Template

```markdown
---
date: YYYY-MM-DD
scope: <feature-slug>
spec: <spec path>
tasks_total: N
tasks_implemented: N
tasks_skipped: N
tasks_flagged: N
tests_written: N
tests_passing: N
files_created: N
files_modified: N
lines_added: N
lines_removed: N
ac_coverage_pct: N
duration_minutes: N
---

# Implementation Report: <Feature Title>

> **Spec:** [<Spec ID> - <Title>](path/to/spec.md)
> **Plan:** [Implementation Plan](path/to/plan.md)
> **Tasks:** [Task Breakdown](path/to/tasks.md)
> **Date:** YYYY-MM-DD
> **Implementer:** Claude Code /task-implementer

---

## Executive Summary

<2-3 sentences: what was implemented, how many tasks completed, overall status>

## Traceability Matrix

Every acceptance criterion from the spec, mapped to implementing tasks, test tasks, and current status:

| AC | Description | Implementing Task(s) | Test Task(s) | Code Files | Status |
|----|-------------|---------------------|-------------|------------|--------|
| AC-1 | <from spec> | TASK-002, TASK-003 | TASK-001 | src/auth/service.ts | DONE |
| AC-2 | <from spec> | TASK-005 | TASK-004 | src/api/routes.ts | DONE |
| AC-3 | <from spec> | TASK-007 | TASK-006 | src/ui/login.tsx | DONE |
| AC-4 | <from spec> | TASK-010 | TASK-009 | — | SKIPPED (Agent-ready: NO) |

**Coverage:** X/Y ACs fully implemented (Z%)

## Task Execution Log

### Wave 1
<per-task completion records from Phase 2.3>

### Wave 2
<per-task completion records from Phase 2.3>

...

## Skipped Tasks

Tasks not implemented (require human intervention):

| Task | Title | Agent-ready | Reason |
|------|-------|-------------|--------|
| TASK-010 | Design login page layout | NO | Requires UX design decisions |
| TASK-008 | Configure OAuth providers | PARTIAL | API keys need manual entry |

## Change Summary

| Metric | Value |
|--------|-------|
| Tasks implemented | X / Y |
| Tests written | N |
| Tests passing | N / N |
| Files created | N |
| Files modified | N |
| Lines added | +N |
| Lines removed | -N |
| Regressions introduced | 0 |
| Lint errors introduced | 0 |

## File Manifest

Every file touched, with traceability:

| File | Action | Task | AC | Lines Changed |
|------|--------|------|----|---------------|
| src/auth/service.ts | CREATED | TASK-002 | AC-1 | +85 |
| src/auth/middleware.ts | MODIFIED | TASK-003 | AC-1 | +12, -3 |
| tests/auth/service.test.ts | CREATED | TASK-001 | AC-1 | +120 |
| src/api/routes.ts | MODIFIED | TASK-005 | AC-2 | +45, -0 |

## Dependency Verification

Confirm all dependency chains were respected:

| Task | Depends On | Dependency Status at Start | Result |
|------|------------|---------------------------|--------|
| TASK-002 | TASK-001 | COMPLETE (8/8 tests failing as expected) | OK |
| TASK-005 | TASK-002, TASK-003 | COMPLETE (all tests green) | OK |

## Next Steps

1. **Human review needed:** <list tasks marked PARTIAL or NO>
2. **Run `/review`** on the implemented changes for code quality review
3. **Run `/spec-review`** to verify implementation matches spec
4. **PR ready:** <YES/NO — all agent-ready tasks done and green>
```

---

## Phase 5 — Console Summary

Print a concise summary:

```
Implementation Complete — <Feature Title>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Tasks: 7/10 implemented (2 skipped, 1 flagged)
Tests: 42 written, 42 passing
Files: 8 created, 5 modified (+680, -23 lines)
ACs:   4/5 covered (80%) — AC-4 requires human task

Traceability: 100% — every change traces to a task and AC

⚠  1 flagged task: TASK-008 (PARTIAL) — OAuth config needs API keys
⏭  2 skipped tasks: TASK-010, TASK-012 — require human decisions

📄 reports/task-implementer-sso-login-2025-07-01.md
Next: /review → /spec-review → /pr-orchestrator
```

---

## Modes

- `/task-implementer <tasks.md>` — Full implementation of all agent-ready tasks
- `/task-implementer <tasks.md> TASK-003` — Implement a single specific task (and its unmet dependencies)
- `/task-implementer <tasks.md> --dry-run` — Show execution plan without implementing anything
- `/task-implementer <tasks.md> --wave 1` — Implement only the first wave of tasks
- `/task-implementer <tasks.md> --resume` — Resume from last checkpoint (reads existing report to find where it stopped)

## Error Recovery

If implementation fails mid-task:
1. Log the failure in the traceability report with the error details
2. Mark the task as BLOCKED with the reason
3. Skip downstream dependent tasks (mark as BLOCKED — dependency failed)
4. Continue with independent tasks in subsequent waves
5. Report all blocked tasks in the console summary

Never leave the codebase in a broken state. If a task partially completes:
- Revert the partial changes for that task
- Log what was attempted and why it failed
- The full test suite must still pass after revert
