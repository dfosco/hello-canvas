/**
 * Suppress Vite's HMR error overlay for prototype-only failures.
 *
 * Background: Vite broadcasts transform errors over the HMR websocket to
 * EVERY connected client. With Storyboard's prototype iframe isolation
 * (prototypes.html), prototypes render in an iframe — but the canvas
 * page's own HMR client still receives the broadcast and renders
 * `<vite-error-overlay>` on top of the canvas chrome.
 *
 * This helper watches for that overlay element and removes it when the
 * referenced file lives under `/src/prototypes/`. The iframe inside the
 * canvas still shows the overlay (it's the same `<vite-error-overlay>`
 * created inside the iframe's own document), so the user can still see
 * and fix the broken prototype — they just don't lose the canvas.
 *
 * Dev-only: in production builds Vite isn't running, no overlay element
 * exists, and the MutationObserver is a no-op cost we skip entirely.
 *
 * Usage (from a consumer scaffold's `mount.jsx`):
 *
 *   import { installPrototypeOverlayIsolation } from '@dfosco/hypercanvas/vite/dev-overlay-isolation'
 *   installPrototypeOverlayIsolation()
 */

const PROTOTYPE_PATH_PATTERN = /\/src\/prototypes\//

function overlayReferencesPrototype(overlay) {
  const root = overlay.shadowRoot
  if (!root) return false
  const text = root.textContent || ''
  return PROTOTYPE_PATH_PATTERN.test(text)
}

function maybeSuppress(overlay) {
  if (!overlay || overlay.tagName !== 'VITE-ERROR-OVERLAY') return
  // shadowRoot may not be populated synchronously; retry on next frame.
  const tryRemove = (attempt = 0) => {
    if (overlayReferencesPrototype(overlay)) {
      overlay.remove()
      console.warn(
        '[storyboard] suppressed Vite error overlay from /src/prototypes/ — ' +
        'see the prototype iframe for the actual error.',
      )
      return
    }
    if (attempt < 3) requestAnimationFrame(() => tryRemove(attempt + 1))
  }
  tryRemove()
}

export function installPrototypeOverlayIsolation() {
  if (typeof document === 'undefined') return
  if (!import.meta.env?.DEV) return

  // Sweep anything already in the DOM (covers the case where the overlay
  // mounted before this script ran).
  document.querySelectorAll('vite-error-overlay').forEach(maybeSuppress)

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((node) => {
        if (node.nodeType !== 1) return
        if (node.tagName === 'VITE-ERROR-OVERLAY') {
          maybeSuppress(node)
        } else if (node.querySelectorAll) {
          node.querySelectorAll('vite-error-overlay').forEach(maybeSuppress)
        }
      })
    }
  })
  observer.observe(document.body, { childList: true, subtree: false })
}
