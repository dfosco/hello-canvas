---
name: migrate
description: Migrates a client Hypercanvas project to the latest version. Handles breaking changes in config, routes, and features.
---

# Migrate

> Triggered by: "migrate", "upgrade Hypercanvas", "run migration", "update to latest", "breaking changes", "what changed"

## What This Does

Walks through all breaking changes between Hypercanvas versions and applies the necessary updates to the client project. Each migration step is idempotent — safe to run multiple times.

---

## Migrations

### From 0.10.x → 0.11.0-beta.0

#### 1. Prototype Vite-overlay isolation now ships from the package

Previously, the scaffolded `src/library/mount.jsx` imported
`installPrototypeOverlayIsolation` from `'../prototypeOverlayIsolation.js'`
— but the scaffold never actually shipped that sibling file, so clients
either authored it themselves or hit an unresolved import. The helper is
pure dev-mode Vite plumbing with no per-project customization, so it now
ships from the package as `@dfosco/hypercanvas/vite/dev-overlay-isolation`.

**Steps:**

1. Re-scaffold `src/library/mount.jsx` (run `npx storyboard setup`, or
   diff the scaffold against the client's copy). The new import line is:

   ```jsx
   import { installPrototypeOverlayIsolation } from '@dfosco/hypercanvas/vite/dev-overlay-isolation'
   ```

   It replaces the old:

   ```jsx
   import { installPrototypeOverlayIsolation } from '../prototypeOverlayIsolation.js'
   ```

2. If the client has a hand-authored `src/prototypeOverlayIsolation.js`,
   **delete it.** Keeping a stale local copy is harmless (it won't be
   imported) but it diverges from upstream and will quietly miss future
   fixes to the helper.

3. Verify: trigger an intentional syntax error in any file under
   `src/prototypes/` and confirm the canvas page still renders (the
   broken-prototype iframe will show the Vite overlay; the surrounding
   canvas should not).

---

### From 4.1.x / 4.2.x → 4.3.0

#### 1. Homepage route: `/viewfinder` → `/workspace`

The Hypercanvas homepage URL changed from `/viewfinder` to `/workspace`. The old route still works as a redirect for one release cycle.

**Steps:**

1. If the client has `src/prototypes/viewfinder.jsx`, rename it to `src/prototypes/workspace.jsx`
2. Search `storyboard.config.json` for any `"/viewfinder"` strings and replace with `"/workspace"`
3. Search any custom toolbar or command palette config overrides for `"viewfinder"` tool ID references and replace with `"workspace"`
4. If the client has `customerMode.protoHomepage` or `customerMode.homepage`, no change needed — those override the homepage entirely

**localStorage keys migrated automatically at runtime** — no manual action needed:
- `sb-viewfinder-starred` → `sb-workspace-starred`
- `sb-viewfinder-recent` → `sb-workspace-recent`
- `sb-viewfinder-group-folders` → `sb-workspace-group-folders`

---

#### 2. Canvas config — terminal + agents + hot pool

**As of `0.6.0-beta.4`, terminal + agent config has its own dedicated file: `terminal.config.json` at the project root.** The library ships full defaults in `node_modules/@dfosco/hypercanvas/terminal.config.json` and a copy is auto-scaffolded to `.storyboard/scaffold/terminal.config.json` on every dev-server boot. Most clients won't need any project-level config — the defaults cover Copilot/Claude/Codex with auto-resume and OpenCode with conservative fresh-session startup.

**Only create a root `terminal.config.json`** if you want to override specific keys. Leaf-level merge means you set only what you change; everything else inherits the library defaults (so future agents and tweaks reach you automatically). Example minimal override:

```jsonc
{
  "terminal": {
    "fontSize": 18,
    "fontFamily": "'Ghostty', 'SF Mono', monospace"
  },
  "agents": {
    "copilot": {
      "startupCommand": "copilot --remote --agent terminal-agent"
    }
  }
}
```

**Legacy back-compat.** Existing clients with `canvas.terminal` and `canvas.agents` blocks under `storyboard.config.json` continue to work — the loader merges them with the new file (with `terminal.config.json` winning on overlap, and a warning logged). New clients should prefer `terminal.config.json` and keep `storyboard.config.json` lean.

**Full reference for what `terminal.config.json` accepts** (don't copy this into a new project unless you actually need to override every key — the library ships these as defaults):

```jsonc
{
  // Terminal widget settings (the plain terminal, not agents)
  "terminal": {
    "fontSize": 18,
    "fontFamily": "'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace",
    "prompt": "❯ ",
    "startupCommand": null,
    "defaultStartupSequence": null,
    "resizable": true,
    "defaultWidth": 1000,
    "defaultHeight": 600
  },

  // Agent widgets — each key becomes an entry in the "Add Agent" menu
  // Remove any agents the client doesn't have installed
  "agents": {
    "copilot": {
      "label": "Copilot CLI",
      "default": true,
      "icon": "primer/copilot",
      "startupCommand": "copilot --agent terminal-agent",
      "resumeCommand": "copilot --resume={id} --agent terminal-agent",
      "sessionIdEnv": "COPILOT_AGENT_SESSION_ID",
      "postStartup": "/allow-all on",
      "readinessSignal": "Environment loaded:",
      "resizable": true
    },
    "claude": {
      "label": "Claude Code",
      "icon": "claude",
      "startupCommand": "claude --agent terminal-agent --dangerously-skip-permissions",
      "resumeCommand": "claude --resume {id} --agent terminal-agent --dangerously-skip-permissions",
      "sessionIdEnv": "CLAUDE_SESSION_ID",
      "sessionStateGlob": "~/.claude/projects/*/{id}.jsonl",
      "resizable": true,
      "readinessSignal": "bypass permissions"
    },
    "codex": {
      "label": "Codex CLI",
      "icon": "codex",
      "startupCommand": "codex --full-auto",
      "resumeCommand": "codex resume {id}",
      "sessionIdEnv": "CODEX_SESSION_ID",
      "sessionStateGlob": "~/.codex/sessions/**/rollout-*-{id}.jsonl",
      "configFiles": [".codex/config.toml"],
      "resizable": true
    },
    "opencode": {
      "label": "OpenCode",
      "startupCommand": "opencode",
      "resumeCommand": null,
      "resumeLastCommand": null,
      "readinessSignal": null,
      "resizable": true
    }
  },

  // Set to true to show agent entries in the canvas "+" add menu
  // Set to false to only show them in the command palette
  "showAgentsInAddMenu": false
}
```

**How to customize for the client:**

| Setting | How to adapt |
|---------|-------------|
| `terminal.fontFamily` | Match the client's preferred monospace font. Remove `'Ghostty'` if they don't use it. |
| `terminal.fontSize` | `14`–`18` is typical. `18` for presentation-style canvases, `14` for compact. |
| `terminal.defaultWidth/Height` | Pixel dimensions for new terminal widgets. `1000×600` is a good default. |
| `agents.copilot.postStartup` | `/allow-all on` auto-approves Copilot tool calls. Remove if the client wants manual approval. |
| `agents.copilot.readinessSignal` | The string to look for in CLI output that means the agent is ready. Must match exactly. |
| `agents.*.configFiles` | Array of config files the agent needs (e.g. `.codex/config.toml`). Only relevant for Codex. |
| `agents` keys | Remove agents the client doesn't have installed. Each key must be a CLI command available in PATH. |

**Agent config property reference:**

| Property | Required | Description |
|----------|----------|-------------|
| `label` | yes | Display name in the Add Agent menu |
| `icon` | no | Icon name (`primer/copilot`, `claude`, `codex`, or any Icon.jsx name) |
| `startupCommand` | yes | Shell command to start the agent |
| `resumeCommand` | no | Full launch template to resume a session, with `{id}` placeholder (e.g. `copilot --resume={id} --agent terminal-agent`). Used both for auto-resume on cold restart and for the interactive "Browse existing sessions" flow. |
| `sessionIdEnv` | no | Env var exposed in the agent SessionStart hook payload that holds its session id (e.g. `COPILOT_AGENT_SESSION_ID`). When set, widget cold restarts auto-resume the previous session. |
| `sessionStateDir` | no | Directory where the agent stores per-session state, used to pre-flight `--resume` (e.g. `~/.copilot/session-state`). Pass `null` to skip the fs check (UUID-only validation). |
| `sessionStateGlob` | no | Glob to validate session existence for agents that store sessions in nested subdirs. Supports `<root>/*/{id}.jsonl` (Claude) and `<root>/**/<name-with-{id}>` (Codex). |

**Codex CLI: one-time hook trust.** Codex requires explicit user trust for non-managed hooks (`Non-managed command hooks must be reviewed and trusted before they run`). After the first dev-server boot, run `codex` interactively in any directory and enter `/hooks`, navigate to SessionStart, and enable the `storyboard-capture` hook. Trust persists in `~/.codex/state_*.sqlite`. Until trusted, Codex agent widgets will launch fresh on restart instead of resuming.
| `postStartup` | no | Text sent to the agent's stdin after it starts |
| `readinessSignal` | no | Substring to wait for in output before marking agent as ready |
| `configFiles` | no | Array of config file paths the agent requires |
| `resizable` | no | Whether the agent widget can be resized (default `false`) |
| `defaultWidth` | no | Default widget width in pixels |
| `defaultHeight` | no | Default widget height in pixels |
| `default` | no | If `true`, this agent is pre-selected in menus |

---

#### 3. Hot pool config (recommended)

Hot pooling pre-warms agent sessions in the background so they start instantly when a user adds a widget. Without it, there's a cold-start delay every time.

**Add this to `storyboard.config.json` if missing:**

```jsonc
{
  "hotPool": {
    "enabled": true,
    "verbose": false,
    "default_pool_size": 1,
    "default_max_pool_size": 3,
    "load_balancer": true,
    "load_balancer_cooldown_mins": 10,
    "pools": {
      // One pool per widget type. Keys must match agent IDs above
      // plus "terminal" and "prompt" for built-in types.
      "terminal": { "pool_size": 1 },
      "copilot": { "pool_size": 1 },
      "claude": { "pool_size": 1 },
      "codex": { "pool_size": 1 },
      "prompt": { "pool_size": 1 }
    }
  }
}
```

**How to customize:**

| Setting | How to adapt |
|---------|-------------|
| `default_pool_size` | Number of sessions pre-warmed per agent type. `1` is fine for most teams. |
| `default_max_pool_size` | Maximum concurrent sessions per type. `3` handles parallel use. |
| `pools.*.pool_size` | Override pool size for specific types. Remove entries for agents the client doesn't use. |
| `load_balancer` | Distributes sessions across pools. Set `false` if only one agent type is used. |
| `load_balancer_cooldown_mins` | Minutes between load balancer rebalance cycles. `10` is sensible. |

**Important:** Every key in `pools` must either be a built-in type (`terminal`, `prompt`) or match an agent ID defined in `canvas.agents`. Mismatched keys are silently ignored.

---

#### 4. Agent definition files (`.agents/`)

Canvas agents need agent definition files to provide instructions. These are scaffolded automatically by `storyboard setup`, but if the client doesn't have them:

**Check if `.agents/agents/` exists.** If missing, create these two files:

**`.agents/agents/terminal-agent.agent.md`** — Instructions for terminal-based agents (Copilot, Claude, Codex). The `--agent terminal-agent` flag in the startup commands references this file.

**`.agents/agents/prompt-agent.agent.md`** — Instructions for single-shot prompt agents.

Both files are scaffolded from `packages/storyboard/scaffold/agents/`. Run `npx storyboard setup` to auto-create them, or copy them manually from the Hypercanvas package.

---

#### 5. Customer mode config (optional)

If the client deploys Hypercanvas for external users (not just internal design), they may want customer mode:

```json
{
  "customerMode": {
    "enabled": false,
    "homepage": false,
    "tools": "all",
    "commandPalette": true,
    "branchBar": true
  }
}
```

| Setting | Description |
|---------|-------------|
| `enabled` | Master toggle for customer mode |
| `homepage` | `false` = default workspace, `true` = empty page, or a string (`"landing"`, `"/MyProto"`, `"https://..."`) to redirect from `/`, `/workspace`, `/viewfinder` |
| `tools` | `"all"` (default), `"none"`, `{ "hide": [keys] }`, or `{ "only": [keys] }` — granular toolbar tool gating |
| `commandPalette` | `false` hides Cmd+K (button + shortcut) |
| `branchBar` | `false` hides the top branch/dev bar |

**Legacy keys still accepted (auto-mapped):** `hideChrome`, `hideHomepage`, `protoHomepage`, `canvasHomepage`. New configs should use the canonical shape above.

This block is optional. Only add it if the client needs to customize the chrome visibility.

---

## Procedure

### Step 1: Read the client's current config

Read `storyboard.config.json` and `package.json` to understand what version they're on and what config blocks already exist.

### Step 2: Apply migrations in order

For each section above, check if the change has already been applied. If not:
- For config additions: show the client what will be added and ask before writing
- For renames: apply directly (they're mechanical)
- For `.agents/` scaffolding: run `npx storyboard setup` or create files manually

### Step 3: Run `npx storyboard setup`

This ensures `.agents/`, `.storyboard/`, asset directories, and proxy configuration are all up to date.

### Step 4: Verify

Run `npm run build` to verify nothing is broken.

### Step 5: Summary

Print a summary of all changes made.
