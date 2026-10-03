import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findCanvasFiles } from './compact.js'

const roots = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('Notebook canvas compaction discovery', () => {
  it('discovers canvases from the content-only canvas directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-compact-notebook-'))
    roots.push(root)
    fs.mkdirSync(path.join(root, 'canvas', 'Folder'), { recursive: true })
    fs.writeFileSync(path.join(root, 'canvas', 'Folder', 'page.canvas.jsonl'), '{}\n')

    expect(findCanvasFiles(root)).toEqual([{
      name: path.join('Folder', 'page'),
      filePath: path.join(root, 'canvas', 'Folder', 'page.canvas.jsonl'),
      size: 3,
    }])
  })
})
