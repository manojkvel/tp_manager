---
name: risk-tracker
description: Maintain a living risk register across the project — sourcing risks from plan-gen assessments, blocked tasks, security findings, spec compliance gaps, dependency vulnerabilities, and manual entries. Auto-escalates when signals worsen. Feeds into /gate-briefing and /pipeline-monitor.
argument-hint: "scan|update|report [--escalate] [path/to/spec-or-all]"
allowed-tools: Read, Write, Grep, Glob, Bash(git log, git diff, ls, find, cat, wc, date, jq)
---

# Risk Tracker — Living Risk Register

`/plan-gen` identifies risks at planning time. But risks are living things — they emerge during implementation, escalate when tasks get blocked, and resolve when mitigations land. Without ongoing tracking, the risk assessment from planning time becomes a stale artifact that nobody reads.

`/risk-tracker` maintains a `risk-register.md` that evolves with the project. It auto-sources risks from pipeline artifacts, tracks their lifecycle, escalates when signals worsen, and produces risk summaries for `/gate-briefing` and `/pipeline-monitor`.

## Risk Sources

| Source | Risk Types Detected |
|--------|-------------------|
| `plan.md` risk assessment | Architecture, dependency, complexity, scope risks |
| Blocked tasks (triage-log.json) | Implementation, dependency, external risks |
| `/security-audit` reports | Security vulnerabilities, CVEs |
| `/spec-review` compliance gaps | Compliance, quality risks |
| `/dependency-update` reports | Supply chain, licensing risks |
| `board-mapping.json` aging items | Schedule, resource risks |
| `/drift-detector` reports | Architectural drift, constraint erosion risks |
| Manual entries | Business, political, market risks |

## CRITICAL RULES

1. **Risks have owners.** Every risk must have an assigned owner responsible for mitigation. Default owner: the pipeline operator.
2. **Risks have mitigation plans.** Identifying a risk without a mitigation is just worrying. Each risk gets at least a strategy (accept, mitigate, transfer, avoid).
3. **Escalation is automatic when signals worsen.** A blocked task that's been stuck for 5 days escalates from MEDIUM to HIGH automatically.
4. **Resolved risks stay in the register.** Mark them RESOLVED with the resolution date and method, for audit trail and pattern analysis.
5. **Risk register is a living document.** Updated every time `/risk-tracker scan` runs, not just at planning milestones.

---

## Phase 0 — Collect Risk Signals

### 0.1 Load Existing Register

```
Read: specs/<NNN>-<slug>/risk-register.md (if exists)
Parse: existing risks with their IDs, status, severity, owner, history
```

### 0.2 Scan Pipeline Artifacts

For each risk source, extract new signals:

**From plan.md:**
```
Parse the risk assessment section
For each identified risk: check if already in register → if not, add as NEW
```

**From triage-log.json:**
```
For each ESCALATED entry: create or update a risk
For entries with recovery_attempts >= max_retries: create HIGH risk
For SPEC_AMBIGUITY escalations: create MEDIUM risk (requirements instability)
```

**From security-audit reports:**
```
For each CRITICAL/HIGH finding: create or update a security risk
For unresolved CVEs: create HIGH risk with CVE reference
```

**From drift-detector reports:**
```
For AC erosion > 30%: create HIGH risk (spec divergence)
For deferred findings aging > 30 days: escalate existing risk
For architecture divergence: create MEDIUM risk
```

---

## Phase 1 — Update Risk Register

### 1.1 Risk Lifecycle

```
NEW → ACTIVE → MITIGATING → RESOLVED
                    ↓
                 ESCALATED → CRITICAL_WATCH → RESOLVED
                    ↓
                 ACCEPTED (risk accepted, no mitigation)
```

### 1.2 Auto-Escalation Rules

| Condition | Current → New Severity |
|-----------|----------------------|
| Blocked task aging > 3 days | MEDIUM → HIGH |
| Blocked task aging > 7 days | HIGH → CRITICAL |
| Security finding unresolved > 14 days | MEDIUM → HIGH |
| CRITICAL security finding unresolved > 3 days | HIGH → CRITICAL |
| Deferred finding re-deferred > 2 times | LOW → MEDIUM |
| Spec revised > 3 times (instability) | LOW → MEDIUM |
| Same risk triggered by multiple specs | Individual severity → +1 level |

### 1.3 Risk Assessment

For each risk, maintain:

```markdown
### RISK-007: External OAuth provider rate limiting
- **Severity:** HIGH (escalated from MEDIUM on 2026-02-14)
- **Probability:** Likely (based on provider documentation)
- **Impact:** SSO login failures during peak usage
- **Category:** External dependency
- **Owner:** kvel@
- **Source:** plan.md risk assessment + TASK-008 blocked
- **Status:** MITIGATING

**Mitigation plan:**
1. Implement token caching to reduce provider calls (TASK-005 — DONE)
2. Add circuit breaker for provider outages (TASK-011 — IN PROGRESS)
3. Configure fallback to cached sessions (TASK-014 — PENDING)

**History:**
- 2026-02-10: Identified in plan.md risk assessment (MEDIUM)
- 2026-02-12: TASK-008 blocked by rate limit during testing
- 2026-02-14: Escalated to HIGH (blocked > 3 days)
- 2026-02-15: Mitigation step 1 completed (token caching)
```

---

## Phase 2 — Produce Risk Report

### 2.1 Write Risk Register

Save `specs/<NNN>-<slug>/risk-register.md`:

```markdown
# Risk Register — SSO Login
**Last updated:** 2026-02-16T14:30:00Z
**Total risks:** 8 (2 CRITICAL, 3 HIGH, 2 MEDIUM, 1 LOW)
**Resolved:** 3 | Active: 5

## Risk Summary

| ID | Severity | Category | Risk | Status | Owner |
|----|----------|----------|------|--------|-------|
| RISK-001 | CRITICAL | Security | Unpatched CVE in auth library | MITIGATING | kvel@ |
| RISK-003 | CRITICAL | Schedule | Wave 3 blocked by HITL decision | ESCALATED | PM |
| RISK-004 | HIGH | External | OAuth provider rate limiting | MITIGATING | kvel@ |
| RISK-005 | HIGH | Architecture | Auth module boundary violations | ACTIVE | dev-lead@ |
| RISK-007 | HIGH | Compliance | Audit logging deferred | ACTIVE | compliance@ |
| RISK-002 | MEDIUM | Quality | Test coverage at 72% (target 80%) | MITIGATING | kvel@ |
| RISK-006 | MEDIUM | Scope | SAML support scope expanding | ACTIVE | PM |
| RISK-008 | LOW | Technical | Performance target relaxed | ACCEPTED | kvel@ |

## Resolved Risks
| ID | Was | Resolution | Resolved |
|----|-----|-----------|----------|
| RISK-009 | HIGH | Dependency conflict resolved by /dependency-update --fix | 2026-02-14 |
| RISK-010 | MEDIUM | Missing test data → /test-gen generated fixtures | 2026-02-13 |
| RISK-011 | LOW | Browser compatibility concern → verified in E2E tests | 2026-02-15 |

## Detailed Risks
[Full risk details with mitigation plans and history...]
```

### 2.2 Console Output

```
Risk Tracker — SSO Login
━━━━━━━━━━━━━━━━━━━━━━━━
Active risks: 5 (2 CRITICAL, 3 HIGH)
Resolved: 3

Escalations since last scan:
  ↑ RISK-003: HITL decision pending 5 days → CRITICAL
  ↑ RISK-007: Audit logging deferred 3rd time → HIGH

Top risk: RISK-001 (CRITICAL) — Unpatched CVE in auth library
  Mitigation: /dependency-update --fix-security scheduled

Register: specs/047-sso-login/risk-register.md
```

---

## Modes

```
/risk-tracker scan specs/047-sso-login/
/risk-tracker scan --all
/risk-tracker update specs/047-sso-login/ --add "Market: competitor launched similar feature"
/risk-tracker report specs/047-sso-login/
/risk-tracker report --all --escalate
```

---

## Output

1. **Primary:** `specs/<NNN>-<slug>/risk-register.md` — living risk register with full detail
2. **Console summary:** Active risk count by severity, recent escalations, top risk
3. **Integration:** Risk summaries fed to /gate-briefing, alert data fed to /pipeline-monitor
