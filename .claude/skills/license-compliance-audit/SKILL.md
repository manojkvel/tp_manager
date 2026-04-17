---
name: license-compliance-audit
description: Scan all dependencies for OSS license conflicts with your organization's licensing policy
argument-hint: "['full'|'production'|package-name]"
allowed-tools: Read, Write, Grep, Glob, Bash(npm ls, npm info, pip show, pip list, cat, jq, date)
---

# License Compliance Audit

Scan every direct and transitive dependency in your project to detect open-source licenses that conflict with your organization's distribution policy. This prevents legal risk from incompatible licenses shipping into production.

## Step 1 — Define the License Policy

Load the license policy. Check for a `.license-policy.yml` or `.license-policy.json` in the project root. If none exists, use these sensible defaults:

### Default Policy

**Allowed (permissive):**
- MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, Unlicense, CC0-1.0, 0BSD, BlueOak-1.0.0, Zlib, WTFPL

**Requires Review (weak copyleft):**
- LGPL-2.1, LGPL-3.0, MPL-2.0, EPL-1.0, EPL-2.0, CDDL-1.0, Artistic-2.0

**Blocked (strong copyleft — incompatible with proprietary distribution):**
- GPL-2.0, GPL-3.0, AGPL-3.0, SSPL-1.0, EUPL-1.1, CC-BY-SA-4.0, OSL-3.0

**Unknown / No License:**
- Flag as `REVIEW_REQUIRED` — unlicensed code is legally risky

If `$ARGUMENTS` is a specific package name, audit only that package and its dependency tree.

## Step 2 — Discover All Dependencies

### Node.js (if `package.json` exists)

```bash
# List all production dependencies with licenses
npm ls --all --json 2>/dev/null | head -500

# For each package, get license info
npm info <package> license --json 2>/dev/null
```

Also check `package.json` for the `license` field in each dependency. Look at `node_modules/<package>/package.json` for the `license` field.

If `$ARGUMENTS` is `production`, only scan production dependencies (skip devDependencies):
```bash
npm ls --prod --all --json 2>/dev/null
```

### Python (if `requirements.txt` or `pyproject.toml` exists)

```bash
# List installed packages
pip list --format=json 2>/dev/null

# For each package, get metadata including license
pip show <package> 2>/dev/null | grep -i license
```

Also check PyPI classifiers in package metadata for license information.

### .NET (if `*.csproj` exists)

Search for `<PackageReference>` elements in `.csproj` files and cross-reference NuGet license metadata.

### Go (if `go.mod` exists)

Check `go.sum` and look for `LICENSE` files in `vendor/` or the module cache.

## Step 3 — Classify Each Dependency

For every dependency (direct and transitive), create a classification record:

```
Package: <name>
Version: <version>
License: <SPDX identifier>
Classification: ALLOWED | REVIEW_REQUIRED | BLOCKED | UNKNOWN
Direct: yes/no (is it a direct dependency or transitive?)
Used by: <which direct dependency pulls it in, if transitive>
Import count: <how many of our source files import it>
```

### Handling Edge Cases

1. **Dual-licensed packages** (e.g., "MIT OR Apache-2.0"): Use the most permissive option — classify as ALLOWED if any option is allowed
2. **Custom licenses**: Flag as UNKNOWN — these need human review
3. **License field missing in metadata**: Check for LICENSE/COPYING file in the package directory
4. **SPDX expressions with AND**: All licenses in the expression must be allowed (e.g., "MIT AND BSD-3-Clause" requires both to be allowed)

## Step 4 — Deep Scan for Hidden Risks

### Vendored/Bundled Code
Search for vendored source files that may have their own licenses:
```
Glob: **/vendor/**/{LICENSE,COPYING,NOTICE}
Glob: **/third_party/**/{LICENSE,COPYING,NOTICE}
Glob: **/bundled/**/{LICENSE,COPYING,NOTICE}
```

### Copy-Pasted Code with License Headers
Search source files for embedded license comments:
```
Grep: "Copyright.*All rights reserved"
Grep: "Licensed under the"
Grep: "SPDX-License-Identifier:"
```

### Fonts, Images, and Assets
Check for non-code assets with restrictive licenses:
```
Glob: **/*.ttf, **/*.otf, **/*.woff, **/*.woff2
Glob: **/assets/{LICENSE,NOTICE,CREDITS}
```

## Step 5 — Format Output

### Policy Summary

| Policy Rule | Count |
|-------------|-------|
| Allowed (permissive) | N packages |
| Requires Review (weak copyleft) | N packages |
| Blocked (strong copyleft) | N packages |
| Unknown / No License | N packages |
| **Total scanned** | **N packages** |

### Blocked Dependencies — Action Required

For each blocked package:
```
[BLOCKED] <package>@<version>
  License: GPL-3.0
  Type: transitive (pulled in by <direct-dependency>)
  Import count: N files
  Action: Replace with <alternative-package> (MIT) or remove dependency on <direct-dependency>
```

### Review Required

For each package needing review:
```
[REVIEW] <package>@<version>
  License: LGPL-2.1
  Type: direct
  Usage: dynamic linking only (LGPL-safe) | static linking (needs review)
  Note: LGPL is generally safe if used as a shared library without modification
```

### Unknown Licenses

For each unknown:
```
[UNKNOWN] <package>@<version>
  License: NONE / Custom
  Type: direct | transitive
  Action: Contact maintainer or find the LICENSE file manually
```

### Recommendations
1. Immediate actions for blocked dependencies (with specific replacement suggestions)
2. Review items for weak copyleft dependencies
3. Suggestion to create a `.license-policy.yml` if one doesn't exist

## Step 6 — Save Report

Save the complete audit to a persistent file for compliance tracking.

1. Create the `reports/` directory if it doesn't exist: `mkdir -p reports`
2. Get today's date: `date +%Y-%m-%d` and capture as `$DATE`
3. Determine the scope label:
   - If `$ARGUMENTS` was `full` or empty, use `full`
   - If `production`, use `production`
   - If a specific package, use the sanitized package name
4. Save the full audit to: `reports/license-compliance-audit-<scope>-<DATE>.md`
   - Include a YAML front-matter header with: `date`, `scope`, `total_packages`, `allowed_count`, `review_required_count`, `blocked_count`, `unknown_count`
5. Print the file path so the user knows where to find it

**Naming examples:**
- `reports/license-compliance-audit-full-2025-06-15.md`
- `reports/license-compliance-audit-production-2025-06-15.md`

**Tip:** Run before every release and compare reports to catch newly introduced license risks:
```
ls reports/license-compliance-audit-*.md
```
