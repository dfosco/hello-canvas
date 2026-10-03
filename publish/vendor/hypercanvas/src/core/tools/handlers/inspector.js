/**
 * Inspector tool module — component inspector sidepanel.
 *
 * Auto-opens the panel if ?inspect= is in the URL.
 */
export const id = 'inspector'

export async function setup() {
  const { openPanel } = await import('../../stores/sidePanelStore.js')

  try {
    const inspectParam = new URL(window.location.href).searchParams.get('inspect')
    if (inspectParam) {
      openPanel('inspector')
    }
  } catch { /* ignore */ }
}

// No component needed — sidepanel tools use generic TriggerButton
