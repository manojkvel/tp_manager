---
name: spec-evolve
description: Manage spec lifecycle — versioned revisions, child spec creation, and open question resolution — with automatic blast-radius analysis to determine which downstream artifacts (plan, tasks, board items, implementation) need re-processing. Use after /spec-review finds gaps, after HITL gate feedback, when stakeholders change requirements, or when /task-implementer hits an ambiguity.
argument-hint: "revise|child|resolve [--trigger spec-review|gate|stakeholder|implementation] path/to/spec.md"
allowed-tools: Read, Write, Grep, Glob, Bash(git log, git diff, git show, ls, find, tree, wc)
---

# Spec Evolve — Spec Lifecycle Management

Specs are living artifacts, not static documents. Requirements clarify, scope grows, ambiguities surface during implementation, and stakeholders change their minds. This skill manages that evolution formally — versioning the spec, assessing impact on downstream artifacts, and producing a re-processing manifest so the pipeline knows exactly what to re-run.

Without formal spec evolution, changes are ad-hoc: someone edits the spec in place, downstream artifacts go stale, and the implementation drifts from intent. `/spec-evolve` ensures every change is versioned, traced, and propagated.

## When to Use This Skill

| Trigger | Mode | What Happens |
|---------|------|-------------|
| `/spec-review` finds compliance gaps | `revise` | Amend spec to clarify gaps, assess downstream impact |
| HITL gate reviewer requests changes | `revise` | Incorporate gate feedback as versioned amendment |
| Stakeholder changes requirements | `revise` or `child` | Small change = revise; large new scope = child spec |
| `/task-implementer` hits ambiguity | `resolve` | Answer the question, minimal targeted amendment |
| Discovery during `/plan-gen` | `revise` | Clarify spec gaps surfaced during planning |
| New scope discovered during implementation | `child` | Create linked child spec for the new scope area |

## CRITICAL RULES

1. **Never edit a spec in place.** Every change produces a new version file (`spec.v{N}.md`) or a new spec directory (child). The original version is preserved for audit trail.
2. **Every change must have a classified trigger.** No anonymous edits — the trigger source (spec-review, gate, stakeholder, implementation) is recorded in the version header.
3. **Blast radius must be computed before changes are applied downstream.** The re-processing manifest tells the pipeline what to re-run. Without it, stale artifacts persist.
4. **Child specs inherit parent constraints.** Security, performance, compliance, and architecture constraints from the parent spec carry forward unless explicitly overridden with justification.
5. **Open question resolution is minimal.** When resolving a question, change only what the answer affects. Don't use it as an opportunity to refactor the spec.

---

## Phase 0 — Analyze Change Trigger

### 0.1 Identify the Trigger Source

```
Read the invocation arguments to determine:
- Mode: revise | child | resolve
- Trigger: spec-review | gate | stakeholder | implementation | planning
- Source artifact: the report, gate feedback, or question that triggered the change
```

### 0.2 Load Current Spec State

Read the spec directory:
```
Glob: specs/<NNN>-<slug>/spec.md
Glob: specs/<NNN>-<slug>/spec.v*.md        (existing versions)
Glob: specs/<NNN>-<slug>/plan.md            (downstream: plan)
Glob: specs/<NNN>-<slug>/tasks.md           (downstream: tasks)
Glob: specs/<NNN>-<slug>/board-mapping.json (downstream: board)
Glob: specs/<NNN>-<slug>/spec-review.md     (trigger source if spec-review)
Glob: specs/<NNN>-<slug>/children/          (existing child specs)
Glob: reports/task-implementer-*-<slug>*.md (implementation state)
```

Determine the current version number. If no `spec.v*.md` files exist, the current version is `v1` (the original `spec.md`).

### 0.3 Load Trigger Context

Based on the trigger source, extract the specific change request:

**From spec-review:** Parse the compliance gaps, missing ACs, unimplemented business rules, and scope creep items from the spec-review report.

**From HITL gate:** Read the gate feedback (provided as argument or from a gate-decision file) — extract requested changes, conditions, and rejections.

**From stakeholder:** Parse the change request description (provided as argument or from a change-request file).

**From implementation:** Read the `/task-implementer` report to find the specific ambiguity, blocked task, or question.

**From planning:** Read the `/plan-gen` output notes about spec gaps or unclear requirements.

---

## Phase 1 — Classify the Change

### 1.1 Change Classification

Categorize each change item:

| Classification | Description | Typical Blast Radius |
|---------------|-------------|---------------------|
| CLARIFICATION | Existing AC or BR made more precise, no new scope | Low — may not affect plan or tasks |
| SCOPE_ADDITION | New AC, BR, or capability added | High — plan, tasks, board all affected |
| SCOPE_REMOVAL | AC, BR, or capability removed | Medium — tasks removed, board updated |
| CONSTRAINT_CHANGE | NFR modified (performance target, security requirement) | Medium — may affect implementation approach |
| ARCHITECTURE_CHANGE | Fundamental design decision changed | High — plan restructured, tasks re-generated |
| EDGE_CASE | Missing edge case or error handling identified | Low-Medium — new tasks, existing plan likely OK |
| DEPENDENCY_CHANGE | External dependency added, removed, or changed | Medium — plan phases may shift |

### 1.2 Assess Scope

For `revise` mode: determine if the changes can be expressed as amendments to the existing spec, or if they're large enough to warrant a child spec instead. Threshold: if the change adds more than 3 new ACs or introduces a fundamentally new user flow, recommend switching to `child` mode.

For `child` mode: verify the new scope is genuinely distinct from the parent (not just a revision).

For `resolve` mode: verify the question has a clear answer and identify the minimal spec text that needs updating.

---

## Phase 2 — Compute Blast Radius

### 2.1 Downstream Impact Analysis

For each classified change, determine which downstream artifacts are affected:

```
Change Item → Affected ACs/BRs → Plan phases that trace to those ACs
                                → Tasks that trace to those ACs
                                → Board items mapped to those tasks
                                → Implementation already done for those tasks
```

### 2.2 Build Impact Matrix

| Change | Plan Impact | Task Impact | Board Impact | Implementation Impact |
|--------|------------|-------------|-------------|----------------------|
| AC-3 clarified | Phase 2 wording | TASK-005 DoD updated | AB#12105 description | None (not yet implemented) |
| AC-7 added | New Phase 4 | 3 new tasks needed | 3 new work items | N/A |
| BR-2 removed | Phase 1 simplified | TASK-002 removed | AB#12102 closed | Revert TASK-002 changes |

### 2.3 Classify Re-processing Need

For each downstream artifact:

| Artifact | Re-processing Level |
|----------|-------------------|
| Plan | **NONE** — change doesn't affect plan structure |
| Plan | **UPDATE** — plan text needs updating but phases don't change |
| Plan | **REGEN** — plan needs re-generation (new phases, removed phases, restructured) |
| Tasks | **NONE** — no task changes needed |
| Tasks | **DELTA** — add/remove/modify specific tasks (incremental) |
| Tasks | **REGEN** — task breakdown needs full re-generation |
| Board | **SYNC** — update existing work items via /board-sync |
| Board | **PUSH** — new work items needed via /board-sync push |
| Implementation | **NONE** — existing implementation is still valid |
| Implementation | **REWORK** — specific tasks need re-implementation |
| Implementation | **REVERT** — implemented code needs to be reverted |

---

## Phase 3 — Produce Versioned Spec

### 3.1 Revise Mode

Create `specs/<NNN>-<slug>/spec.v{N}.md`:

```markdown
---
version: 3
parent_version: 2
trigger: spec-review
trigger_source: specs/047-sso-login/spec-review.md
date: 2026-02-16
author: /spec-evolve
changes:
  - type: CLARIFICATION
    target: AC-3
    summary: "Clarified OAuth token refresh must use sliding window, not fixed expiry"
  - type: SCOPE_ADDITION
    target: AC-7
    summary: "Added SAML 2.0 support as required by enterprise customers"
  - type: EDGE_CASE
    target: BR-2
    summary: "Added rate limiting on failed SSO attempts (5 per minute per IP)"
blast_radius:
  plan: REGEN
  tasks: DELTA
  board: PUSH
  implementation: REWORK
---

# SSO Login for Enterprise Customers — v3

<Full spec content with amendments applied>

## Change Log

### v3 (2026-02-16) — Triggered by spec-review compliance gaps
- **AC-3 CLARIFIED:** OAuth token refresh now explicitly requires sliding window...
- **AC-7 ADDED:** SAML 2.0 support for enterprise identity providers...
- **BR-2 EDGE_CASE:** Rate limiting on failed SSO attempts...

### v2 (2026-02-14) — Triggered by HITL gate feedback
- ...

### v1 (2026-02-12) — Original spec
- Initial version from /spec-gen
```

Also update the symlink: `spec.md` → `spec.v{N}.md` (latest version is always accessible as `spec.md`).

### 3.2 Child Mode

Create `specs/<NNN+1>-<child-slug>/spec.md`:

```markdown
---
parent_spec: specs/047-sso-login/spec.md
parent_version: 3
relationship: child
trigger: implementation
trigger_source: reports/task-implementer-sso-login-2026-02-16.md
date: 2026-02-16
inherited_constraints:
  - "All auth endpoints must respond within 200ms (P95)"
  - "OAuth tokens must be stored encrypted at rest"
  - "Must integrate with existing session management"
---

# Admin Dashboard for SSO Configuration

## Context
During implementation of the SSO Login feature (specs/047-sso-login), it became
clear that enterprise customers need a self-service admin dashboard to configure
SSO providers, manage certificates, and monitor login health. This was not in the
original scope but is required for production readiness.

## Parent Traceability
This spec extends: specs/047-sso-login/spec.md (v3)
Triggered by: TASK-008 blocked — "Cannot implement provider configuration without admin UI"

<Full spec content generated by /spec-gen with parent context>
```

Also update the parent spec with a cross-reference:
```markdown
## Child Specs
- specs/048-sso-admin-dashboard/spec.md — Admin dashboard for SSO configuration (spawned from TASK-008)
```

### 3.3 Resolve Mode

Create a minimal amendment in `specs/<NNN>-<slug>/spec.v{N}.md`:

The resolve mode produces the smallest possible spec change. The open question and its answer are recorded in the change log. Only the specific ambiguous text is updated.

```markdown
---
version: 2
parent_version: 1
trigger: implementation
trigger_source: "TASK-005 ambiguity: Does 'session timeout' mean idle timeout or absolute timeout?"
resolution: "Idle timeout. Sessions expire after 30 minutes of inactivity. Absolute timeout is 8 hours."
date: 2026-02-16
changes:
  - type: CLARIFICATION
    target: AC-2
    summary: "Session timeout clarified as 30-minute idle timeout with 8-hour absolute maximum"
blast_radius:
  plan: NONE
  tasks: UPDATE
  board: SYNC
  implementation: NONE
---
```

---

## Phase 4 — Generate Re-processing Manifest

### 4.1 Write the Manifest

Save `specs/<NNN>-<slug>/reprocess-manifest.json`:

```json
{
  "spec_version": 3,
  "previous_version": 2,
  "trigger": "spec-review",
  "date": "2026-02-16T14:30:00Z",
  "changes": [
    {
      "type": "CLARIFICATION",
      "target": "AC-3",
      "downstream": {
        "plan": "NONE",
        "tasks": "UPDATE",
        "board": "SYNC",
        "implementation": "NONE"
      }
    },
    {
      "type": "SCOPE_ADDITION",
      "target": "AC-7",
      "downstream": {
        "plan": "REGEN",
        "tasks": "DELTA",
        "board": "PUSH",
        "implementation": "N/A"
      }
    }
  ],
  "aggregate_action": {
    "plan": "REGEN",
    "tasks": "DELTA",
    "board": "PUSH",
    "implementation": "REWORK",
    "affected_tasks": ["TASK-005", "TASK-008"],
    "new_tasks_needed": true,
    "removed_tasks": []
  },
  "pipeline_instructions": {
    "run": [
      "/plan-gen specs/047-sso-login/spec.v3.md",
      "/task-gen specs/047-sso-login/plan.md --delta",
      "/board-sync push specs/047-sso-login/tasks.md",
      "/board-sync status specs/047-sso-login/"
    ],
    "skip": [
      "/spec-gen (spec already updated)",
      "/spec-review (will run after re-implementation)"
    ],
    "hitl_gates": [
      "Approve revised plan before task generation",
      "Approve new tasks before implementation"
    ]
  },
  "child_specs": []
}
```

For child mode, the manifest also includes:
```json
{
  "child_specs": [
    {
      "path": "specs/048-sso-admin-dashboard/spec.md",
      "pipeline_instructions": {
        "run": ["/plan-gen", "/task-gen", "/plan-merge", "/board-sync push"],
        "hitl_gates": ["Approve child spec", "Approve child plan"]
      }
    }
  ]
}
```

### 4.2 Console Output

```
Spec Evolve — SSO Login (revise)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Trigger:     spec-review (specs/047-sso-login/spec-review.md)
Version:     v2 → v3

Changes:
  CLARIFICATION  AC-3   OAuth token refresh → sliding window
  SCOPE_ADDITION AC-7   SAML 2.0 support added
  EDGE_CASE      BR-2   Rate limiting on failed SSO attempts

Blast Radius:
  Plan:           REGEN (new phase needed for SAML)
  Tasks:          DELTA (3 new tasks, 1 updated)
  Board:          PUSH (3 new work items) + SYNC (1 updated)
  Implementation: REWORK (TASK-005 needs update)

Output:
  specs/047-sso-login/spec.v3.md
  specs/047-sso-login/reprocess-manifest.json

Next Steps (from manifest):
  1. /plan-gen specs/047-sso-login/spec.v3.md     ← HITL gate
  2. /task-gen specs/047-sso-login/plan.md --delta
  3. /board-sync push specs/047-sso-login/tasks.md
  4. Resume /task-implementer for new/updated tasks
```

---

## Integration with Pipeline

### With /pipeline-orchestrator
The orchestrator reads the `reprocess-manifest.json` and automatically schedules the re-processing steps, inserting HITL gates where specified. It doesn't re-run the entire pipeline — only the steps indicated by the manifest.

### With /quality-gate
Before `/spec-evolve` output is used downstream, `/quality-gate` validates: the new spec version is internally consistent, inherited constraints from parent specs are preserved (child mode), and the blast radius assessment is plausible (a CLARIFICATION shouldn't have REGEN blast radius).

### With /auto-triage
When `/task-implementer` hits an ambiguity, `/auto-triage` classifies whether the issue needs `/spec-evolve resolve` (answerable question), `/spec-evolve revise` (spec gap), or `/spec-evolve child` (new scope). For `resolve` mode, `/auto-triage` may attempt to answer the question from existing context before escalating to a HITL gate.

### With /board-sync
After spec evolution, `/board-sync` needs to update the PM tool: revised specs update the Epic description with the new version reference, new tasks from DELTA processing get pushed as new work items, removed tasks get closed, and the change history is posted as a comment on the Epic.

### With /drift-detector
`/drift-detector` tracks spec version history across the project. It alerts when: a spec has been revised more than 3 times (instability signal), child specs are diverging from parent constraints, or multiple specs are evolving in contradictory directions.

---

## Modes

### Revise Mode (Default)
```
/spec-evolve revise specs/047-sso-login/spec.md --trigger spec-review
/spec-evolve revise specs/047-sso-login/spec.md --trigger gate --source gate-feedback.md
/spec-evolve revise specs/047-sso-login/spec.md --trigger stakeholder --source change-request.md
```

### Child Mode
```
/spec-evolve child specs/047-sso-login/spec.md --trigger implementation --source "TASK-008: needs admin dashboard"
/spec-evolve child specs/047-sso-login/spec.md --trigger stakeholder --source change-request.md
```

### Resolve Mode
```
/spec-evolve resolve specs/047-sso-login/spec.md --question "Does session timeout mean idle or absolute?" --answer "Idle timeout, 30min. Absolute timeout 8hrs."
/spec-evolve resolve specs/047-sso-login/spec.md --trigger implementation --source "TASK-005 ambiguity log"
```

### Dry-Run
```
/spec-evolve revise --dry-run specs/047-sso-login/spec.md --trigger spec-review
```
Shows what would change, the blast radius, and the re-processing manifest without creating any files.

---

## Output

1. **Primary (revise/resolve):** `specs/<NNN>-<slug>/spec.v{N}.md` — versioned spec with change log header
2. **Primary (child):** `specs/<NNN+1>-<child-slug>/spec.md` — new spec directory linked to parent
3. **Manifest:** `specs/<NNN>-<slug>/reprocess-manifest.json` — machine-readable re-processing instructions
4. **Console summary:** Changes classified, blast radius assessed, next steps listed
5. **Side effects:** Parent spec updated with child cross-reference (child mode), `spec.md` symlink updated to latest version (revise mode)
