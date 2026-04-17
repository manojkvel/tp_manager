---
name: onboarding-guide
description: Auto-generate a \"how this codebase works\" guide for new team members
argument-hint: "['full'|module-path]"
allowed-tools: Read, Write, Grep, Glob, Bash(git log, git shortlog, ls, wc, cat)
---

# Onboarding Guide Generator

Generate a comprehensive guide that helps a new team member understand and navigate this codebase.

## Step 1 — Project Overview

### Discover the basics
1. Read `README.md`, `CONTRIBUTING.md`, `CLAUDE.md` if they exist
2. Read `package.json` and/or `pyproject.toml` / `setup.py` for project metadata
3. Check for a `Makefile`, `Taskfile`, `justfile`, or `scripts/` directory for common commands
4. Read `docker-compose.yml` or `Dockerfile` if present

### Determine the tech stack
Scan dependency files to identify:
- Web framework (FastAPI, Django, Express, Nest.js, Next.js, etc.)
- Database (PostgreSQL, MongoDB, Redis, etc.)
- ORM (SQLAlchemy, Prisma, TypeORM, Django ORM, etc.)
- Testing framework (pytest, Jest, Vitest, etc.)
- CI/CD (GitHub Actions, GitLab CI, etc.)
- Infrastructure (Docker, K8s, AWS, GCP, etc.)

## Step 2 — Architecture Map

### Directory structure
Run `ls` on the top-level and key subdirectories. Document what each directory contains.

### Request flow
Trace how a typical request flows through the system:
1. Entry point (main app file, server bootstrap)
2. Routing layer (where routes are defined)
3. Middleware (auth, logging, error handling)
4. Handlers/Controllers (request processing)
5. Service layer (business logic)
6. Data layer (database access, external APIs)
7. Response (serialization, error formatting)

### Key abstractions
Identify the most important classes, interfaces, and patterns:
- Base classes that others extend
- Shared middleware or decorators
- Common utility functions
- Configuration management approach

## Step 3 — Getting Started

### Setup steps
Infer from the codebase what a developer needs to do:
1. Check for `.env.example` or `.env.template` → environment variables needed
2. Check for database migration files → how to set up the database
3. Check `package.json` scripts or `Makefile` targets → common commands
4. Check for seed data or fixtures → how to populate test data

### Common commands
Extract from `package.json` scripts, `Makefile`, or `Taskfile`:
- How to install dependencies
- How to run the dev server
- How to run tests
- How to run linting/formatting
- How to run database migrations
- How to build for production

## Step 4 — Key Files Tour

Identify the 10-15 most important files a new developer should read first:

For each file:
1. **Path** — where it is
2. **Purpose** — what it does in one sentence
3. **Why it matters** — why a new dev should understand it
4. **Key patterns** — what conventions or patterns it establishes

Prioritize files by:
- Entry points and configuration
- Core business logic
- Shared utilities and base classes
- Auth and middleware
- Most frequently changed files (from git log)

## Step 5 — Team & Conventions

### Code ownership
Run `git shortlog -sn --no-merges | head -10` to show top contributors.

### Coding conventions
Infer from the code:
- Naming conventions (camelCase, snake_case, PascalCase for what?)
- File organization patterns (one class per file? feature folders?)
- Import ordering conventions
- Error handling patterns
- Logging patterns

### PR & review process
Check for:
- `.github/PULL_REQUEST_TEMPLATE.md`
- `.github/CODEOWNERS`
- Branch protection rules (inferred from branch naming)
- CI/CD pipeline configuration

## Step 6 — Common Patterns & Recipes

Document how to do common tasks by finding examples in the codebase:

1. **Add a new API endpoint** — find the simplest existing endpoint and document the pattern
2. **Add a new database model** — find an existing model and document the pattern
3. **Write a test** — find a representative test and document the pattern
4. **Add middleware** — show how existing middleware is structured
5. **Handle errors** — show the project's error handling approach

For each recipe, reference a specific file as the "template to copy."

## Step 7 — Write the Guide

Generate a well-structured markdown document:

```markdown
# [Project Name] — Developer Onboarding Guide

## What This Project Does
<overview paragraph>

## Tech Stack
<list of key technologies and why they were chosen>

## Architecture
<directory map and request flow diagram>

## Getting Started
<step-by-step setup instructions>

## Key Files to Read First
<prioritized list with explanations>

## Common Patterns
<how to add endpoints, models, tests>

## Team & Conventions
<coding standards, PR process, who to ask>

## Useful Commands
<cheat sheet of common commands>

## Glossary
<project-specific terms and domain concepts>
```

Save the guide to `docs/ONBOARDING.md` (or `$ARGUMENTS` if a custom path is specified).

## Step 8 — Verify

- Ensure all referenced files actually exist
- Verify that commands listed actually exist in package.json/Makefile
- Check that the setup steps are in logical order
- Confirm the guide doesn't reference internal secrets or credentials
