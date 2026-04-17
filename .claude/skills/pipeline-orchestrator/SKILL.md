---
name: pipeline-orchestrator
description: End-to-end SDLC pipeline automation — chains skills (spec-gen → plan-gen → task-gen → task-implementer → board-sync → spec-review → release-readiness-checker) into an executable DAG, pausing only at HITL gates for human approval. Handles branching when /spec-evolve triggers re-processing, concurrent wave execution, and failure recovery via /auto-triage.
argument-hint: "run|resume|status [--from stage] [--to stage] [--gates minimal|standard|strict] path/to/spec-or-feature-request"
allowed-tools: Read, Write, Grep, Glob, Bash(git log, git diff, git show, ls, find, cat, wc, date, jq)
---

# Pipeline Orchestrator — End-to-End SDLC Automation

The central nervous system of the agentic SDLC. Instead of manually invoking each skill in sequence, the orchestrator manages the entire pipeline as a directed acyclic graph (DAG) of skill invocations, data dependencies, and HITL gates. The human's role shifts from "run the next skill" to "approve at decision points."

## Pipeline DAG

The default pipeline is:

```
feature-request
    │
    ▼
/feature-balance-sheet quick ──→ [HITL: go/no-go on feature]
    │                                    │
    │  PROCEED                           │ KILL → stop, log rationale
    ▼                                    │ NEEDS DISCUSSION → human decides
/spec-gen + /decision-log capture
    │
    ▼
/quality-gate spec-to-plan ──→ /feature-balance-sheet deep
    │                                    │
    │                                    │ DEFER/KILL → archive spec, stop
    ▼                                    │ CONDITIONAL → HITL (review conditions)
[HITL: approve spec + balance sheet]
    │
    ▼
/plan-gen + /decision-log capture
    │
    ▼
[HITL: approve plan] ──→ /quality-gate plan-to-tasks
    │                                          │
    ▼                                          ▼
/task-gen ──→ /quality-gate tasks-to-impl ──→ /board-sync push
    │                                          │
    ▼                                          ▼
/wave-scheduler ──→ /task-implementer (per wave)
    │                       │
    │                       ├── success → /board-sync status → next wave
    │                       ├── recoverable failure → /auto-triage → retry
    │                       └── spec issue → /spec-evolve → /decision-log review → re-process branch
    ▼
/spec-review ──→ /quality-gate impl-to-release
    │
    ▼
/release-readiness-checker ──→ [HITL: approve release]
    │
    ▼
/release-notes ──→ DONE
```

### Key additions to the DAG

1. **`/feature-balance-sheet quick`** — runs before `/spec-gen` as a pre-filter. If the feature scores below threshold, the pipeline stops without investing in a full spec. This prevents wasted effort on low-value features.

2. **`/feature-balance-sheet deep`** — runs after `/spec-gen` and `/quality-gate spec-to-plan`, using the full spec to produce a thorough portfolio analysis. The human sees both the spec and the balance sheet at the approval gate.

3. **`/decision-log capture`** — runs alongside `/spec-gen` and `/plan-gen` to capture decision rationale in real-time. Produces `decision-log.md` with alternatives considered, trade-offs accepted, and assumptions documented.

4. **`/decision-log review`** — runs after `/spec-evolve` to track how decisions evolve across spec versions. Updates decision statuses (ACTIVE → SUPERSEDED) and links decision chains.

## CRITICAL RULES

1. **The pipeline never skips quality gates.** Every stage transition passes through `/quality-gate`. The orchestrator does not short-circuit gates even if the user asks — the user can adjust gate thresholds in `gate-config.json` instead.
2. **HITL gates are mandatory pause points.** The orchestrator stops and waits for human approval. It never auto-approves on behalf of the user.
3. **Pipeline state is persistent.** If the orchestrator is interrupted (context limit, crash, user closes terminal), it can resume from the last completed step via `pipeline-state.json`.
4. **Spec evolution triggers branching, not restart.** When `/spec-evolve` produces a re-processing manifest, the orchestrator re-runs only the affected stages — not the entire pipeline from scratch.
5. **Concurrent execution respects dependency ordering.** Tasks in the same execution wave run conceptually in parallel, but the orchestrator ensures no two tasks modify the same files.

---

## Phase 0 — Initialize Pipeline

### 0.1 Determine Pipeline Entry Point

```
Feature request (text)      → start from /spec-gen
Existing spec               → start from /plan-gen
Existing plan               → start from /task-gen
Existing tasks              → start from /wave-scheduler
Resume (pipeline-state.json) → resume from last completed step
```

The `--from` and `--to` flags allow partial pipeline execution:
```
/pipeline-orchestrator run --from plan-gen --to board-sync specs/047-sso-login/
```

### 0.2 Load or Create Pipeline State

#### 0.2.1 Load Existing State

If `pipeline-state.json` exists, read it to determine the current stage and resume from there.

Read `specs/<NNN>-<slug>/pipeline-state.json` if it exists:

```json
{
  "pipeline_id": "pipe-047-sso-login-20260216",
  "spec": "specs/047-sso-login/spec.md",
  "spec_version": 3,
  "gate_profile": "standard",
  "started_at": "2026-02-16T09:00:00Z",
  "current_stage": "task-implementer",
  "current_wave": 2,
  "stages": {
    "balance-sheet-quick": { "status": "completed", "completed_at": "...", "output": "feature-balance-sheet.md", "score": 3.8, "recommendation": "PROCEED" },
    "hitl-go-nogo": { "status": "approved", "approved_by": "kvel@", "completed_at": "..." },
    "spec-gen": { "status": "completed", "completed_at": "...", "output": "spec.md" },
    "decision-log-spec": { "status": "completed", "completed_at": "...", "output": "decision-log.md" },
    "gate-spec-to-plan": { "status": "passed", "completed_at": "..." },
    "balance-sheet-deep": { "status": "completed", "completed_at": "...", "score": 3.5, "recommendation": "BUILD" },
    "hitl-approve-spec": { "status": "approved", "approved_by": "kvel@", "completed_at": "..." },
    "plan-gen": { "status": "completed", "completed_at": "...", "output": "plan.md" },
    "decision-log-plan": { "status": "completed", "completed_at": "...", "output": "decision-log.md (appended)" },
    "gate-plan-to-tasks": { "status": "passed", "completed_at": "..." },
    "hitl-approve-plan": { "status": "approved", "approved_by": "kvel@", "completed_at": "..." },
    "task-gen": { "status": "completed", "completed_at": "...", "output": "tasks.md" },
    "gate-tasks-to-impl": { "status": "passed", "completed_at": "..." },
    "board-sync-push": { "status": "completed", "completed_at": "..." },
    "wave-scheduler": { "status": "completed", "completed_at": "...", "waves": 4 },
    "task-implementer-wave-1": { "status": "completed", "completed_at": "..." },
    "board-sync-status-wave-1": { "status": "completed", "completed_at": "..." },
    "task-implementer-wave-2": { "status": "in_progress", "started_at": "..." }
  },
  "branches": [],
  "child_pipelines": []
}
```

If no state exists, create a new pipeline state from the entry point.

### 0.3 Load Gate Profile

Three built-in profiles:

| Profile | HITL Gates | Quality Gates | Use When |
|---------|-----------|---------------|----------|
| `minimal` | Approve spec, approve release | All gates, relaxed thresholds | Prototyping, spikes |
| `standard` | Approve spec, approve plan, approve release | All gates, default thresholds | Normal development |
| `strict` | All stage transitions | All gates, strict thresholds | Compliance-critical, security-sensitive |

---

## Phase 1 — Execute Pipeline

### 1.1 Execution Loop

```
while current_stage != DONE:
    1. Determine the next eligible stage from the DAG
    2. Check preconditions:
       - All upstream stages completed
       - Spec version is current (no stale artifacts)
       - No blocking branches pending
    3. Execute the stage:
       - Skill invocation → capture output
       - Quality gate → PASS/FAIL decision
       - HITL gate → pause and wait for approval
    4. Handle the result:
       - Success → update pipeline-state.json, advance to next stage
       - Gate failure → route to /auto-triage or HITL gate
       - Spec evolution → create branch, schedule re-processing
       - Unrecoverable failure → pause pipeline, alert human
    5. After every step, update pipeline-state.json with the step result
```

### 1.2 Stage Execution

For each skill stage, the orchestrator:

```
1. Log: "Stage: /plan-gen — starting"
2. Invoke the skill with appropriate arguments
3. Capture output artifacts (plan.md, tasks.md, reports, etc.)
4. Log: "Stage: /plan-gen — completed in 45s"
5. Invoke /quality-gate for the next transition
6. Log: "Gate: plan-to-tasks — PASS"
7. Check if HITL gate is required (based on gate profile)
8. If HITL gate: log "HITL gate: approve-plan — waiting for approval"
9. Update pipeline-state.json
```

### 1.3 HITL Gate Handling

When the pipeline reaches a HITL gate:

1. Invoke `/gate-briefing` to produce a decision-ready summary
2. Present the briefing to the human
3. Wait for one of:
   - **APPROVE** → continue pipeline
   - **APPROVE WITH CONDITIONS** → record conditions, continue with constraints
   - **REJECT** → record rejection reason, route to `/spec-evolve revise` or stop
   - **DEFER** → pause pipeline, record reason, can resume later
4. Log the decision in pipeline-state.json

### 1.4 Wave Execution

When the pipeline reaches `/task-implementer`:

1. Invoke `/wave-scheduler` to produce the execution schedule
2. For each wave in order:
   a. Execute all tasks in the wave (conceptually parallel, respecting file conflicts)
   b. After each task: run `/board-sync status` to update the PM tool
   c. After wave completion: check for failures
   d. If failures: route to `/auto-triage`
   e. If `/auto-triage` triggers `/spec-evolve`: create a branch (see Phase 2)
3. After all waves: run `/spec-review`

---

## Phase 2 — Handle Spec Evolution Branching

When `/spec-evolve` is triggered mid-pipeline (from `/auto-triage` or HITL gate feedback):

### 2.1 Create Branch

```json
{
  "branch_id": "branch-047-v3-spec-review",
  "trigger": "spec-review compliance gap",
  "parent_stage": "spec-review",
  "spec_evolution": {
    "mode": "revise",
    "from_version": 2,
    "to_version": 3
  },
  "reprocess_manifest": "specs/047-sso-login/reprocess-manifest.json",
  "stages_to_rerun": ["plan-gen", "task-gen", "board-sync-push", "task-implementer-delta"],
  "stages_preserved": ["spec-gen", "task-implementer-wave-1", "task-implementer-wave-2"]
}
```

After creating a branch, update the progress file with a "Branches" section:
- Branch ID and trigger reason
- Spec evolution (from version → to version)
- Stages to re-run vs stages preserved

### 2.2 Execute Branch

The orchestrator reads the re-processing manifest from `/spec-evolve` and:

1. **Preserved stages** — work already done that's still valid stays in place
2. **Re-run stages** — only the stages indicated by the manifest are re-executed
3. **Delta processing** — for tasks, only new/modified tasks are implemented (not all tasks from scratch)
4. **Merge point** — after the branch completes, the pipeline resumes from the point after the branch

### 2.3 Handle Child Specs

When `/spec-evolve child` creates a new spec:

1. Create a child pipeline with its own `pipeline-state.json`
2. Link the child pipeline to the parent: `"child_pipelines": ["pipe-048-sso-admin-20260216"]`
3. Update the parent's progress file with a "Child Pipelines" section linking to the child's progress file path
4. The child runs its own full pipeline (spec → plan → tasks → impl)
5. If `/plan-merge` is needed (child affects parent timeline), schedule it
6. Parent pipeline can continue independently unless the child blocks a parent task

---

## Phase 3 — Pipeline Status and Reporting

### 3.1 Pipeline State File

`pipeline-state.json` is the single source of truth for pipeline progress. It's updated after every step and is what enables `resume` mode.

### 3.2 Console Output (run mode)

```
Pipeline Orchestrator — SSO Login
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Pipeline:  pipe-047-sso-login-20260216
Spec:      specs/047-sso-login/spec.v3.md
Profile:   standard

Execution:
  ✓ /balance-sheet quick         PROCEED (3.8)  08:55
  ✓ HITL: go/no-go               approved    08:58 (kvel@)
  ✓ /spec-gen                    completed   09:00
  ✓ /decision-log capture (spec) completed   09:01
  ✓ quality-gate spec-to-plan    PASS        09:02
  ✓ /balance-sheet deep          BUILD (3.5) 09:04
  ✓ HITL: approve spec           approved    09:15 (kvel@)
  ✓ /plan-gen                    completed   09:18
  ✓ /decision-log capture (plan) completed   09:18
  ✓ quality-gate plan-to-tasks   PASS        09:19
  ✓ HITL: approve plan           approved    09:30 (kvel@)
  ✓ /task-gen                    completed   09:33
  ✓ quality-gate tasks-to-impl   PASS        09:34
  ✓ /board-sync push             12 tasks    09:35
  ✓ /wave-scheduler              4 waves     09:35
  ✓ wave 1 (3 tasks)             completed   09:45
  ✓ /board-sync status           3 done      09:46
  ● wave 2 (4 tasks)             in progress 09:47
    └─ TASK-004                  implementing...
    └─ TASK-005                  implementing...
  ○ wave 3 (3 tasks)             pending
  ○ wave 4 (2 tasks)             pending
  ○ /spec-review                 pending
  ○ quality-gate impl-to-release pending
  ○ HITL: approve release        pending
  ○ /release-notes               pending

Progress: 12/20 stages completed (60%)
```

### 3.3 Console Output (status mode)

```
/pipeline-orchestrator status specs/047-sso-login/
```

Shows the current state without executing anything. Reads `pipeline-state.json` and displays progress.

### 3.4 Console Output (resume mode)

```
/pipeline-orchestrator resume specs/047-sso-login/
```

Reads `pipeline-state.json`, finds the last completed step, and continues from there.

---

## Error Handling

### Unrecoverable Failures

If a skill invocation fails in a way that `/auto-triage` can't handle:

1. Mark the current stage as `failed` in pipeline-state.json
2. Log the error details
3. Pause the pipeline
4. Alert: "Pipeline paused at stage X due to: <reason>. Run `/pipeline-orchestrator resume` after resolving."

### Context Limits

State and progress are already persisted after every step. On resume or context compaction:

1. Read `pipeline-progress.md` (~400 tokens) — instant orientation, not conversation replay (~30K+)
2. Read `pipeline-state.json` for machine-precise step data
3. Load only the next stage's input files — do not re-read completed outputs

### Concurrent Pipelines

Multiple pipelines can run concurrently (different specs). The orchestrator checks for file conflicts between pipelines via:
- Comparing task file lists across active pipelines
- Alerting if two pipelines modify the same files

---

## Modes

### Run Mode (Default)
```
/pipeline-orchestrator run "Add OAuth2 login with Google and GitHub providers"
/pipeline-orchestrator run specs/047-sso-login/spec.md
/pipeline-orchestrator run specs/047-sso-login/spec.md --gates strict
/pipeline-orchestrator run --from task-gen --to spec-review specs/047-sso-login/
```

### Resume Mode
```
/pipeline-orchestrator resume specs/047-sso-login/
```

### Status Mode
```
/pipeline-orchestrator status specs/047-sso-login/
/pipeline-orchestrator status --all
```

### Dry-Run
```
/pipeline-orchestrator run --dry-run "Add OAuth2 login"
```
Shows the pipeline DAG, gate profile, and estimated stage count without executing anything.

---

## Output

1. **Primary:** `specs/<NNN>-<slug>/pipeline-state.json` — persistent pipeline state for resume capability
2. **All upstream skill outputs:** spec.md, plan.md, tasks.md, board-mapping.json, reports, gate reports
3. **Console:** Real-time progress display with stage status, timing, and current activity
4. **Side effects:** All skill side effects (PM tool updates, work item creation, implementation code)
