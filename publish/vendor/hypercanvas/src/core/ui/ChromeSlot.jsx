/**
 * ChromeSlot — render-time wrapper that applies consumer-supplied presentation
 * overrides to a single storyboard chrome element.
 *
 * Every overridable chrome element (toolbar buttons, canvas title, page
 * selector, etc.) is wrapped in `<ChromeSlot id="tool:..." surface="...">`.
 * If a consumer has registered an entry in the presentation store for that
 * `id`, the slot will:
 *
 *   1. Skip rendering entirely if `hidden: true`.
 *   2. Spread `style`, `className`, and `props` onto the wrapped child element.
 *   3. Wrap the result with `decorator(Element, ctx)` if provided.
 *
 * Always tags the rendered DOM with `data-sb-chrome="<id>"` so consumers can
 * also target elements imperatively (GSAP, Framer, plain DOM scripts) without
 * routing through React.
 *
 * If no override is present, the slot is essentially a passthrough that just
 * adds the `data-sb-chrome` attribute.
 *
 * This is an **advanced, undocumented** extension surface — see
 * `core/stores/presentationStore.js`.
 */

import { cloneElement, isValidElement, useSyncExternalStore } from 'react'
import {
  getPresentation,
  subscribeToPresentation,
  getPresentationSnapshot,
} from '../stores/presentationStore.js'

/**
 * @param {object} props
 * @param {string} props.id        Chrome element id (e.g. "tool:command-palette", "canvas:title")
 * @param {string} [props.surface] Surface name passed into decorator ctx
 * @param {object} [props.ctx]     Extra context passed into the decorator (toolKey, canvasId, etc.)
 * @param {React.ReactElement} props.children A single React element to wrap
 */
export default function ChromeSlot({ id, surface, ctx, children }) {
  // Subscribe so overrides applied after mount re-render the slot.
  useSyncExternalStore(subscribeToPresentation, getPresentationSnapshot, getPresentationSnapshot)

  if (!isValidElement(children)) return children ?? null

  const override = getPresentation(id)

  // Always tag the rendered element for imperative consumers, even when no
  // override is registered. data-tool-id is preserved if already set on the
  // child.
  const baseProps = { 'data-sb-chrome': id }

  if (!override) {
    return cloneElement(children, mergeChildProps(children, baseProps))
  }

  if (override.hidden) return null

  const merged = mergeChildProps(children, {
    ...baseProps,
    ...(override.props || {}),
    style: { ...(children.props.style || {}), ...(override.style || {}) },
    className: joinClassNames(children.props.className, override.className),
  })

  const decorated = cloneElement(children, merged)

  if (typeof override.decorator === 'function') {
    try {
      return override.decorator(decorated, { id, surface, ...(ctx || {}) })
    } catch (err) {
      console.error(`[storyboard] presentation decorator for "${id}" threw:`, err)
      return decorated
    }
  }

  return decorated
}

function mergeChildProps(child, extras) {
  // Don't overwrite explicit child props blindly: callers like data-sb-chrome
  // and presentation `props` win over child props (the wrapping override is
  // intentional), but child's `onClick` etc. is preserved when consumer
  // override doesn't define one. cloneElement's own merge semantics handle
  // most of this — we just compose className/style here.
  return extras
}

function joinClassNames(a, b) {
  if (!a) return b || undefined
  if (!b) return a || undefined
  return `${a} ${b}`
}
