/**
 * Feature Flags tool module — toggle feature flags submenu.
 *
 * Renders as a submenu in the command menu listing all declared flags.
 * Flags already exposed as devtool toggles are excluded to avoid duplication.
 */
export const id = 'feature-flags'

const DEVTOOL_MANAGED_FLAGS = new Set([
  'dev-logs',
  'canvas-auto-reload',
  'prototype-auto-reload',
  // Startup-only, server-persisted setting: change through Settings + Save.
  'usePaseoApp',
])

export async function handler() {
  const ff = await import('../../index.js')

  return {
    getChildren: () =>
      ff.getFlagKeys()
        .filter(key => !DEVTOOL_MANAGED_FLAGS.has(key))
        .map(key => ({
          id: `flags/${key}`,
          label: key,
          type: 'toggle',
          active: ff.getFlag(key),
          execute: () => ff.toggleFlag(key),
        })),
  }
}
