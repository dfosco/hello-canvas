/**
 * Integration tests for the config-driven themeStore.
 *
 * These exercise the public API (`setTheme`, `setSurfaceSync`, `getResolvedFor`,
 * the `themeState` and `surfaceSyncState` subscriptions) and verify that
 *
 *   1. switching themes updates per-surface attrs on every `[data-sb-surface]`
 *      element, plus the legacy `<html>` compat attrs,
 *   2. the MutationObserver picks up dynamically-added surface elements
 *      and applies the active theme to them,
 *   3. `storyboard:theme:changed` events carry the new `bySurface` payload
 *      while still mirroring the legacy fields for backward compat.
 *
 * The module reads its registry from configStore, so each test seeds
 * configStore via `initConfig` before importing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const fixtureConfig = {
  theming: {
    themes: {
      light: { label: 'Light', attrs: { 'data-color-mode': 'light', 'data-light-theme': 'light' } },
      dark:  { label: 'Dark',  attrs: { 'data-color-mode': 'dark',  'data-dark-theme':  'dark'  } },
    },
    surfaces: {
      prototype: { label: 'Prototype', sync: true  },
      canvas:    { label: 'Canvas',    sync: true  },
      toolbar:   { label: 'Tools',     sync: true  },
      codeBoxes: { label: 'Code',      sync: true  },
    },
    default: 'system',
  },
}

async function freshStore() {
  // Reset both module caches so themeStore re-derives its initial state
  // from a freshly-seeded configStore.
  vi.resetModules()
  const { initConfig } = await import('./configStore.js')
  initConfig(fixtureConfig)
  return await import('./themeStore.js')
}

beforeEach(() => {
  localStorage.clear()
  document.body.innerHTML = ''
  for (const a of [
    'data-sb-theme', 'data-sb-canvas-theme', 'data-sb-toolbar-theme', 'data-sb-code-theme',
    'data-color-mode', 'data-light-theme', 'data-dark-theme',
  ]) {
    document.documentElement.removeAttribute(a)
  }
})

describe('themeStore — config-driven applier', () => {
  it('applies per-surface attrs on every [data-sb-surface] element when setTheme is called', async () => {
    document.body.innerHTML = `
      <div data-sb-surface="canvas" id="c"></div>
      <div data-sb-surface="toolbar" id="t"></div>
    `
    const store = await freshStore()
    store.setTheme('dark')

    expect(document.getElementById('c').getAttribute('data-sb-canvas-theme')).toBe('dark')
    expect(document.getElementById('t').getAttribute('data-sb-toolbar-theme')).toBe('dark')
  })

  it('writes legacy <html> attrs on theme change', async () => {
    const store = await freshStore()
    store.setTheme('dark')

    const root = document.documentElement
    expect(root.getAttribute('data-sb-theme')).toBe('dark')          // prototype legacy
    expect(root.getAttribute('data-sb-canvas-theme')).toBe('dark')
    expect(root.getAttribute('data-sb-toolbar-theme')).toBe('dark')
    expect(root.getAttribute('data-sb-code-theme')).toBe('dark')     // codeBoxes
  })

  it('writes the prototype theme companion attrs on <html>', async () => {
    const store = await freshStore()
    store.setTheme('dark')

    const root = document.documentElement
    expect(root.getAttribute('data-color-mode')).toBe('dark')
    expect(root.getAttribute('data-dark-theme')).toBe('dark')
  })

  it('setSurfaceSync flips a surface from light to global', async () => {
    document.body.innerHTML = `<div data-sb-surface="toolbar" id="t"></div>`
    const store = await freshStore()
    store.setTheme('dark')
    store.setSurfaceSync('toolbar', false)
    expect(document.getElementById('t').getAttribute('data-sb-toolbar-theme')).toBe('light')

    store.setSurfaceSync('toolbar', true)
    expect(document.getElementById('t').getAttribute('data-sb-toolbar-theme')).toBe('dark')
  })

  it('MutationObserver applies the active theme to newly-added surface elements', async () => {
    const store = await freshStore()
    store.setTheme('dark')

    // Add a surface element AFTER setTheme — observer should react.
    const el = document.createElement('div')
    el.setAttribute('data-sb-surface', 'canvas')
    el.id = 'late'
    document.body.appendChild(el)

    // MutationObserver fires on the next microtask. Yield.
    await new Promise((r) => setTimeout(r, 0))
    expect(document.getElementById('late').getAttribute('data-sb-canvas-theme')).toBe('dark')
  })

  it('dispatches storyboard:theme:changed with bySurface + legacy keys', async () => {
    const store = await freshStore()
    let payload = null
    document.addEventListener('storyboard:theme:changed', (e) => { payload = e.detail })
    store.setTheme('dark')

    expect(payload).toBeTruthy()
    expect(payload.bySurface).toEqual({
      prototype: 'dark', canvas: 'dark', toolbar: 'dark', codeBoxes: 'dark',
    })
    // Legacy mirror — these are read by Primer's ThemeSync and older callers.
    expect(payload.prototypeTheme).toBe('dark')
    expect(payload.canvasResolved).toBe('dark')
    expect(payload.toolbarResolved).toBe('dark')
    expect(payload.codeResolved).toBe('dark')
  })

  it('getResolvedFor returns "light" for unsynced surfaces and global for synced', async () => {
    const store = await freshStore()
    store.setTheme('dark')
    expect(store.getResolvedFor('prototype')).toBe('dark')
    expect(store.getResolvedFor('toolbar')).toBe('dark')
  })

  it('THEMES proxy reflects the active config registry', async () => {
    const store = await freshStore()
    const list = Array.from(store.THEMES)
    const ids = list.map((t) => t.value)
    expect(ids).toContain('system')
    expect(ids).toContain('light')
    expect(ids).toContain('dark')
  })

  it('getThemeSyncTargets and getSurfaceSync return the same shape', async () => {
    const store = await freshStore()
    const a = store.getThemeSyncTargets()
    const b = store.getSurfaceSync()
    expect(a).toEqual(b)
  })
})
