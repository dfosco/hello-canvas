---
name: create
description: Walks users through creating any Hypercanvas asset — prototype, external prototype, flow, canvas, component, object, or record. Use when asked to "create", "new", or "scaffold" anything in Hypercanvas.
---

# Create

> Triggered by: "create a new prototype", "scaffold a prototype", "new prototype", "create prototype", "new flow", "create flow", "new page", "create page", "new canvas", "create canvas", "new component", "create component", "new object", "create object", "new record", "create record", "create new", "scaffold", "add external prototype", "link external prototype"

## What This Does

Guides the user through creating a new Hypercanvas **prototype**, **external prototype**, **flow**, **page**, **canvas**, **component**, **object**, or **record** by collecting inputs interactively, then writing the files directly or calling the scaffolding API.

## Procedure

### Step 1: Ask what to create

Use `ask_user` to ask:

> What would you like to create?

Provide choices:
- "Prototype" — A new page with routing and metadata
- "External Prototype" — A link to a prototype hosted elsewhere (opens in new tab)
- "Flow" — A new prototype-scoped flow data file (.flow.json)
- "Page" — A new page inside an existing prototype
- "Canvas" — A new freeform canvas (.canvas.jsonl)
- "Component" — A story-format component (.story.jsx) that renders at /components/name
- "Object" — A reusable data fragment (.object.json)
- "Record" — A parameterized collection (.record.json)

If the user's original request already specifies the type (e.g., "create a new canvas", "add an external prototype"), skip this step and proceed directly.

---

## Prototype Path

### Step P1: Ask for the prototype name

Use `ask_user` to ask:

> What should the prototype be called? Use kebab-case (e.g., `my-new-prototype`, `dashboard-v2`).

Validate the name is kebab-case (lowercase letters, numbers, hyphens only).

### Step P2: Ask for the title

Use `ask_user` to ask with a suggested default based on the name (humanized):

> What's the human-readable title for this prototype?

Provide the humanized name as the first choice (e.g., for `my-prototype` suggest "My Prototype"), with a freeform option.

### Step P3: Ask about folder placement

First, check which `.folder` directories exist by running:

```bash
ls -d src/prototypes/*.folder 2>/dev/null | sed 's|src/prototypes/||;s|\.folder||'
```

Then use `ask_user` to ask:

> Should this prototype go inside an existing folder group?

Provide choices:
- Each existing folder (e.g., "security-offsite", "code-quality")
- "Standalone (no folder group)"
- "Create a new folder group"

If "Create a new folder group" is chosen, ask for the folder name in a follow-up question.

### Step P4: Ask for the recipe

Use `ask_user` to ask:

> Which template should I use?

Provide choices:
- `bare` — Minimal page with Application template (Recommended)
- `security` — Security recipe with repo-level navigation
- `security-org` — Security Org recipe with org-level navigation

### Step P5: Ask for author

Use `ask_user` to ask:

> What's your GitHub username? (for the author field — comma-separate multiple authors)

### Step P5b: Ask for description (optional)

Use `ask_user` to ask:

> Any description for this prototype? (optional — leave blank to skip)

### Step P6: Ask about flow file

Use `ask_user` to ask:

> Should I create a starter flow.json file for this prototype?

Choices: "Yes", "No"

A flow file is useful if the prototype will use flow data (navigation, user profiles, entity lists). It can always be added later.

### Step P7: Run the script

Build and execute the command with the gathered values:

```bash
npm run create -- --name <name> --title "<title>" [--folder <folder>] [--recipe <recipe>] [--author <author>] [--description "<description>"] [--flow]
```

Only include optional flags when the user provided values:
- Omit `--folder` if standalone was chosen
- Omit `--flow` if the user said no
- Omit `--description` if not provided
- Always include `--recipe` (default is `bare`)

### Step P8: Confirm and suggest next steps

After the script runs successfully:

1. Show the user what was created (the script prints a summary)
2. Suggest next steps:
   - Run `npm run dev` to preview the prototype
   - Use the **hypercanvas** skill to add data objects and flows
   - Use the **primer-screenshot-builder** skill to build pages from screenshots
   - Edit `index.jsx` directly to start building

---

## External Prototype Path

An external prototype is a reference to a prototype hosted at an external URL. It shows up in the viewfinder with an "external" badge and opens in a new tab. No `index.jsx` or flow files are created — only a folder with a `.prototype.json` containing a `url` field.

### Step E1: Ask for the prototype name

Use `ask_user` to ask:

> What should the external prototype be called? Use kebab-case (e.g., `figma-design`, `staging-app`).

Validate the name is kebab-case (lowercase letters, numbers, hyphens only).

### Step E2: Ask for the URL

Use `ask_user` to ask:

> What's the URL of the external prototype?

Validate it's a valid absolute URL (must start with `http://` or `https://`).

### Step E3: Ask for the title

Use `ask_user` to ask with a suggested default based on the name (humanized):

> What's the human-readable title for this prototype?

Provide the humanized name as the first choice, with a freeform option.

### Step E4: Ask about folder placement

First, check which `.folder` directories exist by running:

```bash
ls -d src/prototypes/*.folder 2>/dev/null | sed 's|src/prototypes/||;s|\.folder||'
```

Then use `ask_user` to ask:

> Should this prototype go inside an existing folder group?

Provide choices:
- Each existing folder (e.g., "main", "security-offsite")
- "Standalone (no folder group)"

### Step E5: Ask for author (optional)

Use `ask_user` to ask:

> What's your GitHub username? (for the author field — comma-separate multiple authors, or leave blank)

### Step E5b: Ask for description (optional)

Use `ask_user` to ask:

> Any description for this external prototype? (optional — leave blank to skip)

### Step E6: Create the external prototype

Determine the target directory:
- If in a folder: `src/prototypes/<folder>.folder/<name>/`
- If standalone: `src/prototypes/<name>/`

Create the directory and write the `.prototype.json` file:

```json
{
  "meta": {
    "title": "<Title>",
    "author": ["<author>"],
    "description": "<description if provided>"
  },
  "url": "<url>"
}
```

Only include `author` and `description` if provided. The `url` field is required.

### Step E7: Confirm and suggest next steps

1. Show the created file path
2. Explain it will appear in the viewfinder with an "external" badge
3. Suggest:
   - Run `npm run dev` and check the viewfinder to see the entry
   - Click the entry to open the external URL in a new tab
   - Edit the `.prototype.json` to update the URL or metadata anytime

---

## Flow Path

### Step F1: Ask for the flow name

Use `ask_user` to ask:

> What should the flow be called? Use kebab-case (e.g., `empty-state`, `admin-view`).

Validate the name is kebab-case.

### Step F2: Ask for the target prototype

Fetch available prototypes from Workshop API:

```bash
GET /_storyboard/workshop/flows
```

Use `ask_user` to ask:

> Which prototype should this flow belong to?

Provide choices:
- Each non-external prototype from API response (`folder / prototype` label when folder exists)

### Step F3: Ask for title

Use `ask_user` with a humanized default:

> What's the human-readable title for this flow?

### Step F3b: Ask for description (optional)

Use `ask_user` to ask:

> Any description for this flow? (optional — leave blank to skip)

### Step F4: Ask about copying from an existing flow (optional)

From the same API response, filter `flows` to the selected prototype (+ same folder when present).

Use `ask_user`:

> Would you like to copy data from an existing flow?

Choices: "No, start empty", then matching existing flow entries.

### Step F5: Ask for starting page (optional)

Use the selected prototype's `routes` from API and ask:

> Do you want a starting page route for this flow?

Choices:
- "None"
- Existing routes (e.g. `/my-proto/repositories`)
- "Create new page"

If "Create new page" is selected, ask:

1. New page path suffix (shown under `/<prototype>/...`, e.g. `security/new-page`)
2. Template / recipe (optional; choices come from API `partials` filtered by current prototype scope)

Template/recipe choice rules:
- Always include global partials (`scope: "global"`)
- Include prototype-scoped partials only when `partial.prototype` and `partial.folder` match the selected prototype
- Submit the selected **partial `id`** (not display `name`)

### Step F6: Create the flow via Workshop API

Send:

```bash
POST /_storyboard/workshop/flows
{
  "name": "<kebab-name>",
  "title": "<title>",
  "description": "<description-if-provided>",
  "prototype": "<prototype>",
  "folder": "<folder-if-any>",
  "copyFrom": "<relative-flow-path-if-selected>",
  "startingPage": "<existing-route-if-selected>",
  "createPage": {
    "path": "/<prototype>/<new-page-suffix>",
    "template": "<partial-id-optional>"
  }
}
```

Notes:
- `prototype` is required (no global flow creation in Workshop).
- `createPage` is only sent when user selected "Create new page".
- If `createPage` is sent, created page path is returned alongside created flow.

### Step F7: Confirm and suggest next steps

1. Show created flow path (and created page path if applicable)
2. Suggest next steps:
    - Use the **hypercanvas** skill to add data objects and `$ref` references
    - Add `$global` entries for shared objects (e.g., navigation, user)
    - Switch to the flow with the Flows menu or `?flow=<name>`

---

## Page Path

### Step PG1: Ask for target prototype

Fetch:

```bash
GET /_storyboard/workshop/pages
```

Use `ask_user`:

> Which prototype should this page be created in?

Choices: non-external prototypes (`folder / prototype` label when folder exists).

### Step PG2: Ask for page path

Use `ask_user`:

> What should the page path be inside this prototype? (e.g., `new-page`, `security/overview`, `[id]`)

Always normalize and submit as `/<prototype>/<path>`.

### Step PG3: Ask for template / recipe (optional)

Use `ask_user`:

> Should this page start from a template?

Choices:
- "Blank page (Recommended)"
- Matching `partials` from API (global + same-prototype scoped), grouped for the user by:
  - Global
  - `<selected-prototype>` (prototype-scoped)

Use the selected partial's **`id`** in the request payload.

### Step PG4: Create page via Workshop API

Send:

```bash
POST /_storyboard/workshop/pages
{
  "prototype": "<prototype>",
  "folder": "<folder-if-any>",
  "path": "/<prototype>/<path>",
  "template": "<partial-id-optional>"
}
```

### Step PG5: Confirm and suggest next steps

1. Show the created file path and route
2. Suggest next steps:
   - Open the page in dev server
   - Add matching flow data or connect an existing flow
   - Iterate in `index.jsx` / page component directly

---

## Canvas Path

### Step C1: Ask for the canvas name

Use `ask_user` to ask:

> What should the canvas be called? Use kebab-case (e.g., `design-overview`, `button-patterns`).

Validate the name is kebab-case.

### Step C2: Ask for the title

Use `ask_user` with a humanized default:

> What's the human-readable title for this canvas?

### Step C2b: Ask for description (optional)

Use `ask_user` to ask:

> Any description for this canvas? (optional — leave blank to skip)

### Step C3: Ask about folder placement

Check existing canvas folders:

```bash
ls -d src/canvas/*.folder 2>/dev/null | sed 's|src/canvas/||;s|\.folder||'
```

Use `ask_user`:

> Should this canvas go inside an existing folder group?

Provide choices:
- Each existing folder (e.g., "design-system", "explorations")
- "Standalone (no folder group)"
- "Create a new folder group"

If "Create a new folder group" is chosen, ask for the folder name in a follow-up question.

### Step C4: Ask about options

Use `ask_user`:

> Should the canvas include a JSX companion file? (for code-defined widgets)

Choices: "No (Recommended)", "Yes"

### Step C5: Create the canvas

Use the canvas creation API via curl:

```bash
curl -s -X POST "http://localhost:$(cat .port 2>/dev/null || echo 1234)/_storyboard/canvas/create" \
  -H "Content-Type: application/json" \
  -d '{"name":"<name>","title":"<title>","description":"<description-if-provided>","folder":"<folder>","grid":true,"includeJsx":<bool>}'
```

Or if the dev server isn't running, create the file directly at `src/canvas/<name>.canvas.jsonl`:

```jsonl
{"event":"canvas_created","timestamp":"<ISO date>","title":"<Title>","description":"<description-if-provided>","grid":true,"gridSize":24,"colorMode":"auto","widgets":[]}
```

### Step C6: Confirm and suggest next steps

1. Show the created file path and route (`/canvas/<name>`)
2. Suggest next steps:
   - Run `npm run dev` and navigate to the canvas
   - Add widgets via the toolbar (sticky notes, markdown, prototypes)
   - Paste URLs to embed prototypes or link previews

---

## Connecting Widgets

After adding widgets to a canvas, you can connect them visually with **connectors** — directional lines between two widgets.

Use the canvas server API:

```bash
curl -X POST http://localhost:$(cat .port 2>/dev/null || echo 1234)/_storyboard/canvas/connector \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "<canvas-name>",
    "startWidgetId": "<source-widget-id>",
    "endWidgetId": "<target-widget-id>",
    "startAnchor": "right",
    "endAnchor": "left"
  }'
```

Anchors can be `top`, `bottom`, `left`, or `right`. Connectors are directional — they go from `start` to `end`.

> **Full reference:** See the **Connectors** section in the **canvas skill** (`.agents/skills/canvas/SKILL.md`) for the complete API, deletion, direction patterns, and 1→n examples.

---

## Object Path

Objects are reusable JSON data fragments (users, navigation, settings, etc.). They are referenced in flows via `$ref` or `$global`.

### Step O1: Ask for the object name

Use `ask_user` to ask:

> What should the object be called? Use kebab-case (e.g., `jane-doe`, `navigation`, `settings`).

Validate the name is kebab-case.

### Step O2: Ask about prototype scope

First, list available prototypes:

```bash
find src/prototypes -name "*.prototype.json" -not -path "*/node_modules/*" 2>/dev/null | sed 's|src/prototypes/||;s|/[^/]*\.prototype\.json||' | sort -u
```

Use `ask_user` to ask:

> Should this object belong to a specific prototype, or be global?

Provide choices:
- "Global (available to all prototypes)"
- Each existing prototype name

### Step O3: Ask for initial shape

Use `ask_user` to ask:

> What kind of data does this object represent? Describe briefly so I can generate the initial structure (e.g., "a user with name, avatar, role", "sidebar navigation links").

Alternatively, the user can say "start empty".

### Step O4: Create the object file

Determine the target directory:
- If global: `src/data/` (create if needed)
- If prototype-scoped: `src/prototypes/<proto-name>/` (inside `.folder/` if applicable)

Create `<name>.object.json` with the generated structure, or an empty object if "start empty":

```json
{}
```

Example generated structure for "a user with name, avatar, role":

```json
{
  "name": "Jane Doe",
  "username": "janedoe",
  "avatar": "https://avatars.githubusercontent.com/u/1?v=4",
  "role": "admin"
}
```

### Step O5: Confirm and suggest next steps

1. Show the created file path
2. Suggest next steps:
   - Reference it in a flow with `{ "$ref": "<name>" }` or add to `$global`
   - Access it directly with `useObject('<name>')` in a component
   - Edit the JSON to add or modify fields

---

## Record Path

Records are collections — arrays of entries, each with a unique identifier. They power dynamic routes (e.g., a list page + detail pages).

### Step R1: Ask for the record name

Use `ask_user` to ask:

> What should the record collection be called? Use kebab-case, plural form (e.g., `posts`, `team-members`, `repositories`).

Validate the name is kebab-case.

### Step R2: Ask about prototype scope

First, list available prototypes:

```bash
find src/prototypes -name "*.prototype.json" -not -path "*/node_modules/*" 2>/dev/null | sed 's|src/prototypes/||;s|/[^/]*\.prototype\.json||' | sort -u
```

Use `ask_user` to ask:

> Should this record belong to a specific prototype, or be global?

Provide choices:
- "Global (available to all prototypes)"
- Each existing prototype name

### Step R3: Ask for ID field

Use `ask_user` to ask:

> What field should be the unique identifier for each entry? This maps to the `[param]` in dynamic route filenames.

Provide choices:
- "id (Recommended)"
- "slug"
- "permalink"

### Step R4: Ask for entry fields

Use `ask_user` to ask:

> Describe the entries in this collection (e.g., "blog posts with title, author, date, excerpt" or "repos with name, stars, language"). I'll generate sample data.

Alternatively, the user can say "start with a minimal example".

### Step R5: Create the record file

Determine the target directory:
- If global: `src/data/` (create if needed)
- If prototype-scoped: `src/prototypes/<proto-name>/` (inside `.folder/` if applicable)

Create `<name>.record.json` with the generated entries. Always include at least 2–3 sample entries:

```json
[
  { "id": "first-entry", "title": "First Entry" },
  { "id": "second-entry", "title": "Second Entry" },
  { "id": "third-entry", "title": "Third Entry" }
]
```

### Step R6: Confirm and suggest next steps

1. Show the created file path
2. Suggest next steps:
   - Create a dynamic route page `[id].jsx` (or `[slug].jsx` etc.) to render individual entries
   - Use `useRecord('<name>')` in the detail page to get the matched entry
   - Use `useRecords('<name>')` in a list page to get all entries
   - Add more entries to the JSON file anytime

---

## Rules

- **Context inference:** If the user's prompt already contains answers to any question (type, name, template, folder, URL, author, description, etc.), **skip that question** and use the provided value directly. Only ask about missing information. For example, "create a prototype called dashboard with Application template" should skip the name and template questions.
- **Always use `ask_user`** for each remaining question — never assume values that weren't provided
- **One question at a time** — don't bundle questions
- Names must be kebab-case: `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`
- Titles default to a humanized version of the name if the user accepts the suggestion
- Description is optional — skip it unless the user volunteers one
- Available prototype recipes: `bare` (default), `security`, `security-org`
- For **Workshop Flow** and **Workshop Page** creation, prefer API-backed creation (`/_storyboard/workshop/flows`, `/_storyboard/workshop/pages`) over direct file writes so validation and route/template behavior stay consistent
- **Data files must live inside the prototype folder.** Every prototype must contain its own copies of any `.record.json`, `.object.json`, or `.flow.json` files it needs — never reference or import data files from other prototypes. Each prototype is an independent sandbox.
- **Records must be arrays** with each entry having a unique identifier field (default: `id`)
- **Objects are plain JSON** — no special keys required, any shape works
- **Widget URL verification:** Whenever this skill (or any process it triggers) adds a widget to a canvas, the response **must** include the widget ID. Provide a direct URL: `{baseURL}canvas/{canvasName}#{widgetId}` where `baseURL` is the proxy or direct URL for the current worktree (see **canvas skill** Step 5 for construction details). If no widget ID is returned, treat it as a creation failure and retry.

---

## Component Path

> Triggered when user selects "Component" or says "create a component", "new component", "create story", "edit component", "edit a story", "add embeded component"

### Step C1: Ask for the component name

Use `ask_user`:
> What should the component be called?

The name must be **kebab-case** (e.g., `button-patterns`, `user-card`).

### Step C2: Create the component directory and story file

**Every component must live in its own directory.** Create `src/components/<PascalName>/` containing:

- `<PascalName>.jsx` — The component file (atomic, self-contained)
- `<PascalName>.module.css` — CSS Module styles
- `<name>.story.jsx` — Story file that **imports the local component** and exposes it as named exports

Convert the kebab-case name to PascalCase for the directory and component files (e.g., `button-patterns` → `ButtonPatterns/ButtonPatterns.jsx`). The story file stays kebab-case.

Each named export in the story becomes a renderable variant at the component's route URL.

**Story files must import the component from the same directory** — never import Primer primitives directly as the story subject. Example:

```jsx
// src/components/UserCard/user-card.story.jsx
import UserCard from './UserCard.jsx'

export function Default() {
  return <UserCard name="Jane Doe" role="admin" />
}
```

**Never place component files flat in `src/components/` — always use a subdirectory.**

### Icon imports

Components and stories frequently fail at runtime with errors like `does not provide an export named 'ScissorsIcon'` because agents invent icon names. Before adding any `import { FooIcon } from '@primer/octicons-react'`:

1. **Check `.agents/data/primer-octicons.json`** — the authoritative list of valid icon exports (generated from the installed package).
2. If the icon name you want is NOT in that list, pick the closest available one from the list. Do not guess — there is no `ScissorsIcon`, no `EditIcon` (use `PencilIcon`), no `DeleteIcon` (use `TrashIcon`), etc.
3. Same rule applies to prototypes, stories, components, and any other React code.

Regenerate the list after a package bump: `node scripts/gen-octicons-list.mjs`.

### Step C3: Confirm and suggest next steps

1. Show the created directory and file paths
2. Suggest next steps:
   - Visit `/components/<name>` to see the rendered component
   - Add more named exports for different variants
   - Paste the component URL on any canvas to embed it as a widget
   - Use the CLI: `storyboard canvas add story --canvas <name>` to add programmatically

### CLI shortcut

```bash
storyboard create component --name my-component
```
