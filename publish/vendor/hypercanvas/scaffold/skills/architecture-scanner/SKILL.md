---
name: architecture-scanner
description: Architecture scanner and documentation generator. Use when scanning the codebase architecture, updating architecture docs, or generating architecture documentation.
metadata:
  author: Daniel Fosco
  version: "2026.3.09"
---

# Architecture Scanner Skill

> Triggered by: "scan the codebase architecture", "update the architecture", "update arch", "generate architecture docs", "scan arch", "full update", "full architecture update", "full refresh architecture"

## What This Does

Generates documentation files in `.agents/architecture/` that describe every architecturally significant file in the codebase. The system has two layers:

- **`architecture.index.md`** — The architectural overview. Groups files by category (ordered and configured via the `categories` array in `files.json`) and includes prose summaries. Categories with `"priority": "critical"` get 2-3x more detailed overviews. A reader should be able to understand the system's architecture from this file alone.
- **Per-file docs** (`{filepath}.md`) — Detailed documentation for individual files, including what they do, how they work (with code samples), their dependencies, and dependents. Every file reference is cross-linked to its architecture doc.

## How to Execute

### Step 0: Inventory package topology (required)

Before discovery, identify **every** `package.json` in the repo (root + workspace packages), excluding `node_modules`, and read each manifest:

```bash
find . -name package.json \
  -not -path './node_modules/*' \
  -not -path './packages/*/node_modules/*' \
  -not -path './worktrees/*' \
  | sort
```

Use this inventory to build your architecture mental model (package names, responsibilities, and internal package dependencies). This step is mandatory and prevents stale assumptions like "the repo only has two packages."

### Step 1: Discover files

```bash
.agents/skills/architecture-scanner/scan.sh --discover
```

This scans the repo using discovery rules and creates or updates `files.json` in the skill folder. If `files.json` doesn't exist yet, it creates it with default priorities. If it already exists, it **adds new files** and **removes deleted files**, but **preserves user-set `importance` values** — those are never overwritten.

Discovery includes the root `package.json` and every workspace package manifest at `packages/*/package.json`, so package-level architecture is always represented in the docs.

Run this first to ensure the file list is current.

### Step 2: Determine what needs to be done

Run `--stale` to get the incremental manifest. This is the **default for all runs** unless architecture docs don't exist yet.

```bash
.agents/skills/architecture-scanner/scan.sh --stale
```

This uses **git history** to detect changes: it finds the most recent commit that touched `.agents/architecture/`, then diffs against `HEAD` to identify changed source files, and also includes uncommitted (staged/unstaged) changes.

`--stale` returns a JSON object with three incremental buckets:

- **`files`** — docs to create/update:
  - `"missing"` = source exists but doc does not (added/new file docs)
  - `"stale"` = source changed since last architecture update
- **`removed`** — docs to delete because source was removed/moved or is no longer tracked
- **`index`** — whether `architecture.index.md` should be regenerated (`"status": "stale"`) and why

If `files` and `removed` are both empty and `index.status` is `"fresh"`, docs are up to date.

**When `--stale` suggests a full scan:** If more than 50% of documented files need updates, output includes `"suggestion": "full_scan"` and a message. In this case, switch to a full scan:

```bash
.agents/skills/architecture-scanner/scan.sh --manifest
```

You can also force a full scan explicitly with:

```bash
.agents/skills/architecture-scanner/scan.sh --full
```

This outputs every non-low file regardless of change status. Use this for:
- **First-time runs** (no architecture docs exist yet)
- **Template changes** (when the doc format itself changed, so all docs need regeneration)
- **When `--stale` suggests it** (many files changed across multiple commits)
- **When the user explicitly requests a full scan**
- **When the user says natural-language variants like "full update" / "full refresh"**

**Low importance files are excluded from both manifests and should NOT get architecture docs.**

### Step 3: Generate or update documentation for each file

For each entry in `files` (from `--stale`) or each entry in the full manifest (`--manifest`/`--full`), produce a markdown file at:

```
.agents/architecture/{filepath}.md
```

For example:
- `src/storyboard/core/loader.js` → `.agents/architecture/src/storyboard/core/loader.js.md`
- `vite.config.js` → `.agents/architecture/vite.config.js.md`

#### For NEW files (status `"missing"`, or first full scan):

Create subdirectories as needed with `mkdir -p`. Use the **create** tool to write the doc file. The manifest's `doc` field contains the exact relative path to use.

#### For STALE files (status `"stale"`):

The doc already exists but the source file has changed. Follow this process:

1. **Read the source file** to understand what changed
2. **Read the existing doc file** to see what's already documented
3. **Use the edit tool** to update only the sections that are affected by the source changes — preserve the existing structure and any manually-added context that's still accurate
4. Do NOT recreate the file from scratch — make surgical updates

#### For REMOVED files (status `"removed"` in `removed` array):

Delete the stale architecture doc file referenced by the entry's `doc` field. If any docs are deleted, regenerate the index in Step 4.

**What to check when updating a stale doc:**
- Has the file's purpose changed? → Update **Goal**
- Have exports/functions/components changed? → Update **Composition**
- Have imports changed? → Update **Dependencies**
- Have downstream consumers changed? → Update **Dependents** (re-grep)
- Any new edge cases or behavior changes? → Update **Notes**

#### Doc template

Each doc file MUST follow this template:

```markdown
# `{filepath}`

<!--
source: {filepath}
category: {category}
importance: {importance}
-->

> [← Architecture Index](../architecture.index.md)

(Adjust the relative path based on nesting depth — e.g., `../../architecture.index.md` for files 2 levels deep like `src/storyboard/core/loader.js.md`)

## Goal

{1-2 paragraph architectural summary: what this file does, why it exists, and how it fits into the broader system. This should be readable by someone unfamiliar with the codebase.}

## Composition

{Detailed description of the file's structure: what it exports, key functions/components, internal organization, type signatures, parameter details. Include code samples from the actual source file to illustrate key exports, signatures, and patterns — don't just describe them in prose.}

## Dependencies

{List of significant imports — what this file depends on, and why}

## Dependents

{What depends on this file — who imports it, derived by grepping}

## Notes

{Any non-obvious behavior, edge cases, circular dependency considerations, or architectural decisions worth noting. Omit this section if there's nothing notable.}
```

**Rules for writing docs:**
- Read each file's actual content before writing its doc — do NOT guess
- The **Goal** section is the most important — it should be a clear, standalone summary (1-2 paragraphs) that anyone can read without expanding the details
- The remaining sections (Composition, Dependencies, Dependents, Notes) are all top-level headings — do NOT wrap them in a `<details>` element
- **Include code samples** — when describing exports, function signatures, component props, data shapes, or usage patterns, include actual code snippets from the source file. This makes docs scannable and concrete.
- **Cross-link file references** — every time a file path is mentioned anywhere in the documentation (Goal, Composition, Dependencies, Dependents, Notes, or the index), it MUST be a markdown hyperlink to that file's architecture doc. Use relative paths from the current doc to the target doc. For example, in a doc at `.agents/architecture/src/storyboard/context.jsx.md`, a reference to the loader would be written as [`src/storyboard/core/loader.js`](./core/loader.js.md). If the referenced file has no architecture doc (e.g., low-importance files), link to the source file on GitHub or leave it as plain text with a backtick code span.
- The "Dependents" section should be derived by grepping for imports of this file
- For `medium` importance files, keep it concise — shorter Goal, fewer code samples
- For `high` importance files, write a thorough Goal (2 paragraphs), comprehensive Composition with multiple code samples, and complete dependency/dependent lists

### Step 4: Generate the index

```bash
.agents/skills/architecture-scanner/scan.sh --index
```

This reads the generated doc files and creates `architecture.index.md` with a categorized table of contents.

Run this whenever `--stale` reports `index.status: "stale"` (including when files were changed, added, or removed).

**After the script generates the index**, you MUST enhance it by adding a prose overview for each category section. Read the `categories` array in `files.json` to determine category order, display names, and priority levels. The final index should follow this structure:

```markdown
# Architecture Index

> Auto-generated documentation of architecturally significant files.
> Run `scan the codebase architecture` to regenerate.

## {Category Name}

{Overview paragraph(s) — see priority rules below}

- [`path/to/file.js`](./path/to/file.js.md) — {one-line description}
- [`path/to/other.js`](./path/to/other.js.md) — {one-line description}

## {Next Category}
...
```

**Category configuration** is defined in `files.json` under the `categories` array:

```json
"categories": [
  { "id": "hypercanvas", "name": "Hypercanvas System", "priority": "critical", "order": 1 },
  { "id": "config", "name": "Configuration", "priority": "normal", "order": 5 }
]
```

- **`order`** — Controls the display order of categories in the index (ascending)
- **`name`** — The display heading used in the index (`## {name}`)
- **`priority`** — Controls the depth of the overview:
  - **`critical`** — The overview for this category should be 2-3x longer than normal. Write 3-4 paragraphs covering key concepts, data flow, architectural decisions, and how the parts interact. Include code samples or diagrams in the overview itself when helpful. These are the categories a new contributor must deeply understand.
  - **`normal`** — Standard 1-2 paragraph overview explaining purpose, key patterns, and relationships between files.

**Rules for the index:**
- Category sections are ordered by the `order` field in the `categories` array
- Each category section gets an architectural overview — length determined by `priority`
- Each link gets a brief one-line description (pulled from the file doc's Goal section)
- **Cross-link file references** — every file path mentioned in the overview text must link to its architecture doc (same rule as per-file docs)
- The opening architecture narrative must reflect the **full package inventory** from Step 0 (all `package.json` files), not just the packages currently documented in one category
- Write for someone unfamiliar with the codebase — the index is the entry point to understanding the architecture

### Step 5: Verify

- Confirm every file in the manifest has a corresponding `.md` doc
- Confirm every entry in `removed` had its doc file deleted
- Confirm `architecture.index.md` links to all docs
- Confirm every doc has a backlink to the index

### Step 6: Commit

```bash
git add .agents/architecture/ .agents/skills/architecture-scanner/
git commit -m "Update architecture documentation"
```
