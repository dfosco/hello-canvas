export const id = 'running-sites'

export async function component() {
  const mod = await import('../../ui/RunningSitesTrigger.jsx')
  return mod.default
}
