/**
 * Config Schema — canonical shape and defaults for storyboard.config.json.
 *
 * Every consumer of storyboard.config.json should import `getConfig()` to get
 * a fully defaulted, validated config object. New keys added here are safe for
 * existing projects — they always have defaults.
 *
 * @module configSchema
 */

/**
 * @typedef {object} PasteRule
 * @property {string} match    — regex string tested against pasted URLs
 * @property {string} widget   — widget type to create (e.g. "figma-embed", "link-preview")
 * @property {Record<string, string>} [propsMap] — static props merged into widget props
 */

/**
 * @typedef {object} CanvasTerminalConfig
 * @property {boolean} [resizable]   — whether terminal widgets can be resized (default false)
 * @property {number}  [defaultWidth]  — default width for new terminal widgets
 * @property {number}  [defaultHeight] — default height for new terminal widgets
 * @property {number}  [fontSize]    — terminal font size
 * @property {string}  [fontFamily]  — terminal font family
 * @property {string}  [prompt]      — shell prompt string
 * @property {string|null} [startupCommand] — skip welcome screen: "copilot", "shell", or a custom command. null shows welcome.
 * @property {object|null} [defaultStartupSequence] — sequence of steps to run after terminal opens
 */

/**
 * @typedef {object} CanvasZoomConfig
 * @property {number} min  — minimum zoom percentage (default 10)
 * @property {number} max  — maximum zoom percentage (default 250)
 * @property {number} step — zoom increment/decrement step (default 10)
 */

/**
 * @typedef {(null|string|CanvasFileEditorThemeSpec)} CanvasFileEditorThemeValue
 *   Theme spec for the file widget CodeMirror editor. Accepts:
 *   - `null` / `"default"` / `"none"` — no theme extension (CodeMirror default)
 *   - `"oneDark"` — bundled `@codemirror/theme-one-dark`
 *   - `{ spec, dark }` — inline theme passed through to `EditorView.theme(spec, { dark })`
 */

/**
 * @typedef {object} CanvasFileEditorThemeSpec
 * @property {object}  spec   — CodeMirror theme spec (selector → style map) for `EditorView.theme`
 * @property {boolean} [dark] — whether the spec should be tagged dark (default: false)
 */

/**
 * @typedef {object} CanvasFileEditorConfig
 * @property {{ light: CanvasFileEditorThemeValue, dark: CanvasFileEditorThemeValue }} [theme]
 *   Per-mode CodeMirror theme. The active theme is picked based on the
 *   `codeBoxes` surface resolved value (`data-sb-code-theme` on `<html>`):
 *   any value starting with `"dark"` selects `theme.dark`, otherwise `theme.light`.
 *   Defaults: `{ light: null, dark: "oneDark" }`.
 */

/**
 * @typedef {object} CanvasProductionConfig
 *   Opt-in switches that re-enable normally dev-only canvas affordances in
 *   production builds (or `?prodMode` simulation). All default to false.
 * @property {boolean} [move]         — allow dragging widgets in production
 * @property {boolean} [resize]       — allow resizing widgets in production
 * @property {boolean} [editMarkdown] — allow editing markdown widget content in production
 * @property {boolean} [editSticky]   — allow editing sticky-note text in production
 */

/**
 * @typedef {object} CanvasConfig
 * @property {PasteRule[]} pasteRules       — URL→widget conversion rules (evaluated in order, first match wins)
 * @property {{ embedBehavior: string, ghGuard: string }} github — GitHub-specific embed settings
 * @property {CanvasTerminalConfig} [terminal] — terminal widget settings
 * @property {Record<string, CanvasAgentConfig>} [agents] — per-agent overrides
 * @property {CanvasZoomConfig} [zoom] — zoom min/max/step settings
 * @property {CanvasFileEditorConfig} [fileEditor] — file widget CodeMirror editor settings
 * @property {CanvasProductionConfig} [production] — opt-in production affordances
 */

/**
 * @typedef {object} CanvasAgentConfig
 * @property {string}  [label]         — display label
 * @property {string}  [icon]          — icon name
 * @property {string}  [startupCommand] — command to run on startup
 * @property {string}  [postStartup]   — command sent after agent readiness (e.g. "/allow-all on")
 * @property {string}  [readinessSignal] — terminal output that signals the agent is ready (fragile, prefer readinessFile)
 * @property {string}  [resumeCommand]  — full command template to resume a session, with `{id}` placeholder (e.g. `"copilot --resume={id} --agent terminal-agent"`). Used both for auto-resume on cold restart (with `{id}` substituted) and for the interactive "Browse existing sessions" flow (binary derived, `--resume` appended).
 * @property {boolean} [readinessFile]  — use a file-based SessionStart hook for readiness (writes --settings with hook, polls for signal file)
 * @property {string}  [sessionIdEnv]   — env var exposed in the agent's SessionStart hook payload that holds its session id (e.g. "COPILOT_AGENT_SESSION_ID"). When set, the server captures the id per-widget so cold restarts can auto-resume.
 * @property {string}  [sessionStateDir] — directory where the agent stores per-session state, used to pre-flight `--resume` (e.g. "~/.copilot/session-state"). Pass `null` to skip the fs check (UUID-only validation).
 * @property {string}  [sessionStateGlob] — alternative to sessionStateDir for agents that store sessions under a per-project subdir, with `{id}` placeholder (e.g. "~/.claude/projects/*‍/{id}.jsonl").
 * @property {{type: string, command?: string, timeoutMs?: number}|null} [contextAdapter] — optional native inbox delivery adapter. Skill-driven polling remains available when omitted or unsupported.
 * @property {boolean} [resumeFallback]  — when true (default), the resume command is shell-chained with `|| <startupCommand>` so a runtime resume failure falls through to a fresh session instead of leaving the widget with a dead terminal. Set false to opt out.
 * @property {boolean} [resizable]     — override terminal resizability for this agent
 * @property {number}  [defaultWidth]  — override default width
 * @property {number}  [defaultHeight] — override default height
 */

/**
 * @typedef {object} HotPoolConfig
 * @property {boolean} [enabled]       — enable/disable all pools (default: true)
 * @property {boolean} [verbose]       — log to Vite terminal (default: false)
 * @property {number}  [default_pool_size]     — default baseline per pool (default: 1)
 * @property {number}  [default_max_pool_size] — default surge cap per pool (default: 3)
 * @property {boolean} [load_balancer] — enable auto-scaling (default: true)
 * @property {number}  [load_balancer_cooldown_mins] — minutes idle before scale-down (default: 10)
 * @property {Record<string, { pool_size?: number, max_pool_size?: number }>} [pools] — per-pool overrides (terminal, prompt, copilot, claude, codex, opencode).
 */

/**
 * @typedef {object} CommandPaletteConfig
 * @property {string[]} providers — provider IDs to enable
 * @property {string}   ranking   — result ranking strategy
 * @property {CommandPaletteSection[]} [sections] — declarative palette sections
 */

/**
 * @typedef {object} CommandPaletteSection
 * @property {string}  id       — unique section identifier
 * @property {string}  [title]  — section heading in the palette
 * @property {string}  [type]   — "tool-menu" for sub-page entries
 * @property {string}  [label]  — display label (for tool-menu entries)
 * @property {string[]} [keywords] — search keywords
 * @property {CommandPaletteSectionItem[]} [items]   — static entries
 * @property {string}  [source] — dynamic data source: "canvases" | "prototypes" | "stories"
 * @property {string}  [order]  — ordering: "recent" | "alphabetical" | "recent-changes"
 * @property {number}  [limit]  — max items from dynamic source
 * @property {CommandPaletteOption[]} [options] — sub-page options (for tool-menu type)
 */

/**
 * @typedef {object} CommandPaletteSectionItem
 * @property {string} type     — "link" | "action"
 * @property {string} label    — display text
 * @property {string} [url]    — navigation URL (for links)
 * @property {string} [action] — command action ID (for actions)
 * @property {string[]} [keywords] — search keywords
 */

/**
 * @typedef {object} CommandPaletteOption
 * @property {string} label   — display text
 * @property {string} action  — command action ID
 * @property {*}      [value] — action payload
 */

/**
 * @typedef {("all"|"none"|{hide?: string[]}|{only?: string[]})} CustomerModeToolsRule
 *   Granular toolbar tool gating for customer mode:
 *   - `"all"`            → show every tool (default)
 *   - `"none"`           → hide every tool & toolbar wrapper
 *   - `{ hide: [keys] }` → hide listed tool keys; show rest
 *   - `{ only: [keys] }` → show only listed tool keys; hide rest
 */

/**
 * @typedef {object} CustomerModeConfig
 * @property {boolean} enabled       — master toggle for customer mode
 * @property {false|true|string} [homepage]
 *   Homepage control:
 *   - `false` → keep default workspace homepage (default)
 *   - `true`  → hide workspace; render empty page
 *   - string  → redirect `/`, `/workspace`, `/viewfinder` to:
 *               • `"/canvas/x"`   → passthrough
 *               • `"/MyProto"`    → passthrough (prototype path / custom route)
 *               • `"landing"`     → `/canvas/landing` (canvas id shorthand)
 *               • `"https://..."` → external URL (`window.location.replace`)
 * @property {CustomerModeToolsRule} [tools]
 *   Granular tool gating. Defaults to `"all"`. See {@link CustomerModeToolsRule}.
 * @property {boolean} [commandPalette]
 *   `false` hides the Cmd+K palette and disables the shortcut. Defaults to `true`.
 * @property {boolean} [branchBar]
 *   `false` hides the top branch/dev bar. Defaults to `true`.
 *
 * Legacy (deprecated, still accepted — auto-mapped to the new shape):
 * @property {boolean} [hideChrome]   — DEPRECATED. Use `tools: "none"` + `commandPalette: false` + `branchBar: false`.
 * @property {boolean} [hideHomepage] — DEPRECATED. Use `homepage: true`.
 * @property {string}  [protoHomepage] — DEPRECATED. Use `homepage: "/path"`.
 * @property {string}  [canvasHomepage] — DEPRECATED. Use `homepage: "canvasId"`.
 */

/**
 * @typedef {object} ThemeDefinition
 * @property {string} label                       — display name shown in theme switchers
 * @property {Record<string,string>} [attrs]      — companion data attributes written onto each surface element when this theme is active (e.g. Primer's `data-color-mode`, `data-light-theme`). Storyboard core writes no companion attrs by default; consumers (Primer-using repos, etc.) add them via their own storyboard.config.json.
 */

/**
 * @typedef {object} SurfaceDefinition
 * @property {string}  label   — display label shown in the "Apply theme to" sub-menu
 * @property {boolean} sync    — default value for whether this surface follows the global theme (true) or stays light (false). Persisted per-user in localStorage.
 */

/**
 * @typedef {object} ThemesConfig
 * @property {Record<string, ThemeDefinition>}   themes    — registry of available themes. Theme IDs are the values written to `data-sb-<surface>-theme`. Storyboard core ships only `light` and `dark`; consumers add more (e.g. `dark_dimmed`, `light_colorblind`).
 * @property {Record<string, SurfaceDefinition>} surfaces  — registry of theming surfaces. Each surface ID is matched against `[data-sb-surface="<id>"]` elements in the DOM. The runtime writes `data-sb-<id>-theme` onto those elements plus the companion `attrs` from the active theme. Core ships `prototype`, `canvas`, `toolbar`, `codeBoxes`.
 * @property {string}  [default]  — default global theme ID. Use `"system"` to follow OS preference.
 */

/**
 * @typedef {(string|{dev?: string, prod?: string, default?: string})} RouteTarget
 *   Target page for a configured route path. Either:
 *   - a string — the page name (no leading slash) used in every environment,
 *     e.g. `"home"`, `"workspace"`, or a flat component like `"Dashboard"`.
 *   - an object — a per-environment target. `dev` is used when
 *     `import.meta.env.DEV` is true (running `storyboard dev`); `prod` is used
 *     in production builds; `default` is the fallback when the active env key
 *     is absent. See {@link resolveRouteTarget} for resolution order.
 */

/**
 * @typedef {Record<string, RouteTarget>} RoutesConfig
 *   Map of route path → {@link RouteTarget}. The index path `"/"` controls
 *   `/` is owned by the Notebook entry resolver. Legacy targets remain
 *   readable by older clients.
 */

/**
 * @typedef {object} HomePageConfig
 *   Presentation props for the `home` surface (SimpleWorkspace landing). The
 *   library `home.jsx`/`index.jsx` files spread these — customers configure the
 *   surface here and never edit the JSX.
 * @property {string} [title]    — app name shown in the header (default "Storyboard")
 * @property {string} [subtitle] — sub-line under the title
 */

/**
 * @typedef {object} WorkspacePageConfig
 *   Presentation props for the `workspace` surface (Viewfinder). Spread by the
 *   library `workspace.jsx`; customers configure here, never edit the JSX.
 * @property {string}  [title]            — app name (default "Storyboard")
 * @property {string}  [subtitle]         — sub-line under the title
 * @property {string|null} [logo]         — logo node/text; falsy → render `logoIcon`
 * @property {string}  [logoIcon]         — Octicon/Iconoir name (default "iconoir/key-command")
 * @property {boolean} [showAllArtifacts] — show the combined "All" tab (default false)
 * @property {boolean} [showPrototypes]   — show the Prototypes tab (default true)
 * @property {boolean} [showCanvases]     — show the Canvases tab (default true)
 * @property {boolean} [showComponents]   — show the Components tab (default true)
 */

/**
 * @typedef {object} PagesConfig
 *   Per-surface presentation props, keyed by surface/target name. Holds every
 *   prop the library workspace pages used to hardcode, so customers configure
 *   surfaces purely via config. Behavior-preserving defaults match today's UX.
 * @property {HomePageConfig}      [home]
 * @property {WorkspacePageConfig} [workspace]
 */

/**
 * @typedef {object} StoryboardConfig
 * @property {string}   [customDomain]
 * @property {string}   [prodDomain] — production host (and optional base path) for the deployed env, e.g. "dfosco.github.io/storyboard/"
 * @property {number}   [port] — fixed dev server port for this storyboard instance. When set, `storyboard dev` always tries this exact port and exits if it's taken (no fallback).
 * @property {string}   [devDomainColor] — CSS color for the BranchBar in local dev (default: blue)
 * @property {{ owner: string, name: string }} [repository]
 * @property {{ enabled: boolean }} [modes]
 * @property {{ discussions: { category: string } }} [comments]
 * @property {Record<string, boolean>} [plugins]
 * @property {{ enabled?: boolean, features?: Record<string, boolean>, partials?: Array }} [workshop]
 * @property {Record<string, boolean>} [featureFlags] — feature toggles; `browserSessionHandoff` enables wrapper-only browser authentication; `usePaseoApp` prefers the App daemon at startup (restart required)
 * @property {{ hide?: string[] }} [ui]
 * @property {object}   [toolbar]
 * @property {CanvasConfig} [canvas]
 * @property {HotPoolConfig} [hotPool]
 * @property {CommandPaletteConfig} [commandPalette]
 * @property {CustomerModeConfig} [customerMode]
 * @property {RoutesConfig} [routes] — legacy route map. The Notebook entry resolver owns `/`.
 * @property {PagesConfig} [pages] — per-surface presentation props (title, subtitle, logo, tab toggles) for the `home` and `workspace` surfaces. Customers configure surfaces here instead of editing library JSX.
 * @property {ThemesConfig} [theming]
 * @property {Record<string, object>} [widgets] — Custom widget metadata (server-side). Maps widget type string → definition (label, icon, chrome, interaction, connectors, features, props). Consumer entries override built-in widget metadata for collision detection, default sizes, prompt-exec config, etc. Browser-side widget components are registered separately via `mountStoryboardCore({ widgets })`. See `DOCS/custom-widgets.md`.
 */

/** Built-in paste rules shipped with storyboard. */
export const builtinPasteRules = [
  {
    id: 'figma',
    match: 'https?://(?:www\\.)?figma\\.com/',
    widget: 'figma-embed',
    propsMap: { width: 800, height: 450 },
  },
]

/** Default config values. Every key here is safe to access without null checks. */
export const configDefaults = {
  customDomain: '',
  prodDomain: '',
  port: 0,
  devDomainColor: '',
  repository: { owner: '', name: '' },
  modes: { enabled: false },
  comments: { discussions: { category: 'Comments' } },
  plugins: {},
  workshop: {
    enabled: false,
    // Each `create<X>` flag controls whether the corresponding item appears
    // in the workspace Create-Artifact menu. Default true — set to false in
    // a consumer's storyboard.config.json to hide that item.
    features: {
      createPrototype: true,
      createCanvas: true,
      createComponent: true,
      createFlow: true,
      createPage: true,
      createObject: true,
      createRecord: true,
    },
  },
  featureFlags: {
    // Read once by Core at launch, never from browser-local flag overrides.
    usePaseoApp: true,
    // Opt into the wrapper-only one-time browser handoff and session gate.
    // Disabled by default so additional browsers can open the local Core UI.
    browserSessionHandoff: false,
  },
  ui: {},
  toolbar: {},
  canvas: {
    pasteRules: builtinPasteRules,
    github: {
      embedBehavior: 'link-preview', // "link-preview" | "rich-embed"
      ghGuard: 'copy',               // "copy" | "link" | "off"
    },
    zoom: {
      min: 10,
      max: 250,
      step: 10,
      gestures: true, // when false, disables cmd+wheel and pinch-to-zoom; +/- buttons still work
      origin: 'center', // "center" | "top-left" — anchor point for all zoom (toolbar, keyboard, cmd+wheel, pinch). Hold Alt while cmd+scrolling to opt into cursor-anchor zoom.
    },
    scroll: {
      axis: 'both', // "both" | "vertical" | "horizontal" | "none"
    },
    surface: {
      // Sizing of the underlying canvas surface (`.tc-canvas`). Independent
      // per axis. "auto" preserves the default `max(100vw, 10000px)` floor
      // so users can pan into a large workspace. "viewport" sizes the
      // surface to exactly `100vw` / `100vh`, which is what landing-style
      // canvases want: the unscaled canvas matches the visible window
      // exactly, while zooming above 100% legitimately overflows and
      // surfaces horizontal/vertical scroll.
      width: 'auto', // "auto" | "viewport"
      height: 'auto', // "auto" | "viewport"
    },
    terminal: {
      resizable: false,
      defaultWidth: 800,
      defaultHeight: 450,
    },
    fileEditor: {
      // CodeMirror theme per resolved mode (light vs. dark). Each value can
      // be null/"default"/"none" (no theme), "oneDark" (bundled), or an
      // inline { spec, dark } object passed to EditorView.theme.
      // The active mode is picked from `data-sb-code-theme` on <html>
      // (set by themeStore from the `codeBoxes` surface). Any value
      // starting with "dark" selects `theme.dark`.
      theme: {
        light: null,
        dark: 'oneDark',
      },
    },
    // Opt-in affordances that are normally dev-only. When true the
    // corresponding interaction stays available in production builds
    // (and `?prodMode` simulation). Defaults are all false — production
    // canvases are read-only out of the box.
    production: {
      move: false,
      resize: false,
      editMarkdown: false,
      editSticky: false,
    },
  },
  commandPalette: {
    providers: [],
    ranking: 'frecency',
    sections: [],
  },
  customerMode: {
    enabled: false,
    // Canonical shape — see CustomerModeConfig typedef above.
    homepage: false,
    tools: 'all',
    commandPalette: true,
    branchBar: true,
    // Legacy aliases (kept in defaults so naive readers still see the field
    // shape they expect — initCustomerModeConfig folds these into the
    // canonical state at startup).
    hideChrome: false,
    hideHomepage: false,
    protoHomepage: '',
    canvasHomepage: '',
  },
  // Route table: path → target page. `"/"` selects the index surface.
  // Behavior-preserving default — today `/` renders the `home` surface
  // (SimpleWorkspace). A target is either a string (all envs) or a
  // per-env object `{ dev, prod, default }` resolved by resolveRouteTarget.
  // Example consumer override: { "/": { "dev": "workspace", "prod": "home" } }.
  routes: {
    '/': 'notebook',
  },
  // Per-surface presentation props, keyed by surface name. The library
  // workspace pages spread these so customers never edit the JSX. Defaults
  // reproduce today's exact titles/subtitles and tab visibility.
  pages: {
    home: {
      title: 'Hypercanvas',
      subtitle: 'Collaborative workspace for design & code',
    },
    workspace: {
      title: 'Hypercanvas',
      subtitle: 'Where design work goes',
      logo: null,
      logoIcon: 'iconoir/key-command',
      showAllArtifacts: false,
      showPrototypes: true,
      showCanvases: true,
      showComponents: true,
    },
  },
  theming: {
    // Minimal default theme registry. Consumers add more in their own
    // storyboard.config.json — see README#theming. IDs starting with "dark"
    // are picked up by the Tailwind `dark:` variant via prefix match.
    themes: {
      light: { label: 'Light', attrs: {} },
      dark:  { label: 'Dark',  attrs: {} },
    },
    // Surface registry. Each surface ID is looked up in the DOM as
    // `[data-sb-surface="<id>"]`. The runtime writes
    // `data-sb-<id>-theme="<resolved>"` plus the active theme's companion
    // `attrs` onto every matching element.
    surfaces: {
      prototype: { label: 'Prototype',  sync: true  },
      canvas:    { label: 'Canvas',     sync: true  },
      toolbar:   { label: 'Tools',      sync: true  },
      codeBoxes: { label: 'Code boxes', sync: true  },
    },
    // Default global theme. "system" follows OS prefers-color-scheme.
    default: 'system',
  },
}

/**
 * Deep-merge helper that replaces arrays instead of concatenating.
 * Objects are recursively merged; all other values are overwritten.
 */
function mergeConfig(defaults, overrides) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    return overrides ?? defaults
  }
  const result = { ...defaults }
  for (const key of Object.keys(overrides)) {
    const val = overrides[key]
    if (val === undefined) continue
    if (Array.isArray(val)) {
      // Arrays replace (e.g. pasteRules, providers) — no concat
      result[key] = val
    } else if (val && typeof val === 'object' && !Array.isArray(val) && typeof defaults[key] === 'object' && !Array.isArray(defaults[key])) {
      result[key] = mergeConfig(defaults[key], val)
    } else {
      result[key] = val
    }
  }
  return result
}

/**
 * Return a fully defaulted config by merging user-provided values over defaults.
 * Safe to call with an empty object or undefined — returns full defaults.
 *
 * @param {Partial<StoryboardConfig>} [raw={}]
 * @returns {StoryboardConfig}
 */
export function getConfig(raw = {}) {
  return mergeConfig(configDefaults, raw)
}

/**
 * Return a copy of the bare defaults (no user overrides).
 * @returns {StoryboardConfig}
 */
export function getConfigDefaults() {
  return JSON.parse(JSON.stringify(configDefaults))
}

/**
 * Resolve a configured route path to a target page name for the active env.
 *
 * Resolution order for an object target: exact env key (`dev`/`prod`) →
 * `default` → the other env key → `null`. A string target is returned as-is.
 *
 * @param {RoutesConfig|undefined} routes — the `routes` config map
 * @param {string} path — route path to resolve (e.g. `"/"`)
 * @param {{ dev?: boolean }} [env] — environment flags (default reads `import.meta.env.DEV` at call sites)
 * @returns {string|null} the target page name, or `null` if unconfigured
 */
export function resolveRouteTarget(routes, path, { dev } = {}) {
  const entry = routes?.[path]
  if (!entry) return null
  if (typeof entry === 'string') return entry || null
  if (typeof entry !== 'object') return null
  return (dev ? entry.dev : entry.prod) ?? entry.default ?? entry.prod ?? entry.dev ?? null
}
