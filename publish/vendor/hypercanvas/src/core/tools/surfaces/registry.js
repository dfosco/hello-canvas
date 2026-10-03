/**
 * Surface registry — exports all available rendering surfaces.
 *
 * Surfaces define WHERE a tool renders. Each surface has a position,
 * supported render types, and rendering logic in CoreUIBar.
 *
 * To add a new surface:
 * 1. Create a definition file in this directory
 * 2. Export it from this registry
 * 3. Add rendering logic in CoreUIBar.jsx
 */
export { id as commandToolbar } from './mainToolbar.js'
export { id as canvasToolbar } from './canvasToolbar.js'
export { id as commandPalette } from './commandList.js'
export { id as collabBar } from './collabBar.js'

/**
 * All surface IDs for validation.
 */
export const SURFACE_IDS = ['command-toolbar', 'canvas-toolbar', 'command-palette', 'collab-bar']
