/**
 * Workshop feature server registry.
 *
 * Server-safe registry that only imports server handlers (no UI code).
 * Used by the Vite server plugin to wire API routes.
 *
 * To add a new feature:
 * 1. Create a server.js in features/<name>/
 * 2. Add its server handler here
 */

import { createPrototypesHandler } from './createPrototype/server.js'
import { createFlowsHandler } from './createFlow/server.js'

/**
 * Server-side feature handlers, keyed by config name.
 */
export const serverFeatures = {
  createPrototype: { serverSetup: createPrototypesHandler },
  createFlow: { serverSetup: createFlowsHandler },
  createPage: { serverSetup: createFlowsHandler },
}
