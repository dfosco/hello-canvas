/**
 * embedTheme.js — canvas theme subscription helpers for embed widgets.
 *
 * Color variables previously written here as inline styles now live in
 * `core/styles/tailwind.css` and cascade from `[data-sb-canvas-theme^="dark"]`.
 *
 * `getEmbedChromeVars` is preserved as a stub returning `{}` so existing
 * call sites continue to spread without error — remove during follow-up
 * cleanup.
 */
import { getTheme, getSurfaceSync } from '../../../core/index.js'

function resolveSystem() {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light'
}

export function resolveCanvasTheme() {
  const sync = getSurfaceSync()
  if (!sync.canvas) return 'light'
  const theme = getTheme()
  return theme === 'system' ? resolveSystem() : theme
}

export function subscribeCanvasTheme({ anchorRef, onTheme }) {
  if (typeof onTheme !== 'function') return () => {}

  let observed = null
  let observer = null

  function readAndEmit() {
    const el = anchorRef?.current?.closest?.('[data-sb-canvas-theme]') || null
    if (el !== observed) {
      if (observer) observer.disconnect()
      observer = null
      observed = el
      if (el && typeof MutationObserver !== 'undefined') {
        observer = new MutationObserver(readAndEmit)
        observer.observe(el, { attributes: true, attributeFilter: ['data-sb-canvas-theme'] })
      }
    }
    onTheme(el?.getAttribute('data-sb-canvas-theme') || 'light')
  }

  readAndEmit()
  document.addEventListener('storyboard:theme:changed', readAndEmit)

  return () => {
    document.removeEventListener('storyboard:theme:changed', readAndEmit)
    if (observer) observer.disconnect()
  }
}

export function getEmbedChromeVars() {
  return {}
}
