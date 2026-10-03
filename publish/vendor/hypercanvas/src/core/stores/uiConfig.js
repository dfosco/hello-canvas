/**
 * UI Config — project-level overrides for storyboard chrome visibility.
 *
 * Client repos use the "ui" key in storyboard.config.json to hide
 * specific menus, toolbar items, or workspace nav entries.
 *
 *   {
 *     "ui": {
 *       "hide": [
 *         "docs",                 // CoreUIBar menu key
 *         "comments",             // CoreUIBar menu key
 *         "workspace:components", // workspace sidebar nav id
 *         "branch-bar"            // top branch/dev bar
 *       ]
 *     }
 *   }
 *
 * Convention: namespaced keys (`<surface>:<id>`) are recommended for new
 * surfaces to avoid collisions. Existing CoreUIBar menus use bare keys
 * for back-compat.
 *
 * Framework-agnostic (zero npm dependencies).
 */

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let _hiddenItems = new Set()

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Initialize UI config from storyboard.config.json's "ui" key.
 * Called by the Vite data plugin's generated virtual module.
 *
 * @param {{ hide?: string[] }} [config]
 */
export function initUIConfig(config = {}) {
  _hiddenItems = new Set(Array.isArray(config.hide) ? config.hide : [])
}

/**
 * Check whether a specific menu is hidden by project config.
 *
 * @param {string} key  Menu key (e.g. 'docs', 'inspector', 'create', 'comments', 'command')
 * @returns {boolean}
 */
export function isMenuHidden(key) {
  return _hiddenItems.has(key)
}

/**
 * Get the full set of hidden item keys.
 *
 * @returns {string[]}
 */
export function getHiddenItems() {
  return Array.from(_hiddenItems)
}

/**
 * Additively register hidden item keys (without clobbering existing entries).
 * Used by `applyCustomerMode` to fold `customerMode.tools.hide` and
 * `customerMode.branchBar` into the same Set that `isMenuHidden` consults.
 *
 * @param {string[]} keys
 */
export function addHiddenItems(keys) {
  if (!Array.isArray(keys)) return
  for (const key of keys) {
    if (typeof key === 'string' && key) _hiddenItems.add(key)
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Reset all internal state. Only for use in tests.
 */
export function _resetUIConfig() {
  _hiddenItems = new Set()
}
