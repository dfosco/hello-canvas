/**
 * Prototype Fullscreen tool — keyboard-only handler that toggles immersive
 * fullscreen mode for the selected prototype widget on the canvas.
 *
 * No UI component — triggered exclusively via Cmd+Opt+Ctrl+F.
 * Dispatches a custom event that CanvasPage listens for.
 */
export const id = 'prototype-fullscreen'

export async function handler() {
  return {
    toggle() {
      document.dispatchEvent(new CustomEvent('storyboard:canvas:prototype-fullscreen'))
    },
  }
}
