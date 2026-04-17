---
name: impact-analysis
description: Analyze which files, services, APIs, and teams a proposed change would affect
argument-hint: "[file-or-feature-description]"
allowed-tools: Read, Write, Grep, Glob, Bash(git log, git shortlog, ls, find, tree)
---

# Impact Analysis

Determine the blast radius of a proposed change before committing to it.

## Step 1 — Identify the Change Surface

If `$ARGUMENTS` is a file path, start there.
If `$ARGUMENTS` is a feature description, search the codebase for relevant entry points.

1. Identify the primary files that would change
2. For each file, trace its **importers** — who depends on this module?
   - Search for `import ... from '<module>'` and `from <module> import`
   - Follow the chain at least 3 levels deep
3. For each file, trace its **exports** — what public API does it expose?

## Step 2 — Map Dependency Graph

### Direct Dependencies (Level 1)
Files that directly import or call the target module.

### Indirect Dependencies (Level 2-3)
Files that import Level 1 files. These may break silently.

### External Consumers
- Are there API endpoints that expose this functionality?
- Are there CLI commands, cron jobs, or workers that use it?
- Are there other services (microservices, frontends) that call these APIs?

Search for:
- Route definitions referencing the module
- Message queue consumers/producers
- Scheduled tasks or cron configurations
- Environment variable references
- Configuration files referencing the module

## Step 3 — Assess Test Coverage

For each impacted file:
1. Find associated test files (`test_*.py`, `*.test.ts`, `*.spec.ts`)
2. Check if the impacted code paths have test coverage
3. Flag any impacted modules with NO tests — these are high-risk

## Step 4 — Check Recent Activity

Run `git log --oneline -10 -- <file>` for each impacted file:
- Files changed recently by many authors = coordination risk
- Files not changed in 6+ months = hidden assumptions risk
- Check `git blame` for the specific functions being modified

## Step 5 — Identify Team Ownership

Run `git log --format='%aN' -- <file> | sort | uniq -c | sort -rn | head -5` for each impacted file to identify primary contributors. This tells you who should be consulted or review the PR.

## Step 6 — Format Output

### Change Summary
One paragraph describing the proposed change.

### Impact Map

```
Target: <primary file(s)>
│
├── Direct (Level 1): N files
│   ├── <file> — <what breaks if target changes>
│   └── <file> — <what breaks if target changes>
│
├── Indirect (Level 2-3): N files
│   ├── <file> — <transitive dependency chain>
│   └── <file> — <transitive dependency chain>
│
├── APIs Affected: N endpoints
│   ├── <METHOD /path> — <impact>
│   └── <METHOD /path> — <impact>
│
└── External Consumers:
    ├── <service/frontend> — <how it's affected>
    └── <worker/cron> — <how it's affected>
```

### Risk Assessment

| Risk Factor | Level | Detail |
|-------------|-------|--------|
| Files impacted | Low/Med/High | N files across M directories |
| Test coverage gaps | Low/Med/High | N impacted files lack tests |
| Team coordination | Low/Med/High | N different contributors involved |
| API surface change | Low/Med/High | N public endpoints affected |
| Data migration needed | Yes/No | Description if yes |

### Recommendations
- Who should review this PR
- What tests to add before making the change
- Whether to split into smaller PRs
- Any migration or rollback considerations

## Step 7 — Save Report

Save the complete impact analysis to a persistent file for change management tracking.

1. Create the `reports/` directory if it doesn't exist: `mkdir -p reports`
2. Get today's date: `date +%Y-%m-%d` and capture as `$DATE`
3. Determine the scope label:
   - If `$ARGUMENTS` was a file path, use a sanitized version (e.g., `src-api-users` from `src/api/users.py`)
   - If a feature description, use a slugified version (e.g., `add-sso-login`)
4. Save the full analysis to: `reports/impact-analysis-<scope>-<DATE>.md`
   - Include a YAML front-matter header with: `date`, `scope`, `files_impacted`, `risk_level`, `api_endpoints_affected`
5. Print the file path so the user knows where to find it

**Naming examples:**
- `reports/impact-analysis-src-api-users-2025-06-15.md`
- `reports/impact-analysis-add-sso-login-2025-06-15.md`
