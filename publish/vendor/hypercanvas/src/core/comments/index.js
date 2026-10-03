/**
 * Barrel exports for the comments system.
 */

// Config
export { initCommentsConfig, getCommentsConfig, isCommentsEnabled } from './config.js'

// Auth
export { getToken, setToken, clearToken, getCachedUser, validateToken, isAuthenticated } from './auth.js'

// Comment mode
export { isCommentModeActive, toggleCommentMode, setCommentMode, subscribeToCommentMode } from './commentMode.js'

// Metadata
export { parseMetadata, serializeMetadata, updateMetadata } from './metadata.js'

// API
export {
  fetchRouteDiscussion,
  fetchRouteCommentsSummary,
  fetchCommentDetail,
  createComment,
  replyToComment,
  resolveComment,
  unresolveComment,
  editComment,
  editReply,
  moveComment,
  deleteComment,
  addReaction,
  removeReaction,
  listDiscussions,
} from './api.js'

// Cache
export { getCachedComments, setCachedComments, clearCachedComments, savePendingComment, getPendingComments, removePendingComment } from './commentCache.js'

// Drafts
export { saveDraft, getDraft, clearDraft, composerDraftKey, replyDraftKey } from './commentDrafts.js'

// GraphQL client (for advanced use)
export { graphql } from './graphql.js'
