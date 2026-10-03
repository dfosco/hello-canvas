import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { JsonlAdapter } from './jsonl-adapter.js'

describe('JsonlAdapter', () => {
  let tmpDir
  let adapter

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'messaging-test-'))
    adapter = new JsonlAdapter({ root: tmpDir })
    await adapter.init()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('creates the messages directory on init', () => {
    const messagesDir = path.join(tmpDir, '.storyboard', 'messages')
    expect(fs.existsSync(messagesDir)).toBe(true)
  })

  it('appends and reads events', async () => {
    const event = { id: 'msg_01', type: 'message:request', body: 'hello' }
    await adapter.append('test-channel', event)

    const events = await adapter.read('test-channel')
    expect(events).toHaveLength(1)
    expect(events[0].id).toBe('msg_01')
    expect(events[0].body).toBe('hello')
  })

  it('returns empty array for nonexistent channel', async () => {
    const events = await adapter.read('nonexistent')
    expect(events).toEqual([])
  })

  it('appends multiple events in order', async () => {
    await adapter.append('ch', { id: 'a', type: 'test:one' })
    await adapter.append('ch', { id: 'b', type: 'test:two' })
    await adapter.append('ch', { id: 'c', type: 'test:three' })

    const events = await adapter.read('ch')
    expect(events.map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })

  it('filters by since (exact match)', async () => {
    await adapter.append('ch', { id: 'a', type: 'test:x' })
    await adapter.append('ch', { id: 'b', type: 'test:x' })
    await adapter.append('ch', { id: 'c', type: 'test:x' })

    const events = await adapter.read('ch', { since: 'a' })
    expect(events.map((e) => e.id)).toEqual(['b', 'c'])
  })

  it('filters by since (lexicographic fallback)', async () => {
    await adapter.append('ch', { id: 'AAA', type: 'test:x' })
    await adapter.append('ch', { id: 'BBB', type: 'test:x' })
    await adapter.append('ch', { id: 'CCC', type: 'test:x' })

    // 'AB' doesn't exist, so falls back to string comparison
    const events = await adapter.read('ch', { since: 'AB' })
    expect(events.map((e) => e.id)).toEqual(['BBB', 'CCC'])
  })

  it('filters by type prefix', async () => {
    await adapter.append('ch', { id: 'a', type: 'message:request' })
    await adapter.append('ch', { id: 'b', type: 'hub:created' })
    await adapter.append('ch', { id: 'c', type: 'message:response' })

    const events = await adapter.read('ch', { type: 'message:' })
    expect(events.map((e) => e.id)).toEqual(['a', 'c'])
  })

  it('applies limit', async () => {
    await adapter.append('ch', { id: 'a', type: 'test:x' })
    await adapter.append('ch', { id: 'b', type: 'test:x' })
    await adapter.append('ch', { id: 'c', type: 'test:x' })

    const events = await adapter.read('ch', { limit: 2 })
    expect(events).toHaveLength(2)
    expect(events.map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('sanitizes channel names (: → --)', async () => {
    await adapter.append('proto:Main/board', { id: 'a', type: 'test:x' })
    const filePath = path.join(tmpDir, '.storyboard', 'messages', 'proto--Main', 'board.jsonl')
    expect(fs.existsSync(filePath)).toBe(true)
  })

  it('isolates channels', async () => {
    await adapter.append('ch1', { id: 'a', type: 'test:x' })
    await adapter.append('ch2', { id: 'b', type: 'test:x' })

    const ch1 = await adapter.read('ch1')
    const ch2 = await adapter.read('ch2')
    expect(ch1).toHaveLength(1)
    expect(ch2).toHaveLength(1)
    expect(ch1[0].id).toBe('a')
    expect(ch2[0].id).toBe('b')
  })

  it('skips malformed JSONL lines', async () => {
    const filePath = adapter._filePath('broken')
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, '{"id":"a","type":"test:x"}\nnot json\n{"id":"b","type":"test:y"}\n')

    const events = await adapter.read('broken')
    expect(events).toHaveLength(2)
  })
})
