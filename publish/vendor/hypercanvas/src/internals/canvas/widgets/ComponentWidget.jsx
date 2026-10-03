// Deprecated stub — ComponentWidget was removed in 4.2.5.
// This file exists only to prevent crashes in CanvasPage's jsx- code path,
// which still references ComponentWidget for legacy canvas companion files.
// The jsx- system is dormant (no canvases define a `jsx` field).
import WidgetWrapper from './WidgetWrapper.jsx'

export default function ComponentWidget({ component: Component }) {
  if (!Component) return null
  return (
    <WidgetWrapper>
      <Component />
    </WidgetWrapper>
  )
}
