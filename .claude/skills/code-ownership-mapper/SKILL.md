---
name: code-ownership-mapper
description: Map code ownership from git history — identify experts, knowledge silos, orphaned code, and bus factor risks
argument-hint: "['full'|'risks'|directory-or-module]"
allowed-tools: Read, Write, Grep, Glob, Bash(git log, git shortlog, cat, ls, find, date)
---

# Code Ownership Mapper

Analyze git history, file change patterns, and team structure to build a comprehensive map of who owns what code. Identifies de facto experts, knowledge silos (single-person ownership), orphaned modules (no recent activity), and bus factor risks. Essential for onboarding planning, review assignment, and organizational resilience.

## Step 1 — Scope the Analysis

If `$ARGUMENTS` is provided:
- `full` → Analyze the entire repository
- `risks` → Focus only on high-risk ownership patterns (silos, orphans, bus factor)
- A directory/module path → Analyze ownership for that specific area

If no arguments, default to `full`.

### Configure Time Windows
- **Active contributor**: Has committed in the last 6 months
- **Recently active**: Has committed in the last 3 months
- **Core contributor**: Has > 10% of commits in a module
- **Primary owner**: Has the most commits + most recent activity in a module

## Step 2 — Discover Repository Structure

Map the high-level module structure:
```bash
# Top-level directories (these are your "modules")
ls -d */ 2>/dev/null | head -30

# Or for monorepos, find package/project boundaries
find . -maxdepth 3 -name 'package.json' -o -name '*.csproj' -o -name 'pyproject.toml' 2>/dev/null | head -20
```

Build a module list. Each module is a top-level directory or package boundary.

## Step 3 — Analyze Contributor Activity

### Overall Repository Contributors
```bash
# All-time contributors by commit count
git shortlog -sn --no-merges | head -20

# Contributors in last 6 months
git shortlog -sn --no-merges --since='6 months ago' | head -20

# Contributors in last 3 months
git shortlog -sn --no-merges --since='3 months ago' | head -20
```

### Per-Module Contributor Mapping
For each module/directory:
```bash
# Who contributes to this module?
git shortlog -sn --no-merges -- <module-path>/ | head -10

# Recent contributors (last 6 months)
git shortlog -sn --no-merges --since='6 months ago' -- <module-path>/ | head -10

# Lines changed per author (effort proxy)
git log --no-merges --format='%aN' --numstat -- <module-path>/ | head -100
```

### Per-File Deep Ownership (for critical files)
For the most important files (entry points, config, core services):
```bash
# Current line-level ownership
git blame --line-porcelain <file> | grep '^author ' | sort | uniq -c | sort -rn | head -5

# Who has touched this file most recently?
git log -5 --format='%aN | %ai | %s' -- <file>
```

## Step 4 — Calculate Ownership Metrics

### For Each Module

| Metric | Formula | What It Tells You |
|--------|---------|-------------------|
| **Bus Factor** | Number of people with > 20% of commits | How many people need to leave before knowledge is lost |
| **Primary Owner** | Person with most commits + most recent activity | Who to ask questions |
| **Ownership Concentration** | Top contributor's % of total commits | How concentrated knowledge is |
| **Active Contributors** | Count with commits in last 6 months | Current team size for this module |
| **Recency** | Date of most recent commit | Is this module actively maintained? |
| **Orphan Score** | Days since last commit by an active team member | Is anyone still responsible? |

### Bus Factor Classification
- **Bus Factor 1** → CRITICAL — Single point of failure
- **Bus Factor 2** → WARNING — Limited redundancy
- **Bus Factor 3+** → HEALTHY — Good knowledge distribution

### Ownership Concentration Classification
- **> 80%** → CRITICAL — Knowledge silo
- **60-80%** → WARNING — Concentrated ownership
- **40-60%** → WATCH — Moderate concentration
- **< 40%** → HEALTHY — Distributed ownership

## Step 5 — Identify Risk Patterns

### Knowledge Silos
Modules where one person has > 70% of all commits AND is the only person with commits in the last 3 months:
```
[SILO] <module>
  Primary owner: <name> (85% of commits)
  Last commit by others: <date> (<N months ago>)
  Risk: If <name> is unavailable, no one can maintain this module
  Action: Pair <name> with another engineer for knowledge transfer
```

### Orphaned Modules
Modules where the primary contributor is no longer active (no commits in 6+ months) and no one else has taken over:
```
[ORPHANED] <module>
  Last active contributor: <name> (last commit: <date>)
  Current activity: None in <N months>
  Files: N source files, M lines of code
  Risk: No one currently knows how this works
  Action: Assign an owner, schedule a code walkthrough with <name> (if still reachable)
```

### Bottleneck People
Contributors who are the primary owner of 5+ modules:
```
[BOTTLENECK] <name>
  Primary owner of: <list of modules>
  Risk: Overloaded with ownership responsibilities, PR reviews bottleneck on this person
  Action: Delegate ownership of lower-priority modules
```

### Recently Departed Contributor Impact
Check for contributors who were active in the past but have no commits in the last 3 months:
```bash
# Active 6-12 months ago but not in last 3 months
comm -23 <(git shortlog -sn --since='12 months ago' --until='3 months ago' | awk '{$1=""; print}' | sort) \
         <(git shortlog -sn --since='3 months ago' | awk '{$1=""; print}' | sort) | head -10
```

For each departed contributor, list the modules they primarily owned and whether someone else has taken over.

## Step 6 — Generate CODEOWNERS Recommendation

If no `CODEOWNERS` file exists, generate one based on the analysis:

```
# CODEOWNERS — Generated by code-ownership-mapper
# Based on git history analysis as of <date>
# Review and adjust before committing

# Core modules
/src/api/           @alice @bob
/src/services/      @alice @carol
/src/models/        @bob @dave
/src/middleware/     @alice

# Infrastructure
/infra/             @eve
/scripts/           @eve @alice

# Tests
/tests/             @bob @carol

# Documentation
/docs/              @alice @dave

# Configuration
/*.yml              @eve
/*.json             @alice @eve
```

Note: This is a recommendation based on git history. The actual CODEOWNERS should reflect desired ownership, not just historical activity.

## Step 7 — Format Output

### Code Ownership Map

```
Repository: <name>
Analysis date: <date>
Total contributors (all-time): N
Active contributors (6 months): N
Modules analyzed: N
```

### Ownership Summary

| Module | Primary Owner | Bus Factor | Concentration | Active Contribs | Last Activity | Status |
|--------|--------------|------------|---------------|-----------------|---------------|--------|
| src/api | Alice | 3 | 45% | 4 | 2 days ago | ✅ HEALTHY |
| src/auth | Bob | 1 | 92% | 1 | 1 week ago | 🔴 SILO |
| src/legacy | (departed) | 0 | — | 0 | 8 months ago | ⚫ ORPHANED |
| src/services | Alice | 2 | 55% | 3 | 1 day ago | ✅ HEALTHY |

### Risk Dashboard

| Risk Type | Count | Modules |
|-----------|-------|---------|
| Knowledge Silos (bus factor 1) | N | <list> |
| Orphaned Modules | N | <list> |
| Bottleneck People | N | <list> |
| Departed Contributor Impact | N | <list> |

### Contributor Profile

For each active contributor:
```
<Name>
  Modules owned: <list with ownership %>
  Total commits (6 mo): N
  Most active in: <module>
  Review load: <estimated based on CODEOWNERS>
```

### Recommended Actions (Prioritized)

1. **[CRITICAL]** Knowledge transfer for <module> — bus factor is 1
2. **[HIGH]** Assign owner for orphaned <module>
3. **[MEDIUM]** Spread ownership of <module> — currently 85% concentrated
4. **[LOW]** Update CODEOWNERS file to reflect actual ownership

### CODEOWNERS Recommendation
(Generated CODEOWNERS content if file doesn't exist)

## Step 8 — Save Report

Save the complete ownership map to a persistent file.

1. Create the `reports/` directory if it doesn't exist: `mkdir -p reports`
2. Get today's date: `date +%Y-%m-%d` and capture as `$DATE`
3. Determine the scope label:
   - `full`, `risks`, or the specific module path
4. Save to: `reports/code-ownership-<scope>-<DATE>.md`
   - Include a YAML front-matter header with: `date`, `scope`, `total_contributors`, `active_contributors`, `modules_analyzed`, `silos_count`, `orphaned_count`, `bus_factor_1_count`
5. Print the file path so the user knows where to find it

**Naming examples:**
- `reports/code-ownership-full-2025-06-15.md`
- `reports/code-ownership-risks-2025-06-15.md`
- `reports/code-ownership-src-api-2025-06-15.md`

**Tip:** Run quarterly. Pair with `/onboarding-guide` for new team members and `/incident-postmortem-synthesizer` to correlate ownership gaps with incident hotspots.
