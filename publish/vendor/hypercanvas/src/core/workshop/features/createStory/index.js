/**
 * Create Story feature — workshop form for creating .story.jsx/.tsx files.
 *
 * Server routes are handled by the canvas handler at /_storyboard/canvas/create-story.
 * This feature provides the workshop UI overlay.
 */

import CreateStoryForm from './CreateStoryForm.jsx'

export const name = 'createStory'
export const label = 'Create story'
export const icon = '⚡'
export const overlayId = 'createStory'
export const overlay = CreateStoryForm
