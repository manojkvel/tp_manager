---
name: api-contract-analyzer
description: Detect breaking API changes by comparing the API surface of a branch against the baseline
argument-hint: "[branch-or-commit-to-compare | 'full']"
allowed-tools: Read, Write, Grep, Glob, Bash(git log, git shortlog, cat, ls, find, date)
---

# API Contract Analyzer

Compare the API surface between two versions of your codebase to detect breaking changes, missing versioning, and contract drift. Catches renamed fields, removed endpoints, changed types, and incompatible response shapes before they hit production and break downstream consumers.

## Step 1 — Identify the Comparison Baseline

If `$ARGUMENTS` is provided:
- A branch name → compare that branch against the current branch
- A commit hash → compare that commit against HEAD
- `full` → perform a comprehensive API inventory of the current state (no comparison)

If no arguments, compare `HEAD` against the most recent tag:
```bash
BASELINE=$(git tag --sort=-v:refname | head -1)
git log --oneline $BASELINE..HEAD | head -20
```

## Step 2 — Discover API Definitions

### OpenAPI / Swagger Specs
```
Glob: **/openapi.{yaml,yml,json}, **/swagger.{yaml,yml,json}, **/api-spec*.{yaml,yml,json}
```

If found, this is the primary source of truth. Compare the baseline version against the current version:
```bash
git show $BASELINE:<path-to-spec> > /tmp/api-spec-old.yaml 2>/dev/null
```

### Route/Controller Definitions (Code-First APIs)

Scan for framework-specific route patterns:

**Express/Node.js:**
```
Grep: "router\.(get|post|put|patch|delete|all)\s*\("
Grep: "app\.(get|post|put|patch|delete)\s*\("
```

**FastAPI/Python:**
```
Grep: "@(app|router)\.(get|post|put|patch|delete)\s*\("
```

**ASP.NET/C#:**
```
Grep: "\[(HttpGet|HttpPost|HttpPut|HttpPatch|HttpDelete|Route)\("
Grep: "\[ApiController\]"
```

**Spring/Java:**
```
Grep: "@(GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping|RequestMapping)\("
```

### GraphQL Schemas
```
Glob: **/*.graphql, **/schema.{graphql,gql}, **/*.gql
Grep: "type Query", "type Mutation", "type Subscription"
```

### gRPC Proto Files
```
Glob: **/*.proto
Grep: "service\s+\w+\s*\{", "rpc\s+\w+"
```

## Step 3 — Build API Surface Maps

For both the baseline and current versions, build a complete API surface map:

### REST APIs
For each endpoint:
```
Method: GET/POST/PUT/PATCH/DELETE
Path: /api/v1/users/:id
Parameters: path params, query params, headers
Request Body: schema/type (if applicable)
Response Body: schema/type
Status Codes: expected responses
Auth: required auth middleware/decorator
```

### GraphQL APIs
For each type/field:
```
Type: Query/Mutation/Subscription
Field: fieldName
Arguments: arg names and types
Return Type: type (nullable/non-nullable, list/scalar)
Deprecation: @deprecated directive
```

### gRPC APIs
For each service/method:
```
Service: ServiceName
Method: MethodName
Request: MessageType
Response: MessageType
Streaming: unary/server/client/bidirectional
```

## Step 4 — Detect Breaking Changes

Compare the two API surface maps and classify changes:

### Breaking Changes (CRITICAL)
These will break existing consumers:

1. **Removed endpoint/field** — existed in baseline, missing in current
2. **Changed HTTP method** — e.g., GET → POST for same path
3. **Renamed field** — field name changed in request or response body
4. **Changed type** — field type changed (e.g., `string` → `number`, `required` → removed)
5. **Required field added to request** — new required field that existing callers won't send
6. **Removed field from response** — field consumers may depend on is gone
7. **Changed URL path** — endpoint moved without redirect
8. **Changed auth requirements** — endpoint now requires auth that wasn't needed before
9. **Narrowed enum values** — removed a valid enum option from a request field
10. **Changed status codes** — success code changed (e.g., 200 → 201)

### Non-Breaking Changes (INFO)
Safe changes that don't break consumers:

1. **New endpoint added** — additive change
2. **Optional field added to request** — callers can ignore it
3. **New field added to response** — clients should ignore unknown fields
4. **New enum value added** — expanded options
5. **Endpoint deprecated** (but still works) — with deprecation notice
6. **Documentation updated** — no functional change

### Potentially Breaking (WARNING)
May break some consumers depending on implementation:

1. **Default value changed** — could affect behavior if consumers rely on default
2. **Validation rules tightened** — previously valid input may now be rejected
3. **Response field made nullable** — was always present, now may be null
4. **Rate limit changed** — consumers hitting new limits
5. **Pagination behavior changed** — page size, cursor format, etc.

## Step 5 — Check API Versioning

Verify that breaking changes are properly versioned:

- Are breaking changes behind a new API version? (e.g., `/api/v2/`)
- Is the old version still available?
- Is there a deprecation notice for the old version?
- Do migration docs exist?

If breaking changes exist WITHOUT proper versioning → flag as **VERSION_VIOLATION**

## Step 6 — Format Output

### API Contract Analysis Summary

```
Baseline: <tag/branch/commit>
Current: <branch/HEAD>
Endpoints compared: N
Fields compared: N
```

### Breaking Changes

For each breaking change:
```
[BREAKING] <method> <path> — <description>
  Baseline: <what it was>
  Current: <what it is now>
  Impact: <who/what breaks>
  Remediation: <how to fix — version, deprecation, or revert>
```

### Warnings

For each potentially breaking change:
```
[WARNING] <method> <path> — <description>
  Change: <what changed>
  Risk: <when this could break consumers>
  Recommendation: <defensive action>
```

### New Endpoints (Informational)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | /api/v1/webhooks | New webhook registration | Bearer |

### API Versioning Assessment

| Check | Status |
|-------|--------|
| Breaking changes versioned? | YES/NO |
| Old version still available? | YES/NO/N/A |
| Deprecation notices present? | YES/NO/N/A |
| Migration guide exists? | YES/NO/N/A |

### Verdict

**SAFE TO SHIP** — No breaking changes detected
**SHIP WITH CAUTION** — Breaking changes detected but properly versioned
**DO NOT SHIP** — Unversioned breaking changes will break consumers

## Step 7 — Save Report

Save the complete analysis to a persistent file.

1. Create the `reports/` directory if it doesn't exist: `mkdir -p reports`
2. Get today's date: `date +%Y-%m-%d` and capture as `$DATE`
3. Determine the scope label:
   - Use the branch or comparison identifier (e.g., `main-vs-feature-auth`)
   - If `full`, use `full-inventory`
4. Save to: `reports/api-contract-<scope>-<DATE>.md`
   - Include a YAML front-matter header with: `date`, `baseline`, `current`, `breaking_count`, `warning_count`, `new_endpoints_count`, `verdict`
5. Print the file path so the user knows where to find it

**Naming examples:**
- `reports/api-contract-main-vs-feature-auth-2025-06-15.md`
- `reports/api-contract-full-inventory-2025-06-15.md`

**Tip:** Run this on every PR that touches API routes or schemas. Integrate with `/pr-orchestrator` for automatic detection.
