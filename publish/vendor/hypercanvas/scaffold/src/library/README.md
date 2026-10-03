# DO NOT EDIT FILES IN THIS DIRECTORY

`src/library/` contains storyboard's bootstrap boilerplate AND its workspace
pages (Workspace, Viewfinder, Create, the SPA landing index). These files
are managed by storyboard and may be overwritten by future
`storyboard update:version` runs.

The contents:

| File | What it does |
|---|---|
| `mount.jsx` | Vite SPA entry — `index.html` loads this |
| `prototypes-entry.jsx` | Vite iframe entry — `prototypes.html` loads this |
| `routes.jsx` | Generouted glue: scans `src/library/*.jsx` (workspace pages) and `src/prototypes/**` (your prototypes) |
| `_app.jsx`, `_app.module.css` | Workspace SPA shell — `StoryboardProvider`, suspense, error boundary, feature-flag banner |
| `workspace.jsx` | `/workspace` route — calls `<Workspace>`; props come from `pages.workspace` in `storyboard.config.json` |
| `viewfinder.jsx` | `/viewfinder` redirect (kept for back-compat) |
| `create.jsx` | `/create` standalone artifact creator |
| `home.jsx` | `/home` route — the landing surface (`<SimpleWorkspace>`); props come from `pages.home` in `storyboard.config.json` |
| `index.jsx` | `/` index — renders whichever surface `routes["/"]` selects (env-aware) |

## How to customize storyboard

Almost every customization knob lives elsewhere:

| What you want to change | Edit |
|---|---|
| App title, theming, feature flags, surfaces | `storyboard.config.json` |
| Which page renders at `/` (and per environment) | `storyboard.config.json` → `routes` |
| Landing / workspace titles, subtitles, logo, tabs | `storyboard.config.json` → `pages` |
| Provider chain for every **prototype** (design system, fonts, Tailwind) | `src/_prototype.jsx` (optional — create it if you want it) |
| Provider chain for every **story** | `src/_story.jsx` (optional) |
| Add new routes the user can navigate to inside the SPA | Add files under `src/prototypes/`, or a flat `src/<Name>.jsx` → `/<Name>` |

### `routes` — what renders at `/`

`routes` maps a path to a target page name. The index `/` defaults to `home`:

```jsonc
{
  "routes": {
    "/": "home"                                  // same page in every env
    // "/": { "dev": "workspace", "prod": "home" } // per-environment target
  }
}
```

A target is a page name with no leading slash — a library surface (`"home"`,
`"workspace"`) or a flat component (`"Dashboard"` for `src/Dashboard.jsx`). The
object form picks `dev` under `storyboard dev`, `prod` in production builds, and
`default` as a fallback. If `/` resolves to a flat component, the index
redirects there.

### `pages` — surface presentation props

`pages` holds the title/subtitle/logo/tab props the library pages used to
hardcode, so you configure surfaces without touching the JSX:

```jsonc
{
  "pages": {
    "home":      { "title": "My App", "subtitle": "Welcome" },
    "workspace": { "title": "My App", "showComponents": false }
  }
}
```

Both are leaf-merged over behavior-preserving defaults — set only the keys you
want to change.

### Flat-file routes

Any top-level `src/<Name>.jsx` automatically becomes a `/<Name>` route, rendered
**bare** (only the `_app` SPA shell — no prototype wrapper). Files prefixed with
`_` (e.g. `src/_prototype.jsx`) are excluded.

If you have a real reason to edit a file in this directory, just edit it —
storyboard will warn (but not block) on the next sync. You opt out of sync
by adding the file path to your `.storyboard-sync.ignore` file (planned).
