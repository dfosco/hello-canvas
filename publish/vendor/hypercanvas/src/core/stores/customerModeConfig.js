/**
 * Customer Mode Config — runtime store for the `customerMode` block of
 * `storyboard.config.json`.
 *
 * Framework-agnostic (zero npm dependencies).
 *
 * Canonical (current) shape:
 *
 *   {
 *     enabled: boolean,
 *     // Homepage control.
 *     //   false   → keep default workspace homepage
 *     //   true    → hide workspace; render empty page
 *     //   string  → redirect /, /workspace, /viewfinder to:
 *     //               "/canvas/x"   → passthrough
 *     //               "/MyProto"    → passthrough (prototype path / custom route)
 *     //               "landing"     → /canvas/landing (canvas id shorthand)
 *     //               "https://..." → external URL (replace location)
 *     homepage: false | true | string,
 *
 *     // Tools control (replaces blanket hideChrome for toolbar buttons).
 *     //   "all"            → show every tool (default)
 *     //   "none"           → hide every tool & toolbar wrapper
 *     //   { hide: [keys] } → hide listed tool keys; show rest
 *     //   { only: [keys] } → show only listed tool keys; hide rest
 *     tools: "all" | "none" | { hide?: string[] } | { only?: string[] },
 *
 *     // Independent toggles.
 *     commandPalette: boolean, // false → hide & disable Cmd+K
 *     branchBar:      boolean, // false → hide the dev/branch bar
 *   }
 *
 * Legacy shape (still accepted for back-compat — auto-mapped at init):
 *
 *   { hideChrome, hideHomepage, protoHomepage, canvasHomepage }
 *
 * Legacy fields are preserved as read-only properties on the returned config
 * (mirroring the new shape) so existing consumers continue to work without
 * change for one cycle. New code should consume the helpers below.
 */

const CANONICAL_DEFAULTS = Object.freeze({
  enabled: false,
  homepage: false,
  tools: 'all',
  commandPalette: true,
  branchBar: true,
})

let _config = makeConfig({})

/**
 * Normalize a raw `customerMode` block to the canonical shape, mapping any
 * legacy fields when their canonical counterpart is not explicitly set.
 *
 * Precedence rules (only applied when the canonical key is absent):
 *   - `hideHomepage: true`     → `homepage: true`
 *   - `protoHomepage: "/X"`    → `homepage: "/X"`
 *   - `canvasHomepage: "X"`    → `homepage: "X"`     (wins over protoHomepage)
 *   - `hideChrome: true`       → `tools: "none"`, `commandPalette: false`, `branchBar: false`
 *
 * @param {object} raw
 * @returns {object} canonical config (with legacy aliases preserved)
 */
function makeConfig(raw) {
  const input = raw && typeof raw === 'object' ? raw : {}
  const out = { ...CANONICAL_DEFAULTS }

  if (typeof input.enabled === 'boolean') out.enabled = input.enabled

  // Homepage — explicit canonical wins; otherwise derive from legacy keys.
  if (Object.prototype.hasOwnProperty.call(input, 'homepage')) {
    out.homepage = normalizeHomepage(input.homepage)
  } else if (input.canvasHomepage) {
    out.homepage = String(input.canvasHomepage)
  } else if (input.protoHomepage) {
    out.homepage = String(input.protoHomepage)
  } else if (input.hideHomepage === true) {
    out.homepage = true
  }

  // Tools — explicit canonical wins; otherwise derive from hideChrome.
  if (Object.prototype.hasOwnProperty.call(input, 'tools')) {
    out.tools = normalizeTools(input.tools)
  } else if (input.hideChrome === true) {
    out.tools = 'none'
  }

  // Command palette — explicit canonical wins; otherwise derive from hideChrome.
  if (typeof input.commandPalette === 'boolean') {
    out.commandPalette = input.commandPalette
  } else if (input.hideChrome === true) {
    out.commandPalette = false
  }

  // Branch bar — explicit canonical wins; otherwise derive from hideChrome.
  if (typeof input.branchBar === 'boolean') {
    out.branchBar = input.branchBar
  } else if (input.hideChrome === true) {
    out.branchBar = false
  }

  // Preserve legacy read-only aliases that mirror the canonical state, so
  // any code reading them directly keeps working through one deprecation
  // cycle. These reflect the *effective* state after mapping, not the raw
  // input.
  out.hideChrome = out.tools === 'none' && !out.commandPalette && !out.branchBar
  out.hideHomepage = out.homepage === true
  out.protoHomepage = typeof out.homepage === 'string' && !isCanvasShorthand(out.homepage)
    ? out.homepage
    : ''
  out.canvasHomepage = typeof out.homepage === 'string' && isCanvasShorthand(out.homepage)
    ? out.homepage
    : ''

  warnOnConflicts(input)
  return out
}

function normalizeHomepage(value) {
  if (value === true || value === false) return value
  if (typeof value === 'string') return value.trim()
  return false
}

function normalizeTools(value) {
  if (value === 'all' || value === 'none') return value
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const only = Array.isArray(value.only) ? value.only.filter(k => typeof k === 'string') : null
    const hide = Array.isArray(value.hide) ? value.hide.filter(k => typeof k === 'string') : null
    if (only && only.length > 0) return { only }
    if (hide && hide.length > 0) return { hide }
    return 'all'
  }
  return 'all'
}

/**
 * A homepage string is treated as a "canvas id shorthand" when it has no
 * leading slash AND no scheme. Anything starting with `/`, `http://`, or
 * `https://` is treated as a path / external URL passthrough.
 */
function isCanvasShorthand(value) {
  if (typeof value !== 'string') return false
  if (value.startsWith('/')) return false
  if (/^https?:\/\//i.test(value)) return false
  return true
}

function warnOnConflicts(input) {
  if (input.protoHomepage && input.canvasHomepage) {
    console.warn(
      '[storyboard] customerMode has both `protoHomepage` and `canvasHomepage` set. ' +
      '`canvasHomepage` takes precedence; ignoring `protoHomepage`. ' +
      'These keys are deprecated — use `homepage` instead.'
    )
  }
  if (
    Object.prototype.hasOwnProperty.call(input, 'homepage') &&
    (input.canvasHomepage || input.protoHomepage || input.hideHomepage === true)
  ) {
    console.warn(
      '[storyboard] customerMode has both `homepage` and legacy homepage keys set. ' +
      '`homepage` wins; legacy keys are ignored.'
    )
  }
  if (
    Object.prototype.hasOwnProperty.call(input, 'tools') &&
    input.hideChrome === true
  ) {
    console.warn(
      '[storyboard] customerMode has both `tools` and legacy `hideChrome` set. ' +
      '`tools` wins; `hideChrome` is ignored.'
    )
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize customer mode config from `storyboard.config.json`'s
 * `customerMode` block. Accepts both the canonical and legacy shapes.
 *
 * @param {object} config
 */
export function initCustomerModeConfig(config) {
  _config = makeConfig(config)
}

/**
 * Get the current customer mode config in canonical shape.
 * Legacy aliases are also present on the returned object.
 */
export function getCustomerModeConfig() {
  return _config
}

/** Master toggle. */
export function isCustomerMode() {
  return _config.enabled === true
}

/**
 * The canonical homepage value (`false | true | string`).
 * Does NOT resolve a string to a route; use `resolveHomepageTarget` for that.
 */
export function getCustomerModeHomepage() {
  return _config.homepage
}

/**
 * True when customer mode is enabled AND the homepage should be empty or
 * redirected away (i.e. `homepage` is anything other than `false`).
 * Workspace/SimpleWorkspace use this to short-circuit to an empty render.
 */
export function isCustomerHidingHomepage() {
  if (!_config.enabled) return false
  return _config.homepage !== false
}

/** True when every tool is hidden via `tools: "none"`. */
export function isCustomerHidingAllTools() {
  if (!_config.enabled) return false
  return _config.tools === 'none'
}

/**
 * Check whether a specific toolbar tool key is hidden by customer mode.
 *
 * Logic:
 *   1. `commandPalette: false` hides the `command-palette` tool (the Cmd+K
 *      trigger button) — this complements the keyboard-shortcut gating that
 *      happens via the `storyboard-customer-hide-command-palette` class.
 *   2. `tools === "none"` → all tools hidden.
 *   3. `tools === { hide: [keys] }` → hide listed.
 *   4. `tools === { only: [keys] }` → hide everything except listed.
 *
 * Returns false when customer mode is off.
 *
 * @param {string} key
 * @returns {boolean}
 */
export function isCustomerToolHidden(key) {
  if (!_config.enabled) return false
  if (key === 'command-palette' && _config.commandPalette === false) return true
  const t = _config.tools
  if (t === 'all') return false
  if (t === 'none') return true
  if (t && typeof t === 'object') {
    if (Array.isArray(t.only)) return !t.only.includes(key)
    if (Array.isArray(t.hide)) return t.hide.includes(key)
  }
  return false
}

/** True when the command palette is hidden + Cmd+K is disabled. */
export function isCustomerHidingCommandPalette() {
  if (!_config.enabled) return false
  return _config.commandPalette === false
}

/** True when the branch bar is hidden. */
export function isCustomerHidingBranchBar() {
  if (!_config.enabled) return false
  return _config.branchBar === false
}

/**
 * Resolve a homepage string value to an internal route path.
 *
 * Accepted shapes:
 *   - "landing"          → "/canvas/landing"
 *   - "research/intake"  → "/canvas/research/intake"
 *   - "/canvas/landing"  → "/canvas/landing"   (passthrough)
 *   - "/landing"         → "/landing"          (passthrough — custom canvas _route)
 *   - "/MyProto"         → "/MyProto"          (passthrough — prototype path)
 *   - "https://..."      → "https://..."       (passthrough — external URL)
 *
 * Returns empty string for non-string, true, false, or empty input. Callers
 * differentiate external URLs by testing `/^https?:\/\//`.
 *
 * @param {*} homepage
 * @returns {string}
 */
export function resolveHomepageTarget(homepage) {
  if (typeof homepage !== 'string' || !homepage) return ''
  if (/^https?:\/\//i.test(homepage)) return homepage
  if (homepage.startsWith('/')) return homepage
  return `/canvas/${homepage}`
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** @internal — reset to canonical defaults. Test-only. */
export function _resetCustomerModeConfig() {
  _config = makeConfig({})
}
