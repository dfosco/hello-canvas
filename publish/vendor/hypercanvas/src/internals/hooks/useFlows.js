import { useContext, useMemo, useCallback } from 'react'
import { StoryboardContext } from '../StoryboardContext.js'
import { getFlowsForPrototype, resolveFlowRoute, sbNavigate } from '../../core/index.js'
import { getFlowMeta } from '../../core/index.js'

/**
 * List all flows for the current prototype and switch between them.
 *
 * @returns {{
 *   flows: Array<{ key: string, name: string, title: string, route: string }>,
 *   activeFlow: string,
 *   switchFlow: (flowKey: string) => void,
 *   prototypeName: string | null
 * }}
 */
export function useFlows() {
  const context = useContext(StoryboardContext)
  if (context === null) {
    throw new Error('useFlows must be used within a <StoryboardProvider>')
  }

  const { flowName: activeFlow, prototypeName } = context

  const flows = useMemo(() => {
    if (!prototypeName) return []
    return getFlowsForPrototype(prototypeName).map(f => {
      const meta = getFlowMeta(f.key)
      return {
        key: f.key,
        name: f.name,
        title: meta?.title || f.name,
        route: resolveFlowRoute(f.key),
      }
    })
  }, [prototypeName])

  const switchFlow = useCallback((flowKey) => {
    const flow = flows.find(f => f.key === flowKey)
    if (flow) {
      sbNavigate(flow.route)
    }
  }, [flows])

  return {
    flows,
    activeFlow,
    switchFlow,
    prototypeName,
  }
}
