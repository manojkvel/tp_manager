---
name: feature-balance-sheet
description: 
argument-hint: "quick|deep [feature-description-or-spec-path]"
allowed-tools: Read, Write, Grep, Glob, Bash(git log, git diff, ls, find, cat, wc, date, jq)
---
# /feature-balance-sheet — Feature Cost-Benefit & Portfolio Analysis

## Purpose

Produce a structured **go / no-go / defer** recommendation for a feature by evaluating it across five portfolio dimensions: business value, technical cost, opportunity cost, dependency impact, and strategic alignment. Prevents teams from investing in features that don't justify their cost — and provides the data to defend that decision.

Operates in two modes:

| Mode | When | Input | Depth | Decision Gate |
|------|------|-------|-------|---------------|
| `quick` | **Before** `/spec-gen` | Raw feature request + context | Lightweight (~5 min) | Skip spec-gen if score < threshold |
| `deep` | **After** `/spec-gen` | `spec.md` + `decision-log.md` + portfolio context | Thorough (~10 min) | Skip plan-gen if score < threshold |

---

## Scoring Framework

### Five Dimensions

Each dimension is scored **1–5** with weighted contribution to the final score:

| Dimension | Weight (default) | What It Measures |
|-----------|-----------------|------------------|
| **Business Value** | 30% | Revenue, retention, market positioning, user impact |
| **Technical Cost** | 25% | Effort, complexity, risk, tech debt impact (inverted — lower cost = higher score) |
| **Opportunity Cost** | 15% | What else could be built with the same resources |
| **Dependency Impact** | 15% | What this unblocks or blocks downstream |
| **Strategic Alignment** | 15% | Fit with company OKRs, roadmap, and vision |

Weights are configurable via `balance-sheet-config.json`:

```json
{
  "weights": {
    "business_value": 0.30,
    "technical_cost": 0.25,
    "opportunity_cost": 0.15,
    "dependency_impact": 0.15,
    "strategic_alignment": 0.15
  },
  "thresholds": {
    "quick_proceed": 3.0,
    "quick_kill": 2.0,
    "deep_proceed": 3.2,
    "deep_kill": 2.2
  },
  "custom_dimensions": []
}
```

### Custom Dimensions

Teams can add custom scoring dimensions via config:

```json
{
  "custom_dimensions": [
    {
      "name": "compliance_impact",
      "weight": 0.10,
      "description": "Regulatory or compliance requirement coverage",
      "scoring_guide": {
        "1": "No compliance relevance",
        "3": "Addresses some compliance gaps",
        "5": "Critical for regulatory compliance"
      }
    }
  ]
}
```

When custom dimensions are added, all weights are renormalized to sum to 1.0.

---

## Mode: `quick`

### When

Run **before** `/spec-gen` on a raw feature request. The goal is a fast assessment to decide whether the feature is worth the investment of full specification.

### Input

- Feature request description (1-3 paragraphs)
- Current roadmap context (if available)
- Active features in pipeline (if available)

### Phase 1 — Business Value Assessment (Quick)

Evaluate using available signals:

| Signal | Score Mapping |
|--------|--------------|
| **User demand** | 5: Widespread demand / top-requested. 3: Moderate demand. 1: No evidence of demand |
| **Revenue impact** | 5: Direct revenue driver. 3: Indirect enabler. 1: No revenue impact |
| **Retention impact** | 5: Prevents churn / major pain point. 3: Nice to have. 1: No retention impact |
| **Market positioning** | 5: Competitive necessity / differentiator. 3: Parity feature. 1: Already ahead |

Business Value Score = average of available signals (skip signals with insufficient data, note as `[INSUFFICIENT DATA]`)

### Phase 2 — Technical Cost Assessment (Quick)

Estimate without a full spec:

| Signal | Score Mapping (inverted: lower cost → higher score) |
|--------|------------------------------------------------------|
| **Effort estimate** | 5: XS-S (days). 3: M-L (1-3 weeks). 1: XL+ (months) |
| **Complexity** | 5: Straightforward CRUD. 3: Multiple integrations. 1: Novel algorithm / architecture change |
| **Risk** | 5: Well-understood domain. 3: Some unknowns. 1: High uncertainty / new territory |
| **Tech debt impact** | 5: Reduces debt. 3: Neutral. 1: Adds significant debt |

### Phase 3 — Opportunity Cost Assessment (Quick)

| Signal | Score Mapping |
|--------|--------------|
| **Resource availability** | 5: Team is available. 3: Partial conflict with other work. 1: Major conflict |
| **Alternative features** | 5: No better alternatives in backlog. 3: Comparable alternatives exist. 1: Clearly better alternatives waiting |
| **Timing** | 5: Now is optimal. 3: Timing is neutral. 1: Better to wait (market, dependency, etc.) |

### Phase 4 — Dependency Impact Assessment (Quick)

| Signal | Score Mapping |
|--------|--------------|
| **Unblocks downstream** | 5: Multiple features depend on this. 3: One feature depends on this. 1: Nothing depends on this |
| **Blocked by upstream** | 5: No blockers. 3: Minor dependencies to resolve. 1: Major blockers exist |
| **Platform enablement** | 5: Creates reusable capability. 3: Some reuse potential. 1: One-off feature |

### Phase 5 — Strategic Alignment Assessment (Quick)

| Signal | Score Mapping |
|--------|--------------|
| **OKR alignment** | 5: Directly maps to current OKR. 3: Loosely related. 1: No OKR connection |
| **Roadmap fit** | 5: On current roadmap. 3: Adjacent to roadmap themes. 1: Off-roadmap |
| **Vision alignment** | 5: Core to product vision. 3: Supporting. 1: Tangential |

### Phase 6 — Quick Verdict

Calculate weighted score and produce recommendation:

```
WEIGHTED SCORE = Σ (dimension_score × weight)

Recommendations:
  ≥ quick_proceed (default 3.0):  PROCEED → Move to /spec-gen
  > quick_kill AND < quick_proceed: NEEDS DISCUSSION → HITL gate
  ≤ quick_kill (default 2.0):     KILL → Do not proceed. Log rationale.
```

### Quick Mode Output

```markdown
# Feature Balance Sheet — Quick Assessment

**Feature:** {feature name}
**Date:** {date}
**Mode:** Quick (pre-spec)

## Score Summary

| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Business Value | {X.X}/5 | 30% | {X.XX} |
| Technical Cost | {X.X}/5 | 25% | {X.XX} |
| Opportunity Cost | {X.X}/5 | 15% | {X.XX} |
| Dependency Impact | {X.X}/5 | 15% | {X.XX} |
| Strategic Alignment | {X.X}/5 | 15% | {X.XX} |
| **TOTAL** | | | **{X.XX}/5** |

## Recommendation: {PROCEED | NEEDS DISCUSSION | KILL}

{1-3 sentence rationale}

## Key Factors

**Strongest signals:**
- {top positive factor}
- {second positive factor}

**Weakest signals:**
- {top negative factor}
- {second negative factor}

**Insufficient data:**
- {signals that couldn't be scored}

## Risk Flags
- {Any showstoppers or red flags identified}
```

---

## Mode: `deep`

### When

Run **after** `/spec-gen` completes, using the full spec and decision log. Produces a comprehensive assessment with higher confidence.

### Input

- `spec.md` — Full structured specification
- `decision-log.md` — Decision journal (if available)
- `balance-sheet-config.json` — Scoring weights and thresholds (if available)
- Current portfolio context: active pipeline features, resource allocation

### Phase 1 — Business Value Assessment (Deep)

All signals from quick mode PLUS:

| Signal | Source | Score Mapping |
|--------|--------|--------------|
| **AC coverage** | spec.md | 5: ACs cover core user journeys. 3: Partial. 1: Superficial |
| **User segment impact** | spec.md | 5: Affects primary segment. 3: Secondary. 1: Edge case |
| **Measurability** | spec.md | 5: Clear success metrics defined. 3: Partial. 1: No metrics |

### Phase 2 — Technical Cost Assessment (Deep)

All signals from quick mode PLUS:

| Signal | Source | Score Mapping |
|--------|--------|--------------|
| **Spec complexity** | spec.md | 5: Few constraints, simple ACs. 3: Moderate. 1: Many edge cases, complex constraints |
| **Integration surface** | spec.md | 5: Self-contained. 3: 1-2 integrations. 1: Multiple system integrations |
| **Decision deviations** | decision-log.md | 5: No significant deviations. 3: Notable deviations. 1: Significant deviations from standard |
| **Assumption fragility** | decision-log.md | 5: No fragile assumptions. 3: 1-2 fragile. 1: Multiple fragile assumptions |
| **Open questions** | spec.md | 5: None. 3: 1-2 minor. 1: Critical unresolved questions |

### Phase 3 — Opportunity Cost Assessment (Deep)

All signals from quick mode PLUS:

| Signal | Source | Score Mapping |
|--------|--------|--------------|
| **Effort vs alternatives** | spec.md effort | 5: Lower effort than alternatives. 3: Comparable. 1: Higher effort than alternatives |
| **Value density** | business_value / effort | 5: High value per effort unit. 3: Average. 1: Low value per effort unit |

### Phase 4 — Dependency Impact Assessment (Deep)

All signals from quick mode PLUS:

| Signal | Source | Score Mapping |
|--------|--------|--------------|
| **Shared components** | spec.md | 5: Creates shared services. 3: Uses existing shared. 1: Duplicates existing |
| **API surface** | spec.md | 5: Clean API boundary. 3: Some coupling. 1: Deep coupling with other features |

### Phase 5 — Strategic Alignment Assessment (Deep)

All signals from quick mode PLUS:

| Signal | Source | Score Mapping |
|--------|--------|--------------|
| **Constraint alignment** | spec.md | 5: Constraints match org standards. 3: Partial. 1: Requires exceptions |
| **Non-functional alignment** | spec.md NFRs | 5: NFRs within platform capabilities. 3: Stretch. 1: Beyond current capabilities |

### Phase 6 — Portfolio Comparison

Compare this feature against other active pipeline items:

```markdown
## Portfolio Context

| Feature | Status | Weighted Score | Effort | Value Density |
|---------|--------|---------------|--------|---------------|
| {this feature} | ASSESSING | {X.XX} | {est} | {ratio} |
| {active feature 1} | IN PIPELINE | {X.XX} | {est} | {ratio} |
| {active feature 2} | IN PIPELINE | {X.XX} | {est} | {ratio} |

**Resource conflict:** {YES/NO — does this compete for same resources?}
**Sequencing consideration:** {Should this go before/after other features?}
```

### Phase 7 — Deep Verdict

```
WEIGHTED SCORE = Σ (dimension_score × weight)

Recommendations:
  ≥ deep_proceed (default 3.2):   BUILD → Proceed to /plan-gen
  > deep_kill AND < deep_proceed:  CONDITIONAL → Proceed with conditions (list conditions)
  ≤ deep_kill (default 2.2):      DEFER/KILL → Do not proceed. Recommend alternative or timing.
```

### Deep Mode Output

```markdown
# Feature Balance Sheet — Deep Assessment

**Feature:** {feature name}
**Spec version:** {version}
**Date:** {date}
**Mode:** Deep (post-spec)
**Quick assessment score:** {X.XX} (for comparison)

## Score Summary

| Dimension | Quick | Deep | Weight | Weighted |
|-----------|-------|------|--------|----------|
| Business Value | {X.X} | {X.X}/5 | 30% | {X.XX} |
| Technical Cost | {X.X} | {X.X}/5 | 25% | {X.XX} |
| Opportunity Cost | {X.X} | {X.X}/5 | 15% | {X.XX} |
| Dependency Impact | {X.X} | {X.X}/5 | 15% | {X.XX} |
| Strategic Alignment | {X.X} | {X.X}/5 | 15% | {X.XX} |
| **TOTAL** | **{X.XX}** | | | **{X.XX}/5** |

**Score delta from quick:** {+/-X.XX} ({improved/degraded/stable})

## Recommendation: {BUILD | CONDITIONAL | DEFER | KILL}

{2-4 sentence rationale with specific evidence from spec}

## Conditions (if CONDITIONAL)
1. {Condition that must be met before proceeding}
2. {Another condition}

## Detailed Scoring

### Business Value ({X.X}/5)
{Paragraph with evidence from spec}

### Technical Cost ({X.X}/5)
{Paragraph with evidence from spec + decision log}

### Opportunity Cost ({X.X}/5)
{Paragraph with portfolio comparison}

### Dependency Impact ({X.X}/5)
{Paragraph with dependency analysis}

### Strategic Alignment ({X.X}/5)
{Paragraph with OKR/roadmap mapping}

## Portfolio Comparison
{Portfolio context table}

## Risk Summary
- **Decision deviations:** {count} significant
- **Fragile assumptions:** {count}
- **Open questions:** {count}
- **Key risk:** {highest risk factor}

## Recommendation History
| Date | Mode | Score | Recommendation |
|------|------|-------|----------------|
| {date} | Quick | {X.XX} | {PROCEED} |
| {date} | Deep | {X.XX} | {BUILD} |
```

---

## Integration with Pipeline

### Pre-spec Gate (Quick Mode)

```
Feature Request
  → /feature-balance-sheet quick
    → PROCEED:          Continue to /spec-gen
    → NEEDS DISCUSSION: HITL gate (human decides)
    → KILL:             Log and stop. Notify stakeholders.
```

### Post-spec Gate (Deep Mode)

```
/spec-gen → /decision-log capture → /quality-gate (spec-to-plan)
  → /feature-balance-sheet deep
    → BUILD:       Continue to /plan-gen
    → CONDITIONAL: HITL gate (human reviews conditions)
    → DEFER/KILL:  Log, archive spec, notify stakeholders.
```

### With `/spec-evolve`

When a spec evolves significantly (blast radius > 50%), re-run `deep` mode to validate the feature still justifies its (now changed) cost.

### With `/decision-log`

The decision log feeds into deep assessment:
- Deviation count and severity → technical risk factor
- Fragile assumptions → risk factor
- Total decision count → complexity indicator

### With `/scope-tracker`

Scope changes trigger reassessment:
- If cumulative scope increase > 30% of original estimate, auto-trigger `deep` reassessment
- Balance sheet score delta tracked in scope ledger

---

## Output Files

| File | Location | Description |
|------|----------|-------------|
| `feature-balance-sheet.md` | Same directory as spec | Full assessment report |
| `balance-sheet-config.json` | Project root (shared) | Scoring weights and thresholds |

---

## Usage

```
/feature-balance-sheet quick       # Pre-spec lightweight go/no-go
/feature-balance-sheet deep        # Post-spec thorough portfolio analysis
```
