/**
 * Canvas JSONL Compaction
 *
 * Replays the event stream, then rewrites the file as a single
 * `canvas_created` event containing the current materialized state.
 * This eliminates redundant history (widgets_replaced, etc.) that
 * bloats the file over time.
 *
 * Threshold: files over 500 KB are compacted.
 */

import fs from 'node:fs'
import path from 'node:path'
import { materializeFromText, serializeEvent } from './materializer.js'

const COMPACT_THRESHOLD_BYTES = 500 * 1024

/**
 * Find all .canvas.jsonl files under src/canvas/ in the given root.
 * @param {string} root - Project root directory
 * @returns {{ name: string, filePath: string, size: number }[]}
 */
export function findCanvasFiles(root) {
  const notebookCanvasDir = path.join(root, 'canvas')
  const canvasDir = fs.existsSync(notebookCanvasDir) ? notebookCanvasDir : path.join(root, 'src', 'canvas')
  if (!fs.existsSync(canvasDir)) return []

  const results = []
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.name.endsWith('.canvas.jsonl')) {
        const rel = path.relative(canvasDir, full)
        const name = rel.replace(/\.canvas\.jsonl$/, '')
        results.push({ name, filePath: full, size: fs.statSync(full).size })
      }
    }
  }
  walk(canvasDir)
  return results
}

/**
 * Compact a single .canvas.jsonl file if it exceeds the threshold.
 * @param {string} filePath - Absolute path to the JSONL file
 * @param {{ force?: boolean }} options
 * @returns {{ compacted: boolean, before: number, after: number }}
 */
export function compactCanvas(filePath, { force = false } = {}) {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const before = Buffer.byteLength(raw, 'utf-8')

  if (!force && before < COMPACT_THRESHOLD_BYTES) {
    return { compacted: false, before, after: before }
  }

  const state = materializeFromText(raw)
  const event = { event: 'canvas_created', timestamp: new Date().toISOString(), ...state }
  const compacted = serializeEvent(event) + '\n'
  const after = Buffer.byteLength(compacted, 'utf-8')

  fs.writeFileSync(filePath, compacted, 'utf-8')
  return { compacted: true, before, after }
}

/**
 * Compact all canvas files that exceed the threshold.
 * @param {string} root - Project root directory
 * @param {{ force?: boolean }} options
 * @returns {{ name: string, before: number, after: number }[]}
 */
export function compactAll(root, { force = false } = {}) {
  const files = findCanvasFiles(root)
  const results = []
  for (const { name, filePath } of files) {
    const result = compactCanvas(filePath, { force })
    if (result.compacted) {
      results.push({ name, before: result.before, after: result.after })
    }
  }
  return results
}
