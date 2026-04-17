---
name: pipeline-monitor
description: Continuous health monitoring for running SDLC pipelines — detects stuck tasks, quality regressions, fix loops, resource conflicts, stale artifacts, and unresolved impediments. Produces a live health dashboard and triggers alerts when anomalies exceed thresholds.
argument-hint: "scan|dashboard|alerts [--threshold strict|normal|relaxed] [path/to/spec-or-all]"
allowed-tools: Read, Write, Grep, Glob, Bash(git log, git diff, git show, ls, find, cat, wc, date, jq)
---

# Pipeline Monitor — Continuous Pipeline Health

Replaces daily standups and manual sprint health checks with continuous automated monitoring. Instead of asking "what's blocked?" in a meeting, the monitor detects problems as they happen and surfaces them before they compound.

## What It Monitors

| Signal | Source | Anomaly Threshold |
|--------|--------|-------------------|
| Stuck tasks | pipeline-state.json | Task in_progress > 2× estimated effort duration |
| Fix loops | triage-log.json | Same failure class recurring > 3 times for same task |
| Quality regression | gate-history.json | Gate pass rate declining across consecutive evaluations |
| Resource conflicts | execution-schedule.json + git diff | Two active tasks modifying same file |
| Stale artifacts | spec timestamps vs downstream timestamps | Downstream artifact older than current spec version |
| Unresolved impediments | triage-log.json | Escalated items with no HITL decision > 24 hours |
| Spec instability | spec.v*.md versions | Spec revised > 3 times (thrashing signal) |
| Pipeline velocity | pipeline-state.json | Stages completing slower than historical average |
| Child pipeline drift | child pipeline-state.json | Child pipeline blocked or failed while parent proceeds |

## CRITICAL RULES

1. **Monitor doesn't fix — it alerts.** The monitor surfaces problems for `/auto-triage` or HITL resolution. It never modifies artifacts.
2. **Thresholds are configurable.** What counts as "stuck" depends on task complexity. Defaults are sensible but adjustable.
3. **Alert fatigue is worse than missing alerts.** Only surface actionable anomalies. Normal variance in task duration isn't an alert.
4. **Historical baselines improve over time.** As `/feedback-loop` accumulates data, the monitor's thresholds become more accurate.

---

## Phase 0 — Collect Pipeline State

### 0.1 Discover Active Pipelines

```
Glob: specs/*/pipeline-state.json
Filter: status != "completed" and status != "cancelled"
```

For `--all` mode, monitor every active pipeline. For a specific spec path, monitor just that pipeline.

### 0.2 Load State and History

For each active pipeline, read:
- `pipeline-state.json` — current stage, task statuses, timing
- `execution-schedule.json` — planned waves, effort estimates
- `triage-log.json` — recovery attempts, escalations
- `gate-history.json` — gate pass/fail history
- `board-mapping.json` — PM tool sync state
- `reprocess-manifest.json` — pending spec evolution re-processing
- `spec.v*.md` — version count
- Child pipeline states (if any)

---

## Phase 1 — Detect Anomalies

### 1.1 Stuck Task Detection

For each in_progress task:
```
elapsed = now - task.started_at
expected = effort_to_duration(task.effort_estimate)
  XS: 10min, S: 30min, M: 1hr, L: 2hr, XL: 4hr

if elapsed > 2 × expected:
  alert: STUCK_TASK (severity: WARNING)
if elapsed > 4 × expected:
  alert: STUCK_TASK (severity: CRITICAL)
```

### 1.2 Fix Loop Detection

For each task in triage-log.json:
```
recovery_count = count(attempts for this task with same classification)

if recovery_count >= 3:
  alert: FIX_LOOP (severity: HIGH)
  detail: "TASK-005 has failed 3 times with TEST_FAILURE — recovery strategy isn't working"
```

### 1.3 Quality Regression Detection

Compare consecutive gate evaluations:
```
if gate_pass_rate(last 3) < gate_pass_rate(previous 3):
  alert: QUALITY_REGRESSION (severity: WARNING)
  detail: "impl-to-release gate pass rate: 80% → 60% over last 3 evaluations"
```

### 1.4 Resource Conflict Detection

Check for concurrent modifications:
```
active_tasks = tasks with status == in_progress
for each pair (task_A, task_B) in active_tasks:
  if files_overlap(task_A.files, task_B.files):
    alert: RESOURCE_CONFLICT (severity: HIGH)
    detail: "TASK-003 and TASK-006 both modifying src/auth/service.ts"
```

### 1.5 Stale Artifact Detection

```
spec_mtime = max(mtime of spec.md, spec.v*.md)
plan_mtime = mtime of plan.md
tasks_mtime = mtime of tasks.md

if plan_mtime < spec_mtime:
  alert: STALE_ARTIFACT (severity: HIGH)
  detail: "plan.md based on spec v2 but spec is now v3"

if tasks_mtime < plan_mtime:
  alert: STALE_ARTIFACT (severity: HIGH)
  detail: "tasks.md generated before plan was updated"
```

### 1.6 Impediment Aging

```
for each escalated item in triage-log.json:
  if escalated_at + 24h < now and no hitl_decision:
    alert: AGING_IMPEDIMENT (severity: WARNING if <48h, HIGH if ≥48h)
    detail: "TASK-008 escalated 36 hours ago, no HITL decision yet"
```

### 1.7 Spec Instability Detection

```
version_count = count(spec.v*.md files)
if version_count > 3:
  alert: SPEC_INSTABILITY (severity: WARNING)
  detail: "spec has been revised 4 times — requirements may be unstable"
```

### 1.8 Pipeline Velocity Tracking

```
completed_stages = stages with status == completed
avg_stage_duration = mean(completed_at - started_at for each stage)
historical_avg = from feedback-loop data (if available)

if avg_stage_duration > 1.5 × historical_avg:
  alert: VELOCITY_DEGRADATION (severity: INFO)
```

### 1.9 Child Pipeline Health

```
for each child_pipeline in pipeline-state.json:
  child_state = read child pipeline-state.json
  if child_state.status == "failed" or child_state.current_stage stuck:
    alert: CHILD_PIPELINE_ISSUE (severity: WARNING)
    detail: "Child pipeline 048-sso-admin is blocked at gate-spec-to-plan"
```

---

## Phase 2 — Produce Health Dashboard

### 2.1 Dashboard Format

Save `specs/<NNN>-<slug>/pipeline-health.md` (or `pipeline-health-all.md` for `--all` mode):

```markdown
# Pipeline Health Dashboard
**Generated:** 2026-02-16T14:30:00Z
**Active Pipelines:** 3

## pipe-047-sso-login
**Status:** IN PROGRESS (wave 2 of 4)
**Health:** ⚠ WARNING (2 alerts)

| Metric | Value | Status |
|--------|-------|--------|
| Progress | 60% (12/20 stages) | ● On track |
| Current wave | 2 of 4 | ● Normal |
| Stuck tasks | 0 | ● Clear |
| Fix loops | 0 | ● Clear |
| Stale artifacts | 0 | ● Current |
| Pending HITL | 0 | ● Clear |
| Spec version | v3 (3 revisions) | ⚠ Instability |
| Triage escalations | 1 pending (36h) | ⚠ Aging |

### Alerts
1. ⚠ SPEC_INSTABILITY — spec revised 3 times, requirements may be unstable
2. ⚠ AGING_IMPEDIMENT — TASK-008 escalated 36 hours ago, no decision yet

## pipe-048-sso-admin (child of pipe-047)
**Status:** WAITING (gate: approve-spec)
**Health:** ● HEALTHY

## pipe-050-rbac
**Status:** IN PROGRESS (plan-gen)
**Health:** ● HEALTHY
```

### 2.2 Console Output (scan mode)

```
Pipeline Monitor — Scan
━━━━━━━━━━━━━━━━━━━━━━
Active pipelines: 3

pipe-047-sso-login    ⚠ WARNING  60% complete  2 alerts
pipe-048-sso-admin    ● HEALTHY  waiting       0 alerts
pipe-050-rbac         ● HEALTHY  20% complete  0 alerts

Alerts:
  ⚠ [pipe-047] SPEC_INSTABILITY — spec revised 3 times
  ⚠ [pipe-047] AGING_IMPEDIMENT — TASK-008 escalated 36h ago

Dashboard: specs/047-sso-login/pipeline-health.md
```

### 2.3 Alert Routing

Alerts are also:
- Posted as comments on the relevant PM tool work item via `/board-sync`
- Logged in `pipeline-state.json` for `/feedback-loop` analysis
- Surfaced in the next `/gate-briefing` if a HITL gate is pending

---

## Modes

```
/pipeline-monitor scan specs/047-sso-login/
/pipeline-monitor scan --all
/pipeline-monitor dashboard specs/047-sso-login/
/pipeline-monitor alerts --threshold strict specs/047-sso-login/
```

---

## Output

1. **Dashboard:** `specs/<NNN>-<slug>/pipeline-health.md` — health status per pipeline with metrics and alerts
2. **Console summary:** Pipeline status overview with alert count and severity
3. **Side effects:** Alerts posted to PM tool work items (via /board-sync), alert history in pipeline-state.json
