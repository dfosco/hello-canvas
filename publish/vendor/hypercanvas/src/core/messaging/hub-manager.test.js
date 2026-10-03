import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initBus, read, resetBus } from './bus.js'
import {
  getHubsForCanvas,
  inboxChannel,
  materializeHubs,
  resetHubs,
  setHubContext,
} from './hub-manager.js'
import { JsonlAdapter } from './storage/jsonl-adapter.js'

const agent = (id, alias = id) => ({
  id,
  type: 'agent',
  props: { alias, prettyName: `Pretty ${alias}`, agentId: 'codex' },
})
const edge = (id, start, end, mode = null) => ({
  id,
  start: { widgetId: start },
  end: { widgetId: end },
  meta: mode ? { messagingMode: mode } : {},
})

describe('broadcast-defined Hub materialization', () => {
  let root

  beforeEach(async () => {
    resetHubs()
    resetBus()
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-manager-'))
    const adapter = new JsonlAdapter({ root })
    await adapter.init()
    initBus(adapter)
  })

  afterEach(() => {
    resetHubs()
    resetBus()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('ignores ordinary connectors and materializes broadcast components', async () => {
    const widgets = [agent('a'), agent('b'), agent('c')]
    await materializeHubs('canvas', widgets, [
      edge('visual', 'a', 'b'),
      edge('broadcast', 'b', 'c', 'two-way'),
    ])

    const hubs = getHubsForCanvas('canvas')
    expect(hubs).toHaveLength(1)
    expect([...hubs[0].members.keys()].sort()).toEqual(['b', 'c'])
  })

  it('preserves Hub identity across membership changes and rehydration', async () => {
    const initial = [agent('a', 'architect'), agent('b', 'builder')]
    await materializeHubs('canvas', initial, [edge('ab', 'a', 'b', 'two-way')])
    const first = getHubsForCanvas('canvas')[0]
    const firstId = first.hubId

    const renamedAndExpanded = [
      agent('a', 'architect'),
      agent('b', 'builder'),
      agent('c', 'reviewer'),
    ]
    await materializeHubs('canvas', renamedAndExpanded, [
      edge('ab', 'a', 'b', 'two-way'),
      edge('bc', 'b', 'c', 'two-way'),
    ])
    const expanded = getHubsForCanvas('canvas')[0]
    expect(expanded.hubId).toBe(firstId)
    expect(expanded.context.version).toBe(2)
    expect(expanded.members.get('a').name).toBe('architect')

    resetHubs()
    await materializeHubs('canvas', renamedAndExpanded, [
      edge('ab', 'a', 'b', 'two-way'),
      edge('bc', 'b', 'c', 'two-way'),
    ])
    expect(getHubsForCanvas('canvas')[0].hubId).toBe(firstId)
  })

  it('uses deterministic maximum overlap when a Hub splits', async () => {
    const widgets = [agent('a'), agent('b'), agent('c'), agent('d')]
    await materializeHubs('canvas', widgets, [
      edge('ab', 'a', 'b', 'two-way'),
      edge('bc', 'b', 'c', 'two-way'),
      edge('cd', 'c', 'd', 'two-way'),
    ])
    const originalId = getHubsForCanvas('canvas')[0].hubId
    await setHubContext(originalId, 'a', { prompt: 'Ship the durable protocol.' })

    await materializeHubs('canvas', widgets, [
      edge('ab', 'a', 'b', 'two-way'),
      edge('cd', 'c', 'd', 'two-way'),
    ])

    const hubs = getHubsForCanvas('canvas')
    expect(hubs).toHaveLength(2)
    const retained = hubs.find((hub) => hub.hubId === originalId)
    expect([...retained.members.keys()].sort()).toEqual(['a', 'b'])
    expect(hubs.every((hub) => hub.context.prompt === 'Ship the durable protocol.')).toBe(true)
  })

  it('notifies a collaborator that leaves a still-active Hub', async () => {
    const widgets = [agent('a'), agent('b'), agent('c')]
    await materializeHubs('canvas', widgets, [
      edge('ab', 'a', 'b', 'two-way'),
      edge('bc', 'b', 'c', 'two-way'),
    ])

    await materializeHubs('canvas', widgets, [edge('ab', 'a', 'b', 'two-way')])

    const events = await read(inboxChannel('canvas', 'c'), { type: 'inbox:available' })
    expect(events.at(-1).payload).toEqual(expect.objectContaining({
      kind: 'hub-context-change',
      context: null,
      change: 'Hub membership ended',
    }))
  })

  it('retains one identity and records both origins when Hubs merge', async () => {
    const widgets = [agent('a'), agent('b'), agent('c'), agent('d')]
    await materializeHubs('canvas', widgets, [
      edge('ab', 'a', 'b', 'two-way'),
      edge('cd', 'c', 'd', 'two-way'),
    ])
    const [first, second] = getHubsForCanvas('canvas')
    await setHubContext(first.hubId, [...first.members.keys()][0], { prompt: 'First goal' })
    await setHubContext(second.hubId, [...second.members.keys()][0], { prompt: 'Second goal' })

    await materializeHubs('canvas', widgets, [
      edge('ab', 'a', 'b', 'two-way'),
      edge('bc', 'b', 'c', 'two-way'),
      edge('cd', 'c', 'd', 'two-way'),
    ])

    const merged = getHubsForCanvas('canvas')[0]
    expect([first.hubId, second.hubId]).toContain(merged.hubId)
    expect(merged.context.origins.map((origin) => origin.prompt).sort()).toEqual(['First goal', 'Second goal'])
    expect([...merged.members.keys()].sort()).toEqual(['a', 'b', 'c', 'd'])
  })
})
