/**
 * Message Storage Adapter Interface
 *
 * Defines the contract for message persistence backends.
 * v1 ships with JSONL only; the interface exists for future extensibility.
 */

/**
 * @typedef {Object} ReadOptions
 * @property {string} [since]  - Return events after this ID (exclusive). ULID-based comparison.
 * @property {number} [limit]  - Maximum number of events to return.
 * @property {string} [type]   - Filter by event type prefix (e.g., 'message:' matches message:request, message:response).
 */

/**
 * @typedef {Object} MessageStorageAdapter
 *
 * @property {(channel: string, event: object) => Promise<void>} append
 *   Persist a single event to the given channel. The event is already validated.
 *
 * @property {(channel: string, opts?: ReadOptions) => Promise<object[]>} read
 *   Read events from a channel, optionally filtered by since/limit/type.
 *   Returns events in append order (oldest first).
 *
 * @property {() => Promise<void>} [init]
 *   Optional initialization (e.g., create directories). Called once at startup.
 *
 * @property {() => Promise<void>} [close]
 *   Optional cleanup (e.g., flush buffers). Called on server shutdown.
 */

export default undefined // This file is types-only via JSDoc
