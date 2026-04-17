---
name: scope-tracker
description: Track scope changes across the project lifecycle — logs every change request, spec revision, child spec creation, and HITL gate condition as a formal scope change with effort delta, timeline impact, and approval status. Produces a scope change ledger for PM visibility and stakeholder reporting.
argument-hint: "log|report|trend [path/to/spec-or-all]"
allowed-tools: Read, Write, Grep, Glob, Bash(git log, git diff, ls, find, cat, wc, date, jq)
---

# Scope Tracker — Change Request Management

Every project has scope changes. The question is whether they're tracked or invisible. `/scope-tracker` formalizes scope change management by capturing every change — from spec revisions to child specs to HITL gate conditions — as a tracked scope change with effort delta, timeline impact, and approval status.

This gives the PM a clear answer to "why did this take longer than planned?" and the stakeholder a clear ledger of every approved scope addition.

## Scope Change Sources

| Source | How It Creates a Scope Change |
|--------|------------------------------|
| `/spec-evolve revise` with SCOPE_ADDITION | New ACs, new BRs, new capabilities |
| `/spec-evolve child` | Entirely new spec spawned from parent |
| HITL gate APPROVE WITH CONDITIONS | Conditions that add work not in original scope |
| `/spec-review` scope creep findings | Implementation that went beyond spec |
| `/board-sync pull` priority changes | Work re-prioritized by PM in board |
| Manual entry | Stakeholder requests, market changes |

## CRITICAL RULES

1. **Every scope change has an effort delta.** Even if it's estimated, the PM needs to know the cost. "Free" scope changes don't exist.
2. **Scope changes require approval linkage.** Every change should link to the HITL gate decision, spec-evolve version, or stakeholder request that authorized it.
3. **Track direction: additions and removals.** Removing scope is also a change. The ledger should show both what was added and what was cut.
4. **Cumulative view matters.** Individual scope changes look small. The cumulative effort delta tells the real story.

---

## Phase 0 — Collect Scope Changes

### 0.1 Scan Spec Evolution

```
Glob: specs/*/spec.v*.md
For each version pair (v{N-1}, v{N}):
  Read YAML frontmatter → extract changes[]
  For changes with type == SCOPE_ADDITION or SCOPE_REMOVAL:
    Create scope change entry
```

### 0.2 Scan Child Specs

```
Glob: specs/*/children/ or linked child specs in spec YAML
For each child spec:
  Create scope change entry (type: CHILD_SPEC)
  Estimate effort delta from child's task count
```

### 0.3 Scan HITL Gate Decisions

```
Glob: specs/*/pipeline-state.json
For each HITL gate with decision == APPROVE_WITH_CONDITIONS:
  Parse conditions → if any add work → create scope change entry
```

### 0.4 Scan Spec Review Scope Creep

```
Glob: specs/*/spec-review*.md
For each scope_creep finding:
  Create scope change entry (type: SCOPE_CREEP, direction: ADDITION)
```

### 0.5 Load Existing Ledger

```
Read: specs/<NNN>-<slug>/scope-ledger.json (if exists)
Merge new changes with existing entries (deduplicate by source reference)
```

---

## Phase 1 — Assess Impact

### 1.1 Effort Delta Estimation

For each new scope change:

```
If reprocess-manifest.json exists:
  effort_delta = estimate from manifest's pipeline_instructions
  - New tasks = task count × avg effort per task type
  - Re-run stages = historical avg duration per stage

If child spec:
  effort_delta = child task count × avg effort (from /feedback-loop calibration)

If gate condition:
  effort_delta = manual estimate or "TBD — requires assessment"
```

### 1.2 Timeline Impact

```
original_waves = from original execution-schedule.json
current_waves = from current/re-computed schedule
wave_delta = current_waves - original_waves

If wave_delta > 0:
  timeline_impact = "Adds ~{wave_delta} execution waves"

If critical path affected:
  timeline_impact += " (critical path extended)"
```

---

## Phase 2 — Produce Scope Ledger

### 2.1 Write Scope Ledger

Save `specs/<NNN>-<slug>/scope-ledger.json`:

```json
{
  "spec": "specs/047-sso-login",
  "original_scope": {
    "acs": 5,
    "tasks": 10,
    "estimated_effort": "L (4-6 waves)",
    "baseline_date": "2026-02-10"
  },
  "current_scope": {
    "acs": 7,
    "tasks": 15,
    "estimated_effort": "XL (6-8 waves)",
    "as_of": "2026-02-16"
  },
  "cumulative_delta": {
    "acs_added": 3,
    "acs_removed": 1,
    "net_ac_change": "+2",
    "tasks_added": 7,
    "tasks_removed": 2,
    "net_task_change": "+5",
    "effort_delta": "+40%",
    "wave_delta": "+2"
  },
  "changes": [
    {
      "id": "SC-001",
      "date": "2026-02-12",
      "type": "SCOPE_ADDITION",
      "direction": "ADDITION",
      "source": "spec-evolve revise v2 (stakeholder request)",
      "description": "Add SAML 2.0 support alongside OAuth 2.0",
      "acs_affected": ["AC-7 (new)"],
      "effort_delta": "+3 tasks (M, M, S)",
      "timeline_impact": "+1 wave",
      "approved_by": "kvel@ at HITL gate approve-plan",
      "approval_date": "2026-02-12"
    },
    {
      "id": "SC-002",
      "date": "2026-02-14",
      "type": "CHILD_SPEC",
      "direction": "ADDITION",
      "source": "spec-evolve child (implementation discovery)",
      "description": "Admin dashboard for SSO configuration (specs/048-sso-admin)",
      "acs_affected": ["New spec: 4 ACs"],
      "effort_delta": "+8 tasks (estimated from child spec)",
      "timeline_impact": "Parallel pipeline — no direct delay if independent",
      "approved_by": "kvel@ at HITL gate approve-child-spec",
      "approval_date": "2026-02-14"
    },
    {
      "id": "SC-003",
      "date": "2026-02-15",
      "type": "SCOPE_REMOVAL",
      "direction": "REMOVAL",
      "source": "spec-evolve revise v3 (spec-review recommendation)",
      "description": "Deferred audit logging to v2.5.0 (AC-5 removed)",
      "acs_affected": ["AC-5 (removed)"],
      "effort_delta": "-2 tasks",
      "timeline_impact": "-0 waves (tasks were in non-critical path)",
      "approved_by": "kvel@ at HITL gate approve-revision",
      "approval_date": "2026-02-15"
    }
  ]
}
```

### 2.2 Write Scope Report

Save `reports/scope-report-<date>.md`:

```markdown
# Scope Change Report — SSO Login
**Date:** 2026-02-16
**Baseline:** 2026-02-10 (5 ACs, 10 tasks, L effort)
**Current:** 7 ACs, 15 tasks, XL effort

## Summary
| Metric | Baseline | Current | Delta |
|--------|----------|---------|-------|
| Acceptance criteria | 5 | 7 | +2 (40%) |
| Tasks | 10 | 15 | +5 (50%) |
| Effort estimate | L | XL | +40% |
| Execution waves | 4 | 6 | +2 |
| Child specs | 0 | 1 | +1 |

## Change Ledger
| ID | Date | Type | Description | Effort | Approved |
|----|------|------|------------|--------|----------|
| SC-001 | Feb 12 | Addition | SAML 2.0 support | +3 tasks | kvel@ |
| SC-002 | Feb 14 | Child spec | Admin dashboard | +8 tasks | kvel@ |
| SC-003 | Feb 15 | Removal | Audit logging deferred | -2 tasks | kvel@ |

## Trend
Scope has grown 40% from baseline. Primary driver: SAML 2.0 addition (SC-001)
and admin dashboard discovery (SC-002). One scope reduction (SC-003) partially offset.

At current trajectory, recommend re-baselining effort estimate and timeline.
```

### 2.3 Console Output

```
Scope Tracker — SSO Login
━━━━━━━━━━━━━━━━━━━━━━━━
Baseline: 5 ACs, 10 tasks (2026-02-10)
Current:  7 ACs, 15 tasks (2026-02-16)
Delta:    +2 ACs, +5 tasks, +2 waves (+40% effort)

Changes: 3
  SC-001  ADDITION  SAML 2.0 support          +3 tasks  approved
  SC-002  CHILD     Admin dashboard            +8 tasks  approved
  SC-003  REMOVAL   Audit logging deferred     -2 tasks  approved

Recommendation: Re-baseline timeline (scope grew 40%)

Ledger: specs/047-sso-login/scope-ledger.json
Report: reports/scope-report-2026-02-16.md
```

---

## Modes

```
/scope-tracker log specs/047-sso-login/
/scope-tracker log --all
/scope-tracker report specs/047-sso-login/
/scope-tracker trend --all
```

---

## Output

1. **Primary:** `specs/<NNN>-<slug>/scope-ledger.json` — machine-readable scope change history
2. **Report:** `reports/scope-report-<date>.md` — PM-readable scope change summary with trend
3. **Console summary:** Baseline vs current with delta, change list, recommendation
4. **Integration:** Scope summaries fed to /gate-briefing, trend data fed to /feedback-loop
