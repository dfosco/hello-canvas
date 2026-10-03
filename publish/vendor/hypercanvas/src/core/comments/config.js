/**
 * Comments configuration — load and validate storyboard.config.json
 *
 * The config is passed in at app startup via initCommentsConfig().
 * This mirrors the core init() pattern.
 */

let _config = null

/**
 * Initialize comments config from storyboard.config.json contents.
 * @param {object} rawConfig - The parsed storyboard.config.json object
 * @param {object} [options] - Additional options
 * @param {string} [options.basePath] - Base URL path for filtering comments (e.g. "/storyboard-source/")
 */
export function initCommentsConfig(rawConfig, options = {}) {
  if (!rawConfig || !rawConfig.comments) {
    _config = null
    return
  }
  const c = rawConfig.comments
  const r = rawConfig.repository
  _config = {
    repo: {
      owner: r?.owner ?? '',
      name: r?.name ?? '',
    },
    discussions: {
      category: c.discussions?.category ?? 'Storyboard Comments',
    },
    basePath: options.basePath ?? '/',
  }
}

/**
 * Get the current comments config. Returns null if not configured.
 */
export function getCommentsConfig() {
  return _config
}

/**
 * Check whether the comments system is enabled (config was provided and valid).
 */
export function isCommentsEnabled() {
  return _config !== null && _config.repo.owner !== '' && _config.repo.name !== ''
}
