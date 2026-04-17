---
name: gate-briefing
description: Generate decision-ready briefings at HITL gates — summarizes what the agent produced, key decisions made, risks identified, quality metrics, and a recommendation (APPROVE / APPROVE WITH CONDITIONS / REJECT). Supports audience modes (engineering, executive, compliance) for different stakeholder views.
argument-hint: "[--audience engineering|executive|compliance] [--gate approve-spec|approve-plan|approve-release|custom] path/to/spec"
allowed-tools: Read, Write, Grep, Glob, Bash(git log, git diff, ls, find, cat, wc, date, jq)
---

# Gate Briefing — HITL Decision Support

When the pipeline pauses at a HITL gate, the human needs to make a decision: approve, reject, or request changes. Reading raw markdown artifacts (a 200-line spec, a 150-line plan, a 300-line task breakdown) takes 30+ minutes. `/gate-briefing` distills everything into a decision-ready summary that takes 5 minutes to review.

This skill doesn't make the decision — it assembles the evidence, highlights what matters, and presents a recommendation. The human decides.

## When to Use This Skill

| Gate | Triggered By | Decision |
|------|-------------|----------|
| Approve spec | `/spec-gen` or `/spec-evolve` completed | Is this spec ready for planning? |
| Approve plan | `/plan-gen` completed | Is this plan feasible and complete? |
| Approve tasks | `/task-gen` completed (strict profile) | Is this task breakdown correct? |
| Approve release | `/release-readiness-checker` completed | Is this ready to ship? |
| Approve revision | `/spec-evolve` produced a new version | Is this spec change acceptable? |
| Custom gate | `/pipeline-orchestrator` custom gate | Any decision point in the pipeline |

## CRITICAL RULES

1. **Briefings are concise.** The whole point is to save the reviewer time. Target: 1 page for engineering audience, half page for executive.
2. **Always include a recommendation.** The reviewer can override it, but having a starting position accelerates the decision.
3. **Surface risks prominently.** Risks that could delay the project or cause rework should be in the first paragraph, not buried in an appendix.
4. **Show quality gate results.** If a `/quality-gate` ran before this HITL gate, include its pass/fail summary.
5. **Trace to source.** Every claim in the briefing links back to a specific artifact and location so the reviewer can drill into details.

---

## Phase 0 — Determine Gate Context

### 0.1 Identify the Gate

From the invocation arguments or pipeline-state.json:
- Which HITL gate is this? (approve-spec, approve-plan, approve-release, etc.)
- What artifacts are available for this gate?
- What quality gate results exist?
- What's the pipeline history so far?

### 0.2 Collect Artifacts

For each gate type, gather:

**Approve spec:**
- `spec.md` (or `spec.v{N}.md`) — the spec to approve
- `gate-spec-to-plan-*.md` — quality gate report
- Previous versions if this is a revision (for delta view)

**Approve plan:**
- `plan.md` — the plan to approve
- `spec.md` — for AC traceability check
- `gate-plan-to-tasks-*.md` — quality gate report

**Approve release:**
- Latest `/task-implementer` report
- Latest `/spec-review` report
- Latest `/security-audit` report (if exists)
- Latest `/release-readiness-checker` report
- `gate-impl-to-release-*.md` — quality gate report
- `board-mapping.json` — PM tool state

**Approve revision:**
- `spec.v{N}.md` — new version
- `spec.v{N-1}.md` — previous version
- `reprocess-manifest.json` — blast radius and re-processing plan

---

## Phase 1 — Build the Briefing

### 1.1 Structure

Every briefing follows this structure:

```markdown
# Gate Briefing: [Gate Name]
**Spec:** [spec reference]
**Date:** [date]
**Pipeline:** [pipeline ID]
**Recommendation:** [APPROVE | APPROVE WITH CONDITIONS | REJECT]

## Summary
[2-3 sentences: what was done, what's being decided]

## Key Decisions Made by Agent
[Bullet list of significant decisions the agent made that the reviewer should validate]

## Quality Gate Results
[Pass/fail summary from /quality-gate if available]

## Risks
[Ordered by severity: what could go wrong if approved]

## Metrics
[Quantitative summary: ACs covered, test coverage, findings count, effort estimate]

## Recommendation Detail
[Why the recommendation is what it is, with conditions if applicable]

## Questions for Reviewer
[Specific questions the pipeline needs answered to proceed]

## Source References
[Links to full artifacts for drill-down]
```

### 1.2 Gate-Specific Content

#### Approve Spec Briefing

```markdown
## Summary
/spec-gen produced a specification for "<Feature Title>" with N acceptance criteria,
M business rules, and K constraints. The quality gate [passed/failed] with [details].

## Key Decisions Made by Agent
- Chose [approach A] over [approach B] for [reason]
- Scoped OUT [feature X] because [reason]
- Assumed [assumption] — reviewer should validate

## Quality Gate Results
Spec-to-plan gate: [PASS/FAIL]
- Acceptance criteria: N (threshold: ≥3) ✓
- AC measurability: X/N (threshold: 100%) [✓/✗]
- Open questions: K (threshold: 0) [✓/✗]

## Risks
1. **[HIGH]** AC-3 may conflict with existing auth system (spec assumes OAuth-only, codebase has SAML)
2. **[MEDIUM]** Performance constraint (200ms P95) may be unrealistic for the proposed architecture
3. **[LOW]** Edge case: concurrent login from multiple devices not explicitly covered

## Metrics
| Metric | Value |
|--------|-------|
| Acceptance criteria | 7 |
| Business rules | 4 |
| Constraints | 3 (security, performance, compliance) |
| Edge cases covered | 5 |
| Open questions | 0 |

## Recommendation Detail
APPROVE — spec is complete, measurable, and traceable. One concern: AC-3's OAuth-only
assumption should be validated against existing SAML integration before planning begins.

## Questions for Reviewer
1. Confirm: should SAML support be in scope or deferred to a child spec?
2. Is the 200ms P95 target realistic given current infrastructure?
```

#### Approve Plan Briefing

Includes: phase count, effort estimate, risk assessment summary, AC traceability coverage (every AC mapped to ≥1 phase), architecture decisions that need validation, and rollback strategy summary.

#### Approve Release Briefing

Includes: test coverage %, security findings (CRITICAL/HIGH/MEDIUM), spec compliance score, blocked/skipped task count with reasons, API contract changes, license compliance status, and a go/no-go summary table.

#### Approve Revision Briefing

Includes: what changed (diff summary), why (trigger source), blast radius (which downstream artifacts need re-processing), estimated re-processing effort, and whether any completed implementation needs rework.

### 1.3 Audience Modes

**Engineering (default):** Full technical detail, code references, architecture decisions, specific file paths and line counts.

**Executive:** Business impact focus, timeline impact, risk summary, resource implications. No code references. Estimated in business terms ("adds 1 sprint" not "adds 12 tasks").

**Compliance:** Control coverage, audit trail, policy conformance, security/privacy assessment, regulatory requirements mapping.

---

## Phase 2 — Compute Recommendation

### 2.1 Recommendation Logic

```
If quality gate PASSED and no HIGH risks:
    → APPROVE

If quality gate PASSED but HIGH risks exist:
    → APPROVE WITH CONDITIONS (list the conditions)

If quality gate FAILED but all failures are auto-recoverable:
    → APPROVE WITH CONDITIONS ("after /auto-triage resolves: [list]")

If quality gate FAILED with non-recoverable failures:
    → REJECT (with specific reasons and suggested remediation)

If spec revision and blast radius is REGEN for plan or tasks:
    → APPROVE WITH CONDITIONS ("re-processing required: [list stages]")
```

### 2.2 Conditions Format

When recommending APPROVE WITH CONDITIONS:
```
## Conditions for Approval
1. [ ] Resolve AC-4 measurability before planning begins
2. [ ] Validate SAML assumption with infrastructure team
3. [ ] Update performance targets after load test baseline
```

These conditions become tracked items in `pipeline-state.json` and are verified before the pipeline proceeds past the gate.

---

## Phase 3 — Produce Output

### 3.1 Write Briefing

Save `specs/<NNN>-<slug>/gate-briefing-<gate>-<date>.md`

### 3.2 Console Output

```
Gate Briefing: Approve Spec — SSO Login
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Recommendation: APPROVE WITH CONDITIONS

Summary: Spec covers 7 ACs, 4 BRs, 3 constraints. Quality gate passed.
         One concern: SAML compatibility needs validation.

Risks: 1 HIGH, 1 MEDIUM, 1 LOW
Conditions:
  1. Validate SAML assumption with infrastructure team
  2. Confirm 200ms P95 target is realistic

Full briefing: specs/047-sso-login/gate-briefing-approve-spec-2026-02-16.md

Awaiting decision: APPROVE | APPROVE WITH CONDITIONS | REJECT | DEFER
```

---

## Modes

```
/gate-briefing specs/047-sso-login/ --gate approve-spec
/gate-briefing specs/047-sso-login/ --gate approve-plan --audience executive
/gate-briefing specs/047-sso-login/ --gate approve-release --audience compliance
/gate-briefing specs/047-sso-login/ --gate approve-revision
```

---

## Output

1. **Primary:** `specs/<NNN>-<slug>/gate-briefing-<gate>-<date>.md` — decision-ready briefing document
2. **Recommendation:** APPROVE | APPROVE WITH CONDITIONS | REJECT (machine-readable for /pipeline-orchestrator)
3. **Console summary:** Condensed recommendation with key risks and conditions
