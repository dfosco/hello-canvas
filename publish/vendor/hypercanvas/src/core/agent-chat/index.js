/**
 * @dfosco/storyboard/agent-chat — Paseo-backed agent chat surface.
 *
 * Reusable conversation components and hooks for embedding agent chat
 * anywhere in the Hypercanvas UI (canvas widgets, pages, panels).
 */

export { agentChatTransport as default, agentChatTransport } from './agent-chat-client.js'
export { AgentChatStore, generateMessageId } from './agent-chat-store.js'
export {
  createEmptyState,
  applyStreamEvent,
  applyTimelinePage,
  beginSubmission,
  rejectSubmission,
  settleSubmission,
  classifyStreamSeq,
  itemIdentity,
  submitAcknowledged,
} from './agent-chat-store.js'
