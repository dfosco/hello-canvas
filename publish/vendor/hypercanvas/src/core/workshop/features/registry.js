/**
 * Workshop feature registry.
 *
 * Maps feature names (matching keys in storyboard.config.json → workshop.features)
 * to their module paths. The server plugin and client mount use this registry
 * to dynamically load only the enabled features.
 *
 * To add a new feature:
 * 1. Create a directory under features/ with index.js exporting the standard interface
 * 2. Add its import here
 */

import * as createPrototype from './createPrototype/index.js'
import * as createFlow from './createFlow/index.js'
import * as createPage from './createPage/index.js'
import * as createCanvas from './createCanvas/index.js'
import * as createStory from './createStory/index.js'

/**
 * All available workshop features, keyed by config name.
 */
export const features = {
  createPrototype,
  createFlow,
  createPage,
  createCanvas,
  createStory,
}
