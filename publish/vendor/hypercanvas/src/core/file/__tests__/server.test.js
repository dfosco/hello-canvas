import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createFileHandler, validateNotebookPath } from '../server.js'

/**
 * Build a minimal test fixture.
 */
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-file-test-'))
  const lastResponse = { status: null, body: null }
  const wsEvents = []

  const sendJson = (_res, status, body) => {
    lastResponse.status = status
    lastResponse.body = body
  }

  const mockWs = { send: (evt) => wsEvents.push(evt) }

  const handler = createFileHandler({ root, sendJson })

  function makeReq(urlPath, qs = '') {
    return { url: `/_storyboard/file${urlPath}${qs ? '?' + qs : ''}` }
  }

  const invoke = (routePath, method, body = {}, qs = '') =>
    handler(makeReq(routePath, qs), {}, { body, path: routePath, method, __viteWs: mockWs })

  const write = (relPath, content = '') => {
    const abs = path.join(root, relPath)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content, 'utf-8')
    return abs
  }

  return { root, lastResponse, wsEvents, invoke, write }
}

// ── GET /tree ─────────────────────────────────────────────────────────────────

describe('GET /tree', () => {
  let root, lastResponse, invoke, write

  beforeEach(() => {
    ({ root, lastResponse, invoke, write } = setup())
  })
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })

  it('returns a tree object', async () => {
    write('readme.md', '# hi')
    await invoke('/tree', 'GET')
    expect(lastResponse.status).toBe(200)
    expect(Array.isArray(lastResponse.body.tree)).toBe(true)
  })

  it('includes text files but not binary files', async () => {
    write('readme.md', '# hello')
    write('photo.png', '\x89PNG')
    await invoke('/tree', 'GET')
    const names = lastResponse.body.tree.map((n) => n.name)
    expect(names).toContain('readme.md')
    expect(names).not.toContain('photo.png')
  })

  it('excludes node_modules', async () => {
    write('node_modules/pkg/index.js', '')
    await invoke('/tree', 'GET')
    expect(lastResponse.body.tree.find((n) => n.name === 'node_modules')).toBeUndefined()
  })

  it('accepts root query param', async () => {
    write('src/index.js', '')
    write('other/file.md', '')
    const handler = createFileHandler({
      root,
      sendJson: (_, status, body) => {
        lastResponse.status = status
        lastResponse.body = body
      },
    })
    await handler(
      { url: '/_storyboard/file/tree?root=src' },
      {},
      { body: {}, path: '/tree', method: 'GET', __viteWs: null },
    )
    const names = lastResponse.body.tree.map((n) => n.name)
    expect(names).toContain('index.js')
    expect(names).not.toContain('other')
  })

  it('rejects traversal in root param', async () => {
    const handler = createFileHandler({
      root,
      sendJson: (_, status, body) => {
        lastResponse.status = status
        lastResponse.body = body
      },
    })
    await handler(
      { url: '/_storyboard/file/tree?root=../outside' },
      {},
      { body: {}, path: '/tree', method: 'GET', __viteWs: null },
    )
    expect(lastResponse.status).toBe(400)
  })
})

describe('Notebook content boundary', () => {
  it('allows Notebook content and metadata reads and writes', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-notebook-file-test-'))
    const lastResponse = { status: null, body: null }
    fs.mkdirSync(path.join(root, 'canvas'), { recursive: true })
    fs.mkdirSync(path.join(root, 'prototypes'), { recursive: true })
    fs.mkdirSync(path.join(root, 'prototypes', 'Landing'), { recursive: true })
    fs.mkdirSync(path.join(root, 'assets'), { recursive: true })
    fs.writeFileSync(path.join(root, 'hypercanvas.notebook.json'), '{}')
    fs.writeFileSync(path.join(root, 'canvas', 'page.canvas.jsonl'), '{}\n')
    const handler = createFileHandler({
      root,
      sendJson: (_res, status, body) => { lastResponse.status = status; lastResponse.body = body },
      validatePath: validateNotebookPath,
    })
    const request = (routePath, method, body = {}, query = '') => handler(
      { url: `/_storyboard/file${routePath}${query ? `?${query}` : ''}` },
      {},
      { body, path: routePath, method },
    )

    await request('/read', 'GET', {}, 'path=canvas%2Fpage.canvas.jsonl')
    expect(lastResponse.status, JSON.stringify(lastResponse.body)).toBe(200)
    await request('/read', 'GET', {}, 'path=hypercanvas.notebook.json')
    expect(lastResponse.status).toBe(200)
    await request('/write', 'PUT', { path: 'hypercanvas.notebook.json', content: '{"title":"Updated"}' })
    expect(lastResponse.status).toBe(200)
    await request('/write', 'PUT', { path: 'prototypes/Landing/index.jsx', content: 'export default null' })
    expect(lastResponse.status).toBe(200)
    expect(fs.readFileSync(path.join(root, 'prototypes', 'Landing', 'index.jsx'), 'utf8')).toBe('export default null')
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('rejects access to private Notebook runtime state', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-notebook-private-test-'))
    const lastResponse = { status: null, body: null }
    fs.mkdirSync(path.join(root, '.storyboard'), { recursive: true })
    fs.writeFileSync(path.join(root, '.storyboard', 'publishing.json'), '{"token":"secret"}')
    const handler = createFileHandler({
      root,
      sendJson: (_res, status, body) => { lastResponse.status = status; lastResponse.body = body },
      validatePath: validateNotebookPath,
    })

    await handler(
      { url: '/_storyboard/file/read?path=.storyboard%2Fpublishing.json' },
      {},
      { body: {}, path: '/read', method: 'GET', __viteWs: null },
    )

    expect(lastResponse.status).toBe(400)
    expect(lastResponse.body.error).toMatch(/not part of the active Notebook contract/)
    fs.rmSync(root, { recursive: true, force: true })
  })
})

// ── GET /read ─────────────────────────────────────────────────────────────────

describe('GET /read', () => {
  let root, lastResponse, write

  beforeEach(() => {
    ({ root, lastResponse, write } = setup())
  })
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })

  it('returns file content', async () => {
    write('src/hello.md', '# Hello')
    const handler = createFileHandler({
      root,
      sendJson: (_, status, body) => {
        lastResponse.status = status
        lastResponse.body = body
      },
    })
    await handler(
      { url: '/_storyboard/file/read?path=src/hello.md' },
      {},
      { body: {}, path: '/read', method: 'GET', __viteWs: null },
    )
    expect(lastResponse.status).toBe(200)
    expect(lastResponse.body.content).toBe('# Hello')
    expect(lastResponse.body.path).toBe('src/hello.md')
    expect(typeof lastResponse.body.size).toBe('number')
    expect(typeof lastResponse.body.mtime).toBe('string')
  })

  it('returns 404 for missing file', async () => {
    const handler = createFileHandler({
      root,
      sendJson: (_, status, body) => {
        lastResponse.status = status
        lastResponse.body = body
      },
    })
    await handler(
      { url: '/_storyboard/file/read?path=nonexistent.md' },
      {},
      { body: {}, path: '/read', method: 'GET', __viteWs: null },
    )
    expect(lastResponse.status).toBe(404)
  })

  it('returns 400 for path traversal', async () => {
    const handler = createFileHandler({
      root,
      sendJson: (_, status, body) => {
        lastResponse.status = status
        lastResponse.body = body
      },
    })
    await handler(
      { url: '/_storyboard/file/read?path=../outside.txt' },
      {},
      { body: {}, path: '/read', method: 'GET', __viteWs: null },
    )
    expect(lastResponse.status).toBe(400)
  })

  it('returns 400 for path inside node_modules', async () => {
    write('node_modules/pkg/secret.js', 'secret')
    const handler = createFileHandler({
      root,
      sendJson: (_, status, body) => {
        lastResponse.status = status
        lastResponse.body = body
      },
    })
    await handler(
      { url: '/_storyboard/file/read?path=node_modules/pkg/secret.js' },
      {},
      { body: {}, path: '/read', method: 'GET', __viteWs: null },
    )
    expect(lastResponse.status).toBe(400)
  })

  // Regression: vite-server-plugin passes the path including its query
  // string (e.g. `/read?path=...`) — the handler must strip the query
  // before matching against `'/read'`.
  it('matches the route when path arg includes a query string', async () => {
    write('src/hello.md', '# Hello')
    const handler = createFileHandler({
      root,
      sendJson: (_, status, body) => {
        lastResponse.status = status
        lastResponse.body = body
      },
    })
    await handler(
      { url: '/_storyboard/file/read?path=src/hello.md' },
      {},
      { body: {}, path: '/read?path=src/hello.md', method: 'GET', __viteWs: null },
    )
    expect(lastResponse.status).toBe(200)
    expect(lastResponse.body.content).toBe('# Hello')
  })
})

// ── PUT /write ────────────────────────────────────────────────────────────────

describe('PUT /write', () => {
  let root, lastResponse, wsEvents, invoke, write

  beforeEach(() => {
    ({ root, lastResponse, wsEvents, invoke, write } = setup())
  })
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })

  it('writes file and returns metadata', async () => {
    write('src/x.md', '') // ensure parent dir exists
    await invoke('/write', 'PUT', { path: 'src/x.md', content: '# Updated' })
    expect(lastResponse.status).toBe(200)
    expect(lastResponse.body.success).toBe(true)
    expect(fs.readFileSync(path.join(root, 'src/x.md'), 'utf-8')).toBe('# Updated')
  })

  it('emits a vite WS event on success', async () => {
    write('src/a.md', '')
    await invoke('/write', 'PUT', { path: 'src/a.md', content: 'new content' })
    const ev = wsEvents.find((e) => e.event === 'storyboard:file-changed')
    expect(ev).toBeDefined()
    expect(ev.data.path).toBe('src/a.md')
  })

  it('returns 404 when parent dir does not exist', async () => {
    await invoke('/write', 'PUT', { path: 'nonexistent-dir/file.md', content: 'hi' })
    expect(lastResponse.status).toBe(404)
  })

  it('returns 400 for missing content', async () => {
    await invoke('/write', 'PUT', { path: 'src/x.md' })
    expect(lastResponse.status).toBe(400)
  })

  it('returns 400 for path traversal', async () => {
    await invoke('/write', 'PUT', { path: '../outside.md', content: 'x' })
    expect(lastResponse.status).toBe(400)
  })
})

// ── POST /rename ──────────────────────────────────────────────────────────────

describe('POST /rename', () => {
  let root, lastResponse, wsEvents, invoke, write

  beforeEach(() => {
    ({ root, lastResponse, wsEvents, invoke, write } = setup())
  })
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })

  it('renames a file in the same directory', async () => {
    write('src/old.md', 'content')
    await invoke('/rename', 'POST', { from: 'src/old.md', to: 'src/new.md' })
    expect(lastResponse.status).toBe(200)
    expect(lastResponse.body.success).toBe(true)
    expect(fs.existsSync(path.join(root, 'src/old.md'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'src/new.md'))).toBe(true)
  })

  it('emits file-changed for both old and new paths', async () => {
    write('src/old.md', '')
    await invoke('/rename', 'POST', { from: 'src/old.md', to: 'src/new.md' })
    const paths = wsEvents.filter((e) => e.event === 'storyboard:file-changed').map((e) => e.data.path)
    expect(paths).toContain('src/old.md')
    expect(paths).toContain('src/new.md')
  })

  it('rejects cross-directory rename', async () => {
    write('src/file.md', '')
    await invoke('/rename', 'POST', { from: 'src/file.md', to: 'other/file.md' })
    expect(lastResponse.status).toBe(400)
    expect(lastResponse.body.error).toMatch(/same directory/)
  })

  it('returns 404 if source does not exist', async () => {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    await invoke('/rename', 'POST', { from: 'src/missing.md', to: 'src/new.md' })
    expect(lastResponse.status).toBe(404)
  })
})

// ── POST /upload ──────────────────────────────────────────────────────────────

describe('POST /upload', () => {
  let root, lastResponse, wsEvents, invoke, write

  beforeEach(() => {
    ({ root, lastResponse, wsEvents, invoke, write } = setup())
  })
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })

  it('uploads a file to default dir (created if missing)', async () => {
    await invoke('/upload', 'POST', { filename: 'notes.md', content: '# notes' })
    expect(lastResponse.status).toBe(200)
    expect(lastResponse.body.success).toBe(true)
    expect(lastResponse.body.path).toMatch(/notes\.md$/)
    expect(fs.existsSync(path.join(root, lastResponse.body.path))).toBe(true)
  })

  it('appends --N suffix on collision', async () => {
    fs.mkdirSync(path.join(root, 'src/canvas/files'), { recursive: true })
    write('src/canvas/files/notes.md', 'original')
    await invoke('/upload', 'POST', { filename: 'notes.md', content: 'copy' })
    expect(lastResponse.status).toBe(200)
    expect(lastResponse.body.path).toContain('--1')
  })

  // Regression: dragging the same file twice should NOT create
  // index--1.jsx, index--2.jsx, … if the content is identical.
  it('reuses existing path when content is byte-identical', async () => {
    fs.mkdirSync(path.join(root, 'src/canvas/files'), { recursive: true })
    write('src/canvas/files/notes.md', '# same content')
    await invoke('/upload', 'POST', { filename: 'notes.md', content: '# same content' })
    expect(lastResponse.status).toBe(200)
    expect(lastResponse.body.path).toBe('src/canvas/files/notes.md')
    expect(lastResponse.body.reused).toBe(true)
    // Should not have written a --N variant
    const entries = fs.readdirSync(path.join(root, 'src/canvas/files'))
    expect(entries).toEqual(['notes.md'])
  })

  // Regression: when an identical file already exists ANYWHERE in the
  // repo (not just the upload dir), reuse THAT path — dragging a repo
  // file back onto the canvas should open the original, not write a
  // copy to src/canvas/files/.
  it('reuses existing path anywhere in the repo when content matches', async () => {
    write('src/prototypes/Foo/index.jsx', 'export default function Foo() { return null }')
    await invoke('/upload', 'POST', { filename: 'index.jsx', content: 'export default function Foo() { return null }' })
    expect(lastResponse.status).toBe(200)
    expect(lastResponse.body.path).toBe('src/prototypes/Foo/index.jsx')
    expect(lastResponse.body.reused).toBe(true)
    // Should not have written to src/canvas/files/
    expect(fs.existsSync(path.join(root, 'src/canvas/files/index.jsx'))).toBe(false)
  })

  it('keeps an identical file in the requested project tree when global search is disabled', async () => {
    write('src/prototypes/Foo/package.json', '{"name":"Foo"}')
    await invoke('/upload', 'POST', {
      filename: 'package.json',
      content: '{"name":"Foo"}',
      destDir: 'uploads/copied-project',
      searchIdenticalFiles: false,
    })

    expect(lastResponse.status).toBe(200)
    expect(lastResponse.body.path).toBe('uploads/copied-project/package.json')
    expect(fs.readFileSync(path.join(root, lastResponse.body.path), 'utf8')).toBe('{"name":"Foo"}')
  })

  // Inverse: when content does NOT match anything in the repo, write to
  // the default upload dir as before.
  it('writes a new file to upload dir when no existing match', async () => {
    write('src/other.md', 'existing-content')
    await invoke('/upload', 'POST', { filename: 'fresh.md', content: 'brand new bytes' })
    expect(lastResponse.status).toBe(200)
    expect(lastResponse.body.path).toBe('src/canvas/files/fresh.md')
    expect(lastResponse.body.reused).toBeUndefined()
  })

  it('respects destDir option', async () => {
    fs.mkdirSync(path.join(root, 'uploads'), { recursive: true })
    await invoke('/upload', 'POST', { filename: 'data.json', content: '{}', destDir: 'uploads' })
    expect(lastResponse.status).toBe(200)
    expect(lastResponse.body.path).toMatch(/^uploads\/data\.json$/)
  })

  it('returns 400 for filename with path separators', async () => {
    await invoke('/upload', 'POST', { filename: 'dir/evil.md', content: 'x' })
    expect(lastResponse.status).toBe(400)
  })

  it('emits file-changed event', async () => {
    await invoke('/upload', 'POST', { filename: 'readme.md', content: '# hi' })
    const ev = wsEvents.find((e) => e.event === 'storyboard:file-changed')
    expect(ev).toBeDefined()
  })
})

// ── GET /exists ───────────────────────────────────────────────────────────────

describe('GET /exists', () => {
  let root, lastResponse, write

  beforeEach(() => {
    ({ root, lastResponse, write } = setup())
  })
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })

  it('returns true for existing file', async () => {
    write('src/exists.md', '')
    const handler = createFileHandler({
      root,
      sendJson: (_, status, body) => {
        lastResponse.status = status
        lastResponse.body = body
      },
    })
    await handler(
      { url: '/_storyboard/file/exists?path=src/exists.md' },
      {},
      { body: {}, path: '/exists', method: 'GET', __viteWs: null },
    )
    expect(lastResponse.status).toBe(200)
    expect(lastResponse.body.exists).toBe(true)
  })

  it('returns false for missing file', async () => {
    const handler = createFileHandler({
      root,
      sendJson: (_, status, body) => {
        lastResponse.status = status
        lastResponse.body = body
      },
    })
    await handler(
      { url: '/_storyboard/file/exists?path=nope.md' },
      {},
      { body: {}, path: '/exists', method: 'GET', __viteWs: null },
    )
    expect(lastResponse.status).toBe(200)
    expect(lastResponse.body.exists).toBe(false)
  })

  it('returns false (not 400) for disallowed path', async () => {
    write('node_modules/pkg/index.js', '')
    const handler = createFileHandler({
      root,
      sendJson: (_, status, body) => {
        lastResponse.status = status
        lastResponse.body = body
      },
    })
    await handler(
      { url: '/_storyboard/file/exists?path=node_modules/pkg/index.js' },
      {},
      { body: {}, path: '/exists', method: 'GET', __viteWs: null },
    )
    expect(lastResponse.status).toBe(200)
    expect(lastResponse.body.exists).toBe(false)
  })

  it('returns 400 for path traversal', async () => {
    const handler = createFileHandler({
      root,
      sendJson: (_, status, body) => {
        lastResponse.status = status
        lastResponse.body = body
      },
    })
    await handler(
      { url: '/_storyboard/file/exists?path=../outside' },
      {},
      { body: {}, path: '/exists', method: 'GET', __viteWs: null },
    )
    expect(lastResponse.status).toBe(400)
  })
})

// ── POST /resolve ─────────────────────────────────────────────────────────────

describe('POST /resolve', () => {
  let root, lastResponse, invoke, write

  beforeEach(() => {
    ({ root, lastResponse, invoke, write } = setup())
  })
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })

  it('rejects when body.paths is missing', async () => {
    await invoke('/resolve', 'POST', {})
    expect(lastResponse.status).toBe(400)
  })

  it('rejects when body.paths is empty', async () => {
    await invoke('/resolve', 'POST', { paths: [] })
    expect(lastResponse.status).toBe(400)
  })

  it('resolves a text file inside the repo to its rel path', async () => {
    const abs = write('src/hello.md', '# hi')
    await invoke('/resolve', 'POST', { paths: [abs] })
    expect(lastResponse.status).toBe(200)
    expect(lastResponse.body.results).toEqual([
      { ok: true, kind: 'file', path: 'src/hello.md' },
    ])
  })

  it('rejects a non-absolute path', async () => {
    await invoke('/resolve', 'POST', { paths: ['src/hello.md'] })
    expect(lastResponse.status).toBe(200)
    expect(lastResponse.body.results[0]).toMatchObject({ ok: false, reason: 'invalid' })
  })

  it('rejects a non-existent path', async () => {
    const abs = path.join(root, 'missing.md')
    await invoke('/resolve', 'POST', { paths: [abs] })
    expect(lastResponse.body.results[0]).toMatchObject({ ok: false, reason: 'not_found' })
  })

  it('rejects a directory', async () => {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    await invoke('/resolve', 'POST', { paths: [path.join(root, 'src')] })
    expect(lastResponse.body.results[0]).toMatchObject({ ok: false, reason: 'not_file' })
  })

  it('rejects a path outside the repo', async () => {
    const tmpFile = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-resolve-outside-'))
    const outsideAbs = path.join(tmpFile, 'foo.md')
    fs.writeFileSync(outsideAbs, '# outside')
    try {
      await invoke('/resolve', 'POST', { paths: [outsideAbs] })
      expect(lastResponse.body.results[0]).toMatchObject({ ok: false, reason: 'outside_repo' })
    } finally {
      fs.rmSync(tmpFile, { recursive: true, force: true })
    }
  })

  it('rejects a symlink that escapes the repo', async () => {
    const tmpFile = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-resolve-symlink-'))
    const outsideAbs = path.join(tmpFile, 'foo.md')
    fs.writeFileSync(outsideAbs, '# outside')
    const linkAbs = path.join(root, 'link.md')
    try {
      fs.symlinkSync(outsideAbs, linkAbs)
    } catch {
      // symlinks may not be supported on this platform — skip silently
      fs.rmSync(tmpFile, { recursive: true, force: true })
      return
    }
    try {
      await invoke('/resolve', 'POST', { paths: [linkAbs] })
      expect(lastResponse.body.results[0]).toMatchObject({ ok: false, reason: 'outside_repo' })
    } finally {
      fs.rmSync(tmpFile, { recursive: true, force: true })
    }
  })

  it('rejects unsupported file types', async () => {
    const abs = write('weird.xyz', 'data')
    await invoke('/resolve', 'POST', { paths: [abs] })
    expect(lastResponse.body.results[0]).toMatchObject({ ok: false, reason: 'unsupported', ext: 'xyz' })
  })

  it('copies an image into assets/canvas/images and returns its filename', async () => {
    const abs = write('src/photo.png', '\x89PNG\x00')
    await invoke('/resolve', 'POST', { paths: [abs] })
    expect(lastResponse.body.results[0]).toMatchObject({ ok: true, kind: 'image', src: 'photo.png', copied: true })
    expect(fs.existsSync(path.join(root, 'assets/canvas/images/photo.png'))).toBe(true)
  })

  it('reuses an existing identically-named, identical-content image', async () => {
    const abs = write('src/dup.png', 'PNG-BYTES')
    write('assets/canvas/images/dup.png', 'PNG-BYTES')
    await invoke('/resolve', 'POST', { paths: [abs] })
    expect(lastResponse.body.results[0]).toMatchObject({ ok: true, kind: 'image', src: 'dup.png', reused: true })
  })

  it('suffixes filename on collision with different content', async () => {
    const abs = write('src/clash.png', 'NEW')
    write('assets/canvas/images/clash.png', 'OLD')
    await invoke('/resolve', 'POST', { paths: [abs] })
    expect(lastResponse.body.results[0]).toMatchObject({ ok: true, kind: 'image', src: 'clash--1.png', copied: true })
    expect(fs.readFileSync(path.join(root, 'assets/canvas/images/clash.png'), 'utf-8')).toBe('OLD')
    expect(fs.readFileSync(path.join(root, 'assets/canvas/images/clash--1.png'), 'utf-8')).toBe('NEW')
  })

  it('returns the existing src when the image is already inside assets/canvas/images', async () => {
    const abs = write('assets/canvas/images/already.png', 'BYTES')
    await invoke('/resolve', 'POST', { paths: [abs] })
    expect(lastResponse.body.results[0]).toEqual({ ok: true, kind: 'image', src: 'already.png' })
  })

  it('handles multiple paths in one call', async () => {
    const md = write('a.md', '# a')
    const png = write('b.png', 'PNG')
    await invoke('/resolve', 'POST', { paths: [md, png, '/not/absolute/missing'] })
    expect(lastResponse.body.results).toHaveLength(3)
    expect(lastResponse.body.results[0]).toMatchObject({ ok: true, kind: 'file' })
    expect(lastResponse.body.results[1]).toMatchObject({ ok: true, kind: 'image' })
    expect(lastResponse.body.results[2]).toMatchObject({ ok: false })
  })

  it('returns the repo basename as repoName for client-side messaging', async () => {
    const abs = write('a.md', '# a')
    await invoke('/resolve', 'POST', { paths: [abs] })
    expect(lastResponse.body.repoName).toBe(path.basename(fs.realpathSync(root)))
  })
})

// ── Unknown routes ────────────────────────────────────────────────────────────

describe('unknown route', () => {
  it('returns 404', async () => {
    const lastResponse = { status: null, body: null }
    const handler = createFileHandler({
      root: os.tmpdir(),
      sendJson: (_, status, body) => {
        lastResponse.status = status
        lastResponse.body = body
      },
    })
    await handler({ url: '/_storyboard/file/bogus' }, {}, { body: {}, path: '/bogus', method: 'GET', __viteWs: null })
    expect(lastResponse.status).toBe(404)
  })
})
