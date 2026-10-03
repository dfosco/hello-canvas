/**
 * Canvas agents tool module — dropdown menu for adding agent widgets to canvas.
 *
 * Renders agent options from canvas.agents config. Only active on canvas pages
 * when agents are configured.
 */
export const id = 'canvas-agents'

export async function guard(_ctx) {
  void _ctx
  const { getConfig } = await import('../../index.js')
  const canvasConfig = getConfig('canvas')
  const agents = canvasConfig?.agents
  return agents && typeof agents === 'object' && Object.keys(agents).length > 0
}

export async function component() {
  const mod = await import('../../ui/CanvasAgentsMenu.jsx')
  return mod.default
}
