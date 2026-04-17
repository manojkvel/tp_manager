---
name: pr-orchestrator
description: Analyze a PR's changed files and automatically determine which skills to run — acts as the phase gate for your SDLC pipeline
argument-hint: "['auto'|'strict'|'quick'] [branch-name]"
allowed-tools: Read, Write, Grep, Glob, Bash(git diff, git log, git show, date)
---

# PR Orchestrator

Analyze the files changed in a pull request (or current branch vs. main) and automatically determine which Claude Code skills should run, in what order, and with what priority. This is the intelligent phase gate that turns your skill library into an automated SDLC pipeline.

## Execution Modes

- **`auto`** (default) — Analyze changes, run all recommended skills automatically, produce a combined report
- **`strict`** — Same as auto but enforces mandatory skill passes as gates (blocks if critical skills fail)
- **`quick`** — Analyze changes, recommend skills but don't run them (for preview before committing to a full run)

---

## Phase 1 — Change Analysis

### 1.1 Determine the Diff

```bash
# Detect the base branch
BASE_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main")

# Get changed files
git diff --name-only "$BASE_BRANCH"...HEAD
git diff --stat "$BASE_BRANCH"...HEAD
```

If a branch name is provided as argument, use that instead of HEAD.

### 1.2 Classify Changed Files

For each changed file, classify it into categories:

| Category | File Patterns | Example |
|----------|--------------|---------|
| **SOURCE_CODE** | `*.ts, *.py, *.js, *.go, *.rs, *.java, *.cs` (excluding tests) | `src/services/auth.ts` |
| **TEST** | `*.test.*, *.spec.*, test_*.py, *_test.go` | `tests/test_auth.py` |
| **MIGRATION** | `migrations/*, alembic/*, prisma/migrations/*` | `migrations/001_add_users.sql` |
| **API_DEFINITION** | `*.proto, *.graphql, openapi.*, swagger.*` | `schema.graphql` |
| **CONFIGURATION** | `*.yml, *.yaml, *.toml, *.json, *.env*` (non-IaC) | `config/production.yml` |
| **INFRASTRUCTURE** | `Dockerfile*, docker-compose*, terraform/*, bicep/*, k8s/*, .github/workflows/*, azure-pipelines*` | `Dockerfile` |
| **DOCUMENTATION** | `*.md, docs/*` | `docs/api.md` |
| **DEPENDENCY** | `package.json, requirements*.txt, pyproject.toml, go.mod, Cargo.toml` | `package.json` |
| **SPEC** | `specs/*, .specify/*` | `specs/042-auth-flow/spec.md` |
| **SKILL** | `.claude/skills/*` | `.claude/skills/review/SKILL.md` |
| **STATIC_ASSET** | `*.css, *.scss, *.svg, *.png, *.jpg` | `public/logo.svg` |
| **FRONTEND** | `*.tsx, *.jsx, *.vue, *.svelte, components/*, pages/*` | `src/components/Login.tsx` |

### 1.3 Determine Change Scope

Compute:
- **Total files changed:** <N>
- **Lines added:** <N>
- **Lines removed:** <N>
- **Categories touched:** <list>
- **Modules affected:** <list of top-level directories/modules>

### 1.4 Detect Change Intent

Based on the combination of categories and commit messages, classify the PR intent:

| Intent | Signal | Skills Emphasis |
|--------|--------|----------------|
| **New Feature** | New files in source + tests + possibly migration | Full pipeline |
| **Bug Fix** | Modified source + modified/new tests, small diff | Review + regression + test coverage |
| **Refactor** | Modified source, no new tests, no API changes | Review + design + regression |
| **Dependency Update** | Only dependency files changed | Dependency + security |
| **Infrastructure** | Only IaC/CI/Docker files | Infra review + security |
| **Documentation** | Only docs changed | Minimal (doc lint only) |
| **Migration** | Migration files present | Impact analysis + regression |
| **API Change** | Route/controller/proto/graphql changed | Review + spec-review + contract test |
| **Security-Sensitive** | Auth files, encryption, permissions changed | Security audit (mandatory) |
| **Hotfix** | Branch name contains "hotfix" or "fix/" | Review + regression (fast mode) |

---

## Phase 2 — Skill Selection

### 2.1 Skill Registry

Map each installed skill to its trigger conditions:

| Skill | Triggers When | Priority | Mandatory? |
|-------|--------------|----------|-----------|
| `/review` | SOURCE_CODE changed | HIGH | Always |
| `/security-audit` | SOURCE_CODE changed, especially auth/crypto/permissions | CRITICAL | When security-sensitive files touched |
| `/test-gen` | SOURCE_CODE changed without corresponding test changes | MEDIUM | When new source files lack tests |
| `/regression-check` | Any SOURCE_CODE modified (not just new) | HIGH | When modifying existing code |
| `/design-review` | >5 source files changed, or new module created | MEDIUM | On architectural changes |
| `/perf-review` | Database queries, API handlers, or loops modified | MEDIUM | When data-access code changes |
| `/impact-analysis` | Migration files present, or shared module modified | HIGH | On migrations and shared code |
| `/spec-review` | SPEC files exist for the feature being implemented | HIGH | When spec exists |
| `/security-audit` | DEPENDENCY files changed | HIGH | On dependency updates |
| `/dependency-update` | DEPENDENCY files changed | MEDIUM | On dependency updates |
| `/doc-gen` | Public API changed without doc updates | LOW | When API surface changes |

### 2.2 Build the Skill Execution Plan

Based on file classifications and change intent, select skills and determine order:

```
1. ALWAYS run first (if applicable):
   - /security-audit (if security-sensitive files changed)
   - /impact-analysis (if migrations or shared modules changed)

2. ALWAYS run (if source code changed):
   - /review
   - /regression-check

3. CONDITIONAL (based on change type):
   - /design-review (if architectural changes detected)
   - /perf-review (if data-access or compute-heavy code changed)
   - /spec-review (if a spec exists for this feature)
   - /test-gen (if new source code lacks test coverage)
   - /dependency-update (if dependency files changed)

4. ALWAYS run last:
   - /doc-gen (if API surface changed)
```

### 2.3 Detect Installed Skills

```
Glob: .claude/skills/*/SKILL.md
```

Only include skills that are actually installed. If a recommended skill isn't installed, note it as a gap:

```markdown
> **Note:** `/perf-review` is recommended for this PR but is not installed.
> Install it with: `bash setup.sh` or manually copy the skill.
```

---

## Phase 3 — Execute Skills (auto and strict modes)

### 3.1 Execution Order

Run skills in the order determined by Phase 2. For each skill:

1. Note the start time
2. Run the skill with appropriate arguments (scope to changed files where possible)
3. Capture the output/report
4. Note the end time and result

### 3.2 Skill Arguments

Pass targeted arguments to each skill — don't run them on the entire codebase:

| Skill | Argument Strategy |
|-------|------------------|
| `/review` | Pass the list of changed source files |
| `/security-audit` | Pass changed source directories |
| `/regression-check` | Pass changed source files |
| `/perf-review` | Pass files with database/API/compute changes |
| `/impact-analysis` | Pass migration files or modified shared modules |
| `/spec-review` | Pass the spec path for the feature branch |
| `/test-gen` | Pass new source files without corresponding tests |
| `/design-review` | Pass changed source directories |

### 3.3 Gate Enforcement (strict mode)

In strict mode, certain skills are gates — if they fail, the PR should not merge:

| Skill | Gate Condition | Blocks Merge? |
|-------|---------------|---------------|
| `/security-audit` | Any CRITICAL or HIGH severity finding | YES |
| `/review` | Any CRITICAL finding | YES |
| `/regression-check` | Predicted regressions without test coverage | YES |
| `/spec-review` | NON-COMPLIANT verdict | YES |
| `/impact-analysis` | Unreviewed blast radius on shared code | WARNING (doesn't block) |

If a gate fails, stop execution and report immediately.

---

## Phase 4 — Combined Report

### 4.1 Generate the Orchestration Report

Write to: `pr-review-report.md` (in the project root, for easy PR comment pasting)

```markdown
# PR Review Report

> **Branch:** <branch-name>
> **Base:** <base-branch>
> **Date:** <date>
> **Mode:** auto | strict | quick
> **Verdict:** PASS | PASS WITH WARNINGS | BLOCKED

---

## Change Summary

| Metric | Value |
|--------|-------|
| Files changed | <N> |
| Lines added | <N> |
| Lines removed | <N> |
| Categories | <list> |
| Detected intent | <New Feature / Bug Fix / Refactor / etc.> |
| Modules affected | <list> |

## Skills Executed

| # | Skill | Scope | Result | Duration | Findings |
|---|-------|-------|--------|----------|----------|
| 1 | /security-audit | src/auth/ | PASS | 12s | 0 critical, 1 medium |
| 2 | /review | 8 files | PASS | 18s | 2 suggestions |
| 3 | /regression-check | 5 files | WARNING | 8s | 1 potential regression |
| 4 | /spec-review | specs/042/ | MOSTLY COMPLIANT | 15s | 1 AC gap |

## Skills Skipped (not applicable)

| Skill | Reason |
|-------|--------|
| /design-review | <5 files changed, no architectural change |
| /perf-review | No data-access code modified |

## Skills Not Installed (recommended)

| Skill | Why Recommended | Install With |
|-------|----------------|-------------|
| <skill> | <reason> | `bash setup.sh` |

---

## Findings Summary

### CRITICAL (Must Fix)
<numbered list of critical findings from all skills>

### WARNING (Should Fix)
<numbered list of warnings from all skills>

### SUGGESTION (Nice to Have)
<numbered list of suggestions from all skills>

---

## Detailed Results

### /security-audit
<condensed findings from security audit>

### /review
<condensed findings from code review>

### /regression-check
<condensed findings from regression check>

### /spec-review
<condensed findings from spec compliance review>

---

## Verdict: <PASS | PASS WITH WARNINGS | BLOCKED>

<one-paragraph justification>

### Required Before Merge
<list of items that must be addressed, if any>

### Recommended Before Merge
<list of items that should be addressed>
```

---

## Phase 5 — Azure Pipelines Integration Notes

For teams using Azure Pipelines (or any CI/CD), this skill can be invoked in a pipeline:

```yaml
# azure-pipelines.yml (example stage)
- stage: SkillReview
  displayName: 'Claude Code Skill Review'
  jobs:
  - job: Orchestrate
    steps:
    - script: |
        claude --skill pr-orchestrator auto
      displayName: 'Run PR Orchestrator'
    - task: PublishBuildArtifacts@1
      inputs:
        pathToPublish: 'pr-review-report.md'
        artifactName: 'review-report'
```

The report can be:
- Published as a build artifact
- Posted as a PR comment via Azure DevOps REST API
- Used as a gate condition in release pipelines

---

## Output

1. **Primary:** `pr-review-report.md` — Combined report from all skills
2. **Console summary:** Verdict, critical count, warning count, suggestion count
3. **Individual reports:** Each skill produces its own report in its standard location
4. **Exit code (for CI):**
   - `0` = PASS
   - `1` = PASS WITH WARNINGS
   - `2` = BLOCKED (strict mode only)
