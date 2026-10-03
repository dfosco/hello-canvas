/**
 * Artifact system — unified creation, editing, and deletion of storyboard artifacts.
 *
 * Public API:
 *   validateArtifact(type, values, root)
 *   createArtifact(type, values, root)
 *   editArtifact(type, name, updates, root)
 *   deleteArtifact(type, name, options, root)
 *   listArtifacts(type, options, root)
 *   createArtifactRoutes({ root, sendJson })
 */

export { validateArtifact, VALID_TYPES, loadSchema } from './validate.js'
export { createArtifact, editArtifact, deleteArtifact, listArtifacts } from './operations.js'
export { createArtifactRoutes } from './routes.js'
