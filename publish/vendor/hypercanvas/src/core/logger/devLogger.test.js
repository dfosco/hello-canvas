import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createDevLogger, extractContext, pruneOldLogs, dateStamp } from './devLogger.js'

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'devlogger-test-'))
}

describe('devLogger', () => {
  let tmpRoot

  beforeEach(() => {
    tmpRoot = makeTmpDir()
  })

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  describe('createDevLogger', () => {
    it('creates the logs directory on first write', () => {
      const logger = createDevLogger({ root: tmpRoot, devDomain: 'test', branch: 'main' })
      const logsDir = path.join(tmpRoot, '.storyboard', 'logs')

      // Not created yet (lazy)
      expect(fs.existsSync(logsDir)).toBe(false)

      logger.logResponse({ status: 404, method: 'GET', url: '/_storyboard/canvas/read?name=missing', error: 'Not found' })

      expect(fs.existsSync(logsDir)).toBe(true)
    })

    it('writes JSONL entries with correct format', () => {
      const logger = createDevLogger({ root: tmpRoot, devDomain: 'test-domain', branch: 'feat-x' })

      logger.logResponse({
        status: 404,
        method: 'GET',
        url: '/_storyboard/canvas/read?name=my-canvas',
        route: 'canvas',
        subRoute: '/read',
        error: 'Canvas "my-canvas" not found',
      })

      const logsDir = path.join(tmpRoot, '.storyboard', 'logs')
      const files = fs.readdirSync(logsDir)
      expect(files).toHaveLength(1)
      expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}\.jsonl$/)

      const content = fs.readFileSync(path.join(logsDir, files[0]), 'utf-8')
      const lines = content.trim().split('\n')
      expect(lines).toHaveLength(1)

      const entry = JSON.parse(lines[0])
      expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(entry.level).toBe('warn')
      expect(entry.status).toBe(404)
      expect(entry.method).toBe('GET')
      expect(entry.route).toBe('canvas')
      expect(entry.subRoute).toBe('/read')
      expect(entry.error).toBe('Canvas "my-canvas" not found')
      expect(entry.devDomain).toBe('test-domain')
      expect(entry.branch).toBe('feat-x')
      expect(entry.context.canvas).toBe('my-canvas')
    })

    it('uses level "error" for 5xx status codes', () => {
      const logger = createDevLogger({ root: tmpRoot })
      logger.logResponse({ status: 500, method: 'POST', url: '/test', error: 'Internal error' })

      const logsDir = path.join(tmpRoot, '.storyboard', 'logs')
      const files = fs.readdirSync(logsDir)
      const entry = JSON.parse(fs.readFileSync(path.join(logsDir, files[0]), 'utf-8').trim())
      expect(entry.level).toBe('error')
    })

    it('does not log 2xx responses', () => {
      const logger = createDevLogger({ root: tmpRoot })
      logger.logResponse({ status: 200, method: 'GET', url: '/ok' })
      logger.logResponse({ status: 201, method: 'POST', url: '/created' })

      const logsDir = path.join(tmpRoot, '.storyboard', 'logs')
      expect(fs.existsSync(logsDir)).toBe(false) // never written, dir never created
    })

    it('appends multiple entries to the same day file', () => {
      const logger = createDevLogger({ root: tmpRoot })
      logger.logResponse({ status: 404, method: 'GET', url: '/a', error: 'A' })
      logger.logResponse({ status: 400, method: 'POST', url: '/b', error: 'B' })
      logger.logResponse({ status: 502, method: 'GET', url: '/c', error: 'C' })

      const logsDir = path.join(tmpRoot, '.storyboard', 'logs')
      const files = fs.readdirSync(logsDir)
      expect(files).toHaveLength(1)

      const lines = fs.readFileSync(path.join(logsDir, files[0]), 'utf-8').trim().split('\n')
      expect(lines).toHaveLength(3)
      expect(JSON.parse(lines[0]).error).toBe('A')
      expect(JSON.parse(lines[1]).error).toBe('B')
      expect(JSON.parse(lines[2]).error).toBe('C')
    })
  })

  describe('logEvent', () => {
    it('logs general events with level and message', () => {
      const logger = createDevLogger({ root: tmpRoot, devDomain: 'test' })
      logger.logEvent('warn', 'Hot pool failed to start', { poolId: 'copilot' })

      const logsDir = path.join(tmpRoot, '.storyboard', 'logs')
      const files = fs.readdirSync(logsDir)
      const entry = JSON.parse(fs.readFileSync(path.join(logsDir, files[0]), 'utf-8').trim())

      expect(entry.level).toBe('warn')
      expect(entry.message).toBe('Hot pool failed to start')
      expect(entry.context.poolId).toBe('copilot')
      expect(entry.devDomain).toBe('test')
    })
  })

  describe('extractContext', () => {
    it('extracts canvas name from ?name= query param', () => {
      const ctx = extractContext('/_storyboard/canvas/read?name=design-system')
      expect(ctx.canvas).toBe('design-system')
    })

    it('extracts prototype from ?prototype= query param', () => {
      const ctx = extractContext('/_storyboard/workshop/create?prototype=Dashboard')
      expect(ctx.prototype).toBe('Dashboard')
    })

    it('extracts page from ?page= query param', () => {
      const ctx = extractContext('/_storyboard/something?page=settings')
      expect(ctx.page).toBe('settings')
    })

    it('returns empty context for non-parseable URLs', () => {
      const ctx = extractContext('')
      expect(ctx.canvas).toBeNull()
      expect(ctx.prototype).toBeNull()
      expect(ctx.page).toBeNull()
    })

    it('returns empty context for null input', () => {
      const ctx = extractContext(null)
      expect(ctx.canvas).toBeNull()
    })
  })

  describe('dateStamp', () => {
    it('returns YYYY-MM-DD format', () => {
      const stamp = dateStamp(new Date('2026-04-25T12:00:00Z'))
      expect(stamp).toBe('2026-04-25')
    })
  })

  describe('pruneOldLogs', () => {
    it('removes log files older than 7 days', () => {
      const logsDir = path.join(tmpRoot, 'logs')
      fs.mkdirSync(logsDir, { recursive: true })

      // Create old file (10 days ago)
      const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
      const oldFile = `${dateStamp(old)}.jsonl`
      fs.writeFileSync(path.join(logsDir, oldFile), '{"test":true}\n')

      // Create recent file (today)
      const todayFile = `${dateStamp()}.jsonl`
      fs.writeFileSync(path.join(logsDir, todayFile), '{"test":true}\n')

      pruneOldLogs(logsDir)

      const remaining = fs.readdirSync(logsDir)
      expect(remaining).toContain(todayFile)
      expect(remaining).not.toContain(oldFile)
    })

    it('ignores non-jsonl files', () => {
      const logsDir = path.join(tmpRoot, 'logs')
      fs.mkdirSync(logsDir, { recursive: true })
      fs.writeFileSync(path.join(logsDir, 'readme.txt'), 'keep me')

      pruneOldLogs(logsDir)

      expect(fs.existsSync(path.join(logsDir, 'readme.txt'))).toBe(true)
    })

    it('handles non-existent directory gracefully', () => {
      expect(() => pruneOldLogs(path.join(tmpRoot, 'nonexistent'))).not.toThrow()
    })
  })
})
