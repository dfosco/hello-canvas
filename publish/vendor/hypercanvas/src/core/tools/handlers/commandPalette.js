/**
 * Command Palette tool — toolbar button that opens the ⌘K command palette.
 */
export const id = 'command-palette'

export async function component() {
  const mod = await import('../../ui/CommandPaletteTrigger.jsx')
  return mod.default
}
