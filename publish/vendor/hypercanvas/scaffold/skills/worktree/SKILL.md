---
name: worktree
description: Creates a git worktree in worktrees/<branch-name> and switches into it. Use when asked to create a worktree, new worktree, or worktree for a branch.
---

# Worktree Skill

> Triggered by: "create worktree", "new worktree", "worktree for", "worktree"

## What This Does

Creates a git worktree for a given branch name inside `worktrees/` and switches into it.

---

## How to Execute

When the user asks for a worktree named `<branch-name>`:

### Preferred: Use `npx storyboard dev <branch>`

The `storyboard` CLI handles the full worktree lifecycle in a single command. (Plain `npm run dev` only starts a server for the current worktree — to target a different worktree from anywhere, use the CLI directly.)

```bash
npx storyboard dev <branch-name>
```

This will:

1. **Create the worktree** at `worktrees/<branch-name>` if it doesn't exist — creates the branch **from the current branch** if needed, or checks out an existing local/remote branch
2. **Assign a dev-server port** (written to `worktrees/ports.json`)
3. **Install dependencies** (`npm install`) in the new worktree
4. **Start the dev server** with the correct base path and Caddy proxy route
5. **Print the URL** — `http://<domain>.localhost/branch--<branch-name>/storyboard/`

```bash
# From anywhere in the repo:
npx storyboard dev my-feature       # creates worktree if needed, starts dev
npx storyboard dev main             # start dev for repo root
npx storyboard dev --no-create foo  # error if "foo" worktree doesn't exist
```

Use `--no-create` to disable auto-creation (strict mode — only targets existing worktrees).

After the command runs, `cd` into the worktree for subsequent work:

```bash
cd worktrees/<branch-name>
```

**Skip `npx storyboard dev` if the worktree skill was invoked from the ship skill** — ship runs the dev server as its own final step to avoid starting it twice. In that case, use the manual method below to create the worktree without starting the dev server.

### Manual fallback (when you need a worktree without a dev server)

**Always resolve the repository root first:**

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
```

Then create the worktree at `$REPO_ROOT/worktrees/<branch-name>`. Never use a relative `worktrees/` path — it can resolve incorrectly when the current directory is itself inside a worktree.

If the branch already exists locally or on the remote:

```bash
git worktree add "$REPO_ROOT/worktrees/<branch-name>" <branch-name>
```

If the branch does NOT exist yet, create it **from the current branch** (NOT from main):

```bash
# Determine the current branch to use as the base
CURRENT_BRANCH=$(git branch --show-current)

git worktree add "$REPO_ROOT/worktrees/<branch-name>" -b <branch-name> "$CURRENT_BRANCH"
```

> **⚠️ CRITICAL:** Always pass the current branch as the start-point to `git worktree add -b`. Without it, git defaults to HEAD of the main worktree, which may be a completely different branch. The user expects the new worktree to be based on whatever branch they are currently working in.

Then change into it:

```bash
cd "$REPO_ROOT/worktrees/<branch-name>"
```

Confirm with:

```bash
pwd && git branch --show-current
```

---

## Notes

- **⚠️ New worktrees MUST branch from the CURRENT branch**, not from main or the main worktree's HEAD. When the user says "create worktree X" while on branch `4.2.7`, the new branch must be based on `4.2.7`. Always use `git worktree add <path> -b <name> <current-branch>` with an explicit start-point. The only exception is if the user explicitly says to branch from a different base (e.g., "create worktree X from main").
- **Worktrees MUST live in `worktrees/` at the REPOSITORY ROOT — never anywhere else.** The repository root is the top-level git directory (use `git rev-parse --show-toplevel` to find it). If you are currently inside a worktree (e.g. `worktrees/4.0.0/`), do NOT create nested worktrees inside it (e.g. `worktrees/4.0.0/worktrees/`). Always `cd` to the repo root or use an absolute path to the root `worktrees/` directory.
- **⚠️ Nesting detection:** Before creating a worktree, check if your current working directory is already inside a `worktrees/` directory. If `pwd` contains `/worktrees/`, you are inside a worktree — resolve the true repo root with `git -C "$(git rev-parse --show-toplevel)" rev-parse --show-superproject-working-tree` or walk up the path to find the first directory that is NOT inside `worktrees/`. Never trust `git rev-parse --show-toplevel` alone when inside a worktree — it returns the worktree root, not the repo root.
- The branch name comes from the user's request (e.g., "create worktree comments-redo" → branch is `comments-redo`).
- If the worktree already exists, inform the user and `cd` into it instead of recreating it.
- Port assignments are stable — once a worktree gets a port, it keeps it across restarts.
- To see all assigned ports, check `worktrees/ports.json`.
