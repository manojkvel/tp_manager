---
name: quality-gate
description: Automated stage gate enforcement between pipeline stages — validates quality criteria (test coverage, security findings, spec compliance, API contracts) before allowing progression. Blocks the pipeline and routes to /auto-triage or HITL gate when thresholds are not met. Use between every major pipeline stage transition.
argument-hint: "spec-to-plan|plan-to-tasks|tasks-to-impl|impl-to-release [--strict] path/to/artifact"
allowed-tools: Read, Write, Grep, Glob, Bash(git diff, git log, git show, date)
---

# Quality Gate — Pipeline Stage Gate Enforcement

An automated gate that sits between pipeline stages and blocks progression if quality thresholds aren't met. This is not a report — it's an actual decision point. Pass means the pipeline continues. Fail means the pipeline stops and routes to either `/auto-triage` (automated recovery) or a HITL gate (human decision required).

Without quality gates, the pipeline is a conveyor belt that pushes artifacts forward regardless of quality. A spec with missing ACs becomes a plan with gaps, becomes tasks with ambiguities, becomes implementation with defects. Quality gates break this cascade by catching problems at the earliest stage where they're cheapest to fix.

## Gate Types

| Gate | Between | What It Checks |
|------|---------|---------------|
| `spec-to-plan` | /spec-gen (or /spec-evolve) → /plan-gen | Spec completeness, AC clarity, constraint coverage |
| `plan-to-tasks` | /plan-gen → /task-gen | Plan feasibility, AC traceability, risk assessment |
| `tasks-to-impl` | /task-gen → /task-implementer | Task quality, dependency validity, agent-readiness accuracy |
| `impl-to-release` | /task-implementer → /release-readiness-checker | Test coverage, security, compliance, spec conformance |
| `spec-version` | /spec-evolve → downstream re-processing | Version consistency, blast radius plausibility, constraint inheritance |

## CRITICAL RULES

1. **Gates are binary: PASS or FAIL.** No "pass with warnings." If a criterion fails, the gate fails. Advisory information goes in the gate report but doesn't affect the decision.
2. **Failed gates produce actionable routing.** Every failure includes: what failed, why, and where to route (which /auto-triage path or HITL gate).
3. **Gate criteria are configurable but have sensible defaults.** Teams can adjust thresholds via `gate-config.json`, but the defaults enforce reasonable quality.
4. **Spec version consistency is always checked.** At every gate, verify that the artifacts being consumed are based on the current spec version. If the spec was amended after the upstream artifact was generated, the gate blocks.
5. **Gate results are recorded.** Every gate evaluation is logged to `gate-history.json` for `/feedback-loop` analysis.

---

## Phase 0 — Determine Gate Type

### 0.1 Auto-detect from Context

If no gate type is specified, infer from the artifacts present:
```
Spec exists + no plan        → spec-to-plan
Plan exists + no tasks       → plan-to-tasks
Tasks exist + no impl report → tasks-to-impl
Impl report exists           → impl-to-release
spec.v{N}.md with N > 1     → spec-version
```

### 0.2 Load Gate Configuration

Read `gate-config.json` if it exists in the project root or spec directory:

```json
{
  "spec-to-plan": {
    "min_acceptance_criteria": 3,
    "require_business_rules": true,
    "require_constraints": true,
    "require_glossary": false,
    "max_open_questions": 0
  },
  "plan-to-tasks": {
    "require_ac_traceability": true,
    "require_risk_assessment": true,
    "require_rollback_strategy": true,
    "max_unaddressed_risks": 2
  },
  "tasks-to-impl": {
    "require_dependency_ordering": true,
    "require_dod_per_task": true,
    "min_agent_ready_ratio": 0.5,
    "require_effort_estimates": true
  },
  "impl-to-release": {
    "min_test_coverage": 80,
    "max_critical_findings": 0,
    "max_high_findings": 3,
    "require_spec_review_pass": true,
    "require_no_blocked_tasks": true
  }
}
```

If no config exists, use the defaults shown above.

### 0.3 Verify Spec Version Consistency

Before evaluating any gate, check that artifacts are based on the current spec version:

```
Read spec.md → extract version (from YAML frontmatter or filename)
Read plan.md → check if it references the current spec version
Read tasks.md → check if it references the current plan version
Read board-mapping.json → check synced_at timestamp vs spec modification time
```

If any artifact is stale (based on an older spec version), the gate FAILS with routing to `/spec-evolve` to generate a re-processing manifest.

---

## Phase 1 — Collect Evidence

### 1.1 Spec-to-Plan Gate

Evaluate the spec for completeness:

| Criterion | Check | Default Threshold |
|-----------|-------|-------------------|
| Acceptance criteria count | Count `AC-` entries | ≥ 3 |
| AC measurability | Each AC has a testable condition | 100% |
| Business rules defined | `BR-` entries present | ≥ 1 (if require_business_rules) |
| Constraints specified | Security, performance, compliance sections | Present (if require_constraints) |
| Open questions | Count unresolved questions | 0 |
| User flows | At least one primary flow described | ≥ 1 |
| Edge cases | Error/edge case handling mentioned | ≥ 1 |
| Glossary | Domain terms defined | Present (if require_glossary) |

### 1.2 Plan-to-Tasks Gate

Evaluate the plan for feasibility:

| Criterion | Check | Default Threshold |
|-----------|-------|-------------------|
| AC traceability | Every AC has ≥ 1 plan phase | 100% |
| Phase structure | Phases have clear goals, file lists, effort | All phases |
| Risk assessment | Risks identified with mitigations | Present |
| Rollback strategy | Rollback approach defined | Present |
| Dependency identification | External dependencies listed | Present |
| Unaddressed risks | HIGH/CRITICAL risks without mitigation | ≤ 2 |

### 1.3 Tasks-to-Implementation Gate

Evaluate the task breakdown:

| Criterion | Check | Default Threshold |
|-----------|-------|-------------------|
| Dependency ordering | DAG is acyclic, ordering is valid | Valid |
| Definition of Done | Every task has DoD checklist | 100% |
| Agent-readiness ratio | Fraction of tasks marked agent-ready | ≥ 50% |
| Effort estimates | Every task has size estimate | 100% |
| AC traceability | Every AC has ≥ 1 task | 100% |
| File conflict check | No two tasks in same wave modify same file | No conflicts |

### 1.4 Implementation-to-Release Gate

Evaluate implementation readiness:

| Criterion | Check | Default Threshold |
|-----------|-------|-------------------|
| Test coverage | Line/branch coverage from reports | ≥ 80% |
| Critical security findings | From /security-audit | 0 |
| High security findings | From /security-audit | ≤ 3 |
| Spec compliance | From /spec-review verdict | PASS or MOSTLY_COMPLIANT (≥ 85%) |
| Blocked tasks | Tasks still in BLOCKED state | 0 |
| Review findings | Unresolved CRITICAL/HIGH from /review | 0 CRITICAL |
| API contract | From /api-contract-analyzer | No breaking changes |
| License compliance | From /license-compliance-audit | No HIGH violations |

### 1.5 Spec-Version Gate

Evaluate spec evolution consistency:

| Criterion | Check | Default Threshold |
|-----------|-------|-------------------|
| Version consistency | Downstream artifacts reference current spec version | All current |
| Blast radius plausibility | CLARIFICATION → low impact, SCOPE_ADDITION → high impact | Plausible |
| Constraint inheritance | Child specs preserve parent constraints | 100% |
| Manifest completeness | Re-processing manifest covers all affected artifacts | Complete |

---

## Phase 2 — Evaluate Pass/Fail

### 2.1 Score Each Criterion

For each criterion:
```
PASS  — meets or exceeds threshold
FAIL  — below threshold
N/A   — criterion not applicable (e.g., no security audit report exists for spec-to-plan gate)
```

### 2.2 Determine Gate Decision

```
If ALL criteria are PASS or N/A → GATE: PASS
If ANY criterion is FAIL → GATE: FAIL
```

In `--strict` mode: N/A criteria are treated as FAIL (all evidence must be present).

### 2.3 Classify Failures

For each failed criterion, determine the recovery route:

| Failure Type | Route | Example |
|-------------|-------|---------|
| Auto-recoverable | `/auto-triage` | Test coverage too low → generate more tests |
| Spec issue | `/spec-evolve` | Missing ACs → revise spec |
| Plan issue | Re-run `/plan-gen` | Missing rollback strategy |
| Task issue | Re-run `/task-gen` | Missing DoD on tasks |
| Human decision | HITL gate | Architecture trade-off, scope decision |
| External dependency | HITL gate + escalation | Waiting for API keys, third-party approval |

---

## Phase 3 — Produce Gate Report

### 3.1 Write Gate Report

Save `specs/<NNN>-<slug>/gate-<type>-<date>.md`:

```markdown
# Quality Gate Report: spec-to-plan
**Date:** 2026-02-16T14:30:00Z
**Spec:** specs/047-sso-login/spec.v3.md
**Decision:** FAIL

## Results

| Criterion | Status | Value | Threshold | Notes |
|-----------|--------|-------|-----------|-------|
| Acceptance criteria | PASS | 7 | ≥ 3 | |
| AC measurability | FAIL | 6/7 (86%) | 100% | AC-4 not testable: "system should be fast" |
| Business rules | PASS | 4 | ≥ 1 | |
| Constraints | PASS | Present | Present | |
| Open questions | FAIL | 2 | 0 | OQ-1: Auth provider selection; OQ-2: Token storage |
| User flows | PASS | 3 | ≥ 1 | |

## Failures

### AC-4 not measurable
**Route:** /spec-evolve resolve
**Action:** Rewrite AC-4 with specific performance target (e.g., "SSO login completes within 3 seconds P95")

### 2 open questions unresolved
**Route:** HITL gate
**Action:** Human must answer OQ-1 and OQ-2 before planning can proceed

## Recommendation
Resolve AC-4 via /spec-evolve resolve (automated), then escalate OQ-1 and OQ-2 to HITL gate for human decision.
```

### 3.2 Update Gate History

Append to `gate-history.json`:

```json
{
  "type": "spec-to-plan",
  "spec": "specs/047-sso-login/spec.v3.md",
  "date": "2026-02-16T14:30:00Z",
  "decision": "FAIL",
  "criteria_passed": 5,
  "criteria_failed": 2,
  "failures": ["ac_measurability", "open_questions"],
  "routes": ["/spec-evolve resolve", "HITL gate"]
}
```

### 3.3 Console Output

```
Quality Gate: spec-to-plan — SSO Login
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Spec version: v3
Decision:     ✗ FAIL (5 passed, 2 failed, 1 N/A)

Failures:
  ✗ AC measurability   86% (need 100%) — AC-4 not testable
  ✗ Open questions     2 (need 0) — OQ-1, OQ-2 unresolved

Recovery routing:
  → /spec-evolve resolve AC-4 (auto-recoverable)
  → HITL gate for OQ-1, OQ-2 (human decision required)

Report: specs/047-sso-login/gate-spec-to-plan-2026-02-16.md
```

---

## Integration with Pipeline

### With /pipeline-orchestrator
The orchestrator invokes `/quality-gate` between every stage. On PASS, it proceeds to the next stage. On FAIL, it reads the recovery routes and dispatches to `/auto-triage` or pauses at a HITL gate.

### With /auto-triage
When a gate fails with auto-recoverable routes, `/auto-triage` executes the recovery (e.g., run `/spec-evolve resolve`, then re-evaluate the gate). If recovery succeeds and the gate passes on re-evaluation, the pipeline continues without human intervention.

### With /feedback-loop
`/feedback-loop` analyzes `gate-history.json` to find patterns: which gates fail most often, which criteria are the bottleneck, and whether gate pass rates are improving over time.

### With /gate-briefing
When a gate fails and routes to a HITL gate, `/gate-briefing` uses the gate report to produce a human-readable decision briefing.

---

## Modes

```
/quality-gate spec-to-plan specs/047-sso-login/spec.v3.md
/quality-gate plan-to-tasks specs/047-sso-login/plan.md
/quality-gate tasks-to-impl specs/047-sso-login/tasks.md
/quality-gate impl-to-release specs/047-sso-login/
/quality-gate spec-version specs/047-sso-login/spec.v3.md
/quality-gate impl-to-release --strict specs/047-sso-login/
```

---

## Output

1. **Decision:** PASS or FAIL (binary, machine-consumable)
2. **Gate report:** `specs/<NNN>-<slug>/gate-<type>-<date>.md` — detailed results with failure routes
3. **Gate history:** `gate-history.json` — append-only log for trend analysis
4. **Console summary:** Pass/fail counts, failure details, recovery routing
