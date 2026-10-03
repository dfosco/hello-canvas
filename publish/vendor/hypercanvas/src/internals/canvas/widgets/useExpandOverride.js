/**
 * useExpandOverride — URL-backed expand/split-screen state for canvas widgets.
 *
 * Mirrors the per-widget `_<type>_expanded_<id>` hash convention already used by
 * TerminalWidget and PrototypeEmbed, so every fullscreen / split-screen view has
 * a discrete URL users can deep-link to.
 *
 * Returns: [expanded, setExpanded] where `expanded` is whatever string mode the
 * widget chose (e.g. 'single' | 'split' | 'immersive') or null when collapsed.
 * Pass `null` (or any falsy) to setExpanded to clear the override and revert to
 * the canvas view.
 */
import { useCallback } from 'react'
import { useOverride } from '../../hooks/useOverride.js'

export function useExpandOverride(widgetType, widgetId) {
  const path = `_${widgetType}_expanded_${widgetId}`
  const [override, setOverride, clearOverride] = useOverride(path)
  const setExpanded = useCallback((mode) => {
    if (mode) setOverride(mode)
    else clearOverride()
  }, [setOverride, clearOverride])
  return [override || null, setExpanded]
}
