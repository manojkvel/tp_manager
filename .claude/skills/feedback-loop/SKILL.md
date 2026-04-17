---
name: feedback-loop
description: Analyze pipeline execution history to identify patterns, calibrate estimates, measure skill effectiveness, and produce actionable tuning recommendations. Feeds improvements back into skill prompts, gate thresholds, and scheduling heuristics. Run after each pipeline completion or periodically across all pipelines.
argument-hint: "analyze|calibrate|recommend [path/to/spec-or-all]"
allowed-tools: Read, Write, Grep, Glob, Bash(git log, git diff, git show, ls, find, cat, wc, date, jq)
---

# Feedback Loop — Pipeline Self-Improvement

The pipeline gets better by learning from its own execution history. `/feedback-loop` is the mechanism: it analyzes completed pipeline runs, identifies patterns in failures, calibrates effort estimates against actuals, measures which skills and recovery strategies are effective, and produces concrete tuning recommendations.

This replaces sprint retrospectives with data-driven continuous improvement. Instead of "we should estimate better" in a retro, the feedback loop says "IMPLEMENT tasks in the auth domain take 1.8× longer than estimated — adjust the effort heuristic."

## What It Analyzes

| Data Source | What It Reveals |
|------------|----------------|
| `pipeline-state.json` | Stage durations, bottlenecks, pipeline velocity |
| `triage-log.json` | Failure patterns, recovery success rates, escalation frequency |
| `gate-history.json` | Gate pass rates, most-failed criteria, quality trends |
| `execution-schedule.json` vs actuals | Estimation accuracy, parallel efficiency |
| `board-mapping.json` | Cycle time, lead time, throughput |
| `spec.v*.md` version history | Spec stability, revision patterns |
| `reprocess-manifest.json` history | Re-work frequency, blast radius accuracy |

## CRITICAL RULES

1. **Recommendations are specific and actionable.** Not "improve estimation" but "increase M → L for IMPLEMENT tasks touching auth/ files."
2. **Calibration is statistical.** Use medians and percentiles, not averages. Outliers skew averages; P50 and P85 tell the real story.
3. **Minimum sample size.** Don't make recommendations from fewer than 3 pipeline runs. Early data is noisy.
4. **Recommendations are suggestions, not auto-applied.** Changing gate thresholds, effort heuristics, or skill prompts requires human review. Output a recommendation file that the human can review and approve.

---

## Phase 0 — Collect Execution Data

### 0.1 Discover Completed Pipelines

```
Glob: specs/*/pipeline-state.json
Filter: status == "completed"
Sort: completed_at descending
```

### 0.2 Extract Metrics per Pipeline

For each completed pipeline, extract:

**Timing metrics:**
- Total pipeline duration (start to release)
- Per-stage duration (spec-gen, plan-gen, task-gen, etc.)
- Per-task duration (from wave execution)
- HITL gate wait time (time between gate-briefing and approval)
- Re-processing time (spec-evolve branches)

**Quality metrics:**
- Gate pass rate (first attempt vs after recovery)
- Triage recovery rate (RECOVERED vs ESCALATED)
- Spec revision count
- Test coverage achieved
- Security findings count
- Spec compliance score

**Estimation metrics:**
- Estimated effort (from tasks.md) vs actual duration (from pipeline-state.json)
- Planned waves vs actual waves (did re-scheduling happen?)
- Parallel efficiency (actual vs theoretical)

---

## Phase 1 — Analyze Patterns

### 1.1 Estimation Calibration

```
For each task type (TEST, IMPLEMENT, MIGRATE, CONFIGURE, DOCUMENT):
  For each effort size (XS, S, M, L, XL):
    actual_durations = collect from all completed pipelines
    estimated_duration = effort_to_duration(size)

    calibration_factor = P50(actual_durations) / estimated_duration
    accuracy_band = P85(actual_durations) / P50(actual_durations)

    if calibration_factor > 1.5:
      recommendation: "IMPLEMENT tasks estimated as M actually take L — adjust heuristic"
    if calibration_factor < 0.5:
      recommendation: "TEST tasks estimated as M actually take S — estimates are too conservative"
```

**Domain-specific calibration:**
```
Group tasks by file domain (auth/, api/, models/, ui/):
  Compute calibration factor per domain
  if domain-specific factor differs significantly from global:
    recommendation: "auth/ domain tasks take 1.8× longer — apply domain multiplier"
```

### 1.2 Failure Pattern Analysis

```
For each failure classification in triage-log.json:
  frequency = count across all pipelines
  recovery_rate = RECOVERED / (RECOVERED + ESCALATED)
  avg_attempts = mean(recovery_attempts)

  if frequency high AND recovery_rate low:
    recommendation: "TEST_FAILURE in auth/ tasks has 30% recovery rate — improve test generation prompts for auth domain"

  if frequency high AND recovery_rate high:
    info: "REVIEW_FINDING is common but 90% auto-recovered — working as designed"

  if avg_attempts consistently == max_retries:
    recommendation: "SECURITY_FINDING always exhausts retries — recovery strategy needs improvement"
```

### 1.3 Gate Effectiveness Analysis

```
For each gate type:
  pass_rate_first_attempt = PASS on first eval / total evals
  most_failed_criteria = top 3 criteria by failure count

  if pass_rate_first_attempt < 50%:
    recommendation: "plan-to-tasks gate fails 60% on first attempt — upstream /plan-gen may need better prompts"

  if specific criterion always fails then passes after recovery:
    recommendation: "test_coverage always fails then recovers — consider adjusting threshold from 80% to 75% or improving /test-gen"
```

### 1.4 Spec Stability Analysis

```
For each spec:
  revision_count = count(spec.v*.md)
  revisions_by_trigger = group by trigger source

  if revision_count > 3:
    alert: "spec revised 4 times — instability"
    if most revisions triggered by implementation:
      recommendation: "spec ambiguity detected at implementation — improve /spec-gen prompts for clearer ACs"
    if most revisions triggered by stakeholder:
      recommendation: "requirements unstable — recommend more upfront stakeholder alignment"
```

### 1.5 Skill Effectiveness Ranking

```
For each skill:
  invocation_count = total across pipelines
  avg_duration = mean execution time
  downstream_failure_rate = how often the next stage fails because of this skill's output
  rework_rate = how often this skill's output needs re-running due to spec evolution

  Rank skills by downstream_failure_rate:
  if /task-gen has high downstream failure rate:
    recommendation: "task-gen output frequently causes implementation failures — review task description quality"
```

---

## Phase 2 — Produce Recommendations

### 2.1 Write Feedback Report

Save `reports/feedback-loop-<date>.md`:

```markdown
# Pipeline Feedback Report
**Date:** 2026-02-16
**Pipelines Analyzed:** 5 completed
**Period:** 2026-01-15 to 2026-02-16

## Estimation Calibration

| Task Type | Size | Estimated | Actual (P50) | Actual (P85) | Factor | Recommendation |
|-----------|------|-----------|-------------|-------------|--------|----------------|
| IMPLEMENT | M    | 1hr       | 1.8hr       | 2.5hr       | 1.8×   | Upgrade to L |
| IMPLEMENT | L    | 2hr       | 2.2hr       | 3.1hr       | 1.1×   | Accurate |
| TEST      | M    | 1hr       | 0.5hr       | 0.8hr       | 0.5×   | Downgrade to S |
| MIGRATE   | L    | 2hr       | 3.5hr       | 5.0hr       | 1.75×  | Upgrade to XL |

**Domain multipliers:**
- `auth/` domain: 1.8× (auth tasks consistently underestimated)
- `api/` domain: 1.0× (accurate)
- `models/` domain: 0.7× (overestimated)

## Failure Patterns

| Classification | Frequency | Recovery Rate | Avg Attempts | Trend |
|---------------|-----------|--------------|-------------|-------|
| TEST_FAILURE | 23 | 87% | 1.4 | Stable |
| REVIEW_FINDING | 18 | 94% | 1.1 | Improving |
| SPEC_AMBIGUITY | 8 | 25% | 1.0 | Concerning ↑ |
| SECURITY_FINDING | 5 | 60% | 2.3 | Stable |

**Top recommendation:** SPEC_AMBIGUITY has low recovery rate and increasing frequency.
Root cause: /spec-gen produces ACs that are testable but not implementation-precise.
Action: Update /spec-gen prompts to require implementation-level detail in ACs.

## Gate Effectiveness

| Gate | First-attempt Pass Rate | Most Failed Criterion |
|------|------------------------|----------------------|
| spec-to-plan | 80% | open_questions (60% of failures) |
| plan-to-tasks | 70% | ac_traceability (50% of failures) |
| tasks-to-impl | 90% | — |
| impl-to-release | 60% | test_coverage (70% of failures) |

**Top recommendation:** impl-to-release gate: test_coverage is the bottleneck.
Either improve /test-gen to produce higher-coverage tests, or adjust threshold from 80% to 75%.

## Pipeline Velocity Trend

| Pipeline | Duration | Stages | Avg Stage Duration |
|----------|----------|--------|-------------------|
| pipe-043 | 4.2hr | 18 | 14min |
| pipe-044 | 3.8hr | 16 | 14min |
| pipe-045 | 5.1hr | 22 | 14min |
| pipe-046 | 3.5hr | 16 | 13min |
| pipe-047 | 4.0hr | 20 | 12min |

Velocity is improving (14min → 12min per stage). Primary driver: fewer gate failures.

## Actionable Recommendations

1. **[HIGH]** Update /spec-gen prompts to require implementation-level AC detail
   - Expected impact: reduce SPEC_AMBIGUITY failures by ~50%
   - Apply to: /spec-gen SKILL.md, Phase 2 AC generation

2. **[HIGH]** Adjust effort heuristic for IMPLEMENT tasks in auth/ domain
   - Current: M = 1hr, L = 2hr
   - Recommended: M = 1.8hr, L = 3.5hr (for auth/ domain)
   - Apply to: /wave-scheduler duration estimates

3. **[MEDIUM]** Improve /test-gen coverage for edge cases
   - 70% of impl-to-release gate failures are test coverage
   - Apply to: /test-gen SKILL.md, edge case generation phase

4. **[LOW]** Consider reducing impl-to-release test coverage threshold to 75%
   - Current 80% threshold is achieved only 60% of first attempts
   - 75% is achieved 85% of first attempts
   - Apply to: gate-config.json
```

### 2.2 Console Output

```
Feedback Loop Analysis
━━━━━━━━━━━━━━━━━━━━━━
Pipelines analyzed: 5 (Jan 15 — Feb 16)

Estimation accuracy:
  IMPLEMENT tasks: 1.8× underestimated (auth/ domain: 1.8×)
  TEST tasks: 0.5× overestimated
  Overall calibration improving: 1.4× → 1.2× over period

Failure patterns:
  Most common: TEST_FAILURE (23, 87% auto-recovered)
  Most concerning: SPEC_AMBIGUITY (8, 25% auto-recovered, trending ↑)

Top recommendations:
  1. [HIGH] Improve /spec-gen AC precision (reduce ambiguity failures)
  2. [HIGH] Adjust auth/ domain effort multiplier to 1.8×
  3. [MEDIUM] Improve /test-gen edge case coverage

Report: reports/feedback-loop-2026-02-16.md
```

---

## Modes

```
/feedback-loop analyze specs/047-sso-login/
/feedback-loop analyze --all
/feedback-loop calibrate --all
/feedback-loop recommend --all
```

---

## Output

1. **Primary:** `reports/feedback-loop-<date>.md` — comprehensive analysis with recommendations
2. **Calibration data:** `pipeline-calibration.json` — estimation calibration factors for /wave-scheduler
3. **Console summary:** Key metrics, trends, and top recommendations
