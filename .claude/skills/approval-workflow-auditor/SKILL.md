---
name: approval-workflow-auditor
description: Audit DevOps branch policies, environment approvals, and pipeline gates to verify governance processes are enforced
argument-hint: "['full'|'branch-policies'|'pipelines'|'environments']"
allowed-tools: Read, Write, Grep, Glob, Bash(git log, git shortlog, cat, ls, find, date)
---

# Approval Workflow Auditor

Review your DevOps branch policies, environment approvals, pipeline gates, and access controls to verify that governance processes are actually enforced — not just documented. Catches misconfigurations like unprotected main branches, missing approvers, bypassed checks, and over-permissive service connections.

## Step 1 — Scope the Audit

If `$ARGUMENTS` is provided:
- `full` → Audit all categories
- `branch-policies` → Focus on branch protection rules
- `pipelines` → Focus on CI/CD pipeline governance
- `environments` → Focus on deployment environment controls

If no arguments, run the full audit.

## Step 2 — Branch Protection Audit

### Discover Branch Policies

Check for branch protection configuration:
```
Glob: .azure-pipelines/**/*.yml, .github/**/*.yml, .gitlab-ci.yml
Grep: "branch_protection", "protected_branches", "rules"
```

Examine the repository's branching model:
```bash
git branch -r | head -30
git log --all --oneline --graph | head -30
```

### Evaluate Branch Policies

For the main/default branch, check these policies:

| Policy | Expected | How to Check |
|--------|----------|-------------|
| Direct push blocked | YES | Should require PRs, no direct commits |
| Minimum reviewers | ≥ 1 (ideally 2) | PR template or config |
| Stale review dismissal | YES | Reset approvals on new pushes |
| Status checks required | YES | CI must pass before merge |
| Up-to-date branch required | YES | Branch must be current with base |
| Force push blocked | YES | No `--force` to protected branches |
| Delete protection | YES | Cannot delete main/master |
| Signed commits | RECOMMENDED | GPG/SSH signature verification |

### Check for Policy Bypass Indicators

Search git history for signs of policy bypass:
```bash
# Direct pushes to main (not merge commits)
git log main --oneline --no-merges --since='3 months ago' | head -20

# Force pushes (reflog if available)
git reflog show main --since='3 months ago' | grep -i 'forced' | head -10

# Commits without PR association
git log main --oneline --since='1 month ago' | head -20
```

### PR Review Patterns

If PR templates exist:
```
Glob: .github/PULL_REQUEST_TEMPLATE*, .azuredevops/pull_request_template*, docs/pull_request_template*
```

Check if PR templates enforce:
- Description requirement
- Testing checklist
- Reviewer assignment
- Label/category tagging

## Step 3 — Pipeline Governance Audit

### Discover Pipeline Definitions
```
Glob: azure-pipelines*.yml, .azure-pipelines/**/*.yml, .github/workflows/*.yml, .gitlab-ci.yml, Jenkinsfile, .circleci/config.yml
```

### For Each Pipeline, Check:

#### Security Gates
| Gate | Expected | Status |
|------|----------|--------|
| Secrets not hardcoded | YES | Grep for plaintext secrets |
| Uses secret variables/vault | YES | Check for variable groups, Key Vault refs |
| No `--skip-verify` or `--no-verify` flags | YES | Grep pipeline files |
| Dependency scanning step | YES | npm audit, pip audit, etc. |
| SAST/DAST step | RECOMMENDED | Check for security scan tasks |

#### Approval Gates
| Gate | Expected | Status |
|------|----------|--------|
| Production deploy requires approval | YES | Check for approval/gate tasks |
| Staging deploy requires approval | RECOMMENDED | Check for manual intervention |
| Environment-specific variables | YES | No prod secrets in dev pipelines |

#### Pipeline Integrity
| Check | Expected | Status |
|-------|----------|--------|
| No `allow_failure: true` on critical steps | YES | Critical steps must block |
| Timeout configured | YES | No infinite-running pipelines |
| Retry limits set | YES | No infinite retry loops |
| Artifact signing | RECOMMENDED | Build artifacts should be verifiable |
| Pipeline-as-code (not UI-only) | YES | Pipeline definition in repo |

### Service Connection / Secret Scope

Search for service connection or credential references:
```
Grep: "serviceConnection", "service_connection", "credentials", "azureSubscription"
Grep: "AWS_ACCESS_KEY", "AZURE_", "GCP_", "DOCKER_"
```

Check:
- Are service connections scoped to specific pipelines? (not org-wide)
- Are credentials rotated? (check for rotation policy references)
- Are there separate connections for each environment?

## Step 4 — Environment Controls Audit

### Discover Environment Definitions
```
Glob: **/environments/*, **/env/*, **/deploy/*
Grep: "environment:", "deployment:", "stage:"
```

### For Each Environment, Check:

| Environment | Expected Controls |
|-------------|------------------|
| Development | Auto-deploy OK, basic checks |
| Staging/QA | Require passing tests, optional approval |
| Production | Require approval (2+ approvers), all gates pass |
| Hotfix path | Expedited approval (1 approver), must backport |

### Environment Isolation
| Check | Expected |
|-------|----------|
| Separate configs per environment | YES |
| No production credentials in non-prod | YES |
| Network isolation between environments | RECOMMENDED |
| Feature flags for gradual rollout | RECOMMENDED |

### Audit Environment Variable Management
```
Glob: .env*, **/.env*, **/env.*, **/config/env*
```

Check:
- `.env` files are gitignored (not committed)
- `.env.example` exists with placeholder values
- No real secrets in `.env.example`
- Environment-specific configs use appropriate secret management

## Step 5 — Access Control Review

### Repository Access Patterns
```bash
# Check for CODEOWNERS file
cat CODEOWNERS 2>/dev/null || cat .github/CODEOWNERS 2>/dev/null || echo "No CODEOWNERS file found"
```

### CODEOWNERS Coverage
If CODEOWNERS exists:
- Does it cover critical paths? (`src/`, `infra/`, pipeline files)
- Are there orphaned paths (no owner assigned)?
- Do the listed owners/teams still exist and are active?

### Admin/Elevated Access Indicators
Search for indicators of excessive permissions:
```
Grep: "admin", "owner", "bypass", "skip.*approval", "override"
```

## Step 6 — Compliance Documentation Check

Verify that governance decisions are documented:

| Document | Purpose | Exists? |
|----------|---------|---------|
| Branch strategy doc | Explains branching model | Check `docs/` |
| Release process doc | Steps for releasing | Check `docs/` |
| Access control matrix | Who can do what | Check `docs/` |
| Incident response runbook | How to handle incidents | Check `docs/` |
| Security policy | `SECURITY.md` | Check root |
| Code of conduct | `CODE_OF_CONDUCT.md` | Check root |

## Step 7 — Format Output

### Approval Workflow Audit Summary

```
Repository: <name>
Audited on: <date>
Focus: <full | branch-policies | pipelines | environments>
```

| Category | Checks | Pass | Fail | Warn | Score |
|----------|--------|------|------|------|-------|
| Branch Protection | N | N | N | N | X% |
| Pipeline Governance | N | N | N | N | X% |
| Environment Controls | N | N | N | N | X% |
| Access Control | N | N | N | N | X% |
| Documentation | N | N | N | N | X% |
| **Overall** | **N** | **N** | **N** | **N** | **X%** |

### Critical Findings

For each critical failure:
```
[CRITICAL] <category> — <finding>
  Risk: <what could go wrong>
  Evidence: <what was found>
  Remediation: <specific steps to fix>
```

### Warnings

For each warning:
```
[WARNING] <category> — <finding>
  Risk: <potential impact>
  Recommendation: <what to improve>
```

### Governance Maturity Assessment

| Level | Description | Status |
|-------|-------------|--------|
| Level 1: Basic | Branch protection, basic CI | MET/NOT_MET |
| Level 2: Enforced | Required reviews, security scans | MET/NOT_MET |
| Level 3: Controlled | Environment gates, audit trail | MET/NOT_MET |
| Level 4: Optimized | Automated compliance, metrics | MET/NOT_MET |

**Current maturity: Level N**

## Step 8 — Save Report

Save the complete audit to a persistent file.

1. Create the `reports/` directory if it doesn't exist: `mkdir -p reports`
2. Get today's date: `date +%Y-%m-%d` and capture as `$DATE`
3. Determine the scope label:
   - `full`, `branch-policies`, `pipelines`, or `environments`
4. Save to: `reports/approval-workflow-audit-<scope>-<DATE>.md`
   - Include a YAML front-matter header with: `date`, `scope`, `overall_score_pct`, `critical_findings`, `warning_count`, `maturity_level`
5. Print the file path so the user knows where to find it

**Naming examples:**
- `reports/approval-workflow-audit-full-2025-06-15.md`
- `reports/approval-workflow-audit-branch-policies-2025-06-15.md`

**Tip:** Run quarterly across all repos and compare maturity levels. Target Level 3 for all production services.
