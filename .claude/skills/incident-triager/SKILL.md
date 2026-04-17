---
name: incident-triager
description: When an incident is detected or reported, pull relevant logs, recent git history, and deployment diffs to produce a triage report with root cause candidates, affected services, and recommended remediation paths
argument-hint: "['<incident-description>'|'<commit-hash>'|'<service-name>'|'<error-message>']"
allowed-tools: Read, Write, Grep, Glob, Bash(git log, git diff, git show, git blame, git bisect, kubectl, curl, date, cat, ls, jq)
---

# Incident Triager

When something is broken in production, every minute counts. This skill accelerates triage by automatically gathering the context an on-call engineer needs: the relevant code changes, the deployment timeline, the error patterns, and the likely root causes. Instead of spending 30 minutes opening tabs and running git commands, the engineer gets a structured triage report in minutes.

This skill is designed for the moment between "we know something is wrong" and "we know what to do about it." It does not fix the problem — it gives the human the information they need to make a fast, informed decision about whether to rollback, hotfix, or mitigate.

## Step 1 — Understand the Incident Context

Parse `$ARGUMENTS` to understand what is happening:

- **Error message**: Extract key terms, error codes, exception types
- **Service name**: Scope investigation to that service's code and config
- **Commit hash**: Focus on that specific deployment
- **Incident description**: Extract affected components and symptoms

If `$ARGUMENTS` is vague, scan for active signals (same as `/incident-detector` Step 2) to build context.

## Step 2 — Build a Deployment Timeline

Construct a timeline of what changed and when:

```bash
# Last 20 deployments with full details
git log --oneline --since='7 days ago' --format='%H | %ai | %an | %s' | head -20

# For the most likely causal commit, get full diff
git show <suspect-commit> --stat
git diff <suspect-commit>~1 <suspect-commit> --name-only
```

### Identify the Suspect Window
The suspect window is the time between "last known good" and "first error signal":
- **Last known good**: Last deployment before symptoms appeared
- **First error**: Earliest signal of the incident
- **Suspect commits**: All deployments within the window

```bash
# Commits between last-known-good and first-error
git log --oneline <last-good-hash>..<current-hash> --format='%H %ai %s'
```

## Step 3 — Deep-Dive into Suspect Changes

For each commit in the suspect window, analyze the actual code changes:

```bash
# Full diff of the suspect commit
git diff <commit>~1 <commit>

# Who authored it and what was the intent
git show <commit> --format='Author: %an <%ae>%nDate: %ai%nMessage: %B' --no-patch

# What other files were touched (related changes)
git diff <commit>~1 <commit> --name-only
```

### Classify Each Change

For each suspect commit, categorize:

| Change Type | Risk Level | Examples |
|-------------|-----------|---------|
| **Database migration** | CRITICAL | Schema changes, data transformations, index modifications |
| **Configuration** | HIGH | Env vars, feature flags, connection strings, timeouts |
| **Authentication/Authorization** | HIGH | Auth middleware, RBAC, token handling |
| **API contract** | HIGH | Endpoint changes, request/response schema, versioning |
| **Business logic** | MEDIUM | Core domain code, calculations, workflows |
| **Dependencies** | MEDIUM | Package updates, version bumps |
| **Infrastructure** | HIGH | K8s manifests, Docker configs, terraform |
| **Tests/Docs** | LOW | Test files, documentation, comments |

## Step 4 — Trace the Error Path

Starting from the error signal, work backwards through the code:

### Stack Trace Analysis
If an error message or stack trace is available:
```
Grep: "<error-message-keywords>" in the codebase
```

For each file in the stack trace:
```bash
# Recent changes to this file
git log --since='7 days ago' -p -- <file-path> | head -100

# Who last modified the failing line
git blame <file-path> -L <line-start>,<line-end>
```

### Dependency Chain
Map the dependency chain from the failing component:
```
Grep: "import.*<failing-module>", "require.*<failing-module>", "from.*<failing-module>"
```
Identify upstream and downstream services affected.

### Configuration Trace
If the error looks configuration-related:
```
Glob: **/.env*, **/config.*, **/settings.*, docker-compose.y*
Grep: "<relevant-config-key>"
```
Compare current config with the version at the last-known-good commit:
```bash
git show <last-good-hash>:<config-file>
```

## Step 5 — Generate Root Cause Candidates

Based on the analysis, produce ranked root cause hypotheses:

For each candidate:
```
Root Cause Candidate #N
  Confidence: HIGH | MEDIUM | LOW
  Category: <from root cause categories>

  Evidence:
    - <specific evidence from git, logs, or config>
    - <correlation with deployment timeline>
    - <matching error pattern>

  Causal Chain:
    1. <what changed>
    2. <how it affects the failing component>
    3. <why it produces the observed symptoms>

  Affected Commit: <hash> by <author> at <time>
    Message: <commit message>
    Key Changes: <files and what changed>

  Verification Steps:
    1. <how to confirm this is the root cause>
    2. <what to check>

  Remediation Options:
    Option A: <rollback to commit X>
      Risk: <rollback risk assessment>
      Time to Resolution: <estimated>
    Option B: <hotfix — specific change needed>
      Risk: <hotfix risk assessment>
      Time to Resolution: <estimated>
    Option C: <mitigate — workaround without code change>
      Risk: <mitigation risk assessment>
      Time to Resolution: <estimated>
```

### Root Cause Categories
1. **Code Defect** — Logic error, null pointer, race condition, off-by-one
2. **Configuration Error** — Wrong env var, missing secret, bad connection string
3. **Dependency Failure** — Third-party down, breaking update, version conflict
4. **Infrastructure Issue** — Resource exhaustion, network failure, DNS, certificate
5. **Data Issue** — Bad migration, corrupt data, missing records, schema mismatch
6. **Security Incident** — Vulnerability exploited, unauthorized access
7. **Deployment Error** — Wrong artifact, missing file, incomplete rollout
8. **Performance Degradation** — Slow query, memory leak, CPU spike, connection pool exhaustion
9. **Integration Failure** — API contract broken, schema mismatch, timeout
10. **Human Error** — Manual mistake, wrong command, access misconfiguration

## Step 6 — Produce Triage Report

### Incident Triage Report

```
Incident: <description>
Triage Timestamp: <now>
Time Since First Signal: <duration>
Triaged By: Claude + <on-call engineer>
```

### Situation Summary
2-3 sentences: what is happening, what is affected, current impact.

### Severity Assessment
| Factor | Assessment |
|--------|-----------|
| User Impact | <none/some/many/all users> |
| Data Risk | <none/read-only/write-risk/loss-risk> |
| Cascading | <isolated/spreading/cascading> |
| Workaround | <exists/partial/none> |
| **Severity** | **P0/P1/P2/P3** |

### Deployment Timeline
Chronological list of deployments in the suspect window with risk classification.

### Root Cause Analysis
Ranked list of root cause candidates (from Step 5) with confidence levels.

### Recommended Immediate Action
The single most recommended action, given the evidence:
- **ROLLBACK** if the causal commit is identified with high confidence and rollback is safe
- **HOTFIX** if the fix is obvious, small, and rollback carries risk (e.g., irreversible migration)
- **MITIGATE** if the root cause is unclear but impact can be reduced (e.g., feature flag, traffic shift)
- **INVESTIGATE** if confidence is low and more data is needed

### Affected Services Map
List of services, modules, and teams affected.

### Communication Template
Draft status update for stakeholders:
```
[INCIDENT] <severity> — <one-line summary>
Impact: <who/what is affected>
Status: <investigating|identified|mitigating|resolved>
ETA: <estimated time to resolution>
Next update: <time>
```

## Step 7 — Save Report

1. Create the `reports/` directory if it doesn't exist: `mkdir -p reports`
2. Get today's date and time: `date +%Y-%m-%d` and capture as `$DATE`
3. Determine the scope label from the incident description or service name
4. Save to: `reports/incident-triage-<scope>-<DATE>.md`
   - Include YAML front-matter: `date`, `scope`, `severity`, `root_cause_candidates`, `top_candidate_confidence`, `recommended_action`, `affected_services_count`, `time_to_triage_minutes`
5. Print the file path and recommended action

**Naming examples:**
- `reports/incident-triage-api-timeout-2026-02-13.md`
- `reports/incident-triage-auth-failure-2026-02-13.md`

**Tip:** After resolving the incident, run `/incident-postmortem-synthesizer` to capture lessons learned. Feed both reports into `/report-trends` to track MTTR and incident frequency over time. Pair with `/rollback-assessor` before executing a rollback to verify it is safe.
