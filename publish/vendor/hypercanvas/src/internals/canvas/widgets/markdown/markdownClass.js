/**
 * Resolve the shared markdown-content class name for a given size and
 * interactivity mode. Split out of `MarkdownEditor.jsx` so non-React
 * consumers (and Fast Refresh) don't choke on mixed exports.
 *
 *   - size: 'small' for in-canvas widgets, 'large' for expanded panes
 *   - inert: true to add the pointer-events cascade so the canvas drag
 *            handler can grab the underlying widget (links / imgs /
 *            videos / checkboxes stay interactive)
 */
import contentStyles from './markdownContent.module.css'

export function getMarkdownContentClassName({ size = 'small', inert = false } = {}) {
  const base = size === 'large' ? contentStyles.contentLarge : contentStyles.contentSmall
  return inert ? `${base} ${contentStyles.inert}` : base
}
