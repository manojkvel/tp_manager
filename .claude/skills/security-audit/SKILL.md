---
name: security-audit
description: Security vulnerability scan of code changes or a specific module
allowed-tools: Read, Write, Grep, Glob, Bash(git diff, git log, git show, npm audit, pip audit, cargo audit, bundle audit, govulncheck, semgrep, gitleaks, trufflehog, ls, mkdir, date)
---

# Security Audit (Fast)

Quick security scan intended as a per-PR gate. Completes in ~5 minutes. For release-gate / monthly deep scans (IaC, container images, SBOM, CVSS, threat modeling), use `/security-audit-deep` instead.

## Step 1 — Scope

**This is a full-repo scan.** All scanners (semgrep, gitleaks, dependency audits, grep patterns, Dockerfile checks) run against the entire repository — not against a diff or subset of files. Dependencies, secrets, and access control are global concerns: partial scanning would produce false-cleans.

`$ARGUMENTS` is optional and affects only:
- **Report filename** — the passed value becomes the scope label (e.g., `auth-module`, `pr-123`). If omitted, the label is `full`.
- **Finding prioritization** — findings under paths matching `$ARGUMENTS` are listed first in the report; everything else follows.

**Suppression**: skip lines containing `# security-audit: ignore` and log them under "Suppressed Findings" with the stated reason.

### Shell Safety (read before running any commands)

File paths in real codebases often contain glob metacharacters — Next.js dynamic routes use `[id]` or `[...slug]`, grouped routes use `(auth)`, tests sometimes use `*`. Unquoted paths in shell loops fail in zsh with `no matches found: ...`.

When iterating over file paths produced by earlier commands:
- **Preferred** — null-delimited piping: `grep -rlZ "..." | while IFS= read -r -d '' f; do ...; done`
- **Alternative** — disable globbing first: `setopt noglob` (zsh) / `set -f` (bash), iterate, then re-enable
- **Simplest** — use the Read tool on specific paths instead of building a shell loop

Never write `for f in <path1> <path2> ...; do ... done` with paths that came from grep/find output — brackets, parens, and asterisks will break globbing. This applies to every step in this skill that inspects individual files (auth coverage cross-check, RBAC completeness, IDOR scan, secret pattern hits, etc.).

## Step 2 — Automated Scanners

Run each if available; otherwise note "not available" and fall back to grep.

```bash
# AST-aware, taint-tracking — replaces brittle greps for injection/XSS/redirects
semgrep --config=p/owasp-top-ten --json 2>/dev/null || echo "semgrep unavailable"

# Secret scanning with git history
gitleaks detect --source . --report-format json 2>/dev/null || \
  trufflehog filesystem . --json 2>/dev/null || echo "gitleaks/trufflehog unavailable"

# Dependency vulnerabilities (run all that apply)
[ -f package.json ]     && npm audit --json 2>/dev/null
[ -f requirements.txt ] && pip audit --format json 2>/dev/null
[ -f go.mod ]           && govulncheck ./... 2>/dev/null
[ -f Cargo.toml ]       && cargo audit --json 2>/dev/null
[ -f Gemfile ]          && bundle audit check --update 2>/dev/null
```

Flag all **critical** and **high** findings from scanner output.

## Step 3 — Targeted Checks

Tag each finding with its OWASP Top 10 **current-edition** code. Sections below use the **2025 ordering** (8th edition, published Nov 2025 as RC; stable content). Semgrep's `p/owasp-top-ten` rule pack auto-tracks whatever OWASP has currently published — print the pack version used at scan time and stamp the report with it. If the pack predates 2025, category ordering shifts but the substantive checks are identical.

### A01:2025 — Broken Access Control

In 2025 this category **absorbed SSRF** (formerly A10:2021) and remains #1.

Mechanized auth-coverage check:
```bash
# Route handler files
grep -rln "export async function GET\|export async function POST\|export async function PUT\|export async function DELETE\|router\.\(get\|post\|put\|delete\|patch\)" \
  app/api/ src/routes/ routes/ --include="*.ts" --include="*.js" --include="*.py" 2>/dev/null

# Route files missing auth middleware
grep -rLn "verifyAndDecode\|getServerSession\|requireAuth\|withAuth\|authenticate\|@login_required\|jwt_required" \
  app/api/ src/routes/ routes/ --include="*.ts" --include="*.js" --include="*.py" 2>/dev/null
```
Files in the first set but not protected by any auth pattern → report directly as unauthenticated.

**IDOR**: flag `req.params.id` / `params.id` queries that don't cross-check against the authenticated user's ID.

**SSRF candidates** (moved into A01 in 2025):
```bash
grep -rn "fetch(\|axios\.\|requests\.get(\|urllib\.request" --include="*.ts" --include="*.js" --include="*.py" | \
  grep -v "process\.env\|config\.\|ALLOWED_HOSTS\|allowlist"
```
Check webhooks, URL-preview fetchers, PDF/image generators especially.

### A02:2025 — Security Misconfiguration

Promoted from #5 (A05:2021) to #2 in 2025 — misconfig is now the second most common application risk.

```bash
# Dockerfile quick checks
grep -n "USER root\|ARG.*\(PASSWORD\|SECRET\|TOKEN\)\|ENV.*\(PASSWORD\|SECRET\)\|FROM.*:latest\b" Dockerfile* 2>/dev/null
grep -n "^USER " Dockerfile* 2>/dev/null || echo "WARNING: Dockerfile has no USER directive — container runs as root"

# Framework misconfig
grep -rn "eslint.*ignoreDuringBuilds.*true\|typescript.*ignoreBuildErrors.*true" next.config.* 2>/dev/null

# .gitignore completeness
for p in ".env" "*.pem" "*.key" "secrets/" "credentials.json"; do
  grep -q "$p" .gitignore 2>/dev/null || echo "WARNING: $p not in .gitignore"
done

# Debug flags leaked
grep -rn "DEBUG\s*=\s*[Tt]rue\|FLASK_DEBUG\s*=\s*1" --include="*.ts" --include="*.js" --include="*.py" --include="*.env*" | grep -v ".env.example"
```

> Deep skill covers IaC (tfsec/checkov/kubesec) and built-container (trivy/grype) scanning.

### A03:2025 — Software Supply Chain Failures

**New category name and scope in 2025** — supersedes A06:2021 "Vulnerable and Outdated Components" and is **broader**: covers build integrity, package registries, maintainer account security, CI/CD, and artifact signing, not just dependency CVEs.

Dependency CVEs are covered by Step 2 scanners. Additionally:
```bash
# Lock files must be committed
for lock in package-lock.json yarn.lock pnpm-lock.yaml Pipfile.lock poetry.lock Cargo.lock Gemfile.lock go.sum; do
  [ -f "$lock" ] && ! git ls-files --error-unmatch "$lock" >/dev/null 2>&1 && echo "WARNING: $lock present but not committed"
done

# npm install (unpinned) vs npm ci in CI
grep -rn "npm install\b" .github/ .gitlab-ci.yml Jenkinsfile 2>/dev/null

# pip install without --require-hashes in CI
grep -rn "pip install" .github/ .gitlab-ci.yml Jenkinsfile 2>/dev/null | grep -v "require-hashes"
```
Also verify: SHA-pinned GitHub Actions (see A08), signed releases, package provenance (npm provenance / PEP 740 / Sigstore).

### A04:2025 — Cryptographic Failures

(Was A02:2021.)

- Deprecated: `md5(`, `sha1(`, `hashlib.md5`, `DES`, `RC4`
- Insecure RNG for secrets: `Math.random()`, `random.random()` — require `crypto.randomBytes` / `secrets.token_bytes`
- Password hashing must be bcrypt/argon2/scrypt

### A05:2025 — Injection

(Was A03:2021.)

```bash
# SQL concat
grep -rn "query.*+\|execute.*%\|f\"SELECT\|f'SELECT\|\.format.*SELECT" --include="*.py" --include="*.ts" --include="*.js"
# Command exec
grep -rn "exec(\|eval(\|subprocess\.call(\|shell=True\|child_process\.exec\|execSync(" --include="*.py" --include="*.ts" --include="*.js"
# Deserialization
grep -rn "pickle\.loads\|yaml\.load([^,)]*)\|marshal\.loads\|unserialize(" --include="*.py" --include="*.ts" --include="*.js" --include="*.php"
```

### A06:2025 — Insecure Design

(Was A04:2021.)

```bash
# Open redirect
grep -rn "res\.redirect(\|redirect(\|location\.href\s*=" --include="*.ts" --include="*.js" | \
  grep -v "\/\|localhost\|process\.env\|config\."
```

### A07:2025 — Authentication Failures

(Renamed from A07:2021 "Identification and Authentication Failures".)

Search: `verify=False`, `algorithms=["none"]`, `ignoreExpiration: true`. Flag any JWT verification without `exp`/`iss`/`aud` checks.

### A08:2025 — Software or Data Integrity Failures

(Was A08:2021, slight rename.)

```bash
# Curl-pipe-bash in CI
grep -rn "curl.*|\s*sh\|wget.*|\s*bash\|bash <(curl" .github/ .gitlab-ci.yml Jenkinsfile 2>/dev/null
# GitHub Actions pinned to mutable tags (not SHA)
grep -rn "uses:.*@[^0-9a-f]" .github/workflows/ 2>/dev/null | grep -v "#.*sha"
```

### A09:2025 — Security Logging and Alerting Failures

(Was A09:2021; **"Monitoring" → "Alerting"** in 2025 — the emphasis shifted from passive collection to active alerting on security events.)

```bash
# Secrets in logs
grep -rn "console\.log\|logger\.\(info\|debug\|error\)" --include="*.ts" --include="*.js" | \
  grep -i "password\|token\|secret\|ssn\|credit"
```
Additionally flag: missing alert triggers for auth-failure spikes, absent log retention policy, unsigned audit logs (no cryptographic tamper-evidence).

### A10:2025 — Mishandling of Exceptional Conditions

**New category in 2025** — error-handling paths that leak state, crash unpredictably, or fail open. The 2021 A10 (SSRF) moved into A01.

```bash
# Bare except / catch swallowing errors
grep -rn "except:\|except Exception:\|} *catch *(.*) *{" --include="*.py" --include="*.ts" --include="*.js"
# Error responses leaking internals (stack traces, SQL errors, file paths)
grep -rn "res\.\(status\|send\|json\).*\(err\|error\|e\)\.\(message\|stack\|toString\)" --include="*.ts" --include="*.js"
grep -rn "return.*\(traceback\|sys\.exc_info\|format_exc\)" --include="*.py"
# Fail-open patterns on auth/authz paths (catch → allow)
grep -rn "catch.*{\s*\(next()\|return\s*true\|allow\|proceed\)" --include="*.ts" --include="*.js"
# Panic/unwrap/log.Fatal on user-input paths (Go/Rust)
grep -rn "\.unwrap()\|\.expect(\|panic!\|log\.Fatal" --include="*.go" --include="*.rs"
```
Flag: error responses returning stack traces or SQL errors, catch-all blocks that silently succeed after auth failure, panic-on-error in untrusted input paths, middleware that lets requests through when the auth check throws.

### Hardcoded Secrets (cross-cutting)

```bash
grep -rn \
  -e "password\s*=\s*[\"'][^\"']\+[\"']" \
  -e "api_key\s*=\s*[\"'][^\"']\+[\"']" \
  -e "AKIA[0-9A-Z]\{16\}" \
  -e "sk-[a-zA-Z0-9]\{48\}" \
  -e "ghp_[a-zA-Z0-9]\{36\}" \
  -e "ghs_[a-zA-Z0-9]\{36\}" \
  -e "xox[baprs]-[0-9a-zA-Z-]\+" \
  -e "-----BEGIN \(RSA\|EC\|OPENSSH\) PRIVATE KEY-----" \
  -e "eyJ[a-zA-Z0-9_-]\{10,\}\.[a-zA-Z0-9_-]\{10,\}" \
  --include="*.ts" --include="*.js" --include="*.py" --include="*.env" \
  --exclude="*.env.example" --exclude="*.test.*" --exclude="*.spec.*" . 2>/dev/null

# .env committed to git history
git log --all --full-history -- "**/.env" ".env" 2>/dev/null | head -5
```

## Step 4 — Output

### Vulnerability Summary

The at-a-glance view — one row per finding, sorted by severity (Critical → Low), then by OWASP code. This table is the first thing in the report. Full details for each finding are in the Findings section further down.

| # | Severity | OWASP | File | Issue (brief) | Effort |
|---|----------|-------|------|---------------|--------|
| 1 | CRITICAL | A05:2025 | `routes/users.py:45` | String concat into SQL query | Low |
| 2 | HIGH     | A01:2025 | `app/api/orders/route.ts:22` | Unauthenticated endpoint | Low |
| 3 | HIGH     | A07:2025 | `auth/jwt.ts:18` | `algorithms:["none"]` accepted | Low |
| … | …        | …     | …    | …             | …      |

If no findings: render a single row `| — | NONE | — | — | No vulnerabilities detected | — |`.

### Risk Summary
| Severity | Count |
|----------|-------|
| Critical | N |
| High     | N |
| Medium   | N |
| Low      | N |

### Findings (detailed)
For each row in the Vulnerability Summary above, expand with full context:
```
[CRITICAL|HIGH|MEDIUM|LOW] <OWASP-Code> — <Category>
File: <path>:<line>
Issue: <what's wrong>
Impact: <exploit consequence>
Fix: <specific remediation with code example>
Effort: Low | Medium | High
```

Effort: Low = config change/one-liner; Medium = 1–3 file refactor; High = architectural.

### Dependency Report
Vulnerable deps with CVE, severity, recommended version.

### Suppressed Findings
`# security-audit: ignore` annotations with file, line, reason.

### Gate Result
```
AUDIT RESULT: [PASSED | FAILED]
Critical: N  High: N
```

If `critical > 0` OR `high > 3`:
```
⛔ AUDIT FAILED — blocks merge/deploy.
```
CI should treat this banner as the block signal.

### When to Escalate
Recommend running `/security-audit-deep` when any of these apply:
- Release candidate or tagged version
- Changes touch auth, payment, or PII handling
- Dockerfile/IaC/infra changes present
- Monthly compliance cadence
- `high > 3` in this fast scan

## Step 5 — Save Report

```bash
mkdir -p reports
DATE=$(date +%Y-%m-%d)
TIME=$(date +%H%M%S)
```

Save to `reports/security-audit-<scope>-<DATE>-<TIME>.md`. If `$ARGUMENTS` was not provided, the scope label is `full`.

**Naming examples:**
- `reports/security-audit-full-2026-04-16-143052.md`
- `reports/security-audit-auth-module-2026-04-16-150715.md`
- `reports/security-audit-pr-123-2026-04-16-153241.md`

The timestamp prevents multiple runs on the same day from overwriting each other.

Include YAML front-matter: `date`, `time`, `scope`, `critical_count`, `high_count`, `gate_result`, `scan_depth: fast`.

Print the saved path.
