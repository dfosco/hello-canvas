import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  normalizeAutosyncScope,
  matchesAutosyncScope,
  filterFilesForAutosyncScope,
  isRetryablePushError,
  loadPersistedState,
  clearPersistedState,
} from './server.js'

describe('autosync scope helpers', () => {
  it('normalizes unknown scope to canvas', () => {
    expect(normalizeAutosyncScope('unknown')).toBe('canvas')
    expect(normalizeAutosyncScope(undefined)).toBe('canvas')
  })

  it('matches canvas scope files', () => {
    expect(matchesAutosyncScope('canvas', 'src/canvas/widgets.canvas.jsonl')).toBe(true)
    expect(matchesAutosyncScope('canvas', 'src/canvas/notes.txt')).toBe(true)
    expect(matchesAutosyncScope('canvas', 'assets/canvas/images/photo.png')).toBe(true)
    expect(matchesAutosyncScope('canvas', 'assets/canvas/snapshots/snapshot-widget--latest.webp')).toBe(true)
    expect(matchesAutosyncScope('canvas', 'assets/.storyboard-public/terminal-snapshots/agents.snapshot.json')).toBe(true)
    expect(matchesAutosyncScope('canvas', 'src/prototypes/demo/default.flow.json')).toBe(false)
  })

  it('matches prototype scope files', () => {
    expect(matchesAutosyncScope('prototype', 'src/prototypes/demo/default.flow.json')).toBe(true)
    expect(matchesAutosyncScope('prototype', 'src/canvas/widgets.canvas.jsonl')).toBe(false)
  })

  it('filters changed files by selected scope', () => {
    const files = [
      'src/canvas/board.canvas.jsonl',
      'src/prototypes/demo/default.flow.json',
      'README.md',
    ]

    expect(filterFilesForAutosyncScope('canvas', files)).toEqual([
      'src/canvas/board.canvas.jsonl',
    ])
    expect(filterFilesForAutosyncScope('prototype', files)).toEqual([
      'src/prototypes/demo/default.flow.json',
    ])
  })

  it('detects retryable push failures', () => {
    expect(isRetryablePushError('failed to push some refs')).toBe(true)
    expect(isRetryablePushError('non-fast-forward')).toBe(true)
    expect(isRetryablePushError('hint: Updates were rejected because the tip of your current branch is behind')).toBe(true)
    expect(isRetryablePushError('fetch first')).toBe(true)
    expect(isRetryablePushError('some other git error')).toBe(false)
  })
})

describe('autosync persistence', () => {
  let tmpRoot

  beforeEach(() => {
    tmpRoot = join(tmpdir(), `autosync-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(join(tmpRoot, '.storyboard'), { recursive: true })
  })

  afterEach(() => {
    try { rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  it('returns null for missing file', () => {
    expect(loadPersistedState(tmpRoot)).toBe(null)
  })

  it('returns null for corrupt JSON', () => {
    writeFileSync(join(tmpRoot, '.storyboard', 'autosync.json'), 'not json', 'utf-8')
    expect(loadPersistedState(tmpRoot)).toBe(null)
  })

  it('returns null for empty object', () => {
    writeFileSync(join(tmpRoot, '.storyboard', 'autosync.json'), '{}', 'utf-8')
    expect(loadPersistedState(tmpRoot)).toBe(null)
  })

  it('returns null when no scopes enabled', () => {
    const data = {
      targetBranch: 'feature/test',
      enabledScopes: { canvas: false, prototype: false },
    }
    writeFileSync(join(tmpRoot, '.storyboard', 'autosync.json'), JSON.stringify(data), 'utf-8')
    expect(loadPersistedState(tmpRoot)).toBe(null)
  })

  it('returns null for protected branch names', () => {
    const data = {
      targetBranch: 'main',
      enabledScopes: { canvas: true, prototype: false },
    }
    writeFileSync(join(tmpRoot, '.storyboard', 'autosync.json'), JSON.stringify(data), 'utf-8')
    expect(loadPersistedState(tmpRoot)).toBe(null)
  })

  it('loads valid persisted state', () => {
    const data = {
      targetBranch: 'feature/test',
      originalBranch: 'feature/test',
      enabledScopes: { canvas: true, prototype: false },
      pausedOnBranchChange: false,
      lastSyncTime: '2026-04-26T19:00:00.000Z',
      lastSyncByScope: { canvas: '2026-04-26T19:00:00.000Z', prototype: null },
    }
    writeFileSync(join(tmpRoot, '.storyboard', 'autosync.json'), JSON.stringify(data), 'utf-8')

    const result = loadPersistedState(tmpRoot)
    expect(result).not.toBe(null)
    expect(result.targetBranch).toBe('feature/test')
    expect(result.enabledScopes.canvas).toBe(true)
    expect(result.enabledScopes.prototype).toBe(false)
    expect(result.pausedOnBranchChange).toBe(false)
    expect(result.lastSyncTime).toBe('2026-04-26T19:00:00.000Z')
  })

  it('loads paused state with previousActiveBranch', () => {
    const data = {
      targetBranch: 'feature/test',
      originalBranch: 'feature/test',
      previousActiveBranch: 'feature/test',
      enabledScopes: { canvas: true, prototype: true },
      pausedOnBranchChange: true,
    }
    writeFileSync(join(tmpRoot, '.storyboard', 'autosync.json'), JSON.stringify(data), 'utf-8')

    const result = loadPersistedState(tmpRoot)
    expect(result.pausedOnBranchChange).toBe(true)
    expect(result.previousActiveBranch).toBe('feature/test')
    expect(result.enabledScopes.canvas).toBe(true)
    expect(result.enabledScopes.prototype).toBe(true)
  })

  it('rejects invalid branch names in persisted state', () => {
    const data = {
      targetBranch: '',
      enabledScopes: { canvas: true },
    }
    writeFileSync(join(tmpRoot, '.storyboard', 'autosync.json'), JSON.stringify(data), 'utf-8')
    expect(loadPersistedState(tmpRoot)).toBe(null)
  })

  it('clearPersistedState removes the file', () => {
    const filePath = join(tmpRoot, '.storyboard', 'autosync.json')
    writeFileSync(filePath, '{}', 'utf-8')
    expect(existsSync(filePath)).toBe(true)
    clearPersistedState(tmpRoot)
    expect(existsSync(filePath)).toBe(false)
  })

  it('clearPersistedState is safe when file does not exist', () => {
    expect(() => clearPersistedState(tmpRoot)).not.toThrow()
  })
})
