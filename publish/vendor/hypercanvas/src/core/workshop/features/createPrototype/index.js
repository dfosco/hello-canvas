/**
 * Create Prototype feature — create new prototypes from the Workshop panel.
 *
 * Each workshop feature exports a standard interface:
 *   - name:          Feature identifier (matches config key in workshop.features)
 *   - label:         Display name for the menu item
 *   - icon:          Emoji or HTML for the menu icon
 *   - overlayId:     Unique ID for the overlay
 *   - overlay:       Component rendered in the overlay
 *   - serverSetup:   Called by the server plugin to register API routes
 */

import CreatePrototypeForm from './CreatePrototypeForm.jsx'

export const name = 'createPrototype'
export const label = 'Create prototype'
export const icon = '🧩'
export const overlayId = 'createPrototype'
export const overlay = CreatePrototypeForm
