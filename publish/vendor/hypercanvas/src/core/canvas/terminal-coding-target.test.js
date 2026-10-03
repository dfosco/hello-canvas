// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, realpathSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { SiteStore } from '../site/site.js'
import { initTerminalConfig, preReserveTerminalIdentity, writeTerminalConfig, updateTerminalConnections, readTerminalConfigById, recordAgentSession } from './terminal-config.js'
import { appendTerminalAgentPrompt, resolveTerminalCodingTargets, selectTerminalCodingTarget, validateBoundCodingTarget } from './terminal-coding-target.js'
import { prepareTerminalCodingLaunch } from '../cli/terminal-coding-target.js'

let home, root, site, store
const identity = { branch: 'test', canvasId: 'board', widgetId: 'terminal-target-test' }
const frame = (id, siteId = 'docs', route = '') => ({ id, type: 'site-frame', props: { siteId, route, root: '/untrusted-frame-root' } })

function connect(widgets, props = {}) {
  updateTerminalConnections({ ...identity, connectedWidgets: widgets, widgetProps: props })
}

beforeEach(() => {
  home = realpathSync.native(mkdtempSync(join(tmpdir(), 'hc-coding-target-')))
  root = join(home, 'notebook')
  site = join(home, 'external site')
  mkdirSync(root)
  mkdirSync(site)
  initTerminalConfig(root)
  writeTerminalConfig(identity)
  store = new SiteStore(root)
  store.upsert({ id: 'docs', title: 'Documentation' })
  store.upsertBinding('docs', { source: 'managed', root: site, startCommand: 'npm run dev' })
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

describe('terminal coding targets', () => {
  it('preserves pre-reserved canvas context when Core and Notebook branches differ', async () => {
    const widgetId = 'terminal-prereserved'
    preReserveTerminalIdentity({ widgetId, branch: 'unknown', canvasId: 'board', widgetProps: { initialPrompt: 'Site task' } })
    updateTerminalConnections({ widgetId, branch: 'unknown', canvasId: 'board', connectedWidgets: [frame('first')] })
    await prepareTerminalCodingLaunch(root, widgetId)
    expect(readTerminalConfigById(widgetId).codingTarget.root).toBe(site)
    writeTerminalConfig({ widgetId, branch: 'core-branch', canvasId: 'board' })
    const launched = await prepareTerminalCodingLaunch(root, widgetId)
    expect(launched.target.root).toBe(site)
    updateTerminalConnections({ widgetId, branch: 'unknown', canvasId: 'board', connectedWidgets: [frame('changed')] })
    expect(readTerminalConfigById(widgetId).connectedWidgets[0].id).toBe('changed')
    expect(readTerminalConfigById(widgetId).codingTarget.frames[0].widgetId).toBe('first')
  })
  it('deduplicates Frames, retains route context, and ignores arbitrary Frame paths', () => {
    const original = readFileSync(store.configPath, 'utf8')
    const candidates = resolveTerminalCodingTargets(root, { connectedWidgets: [frame('a', 'docs', '/one'), frame('b', 'docs', '/two'), { type: 'image' }] })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ root: site, title: 'Documentation', frames: [{ widgetId: 'a', route: '/one' }, { widgetId: 'b', route: '/two' }] })
    expect(readFileSync(store.configPath, 'utf8')).toBe(original)
    expect(selectTerminalCodingTarget(candidates)).toEqual(candidates[0])
  })

  it('preserves Notebook-only launches and permits explicit Notebook selection', () => {
    expect(resolveTerminalCodingTargets(root, null)).toEqual([])
    expect(selectTerminalCodingTarget([])).toBeNull()
    expect(selectTerminalCodingTarget([{ siteId: 'bad', error: 'Unavailable' }], '')).toBeNull()
  })

  it('requires selection for distinct Sites and rejects stale preferences', () => {
    const targets = [{ siteId: 'one', root: site }, { siteId: 'two', root: site }]
    expect(() => selectTerminalCodingTarget(targets)).toThrow('Several Sites')
    expect(selectTerminalCodingTarget(targets, 'two')).toEqual(targets[1])
    expect(() => selectTerminalCodingTarget(targets, 'removed')).toThrow('not connected')
  })

  it('reports URL-only, missing, absent and non-directory Site sources without fallback', () => {
    store.upsert({ id: 'url', title: 'Remote' })
    store.upsertBinding('url', { source: 'url', developmentBaseUrl: 'http://localhost:9999' })
    writeFileSync(join(home, 'file'), 'file')
    store.upsert({ id: 'file' })
    store.upsertBinding('file', { source: 'managed', root: join(home, 'file') })
    rmSync(site, { recursive: true })
    const candidates = resolveTerminalCodingTargets(root, { connectedWidgets: [frame('u', 'url'), frame('m', 'missing'), frame('d'), frame('f', 'file')] })
    expect(candidates.every(target => target.root === null && target.error)).toBe(true)
    for (const target of candidates) expect(() => selectTerminalCodingTarget([target])).toThrow()
  })

  it('rejects a Site bound inside Notebook', () => {
    store.upsertBinding('docs', { source: 'managed', root })
    expect(resolveTerminalCodingTargets(root, { connectedWidgets: [frame('a')] })[0].error).toContain('outside the Notebook')
  })

  it('captures the native target and preserves it when bindings and connectors change', async () => {
    connect([frame('a')])
    const first = await prepareTerminalCodingLaunch(root, identity.widgetId)
    recordAgentSession({ ...identity, agentId: 'codex', sessionId: '11111111-1111-4111-8111-111111111111' })
    const moved = join(home, 'moved-site')
    mkdirSync(moved)
    store.upsertBinding('docs', { source: 'managed', root: moved })
    connect([], { codingTargetSiteId: '' })
    const resumed = await prepareTerminalCodingLaunch(root, identity.widgetId, { resume: true })
    expect(resumed.target.root).toBe(first.target.root)
    expect(resumed.prompt).toContain('do not replay a completed initial assignment')
    expect(readTerminalConfigById(identity.widgetId).workingDirectory).toBe(root)
    const newSession = await prepareTerminalCodingLaunch(root, identity.widgetId)
    expect(newSession.target).toBeNull()
    // Starting a fresh process must not overwrite the previous native ID's target.
    expect(readTerminalConfigById(identity.widgetId).lastAgentCodingTarget.root).toBe(site)
  })

  it('refuses missing or redirected pinned directories on resume', async () => {
    connect([frame('a')])
    await prepareTerminalCodingLaunch(root, identity.widgetId)
    recordAgentSession({ ...identity, sessionId: 'old-native-session' })
    rmSync(site, { recursive: true })
    await expect(prepareTerminalCodingLaunch(root, identity.widgetId, { resume: true })).rejects.toThrow('Bound coding target')
    symlinkSync(root, site)
    expect(() => validateBoundCodingTarget({ root: site, siteId: 'docs' })).toThrow('unavailable')
  })

  it('requires a choice and persists it before an ambiguous launch', async () => {
    const other = join(home, 'other')
    mkdirSync(other)
    store.upsert({ id: 'other' })
    store.upsertBinding('other', { source: 'managed', root: other })
    connect([frame('a'), frame('b', 'other')])
    await expect(prepareTerminalCodingLaunch(root, identity.widgetId)).rejects.toThrow('Several Sites')
    const save = vi.fn().mockResolvedValue(undefined)
    const chosen = await prepareTerminalCodingLaunch(root, identity.widgetId, { choose: async () => 'other', savePreference: save })
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ widgetId: identity.widgetId }), 'other')
    expect(chosen.target.root).toBe(other)
    await expect(prepareTerminalCodingLaunch(root, identity.widgetId, { choose: async () => undefined, savePreference: save })).rejects.toThrow('cancelled')
  })

  it('writes guidance only in Notebook and keeps source state live', async () => {
    connect([frame('a')], { initialPrompt: 'Implement the connected Site page.' })
    const { promptFile, prompt } = await prepareTerminalCodingLaunch(root, identity.widgetId)
    const text = readFileSync(promptFile, 'utf8')
    expect(text).toContain(JSON.stringify(root))
    expect(text).toContain(JSON.stringify(site))
    expect(text).toContain('applicable AGENTS.md')
    expect(text).toContain('git -C')
    expect(text).toContain('Implement the connected Site page.')
    expect(prompt).toContain(promptFile)
    expect(existsSync(join(site, '.storyboard'))).toBe(false)
    connect([frame('new', 'docs', '/latest')])
    expect(readTerminalConfigById(identity.widgetId).connectedWidgets[0].props.route).toBe('/latest')
    expect(readTerminalConfigById(identity.widgetId).codingTarget.frames[0].widgetId).toBe('a')
  })

  it('uses interactive native prompt flags and quotes shell metacharacters', () => {
    const script = join(home, 'args.mjs')
    writeFileSync(script, 'console.log(JSON.stringify(process.argv.slice(2)))')
    const sentinel = join(home, 'injected')
    const prompt = `Read '${site}'; $(touch ${sentinel}); \`touch ${sentinel}\``
    const command = appendTerminalAgentPrompt(`${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`, 'codex', prompt)
    expect(JSON.parse(execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8' }))).toEqual([prompt])
    expect(existsSync(sentinel)).toBe(false)
    expect(appendTerminalAgentPrompt('copilot', 'copilot', 'Read context')).toContain('--interactive')
    expect(appendTerminalAgentPrompt('opencode', 'opencode', 'Read context')).toContain('--prompt')
    expect(appendTerminalAgentPrompt(null, 'codex', 'Read context')).toBeNull()
  })
})
