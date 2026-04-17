# Pipeline Progress File — Template

Format for `pipeline-progress.md`, the persistent file that gives an agent instant re-orientation on resume.

```markdown
# Pipeline Progress: <pipeline-name>

**Status:** in_progress | completed | paused | failed
**Step:** <current> of <total>
**Input:** <original user input, one line>
**Started:** <ISO timestamp>
**Updated:** <ISO timestamp>

## Completed Steps

- **<step-id>** — <skill-name> | Result: <completed | passed (score)> | Output: `<path>`
- **<step-id>** — <skill-name> | Result: <completed> | Output: `<path>`

## Current Step

**<step-id>** — <skill-name>
- **Args:** <interpolated arguments for this step>

## Remaining Steps

- <step-id> → <skill-name>
- <step-id> → <skill-name>
- <step-id> → <skill-name>
```

## Rules

1. **Keep summaries short** — one sentence per completed step, no more.
2. **Use concrete file paths** — always include actual paths for outputs, never "see output."
3. **Overwrite entirely after each step** — never append; regenerate the whole file.
