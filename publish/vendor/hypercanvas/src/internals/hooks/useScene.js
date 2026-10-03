import { useContext, useCallback } from 'react'
import { StoryboardContext } from '../StoryboardContext.js'
import { sbNavigate } from '../../core/navigation/sbNavigate.js'

/**
 * Read the current flow name and programmatically switch flows.
 *
 * @returns {{ flowName: string, switchFlow: (name: string) => void }}
 *   - flowName    – current active flow (e.g. "default")
 *   - switchFlow  – navigate to a different flow by updating ?flow= param
 */
export function useFlow() {
  const context = useContext(StoryboardContext)
  if (context === null) {
    throw new Error('useFlow must be used within a <StoryboardProvider>')
  }

  const switchFlow = useCallback((name) => {
    const url = new URL(window.location.href)
    url.searchParams.delete('scene')
    url.searchParams.set('flow', name)
    // Preserve hash params across flow switches
    sbNavigate(url.toString())
  }, [])

  return {
    flowName: context.flowName,
    switchFlow,
  }
}

/** @deprecated Use useFlow() */
export function useScene() {
  const { flowName, switchFlow } = useFlow()
  return {
    sceneName: flowName,
    switchScene: switchFlow,
  }
}
