/**
 * Canvas add-widget tool module — dropdown menu for adding widgets to canvas.
 *
 * Wraps the CanvasCreateMenu component. Only active on canvas pages.
 */
export const id = 'canvas-add-widget'

export async function component() {
  const mod = await import('../../ui/CanvasCreateMenu.jsx')
  return mod.default
}
