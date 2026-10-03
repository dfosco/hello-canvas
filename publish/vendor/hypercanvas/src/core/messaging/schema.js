/**
 * Messaging Bus Schema
 *
 * ULID generation, envelope validation, and status constants.
 * Zero npm dependencies — ULID is inlined (~30 lines).
 */

// ---------------------------------------------------------------------------
// ULID generation (inline, Crockford Base32)
// ---------------------------------------------------------------------------

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
let lastTime = 0
let lastRandom = new Array(16).fill(0)

/**
 * Generate a monotonic ULID.
 * Same-millisecond calls increment the random component to guarantee sort order.
 * @returns {string} 26-character ULID
 */
export function generateId() {
  let now = Date.now()

  if (now === lastTime) {
    // Increment random portion for monotonicity
    for (let i = 15; i >= 0; i--) {
      if (lastRandom[i] < 31) {
        lastRandom[i]++
        break
      }
      lastRandom[i] = 0
    }
  } else {
    lastTime = now
    for (let i = 0; i < 16; i++) {
      lastRandom[i] = Math.floor(Math.random() * 32)
    }
  }

  // Encode timestamp (10 chars, 48-bit ms)
  let ts = ''
  for (let i = 9; i >= 0; i--) {
    ts = ENCODING[now & 0x1f] + ts
    now = Math.floor(now / 32)
  }

  // Encode randomness (16 chars)
  let rand = ''
  for (let i = 0; i < 16; i++) {
    rand += ENCODING[lastRandom[i]]
  }

  return ts + rand
}

// ---------------------------------------------------------------------------
// Message status constants
// ---------------------------------------------------------------------------

export const STATUS = Object.freeze({
  PENDING: 'pending',
  ACKNOWLEDGED: 'acknowledged',
  RESOLVED: 'resolved',
  DISMISSED: 'dismissed',
  FAILED: 'failed',
  TIMED_OUT: 'timed_out',
  CANCELLED: 'cancelled',
})

/** All valid status values */
const VALID_STATUSES = new Set(Object.values(STATUS))

// ---------------------------------------------------------------------------
// Core envelope fields
// ---------------------------------------------------------------------------

const REQUIRED_FIELDS = ['id', 'timestamp', 'channel', 'type', 'senderId']

const CORE_FIELDS = new Set([
  'id',
  'timestamp',
  'channel',
  'type',
  'senderId',
  'senderName',
  'body',
  'payload',
  'correlationId',
  'status',
  'inReplyTo',
])

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a message envelope. Returns { valid, errors }.
 * Domain extension fields (not in CORE_FIELDS) are passed through without validation.
 *
 * @param {object} event
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateEnvelope(event) {
  const errors = []

  if (!event || typeof event !== 'object') {
    return { valid: false, errors: ['Event must be a non-null object'] }
  }

  for (const field of REQUIRED_FIELDS) {
    if (!event[field]) {
      errors.push(`Missing required field: ${field}`)
    }
  }

  if (event.type && typeof event.type === 'string' && !event.type.includes(':')) {
    errors.push(`Event type must be namespaced (namespace:action), got: ${event.type}`)
  }

  if (event.status && !VALID_STATUSES.has(event.status)) {
    errors.push(`Invalid status: ${event.status}. Valid: ${[...VALID_STATUSES].join(', ')}`)
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Create a message envelope with defaults filled in.
 * Caller provides at minimum: channel, type, senderId.
 * Domain-specific fields are spread through as-is.
 *
 * @param {object} fields
 * @returns {object} Complete envelope
 */
export function createEnvelope(fields) {
  const id = fields.id || generateId()
  return {
    id,
    timestamp: fields.timestamp || new Date().toISOString(),
    channel: fields.channel,
    type: fields.type,
    senderId: fields.senderId,
    senderName: fields.senderName || null,
    body: fields.body || null,
    payload: fields.payload || null,
    correlationId: fields.correlationId || null,
    status: fields.status || null,
    inReplyTo: fields.inReplyTo || null,
    // Spread any domain-specific extension fields
    ...Object.fromEntries(
      Object.entries(fields).filter(([k]) => !CORE_FIELDS.has(k))
    ),
  }
}
