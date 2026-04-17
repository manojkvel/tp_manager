---
name: test-gen
description: Generate comprehensive tests for a module (pytest for Python, Jest/Vitest for TypeScript)
argument-hint: "[file-or-module-path]"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(pytest, npx vitest, npx jest, git diff, git show)
---

# Test Generation

Generate thorough, idiomatic tests for the specified module or file.

## Step 1 — Analyze the Target

Read `$ARGUMENTS` (the file or module to test) and understand:

1. **Public API surface** — every exported function, class, method, endpoint
2. **Dependencies** — what it imports, what needs mocking
3. **Side effects** — database calls, HTTP requests, file I/O, message queues
4. **Edge cases** — null/undefined inputs, empty collections, boundary values, concurrency
5. **Existing tests** — check if tests already exist to avoid duplication:
   - Python: look in `tests/` or `test_*.py` alongside the file
   - TypeScript: look in `__tests__/` or `*.test.ts` / `*.spec.ts`

## Step 2 — Determine Test Framework

- **Python files** (`.py`): Use `pytest` with `pytest-asyncio` for async code
  - Fixtures in `conftest.py` where shared
  - Use `unittest.mock.patch` / `MagicMock` for mocking
  - Use `pytest.raises` for exception testing
  - Use `pytest.mark.parametrize` for data-driven tests

- **TypeScript files** (`.ts`, `.tsx`): Check if project uses Jest or Vitest
  - Look for `vitest.config.ts` or `jest.config.*`
  - Default to Vitest if unclear
  - Use `vi.mock()` / `jest.mock()` for mocking

## Step 3 — Generate Tests

Structure tests using **Arrange-Act-Assert** pattern.

### Coverage targets for each function:
1. **Happy path** — expected inputs produce expected outputs
2. **Invalid inputs** — null, undefined, empty string, wrong type, negative numbers
3. **Boundary values** — 0, 1, MAX_INT, empty array, single element
4. **Error paths** — network failures, DB errors, timeouts, permission denied
5. **Async behavior** — proper await, concurrent access, race conditions

### Python test structure:
```python
"""Tests for <module_name>."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from <module> import <function_or_class>


class TestFunctionName:
    """Tests for function_name."""

    def test_happy_path(self):
        """Should return expected result for valid input."""
        result = function_name(valid_input)
        assert result == expected

    def test_empty_input(self):
        """Should handle empty input gracefully."""
        result = function_name("")
        assert result == default_value

    @pytest.mark.parametrize("input_val,expected", [
        (edge_case_1, expected_1),
        (edge_case_2, expected_2),
    ])
    def test_edge_cases(self, input_val, expected):
        """Should handle edge cases correctly."""
        assert function_name(input_val) == expected

    def test_raises_on_invalid(self):
        """Should raise ValueError for invalid input."""
        with pytest.raises(ValueError, match="specific message"):
            function_name(invalid_input)

    @pytest.mark.asyncio
    async def test_async_operation(self):
        """Should complete async operation successfully."""
        result = await async_function(input)
        assert result.status == "success"
```

### TypeScript test structure:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { functionName } from '../module';

describe('functionName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return expected result for valid input', () => {
    const result = functionName(validInput);
    expect(result).toEqual(expected);
  });

  it('should throw on invalid input', () => {
    expect(() => functionName(null)).toThrow('specific message');
  });

  it('should handle async operation', async () => {
    const result = await functionName(input);
    expect(result.status).toBe('success');
  });
});
```

## Step 4 — Write Test File

- Place the test file in the conventional location for the project
- Python: `tests/test_<module_name>.py` or alongside as `test_<filename>.py`
- TypeScript: `__tests__/<filename>.test.ts` or alongside as `<filename>.test.ts`

## Step 5 — Run and Verify

Execute the tests:
- Python: `pytest <test_file> -v`
- TypeScript: `npx vitest run <test_file>` or `npx jest <test_file>`

If tests fail:
1. Read the error output carefully
2. Fix the test (not the source code) if the test has a bug
3. If the source code has a genuine bug, note it in the output
4. Re-run until all tests pass

## Step 6 — Report

```
Tests generated: <count>
Tests passing:   <count>
Tests failing:   <count>

Coverage:
- Functions tested: <list>
- Edge cases covered: <list>
- Mocked dependencies: <list>

Notes:
- <any bugs discovered in source code>
- <any areas that need integration tests beyond unit tests>
```
