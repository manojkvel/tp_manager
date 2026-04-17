---
name: skill-gap-analyzer
description: Analyze a codebase and its existing Claude Code skills to identify what additional skills are needed — designed for standardized governance across multiple codebases
argument-hint: "['full'|'quick'|focus-area]"
allowed-tools: Read, Write, Grep, Glob, Bash(ls, find, tree, wc, git log, git shortlog, npm list, pip list, cat)
---

# Codebase Skill Gap Analyzer

Analyze a codebase and its existing `.claude/skills/` directory to determine what additional skills are required. Think like an engineering director managing multiple codebases — potentially from acquisitions — who needs standardized governance, SDLC compliance, and skill coverage across all projects regardless of tech stack or project structure.

---

## Execution Modes

- **`full`** — Complete analysis: tech stack profiling, skill inventory, gap detection, priority scoring, and draft SKILL.md generation for top recommendations
- **`quick`** — Lightweight scan: tech stack detection + skill inventory + gap summary (no drafts)
- **Focus area** — Analyze gaps in a specific domain: `security`, `testing`, `compliance`, `data`, `infra`, `frontend`, `api`, `observability`, `migration`

---

## Phase 1 — Codebase Profiling

### 1.1 Tech Stack Fingerprinting

Detect the complete technology footprint. Don't just check dependency files — scan actual usage patterns.

**Language & Framework Detection:**
```
Glob: package.json, tsconfig.json, pyproject.toml, requirements*.txt,
      go.mod, Cargo.toml, Gemfile, pom.xml, build.gradle, composer.json,
      *.csproj, Directory.Build.props, mix.exs, Makefile
```

**Classify the stack into dimensions:**

| Dimension | What to Detect | How |
|-----------|---------------|-----|
| Languages | Primary + secondary languages | File extensions + config files |
| Web Framework | Express, Nest, FastAPI, Django, Spring, Rails, etc. | Dependency files + import patterns |
| API Style | REST, GraphQL, gRPC, WebSocket, tRPC | Grep for schema definitions, resolvers, proto files |
| Database | SQL (Postgres, MySQL, SQLite), NoSQL (Mongo, DynamoDB), Graph | ORM configs, connection strings, driver imports |
| ORM/Query | Prisma, TypeORM, SQLAlchemy, Django ORM, Drizzle, Sequelize | Import patterns, model definitions |
| Cache | Redis, Memcached, in-memory | Client imports, connection configs |
| Message Queue | Kafka, RabbitMQ, SQS, Bull, Celery | Producer/consumer patterns |
| Auth | JWT, OAuth2, Session, SAML, API Key, OIDC | Auth middleware, token patterns |
| File Storage | S3, Azure Blob, GCS, local | SDK imports, upload handlers |
| Search | Elasticsearch, Algolia, Meilisearch, full-text SQL | Client imports, index configs |
| Realtime | WebSockets, SSE, Socket.io, Pusher | Connection handlers, event emitters |
| Frontend | React, Vue, Angular, Svelte, Next.js, Nuxt | Framework markers, component patterns |
| Mobile | React Native, Flutter, Swift, Kotlin | Platform-specific files |
| ML/AI | TensorFlow, PyTorch, scikit-learn, LangChain, OpenAI | Model imports, inference code |
| Payments | Stripe, PayPal, Braintree, Adyen | SDK imports, webhook handlers |
| Email | SendGrid, SES, Mailgun, Resend, nodemailer | Transporter configs, send calls |
| CI/CD | GitHub Actions, Azure Pipelines, GitLab CI, Jenkins, CircleCI | Pipeline definition files |
| IaC | Terraform, Bicep, Pulumi, CDK, CloudFormation | IaC definition files |
| Container | Docker, Podman, docker-compose, K8s | Dockerfile, compose files, manifests |
| Monitoring | Sentry, Datadog, New Relic, Prometheus, OpenTelemetry | SDK init, instrumentation |

### 1.2 Project Structure Classification

Determine the architectural style:

```
Scan top-level directories and classify:
- Monolith: single app entry, shared database, one deployment unit
- Modular monolith: domain-separated modules within one deployment
- Microservices: multiple services with separate entry points
- Monorepo: multiple packages/apps in one repo (Nx, Turborepo, Lerna, workspaces)
- Serverless: Lambda/Function definitions, no persistent server
- Library/SDK: published package, not a running application
- CLI tool: command-line interface, argument parsing
- Hybrid: combination of the above
```

### 1.3 Domain & Compliance Detection

Identify the business domain and applicable regulatory frameworks:

```
Grep for domain-specific patterns:
- Healthcare: HIPAA, PHI, HL7, FHIR, patient, diagnosis, prescription
- Finance: PCI-DSS, SOX, AML, KYC, transaction, ledger, settlement
- Education: FERPA, student, enrollment, grade, curriculum
- E-commerce: cart, checkout, inventory, shipping, product catalog
- SaaS/B2B: tenant, subscription, billing, seat, plan, workspace
- Government: FedRAMP, FISMA, clearance, classification
- Data/Privacy: GDPR, CCPA, consent, data-subject, right-to-delete, anonymize
```

Detect compliance-relevant code patterns:
```
Grep: encrypt, decrypt, hash, audit_log, access_log, consent,
      data_retention, anonymize, pseudonymize, pii, sensitive,
      classification, rbac, abac, mfa, 2fa
```

### 1.4 Codebase Metrics

Collect quantitative data:

```bash
# Size
find . -name '*.ts' -o -name '*.tsx' -o -name '*.py' -o -name '*.js' -o -name '*.jsx' | wc -l  # file count
find . -name '*.ts' -o -name '*.py' | xargs wc -l | tail -1  # LOC

# Age & activity
git log --oneline | wc -l  # commit count
git log --format="%aN" | sort -u | wc -l  # contributor count
git log -1 --format="%ci"  # last commit date
git log --reverse --format="%ci" | head -1  # first commit date

# Test coverage indicator
find . -path '*/test*' -o -path '*/__test__*' -o -path '*.spec.*' -o -path '*.test.*' | wc -l
```

---

## Phase 2 — Existing Skill Inventory

### 2.1 Discover Installed Skills

```
Glob: .claude/skills/*/SKILL.md
```

For each skill found, extract:
- **Name** (directory name)
- **Description** (from YAML frontmatter)
- **Scope** — what it analyzes or acts upon
- **Tech-stack assumptions** — does it assume Python? TypeScript? A specific framework?
- **SDLC phase** — which phase of the development lifecycle does it cover?

Build an inventory table:

| Skill | SDLC Phase | Scope | Tech Assumptions | Stack Match? |
|-------|-----------|-------|------------------|-------------|

### 2.2 Skill-to-Stack Compatibility Check

For each existing skill:
1. Read the SKILL.md fully
2. Check if the grep patterns, file patterns, and instructions match this codebase's actual stack
3. Flag skills that assume a different tech stack (e.g., a Python-focused skill on a Go codebase)
4. Note skills that are generic enough to work across stacks vs. those that need adaptation

Classify each skill: COMPATIBLE / NEEDS_ADAPTATION / NOT_APPLICABLE

---

## Phase 3 — Gap Analysis

### 3.1 Standard Skill Coverage Matrix

Every well-governed codebase should have skill coverage across these categories. Check each against the existing skill inventory.

#### Category A — Code Quality & Review

| Expected Skill | Purpose | Exists? | Gap? |
|---------------|---------|---------|------|
| Code review | Correctness, patterns, style | | |
| Design/architecture review | Component design, coupling, SRP | | |
| Performance review | N+1, memory, compute, I/O | | |
| Accessibility review | WCAG, ARIA, keyboard nav | | |
| i18n/l10n review | Internationalization readiness | | |

#### Category B — Security

| Expected Skill | Purpose | Exists? | Gap? |
|---------------|---------|---------|------|
| Security audit | OWASP Top 10, injection, XSS | | |
| Dependency vulnerability scan | Known CVEs in deps | | |
| Secrets detection | Hardcoded credentials, API keys | | |
| Auth flow review | Token handling, session security | | |
| Data privacy audit | PII handling, GDPR compliance | | |

#### Category C — Testing

| Expected Skill | Purpose | Exists? | Gap? |
|---------------|---------|---------|------|
| Unit test generation | Per-function/class tests | | |
| Integration test generation | Cross-module tests | | |
| E2E test generation | Full user-flow tests | | |
| Regression check | Will changes break existing tests? | | |
| Test coverage analysis | Identify untested code paths | | |
| Contract/API test generation | API schema validation tests | | |

#### Category D — Documentation

| Expected Skill | Purpose | Exists? | Gap? |
|---------------|---------|---------|------|
| Code documentation generator | Module/function docs | | |
| API documentation generator | OpenAPI/Swagger generation | | |
| Onboarding guide generator | "How this codebase works" | | |
| ADR generator | Architecture Decision Records | | |
| Changelog generator | Release notes from commits | | |
| Reverse engineering docs | Full technical doc suite from code | | |

#### Category E — DevOps & Infrastructure

| Expected Skill | Purpose | Exists? | Gap? |
|---------------|---------|---------|------|
| CI/CD review | Pipeline quality, security gates | | |
| Dockerfile review | Image size, security, best practices | | |
| IaC review | Terraform/Bicep quality, drift detection | | |
| Environment config audit | Env var consistency across envs | | |
| Deployment readiness check | Pre-deploy validation | | |

#### Category F — Data & Database

| Expected Skill | Purpose | Exists? | Gap? |
|---------------|---------|---------|------|
| Migration review | Schema change safety, rollback plan | | |
| Query performance audit | Slow queries, missing indexes | | |
| Data model documentation | ER diagrams, relationship docs | | |
| Data integrity check | Orphaned records, constraint violations | | |
| Seed data generator | Dev/test data generation | | |

#### Category G — Maintenance & Governance

| Expected Skill | Purpose | Exists? | Gap? |
|---------------|---------|---------|------|
| Tech debt audit | Codebase health scoring | | |
| Dependency update | Outdated/vulnerable packages | | |
| Dead code detection | Unused exports, unreachable code | | |
| Impact analysis | Blast radius of changes | | |
| Compliance check | Regulatory requirement adherence | | |
| License audit | OSS license compatibility | | |

#### Category H — Stack-Specific (conditional)

Only flag these if the codebase actually uses the relevant technology:

| Condition | Expected Skill | Purpose |
|-----------|---------------|---------|
| Uses GraphQL | GraphQL schema review | Schema design, N+1 in resolvers, deprecation |
| Uses gRPC | Proto review | Proto design, backward compat, versioning |
| Uses message queues | Event contract review | Message schema, idempotency, dead letters |
| Has frontend | Component review | React/Vue/Angular best practices, render perf |
| Has frontend | Design system audit | Component consistency, token usage |
| Uses ML/AI | Model review | Bias, drift, reproducibility, versioning |
| Multi-tenant | Tenant isolation audit | Data leakage, query scoping, config separation |
| Uses WebSockets | Realtime review | Connection management, backpressure, auth |
| Uses Kubernetes | K8s manifest review | Resource limits, probes, RBAC, network policies |
| Mobile app | Mobile review | Platform guidelines, performance, offline |
| Has payments | Payment flow audit | PCI compliance, idempotency, reconciliation |
| Uses feature flags | Feature flag review | Stale flags, gradual rollout, cleanup |
| Has async workers | Worker review | Retry logic, idempotency, monitoring |

### 3.2 Cross-Codebase Governance Gaps

For multi-codebase management, check for governance-level skills:

| Governance Skill | Purpose | Why It Matters for Acquisitions |
|-----------------|---------|-------------------------------|
| Standards conformance check | Does this codebase follow org standards? | Acquired codebases often have different conventions |
| Cross-repo dependency map | What shared libraries/services does this depend on? | Identify integration points post-acquisition |
| API compatibility check | Do APIs follow org conventions? | Standardize API contracts across products |
| Naming convention enforcer | Consistent naming across codebases | Reduce cognitive load when engineers switch repos |
| Shared infrastructure audit | Are org-standard tools being used? | Consolidate monitoring, logging, auth |
| Runbook generator | Generate ops runbooks from code | Standardize incident response across teams |
| Cost analysis | Estimate cloud resource costs from IaC | Financial governance across acquired products |

---

## Phase 4 — Priority Scoring & Recommendations

### 4.1 Score Each Gap

For every gap identified in Phase 3, calculate a priority score (1-10):

```
Priority = (Risk Impact × 0.4) + (Frequency of Need × 0.3) + (Automation Potential × 0.3)

Where:
- Risk Impact (1-10): What's the damage if this skill is missing?
  10 = security breach, data loss, compliance violation
   7 = production outage, performance degradation
   4 = tech debt accumulation, developer friction
   1 = minor inconvenience

- Frequency of Need (1-10): How often would this skill be invoked?
  10 = every PR / every commit
   7 = every sprint / weekly
   4 = monthly / quarterly
   1 = once per year or ad-hoc

- Automation Potential (1-10): How well can Claude automate this?
  10 = fully automatable with grep/read/write
   7 = mostly automatable with some heuristics
   4 = partially automatable, needs human judgment
   1 = mostly human judgment, minimal automation value
```

### 4.2 Generate Recommendations Report

**File: `docs/skill-gap-report.md`**

```markdown
# Skill Gap Analysis Report

> Generated on <date> by analyzing <codebase-name>
> Existing skills: <count> | Gaps identified: <count> | Critical gaps: <count>

## Codebase Profile

| Property | Value |
|----------|-------|
| Primary Language(s) | <detected> |
| Framework(s) | <detected> |
| Architecture | <monolith/microservices/etc.> |
| Database(s) | <detected> |
| CI/CD | <detected> |
| Domain | <detected> |
| Compliance Needs | <detected or "None detected"> |
| Codebase Size | <files / LOC> |
| Age | <first commit to last commit> |
| Contributors | <count> |

## Existing Skill Inventory

| # | Skill | SDLC Phase | Compatible? | Notes |
|---|-------|-----------|-------------|-------|
<existing skills table>

## Skill Compatibility Issues

<list any existing skills that need adaptation for this stack>

## Identified Gaps — Prioritized

### Critical (Priority 8-10) — Implement Immediately

| # | Skill | Category | Priority | Justification |
|---|-------|----------|----------|---------------|
<critical gaps>

### Important (Priority 5-7) — Implement This Quarter

| # | Skill | Category | Priority | Justification |
|---|-------|----------|----------|---------------|
<important gaps>

### Nice-to-Have (Priority 1-4) — Backlog

| # | Skill | Category | Priority | Justification |
|---|-------|----------|----------|---------------|
<nice-to-have gaps>

## Stack-Specific Gaps

<gaps specific to the technologies used by this codebase>

## Governance Gaps (Multi-Codebase)

<gaps relevant to managing this codebase as part of a portfolio>

## Recommended Implementation Order

Based on priority scores and dependency between skills:

1. <highest priority skill> — <one-line reason>
2. <next priority> — <one-line reason>
...

## Coverage Summary

| Category | Total Expected | Existing | Gaps | Coverage |
|----------|---------------|----------|------|----------|
| Code Quality | N | N | N | X% |
| Security | N | N | N | X% |
| Testing | N | N | N | X% |
| Documentation | N | N | N | X% |
| DevOps | N | N | N | X% |
| Data & Database | N | N | N | X% |
| Maintenance | N | N | N | X% |
| Stack-Specific | N | N | N | X% |
| **TOTAL** | **N** | **N** | **N** | **X%** |
```

---

## Phase 5 — Generate Draft Skills (full mode only)

For the **top 5 priority gaps**, generate a complete draft SKILL.md ready to install.

### 5.1 Draft Skill Template

Each draft must follow this structure:

```markdown
---
name: <skill-name>
description: <one-line description>
argument-hint: "<usage hint>"
allowed-tools: <list of tools the skill needs>
---

# <Skill Title>

<What this skill does and when to use it>

## Scope
<What it analyzes, what it produces>

## Phase 1 — Discovery
<How to find the relevant code>

## Phase 2 — Analysis
<What checks to perform, what patterns to look for>

## Phase 3 — Report
<What to output, in what format>

## Output Format
<The structure of the report/output this skill generates>
```

### 5.2 Stack-Aware Drafts

Each draft MUST be tailored to this codebase's actual stack:
- Use the correct grep patterns for the detected language/framework
- Reference the actual file patterns found in this codebase
- Use the ORM/framework-specific terminology
- Include patterns for the actual CI/CD platform in use

Do NOT generate generic/placeholder patterns. Every grep pattern and file glob in the draft should work on THIS codebase.

### 5.3 Write Drafts

Write each draft skill to: `docs/skill-drafts/<skill-name>/SKILL.md`

These are drafts for human review — they should be functional but marked as drafts:

```markdown
> **DRAFT** — Generated by skill-gap-analyzer on <date>.
> Review and customize before installing to `.claude/skills/`.
```

---

## Phase 6 — Setup Script Update Recommendation

Generate a recommended update to `setup.sh` that includes the new skills:

**File: `docs/skill-gap-report.md`** (appended)

```markdown
## Setup Script Update

To install the recommended new skills, add these to the SKILLS array in `setup.sh`:

\`\`\`bash
SKILLS=(
  # ... existing skills ...

  # NEW — Recommended by skill-gap-analyzer on <date>
  "<skill-1>"   # <category> — Priority <N>
  "<skill-2>"   # <category> — Priority <N>
  ...
)
\`\`\`

And add to the output help text:

\`\`\`
echo ""
echo "NEW SKILLS:"
echo "  /<skill-1>    <description>"
echo "  /<skill-2>    <description>"
\`\`\`
```

---

## Phase 7 — Cross-Codebase Comparison (if multiple codebases available)

If there are multiple codebases available (monorepo packages, sibling repos), compare skill coverage:

```markdown
## Cross-Codebase Skill Coverage Matrix

| Skill | Repo A | Repo B | Repo C | Standard? |
|-------|--------|--------|--------|-----------|
| /review | Yes | Yes | No | REQUIRED |
| /security-audit | Yes | No | No | REQUIRED |
| /graphql-review | N/A | Yes | N/A | CONDITIONAL |

## Standardization Recommendations

Skills that should be mandatory across ALL codebases:
1. <skill> — <reason>
2. <skill> — <reason>

Skills that should be conditional (stack-dependent):
1. <skill> — only for codebases using <technology>
```

If only one codebase is available, skip this phase and note:
> "Cross-codebase comparison skipped — single codebase analyzed. Re-run this skill across your other repositories and compare the reports to identify standardization opportunities."

---

## Output Summary

When complete, present:

1. **Codebase profile** — tech stack, architecture, domain, size
2. **Existing skills** — what's installed and whether it's compatible
3. **Gaps found** — categorized and prioritized with scores
4. **Top recommendations** — ordered implementation plan
5. **Draft skills** (full mode) — ready-to-review SKILL.md files
6. **Coverage percentage** — overall and by category
7. **Cross-codebase notes** — standardization opportunities

All output goes to `docs/skill-gap-report.md` and `docs/skill-drafts/` (for full mode).

---

## Notes for Multi-Codebase Governance

This skill is designed to be run on every codebase in your portfolio. The workflow:

1. Run `/skill-gap-analyzer full` on each codebase
2. Collect all `docs/skill-gap-report.md` files
3. Compare coverage matrices across repos
4. Identify the minimum standard skill set (skills every repo must have)
5. Identify conditional skills (per-stack, per-domain)
6. Create an org-level `skills-standard.yml` defining required vs. optional skills
7. Use this skill periodically (quarterly) to audit compliance

This gives you a standardized governance framework that scales across acquisitions, new projects, and team changes — without mandating a specific tech stack.
