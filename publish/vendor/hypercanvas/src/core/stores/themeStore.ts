/**
 * Theme Store — config-driven theming layer.
 *
 * Reads its theme + surface registry from the unified config store
 * (`getConfig("theming")`). For each configured surface this module:
 *
 *  1. Watches the DOM for `[data-sb-surface="<id>"]` elements and writes
 *     `data-sb-<id>-theme="<resolvedThemeId>"` plus every key/value pair
 *     from the active theme's `attrs` companion map on those elements.
 *  2. Writes the legacy `<html>` attribute for the canonical surfaces
 *     (`data-sb-theme`, `data-sb-toolbar-theme`, `data-sb-code-theme`,
 *     `data-sb-canvas-theme`) so existing CSS selectors keep working
 *     without migration.
 *
 * State:
 *   - `sb-color-scheme`  — the active global theme id (or "system")
 *   - `sb-theme-sync`    — `Record<surfaceId, boolean>` of per-surface sync
 *
 * Both keys are persisted in localStorage. A `storage` event listener picks
 * up cross-frame writes so prototype iframes stay in sync with the parent.
 *
 * Public API stays source-compatible with the pre-refactor module:
 *   - `setTheme`, `getTheme`, `themeState`, `THEMES` (now derived from config)
 *   - `setThemeSyncTarget`, `getThemeSyncTargets`, `themeSyncState`
 *
 * New exports:
 *   - `getSurfaceSync`, `setSurfaceSync` — config-key-aware accessors
 *   - `getResolvedFor(surfaceId)` — convenience for consumers
 */

import { getConfig, subscribeToConfig } from './configStore.js'
import { configDefaults } from './configSchema.js'
import {
  THEME_STORAGE_KEY,
  SYNC_STORAGE_KEY,
  LEGACY_SURFACE_ATTR,
  readStoredTheme,
  readStoredSync,
  resolveTheme,
  computeBySurface,
  applyThemeToDom,
  markSyncDefaultsCurrent,
} from './themeBootstrap.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ThemeOption = { name: string; value: string }
export type ThemeValue = string
export interface ThemeState { theme: ThemeValue; resolved: string }

type Subscriber<T> = (value: T) => void
type Unsubscriber = () => void

interface Readable<T> { subscribe(run: Subscriber<T>): Unsubscriber }
interface Writable<T> extends Readable<T> { set(value: T): void }

function writable<T>(initial: T): Writable<T> {
  let value = initial
  const subs = new Set<Subscriber<T>>()
  return {
    set(v: T) { value = v; subs.forEach((fn) => fn(value)) },
    subscribe(run: Subscriber<T>): Unsubscriber {
      subs.add(run); run(value)
      return () => { subs.delete(run) }
    },
  }
}

// ---------------------------------------------------------------------------
// Config snapshot
// ---------------------------------------------------------------------------

function themesConfig(): any {
  // configStore may not be seeded yet (themeStore is imported at the top
  // of the core barrel, before mountStoryboardCore runs). Fall back to the
  // schema defaults so consumers always see the canonical 4-surface set
  // even if storyboard.config.json omits the `theming` block entirely.
  const fromStore = getConfig('theming')
  if (fromStore && (fromStore.surfaces || fromStore.themes)) return fromStore
  return (configDefaults as any).theming || {}
}

// ---------------------------------------------------------------------------
// Persistent state
// ---------------------------------------------------------------------------

let _current: ThemeValue = readStoredTheme(themesConfig())
let _syncTargets: Record<string, boolean> = readStoredSync(themesConfig())

function snapshot(theme: ThemeValue): ThemeState {
  return { theme, resolved: resolveTheme(theme) }
}

const _store = writable<ThemeState>(snapshot(_current))
const _syncStore = writable<Record<string, boolean>>(_syncTargets)

// ---------------------------------------------------------------------------
// DOM write + change broadcast
// ---------------------------------------------------------------------------

function _applyToDOM(theme: ThemeValue, resolved: string): void {
  const cfg = themesConfig()
  const bySurface = computeBySurface(cfg, resolved, _syncTargets)
  applyThemeToDom(cfg, bySurface)
}

function _dispatchEvent(theme: ThemeValue, resolved: string): void {
  if (typeof document === 'undefined') return
  const cfg = themesConfig()
  const bySurface = computeBySurface(cfg, resolved, _syncTargets)

  // bySurface carries the new shape. Legacy keys (prototypeTheme,
  // prototypeResolved, toolbarResolved, codeResolved, canvasResolved) are
  // included so existing listeners — Primer's ThemeSync, embed bridges —
  // continue to work without a coordinated upgrade.
  document.dispatchEvent(new CustomEvent('storyboard:theme:changed', {
    detail: {
      theme,
      resolved,
      bySurface,
      // Legacy mirror — keep until consumers migrate.
      prototypeTheme: bySurface.prototype,
      prototypeResolved: bySurface.prototype,
      toolbarResolved: bySurface.toolbar,
      codeResolved: bySurface.codeBoxes,
      canvasResolved: bySurface.canvas,
    },
  }))
}

// ---------------------------------------------------------------------------
// MutationObserver — pick up surface elements mounted/changed post-load
// ---------------------------------------------------------------------------

let _observerInstalled = false

function _installSurfaceObserver(): void {
  if (_observerInstalled) return
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
  if (!document.body) {
    // Body not ready yet — try again once it is.
    document.addEventListener('DOMContentLoaded', _installSurfaceObserver, { once: true })
    return
  }
  _observerInstalled = true

  const reapply = () => _applyToDOM(_current, resolveTheme(_current))
  const observer = new MutationObserver((mutations) => {
    let needsReapply = false
    for (const m of mutations) {
      if (m.type === 'attributes' && m.attributeName === 'data-sb-surface') {
        needsReapply = true; break
      }
      if (m.type === 'childList') {
        // Only re-apply when an added node could carry/contain a surface marker.
        for (const node of m.addedNodes) {
          if (!(node instanceof Element)) continue
          if (node.hasAttribute('data-sb-surface') ||
              node.querySelector?.('[data-sb-surface]')) {
            needsReapply = true; break
          }
        }
        if (needsReapply) break
      }
    }
    if (needsReapply) reapply()
  })
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-sb-surface'],
  })
}

// ---------------------------------------------------------------------------
// Config change subscription — re-derive state and re-apply when the
// themes registry changes (e.g. HMR of storyboard.config.json).
// ---------------------------------------------------------------------------

subscribeToConfig(() => {
  const cfg = themesConfig()
  // Re-read sync defaults for any newly-added surfaces (they get the
  // config default if not present in storage).
  _syncTargets = readStoredSync(cfg)
  _syncStore.set(_syncTargets)
  const state = snapshot(_current)
  _store.set(state)
  _applyToDOM(_current, state.resolved)
  _dispatchEvent(_current, state.resolved)
})

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getTheme(): ThemeValue { return _current }

export function setTheme(value: ThemeValue): void {
  _current = value
  if (typeof localStorage !== 'undefined') {
    if (value === 'system') localStorage.removeItem(THEME_STORAGE_KEY)
    else localStorage.setItem(THEME_STORAGE_KEY, value)
  }
  const state = snapshot(value)
  _store.set(state)
  _applyToDOM(value, state.resolved)
  _dispatchEvent(value, state.resolved)
}

export const themeState: Readable<ThemeState> = { subscribe: _store.subscribe }

/**
 * Get a copy of the current per-surface sync map.
 */
export function getSurfaceSync(): Record<string, boolean> { return { ..._syncTargets } }

/**
 * Set the sync flag for a single surface. Persisted to localStorage.
 */
export function setSurfaceSync(surfaceId: string, value: boolean): void {
  _syncTargets = { ..._syncTargets, [surfaceId]: value }
  _syncStore.set(_syncTargets)
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(_syncTargets))
    markSyncDefaultsCurrent()
  }
  const state = snapshot(_current)
  _applyToDOM(_current, state.resolved)
  _dispatchEvent(_current, state.resolved)
}

export const surfaceSyncState: Readable<Record<string, boolean>> = { subscribe: _syncStore.subscribe }

/**
 * Convenience accessor — what theme is the given surface currently
 * resolving to?
 */
export function getResolvedFor(surfaceId: string): string {
  const resolved = resolveTheme(_current)
  return _syncTargets[surfaceId] ? resolved : 'light'
}

// ---------------------------------------------------------------------------
// Backward-compat exports
// ---------------------------------------------------------------------------

/**
 * Derived from the active config. Kept so existing switchers
 * (ThemeMenuButton, CoreUIBar, paletteTheme) keep working until they migrate
 * to the config-driven shape. Always reflects the current registry.
 */
export const THEMES: ThemeOption[] = new Proxy([] as ThemeOption[], {
  get(_target, prop) {
    const themes = themesConfig().themes || {}
    const list: ThemeOption[] = Object.entries(themes).map(([value, def]: [string, any]) => ({
      value,
      name: def?.label || value,
    }))
    // "system" is a synthetic theme — surface it at the top if not present
    // and the default is system. (Matches the legacy fixed ordering.)
    if (!list.some(t => t.value === 'system')) {
      list.unshift({ name: 'System', value: 'system' })
    }
    const value = (list as any)[prop]
    return typeof value === 'function' ? value.bind(list) : value
  },
})

/** Deprecated alias for getSurfaceSync — typed shape kept for old call sites. */
export interface ThemeSyncTargets {
  prototype: boolean
  toolbar: boolean
  codeBoxes: boolean
  canvas: boolean
  [key: string]: boolean
}
export function getThemeSyncTargets(): ThemeSyncTargets {
  return getSurfaceSync() as ThemeSyncTargets
}
export function setThemeSyncTarget(target: keyof ThemeSyncTargets, value: boolean): void {
  setSurfaceSync(String(target), value)
}
export const themeSyncState: Readable<ThemeSyncTargets> = {
  subscribe(run) { return _syncStore.subscribe((v) => run(v as ThemeSyncTargets)) },
}

// ---------------------------------------------------------------------------
// OS preference + cross-frame storage listeners
// ---------------------------------------------------------------------------

if (typeof window !== 'undefined') {
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => {
      if (_current !== 'system') return
      const state = snapshot('system')
      _store.set(state)
      _applyToDOM('system', state.resolved)
      _dispatchEvent('system', state.resolved)
    })

  // Cross-frame sync via the storage event: prototype iframes share the
  // same origin as the parent, so a localStorage write from the toolbar
  // theme switcher needs to repaint the iframe too.
  window.addEventListener('storage', (e) => {
    if (e.storageArea !== localStorage) return
    if (e.key === THEME_STORAGE_KEY || e.key === null) {
      const next = readStoredTheme(themesConfig())
      _current = next
      const state = snapshot(next)
      _store.set(state)
      _applyToDOM(next, state.resolved)
      _dispatchEvent(next, state.resolved)
    } else if (e.key === SYNC_STORAGE_KEY) {
      _syncTargets = readStoredSync(themesConfig())
      _syncStore.set(_syncTargets)
      const state = snapshot(_current)
      _applyToDOM(_current, state.resolved)
      _dispatchEvent(_current, state.resolved)
    }
  })
}

// ---------------------------------------------------------------------------
// Boot — install observer and paint immediately
// ---------------------------------------------------------------------------

_installSurfaceObserver()
_applyToDOM(_current, resolveTheme(_current))
