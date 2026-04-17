---
name: task-gen
description: Break an implementation plan into atomic, implementable tasks with acceptance criteria — ready for agents or engineers to pick up
argument-hint: "path/to/plan.md"
allowed-tools: Read, Write, Grep, Glob, Bash(git log, git shortlog, ls, find, tree)
---

# Task Breakdown Generator

Transform an approved implementation plan into a set of atomic, independently implementable tasks. Each task is small enough for a single engineer or AI agent to complete in one focused session, with clear acceptance criteria and no ambiguity about what "done" looks like.

This is Phase 3 of the spec-driven pipeline: **Spec → Plan → Tasks → Implement**.

## CRITICAL RULES

1. **Always start from a plan.** Never generate tasks from a spec directly. If no plan exists, tell the user to run `/plan-gen` first.
2. **Each task must be independently testable.** If you can't verify a task is done without completing another task first, the tasks are too tightly coupled — merge or restructure them.
3. **Tasks must be ordered.** Dependencies between tasks must be explicit.
4. **TDD is baked in.** Every implementation task starts with "write the test" as the first sub-step.

---

## Phase 1 — Load Context

### 1.1 Read the Plan

Read the plan file provided as argument. Extract:
- All phases and their goals
- All file changes (CREATE/MODIFY) per phase
- All tests defined per phase
- Acceptance criteria traceability
- Risks and mitigations
- Dependency ordering between phases

### 1.2 Read the Spec

Follow the link in the plan to read the original spec. Extract:
- Acceptance criteria (for traceability)
- Edge cases (each may become a task)
- Business rules (for test validation)

### 1.3 Understand Task Conventions

```
Glob: specs/*/tasks.md, .specify/specs/**/tasks.md
```

If existing task files exist, read them to maintain consistent format.

---

## Phase 2 — Generate Tasks

### 2.1 Task Decomposition Rules

For each phase in the plan, break it into tasks following these rules:

**Size constraint:** Each task should be completable in 1-4 hours (or <200 lines of code changed). If larger, split it.

**Atomicity constraint:** Each task should result in a working, testable increment. No task should leave the codebase in a broken state.

**Ordering rules:**
1. Tests before implementation (TDD)
2. Data layer before service layer
3. Service layer before API layer
4. API layer before UI layer
5. Happy path before edge cases
6. Core functionality before optimizations

**Task types:**
- **TEST** — Write tests (always comes first for each feature increment)
- **IMPLEMENT** — Write production code to make tests pass
- **MIGRATE** — Database schema changes
- **INTEGRATE** — Wire components together
- **CONFIGURE** — Environment, config, CI/CD changes
- **DOCUMENT** — Update docs, API specs, changelogs

### 2.2 Task Template

Each task follows this structure:

```markdown
### TASK-<NNN>: <concise title>

**Type:** TEST | IMPLEMENT | MIGRATE | INTEGRATE | CONFIGURE | DOCUMENT
**Phase:** <from plan>
**Traces to:** AC-<N>, BR-<N>
**Depends on:** TASK-<NNN> (or "None — can start immediately")
**Estimated effort:** <XS/S/M/L> (<30min / <1hr / <2hr / <4hr>)

**Description:**
<2-3 sentences: what to do and why>

**Steps:**
1. <concrete action>
2. <concrete action>
3. <concrete action>

**Files to touch:**
- `<file path>` — <what to do to this file>

**Definition of Done:**
- [ ] <testable condition 1>
- [ ] <testable condition 2>
- [ ] All existing tests still pass
- [ ] No linting errors introduced

**Notes:**
<any gotchas, edge cases, or references to the spec/plan>
```

---

## Phase 3 — Write the Task File

Create the task file at: `specs/<NNN>-<feature-slug>/tasks.md`

### Tasks File Template

```markdown
# Tasks: <Feature Title>

> **Spec:** [<Spec ID> - <Title>](spec.md)
> **Plan:** [Implementation Plan](plan.md)
> **Generated:** <date>
> **Total tasks:** <N>
> **Estimated total effort:** <sum of estimates>

---

## Task Dependency Graph

```mermaid
graph TD
    T1[TASK-001: Write data model tests] --> T2[TASK-002: Implement data model]
    T2 --> T3[TASK-003: Write migration]
    T3 --> T4[TASK-004: Write service tests]
    T4 --> T5[TASK-005: Implement service]
    T5 --> T6[TASK-006: Write API tests]
    T6 --> T7[TASK-007: Implement API endpoint]
    T5 --> T8[TASK-008: Write edge case tests]
    T8 --> T9[TASK-009: Handle edge cases]
    T7 --> T10[TASK-010: Integration test]
    T9 --> T10
    T10 --> T11[TASK-011: Documentation]
`` `

## Summary Table

| Task | Title | Type | Phase | Depends On | Effort | AC |
|------|-------|------|-------|------------|--------|----|
| TASK-001 | ... | TEST | 1 | — | S | AC-1 |
| TASK-002 | ... | IMPLEMENT | 1 | TASK-001 | M | AC-1 |

---

## Critical Path

The longest chain of dependent tasks (determines minimum calendar time):

`TASK-001 → TASK-002 → TASK-003 → TASK-004 → TASK-005 → TASK-006 → TASK-007 → TASK-010 → TASK-011`

**Critical path effort:** <sum of estimates for critical path tasks>

## Parallelizable Tasks

Tasks that can be worked on simultaneously (by different engineers or agents):

- **After TASK-005:** TASK-006 and TASK-008 can run in parallel
- **After TASK-007 and TASK-009:** TASK-010 can start

---

<individual task blocks here, using the template from 2.2>

---

## Traceability Matrix

Every acceptance criterion from the spec must be covered by at least one task:

| AC | Task(s) | Test Task(s) | Status |
|----|---------|-------------|--------|
| AC-1 | TASK-002, TASK-003 | TASK-001 | PENDING |
| AC-2 | TASK-005 | TASK-004 | PENDING |
| AC-3 | TASK-007 | TASK-006 | PENDING |
| AC-4 | TASK-009 | TASK-008 | PENDING |

**Coverage:** <N>/<N> ACs covered (100%)
```

---

## Phase 4 — Validation

### 4.1 Completeness Check

- [ ] Every phase from the plan has at least one task
- [ ] Every acceptance criterion has at least one task and one test task
- [ ] Every file change from the plan is covered by a task
- [ ] Every edge case from the spec has a test task

### 4.2 Ordering Check

- [ ] No circular dependencies between tasks
- [ ] Test tasks always precede their implementation tasks
- [ ] Migration tasks precede tasks that depend on new schema
- [ ] No task depends on a task that comes after it in the order

### 4.3 Size Check

- [ ] No task has more than 5 files to touch
- [ ] No task is estimated at more than L (4 hours)
- [ ] Tasks larger than M are split where possible

### 4.4 Independence Check

For each task, verify: "If I complete this task alone, does the codebase still build and all existing tests pass?" If the answer is no, the task needs restructuring.

---

## Phase 5 — Agent Readiness Tags

For each task, add an agent compatibility tag:

```markdown
**Agent-ready:** YES | PARTIAL | NO
**Reason:** <why or why not>
```

Criteria for agent-readiness:
- **YES** — Task has clear inputs, clear outputs, and can be verified automatically (tests pass, linting passes)
- **PARTIAL** — Task is mostly automatable but has one ambiguous step that may need human judgment
- **NO** — Task requires human decisions (e.g., UI design, business rule interpretation, external service configuration)

This helps teams decide which tasks to delegate to AI agents vs. assign to engineers.

---

## Output

1. **Primary:** `specs/<NNN>-<feature-slug>/tasks.md` — The task breakdown
2. **Console summary:** Total tasks, critical path length, parallelizable count, agent-ready count
3. **Next action:** Remind the user that tasks marked "Agent-ready: YES" can be executed with Claude Code directly. Tasks marked "NO" need human assignment.