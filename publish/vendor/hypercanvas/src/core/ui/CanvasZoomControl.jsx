/**
 * CanvasZoomControl — zoom in/out/reset bar for canvas pages.
 */
import './CanvasZoomControl.css'
import * as Tooltip from '../lib/components/ui/tooltip/index.js'

export default function CanvasZoomControl({ config = {}, data, zoom = 100, tabindex = -1 }) {
  if (!data) return null

  return (
    <div className="canvas-zoom-bar" role="group" aria-label={config.ariaLabel || 'Zoom controls'}>
      <Tooltip.Root>
        <Tooltip.Trigger>
          <button
            className="canvas-zoom-btn"
            onClick={() => data.zoomOut(zoom)}
            disabled={zoom <= data.ZOOM_MIN}
            aria-label="Decrease zoom"
            tabIndex={tabindex}
          >−</button>
        </Tooltip.Trigger>
        <Tooltip.Content side="top">Decrease zoom</Tooltip.Content>
      </Tooltip.Root>
      <Tooltip.Root>
        <Tooltip.Trigger>
          <button
            className="canvas-zoom-label"
            onClick={() => data.zoomReset()}
            aria-label="Zoom to 100%"
            tabIndex={-1}
          >{zoom}%</button>
        </Tooltip.Trigger>
        <Tooltip.Content side="top">Zoom to 100%</Tooltip.Content>
      </Tooltip.Root>
      <Tooltip.Root>
        <Tooltip.Trigger>
          <button
            className="canvas-zoom-btn"
            onClick={() => data.zoomIn(zoom)}
            disabled={zoom >= data.ZOOM_MAX}
            aria-label="Increase zoom"
            tabIndex={-1}
          >+</button>
        </Tooltip.Trigger>
        <Tooltip.Content side="top">Increase zoom</Tooltip.Content>
      </Tooltip.Root>
    </div>
  )
}
