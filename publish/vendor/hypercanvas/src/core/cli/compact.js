/**
 * storyboard compact — Compact canvas JSONL files to reduce bloat.
 *
 * Usage:
 *   storyboard compact                 Compact all canvases over 500KB
 *   storyboard compact --all           Compact all canvases (force)
 *   storyboard compact folder/page     Compact a specific canvas
 */

import * as p from '@clack/prompts'
import { compactAll, compactCanvas, findCanvasFiles } from '../canvas/compact.js'
import { resolveNotebookRoot } from './filesystemRoots.js'

const dim = (s) => `\x1b[2m${s}\x1b[0m`
const green = (s) => `\x1b[32m${s}\x1b[0m`
const bold = (s) => `\x1b[1m${s}\x1b[0m`

function formatKB(bytes) {
  return `${(bytes / 1024).toFixed(0)}KB`
}

const root = resolveNotebookRoot()
const args = process.argv.slice(3)
const forceAll = args.includes('--all')
const target = args.find(a => !a.startsWith('--'))

if (target) {
  // Compact a specific canvas
  const files = findCanvasFiles(root)
  const match = files.find(f => f.name === target)
  if (!match) {
    p.log.error(`Canvas "${target}" not found.`)
    const available = files.map(f => `  ${f.name}`).join('\n')
    if (available) p.log.info(`Available canvases:\n${available}`)
    process.exit(1)
  }

  const result = compactCanvas(match.filePath, { force: true })
  if (result.compacted) {
    p.log.success(`${bold(target)}: ${formatKB(result.before)} → ${formatKB(result.after)} ${dim(`(${((1 - result.after / result.before) * 100).toFixed(0)}% reduced)`)}`)
  } else {
    p.log.info(`${target}: already compact (${formatKB(result.before)})`)
  }
} else {
  // Compact all
  const files = findCanvasFiles(root)
  if (files.length === 0) {
    p.log.info('No canvas files found.')
    process.exit(0)
  }

  const results = compactAll(root, { force: forceAll })
  if (results.length === 0) {
    const total = files.length
    const sizes = files.map(f => formatKB(f.size)).join(', ')
    p.log.info(`All ${total} canvases are under threshold. ${dim(`(${sizes})`)}`)
  } else {
    for (const r of results) {
      p.log.success(`${bold(r.name)}: ${formatKB(r.before)} → ${formatKB(r.after)} ${dim(`(${((1 - r.after / r.before) * 100).toFixed(0)}% reduced)`)}`)
    }
    p.log.info(green(`Compacted ${results.length} canvas${results.length === 1 ? '' : 'es'}.`))
  }
}
