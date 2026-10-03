/**
 * Knobs tool module — toggles the draggable floating knobs panel.
 */
export const id = 'knobs'

export async function handler() {
  const { toggleKnobsPanel } = await import('../../ui/knobsPanelState.js')

  return {
    execute() {
      toggleKnobsPanel()
    },
  }
}
