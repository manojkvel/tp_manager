---
name: run-pipeline
description: "Execute a pipeline YAML — resolve steps, invoke skills in order, enforce gates, persist state for resume."
argument-hint: "<role>/<pipeline-name> [args] [--dry-run] [--resume] [--gates minimal|standard|strict]"
allowed-tools: Read, Write, Grep, Glob, Bash(git log, git diff, ls, find, date, jq)
---

# Pipeline Runner

Execute role-specific pipeline workflows that chain skills into automated sequences. Reads a YAML definition, runs skills in dependency order, enforces quality gates, and saves state for resume.

## CRITICAL RULES

1. **Read the pipeline YAML first.** Never guess — load and parse the definition.
2. **Respect gate conditions.** `on_fail: stop` means stop. `on_fail: hitl` means pause for human input.
3. **Save state after every step.** Write `pipeline-state.json` so the pipeline can resume.
4. **Never skip HITL gates.** Human approval gates are mandatory pause points.
5. **Interpolate arguments correctly.** `$INPUT` = user's original input. `$step-id.output` = output from a completed step.

## Phase 1 — Load Pipeline

Resolve path from `/run-pipeline <role>/<pipeline-name>` to `.claude/pipelines/<role>/<pipeline-name>.pipeline.yaml`. Parse YAML to extract `steps`, `gates`, and `output`. Load gate profile from `.claude/config/gate-config.json` (default: `standard`). If `--resume`, read `pipeline-state-<pipeline-name>.json` and continue from the first non-completed step.

## Phase 2 — Execute Steps

Build a dependency graph from `depends_on` fields. Execute in topological order:

```
for each step in order:
  1. Verify all depends_on steps are completed
  2. Interpolate args ($INPUT → user input, $<step-id>.output → output path)
  3. Invoke the skill, capture output artifact path
  4. Evaluate gate if present:
     - PASS → continue
     - FAIL + on_fail: stop → halt pipeline
     - FAIL + on_fail: auto_recover → invoke recovery skill
     - FAIL + on_fail: hitl → pause for human decision
  5. Update pipeline-state.json (status, output, timestamps)
```

**Gate types:**

| Type | Behavior |
|------|----------|
| `decision` | Evaluate `pass_condition` against step output |
| `quality` | Invoke `/quality-gate` with transition type |
| `hitl` | Pause for human approval |

**HITL handling:** Display what was produced, present the gate description, ask for APPROVE / APPROVE WITH CONDITIONS / REJECT / DEFER. Approve continues, reject stops, defer saves state for later resume.

## Phase 3 — State Management

Write `.claude/pipelines/pipeline-state-<pipeline-name>.json`:

```json
{
  "pipeline": "<role>/<pipeline-name>",
  "input": "<original user input>",
  "started_at": "<timestamp>",
  "updated_at": "<timestamp>",
  "gate_profile": "standard",
  "status": "in_progress|completed|failed",
  "total_steps": 8,
  "completed_steps": 3,
  "steps": {
    "<step-id>": {
      "status": "completed|in_progress|pending|failed|skipped",
      "skill": "<skill-name>",
      "started_at": "<timestamp>",
      "completed_at": "<timestamp>",
      "output": "<artifact path>",
      "gate_result": "pass|fail|hitl_approved|hitl_rejected"
    }
  }
}
```

On `--resume`: read the state file, find the first non-completed step, continue.

## Phase 4 — Output

Show progress during execution (`✓` done, `●` running, `○` pending). On completion, display summary with artifacts and suggest `output.next_pipeline` if defined.

## Dry Run Mode

With `--dry-run`: parse the YAML, display the step chain with gates, but execute nothing.

```
Pipeline: product-owner/feature-intake (DRY RUN)
Steps:
  1. quick-assess  → /feature-balance-sheet quick $INPUT
     Gate: decision → stop on fail
  2. write-spec    → /spec-gen $INPUT (depends on: quick-assess)
  3. validate-spec → /quality-gate spec-to-plan
     Gate: quality → auto-recover with /spec-evolve
  4. briefing      → /gate-briefing  (Gate: HITL)
Artifacts: spec.md, feature-balance-sheet.md
Next: architect/design-to-plan
```

## Error Handling

- **Skill not found:** Mark step as failed, stop pipeline.
- **Gate failure with no recovery:** Stop pipeline, display failure reason.
- **User cancels:** Save current state for later resume.
