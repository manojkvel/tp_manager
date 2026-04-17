---
name: plan-merge
description: Merge multiple /plan-gen outputs into a unified execution plan — resolving cross-plan dependencies, identifying shared file changes, determining parallelism, and producing a single sequenced execution order. Use this after running /plan-gen individually on multiple specs that originated from the same initiative or share common codebase areas.
argument-hint: "specs/*/plan.md [--dry-run]"
allowed-tools: Read, Write, Grep, Glob, Bash(git log, git shortlog, ls, find, tree)
---

# Plan Merge — Unified Execution Planner

Merge multiple individual implementation plans (each produced by `/plan-gen`) into a single, sequenced execution plan. The merged plan resolves cross-plan dependencies, identifies file conflicts, determines which plans can run in parallel, and produces a unified execution order that minimizes rework and merge conflicts.

This skill exists because running `/plan-gen` individually on each spec produces deeper, more traceable plans than running it once across all specs. But individual plans are blind to each other — they don't know that Plan A modifies the same file Plan B creates, or that Plan C's data migration must land before Plan D's service layer can compile. `/plan-merge` closes that gap.

## When to Use This Skill

Run `/plan-merge` after you have 2 or more approved plans from `/plan-gen` that will be implemented in the same codebase within the same release cycle. Common scenarios:

- An initial spec had gaps; supplementary specs were generated and each got its own plan
- A large initiative was split into multiple specs for manageability
- Parallel workstreams produced plans that touch overlapping code areas
- A dependency upgrade triggers cascading changes across multiple features

## CRITICAL RULES

1. **Never modify the individual plans.** This skill reads plans as inputs and produces a new merged plan as output. The original plans remain the source of truth for their respective specs.
2. **Every item in the merged plan must trace back to its source plan.** No orphaned work items.
3. **File conflicts must be surfaced, not silently resolved.** If two plans both MODIFY the same file, the merged plan must sequence them and flag the conflict for review.
4. **Cross-plan dependencies are first-class.** If Plan B assumes an interface that Plan A creates, that ordering constraint must be explicit in the merged plan.
5. **Parallelism is the goal, not just sequencing.** The merged plan should maximize what can be done concurrently.

---

## Phase 1 — Discover and Load Plans

### 1.1 Find Plans

If the user provides explicit paths, use those. Otherwise, discover plans:

```
Glob: specs/*/plan.md, .specify/specs/**/plan.md
```

List all discovered plans and confirm with the user which ones to merge. Don't assume all plans should be merged — some may be for unrelated features.

### 1.2 Load Each Plan

For each plan, extract into a structured representation:

- **Plan ID**: Derive from the spec directory name (e.g., `047-sso-login`)
- **Spec reference**: Path to the original spec
- **Phases**: Ordered list with goals, AC traceability, file changes
- **File manifest**: Every file touched (CREATE or MODIFY) with action type and phase
- **Architecture decisions**: AD-1, AD-2, etc.
- **Risks**: Severity and likelihood ratings
- **Dependencies**: The mermaid dependency graph between phases
- **Estimated effort**: T-shirt size
- **External dependencies**: APIs, services, team dependencies

### 1.3 Load Specs for Context

For each plan, read the linked spec to understand:
- Acceptance criteria (needed for traceability validation)
- Open questions (any unresolved? stop and flag them)
- Business rules that might create cross-spec constraints

If any spec has unresolved open questions, **stop** and tell the user. Merging plans built on ambiguity compounds the problem.

---

## Phase 2 — Cross-Plan Analysis

This is the core value of the skill. Analyze all plans together to find relationships invisible to each plan individually.

### 2.1 File Conflict Detection

Build a global file map across all plans:

```
For each file mentioned across all plans:
  - Which plans touch it?
  - What action? (CREATE vs MODIFY)
  - In which phase of each plan?
```

Classify each conflict:

| Conflict Type | Description | Risk Level |
|--------------|-------------|------------|
| **CREATE-CREATE** | Two plans both create the same file | HIGH — likely different implementations of the same concept |
| **MODIFY-MODIFY** | Two plans both modify the same file | MEDIUM — may cause merge conflicts if done in parallel |
| **CREATE-MODIFY** | One plan creates a file another plan modifies | ORDERING — creator must go first |
| **MODIFY-DELETE** | One plan modifies a file another plan deletes | HIGH — incompatible intentions |

### 2.2 Interface Dependency Detection

Look for cross-plan interface dependencies — where one plan produces something another plan consumes:

- Plan A creates an ABC/interface that Plan B imports
- Plan A adds a database table that Plan C queries
- Plan A introduces an API endpoint that Plan D calls
- Plan A defines a config key that Plan E reads

These are detected by:

```
For each CREATE action across all plans:
  Search other plans for references to that file path,
  class name, function name, or table name
```

Every match is a **cross-plan dependency edge**: the creating plan must complete (at least the relevant phase) before the consuming plan can start (its relevant phase).

### 2.3 Architecture Decision Conflicts

Compare architecture decisions across plans:

- Do two plans make contradictory technology choices? (e.g., Plan A chooses Redis for caching, Plan B chooses Memcached)
- Do two plans define overlapping API routes?
- Do two plans create competing abstractions for the same concept?

These are **blocking conflicts** — they cannot be resolved by sequencing alone. They require a human decision.

### 2.4 Risk Aggregation

Merge risk tables from all plans. If the same risk appears in multiple plans (e.g., "database migration risk"), consolidate it and elevate severity — a risk that affects multiple features is more severe than one affecting a single feature.

---

## Phase 3 — Build Execution Graph

### 3.1 Construct the Dependency Graph

Nodes are plan-phases (e.g., `047-sso-login:Phase-1`, `048-rbac:Phase-2`).

Edges come from three sources:
1. **Intra-plan edges**: The existing phase ordering within each plan (Phase 1 → Phase 2 → Phase 3)
2. **File-conflict edges**: If Plan A and Plan B both modify `src/auth/service.ts`, sequence them to avoid merge conflicts
3. **Interface-dependency edges**: If Plan B Phase 3 imports an interface created in Plan A Phase 2, add `A:Phase-2 → B:Phase-3`

### 3.2 Topological Sort

Sort the combined graph. If there's a cycle, report it — it indicates a design flaw (two plans that depend on each other circularly). The user must resolve cycles before merging can proceed.

### 3.3 Identify Parallel Tracks

After topological sorting, identify which plan-phases can run concurrently:

- Plan-phases at the same topological level with no edges between them are parallelizable
- Group them into **execution waves** — each wave contains all plan-phases that can run simultaneously

### 3.4 Critical Path Analysis

The critical path is the longest chain through the dependency graph. This determines the minimum calendar time for the entire initiative.

Calculate:
- Critical path (longest sequence of dependent plan-phases)
- Total effort (sum of all plan estimates)
- Parallel efficiency (total effort / critical path effort — higher means more parallelism)

---

## Phase 4 — Write the Merged Plan

Create the merged plan at: `specs/merged-plan-<initiative-slug>.md`

If a `specs/` directory doesn't contain a natural parent, create it at: `merged-plans/merged-plan-<date>.md`

### Merged Plan Template

```markdown
# Merged Execution Plan: <Initiative Title>

> **Plans merged:** <N>
> **Generated:** <date>
> **Total estimated effort:** <sum of all plan estimates>
> **Critical path effort:** <effort along critical path>
> **Parallel efficiency:** <ratio>
> **Execution waves:** <N>

---

## 1. Source Plans

| # | Plan | Spec | Effort | Phases | Files |
|---|------|------|--------|--------|-------|
| P1 | [<plan title>](path/to/plan.md) | [<spec title>](path/to/spec.md) | M | 5 | 12 |
| P2 | [<plan title>](path/to/plan.md) | [<spec title>](path/to/spec.md) | L | 4 | 18 |

## 2. Cross-Plan Dependencies

Dependencies that exist BETWEEN plans (not within a single plan):

| # | From | To | Reason | Type |
|---|------|----|--------|------|
| XD-1 | P1:Phase-2 | P3:Phase-1 | P3 imports EventBus interface created in P1 | Interface |
| XD-2 | P1:Phase-3 | P2:Phase-2 | Both modify src/auth/middleware.ts | File conflict |

## 3. File Conflict Map

Files touched by more than one plan:

| File | Plans | Actions | Resolution |
|------|-------|---------|------------|
| src/auth/middleware.ts | P1 (MODIFY, Phase 3), P2 (MODIFY, Phase 2) | SEQUENCE: P1 first, then P2 rebases | Sequenced in Wave 2 → Wave 4 |
| src/models/user.ts | P1 (CREATE), P3 (MODIFY) | ORDERING: P1 creates, P3 modifies after | Sequenced in Wave 1 → Wave 3 |

## 4. Architecture Decision Conflicts

Decisions across plans that need human resolution:

| # | Conflict | Plan A Decision | Plan B Decision | Status |
|---|----------|----------------|----------------|--------|
| ADC-1 | Caching strategy | P1: Redis | P4: In-memory LRU | NEEDS DECISION |

If this section is empty, no conflicts were found.

## 5. Execution Waves

### Wave 1 — Foundation
**Can start immediately. No cross-plan dependencies.**

| Plan-Phase | Goal | Est. Effort | Files |
|-----------|------|-------------|-------|
| P1:Phase-1 | Data layer for SSO login | S | 3 |
| P3:Phase-1 | Data layer for RBAC | S | 4 |

### Wave 2 — Service Layer (after Wave 1)
**Depends on Wave 1 completing.**

| Plan-Phase | Goal | Est. Effort | Files |
|-----------|------|-------------|-------|
| P1:Phase-2 | SSO service logic | M | 5 |
| P2:Phase-1 | JWT migration data layer | S | 3 |
| P3:Phase-2 | RBAC service logic | M | 6 |

### Wave 3 — API & Integration (after Wave 2)
...

### Wave N — Cleanup & Documentation (after Wave N-1)
...

## 6. Critical Path

```mermaid
graph LR
    P1_1[P1:Phase 1] --> P1_2[P1:Phase 2]
    P1_2 --> P3_3[P3:Phase 3]
    P3_3 --> P2_4[P2:Phase 4]
    P2_4 --> ALL_5[All: Cleanup]
```

**Critical path effort:** M + M + L + S = ~XL equivalent
**Parallel tracks saved:** <N> plan-phases run concurrently, saving ~<X> effort units

## 7. Aggregated Risks

| Risk | Source Plans | Severity | Likelihood | Mitigation |
|------|------------|----------|-----------|------------|
| Database migration ordering | P1, P3 | HIGH | MEDIUM | Run P1 migration first; P3 migration depends on P1 schema |
| Auth middleware merge conflict | P1, P2 | MEDIUM | HIGH | P1 completes auth changes before P2 starts; P2 rebases |

## 8. Execution Checklist

Pre-execution:
- [ ] All architecture decision conflicts resolved (Section 4)
- [ ] All specs have open questions resolved
- [ ] Team assigned to each wave's plan-phases

Per-wave:
- [ ] All predecessor waves completed
- [ ] Run `/task-gen` on each plan-phase entering the wave
- [ ] Run `/task-implementer` on generated tasks
- [ ] Run `/review` + `/review-fix` on completed tasks
- [ ] Run `/spec-review` + `/spec-fix` after all plan-phases in wave complete

Post-execution:
- [ ] Run `/regression-check` across all modified files
- [ ] Run `/pr-orchestrator` for final PR

## 9. Traceability Index

Every acceptance criterion across all specs, mapped to its plan, wave, and status:

| Spec | AC | Plan Phase | Wave | Status |
|------|----|-----------|------|--------|
| 047-sso-login | AC-1 | P1:Phase-1 | Wave 1 | PENDING |
| 047-sso-login | AC-2 | P1:Phase-2 | Wave 2 | PENDING |
| 048-rbac | AC-1 | P3:Phase-1 | Wave 1 | PENDING |
```

---

## Phase 5 — Validation

### 5.1 Completeness Check

- [ ] Every phase from every input plan appears in exactly one execution wave
- [ ] Every AC from every spec is represented in the traceability index
- [ ] Every file conflict has a resolution strategy (sequenced or flagged for human decision)
- [ ] Every cross-plan dependency has a corresponding wave ordering that respects it

### 5.2 Cycle Check

Verify the execution graph has no cycles. If it does, the merged plan is invalid — report the cycle and which plans are involved.

### 5.3 Conflict Resolution Check

- [ ] No unresolved architecture decision conflicts (Section 4 must be empty or all marked RESOLVED)
- [ ] No CREATE-CREATE conflicts without human resolution
- [ ] No MODIFY-DELETE conflicts without human resolution

### 5.4 Wave Ordering Check

For every cross-plan dependency edge `A:Phase-X → B:Phase-Y`:
- Verify A:Phase-X is in an earlier wave than B:Phase-Y
- If they're in the same wave, flag as an ordering violation

---

## Modes

### Default Mode

Merge all provided plans, produce the full merged plan.

```
/plan-merge specs/047-sso-login/plan.md specs/048-rbac/plan.md specs/049-jwt-migration/plan.md
```

### Auto-Discover Mode

Find and merge all plans under a directory:

```
/plan-merge specs/
```

Discovers all `plan.md` files under `specs/`, lists them, confirms with user, then merges.

### Dry-Run Mode

Analyze cross-plan dependencies and conflicts without producing a merged plan. Useful for deciding whether plans need revision before merging.

```
/plan-merge specs/047-*/plan.md specs/048-*/plan.md --dry-run
```

Outputs:
- File conflict map
- Cross-plan dependency list
- Architecture decision conflicts
- Estimated wave count and critical path
- GO / REVISE-FIRST recommendation

---

## Output

1. **Primary:** `specs/merged-plan-<slug>.md` — The unified execution plan
2. **Console summary:** Plans merged, waves, critical path, conflicts found, parallel efficiency
3. **Next action:** Resolve any architecture conflicts (Section 4), then execute wave by wave — running `/task-gen` → `/task-implementer` → `/review` → `/review-fix` → `/spec-review` → `/spec-fix` for each plan-phase in the current wave before advancing to the next wave
