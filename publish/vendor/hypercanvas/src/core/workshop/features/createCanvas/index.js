/**
 * Create Canvas feature — create new canvases from the Workshop panel.
 *
 * Server routes are handled by the dedicated canvas handler at /_storyboard/canvas/.
 * This feature only provides the workshop UI overlay.
 */

import CreateCanvasForm from './CreateCanvasForm.jsx'

export const name = 'createCanvas'
export const label = 'Create canvas'
export const icon = '🎨'
export const overlayId = 'createCanvas'
export const overlay = CreateCanvasForm
