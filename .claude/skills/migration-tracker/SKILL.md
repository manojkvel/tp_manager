---
name: migration-tracker
description: Track progress of long-running technical migrations — framework upgrades, library replacements, and pattern adoptions
argument-hint: "['status'|'init'|migration-name]"
allowed-tools: Read, Write, Grep, Glob, Bash(git log, git shortlog, wc, find, cat, ls, date)
---

# Migration Tracker

Track the progress of long-running technical migrations across your codebase — framework upgrades (.NET 6 → 8), library replacements (Newtonsoft → System.Text.Json), infrastructure moves (VMs → containers), or pattern adoptions (adding structured logging everywhere). Scans for old-pattern vs. new-pattern usage, calculates completion percentage, and generates a progress report.

## Step 1 — Load Migration Definitions

Check for a migration tracking file:
```
Glob: migrations.yml, migrations.yaml, .migrations.yml, docs/migrations.yml, docs/migrations.yaml
```

If a migration file exists, parse it. Expected format:

```yaml
migrations:
  - name: dotnet-6-to-8
    description: "Upgrade from .NET 6 to .NET 8"
    status: in_progress
    started: 2025-01-15
    target_completion: 2025-06-30
    old_pattern:
      description: ".NET 6 target framework"
      search:
        - glob: "**/*.csproj"
          pattern: "net6.0"
    new_pattern:
      description: ".NET 8 target framework"
      search:
        - glob: "**/*.csproj"
          pattern: "net8.0"
    exclusions:
      - "**/legacy/**"
      - "**/test-fixtures/**"

  - name: newtonsoft-to-system-text-json
    description: "Replace Newtonsoft.Json with System.Text.Json"
    status: in_progress
    started: 2025-02-01
    target_completion: 2025-08-30
    old_pattern:
      description: "Newtonsoft.Json usage"
      search:
        - glob: "**/*.cs"
          pattern: "using Newtonsoft.Json"
        - glob: "**/*.cs"
          pattern: "JsonConvert\\."
        - glob: "**/*.csproj"
          pattern: "Newtonsoft.Json"
    new_pattern:
      description: "System.Text.Json usage"
      search:
        - glob: "**/*.cs"
          pattern: "using System.Text.Json"
        - glob: "**/*.cs"
          pattern: "JsonSerializer\\."

  - name: structured-logging
    description: "Adopt structured logging with Serilog across all services"
    status: in_progress
    started: 2025-03-01
    old_pattern:
      description: "Unstructured logging"
      search:
        - glob: "**/*.cs"
          pattern: "Console\\.Write(Line)?"
        - glob: "**/*.cs"
          pattern: "Debug\\.Print"
    new_pattern:
      description: "Serilog structured logging"
      search:
        - glob: "**/*.cs"
          pattern: "Log\\.(Information|Warning|Error|Debug|Fatal)"
        - glob: "**/*.cs"
          pattern: "using Serilog"
```

If `$ARGUMENTS` is `init`, create a template `migrations.yml` and guide the user through defining their first migration.

If no migration file exists and `$ARGUMENTS` is not `init`, attempt auto-detection (see Step 2).

## Step 2 — Auto-Detect Common Migrations

If no migration definition file exists, scan for common migration patterns:

### Framework Upgrades
```
Grep in *.csproj: "net6.0", "net7.0", "net8.0"
Grep in package.json: "react.*\"16", "react.*\"17", "react.*\"18"
Grep in requirements.txt: "Django==3", "Django==4", "Django==5"
```

If mixed versions are found, flag it as an active migration.

### Library Replacements
Common patterns to detect:
| Old Library | New Library | Detection |
|-------------|-------------|-----------|
| moment.js | date-fns / dayjs / luxon | Import patterns |
| lodash (full) | lodash-es / native | Import patterns |
| request / axios@<1 | fetch / axios@1+ | Import patterns |
| Newtonsoft.Json | System.Text.Json | Using statements |
| unittest | pytest | Import patterns |
| jQuery | vanilla JS / React | Script tags, imports |
| class components | functional components | Component patterns |
| callbacks | async/await | Code patterns |
| var | const/let | Declaration patterns |

### Pattern Adoptions
| Pattern | Old Way | New Way | Detection |
|---------|---------|---------|-----------|
| Structured logging | Console.Write, print() | Serilog, structlog | Import/usage patterns |
| Type safety | .js files, `any` types | .ts files, strict types | File extensions, tsconfig |
| Error handling | try/catch all | Result types, error boundaries | Code patterns |
| Configuration | Hardcoded values | Environment variables | String literals vs env refs |

## Step 3 — Measure Progress

For each migration (defined or auto-detected):

### Count Old vs. New Pattern Usage
```bash
# Old pattern occurrences
grep -r "<old_pattern>" --include="<glob>" -l | wc -l  # files with old pattern
grep -r "<old_pattern>" --include="<glob>" -c | awk -F: '{sum+=$2} END {print sum}'  # total occurrences

# New pattern occurrences
grep -r "<new_pattern>" --include="<glob>" -l | wc -l
grep -r "<new_pattern>" --include="<glob>" -c | awk -F: '{sum+=$2} END {print sum}'
```

### Calculate Completion Percentage
```
Total instances = old_count + new_count
Completion = new_count / total_instances × 100%
Remaining = old_count instances to migrate
```

### Per-File Breakdown
For each file that still has the old pattern:
```
File: <path>
Old pattern occurrences: N
Priority: <high if critical path, medium if standard, low if test/docs>
Estimated effort: <S/M/L based on occurrence count and file complexity>
```

### Git History Context
```bash
# When was this file last touched for migration work?
git log -1 --format='%ai %s' -- <file-with-old-pattern>

# Who has been doing migration work?
git log --all --grep='<migration-keyword>' --format='%aN' | sort | uniq -c | sort -rn | head -5
```

## Step 4 — Assess Migration Health

### Timeline Assessment
For each migration with a target date:
```
Started: <date>
Target: <date>
Elapsed: N days (X% of timeline)
Completed: Y%
Velocity: Z instances/week (based on git history)
On Track: YES/NO — at current velocity, completion by <projected date>
```

### Risk Factors
Flag any migration risks:
- **Stalled** — No migration-related commits in 2+ weeks
- **Accelerating debt** — New files still using old pattern
- **No ownership** — Only 1 person doing migration work
- **Blocked** — Migration requires a breaking change or external dependency
- **Scope creep** — Total instance count is growing (new old-pattern code being written)

### New Violations Check
```bash
# Recent commits that introduce the OLD pattern (going backwards)
git log --since='2 weeks ago' --format=format: --name-only --diff-filter=AM | sort -u | while read f; do
  grep -l "<old_pattern>" "$f" 2>/dev/null
done
```

If new code is being written with the old pattern, flag as: **REGRESSION — new code using deprecated pattern**

## Step 5 — Format Output

### Migration Tracker Report

```
Report Date: <date>
Active Migrations: N
Completed Migrations: N
At Risk: N
```

### Migration Summary

| Migration | Started | Target | Progress | Remaining | Velocity | Status |
|-----------|---------|--------|----------|-----------|----------|--------|
| .NET 6 → 8 | Jan 15 | Jun 30 | 72% | 14 files | 3/week | ✅ On Track |
| Newtonsoft → STJ | Feb 1 | Aug 30 | 35% | 42 files | 2/week | ⚠️ Behind |
| Structured Logging | Mar 1 | — | 60% | 25 files | 4/week | ✅ On Track |

### Detailed Migration: <name>

For each active migration:

```
Migration: <name>
Description: <what's changing>
Progress: ██████████░░░░ 72% (52/72 files)

Files Remaining (by priority):
  HIGH:
    - src/api/UserController.cs (8 occurrences)
    - src/services/PaymentService.cs (5 occurrences)
  MEDIUM:
    - src/handlers/WebhookHandler.cs (3 occurrences)
  LOW:
    - tests/helpers/TestFactory.cs (2 occurrences)

Contributors:
    Alice: 28 instances migrated
    Bob: 18 instances migrated
    Carol: 6 instances migrated

Recent Activity:
    2025-06-14: Migrated OrderService.cs (5 instances)
    2025-06-12: Migrated AuthMiddleware.cs (3 instances)
    2025-06-10: No migration activity

Risks:
    ⚠️ 2 new files committed with old pattern this week
    ⚠️ No migration commits from anyone except Alice in 10 days
```

### Recommendations
1. Highest priority files to migrate next
2. Process improvements (e.g., lint rules to block old patterns)
3. Ownership suggestions for remaining work

## Step 6 — Save Report

Save the complete tracker to a persistent file.

1. Create the `reports/` directory if it doesn't exist: `mkdir -p reports`
2. Get today's date: `date +%Y-%m-%d` and capture as `$DATE`
3. Determine the scope label:
   - `status` for overall status, or the specific migration name
4. Save to: `reports/migration-tracker-<scope>-<DATE>.md`
   - Include a YAML front-matter header with: `date`, `scope`, `active_migrations`, `avg_completion_pct`, `at_risk_count`, `regressions_found`
5. Print the file path so the user knows where to find it

**Naming examples:**
- `reports/migration-tracker-status-2025-06-15.md`
- `reports/migration-tracker-dotnet-6-to-8-2025-06-15.md`

**Tip:** Run bi-weekly on active migrations. Add lint rules or pre-commit hooks to prevent new code from using old patterns. Feed into `/report-trends` to track migration velocity over time.
