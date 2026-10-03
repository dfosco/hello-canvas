/**
 * Knob highlight — in-page outline + label overlay for `[data-knob-id]`
 * elements while the toolbar Knobs panel is open.
 *
 * Schema:
 *   - Each knob def MAY include a `knobMeta` object.
 *   - `knobMeta.color`: hex string like `#ff8800` (3/4/6/8 digit). Optional.
 *     When absent or malformed, the default Primer blue is used.
 *
 * Consumer DX:
 *   - Sprinkle `data-knob-id="<knob.id>"` on any DOM element you want
 *     associated with a knob.
 *   - While the Knobs panel is open, that element gets a colored outline
 *     and a top-left badge showing the knob's label.
 *
 * Two halves:
 *   1. `resolveKnobColor(def)` — pure helper; safe to call from anywhere
 *      (used by both `KnobsForm.jsx` to render the panel dot AND by the
 *      installer to stamp `--sb-knob-color` on highlighted elements).
 *   2. `installKnobsHighlight({ basePath })` — one-shot side-effect that:
 *        - subscribes to the hash so it reacts to the panel open/close
 *        - subscribes to navigation (pushState/replaceState/popstate)
 *        - mounts a MutationObserver so newly-rendered marked elements
 *          inherit the highlight while the panel is open
 *        - stamps `<html data-sb-knobs-active="">` for the CSS to react
 *        - on each repaint, walks `[data-knob-id]` elements, looks up
 *          the matching knob in the current prototype's flattened knob
 *          list, and sets `--sb-knob-color` + `data-knob-label`
 *
 * Installed once from `mountStoryboardCore`. Idempotent.
 */

import { getPrototypeKnobs, normalizeScope } from './discovery.js'
import { isKnobsPanelOpen } from '../ui/knobsPanelState.js'
import { subscribeToHash } from '../session/hashSubscribe.js'
import { detectCurrentPrototypeRoute } from './route.js'

export const DEFAULT_KNOB_COLOR = '#0969da'

const HEX_PATTERN = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/**
 * Pure: return the hex color to use for a knob's outline / panel dot.
 * Falls back to `DEFAULT_KNOB_COLOR` when `knobMeta.color` is missing
 * or not a valid 3/4/6/8-digit hex string.
 */
export function resolveKnobColor(def) {
  const raw = def?.knobMeta?.color
  if (typeof raw !== 'string') return DEFAULT_KNOB_COLOR
  const trimmed = raw.trim()
  return HEX_PATTERN.test(trimmed) ? trimmed : DEFAULT_KNOB_COLOR
}

function humanizeKnobId(id) {
  const last = String(id || '').split('.').pop()
  return last
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, char => char.toUpperCase())
}

function knobLabelFor(def) {
  if (!def) return ''
  return def.label || humanizeKnobId(def.id)
}

/**
 * True when a knob has explicitly opted into the in-page highlight overlay.
 *
 * Authoring intent: most knobs are just controls and shouldn't paint
 * outlines on the page when the panel is open. Only knobs that map to a
 * specific element worth pointing out should opt in via
 * `knobMeta: { highlight: true }`.
 *
 * The skill (see `storyboard-knobs/SKILL.md`) instructs authors to also
 * supply a distinct `knobMeta.color` so multiple highlights on the same
 * page don't collide — but a missing color is not an error; it falls
 * back to the default blue.
 */
export function isKnobHighlightEnabled(def) {
  return def?.knobMeta?.highlight === true
}

let installed = false
let mutationObserver = null
let unsubscribeHash = null
let unsubscribeNav = null
let cachedBasePath = '/'

const HTML_ATTR = 'data-sb-knobs-active'
const URL_PARAM = 'sb_knobs'
const ATTR_HIGHLIGHT = 'data-knob-highlight'
const ATTR_LABEL = 'data-knob-label'
const CSS_VAR_COLOR = '--sb-knob-color'

/**
 * True when the in-page highlight overlay should be active.
 *
 * Two activation paths:
 *   1. The toolbar Knobs panel is open (hash-driven).
 *   2. A `?sb_knobs=1` query param is in the URL (set by canvas
 *      PrototypeEmbed when a Knobs widget is connected, so the embedded
 *      prototype's iframe highlights even though the toolbar panel
 *      lives in the parent canvas frame).
 */
function isHighlightActive() {
  if (isKnobsPanelOpen()) return true
  if (typeof window === 'undefined') return false
  try {
    return new URLSearchParams(window.location.search).get(URL_PARAM) === '1'
  } catch {
    return false
  }
}

function clearMarkedElements(doc = document) {
  // The presence of `data-knob-highlight=""` (set by the installer) is
  // the gate for the CSS overlay — never `data-knob-id`, which authors
  // own permanently. Clearing the gate also clears the label + color.
  doc.querySelectorAll(`[${ATTR_HIGHLIGHT}]`).forEach(el => {
    el.removeAttribute(ATTR_HIGHLIGHT)
    el.removeAttribute(ATTR_LABEL)
    el.style.removeProperty(CSS_VAR_COLOR)
  })
}

function paint() {
  if (typeof document === 'undefined') return
  const html = document.documentElement
  if (!isHighlightActive()) {
    if (html.hasAttribute(HTML_ATTR)) html.removeAttribute(HTML_ATTR)
    clearMarkedElements()
    return
  }

  html.setAttribute(HTML_ATTR, '')

  const { prototypeName, route } = detectCurrentPrototypeRoute(cachedBasePath)
  if (!prototypeName) {
    clearMarkedElements()
    return
  }

  const knobs = getPrototypeKnobs(prototypeName)
  if (!knobs || knobs.length === 0) {
    clearMarkedElements()
    return
  }

  const normalizedRoute = normalizeScope(route)
  // Build id -> knob map, route-scoped knobs win over unscoped on collision.
  const byId = new Map()
  for (const def of knobs) {
    if (!def || typeof def.id !== 'string') continue
    const defScope = normalizeScope(def.scope)
    if (defScope != null && defScope !== normalizedRoute) continue
    if (defScope === normalizedRoute || !byId.has(def.id)) {
      byId.set(def.id, def)
    }
  }

  const seen = new Set()
  // Skip elements that live inside the Knobs panel itself OR a canvas
  // Knobs widget. Both KnobsForm.jsx (the panel) and the form rendered
  // inside KnobsWidget (the canvas widget) carry `data-knob-id={def.id}`
  // on their own Field rows for hooks/tests, but those rows should
  // never get the in-page overlay — that would draw outlines on the
  // form's own controls. Tagged ancestors: [data-knobs-panel] for the
  // toolbar panel, [data-knobs-widget] for the canvas widget.
  document.querySelectorAll('[data-knob-id]').forEach(el => {
    if (el.closest('[data-knobs-panel], [data-knobs-widget]')) return
    const id = el.getAttribute('data-knob-id')
    if (!id) return
    const def = byId.get(id)
    // Knob must exist on the current prototype AND have opted into the
    // in-page overlay via `knobMeta.highlight: true`. Without the
    // explicit opt-in we silently clear any prior stamp (handles the
    // case where an author removes `highlight: true` while the panel
    // is open) and move on. Authors keep `data-knob-id` on their JSX
    // permanently; `data-knob-highlight` is the installer-owned gate
    // the CSS keys off so leftover `data-knob-id` attrs from non-opted-in
    // knobs (or stale tags) never render outlines.
    if (!def || !isKnobHighlightEnabled(def)) {
      el.removeAttribute(ATTR_HIGHLIGHT)
      el.removeAttribute(ATTR_LABEL)
      el.style.removeProperty(CSS_VAR_COLOR)
      return
    }
    seen.add(el)
    el.style.setProperty(CSS_VAR_COLOR, resolveKnobColor(def))
    el.setAttribute(ATTR_HIGHLIGHT, '')
    // Label comes from knob config (`def.label`, falling back to a
    // humanized id) — never from a hand-authored DOM attr.
    el.setAttribute(ATTR_LABEL, knobLabelFor(def))
  })

  // Clear any previously-marked element that is no longer in the
  // current opted-in set (knob renamed, removed, or de-opted).
  document.querySelectorAll(`[${ATTR_HIGHLIGHT}]`).forEach(el => {
    if (seen.has(el)) return
    el.removeAttribute(ATTR_HIGHLIGHT)
    el.removeAttribute(ATTR_LABEL)
    el.style.removeProperty(CSS_VAR_COLOR)
  })
}

let scheduled = false
function schedulePaint() {
  if (scheduled) return
  scheduled = true
  const flush = () => {
    scheduled = false
    paint()
  }
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(flush)
  } else {
    flush()
  }
}

function subscribeToNavigation(callback) {
  if (typeof window === 'undefined') return () => {}

  const originalPush = history.pushState
  const originalReplace = history.replaceState

  function patchedPush(...args) {
    const result = originalPush.apply(this, args)
    callback()
    return result
  }
  function patchedReplace(...args) {
    const result = originalReplace.apply(this, args)
    callback()
    return result
  }

  history.pushState = patchedPush
  history.replaceState = patchedReplace
  window.addEventListener('popstate', callback)

  return () => {
    window.removeEventListener('popstate', callback)
    if (history.pushState === patchedPush) history.pushState = originalPush
    if (history.replaceState === patchedReplace) history.replaceState = originalReplace
  }
}

/**
 * Install the in-page knob highlight overlay. Safe to call multiple
 * times; only installs once. No-op outside a browser environment.
 *
 * @param {{ basePath?: string }} [options]
 */
export function installKnobsHighlight(options = {}) {
  if (installed || typeof document === 'undefined') return
  installed = true
  cachedBasePath = options.basePath || '/'

  // Initial paint (handles the case where the hash already says
  // panel-open at boot).
  schedulePaint()

  unsubscribeHash = subscribeToHash(schedulePaint)
  unsubscribeNav = subscribeToNavigation(schedulePaint)

  // MutationObserver pattern: only repaint when DOM changes outside the
  // knob form surfaces themselves and outside known portal trees
  // (BaseUI dropdown popups, Radix portals, etc.). Without this filter
  // the observer fires dozens of times when a `<Select>` dropdown
  // opens — the cascade of rAF-scheduled `paint()` calls queries the
  // whole DOM and stamps `data-knob-highlight` on the knob widget's
  // own Field rows, which produces React + base-ui timing noise that
  // can close the dropdown back to its trigger.
  //
  // None of the skipped subtrees can ever produce a NEW highlightable
  // element (they're form internals or portaled popups that can't
  // carry consumer-authored `data-knob-id` attrs), so ignoring them
  // is safe.
  function isIgnorableMutationTarget(node) {
    if (!node || typeof node.closest !== 'function') return false
    return Boolean(
      node.closest('[data-knobs-panel], [data-knobs-widget], [data-base-ui-portal], [data-radix-portal]'),
    )
  }

  mutationObserver = new MutationObserver((mutations) => {
    if (!isHighlightActive()) return
    for (const m of mutations) {
      if (!isIgnorableMutationTarget(m.target)) {
        schedulePaint()
        return
      }
    }
  })
  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
  })
}

/**
 * Tear down the highlight overlay (test-only convenience).
 * Production code never calls this — install once at mount and live with it.
 */
export function uninstallKnobsHighlight() {
  if (!installed) return
  installed = false
  if (unsubscribeHash) unsubscribeHash()
  if (unsubscribeNav) unsubscribeNav()
  if (mutationObserver) mutationObserver.disconnect()
  unsubscribeHash = null
  unsubscribeNav = null
  mutationObserver = null
  if (typeof document !== 'undefined') {
    document.documentElement.removeAttribute(HTML_ATTR)
    clearMarkedElements()
  }
}
