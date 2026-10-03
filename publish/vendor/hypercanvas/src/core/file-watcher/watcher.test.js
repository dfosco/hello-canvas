import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { __test } from './watcher.js'

const { detectDraftsFlips, processChange, scanDirectory, rewriteFilePath } = __test

const TEST_CONFIG = {
  watch: [
    { path: 'src/prototypes', extensions: ['.jsx', '.tsx', '.mdx'], type: 'prototype' },
    { path: 'src/canvas', extensions: ['.canvas.jsonl'], type: 'canvas' },
  ],
  exclude: {
    filePrefixes: ['_'],
    directories: ['node_modules', '.git', 'dist', 'images', '.worktrees'],
  },
  debounceMs: 0,
  autocommit: { enabled: false, prefix: '[test-autofix]' },
}

/**
 * Initialise a tmp dir as a git repo so the watcher's `git add`/`git rm`
 * autocommit path doesn't blow up. We disable autocommit by default in
 * tests via the config override; this is just defensive.
 */
function makeRepoRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-watcher-test-'))
  fs.mkdirSync(path.join(root, 'src', 'canvas'), { recursive: true })
  fs.mkdirSync(path.join(root, 'src', 'prototypes'), { recursive: true })
  fs.mkdirSync(path.join(root, 'assets', 'canvas', 'images'), { recursive: true })
  // Init git so autocommit can run if needed
  try {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root, stdio: 'pipe' })
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root })
    execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: root })
  } catch { /* git may be missing in CI sandbox — flips work without */ }
  return root
}

function writeCanvasFile(absPath, widgets) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true })
  const events = [
    { event: 'canvas_created', timestamp: '2026-01-01T00:00:00Z', title: 'X', widgets: [] },
  ]
  if (widgets && widgets.length > 0) {
    events.push({ event: 'widgets_replaced', timestamp: '2026-01-01T00:00:01Z', widgets })
  }
  fs.writeFileSync(absPath, events.map((e) => JSON.stringify(e)).join('\n') + '\n')
}

function imageWidget(id, src) {
  return { id, type: 'image', props: { src, width: 100, height: 100 }, position: { x: 0, y: 0 } }
}

describe('rename-watcher: detectDraftsFlips', () => {
  it('detects a top-level canvas moving into drafts/', () => {
    const oldSet = new Set(['foo.canvas.jsonl'])
    const newSet = new Set(['drafts/foo.canvas.jsonl'])
    const flips = detectDraftsFlips(oldSet, newSet)
    expect(flips).toHaveLength(1)
    expect(flips[0]).toMatchObject({
      oldPath: 'foo.canvas.jsonl',
      newPath: 'drafts/foo.canvas.jsonl',
      oldDraft: false,
      newDraft: true,
    })
  })

  it('detects a drafts canvas moving back out to top-level', () => {
    const oldSet = new Set(['drafts/foo.canvas.jsonl'])
    const newSet = new Set(['foo.canvas.jsonl'])
    const flips = detectDraftsFlips(oldSet, newSet)
    expect(flips).toHaveLength(1)
    expect(flips[0].oldDraft).toBe(true)
    expect(flips[0].newDraft).toBe(false)
  })

  it('detects flips inside a subdirectory (widget/drafts/v6 ↔ widget/v6)', () => {
    const oldSet = new Set(['widget/v6.canvas.jsonl'])
    const newSet = new Set(['widget/drafts/v6.canvas.jsonl'])
    const flips = detectDraftsFlips(oldSet, newSet)
    expect(flips).toHaveLength(1)
    expect(flips[0].newDraft).toBe(true)
  })

  it('returns nothing when the move is purely a rename (no draft change)', () => {
    const oldSet = new Set(['foo.canvas.jsonl'])
    const newSet = new Set(['bar.canvas.jsonl'])
    expect(detectDraftsFlips(oldSet, newSet)).toEqual([])
  })

  it('returns nothing when both sides are inside drafts/', () => {
    const oldSet = new Set(['drafts/foo.canvas.jsonl'])
    const newSet = new Set(['drafts/bar.canvas.jsonl'])
    expect(detectDraftsFlips(oldSet, newSet)).toEqual([])
  })

  it('skips ambiguous flips (multiple files with the same stripped path)', () => {
    const oldSet = new Set(['foo.canvas.jsonl', 'drafts/foo.canvas.jsonl'])
    const newSet = new Set(['drafts/foo.canvas.jsonl', 'foo.canvas.jsonl'])
    // No actual changes here, but even if there were, multi-match would skip.
    expect(detectDraftsFlips(oldSet, newSet)).toEqual([])
  })

  it('ignores non-canvas files', () => {
    const oldSet = new Set(['foo.jsx', 'bar.md'])
    const newSet = new Set(['drafts/foo.jsx', 'drafts/bar.md'])
    expect(detectDraftsFlips(oldSet, newSet)).toEqual([])
  })
})

describe('rename-watcher: drafts-flip image movement (end-to-end via processChange)', () => {
  let root
  let config

  beforeEach(() => {
    root = makeRepoRoot()
    config = TEST_CONFIG
  })

  afterEach(() => {
    try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* */ }
  })

  it('moves a public image into images/drafts/ when its canvas moves into drafts', () => {
    const canvasAbs = path.join(root, 'src', 'canvas', 'foo.canvas.jsonl')
    const imagesDir = path.join(root, 'assets', 'canvas', 'images')
    fs.writeFileSync(path.join(imagesDir, 'pic.png'), Buffer.from([1, 2, 3]))
    writeCanvasFile(canvasAbs, [imageWidget('img-1', 'pic.png')])

    // Seed snapshots, then move the canvas into drafts.
    const snapshots = new Map()
    for (const entry of config.watch) snapshots.set(entry.path, scanDirectory(root, entry, config))

    const draftAbs = path.join(root, 'src', 'canvas', 'drafts', 'foo.canvas.jsonl')
    fs.mkdirSync(path.dirname(draftAbs), { recursive: true })
    fs.renameSync(canvasAbs, draftAbs)

    processChange(root, snapshots, config)

    expect(fs.existsSync(path.join(imagesDir, 'pic.png'))).toBe(false)
    expect(fs.existsSync(path.join(imagesDir, 'drafts', 'pic.png'))).toBe(true)

    // Canvas file should have a widgets_replaced event with the new src
    const text = fs.readFileSync(draftAbs, 'utf-8')
    expect(text).toContain('"src":"drafts/pic.png"')
  })

  it('moves a drafts image back to images/ when its canvas moves out of drafts', () => {
    const draftAbs = path.join(root, 'src', 'canvas', 'drafts', 'foo.canvas.jsonl')
    const imagesDir = path.join(root, 'assets', 'canvas', 'images')
    fs.mkdirSync(path.join(imagesDir, 'drafts'), { recursive: true })
    fs.writeFileSync(path.join(imagesDir, 'drafts', 'pic.png'), Buffer.from([1, 2, 3]))
    writeCanvasFile(draftAbs, [imageWidget('img-1', 'drafts/pic.png')])

    const snapshots = new Map()
    for (const entry of config.watch) snapshots.set(entry.path, scanDirectory(root, entry, config))

    const canvasAbs = path.join(root, 'src', 'canvas', 'foo.canvas.jsonl')
    fs.renameSync(draftAbs, canvasAbs)

    processChange(root, snapshots, config)

    expect(fs.existsSync(path.join(imagesDir, 'drafts', 'pic.png'))).toBe(false)
    expect(fs.existsSync(path.join(imagesDir, 'pic.png'))).toBe(true)

    const text = fs.readFileSync(canvasAbs, 'utf-8')
    // The new src is the bare basename (no drafts/ prefix)
    expect(text).toMatch(/"src":"pic\.png"/)
  })

  it('copies (not renames) a shared image when another canvas still references it', () => {
    const movedCanvas = path.join(root, 'src', 'canvas', 'foo.canvas.jsonl')
    const otherCanvas = path.join(root, 'src', 'canvas', 'other.canvas.jsonl')
    const imagesDir = path.join(root, 'assets', 'canvas', 'images')
    fs.writeFileSync(path.join(imagesDir, 'shared.png'), Buffer.from([9]))
    writeCanvasFile(movedCanvas, [imageWidget('a', 'shared.png')])
    writeCanvasFile(otherCanvas, [imageWidget('b', 'shared.png')])

    const snapshots = new Map()
    for (const entry of config.watch) snapshots.set(entry.path, scanDirectory(root, entry, config))

    const draftAbs = path.join(root, 'src', 'canvas', 'drafts', 'foo.canvas.jsonl')
    fs.mkdirSync(path.dirname(draftAbs), { recursive: true })
    fs.renameSync(movedCanvas, draftAbs)

    processChange(root, snapshots, config)

    // Source preserved (other canvas still owns it)
    expect(fs.existsSync(path.join(imagesDir, 'shared.png'))).toBe(true)
    // Copied into drafts dir for the flipping canvas
    expect(fs.existsSync(path.join(imagesDir, 'drafts', 'shared.png'))).toBe(true)
    // Only the flipping canvas's widget src updated
    const flippedText = fs.readFileSync(draftAbs, 'utf-8')
    expect(flippedText).toContain('"src":"drafts/shared.png"')
    const otherText = fs.readFileSync(otherCanvas, 'utf-8')
    expect(otherText).toContain('"src":"shared.png"')
    expect(otherText).not.toContain('"src":"drafts/shared.png"')
  })

  it('picks a unique basename when the target directory already has the same name', () => {
    const movedCanvas = path.join(root, 'src', 'canvas', 'foo.canvas.jsonl')
    const imagesDir = path.join(root, 'assets', 'canvas', 'images')
    fs.writeFileSync(path.join(imagesDir, 'pic.png'), Buffer.from([1]))
    // Pre-existing collision in target dir
    fs.mkdirSync(path.join(imagesDir, 'drafts'), { recursive: true })
    fs.writeFileSync(path.join(imagesDir, 'drafts', 'pic.png'), Buffer.from([2]))
    writeCanvasFile(movedCanvas, [imageWidget('a', 'pic.png')])

    const snapshots = new Map()
    for (const entry of config.watch) snapshots.set(entry.path, scanDirectory(root, entry, config))

    const draftAbs = path.join(root, 'src', 'canvas', 'drafts', 'foo.canvas.jsonl')
    fs.mkdirSync(path.dirname(draftAbs), { recursive: true })
    fs.renameSync(movedCanvas, draftAbs)

    processChange(root, snapshots, config)

    expect(fs.existsSync(path.join(imagesDir, 'drafts', 'pic-2.png'))).toBe(true)
    // Original pic.png in drafts/ untouched (different content from pre-existing file)
    expect(fs.readFileSync(path.join(imagesDir, 'drafts', 'pic.png'))).toEqual(Buffer.from([2]))

    const flippedText = fs.readFileSync(draftAbs, 'utf-8')
    expect(flippedText).toContain('"src":"drafts/pic-2.png"')
  })

  it('is a no-op for widgets whose images are already in the correct directory', () => {
    const canvasAbs = path.join(root, 'src', 'canvas', 'foo.canvas.jsonl')
    const imagesDir = path.join(root, 'assets', 'canvas', 'images')
    fs.mkdirSync(path.join(imagesDir, 'drafts'), { recursive: true })
    // Image lives in drafts/ even though the (about-to-move-in) canvas is public
    fs.writeFileSync(path.join(imagesDir, 'drafts', 'already.png'), Buffer.from([1]))
    writeCanvasFile(canvasAbs, [imageWidget('a', 'drafts/already.png')])

    const snapshots = new Map()
    for (const entry of config.watch) snapshots.set(entry.path, scanDirectory(root, entry, config))

    const draftAbs = path.join(root, 'src', 'canvas', 'drafts', 'foo.canvas.jsonl')
    fs.mkdirSync(path.dirname(draftAbs), { recursive: true })
    fs.renameSync(canvasAbs, draftAbs)

    processChange(root, snapshots, config)

    // File didn't move, no new widgets_replaced event with a different src
    expect(fs.existsSync(path.join(imagesDir, 'drafts', 'already.png'))).toBe(true)
    const text = fs.readFileSync(draftAbs, 'utf-8')
    // Original src is preserved
    expect(text).toContain('"src":"drafts/already.png"')
  })
})

// ─── file-ref: rewriteFilePath unit tests ────────────────────────────

describe('file-watcher: rewriteFilePath', () => {
  it('returns the original path when fileRenames is empty', () => {
    expect(rewriteFilePath('docs/foo.md', new Map())).toBe('docs/foo.md')
  })

  it('rewrites an exact-match file path', () => {
    const m = new Map([['docs/foo.md', 'docs/bar.md']])
    expect(rewriteFilePath('docs/foo.md', m)).toBe('docs/bar.md')
  })

  it('rewrites via directory-prefix when parent dir renamed', () => {
    const m = new Map([['docs/old/notes.md', 'docs/new/notes.md']])
    expect(rewriteFilePath('docs/old/untracked.md', m)).toBe('docs/new/untracked.md')
  })

  it('does NOT apply prefix matching for in-directory file renames', () => {
    // foo.md → bar.md: same dir, should not affect sibling baz.md
    const m = new Map([['docs/foo.md', 'docs/bar.md']])
    expect(rewriteFilePath('docs/baz.md', m)).toBe('docs/baz.md')
  })

  it('returns the original path when nothing matches', () => {
    const m = new Map([['docs/foo.md', 'docs/bar.md']])
    expect(rewriteFilePath('other/file.md', m)).toBe('other/file.md')
  })
})

// ─── file-ref: file widget path rewriting (end-to-end via processChange) ──

function fileWidget(id, filePath) {
  return { id, type: 'file', props: { path: filePath }, position: { x: 0, y: 0 } }
}

describe('file-watcher: file widget path rewriting (end-to-end via processChange)', () => {
  let root
  let config

  beforeEach(() => {
    root = makeRepoRoot()
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true })
    config = {
      ...TEST_CONFIG,
      watch: [
        ...TEST_CONFIG.watch,
        { path: 'docs', extensions: ['.md', '.txt'], type: 'file-ref' },
      ],
    }
  })

  afterEach(() => {
    try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* */ }
  })

  it('updates a file widget path when the referenced file is renamed', () => {
    fs.writeFileSync(path.join(root, 'docs', 'foo.md'), '# Foo')

    const canvasAbs = path.join(root, 'src', 'canvas', 'my.canvas.jsonl')
    writeCanvasFile(canvasAbs, [fileWidget('fw-1', 'docs/foo.md')])

    const snapshots = new Map()
    for (const entry of config.watch) snapshots.set(entry.path, scanDirectory(root, entry, config))

    fs.renameSync(path.join(root, 'docs', 'foo.md'), path.join(root, 'docs', 'bar.md'))
    processChange(root, snapshots, config)

    const text = fs.readFileSync(canvasAbs, 'utf-8')
    const lines = text.trim().split('\n')
    const lastEvent = JSON.parse(lines[lines.length - 1])
    expect(lastEvent.event).toBe('widgets_replaced')
    expect(lastEvent.widgets[0].props.path).toBe('docs/bar.md')
  })

  it('updates a file widget path when the parent directory is renamed', () => {
    fs.mkdirSync(path.join(root, 'docs', 'old'), { recursive: true })
    fs.writeFileSync(path.join(root, 'docs', 'old', 'notes.md'), '# Notes')

    const canvasAbs = path.join(root, 'src', 'canvas', 'my.canvas.jsonl')
    writeCanvasFile(canvasAbs, [fileWidget('fw-2', 'docs/old/notes.md')])

    const snapshots = new Map()
    for (const entry of config.watch) snapshots.set(entry.path, scanDirectory(root, entry, config))

    fs.mkdirSync(path.join(root, 'docs', 'new'), { recursive: true })
    fs.renameSync(path.join(root, 'docs', 'old', 'notes.md'), path.join(root, 'docs', 'new', 'notes.md'))
    fs.rmdirSync(path.join(root, 'docs', 'old'))

    processChange(root, snapshots, config)

    const text = fs.readFileSync(canvasAbs, 'utf-8')
    const lines = text.trim().split('\n')
    const lastEvent = JSON.parse(lines[lines.length - 1])
    expect(lastEvent.event).toBe('widgets_replaced')
    expect(lastEvent.widgets[0].props.path).toBe('docs/new/notes.md')
  })

  it('leaves a file widget unchanged when its path does not match any rename', () => {
    fs.writeFileSync(path.join(root, 'docs', 'foo.md'), '# Foo')
    fs.writeFileSync(path.join(root, 'docs', 'baz.md'), '# Baz')

    const canvasAbs = path.join(root, 'src', 'canvas', 'my.canvas.jsonl')
    writeCanvasFile(canvasAbs, [fileWidget('fw-3', 'docs/baz.md')])

    const snapshots = new Map()
    for (const entry of config.watch) snapshots.set(entry.path, scanDirectory(root, entry, config))

    // Rename foo.md — the widget references baz.md, which is untouched
    fs.renameSync(path.join(root, 'docs', 'foo.md'), path.join(root, 'docs', 'bar.md'))
    processChange(root, snapshots, config)

    const text = fs.readFileSync(canvasAbs, 'utf-8')
    expect(text).toContain('"path":"docs/baz.md"')
    // No new widgets_replaced event should have been appended for this canvas
    const lines = text.trim().split('\n')
    expect(lines).toHaveLength(2) // canvas_created + original widgets_replaced only
  })

  it('leaves a file widget with an empty or missing props.path unchanged', () => {
    fs.writeFileSync(path.join(root, 'docs', 'foo.md'), '# Foo')

    const widgets = [
      { id: 'fw-4a', type: 'file', props: { path: '' }, position: { x: 0, y: 0 } },
      { id: 'fw-4b', type: 'file', props: {}, position: { x: 0, y: 0 } },
    ]
    const canvasAbs = path.join(root, 'src', 'canvas', 'my.canvas.jsonl')
    writeCanvasFile(canvasAbs, widgets)

    const snapshots = new Map()
    for (const entry of config.watch) snapshots.set(entry.path, scanDirectory(root, entry, config))

    fs.renameSync(path.join(root, 'docs', 'foo.md'), path.join(root, 'docs', 'bar.md'))
    processChange(root, snapshots, config)

    // No new widgets_replaced event for empty/missing paths
    const text = fs.readFileSync(canvasAbs, 'utf-8')
    const lines = text.trim().split('\n')
    expect(lines).toHaveLength(2) // canvas_created + original widgets_replaced only
  })
})
