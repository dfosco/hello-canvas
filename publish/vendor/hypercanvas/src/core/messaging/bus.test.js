import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  initBus,
  resetBus,
  publish,
  subscribe,
  subscribeAll,
  read,
  readMulti,
  registerEventNamespace,
} from './bus.js'
import { JsonlAdapter } from './storage/jsonl-adapter.js'

describe('Messaging Bus', () => {
  let tmpDir
  let adapter

  beforeEach(async () => {
    resetBus()
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bus-test-'))
    adapter = new JsonlAdapter({ root: tmpDir })
    await adapter.init()
    initBus(adapter)
  })

  afterEach(() => {
    resetBus()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('publish', () => {
    it('throws if bus not initialized', async () => {
      resetBus()
      await expect(
        publish('ch', { type: 'message:request', senderId: 'a' })
      ).rejects.toThrow('Bus not initialized')
    })

    it('publishes an event and returns the complete envelope', async () => {
      registerEventNamespace('message', { events: ['message:request'] })
      const event = await publish('test', {
        type: 'message:request',
        senderId: 'widget-a',
        body: 'hello',
      })

      expect(event.id).toBeTruthy()
      expect(event.channel).toBe('test')
      expect(event.type).toBe('message:request')
      expect(event.senderId).toBe('widget-a')
      expect(event.body).toBe('hello')
      expect(event.timestamp).toBeTruthy()
    })

    it('persists events to storage', async () => {
      registerEventNamespace('message')
      await publish('ch', { type: 'message:request', senderId: 'a' })
      await publish('ch', { type: 'message:response', senderId: 'b' })

      const events = await read('ch')
      expect(events).toHaveLength(2)
    })

    it('rejects invalid envelopes', async () => {
      await expect(
        publish('ch', { senderId: 'a' }) // missing type
      ).rejects.toThrow('Invalid message envelope')
    })

    it('warns on unregistered namespace', async () => {
      const warns = []
      const orig = console.warn
      console.warn = (...args) => warns.push(args.join(' '))

      await publish('ch', { type: 'unknown:event', senderId: 'a' })

      console.warn = orig
      expect(warns.some((w) => w.includes('Unregistered event namespace'))).toBe(true)
    })
  })

  describe('subscribe', () => {
    it('notifies channel subscribers on publish', async () => {
      registerEventNamespace('message')
      const received = []
      subscribe('ch', (event) => received.push(event))

      await publish('ch', { type: 'message:request', senderId: 'a' })

      expect(received).toHaveLength(1)
      expect(received[0].type).toBe('message:request')
    })

    it('does not notify subscribers of other channels', async () => {
      registerEventNamespace('message')
      const received = []
      subscribe('other', (event) => received.push(event))

      await publish('ch', { type: 'message:request', senderId: 'a' })

      expect(received).toHaveLength(0)
    })

    it('returns an unsubscribe function', async () => {
      registerEventNamespace('message')
      const received = []
      const unsub = subscribe('ch', (event) => received.push(event))

      await publish('ch', { type: 'message:request', senderId: 'a' })
      unsub()
      await publish('ch', { type: 'message:response', senderId: 'b' })

      expect(received).toHaveLength(1)
    })
  })

  describe('subscribeAll', () => {
    it('receives events from all channels', async () => {
      registerEventNamespace('message')
      const received = []
      subscribeAll((channel, event) => received.push({ channel, event }))

      await publish('ch1', { type: 'message:request', senderId: 'a' })
      await publish('ch2', { type: 'message:response', senderId: 'b' })

      expect(received).toHaveLength(2)
      expect(received[0].channel).toBe('ch1')
      expect(received[1].channel).toBe('ch2')
    })
  })

  describe('read', () => {
    it('reads events from a channel', async () => {
      registerEventNamespace('message')
      await publish('ch', { type: 'message:request', senderId: 'a', body: 'first' })
      await publish('ch', { type: 'message:response', senderId: 'b', body: 'second' })

      const events = await read('ch')
      expect(events).toHaveLength(2)
      expect(events[0].body).toBe('first')
      expect(events[1].body).toBe('second')
    })

    it('supports since filter', async () => {
      registerEventNamespace('message')
      const e1 = await publish('ch', { type: 'message:request', senderId: 'a' })
      await publish('ch', { type: 'message:response', senderId: 'b' })

      const events = await read('ch', { since: e1.id })
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('message:response')
    })
  })

  describe('readMulti', () => {
    it('reads from multiple channels', async () => {
      registerEventNamespace('message')
      await publish('ch1', { type: 'message:request', senderId: 'a' })
      await publish('ch2', { type: 'message:request', senderId: 'b' })

      const result = await readMulti(['ch1', 'ch2'])
      expect(result.ch1).toHaveLength(1)
      expect(result.ch2).toHaveLength(1)
    })
  })

  describe('registerEventNamespace', () => {
    it('suppresses warnings for registered namespaces', async () => {
      const warns = []
      const orig = console.warn
      console.warn = (...args) => warns.push(args.join(' '))

      registerEventNamespace('message', { events: ['message:request'] })
      await publish('ch', { type: 'message:request', senderId: 'a' })

      console.warn = orig
      expect(warns.length).toBe(0)
    })
  })
})
