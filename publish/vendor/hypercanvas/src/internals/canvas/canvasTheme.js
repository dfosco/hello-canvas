/**
 * canvasTheme.js — DEPRECATED COMPATIBILITY SHIM.
 *
 * Color variables previously written here as inline styles now live in
 * `core/styles/tailwind.css` and cascade automatically from
 * `[data-sb-canvas-theme^="dark"]` (set by CanvasPage on the canvas root).
 *
 * `getCanvasPrimerAttrs` is preserved as a no-op to keep external consumers
 * (Primer React inside prototypes) functional via `data-color-mode` — but
 * storyboard core no longer depends on this attribute internally.
 *
 * Both exports return empty objects so existing call sites continue to
 * destructure/spread without errors. Remove the call sites in a follow-up
 * sweep, then delete this file.
 */

export function getCanvasPrimerAttrs(theme) {
  const value = String(theme || 'light')
  const isDark = value.startsWith('dark')
  return {
    'data-color-mode': isDark ? 'dark' : 'light',
    'data-light-theme': isDark ? 'light' : (value.startsWith('light') ? value : 'light'),
    'data-dark-theme': isDark ? value : 'dark',
  }
}

export function getCanvasThemeVars() {
  return {}
}
