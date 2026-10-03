/**
 * AgentsReadyTrigger — collab-bar button that shows count of `done` agents
 * on the active canvas and cycles through them on click. Always rendered
 * (shows `0` when no agents are ready) and styled to match the per-widget
 * toolbar `featureBtn`.
 *
 * Listens to `storyboard:done-agents-changed` (dispatched by CanvasPage) and
 * dispatches `storyboard:canvas:center-on-widget` to pan to the next agent.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import Icon from './Icon.jsx'

export default function AgentsReadyTrigger({ config = {}, tabIndex }) {
  const [doneAgents, setDoneAgents] = useState([])
  const [workingAgents, setWorkingAgents] = useState([])
  const cycleIndexRef = useRef(0)

  useEffect(() => {
    function handleChange(e) {
      const done = Array.isArray(e.detail?.doneAgents) ? e.detail.doneAgents : []
      const working = Array.isArray(e.detail?.workingAgents) ? e.detail.workingAgents : []
      setDoneAgents(done)
      setWorkingAgents(working)
    }
    document.addEventListener('storyboard:done-agents-changed', handleChange)
    document.dispatchEvent(new CustomEvent('storyboard:done-agents-request'))
    return () => document.removeEventListener('storyboard:done-agents-changed', handleChange)
  }, [])

  const doneCount = doneAgents.length
  const workingCount = workingAgents.length
  const ready = doneCount > 0
  const idle = doneCount === 0 && workingCount === 0
  const label = config.label || 'Agents ready'

  const handleClick = useCallback(() => {
    if (doneCount === 0) return
    const idx = cycleIndexRef.current % doneCount
    cycleIndexRef.current = (idx + 1) % doneCount
    const next = doneAgents[idx]
    if (!next?.id) return
    document.dispatchEvent(new CustomEvent('storyboard:canvas:center-on-widget', {
      detail: { widgetId: next.id },
    }))
  }, [doneCount, doneAgents])

  let aria = config.ariaLabel || label
  if (ready) aria = `${label} (${doneCount})`
  if (workingCount > 0) aria = `${aria} · ${workingCount} working`

  return (
    <button
      type="button"
      data-collab-bar-item="agents-ready"
      data-count={doneCount}
      data-working={workingCount}
      data-ready={ready || undefined}
      className="agents-ready-btn"
      aria-label={aria}
      tabIndex={tabIndex}
      onClick={handleClick}
      disabled={idle}
    >
      {workingCount > 0
        ? <span className="agents-ready-btn-icon-spinner" aria-hidden="true" />
        : <Icon name={config.icon || 'agents'} size={14} {...(config.meta || {})} />}
      <span className="agents-ready-btn-label">{label}</span>
      <span className="agents-ready-btn-count" aria-hidden="true">{doneCount}</span>
      {workingCount > 0 && (
        <span className="agents-ready-btn-working" aria-hidden="true" title={`${workingCount} working`}>
          <span className="agents-ready-btn-working-count">{workingCount}</span>
        </span>
      )}
    </button>
  )
}

