import { describe, it, expect } from 'vitest'
import {
  createEmptyState,
  applyStreamEvent,
  applyTimelinePage,
  beginSubmission,
  rejectSubmission,
  settleSubmission,
  classifyStreamSeq,
  itemIdentity,
  submitAcknowledged,
  AgentChatStore,
} from './agent-chat-store.js'

describe('classifyStreamSeq', () => {
  it('returns no_cursor when cursor is null', () => {
    expect(classifyStreamSeq(null, 'e1', 5)).toBe('no_cursor')
  })
  it('drops stale events with seq <= endSeq', () => {
    const cursor = { epoch: 'e1', startSeq: 1, endSeq: 10 }
    expect(classifyStreamSeq(cursor, 'e1', 10)).toBe('drop_stale')
    expect(classifyStreamSeq(cursor, 'e1', 5)).toBe('drop_stale')
  })
  it('accepts contiguous events with seq === endSeq + 1', () => {
    const cursor = { epoch: 'e1', startSeq: 1, endSeq: 10 }
    expect(classifyStreamSeq(cursor, 'e1', 11)).toBe('accept')
  })
  it('detects gap when seq > endSeq + 1', () => {
    const cursor = { epoch: 'e1', startSeq: 1, endSeq: 10 }
    expect(classifyStreamSeq(cursor, 'e1', 15)).toBe('gap')
  })
  it('drops epoch mismatch', () => {
    const cursor = { epoch: 'e1', startSeq: 1, endSeq: 10 }
    expect(classifyStreamSeq(cursor, 'e2', 11)).toBe('drop_epoch')
  })
})

describe('itemIdentity', () => {
  it('identifies user_message by clientMessageId first', () => {
    expect(itemIdentity({ type: 'user_message', clientMessageId: 'c1', messageId: 'm1' })).toBe('c1')
  })
  it('identifies tool_call by callId', () => {
    expect(itemIdentity({ type: 'tool_call', callId: 'tc1' })).toBe('tc1')
  })
  it('returns null for unknown types', () => {
    expect(itemIdentity({ type: 'notification' })).toBe(null)
  })
})

describe('applyStreamEvent', () => {
  it('applies turn_started to set turnActive', () => {
    const state = createEmptyState()
    const next = applyStreamEvent(state, { type: 'turn_started' })
    expect(next.turnActive).toBe(true)
  })
  it('flushes head on turn_completed', () => {
    let state = createEmptyState()
    state = { ...state, head: [{ type: 'assistant_message', text: 'hi' }], turnActive: true }
    const next = applyStreamEvent(state, { type: 'turn_completed' })
    expect(next.turnActive).toBe(false)
    expect(next.head).toEqual([])
  })
  it('adds permission to list', () => {
    const state = createEmptyState()
    const next = applyStreamEvent(state, { type: 'permission_requested', request: { id: 'p1', name: 'bash' } })
    expect(next.permissions).toHaveLength(1)
    expect(next.permissions[0].id).toBe('p1')
  })
  it('removes permission on resolved', () => {
    let state = createEmptyState()
    state = applyStreamEvent(state, { type: 'permission_requested', request: { id: 'p1', name: 'bash' } })
    state = applyStreamEvent(state, { type: 'permission_resolved', requestId: 'p1' })
    expect(state.permissions).toHaveLength(0)
  })
  it('resets timeline on new epoch at seq 1', () => {
    const state = { ...createEmptyState(), cursor: { epoch: 'e1', startSeq: 1, endSeq: 10 }, items: [{ type: 'user_message', text: 'old' }] }
    const next = applyStreamEvent(state, { type: 'timeline', epoch: 'e2', seq: 1, item: { type: 'user_message', text: 'new' } })
    expect(next.cursor.epoch).toBe('e2')
    expect(next.items).toEqual([])
  })
  it('drops stale timeline events', () => {
    const state = { ...createEmptyState(), cursor: { epoch: 'e1', startSeq: 1, endSeq: 10 } }
    const next = applyStreamEvent(state, { type: 'timeline', epoch: 'e1', seq: 5, item: { type: 'user_message', text: 'old' } })
    expect(next).toBe(state)
  })
  it('sets needCatchUp on gap', () => {
    const state = { ...createEmptyState(), cursor: { epoch: 'e1', startSeq: 1, endSeq: 10 } }
    const next = applyStreamEvent(state, { type: 'timeline', epoch: 'e1', seq: 20, item: { type: 'user_message', text: 'gap' } })
    expect(next.needCatchUp).toBe(true)
  })
  it('appends assistant text to head', () => {
    const state = createEmptyState()
    const next = applyStreamEvent(state, { type: 'timeline', item: { type: 'assistant_message', text: 'hello' } })
    expect(next.head).toHaveLength(1)
    expect(next.head[0].text).toBe('hello')
  })
})

describe('applyTimelinePage', () => {
  it('replaces on reset', () => {
    const state = createEmptyState()
    const page = {
      reset: true,
      epoch: 'e1',
      startCursor: { epoch: 'e1', seq: 0 },
      endCursor: { epoch: 'e1', seq: 5 },
      window: { minSeq: 1, maxSeq: 5 },
      hasOlder: false,
      entries: [{ type: 'user_message', text: 'hi' }],
    }
    const next = applyTimelinePage(state, page)
    expect(next.items).toHaveLength(1)
    expect(next.cursor).toEqual({ epoch: 'e1', startSeq: 1, endSeq: 5 })
  })
  it('discards when page adds nothing', () => {
    const state = { ...createEmptyState(), initialized: true, cursor: { epoch: 'e1', startSeq: 1, endSeq: 10 } }
    const page = {
      epoch: 'e1',
      window: { minSeq: 1, maxSeq: 10 },
      endCursor: { epoch: 'e1', seq: 10 },
      entries: [],
    }
    const next = applyTimelinePage(state, page, { direction: 'tail' })
    expect(next).toStrictEqual(state)
  })
  it('prepends older pages and updates hasOlder', () => {
    let state = createEmptyState()
    state = applyTimelinePage(state, {
      reset: true,
      epoch: 'e1',
      startCursor: { epoch: 'e1', seq: 10 },
      endCursor: { epoch: 'e1', seq: 20 },
      window: { minSeq: 10, maxSeq: 20 },
      hasOlder: true,
      entries: [{ type: 'assistant_message', text: 'second' }],
    })
    expect(state.hasOlder).toBe(true)
    const next = applyTimelinePage(state, {
      epoch: 'e1',
      startCursor: { epoch: 'e1', seq: 1 },
      endCursor: { epoch: 'e1', seq: 9 },
      window: { minSeq: 1, maxSeq: 9 },
      hasOlder: false,
      entries: [{ type: 'user_message', text: 'first' }],
    }, { direction: 'before' })
    expect(next.items).toHaveLength(2)
    expect(next.items[0].text).toBe('first')
    expect(next.hasOlder).toBe(false)
  })
})

describe('beginSubmission / settleSubmission / rejectSubmission', () => {
  it('adds optimistic user message', () => {
    const state = createEmptyState()
    const next = beginSubmission(state, 'c1', 'hello')
    expect(next.items.some((i) => i.clientMessageId === 'c1')).toBe(true)
    expect(next.submissions.some((s) => s.clientMessageId === 'c1')).toBe(true)
    expect(next.turnActive).toBe(true)
  })
  it('rejects duplicate submission', () => {
    const state = beginSubmission(createEmptyState(), 'c1', 'hello')
    expect(() => beginSubmission(state, 'c1', 'again')).toThrow()
  })
  it('removes optimistic row on reject if still unreconciled', () => {
    const state = beginSubmission(createEmptyState(), 'c1', 'hello')
    const next = rejectSubmission(state, 'c1')
    expect(next.items.some((i) => i.clientMessageId === 'c1')).toBe(false)
    expect(next.submissions.some((s) => s.clientMessageId === 'c1')).toBe(false)
  })
  it('settles submission without removing confirmed row', () => {
    let state = beginSubmission(createEmptyState(), 'c1', 'hello')
    // Simulate canonical confirmation (messageId assigned).
    state = { ...state, items: state.items.map((i) => i.clientMessageId === 'c1' ? { ...i, messageId: 'm1' } : i) }
    const next = settleSubmission(state, 'c1')
    expect(next.submissions.some((s) => s.clientMessageId === 'c1')).toBe(false)
    expect(next.items.some((i) => i.messageId === 'm1')).toBe(true)
  })
})

describe('submitAcknowledged', () => {
  it('acknowledges submissions from canonical rows', () => {
    const state = { submissions: [{ clientMessageId: 'c1' }] }
    const next = submitAcknowledged(state, [{ type: 'user_message', clientMessageId: 'c1', messageId: 'm1' }])
    expect(next).toHaveLength(0)
  })
  it('keeps unacknowledged submissions', () => {
    const state = { submissions: [{ clientMessageId: 'c1' }] }
    const next = submitAcknowledged(state, [{ type: 'user_message', clientMessageId: 'c2' }])
    expect(next).toHaveLength(1)
  })
})

describe('AgentChatStore stream delivery', () => {
  it('applies an idle stream event without waiting for a timeline fetch', () => {
    const store = new AgentChatStore({ transport: {} })
    store.enqueueStreamEvent({ type: 'turn_started' })
    expect(store.getSnapshot().turnActive).toBe(true)
    store.enqueueStreamEvent({ type: 'turn_completed' })
    expect(store.getSnapshot().turnActive).toBe(false)
  })

  it('clears an active turn when the canonical agent is idle', async () => {
    const store = new AgentChatStore({
      agentId: 'agent-1',
      transport: {
        fetchTimeline: async () => ({
          agent: { activeTurn: null },
          epoch: 'epoch-1',
          reset: true,
          window: { minSeq: 0, maxSeq: 0 },
          entries: [],
        }),
      },
    })
    store.enqueueStreamEvent({ type: 'turn_started' })
    await store.initialize()
    expect(store.getSnapshot().turnActive).toBe(false)
  })
})
