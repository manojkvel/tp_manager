---
name: tech-debt-audit
description: Monthly health check — code complexity, duplication, outdated patterns, and structural issues
argument-hint: "[directory-or-'full']"
allowed-tools: Read, Write, Grep, Glob, Bash(git log, git shortlog, wc, find, cat, ls, date)
---

# Tech Debt Audit

Perform a comprehensive health check of the codebase to surface accumulated technical debt.

## Step 1 — Scope

If `$ARGUMENTS` is a directory, focus the audit there.
If `$ARGUMENTS` is `full` or empty, audit the entire codebase.

## Step 2 — Code Complexity

### Large Files
Find files exceeding reasonable size thresholds:
- Flag any source file over 400 lines
- Flag any single function/method over 80 lines
- Flag any file with more than 15 imports

### High-Churn Files
Run `git log --format=format: --name-only --since='3 months ago' | sort | uniq -c | sort -rn | head -20`

Files changed most frequently are often the ones with the most debt — they're either doing too much or poorly abstracted.

### Complex Functions
Look for indicators of high cyclomatic complexity:
- Deeply nested conditionals (3+ levels of if/else)
- Functions with more than 5 parameters
- Switch/match statements with 10+ cases
- Functions with multiple early returns mixed with deep nesting

### Dead Code
Search for:
- Exported functions/classes never imported elsewhere
- Commented-out code blocks (more than 5 lines)
- Feature flags that have been permanently on/off for months
- TODO/FIXME/HACK comments (count and list the oldest ones)

## Step 3 — Duplication

### Copy-Paste Code
Search for repeated patterns:
- Similar function signatures across different files
- Repeated error handling blocks
- Duplicated validation logic
- Similar API handler structures that could be abstracted

### Inconsistent Patterns
Look for areas where the same thing is done multiple ways:
- Multiple HTTP client libraries used
- Multiple logging approaches
- Mixed async patterns (callbacks + promises + async/await)
- Different error handling strategies in different modules
- Multiple date/time libraries

## Step 4 — Outdated Patterns

### Deprecated Usage
Search for patterns the project has moved away from:
- Old-style class components (if project uses functional React)
- Callback-style async (if project uses async/await)
- `var` instead of `const/let` (TypeScript)
- Old-style string formatting (Python)
- Direct SQL instead of ORM (if project uses an ORM)

### Missing Modern Patterns
Check if the codebase uses current best practices:
- Type safety: Are there untyped areas in a typed codebase?
- Error handling: Are there catch-all `except Exception` or `catch (e)` blocks?
- Configuration: Are there hardcoded values that should be configurable?
- Logging: Is structured logging used consistently?

## Step 5 — Structural Issues

### Circular Dependencies
Trace import chains to find cycles:
- Module A imports B, B imports A
- Longer chains: A → B → C → A

### Layer Violations
Check architectural boundaries:
- Do HTTP handlers import database models directly (bypassing service layer)?
- Do utility modules import business logic?
- Do shared libraries depend on application-specific code?

### Missing Abstractions
- Are external services (payment, email, storage) called directly without a wrapper?
- Could you swap databases without rewriting business logic?
- Are there 3+ files doing similar things that could share an abstraction?

## Step 6 — Maintenance Signals

### Documentation Staleness
- Check if README was updated in the last 3 months: `git log -1 --format=%cr -- README.md`
- Check for outdated API docs that don't match current endpoints
- Look for docstrings referencing removed parameters or changed behavior

### Test Health
- Ratio of test files to source files
- Any test files with `@skip`, `@pytest.mark.skip`, `.skip()`, `xit(`, `xdescribe(`
- Tests with no assertions (test runs but verifies nothing)

### TODO Archaeology
Find and date all TODO/FIXME/HACK comments:
```
git log -1 --format='%ai' -S 'TODO' -- <file>
```
TODOs older than 6 months are likely forgotten and should be resolved or removed.

## Step 7 — Format Output

### Health Score

Rate each dimension from 1-5 (1=critical debt, 5=healthy):

| Dimension | Score | Detail |
|-----------|-------|--------|
| Code Complexity | X/5 | N files over threshold, M complex functions |
| Duplication | X/5 | N areas of significant duplication |
| Pattern Consistency | X/5 | N inconsistent patterns found |
| Architecture | X/5 | N circular deps, M layer violations |
| Test Health | X/5 | X% coverage, N skipped tests |
| Documentation | X/5 | README age, N stale docs |

**Overall Tech Debt Score: X/5**

### Top 10 Debt Items

Ranked by impact-to-effort ratio:

| # | Item | Category | Impact | Effort | Files |
|---|------|----------|--------|--------|-------|
| 1 | Extract shared validation logic | Duplication | High | Small | 5 files |
| 2 | Break up UserService (800 lines) | Complexity | High | Medium | 1 file |
| ... | ... | ... | ... | ... | ... |

### Hotspots
Files with the highest combination of: high churn + high complexity + low test coverage. These are your highest-risk areas.

### Recommended Sprint Items
3-5 specific, actionable tickets a PM could add to the backlog, sized as S/M/L.

## Step 8 — Save Report

Save the complete audit to a persistent file for month-over-month tracking.

1. Create the `reports/` directory if it doesn't exist: `mkdir -p reports`
2. Get today's date: `date +%Y-%m-%d` and capture as `$DATE`
3. Determine the scope label:
   - If `$ARGUMENTS` was `full` or empty, use `full`
   - If a specific directory, use a sanitized version (e.g., `src-services`)
4. Save the full audit to: `reports/tech-debt-audit-<scope>-<DATE>.md`
   - Include a YAML front-matter header with: `date`, `scope`, `overall_score` (X/5), `top_debt_items_count`, `hotspots_count`
5. Print the file path so the user knows where to find it

**Naming examples:**
- `reports/tech-debt-audit-full-2025-06-15.md`
- `reports/tech-debt-audit-src-services-2025-06-15.md`

**Tip:** Run monthly and compare reports side by side to track debt trends:
```
ls reports/tech-debt-audit-*.md
```
