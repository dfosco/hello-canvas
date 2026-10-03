---
name: hypercanvas-core
description: Guide for adding CoreUIBar menu buttons and wiring action handlers in the Hypercanvas package. Use when adding toolbar buttons, menu items, or action handlers to the CoreUIBar.
---

# Hypercanvas Core — CoreUIBar & Menu Buttons

Guide for adding new menu buttons to the Hypercanvas CoreUIBar — the floating toolbar at the bottom-right of every prototype page.

## Golden Rule

**Everything added to Hypercanvas must either be a new system or conform to an existing system.** Do not hardcode behavior — use config declarations + registered action handlers. The CoreUIBar is config-driven end-to-end.

## Overview

The CoreUIBar is a config-driven floating React toolbar rendered by `packages/storyboard/src/core/ui/CoreUIBar.jsx`. All buttons are defined in `packages/storyboard/toolbar.config.json` under the `tools` key. The toolbar reads this config at startup, filters tools by the current mode and surface, and renders them in JSON key order.

> **For the full how-to (config schema, render types, handler module interface, surface reference, recipes, registration of custom client handlers via `mountStoryboardCore({ handlers })`), see the canonical [`hypercanvas-tools`](../hypercanvas-tools/SKILL.md) skill.** This skill keeps only what's specific to working **inside** Hypercanvas itself.

## Architecture

```
toolbar.config.json                            ← Tool declarations
    ↓
packages/storyboard/src/core/ui/CoreUIBar.jsx  ← React; reads config, mounts tools
    ↓
packages/storyboard/src/core/tools/
├── registry.js                                ← Core handler module map (core:* prefix)
├── handlers/<name>.js                         ← One per built-in tool (flows, theme, …)
└── surfaces/                                  ← Per-surface render orchestration
    ↓
React renderers in core/ui/ (TriggerButton, ActionMenuButton, CommandMenu, …)
or the custom React component returned by the handler's component() export.
```

The handler module interface — `id`, `guard(ctx)`, `setup(ctx)`, `handler(ctx)`, `component()` — is documented in [`hypercanvas-tools/SKILL.md`](../hypercanvas-tools/SKILL.md#handler-module-interface) and is identical for core (`core:*`) and consumer (`custom:*`) handlers.

## Adding a built-in tool to Hypercanvas

1. **Add the config entry** to `packages/storyboard/toolbar.config.json` under `tools`. See the [config reference](../hypercanvas-tools/SKILL.md#config-reference) for required fields.
2. **Create the handler module** at `packages/storyboard/src/core/tools/handlers/<name>.js`. Export at minimum `id`. Add `guard`, `setup`, `handler`, and/or `component` as needed for the render type.
3. **Register the lazy loader** in `packages/storyboard/src/core/tools/registry.js`:
   ```js
   export const coreHandlers = {
     // …
     'my-tool': () => import('./handlers/myTool.js'),
   }
   ```
4. **(Custom React component, optional)** If you need a custom component instead of the default `TriggerButton` / `ActionMenuButton` renderer, drop the `.jsx` file in `packages/storyboard/src/core/ui/` and lazy-import it from `component()`:
   ```js
   export async function component() {
     const mod = await import('../../ui/MyToolButton.jsx')
     return mod.default
   }
   ```

The CoreUIBar load loop (`packages/storyboard/src/core/ui/CoreUIBar.jsx` — search for `Object.entries(toolConfigs).map`) iterates **every** tool across every surface and resolves `core:` vs `custom:` via the `handler` field's prefix.

## Icon namespaces

`packages/storyboard/src/core/ui/Icon.jsx` resolves multi-source icon names:

| Prefix | Source | Style | Example |
|--------|--------|-------|---------|
| `primer/` | Primer Octicons | fill | `primer/repo`, `primer/gear`, `primer/comment` |
| `feather/` | Feather Icons | stroke | `feather/fast-forward`, `feather/tablet` |
| `iconoir/` | Iconoir (registered) | stroke | `iconoir/plus-circle`, `iconoir/square-dashed` |
| *(none)* | Custom overrides | fill | `home`, `folder`, `folder-open`, `prototype`, `canvas` |

Icon meta props (passed via tool config `meta`): `strokeWeight`, `scale`, `rotate`, `flipX`, `offsetX`, `offsetY`.

> Primer icon names must be verified against `.agents/data/primer-octicons.json` before use — agents frequently invent names that don't exist.

## Tool visibility

A tool may be hidden by any of the following:

- **Mode filtering** — `"modes": ["canvas"]` only shows the tool when the canvas mode is active. `["*"]` always.
- **Surface filtering** — `surface` controls *where* a tool can appear; tools in `command-palette` only show inside ⌘K, etc.
- **Route exclusion** — `"excludeRoutes": ["^/viewfinder"]` hides on regex-matching routes.
- **UI config** — `storyboard.config.json` → `ui.hide.menus: ["my-tool"]` (legacy key, still honored).
- **Tool state store** — `toolStateStore` can mark a tool `'hidden'` or `'disabled'` at runtime.
- **`guard()` returning `false`** — handler-level gate; skips `setup`/`handler`/`component` entirely.
- **`getChildren()` returning `[]`** — menu/submenu tools auto-hide when empty.

## Built-in tools (selected reference)

A non-exhaustive list of currently shipped core tools — useful as code-reading entry points. See `packages/storyboard/toolbar.config.json` for the live list and `packages/storyboard/src/core/tools/handlers/` for the implementations.

| Tool key | Render | Surface | Handler module |
|----------|--------|---------|----------------|
| `command-palette` | `button` | `command-toolbar` | `handlers/commandPalette.js` |
| `flows` | `menu` | `command-toolbar` | `handlers/flows.js` |
| `theme` | `menu` | `command-toolbar` | `handlers/theme.js` |
| `create` | `menu` | `command-toolbar` | `handlers/create.js` |
| `comments` | `button` | `command-toolbar` | `handlers/comments.js` |
| `hide-chrome` | `button` | `command-toolbar` | `handlers/hideChrome.js` |
| `inspector` | `sidepanel` | `command-toolbar` | `handlers/inspector.js` |
| `devtools` | `submenu` | `command-palette` | `handlers/devtools.js` |
| `canvas-zoom` | `zoom-control` | `canvas-toolbar` | `handlers/canvasToolbar.js` |

## Optional & Heavy Dependencies in Published Packages

The `packages/storyboard` directory is published to npm as `@dfosco/hypercanvas`. Consumers may not install every optional dependency (e.g. `ghostty-web` for terminal widgets, WASM modules).

**When adding an import for a package that isn't a hard dependency:**

1. **Use `@vite-ignore` on dynamic imports** — `import(/* @vite-ignore */ 'pkg')` prevents Vite's import analysis from throwing a pre-transform error when the package isn't installed.
2. **Always `.catch()` and return `null`** — the feature should degrade gracefully, not crash the entire app.
3. **Null-guard all usage** — after `await loadSomething()`, check for `null` before accessing any module exports.
4. **Declare as optional peerDependency** — add the package to `peerDependencies` and mark it optional in `peerDependenciesMeta`:

```json
{
  "peerDependencies": {
    "some-heavy-pkg": ">=1.0.0"
  },
  "peerDependenciesMeta": {
    "some-heavy-pkg": { "optional": true }
  }
}
```

**Example pattern (from TerminalWidget.jsx):**

```js
let promise = null
function loadOptionalDep() {
  if (!promise) {
    promise = import(/* @vite-ignore */ 'ghostty-web')
      .then(async (mod) => { if (mod.init) await mod.init(); return mod })
      .catch((err) => { promise = null; console.warn('[Widget] not available:', err.message); return null })
  }
  return promise
}

// Usage:
const mod = await loadOptionalDep()
if (!mod) return // graceful degradation
```
