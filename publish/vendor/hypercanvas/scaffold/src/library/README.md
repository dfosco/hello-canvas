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
| `workspace.jsx` | Deprecated `/workspace` route — retained for compatibility |
| `viewfinder.jsx` | `/viewfinder` redirect to the Notebook entry resolver |
| `create.jsx` | `/create` standalone artifact creator |
| `index.jsx` | `/` Notebook entry resolver; the sidebar owns page inventory and navigation |
| `home.jsx` | `/home` compatibility redirect to the Notebook entry resolver |

## How to customize storyboard

Almost every customization knob lives elsewhere:

| What you want to change | Edit |
|---|---|
| App title, theming, feature flags, surfaces | `storyboard.config.json` |
| Provider chain for every **prototype** (design system, fonts, Tailwind) | `src/_prototype.jsx` (optional — create it if you want it) |
| Provider chain for every **story** | `src/_story.jsx` (optional) |
| Add new routes the user can navigate to inside the SPA | Add files under `src/prototypes/` |

If you have a real reason to edit a file in this directory, just edit it —
storyboard will warn (but not block) on the next sync. You opt out of sync
by adding the file path to your `.storyboard-sync.ignore` file (planned).
