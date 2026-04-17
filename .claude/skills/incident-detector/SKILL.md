---
name: incident-detector
description: Correlate deployment history with observability alerts, error logs, and service health signals to detect active or emerging incidents and classify their severity
argument-hint: "['scan'|'recent'|service-name-or-alert-context]"
allowed-tools: Read, Write, Grep, Glob, Bash(git log, git diff, git show, kubectl, curl, date, cat, ls, jq)
---

# Incident Detector

Monitor your project for active or emerging incidents by correlating recent deployments with error patterns, health check failures, alert history, and service metrics. This skill bridges the gap between "something deployed" and "something is broken" by connecting the dots that an on-call engineer would otherwise have to piece together manually at 2am.

The detector does not replace your alerting stack (Prometheus, Grafana, PagerDuty, Datadog). Instead, it adds a layer of intelligent correlation: when an alert fires, it immediately identifies which deployment likely caused it, which services are affected, and how severe the situation is. It can also run proactively on a schedule to catch slow-burn degradations that haven't triggered alerts yet.

## Step 1 — Gather Deployment Context

Establish what has been deployed recently, because most incidents correlate with recent changes.

### Recent Deployments
```bash
# Last 10 deployments (commits to main/default branch)
git log --oneline --since='48 hours ago' --format='%H %ai %s' | head -20

# Deployment-tagged commits
git log --oneline --since='7 days ago' --grep='deploy' --grep='release' --grep='merge' --all-match | head -10

# Tags in the last week (release markers)
git tag --sort=-creatordate | head -5
```

### Change Magnitude
For each recent deployment, assess the blast radius:
```bash
# Files changed in last deployment
git diff HEAD~1 --stat
git diff HEAD~1 --name-only
```

Flag HIGH risk if: infrastructure files changed (k8s/, terraform/, docker-compose), auth/security modules changed, database migrations present, >500 lines changed, or dependency major version bumps.

## Step 2 — Scan for Incident Signals

Check multiple signal sources to detect anomalies. Not all sources will exist in every project; skip gracefully and note which sources were available.

### Application Error Logs
```
Glob: logs/*, **/error.log, **/app.log
Grep: "ERROR", "FATAL", "CRITICAL", "Exception", "panic:", "Traceback"
Grep: "OOMKilled", "CrashLoopBackOff", "connection refused", "timeout"
```
Focus on errors that appeared after the most recent deployment timestamp.

### Health Check Endpoints
If the project has health check URLs documented (in README, docker-compose, k8s manifests):
```
Glob: **/health*, docker-compose.y*, k8s/**/*.y*, **/readiness*, **/liveness*
```
Extract health endpoints and note their expected behavior.

### Kubernetes Signals (if applicable)
```bash
# Pod status in relevant namespaces
kubectl get pods --all-namespaces --field-selector=status.phase!=Running 2>/dev/null | head -20

# Recent events (restarts, OOMs, failures)
kubectl get events --sort-by='.lastTimestamp' --field-selector type!=Normal 2>/dev/null | head -20

# Pods with restart counts > 0
kubectl get pods --all-namespaces -o json 2>/dev/null | jq '.items[] | select(.status.containerStatuses[]?.restartCount > 0) | {name: .metadata.name, ns: .metadata.namespace, restarts: .status.containerStatuses[].restartCount}' 2>/dev/null
```

### CI/CD Pipeline Status
```
Glob: .github/workflows/*, .azure-pipelines/*, azure-pipelines.yml, Jenkinsfile
```
Check for recently failed pipeline runs if CI artifacts are available.

### Monitoring Configuration
```
Glob: **/prometheus*, **/alertmanager*, **/grafana*, **/alerts.y*, **/rules.y*
```
Read alert rules to understand what thresholds the team considers critical.

### Existing Incident Reports
```
Glob: reports/incident-*, reports/postmortem-*, docs/incidents/*
```
Check for active unresolved incidents.

## Step 3 — Correlate Signals with Deployments

This is the core intelligence step. For each detected signal:

1. **Timeline Correlation**: Did this error/anomaly start after a specific deployment?
2. **Component Mapping**: Which files in the deployment touch the failing component?
3. **Pattern Recognition**: Is this a known failure pattern (e.g., missing env var after config change, breaking migration, dependency incompatibility)?

Build a correlation matrix:

```
Signal                  | First Seen        | Likely Deployment    | Confidence
ERROR: Connection reset | 2026-02-13 14:30  | abc1234 (14:15)      | HIGH (15 min gap, changed db config)
Pod restart: api-svc    | 2026-02-13 14:45  | abc1234 (14:15)      | MEDIUM (same window, but different module)
Alert: 5xx rate > 5%    | 2026-02-13 15:00  | abc1234 (14:15)      | HIGH (cascading from connection errors)
```

## Step 4 — Classify Severity

Based on collected signals, classify the incident:

| Severity | Criteria | Response Time Target |
|----------|----------|---------------------|
| **P0 - Critical** | Service down, data loss risk, security breach, all users affected | Immediate (< 15 min) |
| **P1 - High** | Major feature broken, significant degradation, many users affected | < 1 hour |
| **P2 - Medium** | Feature partially broken, workaround exists, some users affected | < 4 hours |
| **P3 - Low** | Minor issue, cosmetic, edge case, few users affected | Next business day |

Severity escalation factors:
- Multiple correlated signals escalate severity by one level
- Production environment escalates over staging/dev
- Auth/payment/data-integrity issues are minimum P1
- Cascading failures (one error causing others) are minimum P1

## Step 5 — Generate Incident Report

### Incident Detection Report

```
Detection Timestamp: <now>
Detection Mode: <scan|alert-triggered|scheduled>
Data Sources Checked: <list of sources that were available>
```

### Active Incidents Detected

For each detected incident:
```
Incident: <auto-generated ID or description>
Severity: P0|P1|P2|P3
Status: ACTIVE | EMERGING | SUSPECTED
Confidence: HIGH | MEDIUM | LOW

Signals:
  - <signal 1 with timestamp>
  - <signal 2 with timestamp>

Likely Cause:
  Deployment: <commit hash and message>
  Deployed At: <timestamp>
  Changed Files: <key files>
  Change Type: <config|code|infrastructure|dependency>

Affected Services: <list>
Blast Radius: <scope of impact>

Recommended Actions:
  1. <immediate action>
  2. <investigation step>
  3. <mitigation option>
```

### No Incidents Detected (if clean)
```
All Clear: No active incidents detected.
Last Deployment: <commit> at <time>
Signals Checked: <count> sources, all within normal parameters.
Next Recommended Scan: <time based on deployment frequency>
```

### Deployment Risk Summary
Even when no incident is active, summarize recent deployment risk:
```
Recent Deployments: N in last 48 hours
Highest Risk Change: <commit> — <reason>
Recommendation: <monitor closely | normal operations | review recommended>
```

## Step 6 — Save Report

1. Create the `reports/` directory if it doesn't exist: `mkdir -p reports`
2. Get today's date: `date +%Y-%m-%d` and capture as `$DATE`
3. Determine the scope label:
   - `scan` for general health check
   - `alert-<context>` if triggered by a specific alert
   - Service name if scoped to a specific service
4. Save to: `reports/incident-detection-<scope>-<DATE>.md`
   - Include YAML front-matter: `date`, `scope`, `incidents_detected`, `highest_severity`, `signals_checked`, `deployments_in_window`, `status` (clear|active|emerging)
5. Print the file path and a one-line summary

**Naming examples:**
- `reports/incident-detection-scan-2026-02-13.md`
- `reports/incident-detection-api-svc-2026-02-13.md`

**Tip:** Schedule this skill as a post-deployment hook in your CI/CD pipeline. Run it automatically 15-30 minutes after every production deployment to catch issues before users report them. Pair with `/incident-triager` when an incident is confirmed for deeper root cause analysis.
