# Project: [Your Project Name]

## Overview
[One paragraph describing what this project does.]

## Tech Stack
- **Backend**: [Python / TypeScript / Go / etc.]
- **Testing**: [pytest / Vitest / Jest / etc.]
- **Database**: [PostgreSQL / MongoDB / etc.]
- **Infrastructure**: [Docker / K8s / AWS / etc.]

## Project Structure
```
src/
├── api/          # API route handlers
├── services/     # Business logic
├── models/       # Database models / schemas
├── middleware/    # Auth, logging, error handling
├── utils/        # Shared utilities
└── types/        # Type definitions
tests/
├── unit/
├── integration/
└── fixtures/
```

## Coding Standards

### General
- All functions must have type annotations
- Maximum file length: 400 lines (split if larger)
- Use descriptive variable names

### API Conventions
- RESTful endpoints: `GET /resources`, `POST /resources`, `GET /resources/:id`
- All responses wrapped in: `{ "data": ..., "error": null }`
- Pagination via `?limit=N&offset=M`

### Security Requirements
- All endpoints require authentication unless explicitly marked public
- Input validation on every endpoint
- No secrets in code — use environment variables
- SQL queries must use parameterized statements

### Testing Requirements
- All new features require unit tests
- Critical paths require integration tests
- Test names describe the behavior: `test_returns_404_when_user_not_found`

## Git Conventions
- Commit messages: `type(scope): description`
- Types: feat, fix, refactor, test, docs, chore, perf, security
- PRs require at least one review before merge
