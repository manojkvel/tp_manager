---
name: wave-scheduler
description: Compute an execution schedule from task dependency graphs — assigns tasks to execution waves respecting dependency ordering, file conflict avoidance, HITL gate positions, parallelism limits, and priority overrides. Produces a machine-readable schedule consumed by /pipeline-orchestrator.
argument-hint: "[--max-parallel N] [--respect-priority] path/to/tasks.md"
allowed-tools: Read, Write, Grep, Glob, Bash(git log, git diff, git show, ls, find, cat, wc, date, jq)
---

# Wave Scheduler — Execution Planning from Dependency Graphs

Converts the task dependency graph from `/task-gen` (or merged dependency graph from `/plan-merge`) into a concrete execution schedule. Each "wave" is a set of tasks that can execute concurrently because they have no mutual dependencies and don't modify the same files.

This replaces manual sprint planning. Instead of a team estimating what fits in 2 weeks, the scheduler computes the optimal execution order based on hard constraints (dependencies, file conflicts) and soft constraints (priority, effort balance).

## CRITICAL RULES

1. **Dependencies are inviolable.** If TASK-B depends on TASK-A, TASK-B is never scheduled in a wave before TASK-A's wave. No exceptions.
2. **File conflicts are serialized.** If TASK-A and TASK-B both modify `src/auth/service.ts`, they cannot be in the same wave even if they have no dependency link.
3. **HITL gates split waves.** If a task requires human review before proceeding, it ends its wave. The next wave starts after HITL approval.
4. **The schedule is a suggestion, not a contract.** When tasks fail or specs evolve, the schedule is recomputed. It's cheap to regenerate.
5. **Priority overrides are soft.** If the PM flags TASK-008 as urgent via `/board-sync pull`, the scheduler promotes it to the earliest wave that respects dependencies — but it won't violate dependency ordering.

---

## Phase 0 — Load Inputs

### 0.1 Parse Task Graph

Read `tasks.md` and extract:
- Task IDs: TASK-001 through TASK-NNN
- Dependencies: `depends_on: [TASK-001, TASK-002]`
- Files to touch: `files: [src/auth/service.ts, src/middleware/auth.ts]`
- Effort estimates: XS, S, M, L, XL
- Agent-readiness: YES, PARTIAL, NO
- Task type: TEST, IMPLEMENT, MIGRATE, CONFIGURE, DOCUMENT
- Current status: NOT_STARTED, IN_PROGRESS, COMPLETE, BLOCKED, SKIPPED

### 0.2 Parse Priority Overrides

If `board-mapping.json` exists, check for PM-assigned priorities:
```
Read board-mapping.json → for each task:
  - If PM set priority P1 → add to priority_overrides list
  - If PM set sprint assignment → note the sprint constraint
```

### 0.3 Load Merged Plan Context (if exists)

If a `merged-plan-*.md` exists from `/plan-merge`, load:
- Cross-plan dependency edges
- Execution wave pre-assignments
- File conflict resolutions

### 0.4 Load Configuration

```json
{
  "max_parallel": 4,
  "respect_priority": true,
  "prefer_test_first": true,
  "max_wave_effort": "XL",
  "hitl_before_human_tasks": true,
  "recompute_on_failure": true
}
```

---

## Phase 1 — Build Dependency Graph

### 1.1 Construct DAG

Build a directed acyclic graph where:
- Nodes = tasks (TASK-NNN)
- Directed edges = dependencies (TASK-A → TASK-B means A must complete before B)

### 1.2 Validate DAG

Check for:
- **Cycles:** If detected, report the cycle and fail. Circular dependencies must be resolved in tasks.md.
- **Orphan tasks:** Tasks with no dependencies and no dependents — valid but flagged for awareness.
- **Missing dependencies:** Task references a dependency that doesn't exist — fail with error.

### 1.3 Add Implicit Edges

**File conflict edges:** If TASK-A and TASK-B both modify the same file and have no explicit dependency, add a serialization edge (A → B or B → A, preferring the order that minimizes total wave count).

**Test-first edges:** If `prefer_test_first` is enabled and a TEST task covers the same files as an IMPLEMENT task, add an edge: TEST → IMPLEMENT (write tests before implementation).

**HITL edges:** If a task has `agent_ready: NO`, add an implicit HITL gate after it — no subsequent tasks in that dependency chain start until the human task is reviewed.

---

## Phase 2 — Compute Execution Waves

### 2.1 Topological Sort with Wave Assignment

```
Algorithm:
1. Compute in-degree for each task (number of unresolved dependencies)
2. Wave 0 = all tasks with in-degree 0 (no dependencies)
3. For wave N:
   a. Select all tasks with in-degree 0
   b. Apply constraints:
      - Remove tasks that file-conflict with another task in this wave
      - Remove tasks that exceed max_parallel
      - Remove tasks beyond max_wave_effort budget
   c. Remaining tasks = this wave
   d. Reduce in-degree of dependent tasks
   e. Removed-due-to-constraints tasks carry to wave N+1
4. Repeat until all tasks assigned
```

### 2.2 Apply Priority Overrides

After initial wave assignment:
```
For each priority-override task:
  - Find its current wave assignment
  - Find the earliest wave it could occupy (respecting dependencies)
  - If earliest < current → promote to earliest wave
  - If promotion displaces other tasks (max_parallel exceeded) → demote lowest-priority task
```

### 2.3 Insert HITL Gates

For tasks with `agent_ready: NO` or `agent_ready: PARTIAL`:
```
- PARTIAL: can start autonomously but HITL gate before the next wave (review checkpoint)
- NO: HITL gate before the task (human must do it or approve agent approach)
```

### 2.4 Balance Waves (Optional)

If waves are unbalanced (wave 1 has 8 tasks, wave 2 has 1), attempt to redistribute:
- Move tasks from heavy waves to light waves where dependencies allow
- Target: even effort distribution across waves
- Constraint: never violate dependency ordering

---

## Phase 3 — Produce Schedule

### 3.1 Write Execution Schedule

Save `specs/<NNN>-<slug>/execution-schedule.json`:

```json
{
  "spec": "specs/047-sso-login",
  "generated_at": "2026-02-16T14:30:00Z",
  "total_tasks": 12,
  "total_waves": 4,
  "max_parallel": 4,
  "critical_path": ["TASK-001", "TASK-003", "TASK-006", "TASK-009", "TASK-012"],
  "critical_path_effort": "L + M + L + M + S = ~XL total",
  "waves": [
    {
      "wave": 1,
      "tasks": ["TASK-001", "TASK-002", "TASK-010"],
      "effort": "M + S + XS",
      "parallel_slots": 3,
      "hitl_gate_after": false,
      "notes": "Foundation: data model tests, base config, docs skeleton"
    },
    {
      "wave": 2,
      "tasks": ["TASK-003", "TASK-004", "TASK-005", "TASK-011"],
      "effort": "L + M + M + S",
      "parallel_slots": 4,
      "hitl_gate_after": false,
      "notes": "Core implementation: auth service, middleware, token refresh"
    },
    {
      "wave": 3,
      "tasks": ["TASK-006", "TASK-007", "TASK-008"],
      "effort": "L + M + M",
      "parallel_slots": 3,
      "hitl_gate_after": true,
      "hitl_reason": "TASK-008 is agent_ready: PARTIAL — needs human review of OAuth provider configuration",
      "notes": "Integration: SSO flow, provider config, session management"
    },
    {
      "wave": 4,
      "tasks": ["TASK-009", "TASK-012"],
      "effort": "M + S",
      "parallel_slots": 2,
      "hitl_gate_after": false,
      "notes": "Polish: E2E tests, performance tuning"
    }
  ],
  "file_conflicts_resolved": [
    {
      "file": "src/auth/service.ts",
      "tasks": ["TASK-003", "TASK-006"],
      "resolution": "Serialized: TASK-003 in wave 2, TASK-006 in wave 3"
    }
  ],
  "priority_overrides_applied": [],
  "parallel_efficiency": 0.75
}
```

### 3.2 Console Output

```
Wave Scheduler — SSO Login
━━━━━━━━━━━━━━━━━━━━━━━━━
Tasks: 12 | Waves: 4 | Max parallel: 4

Wave 1 [3 tasks, effort: M+S+XS]
  TASK-001  Write data model tests          M   agent-ready: YES
  TASK-002  Base configuration              S   agent-ready: YES
  TASK-010  Documentation skeleton          XS  agent-ready: YES

Wave 2 [4 tasks, effort: L+M+M+S]
  TASK-003  Implement auth service          L   agent-ready: YES
  TASK-004  Add auth middleware             M   agent-ready: YES
  TASK-005  Token refresh logic             M   agent-ready: YES
  TASK-011  Update API docs                 S   agent-ready: YES

Wave 3 [3 tasks, effort: L+M+M] ← HITL gate after
  TASK-006  SSO integration flow            L   agent-ready: YES
  TASK-007  Session management              M   agent-ready: YES
  TASK-008  OAuth provider config           M   agent-ready: PARTIAL ⚠

Wave 4 [2 tasks, effort: M+S]
  TASK-009  E2E integration tests           M   agent-ready: YES
  TASK-012  Performance tuning              S   agent-ready: PARTIAL

Critical path: TASK-001 → TASK-003 → TASK-006 → TASK-009 → TASK-012
Parallel efficiency: 75%
File conflicts serialized: 1 (src/auth/service.ts)

Schedule saved: specs/047-sso-login/execution-schedule.json
```

---

## Recomputation

When the schedule needs updating (task failure, spec evolution, priority change):

```
/wave-scheduler --recompute specs/047-sso-login/tasks.md
```

The scheduler reads current task statuses from `board-mapping.json`, filters out completed tasks, and recomputes waves for remaining tasks only. This is the agentic equivalent of "re-planning the sprint" — but it takes seconds instead of a meeting.

---

## Modes

```
/wave-scheduler specs/047-sso-login/tasks.md
/wave-scheduler specs/047-sso-login/tasks.md --max-parallel 2
/wave-scheduler specs/047-sso-login/tasks.md --respect-priority
/wave-scheduler --recompute specs/047-sso-login/tasks.md
/wave-scheduler --dry-run specs/047-sso-login/tasks.md
```

---

## Output

1. **Primary:** `specs/<NNN>-<slug>/execution-schedule.json` — machine-readable schedule for /pipeline-orchestrator
2. **Console summary:** Wave breakdown with tasks, effort, HITL gates, critical path, parallel efficiency
