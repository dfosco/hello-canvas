---
name: agent-browser
description: Browser inspection and interaction during development using agent-browser CLI. Use when asked to inspect the browser, check the page, take a screenshot, get the accessibility tree, check for console errors, inspect an element, or see what's on screen.
---

# Agent Browser

> Triggered by: "inspect the browser", "check the page", "what does the page look like", "browser snapshot", "screenshot the page", "get the accessibility tree", "check for console errors", "inspect element", "check the dev server", "what's on screen"

Uses `agent-browser` to inspect and interact with the running dev server (or any URL) during development. Provides accessibility snapshots, screenshots, console error checking, element inspection, and interactive debugging — all without leaving the terminal.

## Prerequisites

```bash
npm install -g agent-browser
agent-browser install  # Downloads Chrome for Testing (first time only)
```

Both are already installed on this machine.

## Core Workflow

### Step 0: Resolve the target URL

Before opening the browser, check for a saved `devURL` in the session database:

```sql
SELECT value FROM session_state WHERE key = 'devURL';
```

- **If the user provided a URL** (e.g. "inspect http://localhost:3000") — assume the dev server is already running at that URL. Use it directly and save it as `devURL` for the session. Do **not** start a dev server.
  ```sql
  INSERT OR REPLACE INTO session_state (key, value) VALUES ('devURL', 'http://localhost:3000');
  ```
- **If set** — use the saved `devURL`. Assume the dev server is already running.
- **If neither** — fall back to `http://localhost:1234` and save it as `devURL`.

### Step 1: Open the dev server

Open the resolved URL in a headless browser session:

```bash
agent-browser --session dev open <devURL>
```

> **Headed mode:** If the user wants to see the browser window, add `--headed`:
> ```bash
> agent-browser --session dev --headed open <devURL>
> ```

> **Navigate to a specific prototype:** Append the prototype path:
> ```bash
> agent-browser --session dev open <devURL>/src/prototypes/Example
> ```

### Step 2: Inspect the page

Choose the right inspection method based on what you need:

#### Accessibility snapshot (best for understanding page structure)

```bash
agent-browser --session dev snapshot
```

Options:
- `-i` — Interactive elements only (buttons, inputs, links)
- `-c` — Compact (remove empty structural elements)
- `-d 3` — Limit tree depth
- `-s "#main"` — Scope to a CSS selector

```bash
# Common: interactive elements in the main content area
agent-browser --session dev snapshot -i -c -s "main"
```

#### Screenshot

```bash
agent-browser --session dev screenshot /tmp/hypercanvas-screenshot.png
```

Options:
- `--full` — Full page screenshot (not just viewport)
- `--annotate` — Overlay numbered labels on interactive elements

```bash
# Annotated screenshot showing all interactive elements
agent-browser --session dev screenshot --annotate /tmp/hypercanvas-annotated.png
```

#### Console errors

```bash
agent-browser --session dev console
agent-browser --session dev errors
```

#### Get element info

```bash
agent-browser --session dev get text @e1      # Text content by ref
agent-browser --session dev get html "#main"  # innerHTML by selector
agent-browser --session dev get title         # Page title
agent-browser --session dev get url           # Current URL
```

#### Check element state

```bash
agent-browser --session dev is visible "#my-element"
agent-browser --session dev is enabled "#submit-btn"
```

### Step 3: Interact with the page

After taking a snapshot, use refs (`@e1`, `@e2`, etc.) to interact:

```bash
agent-browser --session dev click @e2
agent-browser --session dev fill @e3 "search query"
agent-browser --session dev hover @e4
agent-browser --session dev scroll down 300
```

Or use CSS selectors:

```bash
agent-browser --session dev click "#sidebar-toggle"
agent-browser --session dev fill "input[name=search]" "hello"
```

### Step 4: Navigate

```bash
agent-browser --session dev open <devURL>/other-page
agent-browser --session dev back
agent-browser --session dev forward
agent-browser --session dev reload
```

### Step 5: Close the session

```bash
agent-browser --session dev close
```

---

## Common Recipes

### Quick page check after a code change

```bash
agent-browser --session dev open <devURL>
agent-browser --session dev snapshot -i -c
agent-browser --session dev errors
agent-browser --session dev close
```

### Screenshot + accessibility audit

```bash
agent-browser --session dev open <devURL>/src/prototypes/Example
agent-browser --session dev screenshot --annotate /tmp/audit.png
agent-browser --session dev snapshot
agent-browser --session dev close
```

### Debug a specific component

```bash
agent-browser --session dev open <devURL>/src/prototypes/Example
agent-browser --session dev snapshot -s "[data-testid=my-component]"
agent-browser --session dev get html "[data-testid=my-component]"
agent-browser --session dev close
```

### Check for JavaScript errors

```bash
agent-browser --session dev open <devURL>
agent-browser --session dev wait --load networkidle
agent-browser --session dev errors
agent-browser --session dev console
agent-browser --session dev close
```

### Batch multiple commands

```bash
agent-browser --session dev batch \
  "open <devURL>" \
  "wait --load networkidle" \
  "snapshot -i -c" \
  "errors" \
  "screenshot /tmp/check.png"
```

### Viewport emulation

```bash
agent-browser --session dev set viewport 375 812    # iPhone-sized
agent-browser --session dev set device "iPhone 14"  # Device preset
agent-browser --session dev screenshot /tmp/mobile.png
```

### Network request inspection

```bash
agent-browser --session dev network requests --type xhr,fetch
agent-browser --session dev network requests --filter api
agent-browser --session dev network requests --status 4xx
```

### Visual diff between two pages

```bash
agent-browser --session dev diff url <devURL>/page-a <devURL>/page-b --screenshot
```

---

## Session Management

- **Named sessions** (`--session dev`) keep browser state across commands. Always use `--session dev` for the development workflow.
- **Reuse sessions:** Don't close and reopen — just navigate with `open` or `goto`.
- **Multiple sessions:** Use different names if inspecting multiple things at once:
  ```bash
  agent-browser --session dev open <devURL>
  agent-browser --session prod open https://production-url.com
  ```
- **List sessions:** `agent-browser session list`
- **Close all:** `agent-browser close --all`

## Selectors

| Type | Example | Notes |
|------|---------|-------|
| Ref | `@e1` | From snapshot output. Deterministic, preferred. |
| CSS | `"#id"`, `".class"` | Standard CSS selectors |
| Text | `"text=Submit"` | Match by text content |
| XPath | `"xpath=//button"` | XPath expressions |
| Semantic | `find role button --name "Submit"` | ARIA role-based |

> **Prefer refs** (`@e1`) after taking a snapshot — they're deterministic and fast.

## Troubleshooting

- **"No active session"** — Run `agent-browser --session dev open <url>` first
- **Dev server not running** — Start with `npm run dev` before inspecting
- **Stale refs** — Take a new `snapshot` after page changes; refs are from the last snapshot
- **Browser stuck** — `agent-browser close --all` or `agent-browser --session dev close`
- **Chrome not found** — Run `agent-browser install`

## Repository Cleanup

- Screenshot files in `/tmp/` are ephemeral — no cleanup needed
- Session data lives in `~/.agent-browser/` — not in the repo
- Add `agent-browser.json` to `.gitignore` if you create a project-level config
