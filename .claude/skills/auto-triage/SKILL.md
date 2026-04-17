---
name: auto-triage
description: Automated failure recovery for the SDLC pipeline — classifies failures from any pipeline stage, attempts automated recovery (retry, /review-fix, /spec-fix, /spec-evolve), and only escalates to a HITL gate when the failure genuinely requires a human decision. Sits between /quality-gate failure and human escalation.
argument-hint: "path/to/failed-artifact-or-report [--max-retries 3] [--escalate-after 2]"
allowed-tools: Read, Write, Grep, Glob, Bash(git log, git diff, git show, git stash, git checkout, ls, find, cat, wc, date, jq)
---

# Auto-Triage — Automated Pipeline Failure Recovery

When a pipeline step fails, the naive response is to stop and wait for a human. But most failures are recoverable by the pipeline itself: tests failing means generate better tests or fix the code; review findings mean run `/review-fix`; spec compliance gaps mean run `/spec-fix`. Only a subset of failures genuinely need human judgment.

`/auto-triage` classifies every failure, attempts automated recovery, and escalates only when it must. This keeps the pipeline moving and reserves human attention for decisions only humans can make.

## Failure Classification

| Class | Description | Recovery Path | Escalation |
|-------|------------|--------------|------------|
| TEST_FAILURE | Tests fail after implementation | Re-analyze failure, fix code or test → retry | After 2 failed retries |
| REVIEW_FINDING | /review finds CRITICAL/HIGH issues | /review-fix → re-review | After 2 fix cycles with no improvement |
| SECURITY_FINDING | /security-audit finds vulnerabilities | /review-fix (security mode) → re-audit | CRITICAL findings that need architecture change |
| SPEC_COMPLIANCE | /spec-review finds gaps | /spec-fix → re-review | Gaps that require spec amendment |
| SPEC_AMBIGUITY | /task-implementer hits unclear requirement | Attempt resolution from context → /spec-evolve resolve | If answer isn't in existing artifacts |
| DEPENDENCY_FAILURE | External dependency unavailable | Retry with backoff → check alternatives | After timeout threshold |
| GATE_FAILURE | /quality-gate fails | Route based on failure type → re-evaluate | Non-recoverable criteria |
| BUILD_FAILURE | Code doesn't compile/build | Analyze error, fix → retry | After 2 retries |
| CONFLICT | Two tasks modify same file | Merge resolution → retry | Semantic conflicts |
| SCOPE_GAP | Implementation reveals missing scope | /spec-evolve child or revise | Always (scope decisions need human) |

## CRITICAL RULES

1. **Maximum retry depth.** No recovery path retries more than `--max-retries` times (default: 3). Infinite loops are the worst failure mode.
2. **Escalation is not failure.** Routing to a HITL gate is a normal outcome, not an error. The triage report should help the human resolve quickly.
3. **Track recovery attempts.** Every attempt is logged in `triage-log.json` for `/feedback-loop` analysis.
4. **Don't mask problems.** If a test fails, the goal is to fix the root cause — not to weaken the test. If a security finding is valid, the goal is to fix the code — not to suppress the finding.
5. **Scope decisions always escalate.** When the failure reveals that the spec is missing something, only a human can decide whether to expand scope.

---

## Phase 0 — Classify the Failure

### 0.1 Identify Failure Source

Read the failed artifact or report:
```
Parse the error output, report findings, or gate failure reasons.
Identify: which skill failed, what the error is, which artifact was being processed.
```

### 0.2 Classify

Classify the failure into one of three categories using this logic:

```
1. If the gate/error output names a specific fix skill or recovery route → AUTO_RECOVERABLE
   (e.g., gate says "route to /spec-evolve", error output has a failing test with clear cause)
2. If the output contains a question, ambiguity, or needs human judgment → NEEDS_CONTEXT
   (e.g., "which approach?", "unclear requirement", scope decision needed)
3. Everything else → ESCALATE
   (e.g., infrastructure failure, unknown error, repeated failures)
```

| Category | Description | Action |
|----------|------------|--------|
| AUTO_RECOVERABLE | Gate or error names a fix skill; failure has a clear recovery route | Invoke the fix, re-evaluate, increment retry counter |
| NEEDS_CONTEXT | Ambiguity, question, or human judgment required | Present context and options to the user |
| ESCALATE | No clear automated recovery; or max retries exceeded | Pause pipeline, alert human with full context |

### 0.3 Check Recovery History

Read `triage-log.json` for this artifact:
- Has this failure been seen before?
- How many recovery attempts have been made?
- Is this the same failure recurring (indicating the recovery strategy isn't working)?

---

## Phase 1 — Attempt Recovery

### 1.1 Recovery Loop (AUTO_RECOVERABLE)

For failures classified as AUTO_RECOVERABLE, execute this loop:

```
retry_count = 0
max_retries = --max-retries (default: 2)

while retry_count < max_retries:
    1. Identify the recovery skill from the gate/error output
       (e.g., /review-fix, /spec-fix, /test-gen, /spec-evolve resolve)
    2. Invoke the recovery skill with the failed artifact
    3. Re-evaluate: re-run the gate or re-run the step that failed
    4. If PASS → log as RECOVERED, exit loop
    5. If FAIL with improvement (fewer failures) → increment retry_count, retry
    6. If FAIL with no improvement or SAME error → ESCALATE immediately
    7. If FAIL with DIFFERENT error → reclassify (may become NEEDS_CONTEXT or ESCALATE)
    retry_count++

If retry_count >= max_retries → ESCALATE unconditionally
```

### 1.2 Context Gathering (NEEDS_CONTEXT)

For failures classified as NEEDS_CONTEXT:

```
1. Search existing artifacts for the answer:
   - Check spec.md for relevant ACs, BRs, constraints
   - Check plan.md for architecture decisions
   - Check gate feedback for prior reviewer comments
2. If answer found → reclassify as AUTO_RECOVERABLE, invoke fix
3. If answer NOT found → escalate to HITL gate with:
   - The question or ambiguity
   - Relevant spec/plan context
   - 2-3 suggested options with trade-offs
```

### 1.3 Escalation (ESCALATE)

For failures classified as ESCALATE (or promoted from AUTO_RECOVERABLE/NEEDS_CONTEXT):

```
1. Mark the current stage as paused in pipeline-state.json
2. Produce an escalation brief:
   - What failed and why
   - What recovery was attempted (if any) and the outcome
   - What information or decision is needed
3. Present to the user as a HITL gate
```

---

## Phase 2 — Log and Report

### 2.1 Update Triage Log

Append to `triage-log.json`:

```json
{
  "id": "triage-047-005",
  "date": "2026-02-16T14:30:00Z",
  "pipeline": "pipe-047-sso-login-20260216",
  "stage": "task-implementer-wave-2",
  "task": "TASK-005",
  "classification": "AUTO_RECOVERABLE",
  "description": "3 of 8 tests failing in auth service",
  "recovery_attempts": [
    { "attempt": 1, "action": "Fix test expectations", "result": "2 of 3 resolved" },
    { "attempt": 2, "action": "Fix concurrent refresh", "result": "All passing" }
  ],
  "outcome": "RECOVERED",
  "total_attempts": 2,
  "escalated": false
}
```

### 2.2 Console Output (Recovery Successful)

```
Auto-Triage — TASK-005
━━━━━━━━━━━━━━━━━━━━━━
Classification: TEST_FAILURE
Attempts:       2

Attempt 1: Fixed test expectations (sliding window)
  Result:  2/3 resolved, 1 remaining
Attempt 2: Fixed concurrent refresh handling
  Result:  All tests passing ✓

Outcome: RECOVERED — pipeline continues
Duration: 2m 0s
```

### 2.3 Console Output (Escalation)

```
Auto-Triage — TASK-008
━━━━━━━━━━━━━━━━━━━━━━
Classification: SPEC_AMBIGUITY
Attempts:       1

Attempt 1: Searched spec, plan, gate feedback for answer
  Result:  No clear answer found

ESCALATING to HITL gate:
  Question: "Should SSO support both IdP-initiated and SP-initiated flows?"
  Context:  Spec AC-2 says "support enterprise SSO" but doesn't specify initiation mode.
  Options:
    A) SP-initiated only (simpler, covers 80% of enterprise use cases)
    B) Both (full enterprise compatibility, +2 tasks estimated)
    C) Defer to child spec (implement SP-initiated now, add IdP-initiated later)

Waiting for human decision...
```

---

## Integration with Pipeline

### With /pipeline-orchestrator
The orchestrator invokes `/auto-triage` whenever a stage fails or a `/quality-gate` returns FAIL. Based on the triage outcome (RECOVERED or ESCALATED), the orchestrator either continues the pipeline or pauses at a HITL gate.

### With /feedback-loop
`/feedback-loop` analyzes `triage-log.json` to find patterns: which failure types are most common, which recovery strategies succeed most often, which failures always end up escalating (suggesting the auto-recovery strategy needs improvement).

### With /spec-evolve
`/auto-triage` routes to `/spec-evolve` when the failure is rooted in the spec: ambiguities go to `resolve` mode, missing scope goes to `child` mode, and spec inconsistencies go to `revise` mode.

---

## Modes

```
/auto-triage reports/task-implementer-sso-login-2026-02-16.md
/auto-triage specs/047-sso-login/gate-impl-to-release-2026-02-16.md
/auto-triage --max-retries 2 --escalate-after 1 specs/047-sso-login/
```

---

## Output

1. **Triage log:** `triage-log.json` — recovery attempt history
2. **Recovery artifacts:** Fixed code, regenerated tests, applied fixes (produced by downstream skills)
3. **Escalation brief:** When escalating to HITL, produces a structured question with context and options
4. **Console summary:** Classification, recovery attempts, outcome (RECOVERED or ESCALATED)
