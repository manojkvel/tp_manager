---
name: rollback-assessor
description: Evaluate whether a rollback is safe by checking for irreversible database migrations, API contract changes with live consumers, feature flag dependencies, and data state incompatibilities — produces a GO/NO-GO recommendation
argument-hint: "['<commit-to-rollback-to>'|'HEAD~N'|'<tag-name>']"
allowed-tools: Read, Write, Grep, Glob, Bash(git log, git diff, git show, git blame, kubectl, curl, date, cat, ls, jq)
---

# Rollback Assessor

When an incident is confirmed and the team is considering rolling back, this is the most critical question: will rolling back make things better or worse? A rollback that reverses an irreversible database migration can cause data loss. A rollback that breaks an API contract with live consumers can cascade failures to dependent services. A rollback that removes a feature flag that other services already depend on can create a worse outage than the original incident.

This skill exists for that high-pressure moment when an engineer is staring at the rollback button at 2am and needs to know: is it safe?

It does not execute the rollback. It produces a GO/NO-GO recommendation with specific evidence so the engineer can make an informed decision in minutes, not hours.

## Step 1 — Determine Rollback Scope

Parse `$ARGUMENTS` to identify the rollback target:

```bash
# Resolve the target commit
git rev-parse $ARGUMENTS 2>/dev/null

# Current HEAD
git rev-parse HEAD

# Commits that would be rolled back
git log --oneline $ARGUMENTS..HEAD
```

Capture the **rollback delta**: the set of commits between the target and current HEAD. These are the changes that would be undone.

```bash
# Files affected by the rollback
git diff $ARGUMENTS HEAD --name-only

# Full stat of changes being rolled back
git diff $ARGUMENTS HEAD --stat

# Number of commits being rolled back
git log --oneline $ARGUMENTS..HEAD | wc -l
```

## Step 2 — Check Database Migrations

This is the highest-risk factor. Irreversible migrations make rollbacks dangerous or impossible.

### Detect Migration Files
```
Glob: **/migrations/*, **/migrate/*, **/db/migrate/*, **/alembic/versions/*, **/flyway/*, **/liquibase/*
```

Filter to migrations in the rollback delta:
```bash
git diff $ARGUMENTS HEAD --name-only | grep -i 'migrat'
```

### Classify Each Migration

For each migration file in the rollback delta, read and classify:

| Operation | Reversible? | Risk |
|-----------|-------------|------|
| **CREATE TABLE** | Yes (DROP TABLE) | LOW — data in new table may be lost |
| **ADD COLUMN** (nullable) | Yes (DROP COLUMN) | LOW — data in new column lost |
| **ADD COLUMN** (NOT NULL with default) | Yes | MEDIUM — verify no code depends on it |
| **DROP COLUMN** | NO | CRITICAL — data already deleted |
| **DROP TABLE** | NO | CRITICAL — data already deleted |
| **RENAME COLUMN/TABLE** | Risky | HIGH — other services may reference old name |
| **ALTER TYPE** (widen) | Yes | LOW |
| **ALTER TYPE** (narrow/change) | NO | CRITICAL — data may be truncated |
| **INSERT/UPDATE/DELETE data** | NO | CRITICAL — data mutations are one-way |
| **CREATE INDEX** | Yes (DROP INDEX) | LOW |
| **DROP INDEX** | Risky | MEDIUM — performance impact on rollback target |

### Down Migration Check
```
Grep: "def down", "def change", "reversible", "down()", "rollback" in migration files
```
If down migrations exist and are complete, risk is lower. If missing, flag as HIGH risk.

## Step 3 — Check API Contract Changes

Rolling back API changes can break consumers that have already adopted the new contract.

### Detect API Surface Changes
```bash
git diff $ARGUMENTS HEAD --name-only | grep -iE 'api|route|endpoint|controller|handler|schema|proto|openapi|swagger|graphql'
```

### Classify API Changes

For each API-related file in the rollback delta:
```bash
git diff $ARGUMENTS HEAD -- <file>
```

| Change Type | Rollback Risk |
|-------------|--------------|
| **New endpoint added** | MEDIUM — consumers may already call it |
| **Endpoint removed** | LOW (rolling back restores it) |
| **Request schema changed** (new required field) | HIGH — consumers sending new field format will break |
| **Response schema changed** (field removed) | MEDIUM — consumers may not depend on new field yet |
| **Response schema changed** (field type changed) | HIGH — consumers parsing new type will break |
| **Authentication changed** | HIGH — token formats, scopes may be incompatible |
| **Versioned API (v1 -> v2)** | LOW if both versions exist; HIGH if v1 was removed |

### Check for Consumer Dependencies
```
Grep: "api/", "endpoint", "fetch(", "axios.", "httpClient" across the codebase
Glob: **/client/*, **/sdk/*, **/consumer/*
```

If the project has multiple services or a client SDK, check whether any consumers have been updated to use the new API contract.

## Step 4 — Check Feature Flag Dependencies

Features behind flags may have state that persists beyond the code rollback.

### Detect Feature Flag Changes
```bash
git diff $ARGUMENTS HEAD | grep -iE 'feature.flag|feature.toggle|LaunchDarkly|unleash|flipt|FEATURE_|isEnabled|isFeatureOn'
```

```
Glob: **/feature*, **/flags.*, **/toggles.*
```

### Assess Flag State Risk

| Scenario | Risk |
|----------|------|
| **New flag introduced, code gated behind it** | LOW — rollback removes code, flag becomes inert |
| **Existing flag removed, code ungated** | MEDIUM — flag may need to be re-enabled |
| **Flag default changed** | HIGH — rolling back changes default, may toggle behavior unexpectedly |
| **External flag service (LaunchDarkly/Unleash) already updated** | HIGH — code rollback doesn't rollback flag state |

## Step 5 — Check Data State Compatibility

Even without migrations, the application state may have evolved.

### Data Format Changes
```bash
git diff $ARGUMENTS HEAD | grep -iE 'serialize|deserialize|marshal|unmarshal|encode|decode|schema|format|version'
```

Check for:
- New data formats written since the deployment (will old code read them?)
- Cache keys changed (stale cache could cause errors)
- Session format changes (will old code understand new sessions?)
- Queue message format changes (consumers expecting old format?)

### State Store Changes
```
Grep: "redis", "cache", "session", "queue", "kafka", "stream" in changed files
```

If Redis/cache keys or message formats changed, the rollback target code may not understand data written by the current version.

## Step 6 — Check Infrastructure Dependencies

### Kubernetes/Container Changes
```bash
git diff $ARGUMENTS HEAD --name-only | grep -iE 'k8s|kubernetes|helm|docker|terraform|infra|deploy'
```

Check for:
- Resource limit changes (rollback to lower limits may cause OOM)
- New services/sidecars added (rollback removes them, what depends on them?)
- Network policy changes (rollback may block required traffic)
- New volumes/mounts (data written to new paths becomes inaccessible)

### Environment Variable Changes
```bash
git diff $ARGUMENTS HEAD | grep -iE 'ENV |environment:|env:' | head -20
```

If new env vars were added and the application requires them, the rollback target will fail unless the env vars are also rolled back.

## Step 7 — Produce GO/NO-GO Assessment

### Rollback Assessment Report

```
Assessment Timestamp: <now>
Rollback Target: <commit hash> (<tag or description>)
Current Version: <HEAD hash>
Commits to Rollback: N
Files Affected: N
Assessment Duration: <time taken>
```

### Verdict

**GO** — Rollback is safe. No irreversible changes detected. Proceed with rollback.

**GO WITH CAUTION** — Rollback is likely safe but has minor risks that should be monitored post-rollback. Specific monitoring actions listed.

**NO-GO** — Rollback is dangerous. Irreversible changes detected. Recommend hotfix instead.

**CONDITIONAL GO** — Rollback is safe IF specific manual steps are taken first (e.g., reverse a data migration manually, update feature flag service, notify API consumers).

### Risk Matrix

| Check | Status | Risk | Details |
|-------|--------|------|---------|
| Database Migrations | PASS/WARN/FAIL | LOW/MED/HIGH/CRIT | <specifics> |
| API Contracts | PASS/WARN/FAIL | LOW/MED/HIGH/CRIT | <specifics> |
| Feature Flags | PASS/WARN/FAIL | LOW/MED/HIGH/CRIT | <specifics> |
| Data Compatibility | PASS/WARN/FAIL | LOW/MED/HIGH/CRIT | <specifics> |
| Infrastructure | PASS/WARN/FAIL | LOW/MED/HIGH/CRIT | <specifics> |
| Env Variables | PASS/WARN/FAIL | LOW/MED/HIGH/CRIT | <specifics> |

### If GO: Rollback Procedure
```
1. <specific rollback command or process>
2. Post-rollback verification steps
3. Monitoring checklist (what to watch for 30 min after rollback)
```

### If NO-GO: Alternative Remediation
```
Recommended: <HOTFIX|MITIGATE|FORWARD-FIX>
  Reason: <why rollback is unsafe>
  Steps:
    1. <specific remediation action>
    2. <verification>
  Estimated Time: <duration>
```

### Pre-Rollback Checklist
Regardless of verdict, if rollback proceeds:
- [ ] Notify affected teams (list teams)
- [ ] Verify rollback target was stable (check health at that commit)
- [ ] Prepare env var rollback if needed (list vars)
- [ ] Prepare feature flag rollback if needed (list flags)
- [ ] Queue consumer notification if API changed
- [ ] Plan post-rollback smoke tests

## Step 8 — Save Report

1. Create the `reports/` directory if it doesn't exist: `mkdir -p reports`
2. Get today's date: `date +%Y-%m-%d` and capture as `$DATE`
3. Determine the scope: use the rollback target identifier
4. Save to: `reports/rollback-assessment-<scope>-<DATE>.md`
   - Include YAML front-matter: `date`, `rollback_target`, `current_version`, `commits_rolled_back`, `verdict` (go|go-with-caution|no-go|conditional-go), `migration_risk`, `api_risk`, `flag_risk`, `data_risk`, `infra_risk`, `overall_risk`
5. Print the verdict prominently and the file path

**Naming examples:**
- `reports/rollback-assessment-v2.1.0-2026-02-13.md`
- `reports/rollback-assessment-HEAD~3-2026-02-13.md`

**Tip:** Run this BEFORE executing any rollback. Even under time pressure, the 2 minutes this skill takes can prevent a rollback that makes the incident worse. Pair with `/incident-triager` (which identifies the root cause and recommends rollback) and `/incident-detector` (which identifies the incident in the first place).
