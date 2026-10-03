/**
 * Hide Chrome tool — toolbar button that toggles toolbar/branch bar visibility.
 */
export const id = 'hide-chrome'

export async function component() {
  const mod = await import('../../ui/HideChromeTrigger.jsx')
  return mod.default
}
