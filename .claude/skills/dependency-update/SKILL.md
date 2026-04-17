---
name: dependency-update
description: Check for outdated and vulnerable dependencies, propose safe updates, and optionally apply them with --fix mode
argument-hint: "[--fix] [--fix-security] [--dry-run]"
allowed-tools: Read, Write, Grep, Glob, Bash(npm outdated, npm audit, pip list --outdated, pip audit, pip install, npm install, npm test, npx vitest, npx jest, pytest, git diff, git stash, cat, date)
---

# Dependency Update Check

Audit all project dependencies for security vulnerabilities and staleness.

## Step 1 — Discover Package Managers

Check which dependency files exist:
- `package.json` / `package-lock.json` → npm/Node.js
- `requirements.txt` / `pyproject.toml` / `Pipfile` / `setup.py` → Python
- `go.mod` → Go
- `Cargo.toml` → Rust

Run checks for each package manager found.

## Step 2 — Security Vulnerabilities

### Node.js
```bash
npm audit --json 2>/dev/null | head -200
```
Parse output for critical and high severity vulnerabilities.

### Python
```bash
pip audit 2>/dev/null || echo "pip-audit not installed"
```
If `pip-audit` isn't available, check `requirements.txt` entries against known CVE databases by searching for the package names.

### For each vulnerability found:
1. Package name and current version
2. Severity (critical / high / medium / low)
3. CVE identifier if available
4. Fixed version
5. Is it a direct dependency or transitive?
6. What does this package do in our codebase? (search for imports)

## Step 3 — Outdated Dependencies

### Node.js
```bash
npm outdated --json 2>/dev/null | head -200
```

### Python
```bash
pip list --outdated --format=json 2>/dev/null | head -200
```

### For each outdated package, classify the update:
- **Patch** (1.2.3 → 1.2.4): Bug fixes, safe to update
- **Minor** (1.2.3 → 1.3.0): New features, usually backwards-compatible
- **Major** (1.2.3 → 2.0.0): Breaking changes, needs review

## Step 4 — Assess Update Risk

For each outdated dependency:

1. **How widely is it used in our code?**
   - Search for `import ... from '<package>'` / `from <package> import`
   - Count the number of files importing it
   - Heavily-used packages = higher risk to update

2. **Does it have a changelog or migration guide?**
   - Major version bumps should have documented breaking changes

3. **Are our tests likely to catch breakage?**
   - If the package is well-tested in our test suite → safer to update
   - If no tests touch it → higher risk

## Step 5 — Classify Updates

### Safe to Auto-Update (Low Risk)
- Patch versions of well-tested dependencies
- Security fixes at any version level
- Dev dependencies (test frameworks, linters, formatters)

### Review Before Updating (Medium Risk)
- Minor version bumps of core dependencies
- Any update to ORM, auth, or data serialization libraries
- Packages imported in 10+ files

### Needs Migration Plan (High Risk)
- Major version bumps of core frameworks (React, FastAPI, Django, Express)
- Major version bumps of ORMs (SQLAlchemy, Prisma, TypeORM)
- Any package that changes its API surface significantly

## Step 6 — Format Output

### Security Vulnerabilities

| Severity | Package | Current | Fixed | CVE | Usage in Codebase |
|----------|---------|---------|-------|-----|-------------------|
| CRITICAL | lodash | 4.17.19 | 4.17.21 | CVE-XXXX-XXXX | 12 files |
| HIGH | axios | 0.21.0 | 0.21.2 | CVE-XXXX-XXXX | 8 files |

### Outdated Dependencies

**Safe to update now:**
| Package | Current | Latest | Type | Risk |
|---------|---------|--------|------|------|
| prettier | 3.1.0 | 3.2.1 | patch | devDependency |
| pytest | 7.4.0 | 7.4.3 | patch | test-only |

**Review before updating:**
| Package | Current | Latest | Type | Breaking Changes | Files Affected |
|---------|---------|--------|------|-----------------|----------------|
| fastapi | 0.104.0 | 0.109.0 | minor | Possible deprecations | 15 files |

**Needs migration plan:**
| Package | Current | Latest | Type | Migration Guide | Effort |
|---------|---------|--------|------|----------------|--------|
| react | 17.0.2 | 18.2.0 | major | react.dev/blog/... | Large |

### Recommended Actions
1. **Immediate** — Update packages with known security vulnerabilities
2. **This sprint** — Apply safe patch/minor updates
3. **Plan for** — Major version migrations with effort estimates

### Update Commands
```bash
# Security fixes (run now):
npm install lodash@4.17.21 axios@0.21.2
pip install package==X.Y.Z

# Safe updates:
npm update prettier
pip install --upgrade pytest
```

## Step 7 — Save Report

Save the complete dependency report to a persistent file for weekly tracking and compliance.

1. Create the `reports/` directory if it doesn't exist: `mkdir -p reports`
2. Get today's date: `date +%Y-%m-%d` and capture as `$DATE`
3. Save the full report to: `reports/dependency-update-<DATE>.md`
   - Include a YAML front-matter header with: `date`, `vulnerabilities_critical`, `vulnerabilities_high`, `outdated_count`, `safe_to_update_count`, `needs_migration_count`
4. Print the file path so the user knows where to find it

**Naming examples:**
- `reports/dependency-update-2025-06-15.md`

**Tip:** Run weekly and compare reports to track vulnerability remediation:
```
ls reports/dependency-update-*.md
```

---

## Step 8 — Fix Mode (--fix)

When `$ARGUMENTS` contains `--fix` or `--fix-security`, the skill goes beyond reporting and actually applies updates.

### 8.1 Modes

- `--fix` — Apply all "Safe to Auto-Update" packages AND security fixes, then run tests
- `--fix-security` — Apply ONLY security vulnerability fixes (critical and high), then run tests

### 8.2 Pre-Fix Baseline

Before applying any updates:

```bash
git stash list
git status
```

Run the test suite to establish the green baseline:

```bash
npm test 2>&1 | tail -20    # or pytest -v
```

Record total tests, passing, failing. If tests are already failing, log which tests fail BEFORE updates.

### 8.3 Apply Security Fixes First

For each security vulnerability with a known fixed version:

1. Apply the fix:
```bash
# Node.js
npm install <package>@<fixed-version>

# Python
pip install <package>==<fixed-version>
```

2. Run the test suite after EACH security fix:
```bash
npm test    # or pytest
```

3. If tests pass → log as FIXED and proceed to next package
4. If tests fail → revert the update and mark as BLOCKED:
```bash
# Node.js — revert via package-lock
git checkout -- package.json package-lock.json && npm install

# Python — revert via requirements
git checkout -- requirements.txt && pip install -r requirements.txt
```

### 8.4 Apply Safe Updates (--fix mode only)

For each package classified as "Safe to Auto-Update" (patch versions, dev dependencies):

Process in batches by category:
- **Batch 1:** Dev dependencies (lowest risk — test frameworks, linters, formatters)
- **Batch 2:** Patch updates of production dependencies
- **Batch 3:** Security-cleared minor updates of dev dependencies

For each batch:

1. Apply updates:
```bash
# Node.js
npm install <pkg1>@<version> <pkg2>@<version> ...

# Python
pip install <pkg1>==<version> <pkg2>==<version> ...
```

2. Run tests:
```bash
npm test    # or pytest
```

3. If all pass → log batch as FIXED
4. If any fail → revert entire batch, then retry packages individually to isolate the problematic one. Mark the problematic package as BLOCKED, apply the rest.

### 8.5 Never Auto-Apply

The following are NEVER applied in fix mode:
- **Major version bumps** — always needs migration plan and human review
- **"Review Before Updating" packages** — ORM, auth, serialization libraries
- **Packages with no test coverage** — no way to verify the update is safe

These remain in the report as recommendations.

### 8.6 Fix Report

When running in fix mode, append a fix section to the standard report:

```markdown
## Fix Results

### Applied Updates

| Package | From | To | Type | Tests After | Status |
|---------|------|----|------|-------------|--------|
| lodash | 4.17.19 | 4.17.21 | security | 142 pass | FIXED |
| axios | 0.21.0 | 0.21.2 | security | 142 pass | FIXED |
| prettier | 3.1.0 | 3.2.1 | patch/dev | 142 pass | FIXED |
| pytest | 7.4.0 | 7.4.3 | patch/test | 142 pass | FIXED |

### Blocked Updates

| Package | From | To | Reason | Error |
|---------|------|----|--------|-------|
| moment | 2.29.1 | 2.30.1 | Tests failed | test_date_format: expected "Jan" got "January" |

### Not Applied (Needs Review)

| Package | From | To | Reason |
|---------|------|----|--------|
| fastapi | 0.104.0 | 0.109.0 | Minor bump of core framework |
| react | 17.0.2 | 18.2.0 | Major version — needs migration plan |

### Summary

Applied: 4 updates (2 security, 2 safe)
Blocked: 1 (test regression)
Skipped: 2 (needs human review)
Tests: 142 passing → 142 passing (0 regressions)
```

### 8.7 Console Summary (Fix Mode)

```
Dependency Update + Fix Complete
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Vulnerabilities: 2 found, 2 fixed (0 remaining)
Outdated: 8 found, 4 updated, 1 blocked, 3 need review

  FIXED:   lodash 4.17.19→4.17.21 (CVE-XXXX), axios 0.21.0→0.21.2 (CVE-YYYY)
  FIXED:   prettier 3.1.0→3.2.1, pytest 7.4.0→7.4.3
  BLOCKED: moment 2.29.1→2.30.1 (test_date_format failed)
  REVIEW:  fastapi 0.104.0→0.109.0 (minor), react 17→18 (major)

Tests: 142 passing (0 regressions)

📄 reports/dependency-update-2026-02-15.md

Next: Review BLOCKED updates manually
      Plan migration for major version bumps
```
