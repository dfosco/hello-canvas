const TEXT_SELECTION_EDITING_SELECTOR = 'textarea, [contenteditable="true"], [contenteditable=""], [data-canvas-allow-text-selection]'

/**
 * Returns true when canvas mouse interactions should suppress browser text selection.
 */
export function shouldPreventCanvasTextSelection(target) {
  if (!(target instanceof Element)) return true
  return !target.closest(TEXT_SELECTION_EDITING_SELECTOR)
}

