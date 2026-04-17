---
name: security-audit-deep
description: Deep security audit for release gates and monthly compliance — IaC, container image, SBOM, CVSS, compliance, threat model
allowed-tools: Read, Write, Grep, Glob, Bash(git diff, git log, git show, npm audit, pip audit, cargo audit, bundle audit, govulncheck, mvn, semgrep, bandit, gosec, brakeman, gitleaks, trufflehog, tfsec, checkov, kubesec, trivy, grype, syft, docker, testssl.sh, nmap, curl, ls, mkdir, find, xargs, awk, stat, date)
---

# Security Audit (Deep)

Full-depth security audit for release gates, monthly compliance cadence, or post-incident review. Runs in ~15–25 minutes depending on repo size. For per-PR fast scans, use `/security-audit` instead.

This skill includes everything in the fast variant **plus**: IaC scanning, built-container image scanning (Trivy/Grype), SBOM generation, live runtime checks, CSP strength analysis, OAuth flow review, business-logic vulnerability checks (path traversal / mass assignment / ReDoS / timing attacks / TOCTOU), CWE + CVSS scoring, SARIF output, compliance mapping (PCI-DSS / HIPAA / SOC2 / GDPR), and a STRIDE threat-model prompt.

## Step 1 — Scope

**This is a full-repo scan.** All scanners (SAST suite, gitleaks with git history, dependency audits across all ecosystems, IaC scanners, container image scanners, SBOM generator, live runtime checks) run against the entire repository. Dependencies, secrets, access control, IaC, and container layers are all global concerns: partial scanning would produce false-cleans.

`$ARGUMENTS` is optional and affects only:
- **Report filename** — the passed value becomes the scope label (e.g., `release-v2.3`, `quarterly-audit`, `post-incident`). If omitted, the label is `full`.
- **Finding prioritization** — findings under paths matching `$ARGUMENTS` are listed first in the report; everything else follows.

Record the scope label and `scan_depth: deep` for the report front-matter.

**Suppression**: skip lines containing `# security-audit: ignore` with a reason; log all suppressions.

### Shell Safety (read before running any commands)

File paths in real codebases often contain glob metacharacters — Next.js dynamic routes use `[id]` or `[...slug]`, grouped routes use `(auth)`, tests sometimes use `*`. Unquoted paths in shell loops fail in zsh with `no matches found: ...`.

When iterating over file paths produced by earlier commands:
- **Preferred** — null-delimited piping: `grep -rlZ "..." | while IFS= read -r -d '' f; do ...; done`
- **Alternative** — disable globbing first: `setopt noglob` (zsh) / `set -f` (bash), iterate, then re-enable
- **Simplest** — use the Read tool on specific paths instead of building a shell loop

Never write `for f in <path1> <path2> ...; do ... done` with paths that came from grep/find output — brackets, parens, and asterisks will break globbing. This applies to every step that inspects individual files (auth coverage cross-check, RBAC completeness, IDOR scan, kubesec per-manifest iteration, secret pattern hits, etc.).

## Step 2 — Run Full Scanner Suite

### Pre-Flight: Verify Scanner DB Freshness

Stale vulnerability databases produce silent false-cleans — a report showing "no critical issues" when the underlying data is 6 months old is worse than no report. Run this check **before** the scanner suite and abort if any offline DB is >7 days old. This fails fast and saves the ~100K tokens the downstream scanners would have burned producing a degraded report.

```bash
mkdir -p .audit
{
  echo "## Scanner DB Status"
  echo ""
  echo "| Tool | DB Built | Age (days) | Status |"
  echo "|------|----------|------------|--------|"

  STALE_COUNT=0
  THRESHOLD=7

  check_age() {
    local tool="$1" built="$2"
    local now_s built_s age
    now_s=$(date +%s)
    built_s=$(date -j -f "%Y-%m-%d" "$built" +%s 2>/dev/null || date -d "$built" +%s 2>/dev/null)
    age=$(( (now_s - built_s) / 86400 ))
    if [ "$age" -gt "$THRESHOLD" ]; then
      echo "| $tool | $built | $age | ⚠ STALE |"
      STALE_COUNT=$((STALE_COUNT + 1))
    else
      echo "| $tool | $built | $age | ✓ Fresh |"
    fi
  }

  # Trivy (refresh first, then check cached DB)
  trivy image --download-db-only 2>/dev/null
  TRIVY_DB=$(ls -t ~/Library/Caches/trivy/db/trivy.db ~/.cache/trivy/db/trivy.db 2>/dev/null | head -1)
  if [ -n "$TRIVY_DB" ]; then
    BUILT=$(stat -f %Sm -t %Y-%m-%d "$TRIVY_DB" 2>/dev/null || stat -c %y "$TRIVY_DB" 2>/dev/null | cut -d' ' -f1)
    check_age "trivy" "$BUILT"
  fi

  # Grype
  grype db update >/dev/null 2>&1
  BUILT=$(grype db status 2>/dev/null | grep "Built:" | awk '{print $2}' | cut -dT -f1)
  [ -n "$BUILT" ] && check_age "grype" "$BUILT"

  # cargo audit (git advisory db)
  if [ -d ~/.cargo/advisory-db ]; then
    BUILT=$(cd ~/.cargo/advisory-db && git log -1 --format=%cs 2>/dev/null)
    [ -n "$BUILT" ] && check_age "cargo-audit" "$BUILT"
  fi

  # bundler-audit (git advisory db)
  if [ -d ~/.local/share/ruby-advisory-db ]; then
    BUILT=$(cd ~/.local/share/ruby-advisory-db && git log -1 --format=%cs 2>/dev/null)
    [ -n "$BUILT" ] && check_age "bundler-audit" "$BUILT"
  fi

  # Live-query scanners are always fresh
  echo "| npm-audit | live query | 0 | ✓ Fresh (live) |"
  echo "| pip-audit | live query | 0 | ✓ Fresh (live) |"
  echo "| govulncheck | live query | 0 | ✓ Fresh (live) |"

  echo ""
  echo "Stale DBs: $STALE_COUNT (threshold: $THRESHOLD days)"
} > .audit/db-status.md

cat .audit/db-status.md
```

**Staleness gate**: if `STALE_COUNT > 0`, abort the scan with:
```
⛔ SCANNER DB STALE — N database(s) older than 7 days.
Refresh with:
  trivy image --download-db-only
  grype db update
  bundle-audit update
  (cd ~/.cargo/advisory-db && git pull)
Scan aborted — re-run after refresh.
```
Record `gate_result: FAILED` and `failure_reason: stale_scanner_db` in the report front-matter. Do not proceed to the scanner suite below.

### Static application security testing (SAST)
```bash
semgrep --config=p/owasp-top-ten --config=p/security-audit --config=p/secrets --sarif > .audit/semgrep.sarif 2>/dev/null
# Language-specific (if installed)
bandit -r . -f json -o .audit/bandit.json 2>/dev/null      # Python
gosec -fmt=sarif -out=.audit/gosec.sarif ./... 2>/dev/null  # Go
brakeman -o .audit/brakeman.json 2>/dev/null                # Ruby on Rails
```

### Secret scanning (code + full git history)
```bash
gitleaks detect --source . --report-format sarif --report-path .audit/gitleaks.sarif 2>/dev/null
trufflehog git file://. --json > .audit/trufflehog.json 2>/dev/null
```

### Dependency / SCA (all ecosystems)
```bash
[ -f package.json ]     && npm audit --json > .audit/npm-audit.json 2>/dev/null
[ -f requirements.txt ] && pip audit --format json > .audit/pip-audit.json 2>/dev/null
[ -f go.mod ]           && govulncheck -json ./... > .audit/govuln.json 2>/dev/null
[ -f Cargo.toml ]       && cargo audit --json > .audit/cargo-audit.json 2>/dev/null
[ -f Gemfile ]          && bundle audit check --update > .audit/bundle-audit.txt 2>/dev/null
[ -f pom.xml ]          && mvn -q org.owasp:dependency-check-maven:check 2>/dev/null
```

### Infrastructure as Code
```bash
# Terraform
tfsec . --format json > .audit/tfsec.json 2>/dev/null || echo "tfsec unavailable"
# Multi-IaC (Terraform, CloudFormation, K8s, Dockerfile, ARM, etc.)
checkov -d . --output sarif --output-file .audit/checkov.sarif 2>/dev/null || echo "checkov unavailable"
# Kubernetes manifests
find . -name "*.yaml" -o -name "*.yml" | xargs -I{} kubesec scan {} 2>/dev/null > .audit/kubesec.txt
```

### Built-container image scanning
If a Dockerfile is present and an image has been built:
```bash
IMAGE=$(grep -m1 "^FROM " Dockerfile | awk '{print $2}')
trivy image --format sarif --output .audit/trivy-base.sarif "$IMAGE" 2>/dev/null || echo "trivy unavailable"

# Scan built local image (if any)
LOCAL_IMG=$(docker images --format "{{.Repository}}:{{.Tag}}" | head -1)
[ -n "$LOCAL_IMG" ] && trivy image --format sarif --output .audit/trivy-local.sarif "$LOCAL_IMG" 2>/dev/null

# Alternative: Grype
grype . -o sarif > .audit/grype.sarif 2>/dev/null
```

Static Dockerfile grep alone misses CVEs in base-image layers and installed OS packages — always prefer Trivy/Grype for containers in the deep scan.

### SBOM generation
```bash
mkdir -p .audit
syft . -o cyclonedx-json > .audit/sbom.cyclonedx.json 2>/dev/null || \
  syft . -o spdx-json > .audit/sbom.spdx.json 2>/dev/null || \
  echo "syft unavailable — SBOM not generated"
```
Attach the SBOM to the report for EO 14028 / EU CRA compliance evidence.

## Step 3 — All 10 OWASP Categories (Deep, 2025 Edition)

Include everything from the fast skill's Step 3, plus the extended checks below. Section ordering follows **OWASP Top 10:2025** (8th edition, published Nov 2025). Every finding must carry: severity, OWASP Top 10 code with edition stamp (e.g., `A05:2025`), CWE ID, and a CVSS 3.1 base score. Print the exact rule-pack version used by semgrep into the report front-matter so findings remain auditable across edition changes.

### A01:2025 — Broken Access Control (extended)

Remains #1. In 2025 this category **absorbed SSRF** (formerly A10:2021 standalone).

Beyond mechanized auth + IDOR from fast:

**Mass assignment**
```bash
grep -rn "Object\.assign(.*req\.\(body\|query\|params\)\|{\.\.\.req\.body}\|User\.update(req\.body" \
  --include="*.ts" --include="*.js" --include="*.py"
```
Flag any direct spread of `req.body` into ORM updates without a field allowlist.

**HTTP verb tampering** — confirm routes explicitly reject unexpected methods (return 405), not silently fall through to a different handler.

**Path traversal**
```bash
grep -rn "fs\.\(read\|write\|unlink\|create\)\(File\|FileSync\)\(.*req\.\|.*params\.\|.*query\." \
  --include="*.ts" --include="*.js"
grep -rn "open(.*request\.\|open(.*input(" --include="*.py"
```
Flag any file ops on user input that lack `path.resolve()` + allowlist check.

**SSRF allowlist quality** — moved here from 2021 A10/A04. Beyond "is there an allowlist", verify it blocks:
- `169.254.0.0/16` (AWS/GCP/Azure metadata)
- `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (private ranges)
- `metadata.google.internal`, `metadata.aws.internal`, `169.254.169.254`
- IPv6 loopback `::1` and link-local `fe80::/10`

Verify: webhook callback URLs pre-validated against allowlist, PDF/image renderers run in sandboxed network namespace, URL-preview fetchers enforce redirect following limits and re-validate after each redirect (DNS rebinding defense).

### A02:2025 — Security Misconfiguration (extended)

**Promoted from #5 to #2 in 2025** — the single biggest ranking change this edition. Most real-world breaches start here.

**CSP strength** — beyond "is CSP configured":
```bash
grep -rn "Content-Security-Policy" --include="*.ts" --include="*.js" --include="*.conf" 2>/dev/null
```
Flag policies containing: `unsafe-inline`, `unsafe-eval`, `*` as source, missing `object-src 'none'`, missing `frame-ancestors`, missing `nonce`/`hash` for inline scripts.

**Permissions-Policy / Feature-Policy** — verify microphone/camera/geolocation/payment restrictions.

**X-Powered-By / Server headers** — flag if present (tech-stack disclosure).

**Cloud metadata exposure** — verify IMDSv2 (hop-limit=1, session-token required) on EC2; check Azure metadata endpoint access is restricted; GCP metadata flavor header enforced.

### A03:2025 — Software Supply Chain Failures (extended)

**New category name and broader scope in 2025** — supersedes A06:2021 "Vulnerable Components" with expanded coverage: build integrity, registries, maintainer accounts, CI/CD, and artifact signing.

**SBOM-driven analysis** (from Step 2 SBOM):
- License compliance cross-check (GPL in proprietary, AGPL anywhere, unknown licenses)
- Transitive dependency depth (deep trees hide risk)
- Abandoned packages (no release in >2 years)
- Typo-squat risk (packages with names very close to popular libs)
- Maintainer account churn — flag packages whose maintainer list changed in the last 90 days
- Package provenance — verify npm provenance / PEP 740 / Sigstore attestations where available

**Build pipeline integrity**:
- SLSA level (provenance, isolated builders, hermetic builds)
- Build caches that could be poisoned across PRs
- Ephemeral vs long-lived runners (long-lived = persistence risk)
- CI secret scope — does a prod-deploy key exist in feature-branch workflow context?
- `workflow_run` / `pull_request_target` triggers using untrusted PR contents

**Registry / package source**:
```bash
# Private packages pulled from public registry (confusion attack)
grep -rn "registry\|@internal/\|@company/" .npmrc package.json Pipfile pyproject.toml 2>/dev/null
# Unsigned commits in protected branches — requires repo-level check via gh API
```

### A04:2025 — Cryptographic Failures (extended)

(Was A02:2021.)

**Timing attacks** — secret comparison must be constant-time.
```bash
grep -rn "===.*\(token\|secret\|hmac\|signature\|api_key\)\|==.*\(token\|secret\|hmac\|signature\|api_key\)" \
  --include="*.ts" --include="*.js" --include="*.py"
```
Require `crypto.timingSafeEqual` / `hmac.compare_digest`.

**IV reuse / weak modes** — flag AES-ECB, static IVs, nonces from non-CSPRNG.

**Key management** — keys stored in plaintext config vs. HSM/KMS/vault; rotation policy documented.

**Post-quantum readiness** — flag hard dependencies on RSA-2048/ECDSA-P256 for long-lived data-at-rest encryption; note NIST PQC standards (ML-KEM, ML-DSA) as migration target.

### A05:2025 — Injection (extended)

(Was A03:2021. Now includes XSS per 2021 consolidation.)

**ReDoS (catastrophic backtracking)**
```bash
grep -rn "new RegExp(\|\.match(/\|\.test(/\|re\.compile(" --include="*.ts" --include="*.js" --include="*.py"
```
Review each regex for nested quantifiers (`(a+)+`, `(a*)*`, `(.*)+`) applied to user input. Cap input length before regex.

**XXE (XML External Entity)** — flag any XML parsing without `disable_entities`/`resolve_external=False`.

**LDAP injection** — string concatenation in `search_s` / `search()` calls.

**Template injection** (SSTI) — user input flowing into Jinja2 `Template()`, Handlebars `compile()`, ERB, etc.

**NoSQL injection** — user input in MongoDB `$where`, unsanitized objects reaching `find()` (`{user: req.body.user}` with operator pollution).

### A06:2025 — Insecure Design (extended)

(Was A04:2021. SSRF moved out of this category into A01:2025.)

**TOCTOU / race conditions** — check-then-act without locks:
- Balance checks before withdrawals
- Uniqueness checks before insert (use DB unique constraints, not pre-checks)
- Authorization checks separated from the action by async boundaries

**Business-logic flaws** — prompt review for:
- Negative quantities, integer overflow in pricing
- Coupon stacking / replay
- Workflow state-machine bypass
- Rate-limit bypass via parallel requests

**Abuse-case modeling** — threat-model the feature's misuse paths, not just its success path (covered in Step 5 STRIDE).

### A07:2025 — Authentication Failures (extended)

(Renamed from A07:2021 "Identification and Authentication Failures".)

**OAuth flow review**:
- Authorization Code flow with **PKCE** (code_challenge/verifier) — required for public clients
- `state` parameter validated on callback (CSRF defense)
- Redirect URI matched against allowlist (exact match, not substring)
- Refresh token rotation enabled
- ID token `aud` / `iss` / `nonce` validated

**Session management**:
- Absolute session timeout (e.g., 24h) + idle timeout (e.g., 30m)
- Session invalidation on password change
- Concurrent session limits where appropriate
- Session IDs regenerated after login (fixation defense)

**MFA coverage** — enforced for admins, sensitive actions, and high-risk logins.

**Passkey / WebAuthn adoption** — for new auth systems, flag password-only flows as a design smell in 2025.

### A08:2025 — Software or Data Integrity Failures (extended)

(Was A08:2021, slight rename.)

**GitHub Actions permissions**:
```bash
grep -rn "permissions:" .github/workflows/ 2>/dev/null
```
Flag workflows without an explicit `permissions:` block (default is write-all) or using `permissions: write-all`.

**Release signing** — verify tags are GPG-signed, container images are Cosign/Notary-signed, npm packages use provenance attestations.

**npm/pypi integrity** — verify `integrity=` SRI hashes in `package-lock.json`; verify `--require-hashes` in pip installs.

**Update mechanism integrity** — auto-update code paths must verify signature + version monotonicity (no downgrade attacks).

### A09:2025 — Security Logging and Alerting Failures (extended)

(Was A09:2021; **"Monitoring" renamed to "Alerting" in 2025** — the emphasis shifted from passive collection to active alerting on security events.)

- Audit log tamper-resistance: append-only storage, cryptographic signing, WORM/object-lock
- Security event coverage: login, logout, failed auth, privilege escalation, data export, admin actions, secret/config rotation
- PII scrubbing in logs
- Log retention meets compliance requirement (PCI: 1 year, HIPAA: 6 years, SOC2: 1 year minimum)

**Alerting thresholds** (the 2025 emphasis) — verify alerts fire on:
- Auth-failure spikes (>N failures per user per minute)
- New admin sessions / privilege escalations
- Data-exfiltration patterns (large response volume to single client)
- Config/secret rotation events
- Geographic anomalies (session from new country for a given user)

Alerts without a documented responder + SLA are logging, not alerting — call them out.

### A10:2025 — Mishandling of Exceptional Conditions (extended)

**New category in 2025** — error-handling paths that leak state, crash unpredictably, or fail open. The 2021 A10 (SSRF) moved into A01:2025.

**Fail-open on authn/authz paths**:
- Auth middleware that returns `allow` / `next()` inside catch blocks
- Rate limiters that return `allowed=true` when Redis is unavailable
- Feature flags that default to "on" when the flag service times out
- Policy engines (OPA/Cedar) that fail-open on evaluator errors

**State-revealing error responses**:
- Stack traces in 500 responses (production builds only — dev is fine)
- SQL error text echoed back (`duplicate key value violates unique constraint "users_email_key"`)
- File-not-found paths (`ENOENT: no such file or directory '/app/secrets/..'`)
- ORM errors exposing internal table/column names

**Panic-on-input**:
- Go: `log.Fatal`, `panic` on request-handler paths
- Rust: `.unwrap()`, `.expect()` on deserialized input
- Node: uncaught exceptions crashing the process (should be logged + 500, not crash)

**Transaction rollback correctness**:
- Payment / DB transactions that commit partial state on exception
- Missing `rollback()` in exception handlers
- `defer`/`finally` blocks that perform blocking network calls on the error path

**TOCTOU in error paths**:
- Cleanup/rollback that re-reads state instead of using a transaction snapshot
- Retry logic that re-authenticates as a different principal

```bash
# Fast-skill patterns carry over; plus:
grep -rn "BEGIN\|begin()\|startTransaction" --include="*.ts" --include="*.js" --include="*.py" -A 20 | grep -v "rollback\|ROLLBACK" | head -50
# Circuit breakers and fallbacks that silently return empty
grep -rn "\.catch(.*return\s*\[\]\|except.*return\s*\[\]\|except.*return\s*None" --include="*.ts" --include="*.js" --include="*.py"
```
Flag any silent empty-return in failure paths of data-retrieval code — empty results can cascade into incorrect authorization decisions downstream.

## Step 3B — OWASP Top 10 for Agentic Applications 2026

**Applicability gate**: run this step **only if the repository contains agentic-AI surface area**. Detect with:

```bash
# LLM SDKs and agent frameworks
grep -rln "anthropic\|openai\|langchain\|llama_index\|llamaindex\|autogen\|crewai\|semantic-kernel\|haystack\|dspy\|google-generativeai\|@ai-sdk\|vercel/ai" \
  --include="*.ts" --include="*.js" --include="*.py" package.json requirements.txt pyproject.toml 2>/dev/null
# MCP servers / tool registries / agent loop constructs
grep -rln "modelcontextprotocol\|@modelcontextprotocol\|MCPServer\|tool_use\|tool_choice\|function_calling\|AgentExecutor\|ReAct\|AgentLoop" \
  --include="*.ts" --include="*.js" --include="*.py" 2>/dev/null
# Vector DBs / RAG memory
grep -rln "pinecone\|weaviate\|qdrant\|chroma\|pgvector\|faiss\|milvus" --include="*.ts" --include="*.js" --include="*.py" 2>/dev/null
```

If none hit → note "No agentic surface detected; ASI checks skipped" in the report and move on. Otherwise work through the ten categories below. Tag findings with `ASI<NN>:2026` codes. Two principles cut across every category — **Least-Agency** (grant the smallest capability set the agent needs to complete its task) and **Strong Observability** (every tool call, memory read/write, and inter-agent message is logged with inputs, outputs, and decision rationale).

Reference: OWASP Top 10 for Agentic Applications 2026 (published Q1 2026).

### ASI01:2026 — Agent Goal Hijack (Prompt Injection)

Attacker-controlled text (user input, scraped web pages, retrieved documents, tool outputs, email bodies) overrides the agent's instructions or objective.

Checks:
- **Trust-boundary segregation** — system prompt, developer prompt, and untrusted content must be transported in distinct message roles or delimited channels. Flag any concatenation of user input directly into the system prompt string.
- **Indirect injection surface** — enumerate every place untrusted text enters the context: retrieved RAG chunks, tool result strings, web-scraped content, file uploads, email/Slack ingestion, image OCR. Each needs sanitization or quarantine.
- **Instruction-following guardrails** — check for spotlighting / delimiters / role tags around untrusted content (XML-style, `<untrusted>...</untrusted>`).

```bash
grep -rn "system.*=.*f[\"']\|system_prompt.*\+\|messages.*system.*user_input\|role.*system.*format(" \
  --include="*.ts" --include="*.js" --include="*.py"
grep -rn "retrieved.*\.content\|doc\.page_content\|rag_result" --include="*.ts" --include="*.js" --include="*.py" | \
  grep -v "sanitize\|escape\|spotlighting\|quarantine"
```

### ASI02:2026 — Tool Misuse and Exploitation

The agent is tricked into invoking legitimate tools for illegitimate ends (mass email, file deletion, expensive API spend, data exfiltration via allowed egress).

Checks:
- **Tool allowlist per agent role** — each agent/persona must have an explicit tool set. Flag agent definitions that attach the full registry.
- **Argument validation at the tool boundary** — tools must validate arguments (paths, URLs, recipient lists) with the same rigor as an HTTP endpoint. Schema-only validation is insufficient when the values are attacker-influenced.
- **Confirmation flow for destructive/expensive tools** — delete_file, send_email, run_sql, transfer_funds, spawn_subagent must require human-in-the-loop or a signed policy decision, not an LLM-approved confirmation.
- **Egress budget** — per-session caps on tool invocations, recipients per send, rows per query, dollars per API call.

```bash
# Tools registered without explicit per-agent allowlisting
grep -rn "tools=\[.*all_tools\|register_all\|load_all_tools\|tools:.*\*" --include="*.ts" --include="*.js" --include="*.py"
# Shell/file/network tools available to LLM-driven execution
grep -rn "ShellTool\|BashTool\|FileWriteTool\|HttpRequestTool\|SqlQueryTool" --include="*.ts" --include="*.js" --include="*.py"
```

### ASI03:2026 — Identity and Privilege Abuse

The agent runs under a single highly-privileged service principal and acts "on behalf of" users without re-auth or downscoping.

Checks:
- **Per-user credential propagation** — agent tool calls should carry the invoking user's identity (OAuth-on-behalf-of, STS AssumeRoleWithWebIdentity), not the agent's blanket credentials.
- **Scoped tokens** — short-lived, audience-bound tokens rather than long-lived admin keys in env vars.
- **Role assertion on each tool call** — authorization decisions at the tool gateway, not at the agent layer (agents are subject, not policy authority).
- **No blanket "agent user" with god-mode** — flag any `AGENT_ADMIN_TOKEN`, `OPENAI_API_KEY_ADMIN`, or similar.

```bash
grep -rn "AGENT_ADMIN\|SERVICE_ACCOUNT_TOKEN\|ROOT_API_KEY" --include="*.ts" --include="*.js" --include="*.py" --include="*.env*"
grep -rn "impersonate\|on_behalf_of\|sub=.*service" --include="*.ts" --include="*.js" --include="*.py"
```

### ASI04:2026 — Agentic Supply Chain Vulnerabilities

Plugins, MCP servers, prompt templates, model weights, and datasets are supply-chain artifacts with the same trust implications as npm packages — and often less scrutiny.

Checks:
- **MCP server inventory** — list every configured MCP server. For each, record: source URL, pinned version/SHA, publisher identity, permissions granted (file-system, network, credentials).
- **Unpinned / remote MCP servers** — any `mcp://…` URL without a hash or TLS pin is a live supply-chain hole.
- **Prompt-template provenance** — prompt files pulled from public registries (PromptHub, LangChain Hub) need version pinning and review.
- **Model-file integrity** — `.safetensors` / `.gguf` / `.bin` files loaded from Hugging Face must have verified SHA-256. Reject `torch.load()` / `pickle.load()` of model weights (arbitrary code execution).
- **Dataset lineage** — training / fine-tuning data sources documented; poisoning risk assessed for user-contributed data.

```bash
# MCP config files
find . -name "mcp.json" -o -name ".mcp.json" -o -name "mcp-config.*" 2>/dev/null
# Unpinned plugin / tool imports
grep -rn "langchain.*\.from_hub\|hub\.pull(\|PromptTemplate\.from_url" --include="*.py" --include="*.ts"
# Unsafe model loading
grep -rn "torch\.load(\|pickle\.load(.*\.bin\|pickle\.load(.*\.pt" --include="*.py"
```

### ASI05:2026 — Unexpected Code Execution

Agents that generate and execute code (for data analysis, tool creation, browser automation) expand the attack surface into RCE.

Checks:
- **Sandboxing** — code-interpreter tools must run in ephemeral containers, firecracker VMs, or WASM sandboxes — not the host, not a shared container.
- **No host network / host filesystem** — code execution containers must have network policies (egress allowlist or deny-by-default) and read-only/ephemeral FS.
- **Resource caps** — CPU/memory/wall-clock timeout, max output bytes.
- **No shell-via-tool** — `BashTool`, `ShellTool`, `execute_code` over user input need explicit review; flag any that use `shell=True` or concatenate user strings into commands.

```bash
grep -rn "PythonREPL\|ShellTool\|BashTool\|execute_code\|code_interpreter" --include="*.ts" --include="*.js" --include="*.py"
grep -rn "subprocess.*shell=True\|os\.system(\|exec(.*completion" --include="*.py" --include="*.ts"
```

### ASI06:2026 — Memory and Context Poisoning

Persistent memory / RAG databases / long-term conversation stores can be seeded by attackers with malicious content that later gets retrieved as "trusted context".

Checks:
- **Write-path authorization on memory stores** — who can write to the vector DB / long-term memory? User-facing agents writing directly is a poisoning vector.
- **Content provenance on retrieval** — retrieved chunks should carry a source label; high-privilege instructions must originate from trusted-source chunks only.
- **Memory eviction / TTL** — unbounded memory growth + no eviction means historical injections persist indefinitely.
- **Cross-tenant isolation** — vector DB namespacing per tenant; flag shared indexes across users.
- **Embedding model drift** — re-embedding on model upgrades breaks retrieval consistency; document the policy.

```bash
grep -rn "\.upsert(\|\.add(.*embedding\|vectorstore\.add" --include="*.py" --include="*.ts" --include="*.js"
grep -rn "namespace=\|tenant_id\|collection_name" --include="*.py" --include="*.ts" --include="*.js" | head -20
```

### ASI07:2026 — Insecure Inter-Agent Communication

Multi-agent systems (orchestrator + workers, A2A protocol, agent marketplaces) need message authentication, authorization, and ordering guarantees that ad-hoc function calls lack.

Checks:
- **Message authenticity** — inter-agent messages signed with per-agent keys (mTLS, JWT, or A2A protocol signatures).
- **Replay protection** — nonces / timestamps / message IDs checked.
- **Capability scoping per message** — a worker agent should not be able to delegate back to the orchestrator with escalated scope.
- **Ordering / idempotency** — tool calls idempotent where possible; ordering guarantees where not.
- **Denial-of-wallet** — one agent can't infinite-loop another into expensive LLM calls.

```bash
grep -rn "SpawnAgent\|create_agent\|delegate_to\|transfer_to_agent\|AgentNetwork" --include="*.ts" --include="*.js" --include="*.py"
grep -rn "a2a\|agent2agent\|inter_agent\|agent_message" --include="*.ts" --include="*.js" --include="*.py"
```

### ASI08:2026 — Cascading Failures

One compromised/misbehaving agent triggers failure propagation: runaway recursion, budget exhaustion, cross-tenant data leak through shared memory, downstream system overload.

Checks:
- **Depth / fan-out caps** — max recursion depth, max sub-agent spawn count, max tool-call chain length per session.
- **Circuit breakers** on agent loops — halt after N failed iterations, N token-budget breaches, N tool errors.
- **Bulkheading** — one tenant's / user's agent failures don't starve others.
- **Cost kill-switch** — token/API-spend alerts with automated pause at threshold.
- **Graceful degradation** — agents refuse new work rather than silently ignoring budget breaches.

```bash
grep -rn "max_iterations\|max_depth\|max_recursion\|max_steps" --include="*.ts" --include="*.js" --include="*.py"
grep -rn "while True\|while.*agent.*running\|for.*in.*infinite" --include="*.ts" --include="*.js" --include="*.py"
```
Flag agent loops without an explicit cap.

### ASI09:2026 — Human-Agent Trust Exploitation

Users over-trust agent outputs, approve batch actions without reading, or act on hallucinated recommendations. The attack vector is social, the defense is UX + policy.

Checks:
- **Action preview before execution** — destructive or irreversible tool calls must show a human-readable preview, not just a tool JSON.
- **Batched approval anti-pattern** — "approve all" buttons on tool-call lists are flagged.
- **Hallucination-prone outputs marked** — citations for factual claims; confidence scores where meaningful.
- **Deceptive UI patterns** — flag agent outputs styled as system messages or authority figures (admin, security team) when they aren't.
- **Rate-limited confirmations** — repeated approval prompts for the same session can cause fatigue-approval; consolidate but don't auto-approve.

Manual review: trace three representative agent actions end-to-end and verify the human approval UX at each trust boundary.

### ASI10:2026 — Rogue Agents

An agent — compromised, misconfigured, or maliciously impersonated — operates outside policy while appearing legitimate.

Checks:
- **Agent identity / registry** — every agent has a stable ID, version, and policy document. Unregistered agents can't participate.
- **Behavioral baselines** — track tool-call distributions per agent; alert on drift (a summarization agent suddenly calling `delete_file`).
- **Kill-switch** — operators can revoke an agent's credentials and terminate sessions within seconds.
- **Attestation** — in high-trust environments, agents attest their model version, system prompt hash, and tool registry hash to a controller before taking privileged actions.
- **Audit trail** — every agent action ties back to (agent_id, model_version, prompt_hash, tool_args_hash, parent_session).

```bash
grep -rn "agent_id\|agent_registry\|agent_policy" --include="*.ts" --include="*.js" --include="*.py"
```
If no agent identity plumbing exists in a multi-agent system, raise **ASI10** at HIGH minimum.

### Agentic AI — Aggregate Findings Rule

If the repo has agentic surface but **none** of: (1) tool allowlists per agent, (2) per-user credential propagation, (3) sandboxed code execution, (4) agent identity/audit trail — escalate to **CRITICAL** regardless of individual-category severities. These four are Least-Agency + Strong Observability's load-bearing controls; without them the other checks don't compose.

## Step 4 — Live Runtime Checks

If the app is running locally:

### HTTP response headers
```bash
curl -sI http://localhost:3000 2>/dev/null
```
Check for (and grade strength of): `Content-Security-Policy`, `Strict-Transport-Security` (`max-age>=31536000; includeSubDomains; preload`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`.

### Cookie attributes
```bash
curl -sc /dev/null http://localhost:3000/api/auth/session 2>/dev/null | grep -i "set-cookie"
```
Every session/auth cookie must have `Secure`, `HttpOnly`, and `SameSite=Strict|Lax`.

### GraphQL introspection
```bash
curl -s -X POST http://localhost:3000/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{__schema{types{name}}}"}'
```
If introspection is enabled in a production build, flag as high severity.

### TLS configuration (if HTTPS endpoint available)
```bash
testssl.sh --quiet --color 0 https://example.com 2>/dev/null || \
  nmap --script ssl-enum-ciphers -p 443 example.com 2>/dev/null
```
Flag TLS < 1.2, weak ciphers (RC4, 3DES, CBC with SHA1), missing OCSP stapling, short DH params (<2048).

## Step 5 — STRIDE Threat Model Prompt

Answer each briefly for the scoped module:

- **Spoofing**: What identities does this code assert or trust? How are they verified?
- **Tampering**: What data can an attacker modify in transit or at rest? Where's integrity validation?
- **Repudiation**: What actions are logged? Can logs be altered by the actor who performed the action?
- **Information disclosure**: What PII / secrets / internal structure could leak via responses, errors, or side channels?
- **Denial of service**: What inputs could exhaust CPU, memory, disk, or downstream quota?
- **Elevation of privilege**: What privilege boundaries exist? What could cross them?

Capture threats identified that aren't already covered by findings from Steps 2–4.

## Step 6 — Trend Diff

```bash
ls reports/security-audit-deep-*.md 2>/dev/null | sort | tail -2
```

If a prior deep report exists, compare and include:
- **New regressions** — issues not in the previous deep report
- **Fixed** — issues resolved since last deep scan
- **Persistent** — unresolved across both reports (aging — flag if >90 days old)

## Step 7 — Output

### Vulnerability Summary

The at-a-glance view — one row per finding, sorted by severity (Critical → Low), then by CVSS score descending. This table is the first thing in the report. Full details for each finding are in the Findings section further down.

| # | Severity | OWASP | CWE | CVSS | File | Issue (brief) | Effort | Exposure |
|---|----------|-------|-----|------|------|---------------|--------|----------|
| 1 | CRITICAL | A05:2025 | CWE-89 | 9.8 | `routes/users.py:45` | String concat into SQL query | Low | Internet |
| 2 | HIGH | A07:2025 | CWE-287 | 8.1 | `auth/jwt.ts:18` | `algorithms:["none"]` accepted | Low | Internet |
| 3 | HIGH | A02:2025 | CWE-250 | 7.8 | `Dockerfile:1` | No USER directive — container runs as root | Low | Internal |
| 4 | HIGH | ASI01:2026 | CWE-77 | 8.6 | `agents/planner.ts:132` | Tool-call args built from retrieved RAG content without allowlist | Medium | Internal |
| … | …        | …     | …   | …    | …    | …             | …      | …        |

If no findings: render a single row `| — | NONE | — | — | — | — | No vulnerabilities detected | — | — |`.

### Risk Summary
| Severity | Count | Top OWASP Category |
|----------|-------|---------------------|
| Critical | N     | ... |
| High     | N     | ... |
| Medium   | N     | ... |
| Low      | N     | ... |

### Findings (detailed — required fields)

```
[CRITICAL|HIGH|MEDIUM|LOW] <OWASP-Code> | CWE-<ID> | CVSS: <score> (<vector>)
File: <path>:<line>
Compliance: [PCI-DSS 6.5.x] [HIPAA §164.312(e)] [SOC2 CC6.x] [GDPR Art.32]
Issue: <what's wrong>
Impact: <exploit consequence>
Fix: <specific remediation with code example>
Effort: Low | Medium | High
Exposure: Internet-facing | Internal | Dev-only
```

Exposure calibrates real risk — an internet-facing high severity outranks an internal-only critical.

### Machine-Readable Output

Write combined findings to `.audit/findings.sarif` for GitHub Advanced Security, CodeQL, and SIEM ingestion. Also emit `.audit/findings.json` for custom dashboards.

### SBOM
Reference path to the generated SBOM (`.audit/sbom.cyclonedx.json` or `.audit/sbom.spdx.json`).

### Container Image Report
Summarize Trivy/Grype findings: CVE count by severity, critical CVEs with fixed-version availability, base-image recommendation.

### IaC Report
Summarize tfsec/checkov/kubesec findings by resource type (S3 buckets, IAM policies, security groups, pod specs).

### Dependency Report
Vulnerable deps with CVE, severity, recommended version, license flags.

### Suppressed Findings
`# security-audit: ignore` annotations with file, line, reason.

### Trend Summary
New regressions, fixed, persistent (with age).

### Threat Model Summary
STRIDE table from Step 5.

### Compliance Evidence
Map findings to framework clauses. Emit a one-page summary for each enabled framework (PCI-DSS, HIPAA, SOC2, GDPR) showing: controls passed, controls failed with evidence, remediation owners.

### Gate Result
```
AUDIT RESULT: [PASSED | FAILED]
Critical: N   High: N   CVSS ≥7.0: N
```

If `critical > 0` OR `high > 0` OR any CVSS ≥ 9.0:
```
⛔ DEEP AUDIT FAILED — blocks release.
```

### Recommendations
Top 5 prioritized actions. Include a 90-day remediation plan for persistent findings.

## Step 8 — Save Report

```bash
mkdir -p reports
DATE=$(date +%Y-%m-%d)
TIME=$(date +%H%M%S)
```

Save to `reports/security-audit-deep-<scope>-<DATE>-<TIME>.md`. If `$ARGUMENTS` was not provided, the scope label is `full`.

**Naming examples:**
- `reports/security-audit-deep-full-2026-04-16-143052.md`
- `reports/security-audit-deep-release-v2.3-2026-04-16-150715.md`
- `reports/security-audit-deep-quarterly-audit-2026-04-16-153241.md`

The timestamp prevents multiple runs on the same day from overwriting each other.

Front-matter:

```yaml
---
date: <DATE>
time: <TIME>
scope: <scope>
scan_depth: deep
critical_count: N
high_count: N
medium_count: N
low_count: N
cvss_max: <score>
gate_result: PASSED|FAILED
sbom: .audit/sbom.cyclonedx.json
sarif: .audit/findings.sarif
compliance_frameworks: [PCI-DSS, HIPAA, SOC2, GDPR]
---
```

Print the saved path, the SBOM path, and the SARIF path.
