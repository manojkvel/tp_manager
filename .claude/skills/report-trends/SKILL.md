---
name: report-trends
description: Analyze all saved reports to surface trends, regressions, and improvements over time
argument-hint: "[metric-or-'all' or 'dashboard']"
allowed-tools: Read, Write, Grep, Glob, Bash(ls, date, node)
---

# Report Trends

Analyze all reports in the `reports/` directory to surface trends, flag regressions, and track improvements across your skill suite over time.

## Step 1 — Discover Reports

Scan the `reports/` directory for all markdown files:

```
ls -1 reports/*.md | sort
```

Group files by skill type based on filename prefix:
- `review-*` → Code Review
- `security-audit-*` → Security
- `design-review-*` → Architecture
- `impact-analysis-*` → Impact
- `regression-check-*` → Regression
- `perf-review-*` → Performance
- `tech-debt-audit-*` → Tech Debt
- `dependency-update-*` → Dependencies
- `license-compliance-audit-*` → License Compliance
- `release-readiness-*` → Release Readiness
- `api-contract-*` → API Contracts
- `standards-audit-*` → Standards Compliance
- `approval-workflow-audit-*` → Approval Workflows
- `incident-postmortem-*` → Incidents
- `slo-tracker-*` → SLO/SLA
- `migration-tracker-*` → Migrations
- `code-ownership-*` → Code Ownership
- `task-implementer-*` → Task Implementation
- `trend-analysis-*` → Skip (these are previous trend reports)

For each file, extract the date from the filename (the `YYYY-MM-DD` portion).

## Step 2 — Parse YAML Front-Matter

Read the first 20 lines of each report file to extract the YAML front-matter block (between `---` markers). Parse key metrics:

### Per Skill Type — Key Metrics to Track

| Skill | Key Metrics |
|-------|-------------|
| review | `verdict`, `issues_count` (critical, high, medium, low) |
| security-audit | `critical_count`, `high_count`, total findings |
| design-review | `tech_debt_rating`, issue counts by severity |
| impact-analysis | `files_impacted`, `risk_level` |
| regression-check | `verdict`, `tests_passed`, `tests_failed`, `coverage_gaps` |
| perf-review | issue counts by severity, `quick_wins_count` |
| tech-debt-audit | `overall_score` (X/5), `top_debt_items_count`, `hotspots_count` |
| dependency-update | `vulnerabilities_critical`, `vulnerabilities_high`, `outdated_count` |
| license-compliance-audit | `blocked_count`, `review_required_count`, `unknown_count` |
| release-readiness | `verdict` (GO/NO_GO), `blocker_count`, `required_pass`, `required_fail` |
| api-contract | `breaking_count`, `warning_count`, `verdict` |
| standards-audit | `overall_score_pct`, `required_pass`, `required_fail`, `verdict` |
| approval-workflow-audit | `overall_score_pct`, `critical_findings`, `maturity_level` |
| incident-postmortem | `total_incidents`, `mttr_hours`, `mtbf_days`, `recurrence_rate_pct` |
| slo-tracker | `slos_met`, `slos_breached`, `slos_at_risk`, `dora_tier` |
| migration-tracker | `active_migrations`, `avg_completion_pct`, `at_risk_count`, `regressions_found` |
| code-ownership | `silos_count`, `orphaned_count`, `bus_factor_1_count` |
| task-implementer | `tasks_implemented`, `tasks_skipped`, `tests_passing`, `ac_coverage_pct`, `lines_added` |

If the YAML front-matter is missing or malformed, fall back to scanning the report body for the relevant data (e.g., search for "Overall Tech Debt Score:" or severity tables).

## Step 3 — Compute Trends

For each skill type with 2+ reports, compute:

1. **Direction**: Compare latest value to the previous value
   - `↑ Improving` — metric moved in the healthy direction
   - `↓ Degrading` — metric moved in the unhealthy direction
   - `→ Stable` — no change

2. **Velocity**: How fast is it changing?
   - Compare latest 3 reports if available
   - `Accelerating` — getting worse faster
   - `Decelerating` — rate of change is slowing
   - `Steady` — consistent rate

3. **Health status**:
   - `HEALTHY` — metric is in good range and stable/improving
   - `WATCH` — metric is acceptable but degrading
   - `WARNING` — metric is in concerning range
   - `CRITICAL` — metric needs immediate attention

### Health Thresholds

| Metric | HEALTHY | WATCH | WARNING | CRITICAL |
|--------|---------|-------|---------|----------|
| Tech debt score | 4-5 | 3-4 | 2-3 | 1-2 |
| Security critical findings | 0 | 0 (but increasing high) | 1+ | 2+ |
| Security high findings | 0-1 | 2-3 | 4-5 | 6+ |
| Test failures | 0 | 1-2 | 3-5 | 6+ |
| Coverage gaps | 0-2 | 3-5 | 6-10 | 11+ |
| Critical vulns (deps) | 0 | 0 (but high>2) | 1 | 2+ |
| Perf critical issues | 0 | 0-1 | 2-3 | 4+ |

## Step 4 — Generate Trend Report (Markdown)

Write the trend report to `reports/trend-analysis-<DATE>.md` with this structure:

```markdown
---
date: YYYY-MM-DD
report_count: N
skills_tracked: N
alerts: N
---

# Trend Analysis — YYYY-MM-DD

## Executive Summary

<1-2 sentences: overall health direction, top concern, top improvement>

## Health Dashboard

| Metric | Latest | Previous | Delta | Trend | Status |
|--------|--------|----------|-------|-------|--------|
| Tech Debt Score | 3.8/5 | 3.5/5 | +0.3 | ↑ Improving | WATCH |
| Security (Critical) | 0 | 1 | -1 | ↑ Improving | HEALTHY |
| Security (High) | 2 | 2 | 0 | → Stable | WATCH |
| Dependencies (Critical CVEs) | 0 | 2 | -2 | ↑ Improving | HEALTHY |
| Dependencies (Outdated) | 12 | 15 | -3 | ↑ Improving | WATCH |
| Test Failures | 0 | 0 | 0 | → Stable | HEALTHY |
| Coverage Gaps | 3 | 5 | -2 | ↑ Improving | WATCH |
| Perf Issues (Critical) | 1 | 0 | +1 | ↓ Degrading | WARNING |

## Alerts

List any metrics with status WARNING or CRITICAL:

> **WARNING**: Performance critical issues increased from 0 to 1. New N+1 query detected in orders service.

> **CRITICAL**: Security audit has not been run in 14 days. Last report: 2025-06-01.

## Staleness Check

Flag any skill type where the latest report is older than its expected cadence:
- security-audit: expected weekly, alert if >10 days
- dependency-update: expected weekly, alert if >10 days
- tech-debt-audit: expected monthly, alert if >35 days
- review / regression-check: expected per-PR, alert if >7 days
- perf-review: expected per-sprint, alert if >21 days
- license-compliance-audit: expected per-release, alert if >30 days
- release-readiness: expected per-release (no staleness alert)
- api-contract: expected per-PR with API changes, alert if >14 days
- standards-audit: expected quarterly, alert if >100 days
- approval-workflow-audit: expected quarterly, alert if >100 days
- incident-postmortem: expected monthly, alert if >35 days
- slo-tracker: expected weekly, alert if >10 days
- migration-tracker: expected bi-weekly, alert if >21 days
- code-ownership: expected quarterly, alert if >100 days
- task-implementer: expected per-feature (no staleness alert — triggered by /task-gen)

## Detailed Trends

### Tech Debt Score Over Time

| Date | Score | Delta | Complexity | Duplication | Patterns | Architecture | Tests | Docs |
|------|-------|-------|-----------|-------------|----------|-------------|-------|------|
| 2025-06-15 | 3.8 | +0.3 | 4 | 3 | 4 | 4 | 4 | 3 |
| 2025-05-15 | 3.5 | — | 3 | 3 | 4 | 4 | 3 | 4 |

### Security Findings Over Time

| Date | Critical | High | Medium | Low | Total | Deps Vulnerable |
|------|----------|------|--------|-----|-------|----------------|
| ... | ... | ... | ... | ... | ... | ... |

### Dependency Health Over Time

| Date | Critical CVEs | High CVEs | Outdated | Safe to Update | Needs Migration |
|------|--------------|-----------|----------|---------------|----------------|
| ... | ... | ... | ... | ... | ... |

<repeat for each tracked skill type with 2+ data points>

## Recommendations

Prioritized actions based on trend analysis:
1. <most urgent action based on degrading/critical metrics>
2. <second priority>
3. <preventive action based on WATCH items>
```

## Step 5 — Generate HTML Dashboard

If `$ARGUMENTS` is `dashboard` or `all`, also generate an interactive HTML dashboard.

Write a Node.js script to `reports/build-dashboard.js` that:

1. Reads all report files from `reports/`
2. Parses YAML front-matter from each
3. Generates a self-contained HTML file at `reports/trend-dashboard.html`

The HTML dashboard must:
- Import Chart.js from CDN: `https://cdn.jsdelivr.net/npm/chart.js`
- Embed all data as a `const DATA = {...}` JSON object
- Use a clean, dark-navy theme matching the team's Coral Energy palette:
  - Background: `#1a1a2e`
  - Cards: `#16213e`
  - Accent: `#F96167` (coral)
  - Success: `#27AE60` (green)
  - Warning: `#F9E795` (gold)
  - Text: `#e0e0e0`
- Include these sections:

### Dashboard Layout

**Header**: "Skills Report Dashboard" with last-updated date and total report count.

**Health Cards Row**: One card per tracked metric showing:
- Metric name
- Current value (large number)
- Delta badge (green ↑ or red ↓ or gray →)
- Sparkline or mini-chart of last 5 values
- Status dot (green/yellow/orange/red)

**Line Charts Section** (2 columns):
- Tech Debt Score over time (line chart, scale 0-5)
- Security Findings over time (stacked bar: critical, high, medium, low)
- Dependency Health over time (line: critical CVEs, high CVEs, outdated count)
- Test Health over time (line: failures, coverage gaps)

**Timeline Section**:
- Chronological list of all reports with icons per type
- Click to expand and see key findings

**Staleness Indicators**:
- Bar showing days since last run for each skill type
- Color-coded: green (<expected cadence), yellow (approaching), red (overdue)

Run the script after writing it:
```
node reports/build-dashboard.js
```

## Step 6 — Console Summary

Print a concise summary to the console:

```
Trend Analysis — 2025-06-15
━━━━━━━━━━━━━━━━━━━━━━━━━━━
Reports analyzed: 23 across 6 skill types

  Tech Debt     3.8/5  ↑ +0.3  WATCH
  Security      0 crit ↑ -1    HEALTHY
  Dependencies  0 CVEs ↑ -2    HEALTHY
  Test Health   0 fail → 0     HEALTHY
  Performance   1 crit ↓ +1    WARNING

⚠  1 alert: perf-review critical issues increased
📄 reports/trend-analysis-2025-06-15.md
📊 reports/trend-dashboard.html
```

## Modes

- `/report-trends` or `/report-trends all` — Generate markdown report + HTML dashboard
- `/report-trends quick` — Console summary only (no files written)
- `/report-trends dashboard` — Regenerate HTML dashboard only
- `/report-trends security` — Deep-dive on security trends only
- `/report-trends tech-debt` — Deep-dive on tech debt trends only

## Critical Rules

1. **Never modify existing reports** — trend analysis is read-only on source reports
2. **Handle missing data gracefully** — if a skill has only 1 report, show current values without trends
3. **Date parsing** — extract dates from filenames, not file modification times
4. **Front-matter fallback** — if YAML parsing fails, grep the report body for key metrics
5. **Skip trend-analysis reports** — do not include previous trend reports in the analysis
