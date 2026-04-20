# ADR 0006 — JWT-only API + httpOnly refresh cookie

- **Status:** Accepted
- **Date:** 2026-04-17
- **Traces to:** Plan AD-6, spec §6.13

## Context

The PWA lives on the same apex as the API in prod (via Front Door routing). We need session auth
that: works offline-first (long-lived PWA), is XSS-safe (no access tokens in localStorage), allows
short access-token lifetimes, and has a clear logout path.

## Decision

- Access token: JWT, 15 min expiry, kept in memory only in the SPA.
- Refresh token: opaque, rotated on every use, stored in an httpOnly + Secure + SameSite=Strict
  cookie scoped to `/api/v1/auth`.
- All API routes accept `Authorization: Bearer <jwt>`; server-side role guard (TASK-030) enforces
  RBAC per route.
- Passwords hashed with argon2id (`memoryCost=19456, timeCost=2, parallelism=1`) per OWASP 2024.
- Login rate-limited to 5/min/IP with exponential backoff (returns 429 beyond limit).

## Alternatives considered

- **Session cookies only:** Rejected — breaks the future mobile client path (spec §10).
- **OAuth/SSO (Azure AD B2C):** Deferred — useful when owner invites staff accounts at scale; not
  worth the setup for a single-tenant MVP.

## Consequences

- + Same auth surface for PWA + future mobile clients.
- + Rotated refresh tokens limit replay window to ≤ 1 use.
- − Logout requires clearing the refresh cookie server-side; handled in `/auth/logout`.
