/**
 * Tool module registry — maps tool IDs to lazy-loaded handler modules.
 *
 * Each handler module exports: { id, component?, handler?, setup?, guard? }
 * All imports are dynamic to enable code splitting.
 */
export const coreHandlers = {
  create:               () => import('./handlers/create.js'),
  theme:                () => import('./handlers/theme.js'),
  'palette-theme':      () => import('./handlers/paletteTheme.js'),
  comments:             () => import('./handlers/comments.js'),
  flows:                () => import('./handlers/flows.js'),
  knobs:                () => import('./handlers/knobs.js'),
  inspector:            () => import('./handlers/inspector.js'),
  devtools:             () => import('./handlers/devtools.js'),
  'feature-flags':      () => import('./handlers/featureFlags.js'),
  'running-sites':      () => import('./handlers/runningSites.js'),
  autosync:             () => import('./handlers/autosync.js'),
  'canvas-add-widget':  () => import('./handlers/canvasAddWidget.js'),
  'canvas-agents':      () => import('./handlers/canvasAgents.js'),
  'canvas-toolbar':     () => import('./handlers/canvasToolbar.js'),
  'agents-ready':       () => import('./handlers/agentsReady.js'),
  'hide-toolbars':      () => import('./handlers/hideToolbars.js'),
  'command-palette':    () => import('./handlers/commandPalette.js'),
  publish:              () => import('./handlers/publish.js'),
  'hide-chrome':        () => import('./handlers/hideChrome.js'),
}

// Keep legacy export name for backward compatibility
export const toolModules = coreHandlers
