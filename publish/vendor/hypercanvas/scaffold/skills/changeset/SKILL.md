---
name: changeset
description: Changeset versioning and management system. Use when creating changesets, bumping versions, or tagging releases. For full releases (publish to npm), use the `release` skill instead.
metadata:
  author: Daniel Fosco
  version: "2026.3.09"
---

# Changeset Skill

> Triggered by: "bump version", "create changeset", "version bump", "patch bump", "minor bump", "major bump", "tag release", "run changeset", "changeset"

## What This Does

Guides the agent through the changesets versioning workflow using `@changesets/cli` — from creating a changeset file to bumping the version, updating the changelog, creating a git tag, committing, and optionally publishing to npm.

## Workflow Modes

This skill supports two workflows depending on the user's intent:

| Intent | Steps |
|--------|-------|
| **"create changeset"** / **"bump version"** | Steps 1–5 (version & tag only) |
| **"release"** / **"publish"** | Steps 1–6 (version, tag, and publish to npm) |

If the user says "release" or "publish", run all steps including Step 6.
If the user only wants a version bump or changeset, stop after Step 5.

---

## How to Execute

### Step 1: Create a changeset

Run `npx changeset` interactively OR create a changeset file manually in `.changeset/`. The file should have a YAML frontmatter block specifying the package name and bump type (`patch`/`minor`/`major`), followed by a markdown summary.

Example changeset file (`.changeset/some-name.md`):

```md
---
"@dfosco/hypercanvas": patch
---

fix: resolve missing CSS module build failure
```

For patch/minor/major selection:

- **patch** — bug fixes, small tweaks
- **minor** — new features, non-breaking changes
- **major** — breaking changes

The changeset file name doesn't matter — it gets deleted after versioning.

### Step 2: Version bump

```bash
npm run version
```

This calls `changeset version`, which:

- Consumes all pending changeset files in `.changeset/`
- Bumps the version in `package.json`
- Updates `CHANGELOG.md`
- Deletes the consumed changeset files

**Note:** `changeset version` does NOT create git tags — that's a separate step.

### Step 3: Commit the version bump

```bash
git add .
git commit -m "chore: version X.Y.Z"
```

Replace `X.Y.Z` with the new version from `package.json`.

Always commit the version bump BEFORE running `npm run tag`.

### Step 4: Create git tag

```bash
npm run tag
```

This calls `changeset tag`, which creates an `@dfosco/hypercanvas@X.Y.Z` git tag from the workspace version.

### Step 5: Push

```bash
git push --follow-tags
```

### Step 6: Publish to npm (only for releases)

**Only run this step if the user asked to "release" or "publish".**

Ask the user which publish method they prefer:

#### Option A: Let GitHub Actions handle it (PR-based)

No extra steps needed — pushing to `main` triggers the publish workflow in `.github/workflows/publish.yml`. The action will:

1. Open a PR titled **"chore: version packages"** if changeset files exist
2. Publish all packages to npm when that PR is merged

Tell the user to merge the version PR on GitHub to trigger publication.

#### Option B: Publish directly from local (no PR)

```bash
npm login                    # if not already authenticated
npx changeset publish        # publish all packages to npm
```

This publishes all packages in the monorepo that have unpublished versions. The `changeset publish` command reads each `package.json` version and publishes to npm if that version isn't already on the registry.

After publishing, verify on npm:

```bash
npm view @dfosco/hypercanvas version
```

---

## Notes

- `changeset version` does NOT create git tags — that's why `npm run tag` is a separate step
- Always commit the version bump BEFORE running `npm run tag`
- The published workspace is `@dfosco/hypercanvas`; root version synchronization is handled by `scripts/sync-root-version.js`
- The release workflow creates the GitHub Release from `@dfosco/hypercanvas@<version>` tags

---

## Beta Prerelease Workflow

Changesets supports prerelease versions natively. The release script handles this automatically.

### Usage

```bash
npm run build:beta       # beta prerelease (e.g. 1.3.0-beta.0)
```

The script enters changesets prerelease mode, runs the normal workflow, and exits prerelease mode after publishing. Subsequent prereleases increment the suffix: `-beta.1`, `-beta.2`, etc.

### Manual prerelease steps

If running manually instead of using the script:

```bash
npx changeset pre enter beta    # enter prerelease mode
npx changeset                    # create changeset as usual
npx changeset version            # versions become X.Y.Z-beta.0
git add -A && git commit -m "chore: version packages (beta)"
npm publish --workspace @dfosco/hypercanvas --access public --tag beta
npx changeset pre exit           # exit prerelease mode
git push --follow-tags
```

**Important:** Always pass `--tag beta` to `npm publish` so the prerelease doesn't become the `latest` tag on npm.

### Branch strategy

Do prereleases from a **dedicated branch** (not `main`). If prerelease mode is active on `main`, stable hotfixes are blocked until you exit it. See `releasing.md` for details.
