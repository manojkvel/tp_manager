---
name: spec-gen
description: Generate a structured technical specification from a feature request, user story, or bug report — defining WHAT and WHY, never HOW
argument-hint: "'feature description' or path to requirements file"
allowed-tools: Read, Write, Grep, Glob, Bash(git log, git shortlog, ls, find, tree)
---

# Specification Generator

Transform a feature request, user story, bug report, or loose requirements into a structured, reviewable technical specification. The spec defines **what** the system should do and **why** — it explicitly does NOT define how to implement it.

This skill follows the spec-driven development philosophy: specs are first-class artifacts that live in your repo, serve as the single source of truth for implementation, and are reviewable by both humans and AI agents.

## CRITICAL RULES

1. **Avoid implementation details** unless the feature is inherently tied to a specific technology (e.g., "migrate from MySQL to PostgreSQL"). No code, no framework-specific patterns, no database schemas. That belongs in `/plan-gen`.
2. **Never assume technology choices.** The spec should be implementable in any stack.
3. **Always capture constraints and edge cases.** These are where bugs live.
4. **Write for two audiences:** human engineers who need to understand the feature, and AI agents who need unambiguous instructions to implement it.

---

## Phase 1 — Context Gathering

### 1.1 Understand the Input

The user will provide one of:
- A feature request (informal description)
- A user story ("As a X, I want Y, so that Z")
- A bug report (current behavior vs. expected behavior)
- A PRD or product brief (longer document)
- A verbal/chat description ("we need to add...")

Read the input carefully. If a file path is provided, read the file.

### 1.2 Discover Existing Context

Before writing the spec, understand the current system:

```
Glob: CLAUDE.md, specs/*.md, .specify/specs/**/*.md, docs/specs/**/*.md
```

Check if there are existing specs to understand the format and domain language used by this team.

```
Glob: package.json, pyproject.toml, go.mod, Cargo.toml
```

Read the project manifest to understand the product name and domain (but do NOT let this influence implementation decisions in the spec).

```bash
git log --oneline -20
```

Check recent commits for context on what's been built recently.

### 1.3 Identify Ambiguities

Before writing, list every ambiguity or open question found in the input. Categorize them:

- **Must resolve before spec** — Blockers (e.g., "should this be accessible to all users or only admins?")
- **Can resolve during planning** — Details (e.g., "exact error message wording")
- **Can resolve during implementation** — Trivial (e.g., "button color")

Present the "must resolve" questions to the user. Do not proceed until they are answered.

---

## Phase 2 — Write the Specification

Create the spec file at: `specs/<NNN>-<feature-slug>/spec.md`

Where `<NNN>` is the next sequential number (check existing specs) and `<feature-slug>` is a kebab-case name.

### Spec Template

```markdown
# Spec: <Feature Title>

> **Status:** DRAFT | IN REVIEW | APPROVED | IMPLEMENTED
> **Author:** <name or "AI-generated, pending review">
> **Created:** <date>
> **Last updated:** <date>
> **Spec ID:** <NNN>

---

## 1. Problem Statement

<What problem does this solve? Why does it matter? Who is affected?>

Write 2-4 sentences that a non-technical stakeholder could understand.

## 2. Goals

What this feature MUST achieve:

- **Goal 1:** <measurable outcome>
- **Goal 2:** <measurable outcome>
- **Goal 3:** <measurable outcome>

## 3. Non-Goals

What this feature explicitly does NOT do (to prevent scope creep):

- **Non-goal 1:** <what we're not doing and why>
- **Non-goal 2:** <what we're not doing and why>

## 4. User Stories

### Primary Flow
> As a <role>, I want to <action>, so that <benefit>.

**Preconditions:**
- <what must be true before this flow starts>

**Steps:**
1. User does X
2. System responds with Y
3. User sees Z

**Postconditions:**
- <what must be true after this flow completes>

### Alternative Flows
> <Repeat for each significant alternative path>

### Error Flows
> <What happens when things go wrong — for each meaningful error case>

## 5. Acceptance Criteria

Concrete, testable conditions that must ALL be true for this feature to be considered complete:

- [ ] AC-1: <Given [context], when [action], then [expected result]>
- [ ] AC-2: <Given [context], when [action], then [expected result]>
- [ ] AC-3: <Given [context], when [action], then [expected result]>
- [ ] AC-4: <Given [context], when [action], then [expected result]>

Each criterion must be:
- **Specific** — No "should work correctly"
- **Testable** — Can write a test for it
- **Independent** — Doesn't depend on other criteria
- **Unambiguous** — Only one interpretation

## 6. Business Rules

Rules the system must enforce regardless of implementation:

| Rule ID | Rule | Example |
|---------|------|---------|
| BR-1 | <rule description> | <concrete example> |
| BR-2 | <rule description> | <concrete example> |

## 7. Data Requirements

What data does this feature need to work with? (Conceptual, not schema-level)

**Inputs:**
- <what data enters the system, from where>

**Outputs:**
- <what data the system produces or exposes>

**Stored state:**
- <what needs to be persisted and for how long>

**Relationships:**
- <how this feature's data relates to existing data in the system>

## 8. Constraints

### Security Constraints
- <auth requirements, data sensitivity, encryption needs>

### Performance Constraints
- <response time expectations, throughput requirements, data volume>

### Compliance Constraints
- <regulatory requirements: GDPR, HIPAA, PCI-DSS, etc.>

### Compatibility Constraints
- <browser/platform requirements, backward compatibility, API versioning>

## 9. Edge Cases & Boundary Conditions

| # | Scenario | Expected Behavior |
|---|----------|-------------------|
| 1 | <extreme input or unusual condition> | <what should happen> |
| 2 | <concurrent access scenario> | <what should happen> |
| 3 | <empty/null/missing data> | <what should happen> |
| 4 | <maximum limits hit> | <what should happen> |

## 10. Dependencies

**Depends on:**
- <other features, services, or systems this needs>

**Depended on by:**
- <other features that will rely on this>

**External dependencies:**
- <third-party services, APIs, or data sources>

## 11. Open Questions

Questions that remain unresolved (to be addressed before moving to planning):

| # | Question | Impact | Owner | Resolution |
|---|----------|--------|-------|------------|
| 1 | <question> | <what's blocked> | <who decides> | <pending/resolved: answer> |

## 12. Out of Scope for V1 (Future Considerations)

Things we might want later but are explicitly excluded from this spec:

- <future enhancement 1>
- <future enhancement 2>

---

> **Next step:** When this spec is APPROVED, run `/plan-gen specs/<NNN>-<feature-slug>/spec.md` to generate an implementation plan.
```

---

## Phase 3 — Quality Checks

Before finalizing, validate the spec against these criteria:

### 3.1 Completeness Check

- [ ] Problem statement is clear to a non-technical reader
- [ ] At least 3 acceptance criteria defined
- [ ] At least 2 edge cases identified
- [ ] Security constraints addressed (even if "none" — state it explicitly)
- [ ] Non-goals defined (prevents scope creep)
- [ ] All "must resolve" ambiguities are resolved

### 3.2 Testability Check

For every acceptance criterion, ask: "Can I write an automated test for this?" If the answer is no, rewrite it until the answer is yes.

### 3.3 Ambiguity Check

Read each sentence and ask: "Could two engineers interpret this differently?" If yes, add specificity.

### 3.4 Scope Check

- Is this spec trying to cover too much? Should it be split?
- Are there hidden features buried in the description?
- Does any section accidentally describe implementation?

### 3.5 Consistency Check

- Do acceptance criteria contradict each other?
- Do business rules conflict with user stories?
- Are error flows consistent with the acceptance criteria?

---

## Phase 4 — Link to Existing Specs

Check for related specs:

```
Glob: specs/*/spec.md, .specify/specs/**/spec.md
```

If related specs exist:
- Add cross-references in the Dependencies section
- Note any potential conflicts or overlaps
- Check if this new spec supersedes or extends an existing one

---

## Output

1. **Primary:** `specs/<NNN>-<feature-slug>/spec.md` — The spec file
2. **Console summary:** One-paragraph overview + count of acceptance criteria + count of open questions
3. **Next action:** Remind the user to review the spec, resolve open questions, then run `/plan-gen`
---

## Notes

- Specs are living documents. They should be updated when requirements change.
- Commit specs to git. They are as important as code.
- The spec-to-plan-to-task pipeline only works if the spec is thorough. Garbage in, garbage out.
- When in doubt about scope, make the spec smaller. It's easier to add a second spec than to untangle a bloated one.
