---
name: slo-sla-tracker
description: Track service-level objectives against actual metrics, calculate error budgets, and flag SLO breaches
argument-hint: "['full'|'summary'|service-name]"
allowed-tools: Read, Write, Grep, Glob, Bash(git log, cat, ls, node, date)
---

# SLO/SLA Tracker

Read your defined service-level objectives (SLOs), compare them against actual metrics from your codebase, pipeline history, and reports, and calculate error budget consumption. Flags breaches, tracks trends, and gives early warning when you're burning through your error budget too fast.

## Step 1 — Load SLO Definitions

Check for an SLO definition file:
```
Glob: slo.yml, slo.yaml, .slo.yml, docs/slo.yml, config/slo.yml, slo.json
```

If an SLO file exists, parse it. Expected format:

```yaml
services:
  - name: api-gateway
    slos:
      - metric: availability
        target: 99.9%
        window: 30d
        description: "API uptime measured by successful responses / total responses"
      - metric: latency_p99
        target: 200ms
        window: 30d
        description: "99th percentile response time"
      - metric: error_rate
        target: 0.1%
        window: 30d
        description: "Percentage of 5xx responses"

  - name: worker-service
    slos:
      - metric: processing_time_p95
        target: 5s
        window: 30d
      - metric: failure_rate
        target: 1%
        window: 30d

team_slos:
  - metric: deployment_frequency
    target: "2/week"
    window: 30d
    description: "Number of production deployments per week"
  - metric: lead_time
    target: "48h"
    window: 30d
    description: "Time from commit to production"
  - metric: change_failure_rate
    target: 5%
    window: 30d
    description: "Percentage of deployments causing incidents"
  - metric: mttr
    target: "4h"
    window: 30d
    description: "Mean time to recover from failures"
```

If no SLO file exists, create a template at `slo.yml` with DORA metrics as defaults, and inform the user to customize it.

### Default SLO Template (DORA Metrics)

If no SLO file exists, use these software delivery SLOs:

| Metric | Target | Window | Source |
|--------|--------|--------|--------|
| Deployment Frequency | ≥ 2/week | 30 days | Git tags, pipeline runs |
| Lead Time for Changes | ≤ 48 hours | 30 days | Commit-to-deploy time |
| Change Failure Rate | ≤ 5% | 30 days | Incidents after deploys |
| Mean Time to Recovery | ≤ 4 hours | 30 days | Incident resolution time |
| Test Pass Rate | ≥ 98% | 30 days | Test run reports |
| Code Review Turnaround | ≤ 24 hours | 30 days | PR open-to-merge time |

## Step 2 — Gather Actual Metrics

### From Git History

**Deployment Frequency:**
```bash
# Count deployments (tagged releases) in the last 30 days
git tag --sort=-v:refname | while read tag; do git log -1 --format='%ai' "$tag"; done | head -20
# Or count merges to main/release branches
git log main --merges --oneline --since='30 days ago' | wc -l
```

**Lead Time for Changes:**
```bash
# For each recent merge/deploy, find when the first commit was made
git log main --merges --format='%H %ai %s' --since='30 days ago' | head -10
# Then for each, find the oldest commit in the PR/branch
```

**Change Failure Rate:**
```bash
# Deployments followed by hotfixes or reverts within 48 hours
git log --all --oneline --grep='hotfix\|revert\|rollback' --since='30 days ago' | wc -l
# vs. total deployments in same period
```

### From Existing Reports

**Test Pass Rate:**
```bash
ls -t reports/regression-check-*.md 2>/dev/null | head -5
```
Parse `tests_passed`, `tests_failed` from YAML front-matter.

**Security Posture:**
```bash
ls -t reports/security-audit-*.md 2>/dev/null | head -5
```
Parse `critical_count`, `high_count`.

**Tech Debt Score:**
```bash
ls -t reports/tech-debt-audit-*.md 2>/dev/null | head -5
```
Parse `overall_score`.

**Code Review Turnaround:**
```bash
# Average time from PR creation to merge (from merge commits)
git log main --merges --format='%ai' --since='30 days ago' | head -20
```

### From Pipeline Artifacts (if accessible)
```
Glob: **/test-results*, **/coverage*, **/build-report*
```

## Step 3 — Calculate SLO Status

For each defined SLO:

### Current Value
Compute the actual metric value from gathered data.

### Error Budget Calculation
```
Error Budget = 1 - SLO Target

For availability 99.9%:
  Error budget = 0.1% of total requests (or 43.2 minutes/month downtime)

Budget Consumed = (actual_errors / total) / error_budget × 100%

If budget consumed > 100% → SLO BREACHED
If budget consumed > 80% → SLO AT RISK
If budget consumed > 50% → SLO WATCH
If budget consumed ≤ 50% → SLO HEALTHY
```

### Burn Rate
Calculate how fast the error budget is being consumed:
```
Burn Rate = budget_consumed_pct / elapsed_window_pct

Example: 60% budget consumed in first 10 days of 30-day window
  elapsed = 10/30 = 33%
  burn_rate = 60/33 = 1.82x (burning 1.82x faster than sustainable)

Burn Rate > 2.0 → CRITICAL (will exhaust budget before window ends)
Burn Rate > 1.0 → WARNING (on pace to exhaust budget)
Burn Rate ≤ 1.0 → OK (sustainable pace)
```

## Step 4 — DORA Metrics Assessment

If tracking DORA metrics, classify the team's performance tier:

| Metric | Elite | High | Medium | Low |
|--------|-------|------|--------|-----|
| Deployment Frequency | On-demand (multiple/day) | Weekly-daily | Monthly-weekly | Monthly+ |
| Lead Time | < 1 hour | 1 day-1 week | 1 week-1 month | 1-6 months |
| Change Failure Rate | 0-5% | 5-10% | 10-15% | 15%+ |
| MTTR | < 1 hour | < 1 day | < 1 week | 1 week+ |

**Current DORA Tier: <Elite/High/Medium/Low>**

## Step 5 — Trend Analysis

If previous SLO reports exist:
```bash
ls -t reports/slo-tracker-*.md 2>/dev/null | head -10
```

Compare current metrics against previous periods:
- Are SLOs improving, degrading, or stable?
- Which SLOs have the worst trend?
- Are error budgets being consumed faster than previous periods?

## Step 6 — Format Output

### SLO Status Dashboard

```
Report Period: <start> — <end>
Services Tracked: N
SLOs Defined: N
SLOs Met: N
SLOs Breached: N
```

### Service-Level Overview

| Service | SLO | Target | Actual | Status | Budget Used | Burn Rate |
|---------|-----|--------|--------|--------|-------------|-----------|
| api-gateway | Availability | 99.9% | 99.85% | ⚠️ AT RISK | 78% | 1.4x |
| api-gateway | Latency p99 | 200ms | 180ms | ✅ HEALTHY | 30% | 0.6x |
| worker | Failure Rate | 1% | 0.5% | ✅ HEALTHY | 25% | 0.5x |

### DORA Metrics

| Metric | Value | Target | Tier | Trend |
|--------|-------|--------|------|-------|
| Deployment Frequency | 3/week | ≥ 2/week | High | ↑ |
| Lead Time | 36 hours | ≤ 48 hours | High | → |
| Change Failure Rate | 8% | ≤ 5% | Medium | ↓ |
| MTTR | 3 hours | ≤ 4 hours | High | ↑ |

**Overall DORA Tier: High** (Change failure rate is dragging the score)

### Alerts

For each breached or at-risk SLO:
```
[BREACH] <service> — <SLO metric>
  Target: <target>
  Actual: <actual>
  Budget: <consumed>% consumed (<remaining> remaining)
  Burn Rate: <rate>x (will exhaust in <N days> at current rate)
  Action: <specific recommendation>
```

### Error Budget Forecast

For each SLO, project when the error budget will be exhausted at the current burn rate:
```
api-gateway/availability: Budget exhausts in 8 days (at 1.4x burn rate)
api-gateway/latency: Budget healthy, 70% remaining
worker/failure_rate: Budget healthy, 75% remaining
```

### Recommendations
1. Most urgent SLO to address
2. Quick wins to improve metrics
3. Structural changes needed for long-term improvement

## Step 7 — Save Report

Save the complete tracker output to a persistent file.

1. Create the `reports/` directory if it doesn't exist: `mkdir -p reports`
2. Get today's date: `date +%Y-%m-%d` and capture as `$DATE`
3. Determine the scope label:
   - `full`, `summary`, or the specific service name
4. Save to: `reports/slo-tracker-<scope>-<DATE>.md`
   - Include a YAML front-matter header with: `date`, `scope`, `slos_defined`, `slos_met`, `slos_breached`, `slos_at_risk`, `dora_tier`, `deployment_frequency`, `lead_time_hours`, `change_failure_rate_pct`, `mttr_hours`
5. Print the file path so the user knows where to find it

**Naming examples:**
- `reports/slo-tracker-full-2025-06-15.md`
- `reports/slo-tracker-api-gateway-2025-06-15.md`

**Tip:** Run weekly. Feed results into `/report-trends` for historical tracking. Use the DORA tier progression as a team OKR.
