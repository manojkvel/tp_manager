---
name: reverse-engineer
description: Reverse-engineer a codebase from source code only (ignoring existing docs) and produce full technical documentation — HLD, LLD, architecture diagrams, sequence diagrams, data models, and more
argument-hint: "['full'|directory-path]"
allowed-tools: Read, Write, Grep, Glob, Bash(git log, git shortlog, ls, wc, cat)
---

# Codebase Reverse Engineering & Technical Documentation Generator

Analyze a codebase purely from its source code — ignore all existing documentation, READMEs, wikis, and comments. Produce a complete set of technical artifacts that would allow a new engineering team to understand, maintain, and extend the system.

## CRITICAL RULE

**Do NOT read or reference any existing documentation.** Do not read README.md, CONTRIBUTING.md, docs/, wiki pages, or CLAUDE.md. The goal is to discover the truth from the code itself. Existing docs may be outdated or misleading — the code is the single source of truth.

You MAY read configuration files (package.json, pyproject.toml, Dockerfile, CI/CD YAML, .env.example) because these are operational artifacts, not documentation.

---

## Phase 1 — Discovery & Inventory

### 1.1 Technology Stack Detection

Scan the project root and dependency files to identify:

```
Glob: package.json, pyproject.toml, requirements.txt, go.mod, Cargo.toml,
      Gemfile, pom.xml, build.gradle, composer.json
```

For each, extract:
- Language(s) and version constraints
- Web framework (FastAPI, Django, Express, Nest.js, Next.js, Spring, etc.)
- Database libraries (which ORMs, which database drivers)
- Message queue / event bus libraries
- Auth libraries (JWT, OAuth, session-based)
- Testing frameworks
- Build tools and bundlers
- Infrastructure tools (Docker, Terraform, K8s manifests, Bicep, CloudFormation)

### 1.2 Directory Structure Mapping

Run `ls -R` on key directories (limit depth to 3 levels). Classify each top-level directory:

- **Entry points**: Where does the application start? (main.py, index.ts, app.ts, server.ts)
- **Route/Controller layer**: Where are HTTP routes defined?
- **Service/Business logic layer**: Where does domain logic live?
- **Data access layer**: Where are database queries, models, repositories?
- **Middleware**: Auth, logging, error handling, rate limiting
- **Shared utilities**: Helpers, constants, types, validation
- **Configuration**: Environment, feature flags, app config
- **Infrastructure**: Docker, CI/CD, deployment scripts
- **Tests**: Unit, integration, E2E — and their structure

### 1.3 Entry Point Analysis

Find and read every application entry point:

```
Grep: "listen(", "createServer", "app.run", "uvicorn.run", "if __name__",
      "bootstrap(", "NestFactory.create", "main()"
```

Document:
- How the app starts
- What middleware is registered and in what order
- What route modules are mounted
- What background workers or scheduled tasks are started

---

## Phase 2 — Architecture Extraction

### 2.1 Component Identification

For each major directory/module, determine:
- **What it owns** (which domain concepts)
- **What it exposes** (public API: exported functions, classes, endpoints)
- **What it depends on** (imports from other internal modules)
- **What external services it talks to** (HTTP clients, database, message queues, caches, third-party APIs)

Build a component inventory table:

| Component | Responsibility | Key Files | Internal Dependencies | External Dependencies |
|-----------|---------------|-----------|----------------------|----------------------|

### 2.2 Dependency Graph

Trace imports across modules to build a dependency map:

```
For each source file:
  - List all imports from other internal modules
  - Flag circular dependencies
  - Identify the direction of dependencies (who depends on whom)
```

Classify layers:
- **Presentation layer**: HTTP handlers, controllers, GraphQL resolvers
- **Application layer**: Service classes, use cases, command handlers
- **Domain layer**: Business entities, value objects, domain events
- **Infrastructure layer**: Database repos, external API clients, message producers/consumers

Check: Do dependencies flow inward (clean architecture) or are there layer violations?

### 2.3 API Surface Extraction

Find ALL API endpoints:

**Python:**
```
Grep: "@app\.(get|post|put|patch|delete)", "@router\.", "@api_view",
      "path(", "url(", "@app\.route"
```

**TypeScript:**
```
Grep: "router\.(get|post|put|patch|delete)", "@Get(", "@Post(", "@Put(",
      "@Delete(", "@Patch(", "app\.(get|post|put|patch|delete)"
```

For each endpoint, extract:
- HTTP method and path
- Request parameters (path, query, body) — read the handler and schema/DTO
- Response structure — read the return statement or serializer
- Authentication requirement — check for auth middleware/decorators
- Validation — check for schema validation (Zod, Pydantic, class-validator, Joi)

### 2.4 Data Model Extraction

Find ALL database models/entities:

```
Grep: "class.*Model", "class.*Entity", "@Entity", "Base.metadata",
      "prisma.model", "Schema({", "define(", "createTable",
      "Table(", "@Table", "sequelize.define"
```

For each model:
- Table/collection name
- All fields with types and constraints (nullable, unique, default, indexed)
- Relationships (foreign keys, one-to-many, many-to-many)
- Indexes (explicit and implicit via unique constraints)
- Soft delete patterns (deleted_at, is_active)
- Timestamps (created_at, updated_at)

### 2.5 Authentication & Authorization Flow

Trace the auth system:
1. Find the auth middleware/guard
2. Trace what it checks (JWT, session, API key, OAuth token)
3. Find where tokens are issued (login endpoint, OAuth callback)
4. Find role/permission definitions and where they're enforced
5. Map which endpoints are public vs. authenticated vs. role-restricted

### 2.6 External Integration Points

Find all outbound connections:

```
Grep: "fetch(", "axios", "httpClient", "requests\.(get|post)",
      "createClient", "Redis(", "amqp", "kafka", "SQS",
      "S3(", "BlobServiceClient", "sendgrid", "twilio", "stripe"
```

For each:
- What external service
- What operations (read, write, subscribe, publish)
- Error handling (retries, circuit breakers, timeouts)
- Configuration (which env vars)

### 2.7 Event/Message Flow (if applicable)

Find event producers and consumers:

```
Grep: "emit(", "publish(", "dispatch(", "on(", "subscribe(",
      "EventEmitter", "@EventPattern", "@MessagePattern",
      "celery.task", "@shared_task", "Bull", "agenda"
```

Map: Who produces what event, who consumes it, what happens.

---

## Phase 3 — Request Flow Tracing

Pick 3-5 critical user flows and trace them end-to-end through the code:

1. **User registration/signup** (or the primary onboarding flow)
2. **Authentication** (login, token refresh)
3. **The core business action** (whatever the app's primary value proposition is — e.g., creating an order, sending a message, processing a payment)
4. **A read-heavy flow** (dashboard, listing, search)
5. **A background/async flow** (if applicable — scheduled jobs, event processing)

For each flow, trace:
```
HTTP Request → Route → Middleware → Handler → Service → Repository → Database
                                            → External API
                                            → Event Bus → Consumer → Side Effects
```

Note every transformation, validation, and side effect along the way.

---

## Phase 4 — Generate Technical Documents

Create all documents in a `docs/technical/` directory. Use Mermaid syntax for all diagrams (renderable in Azure DevOps Wiki, GitHub, and most markdown viewers).

### Document 1: High-Level Design (HLD)

**File: `docs/technical/01-HLD.md`**

```markdown
# High-Level Design Document

## 1. System Overview
<What this system does, derived purely from code analysis>

## 2. Technology Stack
<Languages, frameworks, databases, infrastructure — with versions>

## 3. Architecture Pattern
<Monolith / Microservices / Modular monolith / Serverless — what the code actually is>

## 4. System Context Diagram
```mermaid
C4Context
    Person(user, "User", "End user of the system")
    System(app, "Application", "The system being documented")
    System_Ext(db, "Database", "<type>")
    System_Ext(cache, "Cache", "<type>")
    System_Ext(ext1, "External Service", "<name>")

    Rel(user, app, "Uses", "HTTPS")
    Rel(app, db, "Reads/Writes", "TCP")
    Rel(app, cache, "Caches", "TCP")
    Rel(app, ext1, "Integrates", "HTTPS")
`` `

## 5. Component Diagram
```mermaid
graph TB
    subgraph Presentation
        A[API Routes]
        B[Middleware]
    end
    subgraph Application
        C[Services]
        D[Use Cases]
    end
    subgraph Domain
        E[Entities]
        F[Value Objects]
    end
    subgraph Infrastructure
        G[Repositories]
        H[External Clients]
    end
    A --> B --> C --> E
    C --> G --> DB[(Database)]
    C --> H --> ExtAPI[External APIs]
`` `

## 6. Data Flow Overview
<How data enters, transforms, persists, and exits the system>

## 7. Security Architecture
<Auth mechanism, encryption, secrets management — as implemented>

## 8. Infrastructure & Deployment
<Docker setup, CI/CD pipeline, environments — from config files>
```

### Document 2: Low-Level Design (LLD)

**File: `docs/technical/02-LLD.md`**

```markdown
# Low-Level Design Document

## 1. Module Breakdown
<For each module/component: purpose, public API, internal structure, key classes/functions>

## 2. API Specification
<Every endpoint: method, path, params, request body, response, auth, errors>

## 3. Service Layer Details
<For each service: methods, business rules enforced, dependencies, error handling>

## 4. Data Access Patterns
<How each repository queries the database, query patterns, transactions>

## 5. Middleware Chain
<Order of middleware execution, what each does, how errors propagate>

## 6. Error Handling Strategy
<How errors are caught, transformed, and returned — the actual pattern in code>

## 7. Validation Rules
<Input validation rules per endpoint/model — extracted from schemas>

## 8. Configuration & Environment Variables
<Every env var used, its purpose, default value if any>
```

### Document 3: Data Model Documentation

**File: `docs/technical/03-DATA-MODEL.md`**

```markdown
# Data Model Documentation

## Entity Relationship Diagram
```mermaid
erDiagram
    USER ||--o{ ORDER : places
    USER {
        uuid id PK
        string email UK
        string password_hash
        string role
        timestamp created_at
        timestamp updated_at
    }
    ORDER ||--|{ ORDER_ITEM : contains
    ORDER {
        uuid id PK
        uuid user_id FK
        string status
        decimal total
        timestamp created_at
    }
`` `

## Table Details
<For each table: all columns, types, constraints, indexes, relationships>

## Migration History
<List of migration files found, what each does>

## Data Invariants
<Business rules enforced at the database level — unique constraints, check constraints, triggers>
```

### Document 4: Sequence Diagrams

**File: `docs/technical/04-SEQUENCE-DIAGRAMS.md`**

Generate a Mermaid sequence diagram for each critical flow traced in Phase 3:

```markdown
# Sequence Diagrams

## Flow 1: User Registration
```mermaid
sequenceDiagram
    actor User
    participant API as API Handler
    participant Auth as Auth Service
    participant DB as Database
    participant Email as Email Service

    User->>API: POST /register {email, password}
    API->>API: Validate input (schema)
    API->>Auth: createUser(email, password)
    Auth->>Auth: Hash password
    Auth->>DB: INSERT user
    DB-->>Auth: user record
    Auth->>Email: Send verification email
    Email-->>Auth: queued
    Auth-->>API: user created
    API-->>User: 201 {id, email}
`` `

## Flow 2: Authentication
<...>

## Flow 3: Core Business Flow
<...>
```

### Document 5: Architecture Diagrams

**File: `docs/technical/05-ARCHITECTURE-DIAGRAMS.md`**

```markdown
# Architecture Diagrams

## Deployment Architecture
```mermaid
graph TB
    subgraph Client
        Browser[Browser/Mobile App]
    end
    subgraph "Azure / Cloud"
        LB[Load Balancer]
        subgraph "App Service"
            App1[Instance 1]
            App2[Instance 2]
        end
        DB[(PostgreSQL)]
        Cache[(Redis)]
        Queue[Message Queue]
        Worker[Background Worker]
    end
    Browser --> LB --> App1 & App2
    App1 & App2 --> DB
    App1 & App2 --> Cache
    App1 & App2 --> Queue --> Worker
    Worker --> DB
`` `

## Module Dependency Graph
```mermaid
graph LR
    routes --> middleware --> controllers
    controllers --> services
    services --> repositories
    services --> external_clients
    repositories --> database
    external_clients --> third_party_apis
`` `

## Authentication Flow
```mermaid
graph TD
    A[Request] --> B{Has Token?}
    B -->|No| C[401 Unauthorized]
    B -->|Yes| D{Valid Token?}
    D -->|No| E[401 Invalid Token]
    D -->|Yes| F{Has Permission?}
    F -->|No| G[403 Forbidden]
    F -->|Yes| H[Process Request]
`` `
```

### Document 6: API Reference

**File: `docs/technical/06-API-REFERENCE.md`**

For every endpoint discovered, document in a structured table format:

```markdown
# API Reference

## Authentication Endpoints

### POST /auth/login
- **Auth**: None (public)
- **Body**: `{ email: string, password: string }`
- **Response 200**: `{ token: string, expiresIn: number }`
- **Response 401**: `{ error: "INVALID_CREDENTIALS" }`
- **Rate limit**: Yes (from code analysis)

<repeat for every endpoint>
```

### Document 7: Infrastructure & DevOps

**File: `docs/technical/07-INFRASTRUCTURE.md`**

Extracted from Dockerfiles, CI/CD YAML, Terraform/Bicep, and config files:

```markdown
# Infrastructure Documentation

## Containerization
<Dockerfile analysis: base image, build steps, exposed ports, volumes>

## CI/CD Pipeline
<Pipeline stages, triggers, environment variables needed, deployment targets>

## Environment Configuration
<All env vars, grouped by: database, auth, external services, feature flags>

## Monitoring & Observability
<Logging setup, metrics, health check endpoints — from code>
```

### Document 8: Technical Debt & Risks Observed

**File: `docs/technical/08-TECH-DEBT-AND-RISKS.md`**

Observations made during reverse engineering that new maintainers should know:

```markdown
# Technical Observations & Risks

## Code Quality Observations
<Patterns found: good practices, anti-patterns, inconsistencies>

## Potential Risks
<Security concerns, scalability bottlenecks, single points of failure>

## Undocumented Behaviors
<Business rules buried in code that aren't obvious from the API surface>

## Known Shortcuts & TODOs
<TODO/FIXME/HACK comments found, with file locations and age>

## Recommendations for New Maintainers
<Priority items to address, patterns to follow, patterns to avoid>
```

---

## Phase 5 — Automated Verification & Confidence Report

This is the most critical phase. Documentation that hasn't been verified against the actual code is just guesswork. Run every check below and produce a verification report.

### 5.1 Endpoint Verification (API Reference vs. Actual Code)

For EVERY endpoint documented in `06-API-REFERENCE.md`:

1. **Grep the codebase** for the exact route path string (e.g., `"/auth/login"`, `"/users/:id"`)
2. Confirm the HTTP method matches
3. Confirm the handler function exists at the file:line cited
4. Read the handler and verify:
   - Request parameters listed actually exist in the code
   - Response structure matches what the handler returns
   - Auth requirement matches (is middleware actually applied?)

Record result per endpoint: VERIFIED / MISMATCH / NOT_FOUND

Then search for endpoints in the code NOT documented in the API Reference:
```
Grep: @(Get|Post|Put|Delete|Patch)\(|router\.(get|post|put|delete)|@app\.(get|post|put|delete|route)
```
Compare against documented endpoints. Any in code but not in docs = UNDOCUMENTED.

### 5.2 Data Model Verification (ER Diagram vs. Actual Schema)

For EVERY table/model in `03-DATA-MODEL.md`:

1. Find the actual model definition file
2. Compare columns documented vs. columns in code:
   - Missing columns = doc is incomplete
   - Extra columns in doc = doc has phantom fields
3. Verify relationships: does the foreign key actually exist?
4. Verify indexes: are documented indexes actually defined?

Then search for models NOT in the ER diagram:
```
Grep: class.*Model|class.*Entity|@Entity|Table\(|Schema\(\{|model\s+\w+\s*\{
```
Any model in code but not in docs = UNDOCUMENTED.

### 5.3 Dependency Verification (Architecture Diagrams vs. Imports)

For every dependency arrow in the architecture/component diagrams:

1. Grep for actual import statements between the two modules
2. Confirm the direction is correct (A depends on B, not B on A)
3. Flag any circular dependencies found but not documented

Then check for significant import relationships NOT shown in diagrams.

### 5.4 External Service Verification

For every external service documented in `01-HLD.md` system context diagram:

1. Find the actual client/SDK usage in code
2. Confirm the operations described match what the code does
3. Verify the env vars listed actually configure this service

Search for external services NOT documented:
```
Grep: fetch\(|axios\.|httpClient\.|requests\.(get|post)|Redis\(|S3\(|BlobServiceClient|sendgrid|stripe|twilio|kafka|amqp|SQS|SNS
```

### 5.5 Sequence Diagram Verification

For each sequence diagram in `04-SEQUENCE-DIAGRAMS.md`:

1. Re-trace the flow through the actual code, step by step
2. Verify each arrow represents a real function call or message
3. Check that the order of operations matches the code execution order
4. Confirm error paths shown actually exist
5. Flag any steps in the real code that the diagram omits

### 5.6 Environment Variable Verification

1. Grep the entire codebase for `process.env.`, `os.environ`, `os.getenv`, `config(`, `@Value`
2. Compare against the env vars listed in `07-INFRASTRUCTURE.md`
3. Flag any env var used in code but not documented
4. Flag any env var documented but not found in code

### 5.7 Mermaid Syntax Validation

For each Mermaid diagram in every document:

1. Check for common syntax errors:
   - Unclosed subgraphs
   - Missing arrow syntax (`-->` not `->`)
   - Unmatched quotes in labels
   - Invalid diagram type declarations
2. Verify node IDs are consistent (same node = same ID everywhere)
3. Check that the diagram would actually render (no orphaned nodes unless intentional)

---

### Document 9: Verification & Confidence Report

**File: `docs/technical/09-VERIFICATION-REPORT.md`**

This is the document that answers "how do we know this is accurate?"

```markdown
# Verification & Confidence Report

> Generated on <date> by automated cross-referencing of documentation against source code.

## Overall Confidence Score: <X>%

Calculated as: (verified items / total items) across all checks.

## 1. API Endpoint Verification

| Endpoint | Method | Documented File:Line | Status | Notes |
|----------|--------|---------------------|--------|-------|
| /auth/login | POST | src/routes/auth.ts:15 | VERIFIED | All params match |
| /users/:id | GET | src/routes/users.ts:42 | MISMATCH | Doc says returns `role`, code returns `permissions` |
| /orders | POST | src/routes/orders.ts:8 | VERIFIED | |

**Undocumented endpoints found in code:**
| Endpoint | Method | File:Line | Risk |
|----------|--------|-----------|------|
| /health | GET | src/app.ts:5 | Low — health check |
| /internal/metrics | GET | src/routes/admin.ts:12 | HIGH — undocumented admin endpoint |

**API Coverage: X/Y endpoints verified (Z%)**

## 2. Data Model Verification

| Model/Table | Documented Fields | Actual Fields | Match | Discrepancies |
|-------------|-------------------|---------------|-------|---------------|
| User | 6 | 6 | FULL | — |
| Order | 5 | 7 | PARTIAL | Missing: `discount_code`, `shipping_method` |

**Undocumented models found in code:**
| Model | File | Fields | Risk |
|-------|------|--------|------|
| AuditLog | src/models/audit.py | 8 | MEDIUM — not in ER diagram |

**Data Model Coverage: X/Y models verified (Z%)**

## 3. External Service Verification

| Service | Documented In | Found In Code | Operations Match | Env Vars Match |
|---------|--------------|---------------|-----------------|----------------|
| PostgreSQL | HLD | src/db/client.ts | YES | YES |
| Redis | HLD | src/cache/redis.ts | YES | YES |
| Stripe | HLD | src/payments/stripe.ts | PARTIAL | YES |

**Undocumented services found:** <list or "None">

**External Service Coverage: X/Y services verified (Z%)**

## 4. Sequence Diagram Accuracy

| Flow | Steps Documented | Steps in Code | Accuracy | Missing Steps |
|------|-----------------|---------------|----------|---------------|
| User Registration | 10 | 12 | 83% | Email verification queue, rate limit check |
| Login | 8 | 8 | 100% | — |
| Create Order | 14 | 14 | 100% | — |

**Sequence Diagram Coverage: X/Y flows verified (Z%)**

## 5. Environment Variable Verification

| Status | Count | Details |
|--------|-------|---------|
| Documented and found in code | N | ✓ Verified |
| In code but NOT documented | N | ⚠ Gap — listed below |
| Documented but NOT in code | N | ⚠ Phantom — listed below |

**Undocumented env vars:**
| Variable | Used In | Purpose (inferred) |
|----------|---------|-------------------|
| SENTRY_DSN | src/config.ts:12 | Error tracking |

## 6. Architecture Diagram Verification

| Relationship | Documented | Import Evidence | Status |
|-------------|-----------|-----------------|--------|
| routes → controllers | Yes | src/routes/index.ts imports src/controllers/* | VERIFIED |
| controllers → services | Yes | src/controllers/user.ts imports src/services/user | VERIFIED |
| services → external (undocumented) | No | src/services/notify.ts imports src/clients/slack | MISSING |

**Circular dependencies found:** <list or "None">
**Layer violations found:** <list or "None">

## 7. Confidence Summary

| Document | Items Checked | Verified | Mismatches | Gaps | Confidence |
|----------|--------------|----------|------------|------|------------|
| 01-HLD | N | N | N | N | X% |
| 02-LLD | N | N | N | N | X% |
| 03-DATA-MODEL | N | N | N | N | X% |
| 04-SEQUENCE-DIAGRAMS | N | N | N | N | X% |
| 05-ARCHITECTURE | N | N | N | N | X% |
| 06-API-REFERENCE | N | N | N | N | X% |
| 07-INFRASTRUCTURE | N | N | N | N | X% |
| **OVERALL** | **N** | **N** | **N** | **N** | **X%** |

## 8. Items Requiring Human Review

These items could not be verified automatically and need a human engineer to confirm:

1. <Business logic interpretation that may be wrong — cite specific file:line>
2. <Ambiguous relationship between modules — two possible interpretations>
3. <Auth flow edge case that depends on runtime configuration>

## 9. Recommended Fixes

Fixes to apply to the documentation before trusting it:

| Priority | Document | Issue | Fix Required |
|----------|----------|-------|-------------|
| HIGH | API Reference | Missing 2 endpoints | Add /health and /internal/metrics |
| HIGH | Data Model | Order table missing 2 fields | Add discount_code, shipping_method |
| MEDIUM | Sequence Diagrams | Registration flow missing 2 steps | Add email queue and rate limit |
| LOW | Architecture | Missing Slack integration arrow | Add services → Slack client |
```

---

## Phase 6 — Apply Fixes from Verification

After generating the verification report:

1. Go back and fix every MISMATCH and GAP found in Phase 5
2. Add all UNDOCUMENTED items to the appropriate documents
3. Re-run the specific verification checks that failed
4. Update the confidence scores in the verification report
5. Repeat until confidence is above 90% or all remaining gaps are marked as "REQUIRES HUMAN REVIEW"

**Do not finalize documentation with confidence below 80%.** If confidence is below 80%, explicitly warn: "Documentation confidence is below threshold. Human review is strongly recommended before relying on these documents."

---

## Phase 7 — Generate Index

**File: `docs/technical/README.md`**

```markdown
# Technical Documentation Index

> Auto-generated by reverse-engineering the codebase on <date>.
> This documentation was produced by analyzing source code only — no existing
> documentation was referenced. The code is the single source of truth.

| # | Document | Description |
|---|----------|-------------|
| 1 | [High-Level Design](01-HLD.md) | System overview, architecture, components |
| 2 | [Low-Level Design](02-LLD.md) | Module details, services, middleware, validation |
| 3 | [Data Model](03-DATA-MODEL.md) | ER diagram, table details, migrations |
| 4 | [Sequence Diagrams](04-SEQUENCE-DIAGRAMS.md) | Request flows for critical paths |
| 5 | [Architecture Diagrams](05-ARCHITECTURE-DIAGRAMS.md) | Deployment, dependencies, auth flow |
| 6 | [API Reference](06-API-REFERENCE.md) | Every endpoint with request/response specs |
| 7 | [Infrastructure](07-INFRASTRUCTURE.md) | Docker, CI/CD, environments, monitoring |
| 8 | [Tech Debt & Risks](08-TECH-DEBT-AND-RISKS.md) | Observations and recommendations |
| 9 | [Verification Report](09-VERIFICATION-REPORT.md) | Confidence scores, mismatches, gaps, human review items |

## Tech Stack Summary
<one-line summary per technology>

## Quick Stats
- Total source files: <count>
- Total lines of code: <count>
- API endpoints: <count>
- Database tables: <count>
- External integrations: <count>
- Test files: <count>
```

---

## Output Notes

- Write ALL files to `docs/technical/` in the project root
- Use Mermaid for all diagrams (natively supported in Azure DevOps Wiki)
- Keep language precise and technical — this is for engineers, not stakeholders
- If something in the code is ambiguous, note it explicitly as "AMBIGUOUS: <description>" rather than guessing
- Include file paths for every claim (e.g., "Auth middleware at src/middleware/auth.ts:23")
- Do not invent features that don't exist in the code
