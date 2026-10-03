/**
 * Comments tool module — comment pins and annotation system.
 *
 * Guard: only mounts if comments are enabled in storyboard.config.json.
 */
export const id = 'comments'

export async function guard() {
  const { isCommentsEnabled } = await import('../../index.js')
  return isCommentsEnabled()
}

export async function component() {
  const mod = await import('../../ui/CommentsMenuButton.jsx')
  return mod.default
}
