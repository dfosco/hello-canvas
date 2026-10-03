/**
 * Command Palette Config — runtime store for commandPalette config.
 * Framework-agnostic (zero npm dependencies).
 */

import { getConfig } from './configStore.js'

let _config = { sections: [] }

/**
 * Initialize the command palette config.
 * @param {object} config - The commandPalette object from storyboard.config.json
 */
export function initCommandPaletteConfig(config) {
  _config = { sections: [], ...config }
}

/**
 * Get the current command palette config.
 * Falls back to the unified config store if the legacy store wasn't initialized.
 * @returns {{ sections: Array }}
 */
export function getCommandPaletteConfig() {
  if (_config.sections.length === 0) {
    const uc = getConfig('commandPalette')
    if (uc?.sections?.length > 0) {
      _config = { sections: [], ...uc }
    }
  }
  return _config
}
