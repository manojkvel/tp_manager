---
name: review
description: Comprehensive code review for quality, security, performance, and maintainability
allowed-tools: Read, Write, Grep, Glob, Bash(git diff, git log, git show, date)
---

# Code Review

Review the code changes for quality, correctness, and adherence to project standards.

## Step 1 — Understand the Change

Gather context before reviewing:

- Run `git diff HEAD~1 --stat` to see which files changed
- Run `git log -3 --oneline` to understand recent commit context
- Read changed files in full to understand surrounding code

If `$ARGUMENTS` is provided, review only those specific files or paths.

## Step 2 — Review Against These Criteria

### Correctness
- Does the logic actually do what it claims?
- Are there off-by-one errors, missing null checks, or unhandled edge cases?
- Are async operations properly awaited? (TypeScript: `await`, Python: `await`/`asyncio`)
- Do error paths return appropriate responses or re-raise correctly?

### API Contract
- Do request/response types match what callers expect?
- Are breaking changes to public APIs flagged?
- Are new endpoints or functions properly typed? (TypeScript: explicit return types, Python: type hints)

### Data Handling
- Are database queries parameterized (no string interpolation in SQL)?
- Are ORM queries efficient (no N+1, unnecessary eager loading)?
- Is user input validated before use?
- Are sensitive fields excluded from API responses?

### Error Handling
- Are errors caught at appropriate boundaries?
- Do error messages help with debugging without leaking internals?
- Are external service calls wrapped with timeouts and retries where appropriate?

### Code Quality
- Is the code consistent with existing patterns in the codebase?
- Are names descriptive and unambiguous?
- Is there unnecessary duplication that should be extracted?
- Are comments explaining *why*, not *what*?

### TypeScript-Specific
- No `any` types unless genuinely necessary (and commented why)
- Proper use of `readonly`, `const`, discriminated unions where applicable
- No floating promises (every Promise is awaited or explicitly handled)

### Python-Specific
- Type hints on all function signatures
- Proper use of dataclasses / Pydantic models for structured data
- Context managers for resource cleanup (`with` statements)
- No mutable default arguments

## Step 3 — Format Output

Structure your review as:

### Summary
One paragraph describing what the change does and your overall assessment.

### Issues Found

For each issue:
```
[CRITICAL|HIGH|MEDIUM|LOW] <file>:<line> — <description>

<explanation of why this is a problem>

Suggested fix:
<code suggestion>
```

### Positive Observations
Call out 1-3 things done well. Reinforce good patterns.

### Verdict
State one of: **Approve**, **Approve with minor comments**, **Request changes**

## Step 4 — Save Report

Save the complete review output to a persistent file for tracking and audit trails.

1. Create the `reports/` directory if it doesn't exist: `mkdir -p reports`
2. Get today's date: `date +%Y-%m-%d` and capture as `$DATE`
3. Determine the scope label:
   - If `$ARGUMENTS` was provided, use a sanitized version (e.g., `src-api-users` from `src/api/users.py`)
   - If no arguments, use `latest-diff`
4. Save the full review to: `reports/review-<scope>-<DATE>.md`
   - Include a YAML front-matter header with: `date`, `scope`, `verdict`, `issues_count` (by severity)
5. Print the file path so the user knows where to find it

**Naming examples:**
- `reports/review-latest-diff-2025-06-15.md`
- `reports/review-src-api-users-2025-06-15.md`
- `reports/review-auth-module-2025-06-15.md`
