---
name: cross-repo-standards-enforcer
description: Audit a repository against organizational standards for structure, config, naming, and pipeline conventions
argument-hint: "['full'|'quick'|focus-area]"
allowed-tools: Read, Write, Grep, Glob, Bash(git log, git shortlog, cat, ls, find, date)
---

# Cross-Repo Standards Enforcer

Audit the current repository against your organization's structural and configuration standards. Ensures every repo follows the same conventions for folder layout, config files, branch policies, naming patterns, and pipeline templates — essential when managing 10+ microservice repos, acquired codebases, or multi-team projects.

## Step 1 — Load Standards Manifest

Check for an organizational standards definition:
```
Glob: .org-standards.yml, .org-standards.json, docs/org-standards.yml, .github/org-standards.yml
```

If a standards manifest exists, use it as the source of truth. If not, apply these default expectations for a well-governed repository:

### Default Standards

#### Required Files
| File | Purpose | Required? |
|------|---------|-----------|
| `README.md` | Project documentation | REQUIRED |
| `.editorconfig` | Consistent editor settings | REQUIRED |
| `.gitignore` | Ignore patterns | REQUIRED |
| `LICENSE` or `LICENSE.md` | License declaration | REQUIRED |
| `CHANGELOG.md` or `CHANGES.md` | Release history | RECOMMENDED |
| `CONTRIBUTING.md` | Contribution guide | RECOMMENDED (if open-source) |
| `.env.example` | Environment variable template | REQUIRED (if `.env` is gitignored) |
| `Dockerfile` or `docker-compose.yml` | Container definition | RECOMMENDED |

#### Config File Standards
| Config | Standard | Check |
|--------|----------|-------|
| `.editorconfig` | Must specify `indent_style`, `indent_size`, `end_of_line`, `charset` | Parse and verify keys |
| Linter config | ESLint, Prettier, Ruff, Black, etc. must exist | Check for config files |
| TypeScript config | `strict: true` if TypeScript project | Parse `tsconfig.json` |
| Git hooks | Pre-commit hooks configured (Husky, pre-commit, lefthook) | Check for config |

#### Folder Structure Standards
| Pattern | Standard |
|---------|----------|
| Source code | Lives in `src/` or `app/` or `lib/` (not root) |
| Tests | Live in `tests/`, `test/`, `__tests__/`, or co-located `*.test.*` / `*.spec.*` |
| Documentation | Lives in `docs/` |
| CI/CD | Lives in `.azure-pipelines/`, `.github/workflows/`, or project root |
| IaC | Lives in `infra/`, `terraform/`, `bicep/`, or `infrastructure/` |
| Scripts | Lives in `scripts/` or `bin/` |

#### Naming Conventions
| Element | Convention | Example |
|---------|-----------|---------|
| Branch names | `feature/`, `bugfix/`, `hotfix/`, `release/` prefixes | `feature/add-oauth` |
| File names | kebab-case for non-class files | `user-service.ts` |
| Test files | Match source file with `.test.` or `.spec.` suffix | `user-service.test.ts` |
| Environment vars | UPPER_SNAKE_CASE | `DATABASE_URL` |
| Commit messages | Conventional Commits format | `feat: add OAuth login` |

#### Pipeline Standards
| Check | Standard |
|-------|----------|
| Pipeline exists | At least one CI/CD pipeline defined |
| Lint step | Pipeline includes a linting step |
| Test step | Pipeline runs tests |
| Build step | Pipeline builds the artifact |
| Security scan | Pipeline includes security scanning (npm audit, etc.) |
| Deployment gates | Production deployments require approval |

## Step 2 — Audit Required Files

For each required/recommended file, check:

1. **Exists?** — Is the file present?
2. **Non-empty?** — Does it have meaningful content (not just a placeholder)?
3. **Recent?** — When was it last updated? `git log -1 --format='%ci' -- <file>`
4. **Quality** — Does the content meet minimum standards?

### README Quality Check
- Has a title (H1 heading)
- Has a description section
- Has setup/installation instructions
- Has usage examples
- References the correct project name
- Updated within the last 6 months

### .editorconfig Quality Check
- Specifies root = true
- Defines settings for common file types
- Indent style and size are specified

## Step 3 — Audit Configuration Files

### Linter Configuration
Verify consistent linter setup:
```
Glob: .eslintrc*, .prettierrc*, .pylintrc, pyproject.toml, .ruff.toml, .rubocop.yml, .editorconfig
```

For each config found, check:
- Is it using the org-standard base config? (e.g., `extends: ["@org/eslint-config"]`)
- Are there excessive rule overrides? (> 10 overrides suggest divergence from standards)
- Does the Prettier config match org defaults?

### TypeScript Configuration
If `tsconfig.json` exists:
- `strict` should be `true`
- `noImplicitAny` should be `true`
- `strictNullChecks` should be `true`
- Target and module settings match org standard

### Package Manager Consistency
- Is only one lockfile present? (having both `package-lock.json` and `yarn.lock` is a smell)
- Is the package manager version pinned? (engines field, `.nvmrc`, `.node-version`)

## Step 4 — Audit Folder Structure

Compare actual structure against expected:
```bash
ls -d */ 2>/dev/null | sort
```

Check for:
- Source code in expected locations
- Tests in expected locations
- No source files in the root directory (except entry points)
- No test files mixed into source directories (unless co-location is the standard)
- Config files in expected locations

### Anti-Patterns to Flag
- `utils/` or `helpers/` directories with 20+ files (dumping ground)
- Deeply nested folders (> 5 levels)
- Inconsistent folder naming (mixing camelCase, PascalCase, kebab-case)
- Empty directories committed to git

## Step 5 — Audit Naming Conventions

### Branch Naming
```bash
git branch -r | head -30
```
Check if branches follow the prefix convention.

### Recent Commit Messages
```bash
git log -20 --oneline
```
Check if commits follow Conventional Commits or the org's commit message format.

### File Naming
```bash
find src/ -type f -name '*.ts' -o -name '*.js' -o -name '*.py' 2>/dev/null | head -50
```
Check for consistent naming patterns (kebab-case, camelCase, PascalCase).

## Step 6 — Audit Pipeline Configuration

Find and analyze CI/CD definitions:
```
Glob: azure-pipelines*.yml, .azure-pipelines/**/*.yml, .github/workflows/*.yml, .gitlab-ci.yml, Jenkinsfile
```

For each pipeline, verify it includes:
1. ✅ Linting step
2. ✅ Test execution step
3. ✅ Build/compile step
4. ✅ Security scan step
5. ✅ Artifact publishing (if applicable)
6. ✅ Deployment gate/approval for production

### Pipeline Template Usage
If the org provides shared pipeline templates, check if this repo uses them:
```
Grep: "template:", "uses:", "extends:"
```

## Step 7 — Format Output

### Standards Compliance Summary

```
Repository: <name>
Audited on: <date>
Standards source: <org-standards.yml | defaults>
```

| Category | Checks | Pass | Fail | Skip | Score |
|----------|--------|------|------|------|-------|
| Required Files | N | N | N | N | X% |
| Configuration | N | N | N | N | X% |
| Folder Structure | N | N | N | N | X% |
| Naming Conventions | N | N | N | N | X% |
| Pipeline Standards | N | N | N | N | X% |
| **Overall** | **N** | **N** | **N** | **N** | **X%** |

### Failures — Must Fix

For each failed check:
```
[FAIL] <category> — <check name>
  Expected: <what the standard requires>
  Actual: <what was found>
  Fix: <specific action to resolve>
```

### Warnings — Should Fix

For each recommended-but-missing item:
```
[WARN] <category> — <check name>
  Recommendation: <what should be added and why>
```

### Conformance Verdict

**CONFORMANT** — All required standards met, minor recommendations only
**PARTIALLY CONFORMANT** — Some required standards not met
**NON-CONFORMANT** — Multiple required standards missing, needs remediation

## Step 8 — Save Report

Save the complete audit to a persistent file.

1. Create the `reports/` directory if it doesn't exist: `mkdir -p reports`
2. Get today's date: `date +%Y-%m-%d` and capture as `$DATE`
3. Determine the scope label:
   - If `$ARGUMENTS` was `full` or empty, use `full`
   - If a focus area, use it (e.g., `naming`, `pipeline`)
4. Save to: `reports/standards-audit-<scope>-<DATE>.md`
   - Include a YAML front-matter header with: `date`, `scope`, `overall_score_pct`, `required_pass`, `required_fail`, `verdict`
5. Print the file path so the user knows where to find it

**Naming examples:**
- `reports/standards-audit-full-2025-06-15.md`
- `reports/standards-audit-pipeline-2025-06-15.md`

**Tip:** Run on every repository in your portfolio and compare scores. Create an org dashboard showing which repos are conformant and which need attention.
