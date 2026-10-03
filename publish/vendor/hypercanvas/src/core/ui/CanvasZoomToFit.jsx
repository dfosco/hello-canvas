/**
 * CanvasZoomToFit — standalone zoom-to-objects button.
 * Uses TriggerButton so it matches the agents / add-widget toolbar buttons.
 */
import * as Tooltip from '../lib/components/ui/tooltip/index.js'
import { TriggerButton } from '../lib/components/ui/trigger-button/index.js'
import Icon from './Icon.jsx'

export default function CanvasZoomToFit({ config = {}, data, tabindex = -1 }) {
  if (!data) return null

  const label = config.label || 'Zoom to objects'

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <TriggerButton
          size="icon-xl"
          aria-label={label}
          tabIndex={tabindex}
          onClick={() => data.zoomToFit()}
        >
          <Icon name={config.icon || 'iconoir/square-3d-three-points'} size={16} {...(config.meta || {})} />
        </TriggerButton>
      </Tooltip.Trigger>
      <Tooltip.Content side="top">{label}</Tooltip.Content>
    </Tooltip.Root>
  )
}
