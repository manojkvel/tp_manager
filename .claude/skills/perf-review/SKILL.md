---
name: perf-review
description: Review code for performance issues — N+1 queries, memory leaks, missing indexes, inefficient patterns
argument-hint: "[file-or-module or 'diff']"
allowed-tools: Read, Write, Grep, Glob, Bash(git diff, git log, git show, date)
---

# Performance Review

Identify performance bottlenecks, inefficient patterns, and scalability concerns.

## Step 1 — Scope

If `$ARGUMENTS` is `diff` or empty, review recent changes via `git diff HEAD~1`.
If `$ARGUMENTS` is a file/module, review that specifically.

## Step 2 — Database & Query Patterns

### N+1 Queries
Search for loops that execute queries inside them:
- Python ORM: `for` loops containing `.query`, `.filter`, `.get`, `.all()`, `.execute()`
- SQLAlchemy: lazy-loaded relationships accessed in loops without `joinedload` or `subqueryload`
- Django: QuerySet access in loops without `select_related` / `prefetch_related`
- TypeScript ORM: Prisma `findMany` inside loops, TypeORM `find` in loops, Sequelize gets in loops
- Raw SQL: `execute()` or `query()` inside any loop

### Missing Indexes
- Search for `filter()`, `WHERE`, `ORDER BY`, `GROUP BY` clauses
- Check if the filtered/sorted columns have indexes defined in migrations
- Flag any column used in WHERE clauses that lacks an index (especially on large tables)

### Expensive Queries
- `SELECT *` when only a few columns are needed
- Missing `LIMIT` on queries that could return large result sets
- `LIKE '%...'` patterns (leading wildcard prevents index use)
- Subqueries that could be JOINs
- `DISTINCT` or `GROUP BY` on unindexed columns

### Connection Management
- Are database connections pooled?
- Are connections released after use (context managers, try/finally)?
- Are there connection leaks in error paths?

## Step 3 — Memory & Resource Patterns

### Memory Leaks
- Growing lists/dicts that are never cleared (especially in long-running processes)
- Event listeners added but never removed
- Caches without eviction policies or size limits
- Large objects held in closures
- Python: circular references preventing garbage collection
- TypeScript: closures over large objects in event handlers

### Unbounded Growth
- Reading entire files into memory (`readFile` / `open().read()`) for large files
- Loading all database results into memory without pagination
- String concatenation in loops (use builders/join instead)
- Accumulating results in arrays without size limits

### Resource Cleanup
- File handles, sockets, DB connections not closed in error paths
- Python: missing `with` statements for I/O
- TypeScript: missing `finally` blocks or `.finally()` for cleanup
- Streams not properly piped or destroyed on error

## Step 4 — Compute & Algorithm Patterns

### Algorithmic Complexity
- Nested loops over collections (O(n²) or worse)
- Repeated searching in unsorted arrays (use Sets/Maps/dicts instead)
- Sorting the same data multiple times
- Recursive functions without memoization on overlapping subproblems

### Unnecessary Work
- Computing values inside loops that could be computed once outside
- Re-parsing/re-serializing data (JSON.parse/JSON.stringify in loops)
- Redundant API calls that could be batched
- Synchronous operations that block the event loop (TypeScript/Node.js)

### Missing Caching
- Expensive computations repeated with the same inputs
- External API calls that could be cached (with appropriate TTL)
- Database queries for rarely-changing data (config, feature flags)

## Step 5 — Network & I/O Patterns

### Sequential I/O
- Multiple independent API calls made sequentially that could be parallel
  - Python: sequential `await` calls → use `asyncio.gather()`
  - TypeScript: sequential `await` calls → use `Promise.all()`
- Sequential file reads that could be parallelized

### Missing Timeouts
- HTTP client calls without timeout configuration
- Database queries without statement timeout
- External service calls that could hang indefinitely

### Payload Size
- API responses returning unnecessary data (over-fetching)
- Large request bodies without compression
- Missing pagination on list endpoints
- Sending uncompressed images or files

## Step 6 — TypeScript/Node.js Specific

- Blocking the event loop with CPU-heavy sync operations
- Missing `stream` usage for large file processing
- Unnecessary `await` inside `Array.map()` (use `Promise.all(arr.map(...))`)
- RegExp with catastrophic backtracking potential (ReDoS)

## Step 7 — Python Specific

- Using lists where sets/dicts would be O(1) lookup
- Not using generators for large data processing
- Global interpreter lock (GIL) contention in CPU-bound threaded code
- Missing `__slots__` on frequently instantiated classes
- Inefficient string formatting (% or + instead of f-strings in hot paths)

## Step 8 — Format Output

### Performance Issues Found

For each issue:
```
[CRITICAL|HIGH|MEDIUM|LOW] <Category>
File: <path>:<line>
Pattern: <what the problematic code is doing>
Impact: <estimated effect — "O(n²) on user list, will degrade at ~1000 users">
Fix:
  Before: <problematic code snippet>
  After:  <improved code snippet>
```

### Summary Table

| Severity | Category | File | Estimated Impact |
|----------|----------|------|-----------------|
| CRITICAL | N+1 query | src/api/users.py:45 | ~100 extra queries per page load |
| HIGH | No pagination | src/api/reports.py:78 | Loads all rows into memory |
| MEDIUM | Sequential I/O | src/services/notify.py:23 | 3 serial API calls, ~2s wasted |

### Quick Wins
Top 3 changes that would have the biggest performance improvement for the least effort.

### Recommendations
Longer-term improvements for scalability (caching layer, background jobs, query optimization, etc.)

## Step 9 — Save Report

Save the complete performance review to a persistent file for optimization tracking.

1. Create the `reports/` directory if it doesn't exist: `mkdir -p reports`
2. Get today's date: `date +%Y-%m-%d` and capture as `$DATE`
3. Determine the scope label:
   - If `$ARGUMENTS` was `diff`, use `latest-diff`
   - If a file/module path, use a sanitized version (e.g., `src-api-users` from `src/api/users.py`)
   - If no arguments, use `latest-diff`
4. Save the full review to: `reports/perf-review-<scope>-<DATE>.md`
   - Include a YAML front-matter header with: `date`, `scope`, `issues_count` (by severity), `quick_wins_count`
5. Print the file path so the user knows where to find it

**Naming examples:**
- `reports/perf-review-latest-diff-2025-06-15.md`
- `reports/perf-review-src-services-2025-06-15.md`
