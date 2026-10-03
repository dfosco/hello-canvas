---
name: hypercanvas-tools
description: Declarative toolbar tool system architecture — config schema, handler modules, surfaces, render types, guards, and context. Use when creating, debugging, or extending toolbar tools.
---

# Toolbar Tool System

## Overview

The Hypercanvas toolbar tool system provides a declarative, plugin-based architecture for adding interactive tools to the application chrome. Tools are declared in `toolbar.config.json` and resolved at runtime through handler modules.

The system separates **what** a tool does (handler module) from **where** it appears (surface) and **how** it renders (render type). This lets you compose tools flexibly — the same handler logic can power a toolbar button, a command palette entry, or a canvas control.

### Key concepts

| Concept | Description |
|---------|-------------|
| **Tool** | A single entry in `toolbar.config.json` — config + optional handler module |
| **Surface** | Where the tool renders: `command-toolbar`, `canvas-toolbar`, or `command-palette` |
| **Render type** | How the tool renders: `button`, `menu`, `sidepanel`, `separator`, `zoom-control`, `link`, `submenu` |
| **Handler** | A JS module that provides guard/setup/handler/component exports |
| **Guard** | An async function that returns `false` to prevent a tool from loading |
| **ctx** | The context object passed to handler functions: `{ basePath, showFlowInfoDialog, config }` |

---

## Quick Start

Follow these steps to create a new toolbar tool:

### 1. Add the tool config

Open `toolbar.config.json` and add your tool entry under the `tools` key:

```json
{
  "tools": {
    "my-tool": {
      "ariaLabel": "My Tool",
      "icon": "primer/gear",
      "render": "button",
      "surface": "command-toolbar",
      "handler": "core:my-tool",
      "modes": ["*"]
    }
  }
}
```

### 2. Create the handler module

Create a new file at `tools/handlers/myTool.js`:

```js
export const id = 'my-tool'

export async function handler(ctx) {
  return {
    execute() {
      console.log('My tool was clicked!')
    },
  }
}
```

### 3. (Optional) Add a custom component

If the default rendering for your render type isn't enough, export a `component()` function that returns a React component:

```js
export async function component() {
  const mod = await import('../../MyToolButton.jsx')
  return mod.default
}
```

### 4. Test it

Run `npm run dev` and verify your tool appears in the correct surface.

---

## Config Reference

Each tool is an entry in the `tools` object of `toolbar.config.json`. The key becomes the tool's identifier.

```json
{
  "tools": {
    "tool-id": {
      "ariaLabel": "Human-readable label",
      "icon": "primer/icon-name",
      "render": "button",
      "surface": "command-toolbar",
      "handler": "core:tool-id",
      "modes": ["*"],
      "excludeRoutes": ["\\/canvas$"],
      "actions": ["feature-a", "feature-b"],
      "position": "left"
    }
  }
}
```

### Config keys

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `ariaLabel` | `string` | Yes | Accessible label for the tool. Used as tooltip and screen reader text. |
| `icon` | `string` | No | Icon identifier in `primer/icon-name` format. Used by default button/menu renderers. |
| `render` | `string` | Yes | How the tool renders. See [Render Types](#render-types). |
| `surface` | `string` | Yes | Where the tool appears. See [Surface Reference](#surface-reference). |
| `handler` | `string` | Yes | Handler module reference. Format: `core:name` or `custom:name`. |
| `modes` | `string[]` | Yes | App modes where the tool is visible. `["*"]` = all modes. `["prototype"]` = only in prototype mode. |
| `excludeRoutes` | `string[]` | No | Array of regex patterns. If the current route matches any pattern, the tool is hidden. |
| `actions` | `string[]` | No | Feature identifiers passed to the handler via `config.actions`. Used by tools like `create` to configure which actions are available. |
| `position` | `string` | No | Layout hint for the surface renderer (e.g., `"left"`, `"right"`). |

### Handler reference format

The `handler` field uses a prefix to indicate where to resolve the module:

| Prefix | Resolution | Example |
|--------|-----------|---------|
| `core:` | Built-in handler from `tools/handlers/` inside Hypercanvas | `"core:flows"` |
| `custom:` | Consumer-provided handler registered via `mountStoryboardCore()` | `"custom:cursors"` |

### Mode values

Modes control when a tool is visible based on the current app state:

| Value | Description |
|-------|-------------|
| `"*"` | Tool is visible in all modes |
| `"prototype"` | Tool is only visible when viewing a prototype |
| `"canvas"` | Tool is only visible in canvas mode |

Use an array to combine: `["prototype", "canvas"]` means the tool shows in either mode.

### Route exclusion

`excludeRoutes` takes an array of regex pattern strings. Each is tested against the current route path. If any matches, the tool is hidden.

```json
{
  "excludeRoutes": ["\\/canvas$", "\\/settings"]
}
```

This hides the tool on routes ending in `/canvas` or containing `/settings`.

---

## Handler Module Interface

Handler modules are JS files that export up to four named members. All exports are optional — a tool can be as simple as just an `id` export.

### File location

- **Core handlers:** `tools/handlers/<name>.js` inside the Hypercanvas package
- **Custom handlers:** Anywhere in the consumer app, registered via lazy import

### Exports

#### `id` (string)

A unique string identifier for the tool. Must match the key used in `toolbar.config.json`.

```js
export const id = 'my-tool'
```

#### `guard(ctx)` → `Promise<boolean>`

Optional. Called before the tool is loaded. Return `false` to prevent the tool from appearing. Use this for feature flags, permissions, or conditional availability.

```js
export async function guard(ctx) {
  const { isFeatureEnabled } = await import('../../features/config.js')
  return isFeatureEnabled('my-feature')
}
```

**Important:** If `guard` returns `false`, none of the other exports (`setup`, `handler`, `component`) are called. The tool is completely skipped.

#### `setup(ctx)` → `Promise<any>`

Optional. Called once during tool initialization. Returns data that is passed to the component. Use this for expensive initialization, data fetching, or resolving configuration.

```js
export async function setup(ctx) {
  const { config } = ctx
  const features = await resolveFeatures(config.actions)
  return { features, initialized: true }
}
```

The return value from `setup` is made available to the rendered component as props/context.

#### `handler(ctx)` → `Promise<object>`

Optional. Returns an object with methods and data used by the tool's component or surface renderer. The shape of the returned object depends on the render type:

**For `menu` and `submenu` render types** — return `{ getChildren() }`:

```js
export async function handler(ctx) {
  return {
    getChildren() {
      return [
        { id: 'action-1', label: 'Do thing', type: 'default', execute: () => { ... } },
        { id: 'action-2', label: 'Toggle thing', type: 'toggle', active: false, execute: () => { ... } },
      ]
    },
  }
}
```

**For `button` render types** — return action functions:

```js
export async function handler(ctx) {
  return {
    execute() { /* button click action */ },
  }
}
```

**For `zoom-control` render types** — return zoom methods and constants:

```js
export async function handler(ctx) {
  // Reads min/max/step from storyboard.config.json → canvas.zoom
  return {
    zoomIn(currentZoom) { ... },
    zoomOut(currentZoom) { ... },
    zoomReset() { ... },
    ZOOM_MIN,  // from config (default: 10)
    ZOOM_MAX,  // from config (default: 250)
  }
}
```

#### `component()` → `Promise<ReactComponent>`

Optional. Returns a React component to render the tool. If not provided, the surface uses its default renderer (e.g., `TriggerButton` for sidepanels, `ActionMenuButton` for menus — both shipped with Hypercanvas).

```js
export async function component() {
  const mod = await import('../../MyToolButton.jsx')
  return mod.default
}
```

**Always use dynamic `import()`** to keep the handler module lightweight. Components are only loaded when needed.

### The `ctx` object

Every handler function (`guard`, `setup`, `handler`) receives a context object:

```js
{
  basePath: string,            // App base URL path (e.g., '/' or '/my-app/')
  showFlowInfoDialog: Function, // Opens the flow info dialog
  config: {                    // The tool's own config from toolbar.config.json
    ariaLabel: string,
    icon: string,
    render: string,
    surface: string,
    handler: string,
    modes: string[],
    excludeRoutes?: string[],
    actions?: string[],
    // ...any other config keys
  }
}
```

---

## Surface Reference

Surfaces are the UI regions where tools are rendered. Each surface supports a specific subset of render types.

### `command-toolbar`

The primary floating toolbar, positioned at the bottom-right of the viewport. This is the most common surface for user-facing tools.

**Supported render types:** `button`, `menu`, `sidepanel`, `separator`

**File:** `tools/surfaces/mainToolbar.js`

```json
{
  "my-tool": {
    "surface": "command-toolbar",
    "render": "button",
    ...
  }
}
```

### `canvas-toolbar`

The canvas-specific toolbar, positioned at the bottom-left. Used for tools that manipulate the canvas view (zoom, pan, etc.).

**Supported render types:** `menu`, `zoom-control`

**File:** `tools/surfaces/canvasToolbar.js`

```json
{
  "canvas-zoom": {
    "surface": "canvas-toolbar",
    "render": "zoom-control",
    ...
  }
}
```

### `command-palette`

Items rendered inside the ⌘K command palette. These tools don't have a persistent visual presence — they appear when the user opens the command palette.

**Supported render types:** `link`, `submenu`

**File:** `tools/surfaces/commandList.js`

```json
{
  "devtools": {
    "surface": "command-palette",
    "render": "submenu",
    ...
  }
}
```

---

## Render Types

Render types determine the visual and behavioral presentation of a tool within its surface.

### `button`

A simple clickable button. Renders with an icon and optional tooltip (from `ariaLabel`).

- **Surface:** `command-toolbar`
- **Handler return:** `{ execute() }` or custom component
- **Default component:** Uses `TriggerButton`

### `menu`

A dropdown menu with dynamic items. The handler's `getChildren()` populates the menu.

- **Surfaces:** `command-toolbar`, `canvas-toolbar`
- **Handler return:** `{ getChildren() }` returning an array of menu items
- **Default component:** Uses `ActionMenuButton`

### `sidepanel`

A toggle button that opens/closes a side panel. No custom handler or component needed — the toggle behavior is managed by `sidePanelStore`.

- **Surface:** `command-toolbar`
- **Handler return:** Not needed (toggle is automatic)
- **Default component:** Uses `TriggerButton`

### `separator`

A visual divider between tool groups. No handler or component needed.

- **Surface:** `command-toolbar`
- **Config only:** No `handler` field required

### `zoom-control`

A specialized compound control for canvas zoom (zoom in, zoom out, reset, current level display).

- **Surface:** `canvas-toolbar`
- **Handler return:** `{ zoomIn(zoom), zoomOut(zoom), zoomReset(), ZOOM_MIN, ZOOM_MAX }` (min/max read from `canvas.zoom` config)
- **Component:** Custom React component required

### `link`

A navigational item in the command palette. Clicking navigates to a URL or performs a simple action.

- **Surface:** `command-palette`
- **Handler return:** `{ execute() }` or URL target

### `submenu`

A nested menu inside the command palette. The handler's `getChildren()` populates the submenu items.

- **Surface:** `command-palette`
- **Handler return:** `{ getChildren() }` returning an array of menu items

### Menu item shapes

For `menu` and `submenu` render types, `getChildren()` returns an array of item objects:

```js
// Default action item
{ id: 'action-id', label: 'Action Label', type: 'default', execute: () => { ... } }

// Toggle item (shows active state)
{ id: 'toggle-id', label: 'Toggle Label', type: 'toggle', active: true, execute: () => { ... } }

// Radio item (mutually exclusive selection)
{ id: 'radio-id', label: 'Option Label', type: 'radio', active: false, execute: () => { ... } }
```

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | Unique identifier for the item |
| `label` | `string` | Display text |
| `type` | `string` | One of: `default`, `toggle`, `radio` |
| `active` | `boolean` | Current state (for `toggle` and `radio` types) |
| `execute` | `Function` | Called when the item is clicked |

---

## Custom Handlers (Consumer Apps)

Consumer apps can register their own tool handlers to extend the toolbar without modifying Hypercanvas.

### Registration

Custom handlers are registered when mounting Hypercanvas:

```js
// In consumer's index.jsx or entry point:
import { mountStoryboardCore } from '@dfosco/hypercanvas/core'
import config from '../storyboard.config.json'

mountStoryboardCore(config, {
  basePath: import.meta.env.BASE_URL,
  handlers: {
    cursors: () => import('./tools/handlers/cursors.js'),
    'my-tool': () => import('./tools/handlers/myTool.js'),
  },
})
```

### How it works

1. Each key in `handlers` matches a tool name
2. The value is a **lazy import function** — it returns a `Promise<module>`
3. In `toolbar.config.json`, reference the handler with the `custom:` prefix:

```json
{
  "my-tool": {
    "handler": "custom:my-tool",
    ...
  }
}
```

4. At runtime, when the tool is needed, the lazy import is called and the module is resolved
5. The custom handler module follows the exact same interface as core handlers (`id`, `guard`, `setup`, `handler`, `component`)

### Custom handler example

```js
// tools/handlers/cursors.js (in consumer app)
export const id = 'cursors'

export async function guard() {
  // Only show if multiplayer is enabled
  return window.__MULTIPLAYER_ENABLED__ === true
}

export async function component() {
  const mod = await import('../../components/CursorPresence.jsx')
  return mod.default
}
```

With config:

```json
{
  "cursors": {
    "ariaLabel": "Cursor presence",
    "icon": "primer/people",
    "render": "button",
    "surface": "command-toolbar",
    "handler": "custom:cursors",
    "modes": ["*"]
  }
}
```

---

## Recipes

### Simple button tool

A button in the main toolbar that performs an action on click.

**Config:**
```json
{
  "tools": {
    "refresh": {
      "ariaLabel": "Refresh data",
      "icon": "primer/sync",
      "render": "button",
      "surface": "command-toolbar",
      "handler": "core:refresh",
      "modes": ["prototype"]
    }
  }
}
```

**Handler:**
```js
// tools/handlers/refresh.js
export const id = 'refresh'

export async function handler(ctx) {
  return {
    execute() {
      window.location.reload()
    },
  }
}
```

---

### Menu with dynamic items

A dropdown menu whose items are computed at open time.

**Config:**
```json
{
  "tools": {
    "flows": {
      "ariaLabel": "Switch flow",
      "icon": "primer/git-branch",
      "render": "menu",
      "surface": "command-toolbar",
      "handler": "core:flows",
      "modes": ["prototype"]
    }
  }
}
```

**Handler:**
```js
// tools/handlers/flows.js
export const id = 'flows'

export async function handler(ctx) {
  const loader = await import('../../loader.js')
  const vf = await import('../../viewfinder.js')
  const { basePath = '/' } = ctx

  return {
    getChildren() {
      const proto = vf.getCurrentPrototype()
      const flows = loader.getFlowsForPrototype(proto)
      const active = vf.getCurrentFlow()

      if (flows.length <= 1) return []

      return flows.map(f => ({
        id: f.key,
        label: f.meta?.title || f.name,
        type: 'radio',
        active: f.key === active,
        execute: () => {
          window.location.href = vf.resolveFlowRoute(f.key)
        },
      }))
    },
  }
}

export async function component() {
  const mod = await import('../../ActionMenuButton.jsx')
  return mod.default
}
```

---

### Sidepanel toggle

A button that toggles a side panel open/closed. The simplest tool type — no handler or component needed.

**Config:**
```json
{
  "tools": {
    "docs": {
      "ariaLabel": "Documentation",
      "icon": "primer/book",
      "render": "sidepanel",
      "surface": "command-toolbar",
      "handler": "core:docs",
      "modes": ["*"]
    }
  }
}
```

**Handler:**
```js
// tools/handlers/docs.js
export const id = 'docs'
// That's it! No handler, setup, or component needed.
// The sidepanel render type uses TriggerButton and sidePanelStore automatically.
```

---

### Canvas tool (zoom control)

A specialized zoom control for the canvas surface.

**Config:**
```json
{
  "tools": {
    "canvas-zoom": {
      "ariaLabel": "Canvas zoom",
      "render": "zoom-control",
      "surface": "canvas-toolbar",
      "handler": "core:canvas-zoom",
      "modes": ["canvas"]
    }
  }
}
```

**Handler:**
```js
// tools/handlers/canvasZoom.js
export const id = 'canvas-zoom'

import { getCanvasZoom } from '../../canvasConfig.js'

export async function handler() {
  const { min: ZOOM_MIN, max: ZOOM_MAX, step: ZOOM_STEP } = getCanvasZoom()

  return {
    zoomIn(currentZoom) {
      const next = Math.min(ZOOM_MAX, currentZoom + ZOOM_STEP)
      document.dispatchEvent(
        new CustomEvent('storyboard:canvas:set-zoom', { detail: { zoom: next } })
      )
    },
    zoomOut(currentZoom) {
      const next = Math.max(ZOOM_MIN, currentZoom - ZOOM_STEP)
      document.dispatchEvent(
        new CustomEvent('storyboard:canvas:set-zoom', { detail: { zoom: next } })
      )
    },
    zoomReset() {
      document.dispatchEvent(
        new CustomEvent('storyboard:canvas:set-zoom', { detail: { zoom: 100 } })
      )
    },
    ZOOM_MIN,
    ZOOM_MAX,
  }
}

export async function component() {
  const mod = await import('../../CanvasZoomControl.jsx')
  return mod.default
}
```

---

### Command palette submenu

A submenu inside the ⌘K command palette with multiple actions.

**Config:**
```json
{
  "tools": {
    "devtools": {
      "ariaLabel": "Developer tools",
      "icon": "primer/terminal",
      "render": "submenu",
      "surface": "command-palette",
      "handler": "core:devtools",
      "modes": ["*"]
    }
  }
}
```

**Handler:**
```js
// tools/handlers/devtools.js
export const id = 'devtools'

export async function handler(ctx) {
  return {
    getChildren() {
      const children = []

      children.push({
        id: 'core/show-flow-info',
        label: 'Show flow info',
        type: 'default',
        execute: () => ctx.showFlowInfoDialog(),
      })

      children.push({
        id: 'core/reset-params',
        label: 'Reset all params',
        type: 'default',
        execute: () => {
          window.location.hash = ''
        },
      })

      children.push({
        id: 'core/hide-mode',
        label: 'Hide mode',
        type: 'toggle',
        active: document.body.classList.contains('hide-mode'),
        execute: () => {
          document.body.classList.toggle('hide-mode')
        },
      })

      return children
    },
  }
}
```

---

### Tool with guard (conditional visibility)

A tool that only appears when a feature flag or condition is met.

**Config:**
```json
{
  "tools": {
    "comments": {
      "ariaLabel": "Comments",
      "icon": "primer/comment-discussion",
      "render": "button",
      "surface": "command-toolbar",
      "handler": "core:comments",
      "modes": ["prototype"]
    }
  }
}
```

**Handler:**
```js
// tools/handlers/comments.js
export const id = 'comments'

export async function guard() {
  const { isCommentsEnabled } = await import('../../comments/config.js')
  return isCommentsEnabled()
}

export async function component() {
  const mod = await import('../../CommentsMenuButton.jsx')
  return mod.default
}
```

If `guard()` returns `false`, the tool is completely skipped — `setup`, `handler`, and `component` are never called.

---

### Tool with setup data

A tool that performs initialization and passes data to its component.

**Config:**
```json
{
  "tools": {
    "create": {
      "ariaLabel": "Create",
      "icon": "primer/plus",
      "render": "menu",
      "surface": "command-toolbar",
      "handler": "core:create",
      "modes": ["*"],
      "actions": ["new-prototype", "new-flow", "new-object"]
    }
  }
}
```

**Handler:**
```js
// tools/handlers/create.js
export const id = 'create'

export async function setup(ctx) {
  const { config } = ctx
  const { features } = await import('../../workshop/features/registry.js')

  // Resolve which features are available based on config.actions
  const createFeatures = features.filter(f =>
    config.actions?.includes(f.id)
  )

  return { features: createFeatures }
}

export async function guard(ctx) {
  // Only show if there are available actions
  const result = await setup(ctx)
  return result.features.length > 0
}

export async function component() {
  const mod = await import('../../CreateMenuButton.jsx')
  return mod.default
}
```

---

## Architecture

### File structure

```
tools/
├── handlers/              # Handler modules (one per tool)
│   ├── canvasZoom.js
│   ├── comments.js
│   ├── create.js
│   ├── devtools.js
│   ├── docs.js
│   ├── flows.js
│   ├── theme.js
│   └── ...
├── surfaces/              # Surface renderers (one per UI region)
│   ├── mainToolbar.js
│   ├── canvasToolbar.js
│   └── commandList.js
└── toolbar.config.json    # Declarative tool configuration
```

### Loading lifecycle

The tool system follows this sequence at startup:

```
1. CONFIG PARSE
   toolbar.config.json is read and parsed.
   Each tool entry is validated for required fields.

2. MODE FILTER
   Tools are filtered by the current app mode.
   A tool with modes: ["prototype"] is skipped if not in prototype mode.
   A tool with modes: ["*"] always passes.

3. ROUTE FILTER
   Tools with excludeRoutes are tested against the current route.
   If any regex matches, the tool is excluded from this render cycle.

4. HANDLER RESOLUTION
   The handler string is parsed:
   - "core:name"   → resolved from built-in handlers/ directory
   - "custom:name" → resolved from consumer-registered handlers map

5. GUARD CHECK
   If the handler exports guard(ctx), it is called.
   If guard returns false, the tool is completely skipped.
   If guard returns true (or is not exported), loading continues.

6. SETUP
   If the handler exports setup(ctx), it is called.
   The return value is stored and passed to the component later.

7. HANDLER INIT
   If the handler exports handler(ctx), it is called.
   The return value (methods, getChildren, etc.) is stored.

8. COMPONENT RESOLUTION
   If the handler exports component(), it is called to lazy-load
   the React component. If not exported, the surface uses its
   default component for the render type.

9. SURFACE RENDER
   The resolved tool (config + handler data + component) is passed
   to the appropriate surface renderer, which mounts it in the DOM.
```

### Handler resolution

When a tool's `handler` field is processed:

1. The prefix (`core:` or `custom:`) determines the resolution strategy
2. **Core handlers** are imported from the Hypercanvas package's `tools/handlers/` directory
3. **Custom handlers** are resolved from the `handlers` map passed to `mountStoryboardCore()`
4. The resolved module is expected to follow the handler interface (`id`, `guard`, `setup`, `handler`, `component`)
5. Missing exports are treated as no-ops — a handler with only `id` is perfectly valid

### Surface rendering

Each surface maintains its own rendering logic:

- **`mainToolbar.js`** renders tools as a horizontal bar of buttons, menus, and toggles. It handles the `separator` render type as a visual divider between groups.
- **`canvasToolbar.js`** renders canvas-specific controls. The `zoom-control` type gets special compound rendering (buttons + display).
- **`commandList.js`** integrates tools into the ⌘K command palette. `link` items appear as flat entries; `submenu` items expand into nested lists.

### Tips

- **Keep handlers lightweight.** Use dynamic `import()` for everything except the `id` export. This keeps initial bundle size small.
- **Guards are cheap.** Use them liberally for conditional tools rather than rendering hidden elements.
- **`getChildren()` is called on every menu open.** This means dynamic menus always reflect current state without extra re-render logic.
- **One handler per tool.** Don't try to share handler modules across tools. If you need shared logic, extract it into a utility module and import from both handlers.
- **Custom events for cross-tool communication.** Use `document.dispatchEvent(new CustomEvent(...))` when one tool needs to communicate with another (e.g., zoom control dispatching to canvas).
