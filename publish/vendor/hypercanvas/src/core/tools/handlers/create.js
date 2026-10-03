/**
 * Create tool module — workshop prototype/flow/canvas creation.
 *
 * Loads the workshop feature registry and CreateMenuButton component.
 * Guard: only mounts if at least one create feature has an overlay.
 */
export const id = 'create'

export async function setup(ctx) {
  const { config } = ctx
  const { features } = await import('../../workshop/features/registry.js')

  const createActions = Array.isArray(config.actions) ? config.actions : []
  const createFeatures = createActions
    .filter(a => a.feature)
    .map(a => {
      const feat = features[a.feature]
      if (!feat || !feat.overlayId || !feat.overlay) return null
      return {
        name: feat.name,
        label: a.label || feat.label,
        overlayId: feat.overlayId,
        overlay: feat.overlay,
      }
    })
    .filter(Boolean)

  return { features: createFeatures }
}

export async function guard(ctx) {
  const result = await setup(ctx)
  return result.features.length > 0
}

export async function component() {
  const mod = await import('../../ui/CreateMenuButton.jsx')
  return mod.default
}
