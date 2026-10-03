/**
 * Plugin configuration — enable/disable storyboard plugins.
 *
 * Plugins are enabled by default. The config is read from
 * storyboard.config.json under the "plugins" key and injected
 * at build time by the Vite data plugin.
 *
 * Example config:
 *   { "plugins": { "devtools": false } }
 */

let _plugins = {}

/**
 * Initialize plugin configuration.
 * Called by the Vite data plugin's generated virtual module.
 * @param {Record<string, boolean>} config
 */
export function initPlugins(config) {
  _plugins = { ...config }
}

/**
 * Check whether a plugin is enabled.
 * Returns true by default if the plugin is not explicitly configured.
 * @param {string} name - Plugin name (e.g. "devtools", "comments")
 * @returns {boolean}
 */
export function isPluginEnabled(name) {
  if (name in _plugins) return Boolean(_plugins[name])
  return true
}

/**
 * Get the full plugins config (for diagnostics / testing).
 * @returns {Record<string, boolean>}
 */
export function getPluginsConfig() {
  return { ..._plugins }
}
