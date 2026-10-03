/**
 * Theme bootstrap — shared early-paint helper.
 *
 * The runtime path (`applyEarlyTheme`) runs at the top of mountStoryboardCore
 * before React mounts so the first paint already has the correct theme.
 * The inline-script generator path (`renderInlineBootstrapScript`) emits a
 * minimal `<script>` block embedded in the iframe HTML for the prototype
 * embed shell — that script runs before the JS bundle loads, also avoiding
 * a flash of wrong-theme content.
 *
 * Both paths consume the same registry shape:
 *
 *   {
 *     themes:   Record<id, { label, attrs }>,
 *     surfaces: Record<id, { label, sync }>,
 *     default:  string,  // theme id (may be "system")
 *   }
 *
 * Storage keys (kept stable from the legacy themeStore):
 *   - `sb-color-scheme`     — the active global theme id (or "system")
 *   - `sb-theme-sync`       — JSON Record<surfaceId, boolean>
 *
 * Legacy compat attrs on <html> (mapped from canonical surface ids):
 *   data-sb-theme           ← prototype
 *   data-sb-toolbar-theme   ← toolbar
 *   data-sb-code-theme      ← codeBoxes
 *   data-sb-canvas-theme    ← canvas
 *
 * These are kept so that the ~30 CSS files that select on them continue to
 * work without modification.
 */

export const THEME_STORAGE_KEY = 'sb-color-scheme'
export const SYNC_STORAGE_KEY = 'sb-theme-sync'
const SYNC_DEFAULTS_VERSION_KEY = 'sb-theme-sync-defaults-version'
const SYNC_DEFAULTS_VERSION = '1'

export function markSyncDefaultsCurrent() {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(SYNC_DEFAULTS_VERSION_KEY, SYNC_DEFAULTS_VERSION) } catch { /* best effort */ }
}

/** Map surface id → legacy <html> attribute kept for backward compatibility. */
export const LEGACY_SURFACE_ATTR = {
  prototype: 'data-sb-theme',
  toolbar:   'data-sb-toolbar-theme',
  codeBoxes: 'data-sb-code-theme',
  canvas:    'data-sb-canvas-theme',
}

/**
 * Read the stored global theme id from localStorage, falling back to the
 * registry's configured `default` (or "system" if not set).
 *
 * @param {object} themesCfg
 * @returns {string}
 */
export function readStoredTheme(themesCfg) {
  if (typeof localStorage === 'undefined') return themesCfg?.default || 'system'
  const stored = localStorage.getItem(THEME_STORAGE_KEY)
  if (stored) return stored
  return themesCfg?.default || 'system'
}

/**
 * Read the persisted per-surface sync state, falling back to each surface's
 * configured `sync` default. Unknown surfaces (present in storage but not in
 * config) are silently dropped.
 *
 * @param {object} themesCfg
 * @returns {Record<string, boolean>}
 */
export function readStoredSync(themesCfg) {
  const surfaces = themesCfg?.surfaces || {}
  const defaults = {}
  for (const [id, def] of Object.entries(surfaces)) defaults[id] = !!def.sync
  if (typeof localStorage === 'undefined') return defaults
  try {
    const raw = localStorage.getItem(SYNC_STORAGE_KEY)
    if (!raw) return defaults
    const parsed = JSON.parse(raw)
    const out = { ...defaults }
    for (const id of Object.keys(surfaces)) {
      if (typeof parsed[id] === 'boolean') out[id] = parsed[id]
    }

    // Older releases shipped Tools with a false default. Migrate that stale
    // default once, without preventing a later explicit user toggle.
    const needsMigration = localStorage.getItem(SYNC_DEFAULTS_VERSION_KEY) !== SYNC_DEFAULTS_VERSION
    if (needsMigration && surfaces.toolbar?.sync === true && parsed.toolbar === false) {
      out.toolbar = true
      localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(out))
    }
    if (needsMigration) localStorage.setItem(SYNC_DEFAULTS_VERSION_KEY, SYNC_DEFAULTS_VERSION)
    return out
  } catch {
    return defaults
  }
}

/**
 * Resolve "system" to "light" or "dark" via prefers-color-scheme. Other
 * theme ids pass through unchanged.
 */
export function resolveTheme(themeId) {
  if (themeId !== 'system') return themeId
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * Compute the resolved theme id for every configured surface, given the
 * resolved global theme and the per-surface sync map. Unsynced surfaces
 * resolve to "light".
 *
 * @returns {Record<string, string>}
 */
export function computeBySurface(themesCfg, globalResolved, syncMap) {
  const out = {}
  const surfaces = themesCfg?.surfaces || {}
  for (const id of Object.keys(surfaces)) {
    out[id] = syncMap[id] ? globalResolved : 'light'
  }
  return out
}

/**
 * Apply the resolved theme set to the DOM.
 *
 * Per-surface attrs land on every `[data-sb-surface="<id>"]` element:
 *   - data-sb-<id>-theme  = "<resolved>"
 *   - every key/value pair from themesCfg.themes[resolved].attrs
 *
 * Legacy compat attrs land on <html> exactly as before.
 *
 * Safe to call repeatedly — writes are idempotent.
 */
export function applyThemeToDom(themesCfg, bySurface) {
  if (typeof document === 'undefined') return
  const themes = themesCfg?.themes || {}
  const root = document.documentElement

  for (const [surfaceId, resolved] of Object.entries(bySurface)) {
    const perSurfaceAttr = `data-sb-${surfaceId.toLowerCase()}-theme`
    const themeDef = themes[resolved] || {}
    const companion = themeDef.attrs || {}

    // 1. Per-surface attrs on every declared surface element.
    const elements = document.querySelectorAll(`[data-sb-surface="${surfaceId}"]`)
    elements.forEach((el) => {
      if (el.getAttribute(perSurfaceAttr) !== resolved) {
        el.setAttribute(perSurfaceAttr, resolved)
      }
      for (const [k, v] of Object.entries(companion)) {
        if (el.getAttribute(k) !== v) el.setAttribute(k, v)
      }
    })

    // 2. Legacy compat attr on <html> (only for the four canonical surfaces).
    const legacyAttr = LEGACY_SURFACE_ATTR[surfaceId]
    if (legacyAttr && root.getAttribute(legacyAttr) !== resolved) {
      root.setAttribute(legacyAttr, resolved)
    }
  }

  // 3. For the prototype surface, also write companion attrs on <html>.
  //    Legacy code (Primer's ThemeProvider auto-detection, the old
  //    themeStore branches) expects data-color-mode / data-light-theme /
  //    data-dark-theme on <html> directly. Sourcing them from the active
  //    prototype theme's `attrs` preserves that behaviour without
  //    hardcoding Primer-specific names into core.
  const prototypeResolved = bySurface.prototype
  if (prototypeResolved && themes[prototypeResolved]) {
    const companion = themes[prototypeResolved].attrs || {}
    for (const [k, v] of Object.entries(companion)) {
      if (root.getAttribute(k) !== v) root.setAttribute(k, v)
    }
  }
}

/**
 * Apply the saved theme immediately — runtime path called from
 * mountStoryboardCore before React mounts.
 *
 * Honours the `_sb_theme_target` URL param: when set to "prototype" or
 * "toolbar" the runtime forces that surface to follow the global theme
 * regardless of the persisted sync map. Used by the canvas iframes that
 * embed prototypes in a forced-dark canvas.
 */
export function applyEarlyTheme(themesCfg) {
  if (typeof document === 'undefined') return
  if (!themesCfg) return

  const themeId = readStoredTheme(themesCfg)
  const resolved = resolveTheme(themeId)
  const syncMap = readStoredSync(themesCfg)

  // URL-driven forcing — keeps the canvas-embed override working post-refactor.
  if (typeof window !== 'undefined') {
    const forcedTarget = new URLSearchParams(window.location.search).get('_sb_theme_target')
    if (forcedTarget && Object.prototype.hasOwnProperty.call(syncMap, forcedTarget)) {
      syncMap[forcedTarget] = true
    }
  }

  const bySurface = computeBySurface(themesCfg, resolved, syncMap)
  applyThemeToDom(themesCfg, bySurface)
}

/**
 * Serialize a minimal `<script>` body that runs the same bootstrap logic
 * in a fresh document context — used for the prototype iframe HTML shell
 * which loads BEFORE the JS bundle and needs to paint with the correct
 * theme on first frame.
 *
 * Emits a `<style>` block that paints the html background based on
 * `data-color-mode` (dark or light) so the iframe never flashes
 * Chromium's default white during reload before the prototype's CSS
 * loads — followed by an IIFE that:
 *   1. Reads `sb-color-scheme` and `sb-theme-sync` from localStorage,
 *      falling back to the inlined registry defaults
 *   2. Resolves "system" via prefers-color-scheme
 *   3. Honours `_sb_theme_target` URL param
 *   4. Writes data-sb-<id>-theme on every `[data-sb-surface]` element
 *   5. Writes the legacy data-sb-theme / data-sb-toolbar-theme /
 *      data-sb-code-theme / data-sb-canvas-theme on <html>
 *   6. Writes the prototype theme's companion attrs on <html>
 *      (including `data-color-mode` which the style block reads)
 *
 * @param {object} themesCfg
 * @returns {string} `<script>...</script>` markup
 */
export function renderInlineBootstrapScript(themesCfg) {
  const inlined = JSON.stringify({
    themes: themesCfg?.themes || {},
    surfaces: themesCfg?.surfaces || {},
    default: themesCfg?.default || 'system',
  })
  const legacy = JSON.stringify(LEGACY_SURFACE_ATTR)
  const themeKey = JSON.stringify(THEME_STORAGE_KEY)
  const syncKey = JSON.stringify(SYNC_STORAGE_KEY)
  const syncDefaultsVersionKey = JSON.stringify(SYNC_DEFAULTS_VERSION_KEY)
  const syncDefaultsVersion = JSON.stringify(SYNC_DEFAULTS_VERSION)
  // The IIFE deliberately uses var/function/== to stay safely parseable
  // in any embed environment without relying on modern syntax helpers.
  //
  // The companion `<style>` block paints the html background based on
  // `data-color-mode` (which the IIFE writes pre-paint) so the iframe
  // never flashes Chromium's default white during navigation/reload
  // before the prototype's app CSS is parsed. Uses neutral grays that
  // match the Primer base palette for each mode.
  return [
    '<style>',
    '  html { background-color: #ffffff; }',
    '  html[data-color-mode="dark"] { background-color: #0d1117; }',
    '  @media (prefers-color-scheme: dark) {',
    '    html[data-color-mode="auto"] { background-color: #0d1117; }',
    '  }',
    '</style>',
    '<script>',
    '(function(){',
    `  var CFG = ${inlined};`,
    `  var LEGACY = ${legacy};`,
    '  var doc = document; var root = doc.documentElement;',
    `  var stored = null; try { stored = localStorage.getItem(${themeKey}); } catch(_) {}`,
    '  var themeId = stored || CFG.default || "system";',
    '  var resolved = themeId;',
    '  if (themeId === "system") {',
    '    resolved = (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";',
    '  }',
    '  var syncMap = {};',
    '  var sIds = Object.keys(CFG.surfaces || {});',
    '  for (var i=0; i<sIds.length; i++) { syncMap[sIds[i]] = !!CFG.surfaces[sIds[i]].sync; }',
    `  try { var raw = localStorage.getItem(${syncKey}); if (raw) { var parsed = JSON.parse(raw); for (var k in parsed) if (typeof parsed[k] === "boolean") syncMap[k] = parsed[k]; var needsMigration = localStorage.getItem(${syncDefaultsVersionKey}) !== ${syncDefaultsVersion}; if (needsMigration && CFG.surfaces.toolbar && CFG.surfaces.toolbar.sync === true && parsed.toolbar === false) { syncMap.toolbar = true; localStorage.setItem(${syncKey}, JSON.stringify(syncMap)); } if (needsMigration) localStorage.setItem(${syncDefaultsVersionKey}, ${syncDefaultsVersion}); } } catch(_) {}`,
    '  try {',
    '    var forced = new URLSearchParams(window.location.search).get("_sb_theme_target");',
    '    if (forced && Object.prototype.hasOwnProperty.call(syncMap, forced)) syncMap[forced] = true;',
    '  } catch(_) {}',
    '  function setAttrIfChanged(el, name, val) { if (el.getAttribute(name) !== val) el.setAttribute(name, val); }',
    '  for (var j=0; j<sIds.length; j++) {',
    '    var sid = sIds[j];',
    '    var sidLower = sid.toLowerCase();',
    '    var res = syncMap[sid] ? resolved : "light";',
    '    var themeDef = (CFG.themes && CFG.themes[res]) || {};',
    '    var attrs = themeDef.attrs || {};',
    '    var nodes = doc.querySelectorAll("[data-sb-surface=\\"" + sid + "\\"]");',
    '    for (var n=0; n<nodes.length; n++) {',
    '      setAttrIfChanged(nodes[n], "data-sb-" + sidLower + "-theme", res);',
    '      for (var ak in attrs) setAttrIfChanged(nodes[n], ak, attrs[ak]);',
    '    }',
    '    if (LEGACY[sid]) setAttrIfChanged(root, LEGACY[sid], res);',
    '    if (sid === "prototype") {',
    '      for (var ak2 in attrs) setAttrIfChanged(root, ak2, attrs[ak2]);',
    '    }',
    '  }',
    '})();',
    '</script>',
  ].join('\n')
}
