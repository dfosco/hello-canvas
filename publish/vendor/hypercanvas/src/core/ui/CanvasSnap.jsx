/**
 * CanvasSnap — standalone snap-to-grid toggle button.
 * Uses TriggerButton so it matches the agents / add-widget toolbar buttons.
 * The `active` prop renders the same pressed state used by open menu triggers.
 */
import { useState, useEffect } from 'react'
import * as Tooltip from '../lib/components/ui/tooltip/index.js'
import { TriggerButton } from '../lib/components/ui/trigger-button/index.js'
import Icon from './Icon.jsx'

export default function CanvasSnap({ config = {}, data, tabindex = -1 }) {
  const [snapEnabled, setSnapEnabled] = useState(false)

  useEffect(() => {
    function handleSnapState(e) {
      setSnapEnabled(!!e.detail?.snapEnabled)
    }
    document.addEventListener('storyboard:canvas:snap-state', handleSnapState)

    // Broadcast configured gridSize on mount
    const gridSize = config.gridSize
    if (gridSize) {
      document.dispatchEvent(new CustomEvent('storyboard:canvas:grid-size', {
        detail: { gridSize }
      }))
    }
    // Request current snap state (may have dispatched before we mounted)
    document.dispatchEvent(new CustomEvent('storyboard:canvas:snap-state-request'))

    return () => {
      document.removeEventListener('storyboard:canvas:snap-state', handleSnapState)
    }
  }, [config.gridSize])

  if (!data) return null

  const label = snapEnabled
    ? (config.labelOn || 'Snap to grid (on)')
    : (config.labelOff || 'Snap to grid (off)')

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <TriggerButton
          size="icon-xl"
          active={snapEnabled}
          aria-label={config.label || 'Snap to grid'}
          aria-pressed={snapEnabled}
          tabIndex={tabindex}
          onClick={() => data.toggleSnap()}
        >
          <Icon name={config.icon || 'iconoir/view-grid'} size={16} {...(config.meta || {})} />
        </TriggerButton>
      </Tooltip.Trigger>
      <Tooltip.Content side="top">{label}</Tooltip.Content>
    </Tooltip.Root>
  )
}
