---
name: drift-detector
description: Monitor divergence between spec intent and implementation reality across pipeline runs — catches gradual erosion of acceptance criteria, accumulating deferred findings, architecture decision drift, and constraint violations that individual /spec-review passes might miss. Run periodically or before major releases.
argument-hint: "scan|report [--depth shallow|deep] [path/to/spec-or-all]"
allowed-tools: Read, Write, Grep, Glob, Bash(git log, git diff, git show, ls, find, cat, wc, date, jq)
---

# Drift Detector — Spec-to-Implementation Divergence Monitor

Individual `/spec-review` runs catch compliance gaps in a single snapshot. But drift is gradual — each spec revision weakens an AC slightly, each `/spec-fix` defers one finding, each HITL gate approval adds a condition that nobody tracks. Over weeks and multiple pipeline runs, the implementation can drift significantly from the original intent without any single step being obviously wrong.

`/drift-detector` takes the long view. It compares the current state against the original spec intent, tracking how much has changed, what's been deferred, and where the implementation has diverged from the architecture plan.

## What It Detects

| Drift Type | Description | Severity |
|-----------|------------|----------|
| AC erosion | Acceptance criteria weakened across spec revisions | HIGH |
| Deferred accumulation | DEFERRED findings from /review-fix and /spec-fix piling up | MEDIUM-HIGH |
| Architecture divergence | Implementation deviates from plan's architecture decisions | HIGH |
| Constraint relaxation | NFRs (performance, security) loosened in successive revisions | HIGH |
| Scope creep tracking | Features added without formal change requests | MEDIUM |
| Child spec divergence | Child specs evolving away from parent constraints | MEDIUM |
| Cross-spec inconsistency | Multiple specs making contradictory architecture decisions | HIGH |

## CRITICAL RULES

1. **Compare against the original intent, not just the previous version.** Drift is measured from v1 to current, not from v(N-1) to v(N). Small acceptable changes compound.
2. **Deferred != resolved.** A finding marked DEFERRED in sprint 3 is still unresolved in sprint 8. Track the aging.
3. **Architecture decisions are commitments.** If the plan said "use Redis Streams" and the implementation switched to Kafka, that's drift even if the code works.
4. **Report trends, not just snapshots.** The direction of drift matters more than the current level.

---

## Phase 0 — Collect History

### 0.1 Load Spec Version Chain

```
Glob: specs/<NNN>-<slug>/spec.v*.md
Sort: by version number
Read: each version's YAML frontmatter and change log
Build: a change chain showing how each AC, BR, and constraint evolved
```

### 0.2 Load Review and Fix History

```
Glob: specs/<NNN>-<slug>/spec-review*.md
Glob: specs/<NNN>-<slug>/spec-fix-*.md
Glob: reports/review-fix-*-<slug>*.md
Glob: specs/<NNN>-<slug>/gate-*.md
Glob: specs/<NNN>-<slug>/triage-log.json
```

Extract: all DEFERRED findings, all gate conditions, all triage escalation outcomes.

### 0.3 Load Architecture Decisions

From `plan.md`: extract technology choices, design patterns, component boundaries, and integration approaches.

From implementation reports: extract what was actually built and how.

### 0.4 Load Cross-Spec Context (deep mode)

If `--depth deep`, also load:
```
Glob: specs/*/spec.md — all specs in the project
Glob: specs/*/plan.md — all plans
Read: merged-plan-*.md for shared architecture decisions
```

---

## Phase 1 — Analyze Drift

### 1.1 AC Erosion Analysis

For each acceptance criterion in spec v1:
```
Track through versions: v1 → v2 → v3 → ... → current
Detect:
  - AC removed (was in v1, not in current)
  - AC weakened (measurable threshold reduced, scope narrowed)
  - AC split (one AC became multiple, diluting responsibility)
  - AC unchanged (stable)

Compute: AC retention rate = (unchanged + strengthened) / total_original
```

### 1.2 Deferred Finding Accumulation

```
For each DEFERRED finding across all review/fix reports:
  age = now - first_deferred_date
  re-deferred_count = how many times it was deferred again
  severity = original finding severity

  if age > 30 days: alert AGING_DEFERRAL
  if re-deferred_count > 2: alert CHRONIC_DEFERRAL
  if severity == CRITICAL and age > 7 days: alert CRITICAL_DEFERRAL
```

### 1.3 Architecture Divergence

```
For each architecture decision in plan.md:
  - Technology: "Use Redis Streams for event bus"
  - Pattern: "Repository pattern for data access"
  - Boundary: "Auth module is self-contained, no cross-domain imports"

Search implementation for violations:
  - Grep for alternative technology usage (Kafka imports when Redis was planned)
  - Grep for pattern violations (direct DB queries when repository was planned)
  - Grep for boundary violations (auth imports in unrelated modules)
```

### 1.4 Constraint Relaxation

```
For each NFR in spec v1:
  Track through versions:
  - Performance: "200ms P95" → "500ms P95" = RELAXED
  - Security: "encrypted at rest" → unchanged = STABLE
  - Compliance: "SOC 2 required" → "SOC 2 nice-to-have" = RELAXED
```

### 1.5 Cross-Spec Inconsistency (deep mode)

```
For specs sharing file modifications or architecture decisions:
  - Spec A says "use JWT for auth"
  - Spec B says "use session cookies for auth"
  → INCONSISTENCY detected

For child specs vs parent:
  - Parent constraint: "all endpoints respond < 200ms"
  - Child implementation: endpoint at 450ms
  → CONSTRAINT_VIOLATION detected
```

---

## Phase 2 — Produce Drift Report

### 2.1 Write Report

Save `reports/drift-report-<date>.md`:

```markdown
# Drift Report
**Date:** 2026-02-16
**Spec:** specs/047-sso-login
**Versions analyzed:** v1 through v3
**Overall drift level:** MODERATE (3 concerns)

## AC Erosion
| AC | v1 | Current | Status |
|----|-------|---------|--------|
| AC-1 | "User can login via SSO within 3 seconds" | Unchanged | ● Stable |
| AC-2 | "Session expires after 30min inactivity" | Clarified (idle vs absolute) | ● Improved |
| AC-3 | "Support OAuth 2.0 with PKCE" | Unchanged | ● Stable |
| AC-4 | "System responds within 200ms P95" | Relaxed to 500ms in v2 | ⚠ Relaxed |
| AC-5 | "Audit log for all SSO events" | Removed in v3 | ✗ Removed |

**AC retention rate:** 60% (3/5 stable or improved)

## Deferred Findings
| Finding | Severity | First Deferred | Age | Re-deferrals |
|---------|----------|---------------|-----|-------------|
| SQL injection in legacy adapter | HIGH | 2026-01-20 | 27 days | 2 |
| Missing rate limiting on /token | MEDIUM | 2026-02-01 | 15 days | 1 |
| Error messages expose stack traces | LOW | 2026-02-10 | 6 days | 0 |

**3 deferred findings, 1 aging (>30 days)**

## Architecture Divergence
| Decision (Plan) | Implementation | Status |
|----------------|---------------|--------|
| Redis Streams for events | Redis Streams | ● Aligned |
| Repository pattern | Direct queries in 2 files | ⚠ Partial drift |
| Auth module self-contained | 3 cross-domain imports found | ⚠ Boundary violation |

## Constraint Changes
| Constraint | v1 | Current | Delta |
|-----------|-----|---------|-------|
| Response time | 200ms P95 | 500ms P95 | ⚠ Relaxed 2.5× |
| Encryption at rest | Required | Required | ● Stable |
| SOC 2 compliance | Required | Required | ● Stable |

## Trend
Drift is increasing: v1→v2 had 1 concern, v2→v3 added 2 more.
If trend continues, recommend a stabilization sprint before adding new scope.

## Recommendations
1. **[HIGH]** Resolve the SQL injection deferral (27 days, HIGH severity)
2. **[HIGH]** Decide on AC-5 (audit logging) — was it intentionally removed or accidentally dropped?
3. **[MEDIUM]** Fix repository pattern violations (2 direct query files)
4. **[MEDIUM]** Address auth module boundary violations (3 cross-domain imports)
5. **[LOW]** Review AC-4 relaxation — was 200ms→500ms a conscious decision?
```

### 2.2 Console Output

```
Drift Detector — SSO Login
━━━━━━━━━━━━━━━━━━━━━━━━━━
Versions analyzed: v1 → v3
Overall drift: MODERATE

AC erosion:       60% retention (2 concerns: 1 relaxed, 1 removed)
Deferred findings: 3 (1 aging >30 days)
Architecture:     2 deviations (repository pattern, module boundary)
Constraints:      1 relaxation (response time 200ms → 500ms)

Trend: INCREASING — recommend stabilization

Report: reports/drift-report-2026-02-16.md
```

---

## Modes

```
/drift-detector scan specs/047-sso-login/
/drift-detector scan --all --depth deep
/drift-detector report specs/047-sso-login/
```

---

## Output

1. **Primary:** `reports/drift-report-<date>.md` — comprehensive drift analysis with recommendations
2. **Console summary:** Drift level, key concerns, trend direction
3. **Side effects:** Drift alerts fed to /pipeline-monitor and /gate-briefing
