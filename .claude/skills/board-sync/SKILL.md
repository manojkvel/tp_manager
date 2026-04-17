---
name: board-sync
description: Sync SDLC artifacts (specs, plans, tasks, implementation reports) with a project management tool — creating epics, stories, and tasks in Azure Boards, Jira, GitHub Projects, Linear, or ClickUp, and keeping status in sync as implementation progresses. Use this after /task-gen to push work items to your PM tool, or after /task-implementer to update statuses.
argument-hint: "push|status|pull [--provider azure-boards|jira|github-projects|linear|clickup] [path/to/tasks.md]"
allowed-tools: Read, Write, Grep, Glob, Bash(az boards work-item create, az boards work-item update, az boards work-item show, az boards work-item relation add, az boards query, gh project item-list, gh project item-create, gh project item-edit, gh issue create, gh issue edit, gh issue close, curl, git log, git diff, ls, find, cat), MCP(atlassian, linear, clickup)
---

# Board Sync — PM Tool Integration

Bridge the gap between markdown-based SDLC artifacts and your project management tool. This skill creates, updates, and synchronizes work items in Azure Boards, Jira, GitHub Projects, Linear, or ClickUp from the structured outputs of `/task-gen`, `/task-implementer`, `/review-fix`, `/spec-fix`, and `/spec-review`.

The SDLC pipeline produces rich, traceable markdown artifacts. But your sprint board, release dashboard, velocity metrics, and notification system all live in the PM tool. Without synchronization, the team has two sources of truth that drift apart. `/board-sync` makes the PM tool a live mirror of the SDLC pipeline state.

## When to Use This Skill

| Moment | Command | What Happens |
|--------|---------|-------------|
| After `/task-gen` produces tasks.md | `/board-sync push` | Creates Epic → Features → Tasks in the PM tool |
| After `/task-implementer` completes | `/board-sync status` | Updates task states (Done, Blocked, Skipped) |
| After `/review-fix` or `/spec-fix` | `/board-sync status` | Adds fix summaries to linked work items |
| After `/spec-review` | `/board-sync status` | Posts compliance verdict on the Epic |
| After someone re-prioritizes in the board | `/board-sync pull` | Reflects priority/assignment changes back to tasks.md |
| After `/plan-merge` sequences multiple plans | `/board-sync push` | Creates initiative-level Epic linking spec Epics |

## CRITICAL RULES

1. **The PM tool is a mirror, not the source of truth.** Specs, plans, and tasks.md remain the authoritative artifacts. The PM tool reflects their state and provides the collaboration/notification layer.
2. **Never create duplicate work items.** Always check `board-mapping.json` before creating. If a mapping exists, update — don't re-create.
3. **Every work item must link back to its markdown source.** The work item description includes a reference path to the originating spec/task.
4. **Respect existing board structure.** Don't create new projects, area paths, or custom fields without explicit user confirmation. Work within the existing board configuration.
5. **Provider selection is sticky.** Once a project uses a provider, store it in `board-mapping.json`. Don't ask again.

---

## Phase 0 — Provider Detection and Configuration

### 0.1 Determine the Provider

Check in this order:

1. **Explicit flag:** `--provider azure-boards|jira|github-projects|linear|clickup`
2. **Existing mapping:** Read `board-mapping.json` in the spec directory — the provider is already set
3. **Environment detection** — check for available integrations:

   **MCP connectors (preferred for Jira, Linear, ClickUp):**
   Check if the Atlassian, Linear, or ClickUp MCP connectors are available. MCP connectors are the preferred integration path — they handle authentication via OAuth, require no CLI installation, and provide richer APIs.

   | Provider | MCP Connector | Detection |
   |----------|--------------|-----------|
   | Jira | Atlassian MCP | Check for `atlassianUserInfo` tool |
   | Linear | Linear MCP | Check for `list_issues` / `create_issue` tools |
   | ClickUp | ClickUp MCP | Check for `clickup_create_task` tool |

   **CLI tools (preferred for Azure Boards, GitHub Projects):**
   ```bash
   # Azure DevOps CLI
   az boards --help >/dev/null 2>&1 && echo "azure-boards available"

   # GitHub CLI with projects
   gh project list >/dev/null 2>&1 && echo "github-projects available"
   ```

   **REST API fallback:**
   If neither MCP nor CLI is available for a provider, fall back to `curl` + REST API with a PAT from environment variables (`$JIRA_API_TOKEN`, `$LINEAR_API_KEY`, etc.).

4. **Ask the user** if multiple providers are available or none are detected

### 0.2 Validate Authentication

#### Azure Boards (CLI)
```bash
az account show --output table
az boards query --wiql "SELECT [System.Id] FROM WorkItems WHERE [System.Id] = 0" \
  --org https://dev.azure.com/$AZURE_DEVOPS_ORG --project $AZURE_DEVOPS_PROJECT 2>&1
```
If not authenticated: tell the user to run `az login` and `az devops configure --defaults organization=https://dev.azure.com/{org} project={project}`.

#### Jira (MCP — preferred)
Call the Atlassian MCP `atlassianUserInfo` tool to verify the connector is authenticated and get the user identity. Then call `getAccessibleAtlassianResources` to discover available Jira sites and projects.

If the MCP connector is not connected: tell the user to enable the Atlassian connector in their Claude settings. If MCP is unavailable (e.g., running in Claude Code terminal), fall back to REST API:
```bash
curl -s -u "$JIRA_USER:$JIRA_API_TOKEN" \
  "https://$JIRA_DOMAIN/rest/api/3/myself" | head -1
```

#### GitHub Projects (CLI)
```bash
gh auth status 2>&1
gh project list --owner @me 2>&1
```
If not authenticated: tell the user to run `gh auth login`.

#### Linear (MCP — preferred)
Call the Linear MCP `list_issues` tool with a minimal query to verify connectivity. If MCP is unavailable, fall back to REST API with `$LINEAR_API_KEY`.

#### ClickUp (MCP — preferred)
Call the ClickUp MCP `clickup_get_workspace_hierarchy` tool to verify connectivity and discover workspace structure. If MCP is unavailable, fall back to REST API with `$CLICKUP_API_TOKEN`.

### 0.3 Load or Initialize Configuration

Read `board-mapping.json` if it exists. Otherwise, discover project structure:

**Azure Boards:**
```bash
az boards query --wiql "SELECT [System.Id], [System.AreaPath], [System.IterationPath] FROM WorkItems WHERE [System.State] = 'Active'" \
  --org $AZURE_DEVOPS_ORG --project $AZURE_DEVOPS_PROJECT --top 5 --output json
```

**Jira (via MCP):** Call `getAccessibleAtlassianResources` to list sites, then query the project to discover issue types, board configuration, and sprint structure.

**Jira (via REST):**
```bash
curl -s -u "$JIRA_USER:$JIRA_API_TOKEN" \
  "https://$JIRA_DOMAIN/rest/api/3/project/$JIRA_PROJECT" | python3 -m json.tool
```

**GitHub Projects:** `gh project list --owner @me --format json`

**Linear (via MCP):** Call `list_teams` and `list_cycles` to discover team and sprint structure.

**ClickUp (via MCP):** Call `clickup_get_workspace_hierarchy` to discover spaces, folders, and lists.

---

## Phase 1 — Push (tasks.md → PM Tool)

This is the primary flow. It reads structured SDLC artifacts and creates a work item hierarchy in the PM tool.

### 1.1 Load SDLC Artifacts

Read the tasks.md file (required). Also load if they exist:
- **Spec:** Extract title, acceptance criteria, business rules (for Epic/Story descriptions)
- **Plan:** Extract phases, effort estimates, architecture decisions (for Feature descriptions)
- **Merged plan:** If a `merged-plan-*.md` exists, extract initiative structure and wave assignments

### 1.2 Build the Work Item Hierarchy

Map SDLC concepts to PM tool hierarchy:

| SDLC Artifact | Azure Boards | Jira | GitHub Projects | Linear | ClickUp |
|--------------|-------------|------|-----------------|--------|---------|
| Spec (initiative) | Epic | Epic | Issue (label: epic) | Project | Folder |
| Plan phase | Feature | Story | Issue (label: feature) | Sub-project / Label group | List |
| TASK-NNN | Task | Sub-task | Issue (label: task) | Issue | Task |
| AC-N | Acceptance criterion in description | AC in description | Checkbox in body | Sub-issue / description | Checklist |
| Dependency | Predecessor link | Blocks/is-blocked-by | Linked issue | Relation: blocks | Dependency link |
| Effort estimate | Story points / effort | Story points | Custom field | Estimate (points) | Time estimate / points |
| Agent-readiness | Tag: `agent-ready-yes/partial/no` | Label | Label | Label | Tag |

### 1.3 Create Work Items

Process in order: Epic first, then Features, then Tasks (parent must exist before children).

#### Create the Epic

```bash
# Azure Boards
az boards work-item create \
  --type "Epic" \
  --title "<Spec Title>" \
  --description "$(cat <<'EOF'
## Specification
**Source:** specs/<NNN>-<slug>/spec.md

### Acceptance Criteria
- [ ] AC-1: <description>
- [ ] AC-2: <description>
- [ ] AC-3: <description>

### Business Rules
- BR-1: <rule>
- BR-2: <rule>

### Constraints
<security, performance, compliance constraints from spec>

---
*Synced by /board-sync from SDLC pipeline*
EOF
)" \
  --area "$AREA_PATH" \
  --iteration "$ITERATION_PATH" \
  --org $AZURE_DEVOPS_ORG \
  --project $AZURE_DEVOPS_PROJECT \
  --output json
```

```
# Jira (via Atlassian MCP — preferred)
Call createJiraIssue:
  projectKey: $JIRA_PROJECT
  issueType: "Epic"
  summary: "<Spec Title>"
  description: |
    h2. Specification
    *Source:* specs/<NNN>-<slug>/spec.md

    h3. Acceptance Criteria
    * AC-1: <description>
    * AC-2: <description>
    ...
  labels: ["sdlc-pipeline"]
```

```bash
# Jira (REST API fallback — if MCP unavailable)
curl -s -X POST -u "$JIRA_USER:$JIRA_API_TOKEN" \
  -H "Content-Type: application/json" \
  "https://$JIRA_DOMAIN/rest/api/3/issue" \
  -d '{"fields":{"project":{"key":"'$JIRA_PROJECT'"},"issuetype":{"name":"Epic"},"summary":"<Spec Title>","description":{"type":"doc","version":1,"content":[...]},"labels":["sdlc-pipeline"]}}'
```

```bash
# GitHub Projects
gh issue create \
  --title "<Spec Title>" \
  --body "$(cat <<'EOF'
## Specification
**Source:** specs/<NNN>-<slug>/spec.md
...
EOF
)" \
  --label "epic,sdlc-pipeline"
```

```
# Linear (via MCP — preferred)
Call create_issue:
  teamId: $LINEAR_TEAM_ID
  title: "<Spec Title>"
  description: |
    ## Specification
    **Source:** specs/<NNN>-<slug>/spec.md
    ...
  labelIds: ["sdlc-pipeline-label-id"]
  projectId: $LINEAR_PROJECT_ID
```

```
# ClickUp (via MCP — preferred)
Call clickup_create_task:
  listId: $CLICKUP_LIST_ID
  name: "<Spec Title>"
  description: |
    ## Specification
    **Source:** specs/<NNN>-<slug>/spec.md
    ...
  tags: ["sdlc-pipeline", "epic"]
```

Capture the returned work item ID.

#### Create Features (one per plan phase)

For each phase in the plan:

```bash
# Azure Boards
az boards work-item create \
  --type "Feature" \
  --title "Phase <N>: <Phase Goal>" \
  --description "$(cat <<'EOF'
## Plan Phase <N>
**Goal:** <phase goal>
**Traces to:** AC-<N>, AC-<M>
**Estimated effort:** <effort>

### File Changes
| Action | File | Description |
|--------|------|-------------|
| CREATE | src/auth/service.ts | Auth service with JWT validation |
| MODIFY | src/middleware/auth.ts | Add SSO middleware |

---
*Source: specs/<NNN>-<slug>/plan.md — Phase <N>*
EOF
)" \
  --org $AZURE_DEVOPS_ORG --project $AZURE_DEVOPS_PROJECT --output json

# Link Feature → Epic (parent)
az boards work-item relation add \
  --id $FEATURE_ID \
  --relation-type "System.LinkTypes.Hierarchy-Reverse" \
  --target-id $EPIC_ID
```

#### Create Tasks (one per TASK-NNN)

For each task in tasks.md:

```bash
# Azure Boards
az boards work-item create \
  --type "Task" \
  --title "TASK-<NNN>: <title>" \
  --description "$(cat <<'EOF'
## Task Details
**Type:** <TEST|IMPLEMENT|MIGRATE|...>
**Traces to:** AC-<N>, BR-<N>
**Estimated effort:** <XS/S/M/L>
**Agent-ready:** <YES/PARTIAL/NO>

### Description
<task description from tasks.md>

### Steps
1. <step>
2. <step>
3. <step>

### Files to Touch
- `src/auth/service.ts` — <what to do>

### Definition of Done
- [ ] <condition 1>
- [ ] <condition 2>
- [ ] All existing tests still pass
- [ ] No linting errors introduced

---
*Source: specs/<NNN>-<slug>/tasks.md — TASK-<NNN>*
EOF
)" \
  --assigned-to "$ASSIGNEE" \
  --org $AZURE_DEVOPS_ORG --project $AZURE_DEVOPS_PROJECT --output json

# Link Task → Feature (parent)
az boards work-item relation add \
  --id $TASK_ID \
  --relation-type "System.LinkTypes.Hierarchy-Reverse" \
  --target-id $FEATURE_ID

# Add dependency links (Predecessor)
az boards work-item relation add \
  --id $TASK_ID \
  --relation-type "System.LinkTypes.Dependency-Forward" \
  --target-id $DEPENDENCY_TASK_ID
```

Tags to apply:
- `agent-ready-yes`, `agent-ready-partial`, or `agent-ready-no`
- `sdlc-pipeline`
- Task type as tag: `task-type-test`, `task-type-implement`, etc.

### 1.4 Write the Mapping File

Save `board-mapping.json` in the spec directory:

```json
{
  "provider": "azure-boards",
  "org": "https://dev.azure.com/yourorg",
  "project": "sdlc-platform",
  "synced_at": "2026-02-16T14:30:00Z",
  "spec": {
    "ref": "specs/047-sso-login/spec.md",
    "work_item_id": "12001",
    "work_item_type": "Epic",
    "url": "https://dev.azure.com/yourorg/sdlc-platform/_workitems/edit/12001"
  },
  "phases": [
    {
      "phase": "Phase 1: Data Layer",
      "work_item_id": "12010",
      "work_item_type": "Feature",
      "parent_id": "12001"
    }
  ],
  "tasks": [
    {
      "task_id": "TASK-001",
      "work_item_id": "12100",
      "work_item_type": "Task",
      "parent_id": "12010",
      "title": "Write data model tests",
      "agent_ready": "YES",
      "status": "New",
      "url": "https://dev.azure.com/yourorg/sdlc-platform/_workitems/edit/12100"
    }
  ],
  "dependencies": [
    { "from": "12101", "to": "12100", "type": "Predecessor" }
  ]
}
```

### 1.5 Console Output

```
Board Sync Push — SSO Login
━━━━━━━━━━━━━━━━━━━━━━━━━━━
Provider:  Azure Boards (dev.azure.com/yourorg/sdlc-platform)
Epic:      AB#12001 — SSO Login for Enterprise Customers
Features:  5 created (Phase 1-5)
Tasks:     12 created (8 agent-ready, 3 partial, 1 human-only)
Links:     15 dependency links, 12 parent links

Mapping saved: specs/047-sso-login/board-mapping.json

View board: https://dev.azure.com/yourorg/sdlc-platform/_boards/board/t/Team/Stories
```

---

## Phase 2 — Status Update (implementation → PM Tool)

After `/task-implementer`, `/review-fix`, `/spec-fix`, or `/spec-review` completes, update the PM tool to reflect current state.

### 2.1 Load the Mapping and Reports

Read `board-mapping.json` to get work item IDs.

Find the most recent reports:
```
Glob: reports/task-implementer-*-<date>.md
Glob: reports/review-fix-*-<date>.md
Glob: specs/<NNN>-<slug>/spec-fix-*.md
Glob: specs/<NNN>-<slug>/spec-review.md
```

Parse YAML front-matter and structured tables from each report.

### 2.2 Update Task States

From the task-implementer report, extract per-task status:

| tasks.md Status | Azure Boards | Jira | GitHub Projects | Linear | ClickUp |
|----------------|-------------|------|-----------------|--------|---------|
| COMPLETE | Done | Done | Closed | Done | complete |
| PARTIAL | Active | In Progress | Open (label: partial) | In Progress | in progress |
| BLOCKED | Blocked (+ reason) | Blocked | Open (label: blocked) | Blocked | on hold |
| SKIPPED | Removed (+ reason) | Won't Do | Closed (label: skipped) | Cancelled | Closed |
| Not started | New | To Do | Open | Backlog | to do |

For each task with a status change:

```bash
# Azure Boards
az boards work-item update \
  --id $WORK_ITEM_ID \
  --state "Done" \
  --discussion "Implemented by /task-implementer. Tests: 8/8 passing. Files: src/auth/service.ts (+85 lines). Traces to AC-1." \
  --org $AZURE_DEVOPS_ORG --project $AZURE_DEVOPS_PROJECT
```

```
# Jira (via Atlassian MCP — preferred)
Call updateJiraIssueStatus:
  issueKey: $ISSUE_KEY
  targetStatus: "Done"

Call addJiraComment:
  issueKey: $ISSUE_KEY
  body: "Implemented by /task-implementer. Tests: 8/8 passing. Files: src/auth/service.ts (+85 lines). Traces to AC-1."
```

```bash
# Jira (REST API fallback)
curl -s -X POST -u "$JIRA_USER:$JIRA_API_TOKEN" \
  -H "Content-Type: application/json" \
  "https://$JIRA_DOMAIN/rest/api/3/issue/$ISSUE_KEY/transitions" \
  -d '{"transition":{"id":"$DONE_TRANSITION_ID"}}'
```

```bash
# GitHub
gh issue close $ISSUE_NUMBER --comment "Implemented by /task-implementer. Tests: 8/8 passing."
```

```
# Linear (via MCP)
Call update_issue:
  issueId: $LINEAR_ISSUE_ID
  stateId: $DONE_STATE_ID

Call create_comment:
  issueId: $LINEAR_ISSUE_ID
  body: "Implemented by /task-implementer. Tests: 8/8 passing."
```

```
# ClickUp (via MCP)
Call clickup_update_task:
  taskId: $CLICKUP_TASK_ID
  status: "complete"

Call clickup_create_task_comment:
  taskId: $CLICKUP_TASK_ID
  commentText: "Implemented by /task-implementer. Tests: 8/8 passing."
```

### 2.3 Update Feature / Epic Rollup

After updating tasks, check if all tasks under a Feature are Done. If so, transition the Feature:

```bash
# Azure Boards — check children
az boards query --wiql "SELECT [System.Id], [System.State] FROM WorkItems WHERE [System.Parent] = $FEATURE_ID" --output json
# If all children are Done, update the Feature
az boards work-item update --id $FEATURE_ID --state "Done"
```

Similarly, if all Features under an Epic are Done, update the Epic state.

### 2.4 Post Review / Compliance Results

After `/spec-review`:

```bash
# Post compliance verdict as a comment on the Epic
az boards work-item update \
  --id $EPIC_ID \
  --discussion "$(cat <<'EOF'
## Spec Compliance Review — <date>
**Verdict:** MOSTLY COMPLIANT (87%)

| Category | Score |
|----------|-------|
| Acceptance Criteria | 5/6 verified (83%) |
| Business Rules | 3/3 enforced (100%) |
| Edge Cases | 4/5 handled (80%) |
| Constraints | 4/4 met (100%) |
| Scope Creep | 2 items found |

**Action required:** AC-4 not implemented (requires human task TASK-010)
*Full report: specs/047-sso-login/spec-review.md*
EOF
)"
```

After `/review-fix`:

```bash
# Post fix summary on affected tasks
az boards work-item update \
  --id $TASK_ID \
  --discussion "Review fix applied: 3 CRITICAL findings auto-fixed, 2 DEFERRED. See reports/review-fix-sso-login-2026-02-16.md"
```

### 2.5 Update Mapping File

Update `board-mapping.json` with new statuses and sync timestamp.

### 2.6 Console Output

```
Board Sync Status — SSO Login
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Source:    reports/task-implementer-sso-login-2026-02-16.md

Updated:   8 tasks
  Done:    7 (TASK-001 through TASK-007)
  Blocked: 1 (TASK-008 — OAuth config needs API keys)
  Skipped: 2 (TASK-010, TASK-012 — human decisions)
Features:  2/5 completed (Phase 1, Phase 2)
Epic:      In Progress (5/6 ACs covered)

Sprint board updated: https://dev.azure.com/yourorg/sdlc-platform/_sprints
```

---

## Phase 3 — Pull (PM Tool → tasks.md)

Reflect changes made directly in the PM tool back into the markdown artifacts. This handles the case where a team lead re-prioritizes tasks, reassigns work, or adds sprint labels in the board.

### 3.1 Query Current State

```bash
# Azure Boards — get all tasks under the Epic
az boards query --wiql "SELECT [System.Id], [System.Title], [System.State], [System.AssignedTo], [Microsoft.VSTS.Common.Priority], [System.IterationPath], [System.Tags] FROM WorkItems WHERE [System.Parent] IN (SELECT [System.Id] FROM WorkItems WHERE [System.Parent] = $EPIC_ID)" --output json
```

### 3.2 Detect Changes

Compare PM tool state against `board-mapping.json`:

| Change Type | What Changed | Action |
|------------|-------------|--------|
| Priority change | Task moved to P1 in board | Log in tasks.md as a note; don't reorder (task ordering is dependency-driven) |
| Assignment change | Task assigned to kvel@ | Update tasks.md with assignee note |
| Sprint change | Task moved to Sprint 13 | Log sprint assignment in board-mapping.json |
| State change | Task marked Done manually | Verify with code evidence; warn if no implementation found |
| New comment | PM added context | Append to tasks.md task notes |
| Tag added | `blocked-by-external` | Flag in tasks.md |

### 3.3 Update tasks.md

For changes that affect the markdown artifacts, append a sync note:

```markdown
### TASK-003: Implement SSO auth service

...existing content...

**Board sync (2026-02-16):**
- Priority changed to P1 (was P2) by kvel@
- Assigned to kvel@
- Sprint: Sprint 13
```

The skill never removes content from tasks.md — it only appends board-sourced notes.

### 3.4 Console Output

```
Board Sync Pull — SSO Login
━━━━━━━━━━━━━━━━━━━━━━━━━━━
Changes detected: 4
  Priority:   TASK-003 → P1 (was P2)
  Assignment: TASK-003 → kvel@
  Sprint:     TASK-003, TASK-004 → Sprint 13
  Comment:    TASK-008 — "API keys provisioned, ready to proceed"

tasks.md updated with 4 board notes
board-mapping.json synced
```

---

## Provider Reference

### Azure Boards

**CLI:** `az boards` (extension: `az extension add --name azure-devops`)

**Authentication:** `az login` → `az devops configure --defaults organization=URL project=NAME`

**Work item types:** Epic → Feature → Task → Bug

**Key commands:**
```bash
az boards work-item create --type TYPE --title TITLE --description DESC
az boards work-item update --id ID --state STATE --discussion COMMENT
az boards work-item show --id ID --output json
az boards work-item relation add --id ID --relation-type TYPE --target-id TARGET
az boards query --wiql "WIQL_QUERY" --output json
```

**Relation types:**
- `System.LinkTypes.Hierarchy-Reverse` (child → parent)
- `System.LinkTypes.Dependency-Forward` (predecessor → successor)
- `System.LinkTypes.Related` (related work)

### Jira (MCP-first)

**Primary:** Atlassian MCP connector (OAuth-authenticated, no CLI install needed)

**Authentication:** Enable the Atlassian connector in Claude settings → OAuth flow handles the rest

**Issue types:** Epic → Story → Sub-task → Bug

**Key MCP tools:**
```
createJiraIssue        — Create issues of any type (Epic, Story, Sub-task, Bug)
updateJiraIssueStatus  — Transition issues between workflow states
addJiraComment         — Add comments to issues
getJiraIssue           — Read issue details, status, fields
searchJiraIssuesUsingJql — Query issues with JQL (Jira Query Language)
getAccessibleAtlassianResources — Discover available Jira sites and projects
atlassianUserInfo      — Verify authentication and get user identity
```

**Fallback (REST API):** If MCP is unavailable (e.g., running in Claude Code terminal without MCP), use `curl` against `https://$JIRA_DOMAIN/rest/api/3/` with `$JIRA_USER:$JIRA_API_TOKEN` basic auth.

**Link types:**
- `blocks` / `is blocked by`
- `is child of` / `is parent of`
- `relates to`

### GitHub Projects

**CLI:** `gh` (GitHub CLI with projects extension)

**Authentication:** `gh auth login`

**Issue types:** Issue with labels (epic, feature, task)

**Key commands:**
```bash
gh issue create --title TITLE --body BODY --label LABELS
gh issue edit ISSUE_NUMBER --add-label LABEL
gh issue close ISSUE_NUMBER --comment COMMENT
gh project item-create PROJECT_NUMBER --owner OWNER --title TITLE
gh project item-edit PROJECT_NUMBER --id ITEM_ID --field-id FIELD_ID --text VALUE
```

**Project fields:**
- Status (custom per project)
- Priority (custom per project)
- Sprint/Iteration (custom per project)

### Linear (MCP-first)

**Primary:** Linear MCP connector (OAuth-authenticated)

**Authentication:** Enable the Linear connector in Claude settings → OAuth flow handles the rest

**Issue types:** Project (Epic-level) → Issue → Sub-issue

**Key MCP tools:**
```
create_issue           — Create issues with team, project, label, estimate
update_issue           — Update status, assignee, priority, labels
create_comment         — Add comments to issues
list_issues            — Query issues with filters (team, project, state, assignee)
list_teams             — Discover teams in the workspace
list_projects          — List projects (used for Epic-level mapping)
list_cycles            — List cycles/sprints for sprint assignment
search_issues          — Full-text search across issues
```

**Fallback (REST API):** Linear GraphQL API at `https://api.linear.app/graphql` with `Authorization: $LINEAR_API_KEY`.

**Relation types:**
- `blocks` / `is blocked by`
- `relates to`
- Sub-issue (parent-child)

### ClickUp (MCP-first)

**Primary:** ClickUp MCP connector (OAuth-authenticated)

**Authentication:** Enable the ClickUp connector in Claude settings → OAuth flow handles the rest

**Hierarchy:** Workspace → Space → Folder (Epic-level) → List (Feature-level) → Task → Subtask

**Key MCP tools:**
```
clickup_create_task           — Create tasks in a list with description, tags, assignees
clickup_update_task           — Update status, priority, assignees, due dates
clickup_create_task_comment   — Add comments to tasks
clickup_get_tasks             — Query tasks in a list with filters
clickup_get_workspace_hierarchy — Discover spaces, folders, lists
clickup_create_list           — Create lists (for Feature-level items)
clickup_create_folder         — Create folders (for Epic-level items)
```

**Fallback (REST API):** ClickUp REST API v2 at `https://api.clickup.com/api/v2/` with `Authorization: $CLICKUP_API_TOKEN`.

**Dependency types:**
- `waiting_on` / `blocking`
- Subtask (parent-child)

### Adding a New Provider

The skill is designed so adding a new provider requires:
1. An MCP connector, CLI, or REST API that can CRUD work items
2. A hierarchy mapping (which type is Epic, which is Task, etc.)
3. A link type mapping (parent-child, dependency)
4. A state mapping (New → Active → Done)

**Preferred integration path:** MCP connector (if available) → CLI tool → REST API with PAT.

Add the provider's tool/command patterns to Phase 0 detection, Phase 1 creation, Phase 2 status updates, and Phase 3 queries. The mapping file format (`board-mapping.json`) is provider-agnostic — only the `provider` field and `url` patterns change.

---

## Modes

### Push Mode (Default)

Create work items from SDLC artifacts:

```
/board-sync push specs/047-sso-login/tasks.md
/board-sync push specs/047-sso-login/tasks.md --provider jira
/board-sync push specs/047-sso-login/tasks.md --provider linear
/board-sync push specs/047-sso-login/tasks.md --provider clickup
/board-sync push --dry-run specs/047-sso-login/tasks.md
```

### Status Mode

Update PM tool from implementation reports:

```
/board-sync status specs/047-sso-login/
/board-sync status reports/task-implementer-sso-login-2026-02-16.md
/board-sync status --all
```

`--all` finds all `board-mapping.json` files and updates each from the latest reports.

### Pull Mode

Sync PM tool changes back to markdown:

```
/board-sync pull specs/047-sso-login/
/board-sync pull --all
```

### Dry-Run

Available on all modes. Shows what would be created/updated without making changes:

```
/board-sync push --dry-run specs/047-sso-login/tasks.md
/board-sync status --dry-run specs/047-sso-login/
```

---

## Integration with /plan-merge

When `/plan-merge` produces a merged execution plan across multiple specs, `/board-sync push` handles it by creating an initiative-level hierarchy:

1. **Initiative Epic** — from the merged plan title
2. **Spec Epics** — one per source plan, linked as children of the Initiative Epic
3. **Features and Tasks** — normal hierarchy under each Spec Epic
4. **Wave tags** — each task gets a `wave-N` tag from the merged plan's execution wave assignment

This gives sprint planners a clear view: "Wave 1 tasks go in Sprint 12, Wave 2 in Sprint 13" — directly from the merged plan's dependency analysis.

---

## Output

1. **Primary:** `specs/<NNN>-<slug>/board-mapping.json` — bidirectional mapping between TASK-NNN IDs and PM tool work item IDs
2. **Console summary:** Items created/updated, links established, board URL
3. **Side effects:** Work items created/updated in the PM tool with full descriptions, AC checklists, dependency links, and traceability references back to markdown sources
