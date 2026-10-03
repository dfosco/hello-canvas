---
name: design-system-catalog
description: Generates a new skill that catalogs all components from a React design system package installed in node_modules. Use when asked to generate a component catalog, catalog a design system, or create a catalog for a package.
---

# Design System Catalog Generator

> Triggered by: "generate component catalog", "create component catalog", "catalog components for [package]", "design system catalog", "create catalog for [package]", when the user wants to catalog an installed design system's components

## What This Does

Generates a **new skill** that catalogs all components from any React design system package installed in `node_modules`. The output skill provides the agent with a complete reference of available components, sub-components, and props.

## When This Applies

- User installs a new design system and wants an agent-readable component reference
- User wants to create a component catalog for an existing dependency
- A design system package is upgraded and the catalog needs regenerating

## How It Works

The extractor uses a **TypeScript-first** strategy:

1. **Find declarations** — Locates the package's `.d.ts` entry point via `package.json` fields (`types`, `typings`, `exports["."].types`, `typesVersions`) or common paths (`dist/index.d.ts`, etc.)
2. **Walk exports** — Recursively follows `export *` and `export { ... } from` to discover all PascalCase exports (components)
3. **Extract details** — For each component, parses `.d.ts` files for `*Props` types and sub-component declarations
4. **Auto-categorize** — Infers categories from the package's directory structure (e.g., `dist/layout/` → Layout). Falls back to alphabetical grouping
5. **Runtime enrichment** — Optionally tries `import()` to detect compound component sub-components (best-effort, skipped if the package can't be imported in Node)

## Prerequisites

- The design system package **must be installed** in `node_modules`
- The package should ship TypeScript declarations (`.d.ts`) or have `@types/*` available
- Node.js must be available

## Steps

### Step 1 — Ask for the package

Ask the user which design system package to catalog. They should provide:
- **Package name** (required): e.g., `@primer/react`, `@chakra-ui/react`, `antd`, `@mui/material`
- **Display name** (optional): e.g., "Primer React", "Chakra UI". Auto-derived if not provided.

### Step 2 — Verify installation

Check that the package exists in `node_modules`:

```bash
ls node_modules/<package-name>/package.json
```

If not found, tell the user to run `npm install <package-name>` first.

### Step 3 — Run the generator

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
.agents/skills/design-system-catalog/generate-catalog.sh "<package-name>" "<display-name>"
```

The script will:
1. Extract all components from the package's TypeScript declarations
2. Create a new skill directory: `.agents/skills/<name>-components-catalog/`
3. Generate `SKILL.md` with the full component catalog
4. Generate `extract-components.sh` for future regeneration

### Step 4 — Report results

Tell the user:
- How many components were found
- Where the generated skill lives
- How to regenerate when the package is upgraded
- Suggest they review the catalog and customize categories if needed

## Output Structure

The generator creates:

```
.agents/skills/<name>-components-catalog/
  SKILL.md                  # Skill file with triggers, usage, and full catalog
  extract-components.sh     # Thin wrapper to regenerate the catalog
```

Where `<name>` is derived from the package name (e.g., `@primer/react` → `primer-react`).

## Customization

After generation, the user can:
- Edit category groupings in the generated `SKILL.md`
- Add codebase-specific conventions (e.g., "never use Box", "prefer CSS Modules over sx")
- Add or remove components from the catalog
- Change trigger conditions

## Regeneration

Each generated skill includes an `extract-components.sh` that calls back to this skill's shared extractor. To regenerate:

```bash
.agents/skills/<name>-components-catalog/extract-components.sh
```

This should be run whenever the design system package is upgraded.
