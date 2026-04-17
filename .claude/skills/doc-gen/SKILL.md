---
name: doc-gen
description: Generate or update documentation for a module, API, or the full project
argument-hint: "[file-or-module-or-'api'|'readme'|'changelog']"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(git log, git diff, git tag)
---

# Documentation Generator

Generate clear, accurate documentation for the specified target.

## Step 1 — Determine Documentation Type

Based on `$ARGUMENTS`:

- **A file path** → Generate module/function documentation
- **`api`** → Generate API endpoint documentation
- **`readme`** → Generate or update project README
- **`changelog`** → Generate changelog from recent commits
- **No argument** → Scan for undocumented public APIs and generate docs for them

## Step 2 — Gather Context

### For module docs:
- Read the target file(s) completely
- Identify all public exports (functions, classes, types, constants)
- Read existing docstrings/JSDoc to avoid duplicating
- Check for existing documentation in `docs/` folder

### For API docs:
- Find all route definitions:
  - Python: search for `@app.route`, `@router.`, `APIRouter`, `@api_view`
  - TypeScript: search for `router.get`, `router.post`, `app.get`, `@Get()`, `@Post()`
- Read request/response types or schemas
- Check for existing OpenAPI/Swagger specs

### For changelog:
- Run `git log --oneline` since last tag or last N commits
- Group commits by type (feat, fix, refactor, docs, etc.)

## Step 3 — Generate Documentation

### Module Documentation (Python):
```python
"""
Module: <module_name>

<One-paragraph description of what this module does and why it exists.>

Dependencies:
    - <key external dependencies and why they're used>

Example usage:
    >>> from <module> import <main_function>
    >>> result = <main_function>(args)
"""


def function_name(param1: Type, param2: Type) -> ReturnType:
    """<One-line summary.>

    <Expanded description if the function is non-trivial.>

    Args:
        param1: <description>
        param2: <description>

    Returns:
        <description of return value>

    Raises:
        ValueError: <when this happens>
        ConnectionError: <when this happens>

    Example:
        >>> function_name("input", 42)
        ExpectedOutput(...)
    """
```

### Module Documentation (TypeScript):
```typescript
/**
 * <One-line summary.>
 *
 * <Expanded description if the function is non-trivial.>
 *
 * @param param1 - <description>
 * @param param2 - <description>
 * @returns <description>
 * @throws {ErrorType} <when this happens>
 *
 * @example
 * ```ts
 * const result = functionName("input", 42);
 * // => ExpectedOutput
 * ```
 */
```

### API Endpoint Documentation:
For each endpoint, document:
```markdown
### `METHOD /path/to/endpoint`

<Description of what this endpoint does.>

**Auth:** Required | Optional | None
**Rate limit:** X requests per minute

**Request:**
| Parameter | Location | Type   | Required | Description |
|-----------|----------|--------|----------|-------------|
| id        | path     | string | yes      | Resource ID |
| limit     | query    | number | no       | Page size (default: 20) |

**Request body:**
```json
{
  "field": "type — description"
}
```

**Response (200):**
```json
{
  "data": { ... }
}
```

**Error responses:**
| Status | Code           | Description        |
|--------|----------------|--------------------|
| 400    | INVALID_INPUT  | Validation failed  |
| 401    | UNAUTHORIZED   | Missing/bad token  |
| 404    | NOT_FOUND      | Resource not found |
```

### Changelog format:
```markdown
## [version] — YYYY-MM-DD

### Added
- <new feature descriptions>

### Changed
- <modification descriptions>

### Fixed
- <bug fix descriptions>

### Security
- <security-related changes>
```

## Step 4 — Write Output

- **Docstrings**: Edit the source files directly to add/update docstrings
- **API docs**: Write to `docs/api.md` (or update existing)
- **README**: Write to `README.md` at project root
- **Changelog**: Write to `CHANGELOG.md` at project root

## Step 5 — Verify

- Ensure all public functions/classes have documentation
- Verify code examples are syntactically correct
- Check that parameter names match actual function signatures
- Confirm no internal/private implementation details are exposed in public docs
