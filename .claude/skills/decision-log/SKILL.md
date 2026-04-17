---
name: decision-log
description: 
argument-hint: "capture|extract|review path/to/spec.md"
allowed-tools: Read, Write, Grep, Glob, Bash(git log, git diff, ls, find, cat, wc, date, jq)
---
# /decision-log — Decision & Deviation Journal

## Purpose

Capture the **reasoning behind choices** made during specification and planning — not just what was decided, but what alternatives were considered, why they were rejected, what trade-offs were accepted, and what assumptions underpin each decision. Produces a living decision journal that answers "why did we build it this way?" months after the fact.

Operates in three modes:

| Mode | When | Input | Output |
|------|------|-------|--------|
| `capture` | Real-time alongside `/spec-gen` or `/plan-gen` | Feature request + generated artifact | `decision-log.md` created alongside the artifact |
| `extract` | Retrospectively on existing artifacts | Existing `spec.md` and/or `plan.md` | `decision-log.md` reverse-engineered from implicit decisions |
| `review` | After `/spec-evolve` revises a spec | Two spec versions + existing decision log | Updated `decision-log.md` with evolution annotations |

---

## Decision Entry Structure

Every decision is recorded as a structured entry:

```markdown
### DEC-{NNN}: {Decision Title}

**Context:** {What situation or requirement prompted this decision}
**Decision:** {What was chosen}
**Status:** ACTIVE | SUPERSEDED | DEFERRED | REVERSED

#### Alternatives Considered

| # | Alternative | Pros | Cons | Rejection Reason |
|---|-------------|------|------|------------------|
| 1 | {alt 1} | {pros} | {cons} | {why not chosen} |
| 2 | {alt 2} | {pros} | {cons} | {why not chosen} |

#### Trade-offs Accepted
- {What was given up in exchange for what was gained}

#### Assumptions
- {What must remain true for this decision to hold}
- {If this assumption breaks, reconsider this decision}

#### Constraints That Influenced
- {Technical, business, time, or regulatory constraints}

#### Deviation from Standard
- **Standard approach:** {What the "textbook" approach would be}
- **Our approach:** {What we actually chose}
- **Why:** {Rationale for deviating}
*(Omit this section if the decision follows standard practice)*

#### Downstream Impact
- **Affected phases:** {spec | plan | tasks | impl | test}
- **Affected skills:** {Which pipeline skills are impacted}
```

---

## Mode: `capture`

### When

Invoked by `/pipeline-orchestrator` **alongside** `/spec-gen` or `/plan-gen`. The orchestrator passes the feature request context and the generated artifact.

### Phase 1 — Identify Decision Points

Analyze the generated spec or plan and identify every point where a choice was made. Decision points include:

| Category | Examples |
|----------|----------|
| **Architecture** | Monolith vs microservice, sync vs async, SQL vs NoSQL |
| **Scope** | What's in vs out, MVP vs full, phased vs big-bang |
| **Technology** | Framework, library, protocol, API style |
| **Approach** | Build vs buy, migrate vs rewrite, extend vs replace |
| **Trade-off** | Performance vs maintainability, speed vs completeness |
| **Constraint** | Imposed by time, budget, compliance, existing systems |
| **Assumption** | Market behavior, user behavior, system capacity |
| **Risk acceptance** | Known risks accepted, mitigations deferred |

### Phase 2 — Reconstruct Reasoning

For each decision point, reconstruct the reasoning:

1. **What alternatives existed?** — List at least 2 alternatives for non-trivial decisions
2. **What criteria were used?** — Extract from spec constraints, BRs, NFRs
3. **Why this choice?** — Map to specific requirements, constraints, or strategic goals
4. **What was traded away?** — Identify the cost of the choice
5. **What assumptions enable it?** — Identify fragile assumptions that could invalidate the decision

### Phase 3 — Classify Deviations

Flag decisions that deviate from standard/common practice:

```
DEVIATION SEVERITY:
- MINOR:  Uncommon but reasonable (e.g., choosing a less popular library)
- NOTABLE: Against common wisdom, has clear rationale (e.g., NoSQL for relational data)
- SIGNIFICANT: High-risk deviation requiring explicit justification (e.g., skipping auth layer)
```

### Phase 4 — Produce Decision Log

Write `decision-log.md` using the entry structure above. Include:

```markdown
# Decision & Deviation Log

**Feature:** {feature name}
**Spec version:** {spec version if available}
**Generated:** {date}
**Source:** /spec-gen | /plan-gen | retrospective extract

## Summary

| ID | Decision | Status | Deviation | Impact |
|----|----------|--------|-----------|--------|
| DEC-001 | {title} | ACTIVE | NONE | spec, plan |
| DEC-002 | {title} | ACTIVE | NOTABLE | plan, impl |
| ... | ... | ... | ... | ... |

**Total decisions:** {N}
**Deviations from standard:** {count} ({minor}/{notable}/{significant})
**Key assumptions:** {count} (fragile: {count})

## Decisions

{Full entries in DEC-NNN format}

## Assumption Register

| # | Assumption | Supports Decisions | Fragility | Validation Method |
|---|-----------|-------------------|-----------|-------------------|
| A-001 | {assumption} | DEC-001, DEC-003 | HIGH | {how to validate} |

## Deviation Summary

| ID | Standard Approach | Our Approach | Severity | Rationale |
|----|-------------------|--------------|----------|-----------|
| DEC-002 | {standard} | {ours} | NOTABLE | {why} |
```

---

## Mode: `extract`

### When

Run on existing `spec.md` and/or `plan.md` that were created without a decision log.

### Process

1. **Read the artifact** — Parse spec or plan structure
2. **Identify implicit decisions** — Look for:
   - Technology choices mentioned in constraints or implementation notes
   - Scope boundaries (in-scope / out-of-scope)
   - Architecture patterns referenced
   - Trade-offs mentioned in risk sections
   - Assumptions stated in prerequisites
   - "We will..." or "The system shall..." statements that imply a choice
3. **Infer alternatives** — For each identified decision, infer what the alternatives likely were based on domain knowledge
4. **Flag uncertainty** — Mark inferred reasoning with `[INFERRED]` when the rationale isn't explicitly stated in the artifact
5. **Produce decision log** — Same format as `capture` mode, with `[INFERRED]` annotations

### Confidence Levels

```
EXPLICIT:   Decision and rationale are stated in the artifact
IMPLICIT:   Decision is visible but rationale must be inferred
ASSUMED:    Decision is implied by the artifact structure, not stated
```

---

## Mode: `review`

### When

Run after `/spec-evolve` revises a spec to track how decisions evolve.

### Input

- Previous `decision-log.md`
- Previous `spec.vN.md`
- New `spec.vN+1.md`
- Spec evolution change log

### Process

1. **Compare versions** — Diff the two spec versions
2. **Identify affected decisions** — Match changes to existing DEC-NNN entries
3. **Update decision status:**
   - `ACTIVE` → `SUPERSEDED` (if the decision was reversed or replaced)
   - `ACTIVE` → `ACTIVE` with amendment (if the decision was adjusted)
   - New `ACTIVE` entries for new decisions introduced
4. **Track decision chains** — Link superseded decisions to their replacements:
   ```
   DEC-003 (SUPERSEDED by DEC-012): Originally chose JWT auth...
   DEC-012 (ACTIVE, supersedes DEC-003): Switched to session-based auth because...
   ```
5. **Update assumption register** — Mark validated or invalidated assumptions
6. **Append evolution section:**

```markdown
## Decision Evolution — v{N} → v{N+1}

**Trigger:** {spec-evolve trigger}
**Decisions affected:** {count}
**Decisions superseded:** {count}
**New decisions:** {count}
**Assumptions invalidated:** {count}

| Original | Change | New | Reason |
|----------|--------|-----|--------|
| DEC-003 | SUPERSEDED | DEC-012 | {reason for change} |
```

---

## Integration with Pipeline

### With `/spec-gen`

The orchestrator invokes `/decision-log capture` immediately after `/spec-gen` completes, passing:
- The original feature request
- The generated `spec.md`
- Any context or constraints provided

Output: `decision-log.md` placed alongside `spec.md`

### With `/plan-gen`

Same pattern — invoked after `/plan-gen`, passing:
- The spec and its decision log
- The generated `plan.md`

Output: Appends plan-level decisions to the existing `decision-log.md` under a new `## Plan Decisions` section

### With `/spec-evolve`

Invoked in `review` mode when spec evolves:
- Compares decision log against spec changes
- Updates statuses and adds evolution entries

### With `/gate-briefing`

Gate briefings reference the decision log:
- Key decisions that should be validated at the gate
- Assumptions that should be checked
- Deviations that require human acknowledgment

### With `/feature-balance-sheet`

The decision log feeds the balance sheet's risk dimension:
- Number of significant deviations → risk factor
- Number of fragile assumptions → risk factor
- Decision complexity (total decisions) → complexity indicator

---

## Output Files

| File | Location | Description |
|------|----------|-------------|
| `decision-log.md` | Same directory as spec/plan | Primary decision journal |

---

## Usage

```
/decision-log capture          # Real-time alongside spec-gen or plan-gen
/decision-log extract          # Retrospective on existing spec.md / plan.md
/decision-log review           # After spec-evolve, track decision evolution
```
