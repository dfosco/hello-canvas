/**
 * Autosync tool handler.
 *
 * Dev-only tool (localOnly) that auto-commits and pushes changes
 * to a selected branch every 30 seconds.
 */
export const id = 'autosync'

export async function component() {
  const mod = await import('../../ui/AutosyncMenuButton.jsx')
  return mod.default
}
