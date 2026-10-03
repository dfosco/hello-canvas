/**
 * Create Flow feature — create new flow data files from the Workshop panel.
 *
 * Each workshop feature exports a standard interface:
 *   - name:          Feature identifier (matches config key in workshop.features)
 *   - label:         Display name for the menu item
 *   - icon:          Emoji or HTML for the menu icon
 *   - overlayId:     Unique ID for the overlay
 *   - overlay:       Component rendered in the overlay
 *   - serverSetup:   Called by the server plugin to register API routes
 */

import CreateFlowForm from './CreateFlowForm.jsx'

export const name = 'createFlow'
export const label = 'Create flow'
export const icon = '🔀'
export const overlayId = 'createFlow'
export const overlay = CreateFlowForm
