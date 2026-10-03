/** Publish tool module — generates and connects a Notebook publication. */
export const id = 'publish'

export async function component() {
  const mod = await import('../../ui/PublishControl.jsx')
  return mod.default
}

export function handler() {
  return () => document.querySelector('[aria-label="Publish"]')?.click()
}
