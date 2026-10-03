import { describe, it, expect } from 'vitest'
import { generateId, validateEnvelope, createEnvelope, STATUS } from './schema.js'

describe('generateId (ULID)', () => {
  it('returns a 26-character string', () => {
    const id = generateId()
    expect(id).toHaveLength(26)
  })

  it('uses Crockford Base32 characters only', () => {
    const id = generateId()
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
  })

  it('generates monotonically increasing IDs', () => {
    const ids = Array.from({ length: 100 }, () => generateId())
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i] > ids[i - 1]).toBe(true)
    }
  })

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateId()))
    expect(ids.size).toBe(1000)
  })
})

describe('STATUS constants', () => {
  it('has all expected statuses', () => {
    expect(STATUS.PENDING).toBe('pending')
    expect(STATUS.ACKNOWLEDGED).toBe('acknowledged')
    expect(STATUS.RESOLVED).toBe('resolved')
    expect(STATUS.DISMISSED).toBe('dismissed')
    expect(STATUS.FAILED).toBe('failed')
    expect(STATUS.TIMED_OUT).toBe('timed_out')
    expect(STATUS.CANCELLED).toBe('cancelled')
  })

  it('is frozen', () => {
    expect(Object.isFrozen(STATUS)).toBe(true)
  })
})

describe('validateEnvelope', () => {
  const validEvent = {
    id: 'msg_01HXYZ',
    timestamp: '2026-05-02T18:00:00.000Z',
    channel: 'test-canvas',
    type: 'message:request',
    senderId: 'widget-a',
  }

  it('validates a minimal valid envelope', () => {
    const { valid, errors } = validateEnvelope(validEvent)
    expect(valid).toBe(true)
    expect(errors).toHaveLength(0)
  })

  it('rejects null/undefined', () => {
    expect(validateEnvelope(null).valid).toBe(false)
    expect(validateEnvelope(undefined).valid).toBe(false)
  })

  it('rejects missing required fields', () => {
    const { valid, errors } = validateEnvelope({ id: 'x' })
    expect(valid).toBe(false)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some((e) => e.includes('channel'))).toBe(true)
  })

  it('rejects non-namespaced type', () => {
    const { valid, errors } = validateEnvelope({ ...validEvent, type: 'nonamespace' })
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('namespaced'))).toBe(true)
  })

  it('rejects invalid status', () => {
    const { valid, errors } = validateEnvelope({ ...validEvent, status: 'bogus' })
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('Invalid status'))).toBe(true)
  })

  it('accepts valid status values', () => {
    for (const status of Object.values(STATUS)) {
      const { valid } = validateEnvelope({ ...validEvent, status })
      expect(valid).toBe(true)
    }
  })
})

describe('createEnvelope', () => {
  it('fills in id and timestamp when not provided', () => {
    const env = createEnvelope({
      channel: 'test',
      type: 'message:request',
      senderId: 'widget-a',
    })
    expect(env.id).toBeTruthy()
    expect(env.timestamp).toBeTruthy()
    expect(env.channel).toBe('test')
  })

  it('preserves provided id and timestamp', () => {
    const env = createEnvelope({
      id: 'custom-id',
      timestamp: '2026-01-01T00:00:00Z',
      channel: 'test',
      type: 'message:request',
      senderId: 'widget-a',
    })
    expect(env.id).toBe('custom-id')
    expect(env.timestamp).toBe('2026-01-01T00:00:00Z')
  })

  it('defaults optional fields to null', () => {
    const env = createEnvelope({
      channel: 'test',
      type: 'message:request',
      senderId: 'widget-a',
    })
    expect(env.body).toBeNull()
    expect(env.payload).toBeNull()
    expect(env.correlationId).toBeNull()
    expect(env.status).toBeNull()
    expect(env.inReplyTo).toBeNull()
    expect(env.senderName).toBeNull()
  })

  it('passes through domain-specific extension fields', () => {
    const env = createEnvelope({
      channel: 'test',
      type: 'message:request',
      senderId: 'widget-a',
      hubId: 'hub_abc',
      conversationId: 'conv_01',
      messageTokens: [{ widgetId: 'b', order: 0, status: 'pending' }],
    })
    expect(env.hubId).toBe('hub_abc')
    expect(env.conversationId).toBe('conv_01')
    expect(env.messageTokens).toHaveLength(1)
  })
})
