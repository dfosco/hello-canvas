/**
 * Agents Ready tool — collab-bar button that surfaces the count of agents
 * in `done` state on the active canvas and cycles through them on click.
 */
export const id = 'agents-ready'

export async function component() {
  const mod = await import('../../ui/AgentsReadyTrigger.jsx')
  return mod.default
}
