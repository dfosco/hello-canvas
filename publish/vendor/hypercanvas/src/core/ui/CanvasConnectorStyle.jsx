/**
 * CanvasConnectorStyle — toolbar toggle for connector rendering style.
 * Cycles between 'fluid' (cubic Bézier) and 'orthogonal' (right-angled).
 */
import { useState, useEffect } from 'react'
import './CanvasConnectorStyle.css'
import * as Tooltip from '../lib/components/ui/tooltip/index.js'
import Icon from './Icon.jsx'

const FLUID_ICON = 'iconoir/sea-waves'
const ORTHO_ICON = 'iconoir/rhombus'

export default function CanvasConnectorStyle({ config = {}, data, tabindex = -1 }) {
  const [style, setStyle] = useState('fluid')

  useEffect(() => {
    function handleState(e) {
      const next = e.detail?.style
      if (next === 'fluid' || next === 'orthogonal') setStyle(next)
    }
    document.addEventListener('storyboard:canvas:connector-style-state', handleState)
    document.dispatchEvent(new CustomEvent('storyboard:canvas:connector-style-state-request'))
    return () => {
      document.removeEventListener('storyboard:canvas:connector-style-state', handleState)
    }
  }, [])

  if (!data) return null

  const isOrtho = style === 'orthogonal'
  const next = isOrtho ? 'fluid' : 'orthogonal'
  const icon = isOrtho ? (config.iconOrthogonal || ORTHO_ICON) : (config.iconFluid || FLUID_ICON)
  const label = isOrtho
    ? (config.labelOrthogonal || 'Orthogonal connectors')
    : (config.labelFluid || 'Fluid connectors')

  return (
    <Tooltip.Root>
      <Tooltip.Trigger>
        <button
          className={`canvas-connector-style-btn${isOrtho ? ' canvas-connector-style-btn-active' : ''}`}
          onClick={() => data.setConnectorStyle?.(next)}
          aria-label={config.ariaLabel || 'Connector style'}
          aria-pressed={isOrtho}
          tabIndex={tabindex}
        >
          <Icon name={icon} size={16} {...(config.meta || {})} />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Content side="top">{label}</Tooltip.Content>
    </Tooltip.Root>
  )
}
