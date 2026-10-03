import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildResumeStartupCommand,
  isResumableSessionId,
  watchSessionIdFile,
  captureFilePath,
  readCapturedSessionId,
  clearCaptureFile,
} from './agent-session.js'

let root
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'sb-agent-session-')) })
afterEach(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* empty */ } })

describe('agent-session', () => {
  describe('isResumableSessionId', () => {
    it('rejects non-UUID strings', () => {
      expect(isResumableSessionId('not-a-uuid')).toBe(false)
      expect(isResumableSessionId('')).toBe(false)
      expect(isResumableSessionId(null)).toBe(false)
    })

    it('accepts a valid UUID when sessionStateDir is null (no fs check)', () => {
      expect(isResumableSessionId('11111111-2222-4333-8444-555555555555', { sessionStateDir: null })).toBe(true)
    })

    it('returns false for valid UUID when state dir does not exist', () => {
      const stateDir = join(root, 'state')
      expect(isResumableSessionId('11111111-2222-4333-8444-555555555555', { sessionStateDir: stateDir })).toBe(false)
    })

    it('returns true for valid UUID when state dir exists', () => {
      const stateDir = join(root, 'state')
      const id = '11111111-2222-4333-8444-555555555555'
      const { mkdirSync } = require('node:fs')
      mkdirSync(join(stateDir, id), { recursive: true })
      expect(isResumableSessionId(id, { sessionStateDir: stateDir })).toBe(true)
    })

    it('uses sessionStateGlob to validate per-project session files (Claude shape)', () => {
      const id = '11111111-2222-4333-8444-555555555555'
      const { mkdirSync, writeFileSync } = require('node:fs')
      const projectsDir = join(root, 'projects')
      mkdirSync(join(projectsDir, '-Users-foo-some-project'), { recursive: true })
      writeFileSync(join(projectsDir, '-Users-foo-some-project', `${id}.jsonl`), '')
      expect(isResumableSessionId(id, { sessionStateGlob: `${projectsDir}/*/{id}.jsonl` })).toBe(true)
      expect(isResumableSessionId(
        '99999999-2222-4333-8444-555555555555',
        { sessionStateGlob: `${projectsDir}/*/{id}.jsonl` },
      )).toBe(false)
    })

    it('uses recursive ** in sessionStateGlob to validate nested session files (Codex shape)', () => {
      const id = '22222222-2222-4333-8444-555555555555'
      const { mkdirSync, writeFileSync } = require('node:fs')
      const sessionsRoot = join(root, 'sessions')
      mkdirSync(join(sessionsRoot, '2026', '05', '15'), { recursive: true })
      writeFileSync(join(sessionsRoot, '2026', '05', '15', `rollout-2026-05-15T10-00-00-${id}.jsonl`), '')
      expect(isResumableSessionId(id, { sessionStateGlob: `${sessionsRoot}/**/rollout-*-{id}.jsonl` })).toBe(true)
      expect(isResumableSessionId(
        '99999999-2222-4333-8444-555555555555',
        { sessionStateGlob: `${sessionsRoot}/**/rollout-*-{id}.jsonl` },
      )).toBe(false)
    })
  })

  describe('buildResumeStartupCommand', () => {
    it('returns the original command when sessionId is missing or unresumable', () => {
      expect(buildResumeStartupCommand({ startupCommand: 'copilot', sessionId: null, agentCfg: {} })).toBe('copilot')
      expect(buildResumeStartupCommand({ startupCommand: 'copilot', sessionId: 'not-uuid', agentCfg: {} })).toBe('copilot')
    })

    it('returns the original command when no resumeCommand is configured', () => {
      const out = buildResumeStartupCommand({
        startupCommand: 'copilot --agent terminal-agent',
        sessionId: '11111111-2222-4333-8444-555555555555',
        agentCfg: { sessionStateDir: null },
      })
      expect(out).toBe('copilot --agent terminal-agent')
    })

    it('substitutes {id} into resumeCommand and chains a fresh-session fallback', () => {
      const out = buildResumeStartupCommand({
        startupCommand: 'copilot --agent terminal-agent',
        sessionId: '11111111-2222-4333-8444-555555555555',
        agentCfg: {
          sessionStateDir: null,
          resumeCommand: 'copilot --resume={id} --agent terminal-agent',
        },
      })
      expect(out).toContain('copilot --resume=11111111-2222-4333-8444-555555555555 --agent terminal-agent')
      expect(out).toContain('|| {')
      expect(out).toContain('copilot --agent terminal-agent')
    })

    it('skips the fallback when resumeFallback: false', () => {
      const out = buildResumeStartupCommand({
        startupCommand: 'copilot --agent terminal-agent',
        sessionId: '11111111-2222-4333-8444-555555555555',
        agentCfg: {
          sessionStateDir: null,
          resumeCommand: 'copilot --resume={id} --agent terminal-agent',
          resumeFallback: false,
        },
      })
      expect(out).toBe('copilot --resume=11111111-2222-4333-8444-555555555555 --agent terminal-agent')
    })

    it('returns original when resumeCommand has no {id} placeholder', () => {
      const out = buildResumeStartupCommand({
        startupCommand: 'copilot --agent terminal-agent',
        sessionId: '11111111-2222-4333-8444-555555555555',
        agentCfg: { sessionStateDir: null, resumeCommand: 'copilot --resume' },
      })
      expect(out).toBe('copilot --agent terminal-agent')
    })
  })

  describe('captureFilePath / readCapturedSessionId / clearCaptureFile', () => {    it('writes to .storyboard/agent-sessions/<key>.session-id', () => {
      const cap = captureFilePath(root, 'agent-foo')
      expect(cap).toBe(join(root, '.storyboard', 'agent-sessions', 'agent-foo.session-id'))
    })

    it('reads back a captured id, trimming whitespace; null when absent', () => {
      const cap = captureFilePath(root, 'agent-foo')
      expect(readCapturedSessionId(cap)).toBeNull()
      writeFileSync(cap, '  abc-123\n')
      expect(readCapturedSessionId(cap)).toBe('abc-123')
      clearCaptureFile(cap)
      expect(existsSync(cap)).toBe(false)
    })
  })

  describe('watchSessionIdFile', () => {
    it('fires onCapture once the file appears with a non-empty value, and again when it changes', async () => {
      const cap = captureFilePath(root, 'agent-watch')
      const seen = []
      const stop = watchSessionIdFile(cap, (id) => { seen.push(id) }, { pollMs: 30 })
      await new Promise((r) => setTimeout(r, 60))
      writeFileSync(cap, 'first-id')
      await new Promise((r) => setTimeout(r, 100))
      writeFileSync(cap, 'second-id')
      await new Promise((r) => setTimeout(r, 100))
      stop()
      expect(seen).toContain('first-id')
      expect(seen).toContain('second-id')
    })
  })
})
