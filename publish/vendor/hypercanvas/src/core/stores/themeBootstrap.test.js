/**
 * Tests for the shared theme bootstrap helper.
 *
 * These functions are the contract between the runtime themeStore and the
 * inline-script generator used by the prototype iframe HTML shell. Both
 * paths must agree on:
 *   - how stored / default theme + sync are resolved
 *   - how per-surface attrs land on `[data-sb-surface]` elements
 *   - how legacy `<html>` attrs are written for backward compat
 *   - how the active theme's companion `attrs` flow onto surface elements
 *     AND onto `<html>` (for the prototype surface)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  THEME_STORAGE_KEY,
  SYNC_STORAGE_KEY,
  LEGACY_SURFACE_ATTR,
  readStoredTheme,
  readStoredSync,
  resolveTheme,
  computeBySurface,
  applyThemeToDom,
  renderInlineBootstrapScript,
} from './themeBootstrap.js'

const fixtureConfig = {
  themes: {
    light: { label: 'Light', attrs: { 'data-color-mode': 'light', 'data-light-theme': 'light' } },
    dark:  { label: 'Dark',  attrs: { 'data-color-mode': 'dark',  'data-dark-theme':  'dark'  } },
    dark_dimmed: { label: 'Dimmed', attrs: { 'data-color-mode': 'dark', 'data-dark-theme': 'dark_dimmed' } },
  },
  surfaces: {
    prototype: { label: 'Prototype',  sync: true  },
    canvas:    { label: 'Canvas',     sync: true  },
    toolbar:   { label: 'Tools',      sync: true  },
    codeBoxes: { label: 'Code boxes', sync: true  },
  },
  default: 'system',
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-sb-theme')
  document.documentElement.removeAttribute('data-sb-canvas-theme')
  document.documentElement.removeAttribute('data-sb-toolbar-theme')
  document.documentElement.removeAttribute('data-sb-code-theme')
  document.documentElement.removeAttribute('data-color-mode')
  document.documentElement.removeAttribute('data-light-theme')
  document.documentElement.removeAttribute('data-dark-theme')
  document.body.innerHTML = ''
})

describe('readStoredTheme', () => {
  it('returns the configured default when localStorage is empty', () => {
    expect(readStoredTheme(fixtureConfig)).toBe('system')
  })
  it('returns the stored value when set', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark_dimmed')
    expect(readStoredTheme(fixtureConfig)).toBe('dark_dimmed')
  })
  it('falls back to "system" when config has no default', () => {
    expect(readStoredTheme({})).toBe('system')
  })
})

describe('readStoredSync', () => {
  it('seeds defaults from config surfaces', () => {
    const result = readStoredSync(fixtureConfig)
    expect(result).toEqual({
      prototype: true, canvas: true, toolbar: true, codeBoxes: true,
    })
  })
  it('overrides defaults with persisted booleans', () => {
    localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify({ toolbar: true, canvas: false }))
    const result = readStoredSync(fixtureConfig)
    expect(result).toEqual({
      prototype: true, canvas: false, toolbar: true, codeBoxes: true,
    })
  })
  it('drops persisted keys that are not in the surface registry', () => {
    localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify({ unknownSurface: true, toolbar: true }))
    const result = readStoredSync(fixtureConfig)
    expect(result).not.toHaveProperty('unknownSurface')
    expect(result.toolbar).toBe(true)
  })
  it('migrates the old unchecked Tools default once', () => {
    localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify({ toolbar: false }))
    expect(readStoredSync(fixtureConfig).toolbar).toBe(true)

    localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify({ toolbar: false }))
    expect(readStoredSync(fixtureConfig).toolbar).toBe(false)
  })
})

describe('resolveTheme', () => {
  it('passes non-system theme ids through unchanged', () => {
    expect(resolveTheme('dark_dimmed')).toBe('dark_dimmed')
  })
})

describe('computeBySurface', () => {
  it('resolves synced surfaces to the global and unsynced to "light"', () => {
    const sync = { prototype: true, canvas: true, toolbar: false, codeBoxes: true }
    const result = computeBySurface(fixtureConfig, 'dark_dimmed', sync)
    expect(result).toEqual({
      prototype: 'dark_dimmed',
      canvas:    'dark_dimmed',
      toolbar:   'light',
      codeBoxes: 'dark_dimmed',
    })
  })
})

describe('applyThemeToDom', () => {
  it('writes data-sb-<surface>-theme on each surface element', () => {
    document.body.innerHTML = `
      <div data-sb-surface="prototype" id="p"></div>
      <div data-sb-surface="canvas" id="c"></div>
      <div data-sb-surface="toolbar" id="t"></div>
    `
    applyThemeToDom(fixtureConfig, { prototype: 'dark', canvas: 'dark_dimmed', toolbar: 'light', codeBoxes: 'light' })
    expect(document.getElementById('p').getAttribute('data-sb-prototype-theme')).toBe('dark')
    expect(document.getElementById('c').getAttribute('data-sb-canvas-theme')).toBe('dark_dimmed')
    expect(document.getElementById('t').getAttribute('data-sb-toolbar-theme')).toBe('light')
  })

  it('writes the active theme companion attrs on each surface element', () => {
    document.body.innerHTML = `<div data-sb-surface="canvas" id="c"></div>`
    applyThemeToDom(fixtureConfig, { canvas: 'dark_dimmed' })
    const c = document.getElementById('c')
    expect(c.getAttribute('data-color-mode')).toBe('dark')
    expect(c.getAttribute('data-dark-theme')).toBe('dark_dimmed')
  })

  it('writes legacy <html> attrs for each canonical surface (backward compat)', () => {
    applyThemeToDom(fixtureConfig, { prototype: 'dark', canvas: 'dark', toolbar: 'light', codeBoxes: 'dark' })
    const root = document.documentElement
    expect(root.getAttribute('data-sb-theme')).toBe('dark')            // prototype
    expect(root.getAttribute('data-sb-canvas-theme')).toBe('dark')
    expect(root.getAttribute('data-sb-toolbar-theme')).toBe('light')
    expect(root.getAttribute('data-sb-code-theme')).toBe('dark')        // codeBoxes
  })

  it('writes the prototype theme companion attrs on <html>', () => {
    applyThemeToDom(fixtureConfig, { prototype: 'dark_dimmed' })
    const root = document.documentElement
    expect(root.getAttribute('data-color-mode')).toBe('dark')
    expect(root.getAttribute('data-dark-theme')).toBe('dark_dimmed')
  })

  it('lowercases surface ids when building attribute names', () => {
    const cfg = { themes: { light: { label: 'L', attrs: {} } }, surfaces: { codeBoxes: { sync: true } } }
    document.body.innerHTML = `<div data-sb-surface="codeBoxes" id="cb"></div>`
    applyThemeToDom(cfg, { codeBoxes: 'light' })
    // HTML attribute names are lowercased by the DOM — use the lowercased form.
    expect(document.getElementById('cb').hasAttribute('data-sb-codeboxes-theme')).toBe(true)
  })

  it('is idempotent — repeated calls produce the same DOM state', () => {
    document.body.innerHTML = `<div data-sb-surface="canvas" id="c"></div>`
    applyThemeToDom(fixtureConfig, { canvas: 'dark' })
    const before = document.getElementById('c').outerHTML
    applyThemeToDom(fixtureConfig, { canvas: 'dark' })
    applyThemeToDom(fixtureConfig, { canvas: 'dark' })
    expect(document.getElementById('c').outerHTML).toBe(before)
  })
})

describe('LEGACY_SURFACE_ATTR map', () => {
  it('covers exactly the four canonical surfaces', () => {
    expect(Object.keys(LEGACY_SURFACE_ATTR).sort()).toEqual(
      ['canvas', 'codeBoxes', 'prototype', 'toolbar'].sort()
    )
  })
  it('maps prototype to data-sb-theme (legacy alias)', () => {
    expect(LEGACY_SURFACE_ATTR.prototype).toBe('data-sb-theme')
  })
})

describe('renderInlineBootstrapScript', () => {
  it('emits a pre-paint <style> block followed by a <script> wrapper', () => {
    const out = renderInlineBootstrapScript(fixtureConfig)
    expect(out.startsWith('<style>')).toBe(true)
    expect(out).toContain('</style>')
    expect(out).toContain('<script>')
    expect(out.trim().endsWith('</script>')).toBe(true)
  })
  it('inlines the surface and theme registries', () => {
    const out = renderInlineBootstrapScript(fixtureConfig)
    expect(out).toContain('prototype')
    expect(out).toContain('codeBoxes')
    expect(out).toContain('dark_dimmed')
  })
  it('inlines the legacy attr map', () => {
    const out = renderInlineBootstrapScript(fixtureConfig)
    expect(out).toContain('data-sb-theme')
    expect(out).toContain('data-sb-canvas-theme')
  })
  it('paints a dark html background pre-paint for dark mode', () => {
    const out = renderInlineBootstrapScript(fixtureConfig)
    // Light fallback + dark override via the data-color-mode attribute
    // that the IIFE writes pre-paint.
    expect(out).toContain('html { background-color: #ffffff; }')
    expect(out).toContain('html[data-color-mode="dark"]')
    expect(out).toContain('#0d1117')
  })
  it('the emitted script runs without errors and produces correct attrs', () => {
    document.body.innerHTML = `
      <div data-sb-surface="prototype" id="p"></div>
      <div data-sb-surface="canvas" id="c"></div>
    `
    localStorage.setItem(THEME_STORAGE_KEY, 'dark_dimmed')

    // Extract just the IIFE body from the script tag (skip the <style>
    // block that now precedes it).
    const out = renderInlineBootstrapScript(fixtureConfig)
    const scriptMatch = out.match(/<script>([\s\S]*?)<\/script>/)
    eval(scriptMatch[1])

    expect(document.getElementById('p').getAttribute('data-sb-prototype-theme')).toBe('dark_dimmed')
    expect(document.getElementById('c').getAttribute('data-sb-canvas-theme')).toBe('dark_dimmed')
    // Legacy compat
    expect(document.documentElement.getAttribute('data-sb-theme')).toBe('dark_dimmed')
    // Companion attrs on <html> via prototype surface
    expect(document.documentElement.getAttribute('data-color-mode')).toBe('dark')
    expect(document.documentElement.getAttribute('data-dark-theme')).toBe('dark_dimmed')
  })
})
