/**
 * Hash-backed open and position state for the Knobs floating panel.
 */
import { getParam, removeParam, setParam } from '../session/session.js'

export const KNOBS_PANEL_OPEN_KEY = 'knobsPanelOpen'
export const KNOBS_PANEL_X_KEY = 'knobsPanelX'
export const KNOBS_PANEL_Y_KEY = 'knobsPanelY'

export function isKnobsPanelOpen() {
  return getParam(KNOBS_PANEL_OPEN_KEY) === '1'
}

export function openKnobsPanel() {
  setParam(KNOBS_PANEL_OPEN_KEY, '1')
}

export function closeKnobsPanel() {
  removeParam(KNOBS_PANEL_OPEN_KEY)
}

export function toggleKnobsPanel() {
  if (isKnobsPanelOpen()) closeKnobsPanel()
  else openKnobsPanel()
}
