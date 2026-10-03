---
name: hypercanvas-canvas
description: Work with Hypercanvas canvases — add, move, update, remove, and arrange widgets. Use when asked to add a sticky note, move a widget, rearrange widgets, update widget content, delete a widget, or describe canvas state.
---

# Canvas

> Triggered by: "add a sticky note", "add widget", "move widget", "delete widget", "rearrange", "update sticky", "change the text", "put a markdown", "to the right of", "below", "next to", "describe the canvas", "what's on the canvas", "list widgets", "remove widget", "look at the canvas", "read the canvas", "look at this image", "what's in this image", "describe the image"

## What This Does

Reads, manipulates, and arranges widgets on a Hypercanvas canvas. Supports absolute and relational positioning, bulk layout, content updates, and widget removal.

## ⚠️ Do NOT create widgets to echo messages

**Hub messages and request results should NOT result in new widgets merely to echo the communication.** Create canvas output only when the message, request, or surrounding task explicitly calls for a visible artifact.

## ⚠️ CLI-First — Mandatory

**Always use `npx storyboard canvas` CLI commands as your primary tool.** The CLI resolves the correct dev server port automatically via the Caddy proxy or `ports.json` — you never need to know the port number. All commands work from any worktree directory.

**Only fall back to the HTTP API if the CLI does not support the operation or if a CLI command fails.** When using the API as a fallback, note the failure and explain why you're falling back.

## Prerequisites

- The dev server **must** be running (`npm run dev`, or `storyboard dev` from the CLI directly)
- The target canvas must already exist

## Critical: Never Parse JSONL Directly

**Always use the canvas server API or CLI to read canvas state.** Never manually parse `.canvas.jsonl` files.

JSONL files are append-only event logs (`widget_added`, `widget_updated`, `widgets_replaced`, etc.) that require correct event replay to materialize the current state. Manually parsing them is error-prone — events like `widgets_replaced` update positions, props, and content in bulk, and naive parsing will miss these updates, producing stale/incorrect widget data.

The server materializes the JSONL correctly. Use:
- **CLI:** `npx storyboard canvas read {name} --json`
- **API:** `GET /_storyboard/canvas/read?name={name}`

---

## Reference: Collision Detection

**All positioning operations must use collision detection to prevent widget overlaps.**

Use the collision module at `packages/core/src/canvas/collision.js`:

```js
import { resolvePosition, findFreePosition, DEFAULT_SIZES } from './collision.js'

// For adding/moving widgets — resolves to a collision-free position
const { x, y, adjusted } = resolvePosition({
  x: targetX,
  y: targetY,
  type: 'sticky-note',
  props: { width: 270, height: 170 },  // optional — uses defaults if omitted
  widgets: existingWidgets,
  excludeId: 'widget-to-move',  // optional — for move operations
  gridSize: 24,
})

// Or use findFreePosition directly with explicit dimensions
const { x, y, adjusted } = findFreePosition({
  x: targetX,
  y: targetY,
  width: 270,
  height: 170,
  widgets: existingWidgets,
  excludeId: null,
  gridSize: 24,
})
```

**Algorithm:** Checks the target position against all widgets. If any overlap, jumps past the max right edge (endX) of all colliders + gridSize. Repeats until clear. If horizontal resolution is exhausted, falls back to moving down past the max bottom edge (endY). Returns a collision-free position, snapped to grid.

---

## Reference: Widget Types and Default Sizes

> **Authoritative list:** `.agents/data/widget-types.json` (generated from the widget registry — never invent type strings). Regenerate via `node scripts/gen-widget-types.mjs`.

| Type | Default W×H | Content Prop | Other Props | When to use |
|------|------------|-------------|-------------|-------------|
| `sticky-note` | 270×170 | `text` | `color` (yellow, blue, green, pink, purple, orange), `width`, `height` | Short notes, todos, ideation |
| `markdown` | 530×240 | `content` (markdown) | `width` | Prose, specs, summaries |
| `prototype` | 800×600 | `src` (URL/path) | `label`, `zoom` (10–250), `width`, `height` | Embed a prototype page |
| `figma-embed` | 800×450 | `url` | `width`, `height` | Embed a Figma file/frame |
| `codepen-embed` | 800×450 | `url` | `width`, `height` | Embed a CodePen |
| `story` | 780×420 | `storyId` + `exportName` | `width`, `height`, `showCode` | Render **ONE** named export of a story file |
| `component-set` | 780×420 (auto-sized) | `storyId` | `layout` (`auto`\|`wide`\|`tall`), `selected`, `density`, `width`, `height` | Render **ALL** exports of a story file in one grid iframe |
| `image` | 400×300 | `src` (filename) | `width`, `height`, `private` | Screenshots, references, mockups |
| `link-preview` | 320×200 | `url` | `title` | External URL preview card |
| `terminal` | 650×500 | — | `prettyName`, `alias` | Live terminal session |
| `terminal-read` | 650×500 | — | `width`, `height` | Read-only view of another terminal |
| `agent` | 650×500 | — | `prettyName`, `alias`, `agentId` (key from `canvas.agents` config) | Agent session (Copilot/Codex/etc.) |
| `prompt` | 400×200 | `text` | `agentId`, `autoRun` | Canned prompt that spawns an agent |
| `tiles` | 600×400 | — | `tiles[]`, `columns`, `width`, `height` | Small content tile grid |

### ⚠️ `story` vs `component-set` — read this before creating story widgets

| You want to… | Use | Don't |
|--------------|-----|-------|
| Show ONE specific variant of a component | `story` (with `exportName`) | — |
| Show ALL variants of a story file (a "component set", "showcase", "every variant") | **`component-set`** (one widget, N cells) | ❌ DO NOT create N `story` widgets — wasteful, slow, ugly |
| Compare 2+ exports of the **same** story file side by side | **`component-set`** | ❌ Same reason |
| Compare components from **different** story files | Multiple `story` widgets, or several `component-set` widgets | — |

**Hard rule:** If you are about to create 2+ `story` widgets sharing the same `storyId`, stop and use a single `component-set` widget instead. The user almost certainly meant "component set" even if they didn't say it literally.

**Trigger phrases** that almost always mean `component-set`:
- "variants of X"
- "component set for X"
- "showcase for X"
- "every variant of X"
- "all exports of X"
- "one variant for each type"

### ⚠️ `component-set.props.selected` — a hint, not a hard scope

A `component-set` widget's iframe lets the user click a cell to inspect a single variant. The clicked export name is persisted to **`props.selected`** on the widget (and forwarded to the iframe URL as `?selected=…`). Think of it as "where the user's eye is right now" — useful context, **not a fence**.

**Always read `props.selected` before acting on a `component-set`**, but treat it as one signal among several. Combine it with the literal prompt to decide scope.

**Scope decision — read the prompt's language first, then fall back to `selected`:**

| Prompt language | Scope |
|----------------|-------|
| Singular / demonstrative ("this", "this one", "this variant", "the selected one", "make IT red") | The variant in `props.selected` (or ask if empty) |
| Plural / collective ("all variants", "every chart", "the whole set", "across variants", "the component set") | All exports — ignore `selected` |
| Explicit name ("the line chart", "BarChart") | The named export — ignore `selected` |
| Ambiguous, no demonstrative, no plural ("add a legend", "improve the styling", "fix the colors") | Ask which scope, OR pick the most useful default for the change and say so. Lean toward `selected` for tweaks, lean toward the whole set for cross-cutting changes (theming, shared layout, shared deps). |

**Examples:**
- `selected="BubbleChart"` + prompt "make it more colorful" → singular pronoun → just BubbleChart
- `selected="BubbleChart"` + prompt "make the charts more colorful" → plural → all variants
- `selected="BubbleChart"` + prompt "switch all charts to Primer tokens" → explicit "all" → all variants
- `selected=""` + prompt "fix the legend" → no selection, ambiguous → ask or pick a sensible default

**Anti-patterns:**
- ❌ Restyling the whole set when the user pointed at one variant ("this") and `selected` is set.
- ❌ Restyling only the selected variant when the user said "all" or used a plural.
- ❌ Silently picking a scope without saying which — when in doubt, mention "I'm applying this to *X* — say 'all variants' to broaden" so the user can redirect.


## Reference: Widget Content, URLs, and File Paths

Each widget type stores content in a different prop. When querying widgets, use this mapping:

| Type | Content Prop | URL | File Path |
|------|-------------|-----|-----------|
| `sticky-note` | `props.text` | — | — |
| `markdown` | `props.content` | — | — |
| `prototype` | `props.src` | `props.src` (prototype path) | — |
| `figma-embed` | `props.url` | `props.url` | — |
| `link-preview` | `props.url` | `props.url` | — |
| `image` | `props.src` (filename) | `/_storyboard/canvas/images/{props.src}` | `src/canvas/images/{props.src}` |

**Image widgets:** The `src` prop contains only the filename (e.g. `my-canvas--2026-04-13--10-30-00.png`). To view the actual image file, use the full path: `src/canvas/images/{props.src}`.

## Reference: Grid & Spacing

- Default grid size: **24px** (stored in the canvas JSONL as `gridSize`; fall back to 24)
- When positioning: **snap to grid** — `Math.round(value / gridSize) * gridSize`
- Standard gap between widgets: **1 grid unit** (= `gridSize`, usually 24px)

## Reference: CLI Commands (Primary Interface)

**These are the commands you should use for all canvas operations.** Prefer these over the HTTP API in every case.

### Read canvas state
```bash
npx storyboard canvas read              # List all canvases
npx storyboard canvas read my-canvas    # List all widgets with ID, content, URLs, file paths
npx storyboard canvas read my-canvas --json   # Output as JSON (for parsing)
npx storyboard canvas read my-canvas --id sticky-note-abc123  # Get specific widget
```

The CLI outputs widget ID, type, position, content, and file paths (for images). Use `--json` for machine-readable output that includes enriched `content`, `url`, `filePath`, and `bounds` fields.

**Bounds:** Both human-readable and JSON output include bounds for each widget:
- `bounds.width`, `bounds.height` — resolved from props or type defaults
- `bounds.startX`, `bounds.startY` — top-left corner (same as position)
- `bounds.endX`, `bounds.endY` — bottom-right corner (startX + width, startY + height)

Bounds are persisted in widget metadata and recalculated on every add, move, or resize. Legacy widgets without bounds will have them computed on-the-fly from position + size.

Use bounds to determine widget overlap and spatial relationships without manual size calculation.

### Get widget bounds
```bash
npx storyboard canvas bounds my-canvas                     # Bounds for all widgets
npx storyboard canvas bounds my-canvas --id sticky-abc123  # Bounds for one widget
npx storyboard canvas bounds my-canvas --json              # JSON output
npx storyboard canvas bounds --type sticky-note            # Default size for a widget type
```

Returns only size and position data (no content): `id`, `type`, `width`, `height`, `startX`, `startY`, `endX`, `endY`. Useful for collision checks and spatial queries.

### Add a widget
```bash
# Auto-positioned (default — places near the active agent, selected widget, or viewport center)
npx storyboard canvas add {TYPE} --canvas {NAME} --props '{JSON}'

# Place near a specific widget (explicit --near)
npx storyboard canvas add {TYPE} --canvas {NAME} --near {WIDGET_ID} --direction right --props '{JSON}'

# Explicit coordinates (overrides auto-positioning)
npx storyboard canvas add {TYPE} --canvas {NAME} --x {X} --y {Y} --props '{JSON}'

# Disable auto-positioning entirely (place at 0,0)
npx storyboard canvas add {TYPE} --canvas {NAME} --near false --props '{JSON}'

# Complex props (markdown, backticks, quotes) — use --props-file to avoid shell escaping
echo '{"content":"# Hello\nSome **markdown**"}' > /tmp/widget-props.json
npx storyboard canvas add {TYPE} --canvas {NAME} --props-file /tmp/widget-props.json
```

**Widgets are auto-positioned by default.** When no `--x`/`--y` or `--near` is provided, the server picks a smart position using this priority chain:

1. **Active agent/terminal** — if `$STORYBOARD_WIDGET_ID` is set (i.e., the command runs from an agent), places near that widget
2. **Selected widget** — the widget the user has selected in the browser
3. **Viewport center** — the center of the user's current view
4. **Last widget on canvas** — to the right of the most recently added widget
5. **Origin (0, 0)** — only for truly empty canvases with no viewport data

Use `--near {WIDGET_ID}` to override auto-positioning with a specific reference widget. The `--direction` flag defaults to `right` — valid values: `right`, `left`, `above`, `below`, `above-right`, `below-right`, `above-left`, `below-left`. Use `--gap N` to control spacing in grid spaces (default: 1). Use `--near false` to disable auto-positioning and place at explicit `--x`/`--y` (or 0,0).

**Always use `--props-file` for markdown widgets or any content with special characters.** Write the props JSON to a temp file first, then pass the path. This avoids all shell escaping issues with backticks, quotes, and newlines.

### Update a widget
```bash
# Update sticky note text
npx storyboard canvas update {WIDGET_ID} --canvas {NAME} --text "New text"

# Update markdown content
npx storyboard canvas update {WIDGET_ID} --canvas {NAME} --content "# Heading"

# Arbitrary props as JSON
npx storyboard canvas update {WIDGET_ID} --canvas {NAME} --props '{"key":"value"}'

# Move a widget — ALWAYS provide both --x and --y
npx storyboard canvas update {WIDGET_ID} --canvas {NAME} --x 100 --y 200
# ⚠️ Omitting --x or --y zeros out the missing axis. Always read the widget's
# current position first, then provide both coordinates.

# Shorthand flags: --text, --content, --src, --url, --color
```

### Add flags reference
```
  Positional: <widget-type>  Widget type (sticky-note, markdown, prototype, story, component-set, image, figma-embed, codepen-embed, link-preview)

  -c, --canvas           Target canvas name (required)
  --x                    X position (omit for auto-positioning)
  --y                    Y position (omit for auto-positioning)
  --near                 Place near this widget ID (default: auto-selects best reference). Use --near false to disable
  -dir, --direction      Direction from reference widget: right, left, above, below, above-right, below-right, above-left, below-left [default: right]
  --gap                  Spacing between widgets in grid spaces [default: 1]
  --resolve              Run server-side collision detection on the target position [default: false]
  --props                Widget props as JSON string
  -pf, --props-file      Path to a JSON file containing widget props (avoids shell escaping)
  --json                 Output result as JSON (includes widget id) [default: false]
```

### CLI output with `--json`

The `--json` flag outputs JSON, but the CLI may mix spinner characters into the output. When parsing, strip non-JSON characters before the opening `{`:

```bash
RAW=$(npx storyboard canvas add sticky-note --canvas my-canvas --near widget-id --props '{"text":"hi"}' --json 2>/dev/null)
NEW_ID=$(echo "$RAW" | sed 's/[^{]*//' | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null)
```

---

## Procedure

### Step 1: Identify the canvas

If the user doesn't specify which canvas:
```bash
npx storyboard canvas read
```
If there's one canvas, use it. If multiple, ask the user.

### Step 2: Read the canvas state

**Always read the current state before any operation that involves positioning or modifying existing widgets:**

```bash
npx storyboard canvas read {CANVAS_NAME} --json
```

Parse the response to get the widgets and gridSize.

### Step 3: Resolve positioning (for add/move operations)

**Absolute** — User gives coordinates:
> "Add a sticky note at 200, 400" → `x=200, y=400` (snap to grid)

**Relational** — User positions relative to another widget:

| Relation | X formula | Y formula |
|----------|-----------|-----------|
| **right of** ref | `ref.x + ref.width + gap` | `ref.y` |
| **left of** ref | `ref.x - new.width - gap` | `ref.y` |
| **below** ref | `ref.x` | `ref.y + ref.height + gap` |
| **above** ref | `ref.x` | `ref.y - new.height - gap` |
| **center aligned with** ref | `ref.x + (ref.width - new.width) / 2` | (same y, or same formula for vertical) |

Where:
- `ref.width` = `ref.props.width` or the default width for that widget type
- `ref.height` = `ref.props.height` or the default height for that widget type
- `new.width/height` = the size of the widget being placed (from props or defaults)
- `gap` = `gridSize` (typically 24)
- **Always snap the final result**: `Math.round(value / gridSize) * gridSize`

**Implicit reference** — If the user says "to the right of the blue sticky" without an ID, read the canvas state and find the matching widget by type + props (e.g. a sticky-note with `color: "blue"`). If ambiguous, ask.

**No position given** — **The server auto-positions by default.** You do NOT need to calculate a position manually. Just omit `--x`, `--y`, and `--near`:

```bash
npx storyboard canvas add sticky-note --canvas {NAME} --props '{"text":"hello"}'
```

The server uses this priority chain:
1. **Active agent/terminal** — if `$STORYBOARD_WIDGET_ID` is set, places near that widget
2. **Selected widget** — the widget the user has selected in the browser
3. **Viewport center** — the center of the user's current view
4. **Last widget on canvas** — to the right of the most recently added widget
5. **Origin (0, 0)** — only for truly empty canvases with no viewport data

All auto-positioned widgets go through collision detection automatically.

### Step 4: Execute the operation

**Adding a widget:**
```bash
# Auto-positioned (default — just specify type, canvas, and props)
npx storyboard canvas add {TYPE} --canvas {NAME} --props '{JSON}' --json

# With explicit --near (relative to a specific widget)
npx storyboard canvas add {TYPE} --canvas {NAME} --near {REF_WIDGET_ID} --direction right --props '{JSON}' --json

# With explicit coordinates (overrides auto-positioning)
npx storyboard canvas add {TYPE} --canvas {NAME} --x {X} --y {Y} --props '{JSON}'

# Disable auto-positioning (force 0,0)
npx storyboard canvas add {TYPE} --canvas {NAME} --near false --x 0 --y 0 --props '{JSON}'
```

**Moving a widget:**
1. Read the widget's current position first (`canvas read --id {WIDGET_ID} --json`)
2. Calculate new coordinates — **always provide both x and y**
3. Use the CLI:
```bash
npx storyboard canvas update {WIDGET_ID} --canvas {NAME} --x {NEW_X} --y {NEW_Y}
# ⚠️ Both --x and --y are REQUIRED — omitting one zeros out the missing axis
```

**Updating widget props** (text, color, size, content, etc.):
```bash
# Use shorthand flags for common props
npx storyboard canvas update {WIDGET_ID} --canvas {NAME} --text "New text"
npx storyboard canvas update {WIDGET_ID} --canvas {NAME} --content "# New heading"
npx storyboard canvas update {WIDGET_ID} --canvas {NAME} --color blue

# Or pass arbitrary props as JSON
npx storyboard canvas update {WIDGET_ID} --canvas {NAME} --props '{"key":"value"}'
```

**Removing a widget:**
```bash
# CLI does not yet support delete — use API fallback
curl -X DELETE http://localhost:{PORT}/_storyboard/canvas/widget \
  -H 'Content-Type: application/json' \
  -d '{"name":"{CANVAS}","widgetId":"{WIDGET_ID}"}'
```

**Rearranging / laying out multiple widgets:**
1. Read canvas state → get widgets array via CLI (`canvas read --json`)
2. Calculate new positions for all affected widgets using the positioning formulas
3. Use the API fallback: PUT the full updated array back in a single call (see Server API Fallback section)

### Step 5: Confirm

After the operation, tell the user what changed. For relational positioning, confirm the calculated coordinates. For bulk operations, summarize the layout.

**For every widget added**, provide a direct URL to the widget on the canvas. The URL is constructed as:

1. **Get the base URL**: Use the proxy URL if Caddy is running, otherwise the direct URL:
   - Proxy: `http://{devDomain}.localhost/branch--{worktreeName}/` (where `devDomain` comes from `storyboard.config.json`, default `storyboard`)
   - Direct: `http://localhost:{port}/branch--{worktreeName}/`
   - For `main`: no `branch--` prefix, just `http://{devDomain}.localhost/` or `http://localhost:{port}/`
2. **Append the canvas path**: `canvas/{canvasName}`
3. **Append the widget anchor**: `#{widgetId}`

Full URL: `{baseURL}canvas/{canvasName}#{widgetId}`

Example: `http://hypercanvas.localhost/branch--4.2.0--tmux-management/canvas/design-system#sticky-note-f3k2m1`

**If you cannot generate the URL** (no widget ID in the response, or the add command failed silently), this means creation likely failed — **retry the operation** before reporting success. A successful widget add always returns a widget ID.

---

## Examples

### Add a sticky note with text
User: "Add a yellow sticky note saying 'TODO: fix bug' to my-canvas"
```bash
npx storyboard canvas add sticky-note --canvas my-canvas --x 0 --y 0 --props '{"text":"TODO: fix bug","color":"yellow"}'
```

### Relational positioning
User: "Add a blue sticky to the right of sticky-note-f20afo on my-canvas"

**Use `--near`** — the CLI handles position calculation and collision detection automatically:
```bash
npx storyboard canvas add sticky-note --canvas my-canvas --near sticky-note-f20afo --direction right --props '{"text":"","color":"blue"}'
```

### Move a widget
User: "Move sticky-note-abc123 below markdown-xyz789"
1. Read canvas to get markdown-xyz789's position and bounds
2. Calculate: use the positioning formulas (ref.y + ref.height + gap)
3. Update:
```bash
npx storyboard canvas update sticky-note-abc123 --canvas my-canvas --x {X} --y {NEW_Y}
```

### Update content
User: "Change the text of sticky-note-abc123 to 'Done!'"
```bash
npx storyboard canvas update sticky-note-abc123 --canvas my-canvas --text "Done!"
```

### Row of widgets
User: "Add three sticky notes in a row: red, blue, green"

Use `--near` to chain positioning — each new sticky is placed to the right of the previous one:
```bash
# First sticky at a starting point
RAW1=$(npx storyboard canvas add sticky-note --canvas my-canvas --x 0 --y 0 --props '{"color":"red"}' --json 2>/dev/null)
ID1=$(echo "$RAW1" | sed 's/[^{]*//' | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

# Second sticky to the right of the first
RAW2=$(npx storyboard canvas add sticky-note --canvas my-canvas --near "$ID1" --direction right --props '{"color":"blue"}' --json 2>/dev/null)
ID2=$(echo "$RAW2" | sed 's/[^{]*//' | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

# Third sticky to the right of the second
npx storyboard canvas add sticky-note --canvas my-canvas --near "$ID2" --direction right --props '{"color":"green"}'
```

### Describe canvas state
User: "What's on my-canvas?"

```bash
npx storyboard canvas read my-canvas
```
This lists all widgets with their ID, type, position, content, URLs, and file paths.

### Query a specific widget
User: "What's in widget sticky-note-abc123?"
```bash
npx storyboard canvas read my-canvas --id sticky-note-abc123
```
Or with JSON output for parsing:
```bash
npx storyboard canvas read my-canvas --id sticky-note-abc123 --json
```

### Remove a widget
User: "Delete the prototype embed on my-canvas"
1. Read canvas via CLI, find the widget of type `prototype`
2. Use API fallback (CLI doesn't support delete yet):
```bash
curl -X DELETE http://localhost:{PORT}/_storyboard/canvas/widget \
  -H 'Content-Type: application/json' \
  -d '{"name":"my-canvas","widgetId":"prototype-xyz789"}'
```

### View an image on the canvas
User: "Look at the image on my-canvas" or "What's in this image?"

**Step 1 — Find the image widget:**
```bash
npx storyboard canvas read my-canvas --json
```
Look for widgets with `"type": "image"`. The output includes the `filePath` field.

**Step 2 — View the image file:**
Use the `view` tool with the file path from the CLI output:
```
view src/canvas/images/my-canvas--2026-04-13--10-30-00.png
```

**Image file path formula:**
- Widget prop: `props.src` (filename only)
- Full path: `src/canvas/images/{props.src}`

If multiple images exist, ask which one the user wants to view, or list them with their widget IDs.

---

## Connectors

Connectors are visual links between two widgets on a canvas.

### Creating a connector

**CLI (recommended):**
```bash
npx storyboard canvas connector create --canvas <name> --start <widgetId> --end <widgetId>
```

Anchors are **auto-calculated** by default — the server finds the optimal anchor pair that minimizes distance while avoiding overlap with either widget. You can override with `--start-anchor` and `--end-anchor` if needed.

**API:**
```
POST /_storyboard/canvas/connector
```

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✅ | Canvas name |
| `startWidgetId` | string | ✅ | ID of the source widget |
| `endWidgetId` | string | ✅ | ID of the destination widget |
| `startAnchor` | string | ❌ | Anchor point on the source widget (auto-calculated if omitted) |
| `endAnchor` | string | ❌ | Anchor point on the destination widget (auto-calculated if omitted) |
| `connectorType` | string | ❌ | Connector style (defaults to `"default"`) |
| `className` | string | ❌ | Custom CSS class(es) appended to the connector's `<g>` elements |
| `style` | object | ❌ | Inline style on the `<g>` (supports CSS variables — see "Presentational styling") |
| `data` | object | ❌ | Flat object of values rendered as `data-*` attributes on the `<g>` elements |
| `startEndpoint` | string | ❌ | Endpoint shape at start: `circle` / `arrow-start` / `arrow-end` / `none` |
| `endEndpoint` | string | ❌ | Endpoint shape at end: `circle` / `arrow-start` / `arrow-end` / `none` |

**Anchor values:** `top`, `bottom`, `left`, `right`

**Auto-calculation algorithm:** When anchors are omitted, the server tests all 16 anchor combinations and selects the pair that:
1. Does not cause the Bézier path to overlap either widget's bounding box
2. Has the shortest distance between anchor points
3. Falls back to shortest distance if all paths overlap

**Validation rules:**
- Both `startWidgetId` and `endWidgetId` must exist on the canvas
- A widget cannot connect to itself (`startWidgetId !== endWidgetId`)
- If provided, anchors must be one of the four valid values

**Response (201):**
```json
{
  "success": true,
  "connector": {
    "id": "connector-abc123",
    "type": "connector",
    "connectorType": "default",
    "start": { "widgetId": "sticky-note-aaa", "anchor": "right" },
    "end": { "widgetId": "sticky-note-bbb", "anchor": "left" },
    "meta": {}
  }
}
```

**Side effects on connected widgets:** After materialization, each widget involved in a connector gains a `connectorIds` array listing all connector IDs attached to it. This is derived automatically — you don't set it manually.

### Deleting a connector

```
DELETE /_storyboard/canvas/connector
```

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✅ | Canvas name |
| `connectorId` | string | ✅ | ID of the connector to remove |

The connector must exist on the canvas. Response: `{ "success": true, "removed": 1 }`.

### Updating a connector

```
PATCH /_storyboard/canvas/connector
```

Update a connector's anchors and/or metadata without deleting it. The connector keeps its ID, widget connections, and messaging state.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✅ | Canvas name |
| `connectorId` | string | ✅ | ID of the connector to update |
| `startAnchor` | string | ❌ | New anchor on start widget (`top`/`right`/`bottom`/`left`) |
| `endAnchor` | string | ❌ | New anchor on end widget (`top`/`right`/`bottom`/`left`) |
| `meta` | object | ❌ | Metadata updates (e.g. `messagingMode`) |
| `className` | string \| null | ❌ | Replace className wholesale; pass `null` to clear |
| `style` | object \| null | ❌ | Merge into existing style object; pass `null` to clear |
| `data` | object \| null | ❌ | Merge into existing data-attrs; pass `null` to clear |
| `startEndpoint` | string \| null | ❌ | Override endpoint shape at start; `null` to clear |
| `endEndpoint` | string \| null | ❌ | Override endpoint shape at end; `null` to clear |

At least one of the optional fields should be provided. Omitted fields keep their current value. `style` and `data` are **shallow-merged** into the existing object (same semantics as `meta`); pass `null` to remove the field entirely.

**Example — swap anchors:**
```bash
curl -X PATCH http://localhost:{PORT}/_storyboard/canvas/connector \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "my-canvas",
    "connectorId": "connector-abc123",
    "startAnchor": "bottom",
    "endAnchor": "top"
  }'
```

Response: `{ "success": true }`

### Presentational styling

Connectors support per-connector visual overrides authored directly on the
connector object (or via the CLI/API). This is for hand-tuning specific
connectors — e.g. demo screenshots, accent connectors, "compare" arrows — not
for theming the canvas globally.

| Field | Type | Effect |
|-------|------|--------|
| `className` | string | Appended to the class list of both the path `<g>` and the endpoint `<g>`. |
| `style` | object | Inline style on both `<g>` elements. **Use CSS variables** to override stroke, width, etc. — see vars below. |
| `data` | object | Each entry becomes a `data-*` attribute (e.g. `{ "variant": "dashed" }` → `data-variant="dashed"`), letting external CSS target this connector. |
| `startEndpoint` / `endEndpoint` | string | Override the endpoint shape per side: `circle` (default), `arrow-start` (points at start), `arrow-end` (points at end), or `none` (invisible — keeps the drag hit-area). |

Stable attributes always present on the `<g>` (for CSS targeting):
- `data-connector-id="connector-..."`
- `data-connector-type="default"`

**Available CSS variables** (set them via `style`, a global stylesheet, or
inline on the canvas page):

| Variable | Default | Affects |
|----------|---------|---------|
| `--connector-stroke` | `var(--color-foreground-accent)` | Path stroke color |
| `--connector-stroke-width` | `4px` | Path stroke width |
| `--connector-stroke-dasharray` | `none` | Path dash pattern (e.g. `10 6`) |
| `--connector-stroke-linecap` | `butt` | `butt` / `round` / `square` |
| `--connector-opacity` | `1` | Path opacity |
| `--connector-endpoint-fill` | `var(--color-foreground-accent)` | Endpoint fill |
| `--connector-endpoint-stroke` | `var(--color-background)` | Endpoint outline |
| `--connector-endpoint-stroke-width` | `3px` | Endpoint outline width |
| `--connector-endpoint-opacity` | inherits `--connector-opacity` | Endpoint opacity |
| `--connector-hover-stroke` | `var(--color-foreground-danger)` | Path stroke on hover |
| `--connector-hover-stroke-width` | `5px` | Path stroke width on hover |

**Example — magenta dashed connector via JSONL:**
```json
{
  "id": "connector-demo",
  "type": "connector",
  "connectorType": "default",
  "start": { "widgetId": "sticky-a", "anchor": "right" },
  "end":   { "widgetId": "sticky-b", "anchor": "left" },
  "meta": {},
  "className": "demo-accent",
  "style": {
    "--connector-stroke": "#ff00ff",
    "--connector-stroke-width": "3px",
    "--connector-stroke-dasharray": "10 6"
  },
  "data": { "variant": "demo" },
  "startEndpoint": "none",
  "endEndpoint": "arrow-end"
}
```

**Example — via CLI (create):**
```bash
npx storyboard canvas connector create \
  --canvas my-canvas --start sticky-a --end sticky-b \
  --class-name 'demo-accent' \
  --style '{"--connector-stroke":"#ff00ff","--connector-stroke-dasharray":"10 6"}' \
  --data '{"variant":"demo"}' \
  --end-endpoint arrow-end
```

**Example — via CLI (update, with clearing):**
```bash
# Replace style; pass 'null' or empty to clear any field
npx storyboard canvas connector update connector-demo \
  --canvas my-canvas \
  --style '{"--connector-opacity":"0.4"}'

# Clear className entirely
npx storyboard canvas connector update connector-demo --canvas my-canvas --class-name null
```

**Example — global CSS targeting by data-attr (in a CSS file imported by the app):**
```css
[data-connector-variant="dashed"] {
  --connector-stroke: #ff00ff;
  --connector-stroke-dasharray: 10 6;
}
[data-connector-id="connector-demo"] {
  --connector-opacity: 0.6;
}
```

All presentational fields are **optional** — omitted connectors render with
defaults, exactly as before. Updates shallow-merge `style` and `data` so
partial updates accumulate; pass `null` to delete the field.

#### Built-in variants

Four variants ship with the connector layer — pick one by setting
`data.variant` on the connector (no CSS file needed):

| `data.variant` | Aliases | Look |
|----------------|---------|------|
| `default` | `blue` | Stock blue solid line. Useful to force the default when a parent stylesheet has re-themed connectors. |
| `red` | `hover` | The live hover/delete color — flag "danger" / "remove" / "warning" relationships statically. |
| `green` | `ready` | Success color (matches the green ring on ready agents) — use for "ready", "approved", "live". |
| `moving` | `broadcast` | Dashed marching-ants animation — same vibe as active broadcast, but works on any connector. |

```json
{
  "id": "connector-status",
  "type": "connector",
  "start": { "widgetId": "agent-1", "anchor": "right" },
  "end":   { "widgetId": "prototype-1", "anchor": "left" },
  "meta": {},
  "data": { "variant": "green" }
}
```

Or via CLI:
```bash
npx storyboard canvas connector update connector-status \
  --canvas my-canvas --data '{"variant":"green"}'
```

Variants compose with per-connector `style` overrides — set the variant
for the base look, then override individual vars in `style` for tweaks:
```json
"data": { "variant": "green" },
"style": { "--connector-stroke-width": "6px" }
```

### Direction

Connectors are directional: they go **from** `start` **to** `end`. The `startAnchor` determines which side of the source widget the line exits, and `endAnchor` determines which side of the target widget the line enters. For example, `startAnchor: "right"` + `endAnchor: "left"` draws a left-to-right connection.

### Anchor Optimization

> **Note:** As of v0.5.0, anchor calculation is **automatic**. When you omit `startAnchor` and `endAnchor` from the API/CLI, the server calculates the optimal pair using a Bézier path overlap-avoidance algorithm. The manual orientation table below is kept for reference but is no longer required for typical usage.

The automatic algorithm:
1. Tests all 16 anchor combinations (4×4)
2. Samples points along each Bézier curve
3. Rejects paths that overlap either widget's bounding box
4. Selects the shortest non-overlapping path
5. Falls back to shortest overall if all paths overlap

**When to manually specify anchors:**
- When you want a specific visual style (e.g., always exit from bottom)
- When connecting through a specific gap between widgets
- When the auto-calculated path isn't aesthetically ideal

#### Reference: Relative Orientation (Manual Calculation)

Every connector between widgets A (start) and B (end) has a `relativeOrientation` — derived from where A's **center point** sits relative to B's **bounds** on a 3×3 spatial grid.

Widget B occupies the center cell. Widget A can be in any of the 8 surrounding cells:

```
 ┌──────────────┬──────────────┬──────────────┐
 │   top-left   │  top-center  │  top-right   │
 ├──────────────┼──────────────┼──────────────┤
 │ center-left  │      B       │ center-right │
 ├──────────────┼──────────────┼──────────────┤
 │ bottom-left  │bottom-center │ bottom-right │
 └──────────────┴──────────────┴──────────────┘
```

#### Calculating the sector

**Sector boundaries** come from B's `bounds`:
- Left: `B.bounds.startX` — Right: `B.bounds.endX`
- Top: `B.bounds.startY` — Bottom: `B.bounds.endY`

**A's test point** is its center: `(A.bounds.startX + A.bounds.width / 2, A.bounds.startY + A.bounds.height / 2)`. Using the center (not top-left corner) avoids edge cases where large widgets straddle sector boundaries.

Let `Ax, Ay` = A's center coordinates:

| Condition | Horizontal sector |
|-----------|------------------|
| `Ax < B.bounds.startX` | left |
| `Ax >= B.bounds.startX && Ax <= B.bounds.endX` | center |
| `Ax > B.bounds.endX` | right |

| Condition | Vertical sector |
|-----------|----------------|
| `Ay < B.bounds.startY` | top |
| `Ay >= B.bounds.startY && Ay <= B.bounds.endY` | center |
| `Ay > B.bounds.endY` | bottom |

Combine: `{vertical}-{horizontal}` → e.g. `top-left`, `center-right`, `bottom-center`.

#### Orientation → Anchor Map

Each grid position produces a `relativeOrientation` that maps to an ideal anchor pair. The connector exits the side of A facing B, and enters the side of B facing A:

```
 ┌──────────────────┬──────────────────┬──────────────────┐
 │    top-left      │   top-center     │    top-right     │
 │  A anchor: right │  A anchor: bottom│  A anchor: left  │
 │  B anchor: top   │  B anchor: top   │  B anchor: top   │
 ├──────────────────┼──────────────────┼──────────────────┤
 │   center-left    │        B         │   center-right   │
 │  A anchor: right │                  │  A anchor: left  │
 │  B anchor: left  │                  │  B anchor: right │
 ├──────────────────┼──────────────────┼──────────────────┤
 │   bottom-left    │  bottom-center   │   bottom-right   │
 │  A anchor: right │  A anchor: top   │  A anchor: left  │
 │  B anchor: bottom│  B anchor: bottom│  B anchor: bottom│
 └──────────────────┴──────────────────┴──────────────────┘
```

**Summary table:**

| A's grid position | relativeOrientation | A anchor (start) | B anchor (end) |
|-------------------|---------------------|------------------|----------------|
| top-left          | top-to-right        | right            | top            |
| top-center        | top-to-bottom       | bottom           | top            |
| top-right         | top-to-left         | left             | top            |
| center-left       | left-to-right       | right            | left           |
| center-right      | right-to-left       | left             | right          |
| bottom-left       | bottom-to-right     | right            | bottom         |
| bottom-center     | bottom-to-top       | top              | bottom         |
| bottom-right      | bottom-to-left      | left             | bottom         |

**Key directive:** Connector positioning is calculated AFTER all widgets have been positioned. **Never reposition widgets** to accommodate better connector layout — only adjust anchors.

### When to Recalculate Anchors

With auto-calculation, you typically don't need to manually recalculate. However, if you've explicitly set anchors and then move widgets, you may want to:

1. **After moving any widget that has connectors** — re-read all connectors attached to the moved widget, recompute orientations for each pair, and `PATCH /connector` any whose ideal anchors have changed

**Procedure:**
1. Read the canvas state (get all widgets with bounds + all connectors)
2. For each connector, find the start and end widgets
3. Calculate A's center point and determine which sector it falls in relative to B's bounds
4. Look up the ideal anchor pair from the orientation table
5. If the current anchors differ from the ideal, PATCH the connector with the new anchors

### Example: Single connector

```bash
curl -X POST http://localhost:{PORT}/_storyboard/canvas/connector \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "my-canvas",
    "startWidgetId": "sticky-note-aaa",
    "endWidgetId": "sticky-note-bbb",
    "startAnchor": "right",
    "endAnchor": "left"
  }'
```

### Pattern: 1→n (one source to many targets)

Create multiple connectors from the same source widget to different targets. **Calculate anchors per-pair** using the orientation table — each target may be in a different sector relative to the source:

```bash
# Connect source to three targets — anchors depend on relative positions
# (These examples assume targets are to the right; adjust per orientation)
curl -X POST http://localhost:{PORT}/_storyboard/canvas/connector \
  -H 'Content-Type: application/json' \
  -d '{"name":"my-canvas","startWidgetId":"source-widget","endWidgetId":"target-1","startAnchor":"right","endAnchor":"left"}'

curl -X POST http://localhost:{PORT}/_storyboard/canvas/connector \
  -H 'Content-Type: application/json' \
  -d '{"name":"my-canvas","startWidgetId":"source-widget","endWidgetId":"target-2","startAnchor":"bottom","endAnchor":"top"}'

curl -X POST http://localhost:{PORT}/_storyboard/canvas/connector \
  -H 'Content-Type: application/json' \
  -d '{"name":"my-canvas","startWidgetId":"source-widget","endWidgetId":"target-3","startAnchor":"right","endAnchor":"top"}'
```

### Pattern: n→1 (many sources to one target)

Connect multiple source widgets to a single target. Each source may be in a different sector relative to the target — **calculate anchors per-pair**:

```bash
# source-1 is to the left of target → left-to-right
curl -X POST http://localhost:{PORT}/_storyboard/canvas/connector \
  -H 'Content-Type: application/json' \
  -d '{"name":"my-canvas","startWidgetId":"source-1","endWidgetId":"target-widget","startAnchor":"right","endAnchor":"left"}'

# source-2 is above target → top-to-bottom
curl -X POST http://localhost:{PORT}/_storyboard/canvas/connector \
  -H 'Content-Type: application/json' \
  -d '{"name":"my-canvas","startWidgetId":"source-2","endWidgetId":"target-widget","startAnchor":"bottom","endAnchor":"top"}'
```

### Pattern: n→n (many to many)

Create connectors between arbitrary pairs — each call is independent. **Always calculate anchors from the orientation table** based on widget positions:

```bash
# widget-a is above widget-b → top-to-bottom
curl -X POST http://localhost:{PORT}/_storyboard/canvas/connector \
  -H 'Content-Type: application/json' \
  -d '{"name":"my-canvas","startWidgetId":"widget-a","endWidgetId":"widget-b","startAnchor":"bottom","endAnchor":"top"}'

# widget-c is to the left of widget-d → left-to-right
curl -X POST http://localhost:{PORT}/_storyboard/canvas/connector \
  -H 'Content-Type: application/json' \
  -d '{"name":"my-canvas","startWidgetId":"widget-c","endWidgetId":"widget-d","startAnchor":"right","endAnchor":"left"}'
```

---

## Broadcast & Messaging

Broadcast enables real-time messaging between connected agent/terminal widgets. It's controlled per-connector via `meta.messagingMode`.

### Enabling broadcast on a connector

Set `meta.messagingMode` when creating or updating a connector:

```bash
# Option A: Set messagingMode when creating the connector
curl -s -X POST "$STORYBOARD_SERVER_URL/_storyboard/canvas/connector" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "<canvasName>",
    "startWidgetId": "<widgetA>",
    "endWidgetId": "<widgetB>",
    "startAnchor": "right",
    "endAnchor": "left",
    "meta": { "messagingMode": "two-way" }
  }'

# Option B: Update an existing connector
curl -s -X PATCH "$STORYBOARD_SERVER_URL/_storyboard/canvas/connector" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "<canvasName>",
    "connectorId": "<connectorId>",
    "meta": { "messagingMode": "two-way" }
  }'
```

**Messaging modes:**
- `"two-way"` — both widgets can send and receive
- `"one-way"` — only start→end direction
- `null` — messaging disabled (default)

### Bulk broadcast toggle

Use the CLI to enable/disable broadcast across all connectors touching a widget (and optionally its entire connected component):

```bash
storyboard canvas broadcast \
  --canvas <canvasName> \
  --widget <widgetId> \
  --mode two-way \
  --pass-through
```

| Flag | Description |
|------|-------------|
| `--canvas`, `-c` | Canvas name (required) |
| `--widget`, `-w` | Widget to broadcast from (defaults to `$STORYBOARD_WIDGET_ID`) |
| `--mode`, `-m` | `two-way`, `one-way`, or `none` (default: `two-way`) |
| `--pass-through` | BFS entire connected component (default: direct neighbors only) |
| `--json` | Output result as JSON |

In batch operations, use `{ "op": "broadcast", "widgetId": "...", "mode": "two-way", "passThrough": true }`.

### Agent widgets

An **agent widget** (`type: "agent"`) creates a real, autonomous AI session — its own tmux process running Copilot, Claude, or Codex. It is NOT a simulation.

```bash
# Create an agent widget with a nickname
storyboard canvas add agent --canvas "$STORYBOARD_CANVAS_ID" --json \
  --name "Research Agent" --props '{"agentId": "copilot"}'
```

- `--name` sets the agent's **alias** (human-readable nickname). The auto-generated `prettyName` (e.g. `ivory-avocet`) remains as a unique fallback.
- `agentId` maps to keys in `canvas.agents` from `storyboard.config.json` (e.g. `"copilot"`, `"claude"`, `"codex"`)
- The agent auto-starts when the browser renders the widget — no separate spawn call needed
- If no `agentId` is provided, the first `canvas.agents` entry with `default: true` is used

### Alias management

```bash
storyboard canvas alias get --widget <id> --canvas <name>    # Read alias
storyboard canvas alias set --widget <id> --canvas <name> --alias "New Name"  # Set alias
storyboard canvas alias clear --widget <id> --canvas <name>  # Clear alias
```

When an alias is changed, the agent and all hub peers are notified via tmux send-keys.

For creating multi-agent hubs (multiple agents working together), invoke the **create-hub** skill.

---

## Reference: Server API (Fallback Only)

> **⚠️ Only use these endpoints when the CLI does not support the operation or when a CLI command has failed.** Always try the CLI first.

All endpoints are at `http://localhost:{PORT}/_storyboard/canvas/`. The port is determined by the worktree:

```js
import { detectWorktreeName, getPort } from '@dfosco/hypercanvas/worktree/port'
const port = getPort(detectWorktreeName())
```

### Read canvas state
```
GET /read?name={CANVAS_NAME}
```
Returns the materialized canvas with `widgets` array, `gridSize`, etc.

### List canvases
```
GET /list
```
Returns `{ canvases: [{ name, title, path, widgetCount }] }`.

### Add a widget
```
POST /widget
{ "name": "{CANVAS}", "type": "{TYPE}", "props": {} }
```

**Auto-positioned by default.** Omit `position` to let the server place it automatically using the priority chain (source agent → selected widget → viewport → last widget). Optional fields:

| Field | Description |
|-------|-------------|
| `position` | `{ "x": N, "y": N }` — explicit coordinates, overrides auto-positioning |
| `near` | Widget ID to position near. Set to `false` to disable auto-positioning |
| `direction` | `right`, `left`, `above`, `below`, `above-right`, `below-right`, `above-left`, `below-left` (default: `right`) |
| `gap` | Spacing between widgets in grid spaces (default: `1`). Use higher values (e.g. `10`) for connected widgets |
| `resolve` | `true` to run collision detection on explicit coordinates |
| `source` | Caller's widget ID (agent/terminal) — highest auto-position priority |

### Remove a widget
```
DELETE /widget
{ "name": "{CANVAS}", "widgetId": "{WIDGET_ID}" }
```

### Update a single widget
```
PATCH /widget
{ "name": "{CANVAS}", "widgetId": "{WIDGET_ID}", "props": { ... }, "position": { "x": 0, "y": 0 } }
```

### Bulk update (move, resize, reorder, update props)
```
PUT /update
{ "name": "{CANVAS}", "widgets": [ ...full widgets array... ] }
```
This replaces the entire widgets array. **Always read the current state first**, modify the array, then PUT it back.

### Update canvas settings
```
PUT /update
{ "name": "{CANVAS}", "settings": { "title": "...", "grid": true, "gridSize": 24, ... } }
```
Allowed setting keys: `title`, `description`, `grid`, `gridSize`, `colorMode`, `dotted`, `centered`, `author`, `snapToGrid`.

---

## Creating Widgets

Canvas widgets come in two categories: **content widgets** you can add directly, and **story widgets** that require scaffolding a component first.

### Content widgets (add directly via API/CLI)

These widgets are created inline — just call the add widget API with the type and props:

| Type | What it does | Key props |
|------|-------------|-----------|
| `sticky-note` | Text note with color | `text`, `color` |
| `markdown` | Rich markdown block | `content` |
| `prototype` | Embedded prototype iframe | `src` (URL/path), `label`, `zoom` |
| `figma-embed` | Figma frame embed | `url` |
| `codepen-embed` | CodePen embed | `url` |
| `link-preview` | URL preview card | `url`, `title`, `description` |
| `image` | Uploaded image | `src` (filename), `private` |

### Story widgets (scaffold first, then add)

A **story widget** embeds a React component (`.story.jsx`) directly on the canvas. To add one:

1. **Scaffold the component** — invoke the **`create` skill** with type "Component". This creates the correct directory structure (`ComponentName/ComponentName.jsx` + `name.story.jsx`), Primer conventions, and CSS Module patterns. Never create story files manually.
2. **Add the story widget to the canvas** — use the add widget API with type `story`:
   ```json
   {
     "type": "story",
     "props": {
       "storyId": "text-input",
       "exportName": "Default",
       "width": 400,
       "height": 300
     }
   }
   ```
   - `storyId` — the kebab-case component name (matches the story file stem)
   - `exportName` — which named export to render (e.g. `Default`, `WithValidation`)

3. **Or use the CLI**:
   ```bash
   npx storyboard canvas add story --canvas my-canvas --props '{"storyId":"text-input","exportName":"Default"}'
   ```

### Component-set widgets (all variants in one widget)

`component-set` is a **dedicated widget type** — not a prop on `story`. The canvas renderer maps `component-set` → `ComponentSetWidget` and `story` → `StoryWidget`. Using the wrong type renders the wrong component.

- ✅ `npx storyboard canvas add component-set --props '{ "storyId": "my-story" }'`
- ❌ `npx storyboard canvas add story --props '{ "storyId": "my-story", "componentSet": true }'`

A **component-set widget** renders ALL named exports from a single `.story.jsx` file in a grid layout inside one iframe. Use this instead of multiple `story` widgets when you want to show every variant of a component side by side.

1. **Scaffold the component** — same as story widgets: invoke the **`create` skill** with type "Component".
2. **Add the component-set widget to the canvas**:
   ```json
   {
     "type": "component-set",
     "props": {
       "storyId": "text-input",
       "layout": "horizontal",
       "width": 780,
       "height": 420
     }
   }
   ```

3. **Or use the CLI**:
   ```bash
   npx storyboard canvas add component-set --canvas my-canvas --props '{"storyId":"text-input"}'
   ```

#### Component-set props

| Prop | Values | Notes |
|------|--------|-------|
| `storyId` | file stem | Required. e.g. `cq-setup-progress` for `cq-setup-progress.story.jsx`, NOT the route path |
| `layout` | `horizontal` (default), `vertical` | Grid direction |
| `selected` | export name | Pre-selects a cell |
| `width`, `height` | number | Widget dimensions |

#### Authoring stories for component sets

- **Named exports only** — no `export default`. Each named export = one grid cell.
- **No wrapper chrome** — no headings, descriptions, or layout wrappers. The `ComponentSetPage` handles labels and grid layout.
- **PascalCase export names** — they become the cell labels (e.g. `Simple`, `RepoList`, `ProgressBar`).
- **`storyId` = file stem** — e.g. `cq-setup-progress` for `cq-setup-progress.story.jsx`, NOT the route path (`CqSetupProgress/cq-setup-progress`).
- **Route is auto-generated** from directory: `src/components/Foo/bar.story.jsx` → `/components/Foo/bar`.

**When to use `component-set` vs `story`:**
- Use `story` when embedding a single specific export (e.g. just the `Default` variant)
- Use `component-set` when showing all exports/variants of a component together (e.g. a design review of all states)
