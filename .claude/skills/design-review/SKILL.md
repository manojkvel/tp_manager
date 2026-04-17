---
name: design-review
description: Review architecture and design patterns for scalability, maintainability, and correctness
argument-hint: "[file-or-module-or-'full']"
allowed-tools: Read, Write, Grep, Glob, Bash(git diff, git log, git show, date)
---

# Design & Architecture Review

Evaluate the structural quality of the codebase or a specific module.

## Step 1 — Scope the Review

If `$ARGUMENTS` is a file or module path, focus on that area.
If `$ARGUMENTS` is `full`, perform a broad architectural review.
If no arguments, review recently changed files via `git diff HEAD~5 --name-only`.

## Step 2 — Map the Architecture

Before reviewing, understand the structure:

1. **Directory layout** — run `ls` on key directories to understand project organization
2. **Entry points** — find main app bootstrap files, route definitions, CLI entry points
3. **Dependency graph** — trace imports to understand coupling between modules
4. **Data flow** — how does a request move from entry point to response?

## Step 3 — Evaluate Design Principles

### Separation of Concerns
- Is business logic separated from transport (HTTP handlers, CLI, etc.)?
- Are data access patterns isolated (repository pattern, DAL)?
- Are side effects (I/O, network, DB) pushed to the edges?
- Is configuration separated from code?

### Single Responsibility
- Does each module/class do one thing?
- Are there "god objects" or "god files" that handle too many concerns?
- Flag any file over 500 lines — likely needs decomposition

### Dependency Management
- Are dependencies injected or hardcoded?
- Are interfaces/protocols used for external service boundaries?
- Could you swap the database or message queue without rewriting business logic?
- Are circular imports present? (search for them)

### API Design
- Are endpoint paths consistent and RESTful (or consistently GraphQL)?
- Are error responses standardized across all endpoints?
- Is versioning strategy clear?
- Are request/response schemas validated at the boundary?

### Data Modeling
- Do database models match the domain (not just the UI)?
- Are relationships properly defined (foreign keys, indexes)?
- Are migrations reversible?
- Is there a clear distinction between read and write models (if applicable)?

### Scalability Considerations
- Are there synchronous operations that should be async or queued?
- Is there proper connection pooling for databases?
- Are there caching strategies for expensive operations?
- Can the service run multiple instances (stateless, no local file dependencies)?

### Error Handling Architecture
- Is there a consistent error handling strategy?
- Are errors translated at boundaries (internal errors → API errors)?
- Is there structured logging with correlation IDs?
- Are retries and circuit breakers used for external dependencies?

### Testing Architecture
- Is the code structured for testability (dependency injection, seams)?
- Can unit tests run without external services?
- Are integration and unit test boundaries clear?

## Step 4 — TypeScript-Specific Checks
- Are types narrowing trust boundaries (branded types, Zod schemas at edges)?
- Is `any` used as an escape hatch more than sparingly?
- Are shared types in dedicated files (not scattered across components)?
- Is there a clear layering: types → utils → services → handlers?

## Step 5 — Python-Specific Checks
- Are Pydantic models or dataclasses used for structured data (not plain dicts)?
- Are abstract base classes or Protocols used for interfaces?
- Is there clear separation between sync and async code?
- Are type hints comprehensive enough for IDE support?

## Step 6 — Format Output

### Architecture Overview
A brief description of the current architecture as understood from the code.

```
[diagram if helpful — e.g., request flow]
Client → API Gateway → Route Handler → Service Layer → Repository → Database
                                      ↘ Event Bus → Worker → External API
```

### Strengths
What's working well architecturally. Be specific with file references.

### Issues Found

For each issue:
```
[HIGH|MEDIUM|LOW] <Category>
Location: <file(s) or module(s)>
Issue: <what's wrong structurally>
Impact: <why this matters — maintainability, scalability, testability>
Recommendation: <specific refactoring suggestion>
Effort: <small | medium | large>
```

### Recommendations
Prioritized list of architectural improvements, ordered by impact-to-effort ratio.

### Technical Debt Assessment
Rate the overall technical debt: **Low** | **Moderate** | **High** | **Critical**
Brief justification for the rating.

## Step 7 — Save Report

Save the complete design review to a persistent file for architectural decision tracking.

1. Create the `reports/` directory if it doesn't exist: `mkdir -p reports`
2. Get today's date: `date +%Y-%m-%d` and capture as `$DATE`
3. Determine the scope label:
   - If `$ARGUMENTS` was `full`, use `full`
   - If a file/module path, use a sanitized version (e.g., `src-services` from `src/services/`)
   - If no arguments, use `recent-changes`
4. Save the full review to: `reports/design-review-<scope>-<DATE>.md`
   - Include a YAML front-matter header with: `date`, `scope`, `tech_debt_rating`, `issues_count` (by severity)
5. Print the file path so the user knows where to find it

**Naming examples:**
- `reports/design-review-full-2025-06-15.md`
- `reports/design-review-src-services-2025-06-15.md`
- `reports/design-review-recent-changes-2025-06-15.md`
