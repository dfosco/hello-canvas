// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { initTerminalConfig, readTerminalConfigById, updateTerminalConnections, writeTerminalConfig, recordAgentSession } from './terminal-config.js'
import { writeTerminalContext } from './terminal-context.js'
import { startTerminalContext, stopTerminalContext, refreshLiveCodingTarget, acknowledgeTerminalContext } from './live-terminal-coding-target.js'
import { ensureTerminalAgentProfiles, renderNativeTerminalProfile } from './terminal-agent-profiles.js'
import { prepareTerminalCodingLaunch } from '../cli/terminal-coding-target.js'
import { appendTerminalAgentPrompt } from './terminal-coding-target.js'
import { SiteStore } from '../site/site.js'

let root, home, launch, options, submit
const identity = { widgetId: 'terminal-context-test', canvasId: 'board', branch: 'test' }
const note = (text = 'Reference data') => ({ id: 'note', type: 'sticky-note', props: { text } })
const frame = (siteId = 'site') => ({ id: siteId, type: 'site-frame', props: { siteId, route: '/checkout' } })
const read = () => readTerminalConfigById(identity.widgetId)
const connect = widgets => updateTerminalConnections({ ...identity, connectedWidgets: widgets })
const refresh = overrides => refreshLiveCodingTarget(root, identity.widgetId, { ...options, ...overrides })
const ack = revision => acknowledgeTerminalContext(root, identity.widgetId, { launchId: launch.launchId, revision }, options)

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'hc-context-test-')))
  root = join(home, 'notebook')
  mkdirSync(root)
  mkdirSync(join(root, '.agents'))
  writeFileSync(join(root, '.agents', 'terminal-agent.agent.md'), '---\nname: terminal-agent\ntools:\n  - read\n---\n# Canvas behavior')
  initTerminalConfig(root)
  writeTerminalConfig(identity)
  connect([note()])
  submit = vi.fn().mockResolvedValue({ accepted: true, submitted: true })
  options = { notify: vi.fn(), submit, sessionFor: () => 'pty-session' }
})
afterEach(() => { stopTerminalContext(root, identity.widgetId, null, options); rmSync(home, { recursive: true, force: true }) })

async function start() {
  launch = await prepareTerminalCodingLaunch(root, identity.widgetId)
  startTerminalContext(root, identity.widgetId, launch, options)
}
function site(id = 'site') {
  const directory = join(home, id)
  mkdirSync(directory)
  const store = new SiteStore(root)
  store.upsert({ id, title: id })
  store.upsertBinding(id, { root: directory })
  return directory
}

it('always bootstraps primary identity, full connected props, guidance and images in Notebook-only launches', async () => {
  connect([note('Widget context'), { id: 'image', type: 'image', props: { src: 'test.png', alt: 'Design' } }])
  launch = await prepareTerminalCodingLaunch(root, identity.widgetId)
  const snapshot = JSON.parse(readFileSync(launch.snapshotPath, 'utf8'))
  expect(launch.prompt).toContain('primary canvas terminal agent')
  expect(launch.prompt).toContain('--ack')
  expect(snapshot).toMatchObject({ ...identity, guidance: expect.stringContaining('Canvas behavior'), codingTarget: null, hubs: [] })
  expect(snapshot.connectedWidgets).toContainEqual(expect.objectContaining({ id: 'note', props: { text: 'Widget context' } }))
  expect(snapshot.connectedWidgets.find(widget => widget.id === 'image').imagePath).toBe(join(root, 'assets/canvas/images/test.png'))
  expect(launch.target).toBeNull()
})

it('uses deterministic semantic revisions and immutable inspectable snapshots', () => {
  const first = writeTerminalContext(root, read())
  updateTerminalConnections({ ...identity, connectedWidgets: [{ ...note(), props: { ...note().props, width: 300, height: 200 }, position: { x: 20 } }] })
  expect(writeTerminalContext(root, read()).revision).toBe(first.revision)
  connect([note('New content')])
  expect(writeTerminalContext(root, read()).revision).not.toBe(first.revision)
  expect(JSON.parse(readFileSync(first.snapshotPath, 'utf8')).connectedWidgets[0].props.text).toBe('Reference data')
  connect([])
  expect(writeTerminalContext(root, read()).snapshot.connectedWidgets).toEqual([])
})

it.each(['codex', 'claude', 'copilot', 'opencode', 'pi'])('provides an explicit native startup prompt for %s', async provider => {
  await start()
  const command = appendTerminalAgentPrompt(provider, provider, launch.prompt)
  expect(command).toContain(launch.snapshotPath)
  expect(command).toContain(provider === 'copilot' ? '--interactive' : provider === 'opencode' ? '--prompt' : 'Hypercanvas startup')
})

it('keeps updates pending until primary acknowledgement, never sends to shell, and stops on exit', async () => {
  await start()
  connect([note('During startup')])
  await refresh()
  expect(submit).not.toHaveBeenCalled()
  const state = await ack(launch.revision)
  expect(state.delivery).toBe('submitted')
  expect(submit).toHaveBeenCalledWith('pty-session', expect.stringContaining(state.revision), expect.objectContaining({ submit: true, paste: true }))
  expect(submit.mock.calls[0][1]).not.toContain('\n')
  await ack(state.revision)
  stopTerminalContext(root, identity.widgetId, launch.launchId, options)
  connect([note('After exit')])
  await refresh()
  expect(submit).toHaveBeenCalledTimes(1)
  await expect(ack(state.revision)).rejects.toThrow('managed launch')
})

it('coalesces changes while waiting for receipt and does not duplicate startup or unchanged context', async () => {
  await start()
  await ack(launch.revision)
  await refresh()
  expect(submit).not.toHaveBeenCalled()
  connect([note('First')])
  const first = await refresh()
  connect([note('Second')]); await refresh()
  connect([note('Third')]); await refresh()
  expect(submit).toHaveBeenCalledTimes(1)
  await ack(first.revision)
  expect(submit).toHaveBeenCalledTimes(2)
  expect(JSON.parse(readFileSync(read().contextPath, 'utf8')).connectedWidgets[0].props.text).toBe('Third')
  const state = read().contextState
  await ack(state.revision)
  expect(read().contextState.delivery).toBe('acknowledged')
  await refresh()
  expect(submit).toHaveBeenCalledTimes(2)
})

it('reports failed writes honestly and permits explicit retry', async () => {
  await start(); await ack(launch.revision)
  submit.mockRejectedValueOnce(new Error('Writer unavailable'))
  connect([note('Changed')])
  expect((await refresh()).delivery).toBe('error')
  await refresh(); expect(submit).toHaveBeenCalledTimes(1)
  expect((await refresh({ retry: true })).delivery).toBe('submitted')
})

it('pins same-Site roots, permits explicit late connections and preserves the new target for resume', async () => {
  const firstRoot = site(), secondRoot = site('second')
  await start(); await ack(launch.revision)
  recordAgentSession({ ...identity, sessionId: 'native-session', agentId: 'codex' })
  connect([frame()])
  let state = await refresh()
  expect(read().codingTarget.root).toBe(firstRoot)
  await ack(state.revision)
  new SiteStore(root).upsertBinding('site', { root: secondRoot })
  connect([frame(), note('More context')]); state = await refresh()
  expect(read().codingTarget.root).toBe(firstRoot)
  await ack(state.revision)
  connect([frame('second')]); state = await refresh()
  expect(read().codingTarget.root).toBe(secondRoot)
  expect(read().lastAgentCodingTarget.root).toBe(secondRoot)
  await ack(state.revision)
  stopTerminalContext(root, identity.widgetId, launch.launchId, options)
  const resumed = await prepareTerminalCodingLaunch(root, identity.widgetId, { resume: true })
  expect(resumed.target.root).toBe(secondRoot)
  expect(resumed.prompt).toContain('do not replay a completed initial assignment')
})

it('delivers ambiguous and missing-target context without silently rerouting source edits', async () => {
  site(); const other = site('second')
  connect([frame()]); await start(); await ack(launch.revision)
  connect([frame(), frame('second')]); let state = await refresh()
  expect(state.targetStatus).toBe('selection-required')
  expect(read().codingTarget.siteId).toBe('site')
  await ack(state.revision)
  updateTerminalConnections({ ...identity, connectedWidgets: [frame(), frame('second')], widgetProps: { codingTargetSiteId: 'second' } })
  state = await refresh()
  expect(read().codingTarget.root).toBe(other)
  await ack(state.revision)
  rmSync(other, { recursive: true }); state = await refresh()
  expect(state.targetStatus).toBe('unavailable')
  expect(read().codingTarget.root).toBe(other)
})

it('rejects stale acknowledgements and holds noninteractive sessions without PTY updates', async () => {
  await start()
  await expect(ack('unknown')).rejects.toThrow('managed launch')
  await expect(acknowledgeTerminalContext(root, identity.widgetId, { launchId: randomUUID(), revision: launch.revision }, options)).rejects.toThrow('managed launch')
  startTerminalContext(root, identity.widgetId, { ...launch, interactive: false }, options)
  await ack(launch.revision)
  connect([note('New')]); await refresh()
  expect(submit).not.toHaveBeenCalled()
})

it('renders unrestricted native tool metadata and preserves user-owned profiles', () => {
  expect(renderNativeTerminalProfile(readFileSync(join(root, '.agents', 'terminal-agent.agent.md'), 'utf8'))).not.toContain('tools:')
  mkdirSync(join(root, '.claude/agents'), { recursive: true })
  writeFileSync(join(root, '.claude/agents/terminal-agent.md'), 'User-owned profile')
  ensureTerminalAgentProfiles(root)
  expect(readFileSync(join(root, '.claude/agents/terminal-agent.md'), 'utf8')).toBe('User-owned profile')
  expect(readFileSync(join(root, '.github/agents/terminal-agent.md'), 'utf8')).toContain('Canvas behavior')
})

it('includes the explicit headless assignment and provisions shared guidance for an empty Notebook', async () => {
  rmSync(join(root, '.agents'), { recursive: true })
  const launched = await prepareTerminalCodingLaunch(root, identity.widgetId, { assignment: 'Explicit headless task' })
  expect(launched.snapshot.assignment).toBe('Explicit headless task')
  expect(launched.snapshot.guidance).toContain('Primary-session canvas bootstrap')
  expect(readFileSync(join(launched.binDirectory, 'storyboard'), 'utf8')).toContain('cli/index.js')
  expect((await refresh()).revision).toBe(launched.revision)
})


it('includes Hub membership, role and durable messaging peers in the snapshot', () => {
  updateTerminalConnections({ ...identity, connectedWidgets: [note()], role: 'leader', hubs: [{ hubId: 'hub', contextVersion: 2, role: 'leader' }], messaging: { peers: [{ widgetId: 'peer', canSend: true }] } })
  const snapshot = writeTerminalContext(root, read()).snapshot
  expect(snapshot.hubs).toEqual([{ hubId: 'hub', contextVersion: 2, role: 'leader' }])
  expect(snapshot.role).toBe('leader')
  expect(snapshot.messaging.peers[0].widgetId).toBe('peer')
  expect(snapshot.instructions).toContain('storyboard inbox poll')
})
