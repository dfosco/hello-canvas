/**
 * Flows tool module — flow switcher action menu.
 *
 * Registers a command action handler that lists available flows
 * for the current prototype and lets users switch between them.
 */
export const id = 'flows'

export async function handler(ctx) {
  const loader = await import('../../index.js')
  const { sbNavigate } = await import('../../navigation/sbNavigate.js')
  const vf = loader
  const { basePath = '/' } = ctx

  return {
    getChildren: () => {
      let path = window.location.pathname
      const base = basePath.replace(/\/+$/, '')
      if (base && path.startsWith(base)) path = path.slice(base.length)
      path = path.replace(/\/+$/, '') || '/'
      const segments = path.split('/').filter(Boolean)

      // Detect and preserve branch-- segment on deployed branch builds
      const branchSegment = (segments[0] && segments[0].startsWith('branch--')) ? segments[0] : null
      const protoIdx = branchSegment ? 1 : 0
      const proto = segments[protoIdx] || null
      if (!proto) return []

      const params = new URLSearchParams(window.location.search)
      const explicit = params.get('flow') || params.get('scene')
      let active
      if (explicit) {
        active = loader.resolveFlowName(proto, explicit)
      } else {
        const pageFlow = path === '/' ? 'index' : (path.split('/').pop() || 'index')
        const scoped = loader.resolveFlowName(proto, pageFlow)
        if (loader.flowExists(scoped)) active = scoped
        else {
          const protoFlow = loader.resolveFlowName(proto, proto)
          active = loader.flowExists(protoFlow) ? protoFlow : 'default'
        }
      }

      const flows = loader.getFlowsForPrototype(proto)
      if (flows.length <= 1) return []

      return flows.map(f => {
        const meta = vf.getFlowMeta(f.key)
        let url = vf.resolveFlowRoute(f.key)
        // Re-apply basePath and branch-- prefix so deployed branch builds stay on the correct path
        const prefix = (base || '') + (branchSegment ? `/${branchSegment}` : '')
        if (prefix) url = prefix + url
        return {
          id: f.key,
          label: meta?.title || f.name,
          type: 'radio',
          active: f.key === active,
          href: url,
          execute: () => { sbNavigate(url) },
        }
      })
    },
  }
}

export async function component() {
  const mod = await import('../../ui/ActionMenuButton.jsx')
  return mod.default
}
