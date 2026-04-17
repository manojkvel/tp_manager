---
name: regression-check
description: Analyze a diff against existing tests to predict what might break
allowed-tools: Read, Write, Grep, Glob, Bash(git diff, git log, git show, pytest --collect-only, npx vitest --reporter=verbose --run, date)
---

# Regression Check

Predict what existing functionality might break from recent changes.

## Step 1 — Identify What Changed

Run `git diff HEAD~1 --stat` (or diff against the base branch if on a feature branch).

For each changed file, extract:
1. **Functions modified** — which function signatures or bodies changed?
2. **Types modified** — did any interfaces, types, schemas, or models change?
3. **Imports modified** — were dependencies added, removed, or changed?
4. **Config modified** — any environment variables, feature flags, or settings?

## Step 2 — Find Tests That Cover Changed Code

For each modified function/class:

### Python
1. Search for test files: `test_*<module_name>*.py`, `*<module_name>*_test.py`
2. Search for the function name in test files: grep for `def test_.*<function_name>` and `<function_name>(` in test directories
3. Check for fixtures that set up the modified module
4. Run `pytest --collect-only -q` to list all available tests

### TypeScript
1. Search for test files: `<module>.test.ts`, `<module>.spec.ts`, `__tests__/<module>.*`
2. Search for the function name in test files
3. Check for mock setups referencing the modified module

## Step 3 — Analyze Regression Risk

For each changed area, classify risk:

### High Risk — Likely to break
- Function signature changed (params added/removed/reordered) but callers not updated
- Return type changed
- Exception/error type changed
- Database schema modified without migration
- Shared type/interface modified — all consumers must be checked
- Environment variable renamed or removed

### Medium Risk — May break under specific conditions
- Default value changed
- Validation rules tightened (previously valid input now rejected)
- Async behavior changed (added await, removed await, changed concurrency)
- Error message text changed (if tests assert on message content)
- Sort order or pagination logic changed

### Low Risk — Unlikely but possible
- Internal refactoring (same behavior, different implementation)
- New code path added (existing paths unchanged)
- Logging or metrics changes
- Comment-only changes

## Step 4 — Run Targeted Tests

Execute tests most likely to be affected:

### Python
```
pytest <test_files_identified> -v --tb=short 2>&1 | head -100
```

### TypeScript
```
npx vitest run <test_files_identified> --reporter=verbose 2>&1 | head -100
```

Note: Only run tests, never modify them. If tests fail, that's a finding to report.

## Step 5 — Check for Untested Impact

Identify changed code paths that have NO test coverage:
1. List all modified public functions
2. Cross-reference with test files found in Step 2
3. Flag any function that changed but has zero test references

## Step 6 — Format Output

### Changes Summary
Brief description of what changed and why (inferred from diff and commit messages).

### Regression Risk Report

**Tests Directly Affected:**
| Test File | Test Name | Risk | Reason |
|-----------|-----------|------|--------|
| `test_auth.py` | `test_login_success` | HIGH | `login()` signature changed |
| `test_users.py` | `test_create_user` | MED | Validation rules tightened |

**Test Results:**
```
X tests passed
Y tests failed  ← REGRESSION DETECTED
Z tests skipped
```

**Failing Tests (if any):**
For each failure:
```
FAIL: <test_name>
File: <test_file>:<line>
Error: <error message>
Likely cause: <which change caused this>
```

**Untested Changes (Gaps):**
| File | Function | Risk | Recommendation |
|------|----------|------|----------------|
| `src/api/users.py` | `delete_user()` | HIGH | Add test for cascade deletion |

### Verdict
- **SAFE TO MERGE** — all affected tests pass, no high-risk gaps
- **TESTS FAILING** — N tests broken, must fix before merge
- **GAPS DETECTED** — tests pass but N high-risk changes lack coverage, recommend adding tests

## Step 7 — Save Report

Save the complete regression check to a persistent file for merge decision tracking.

1. Create the `reports/` directory if it doesn't exist: `mkdir -p reports`
2. Get today's date: `date +%Y-%m-%d` and capture as `$DATE`
3. Determine the scope label:
   - Use the current branch name (sanitized) or `latest-diff` if on main/master
4. Save the full report to: `reports/regression-check-<scope>-<DATE>.md`
   - Include a YAML front-matter header with: `date`, `branch`, `verdict`, `tests_passed`, `tests_failed`, `coverage_gaps`
5. Print the file path so the user knows where to find it

**Naming examples:**
- `reports/regression-check-feature-sso-login-2025-06-15.md`
- `reports/regression-check-latest-diff-2025-06-15.md`
