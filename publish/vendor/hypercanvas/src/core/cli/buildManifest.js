/**
 * storyboard build:manifest [outDir] — Build the per-branch artifacts.json manifest.
 */

import * as p from '@clack/prompts'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { buildArtifactManifest, resolveManifestEnv } from '../data/artifactManifest.js'
import { buildDataDiscovery } from '../../internals/vite/data-plugin.js'
import { dim, green } from './intro.js'

const arg = process.argv[3]

if (arg === '--help' || arg === '-h' || arg === 'help') {
  console.log(`\n  storyboard build:manifest [outDir]\n\n  Build per-branch artifact metadata and write <outDir>/artifacts.json.\n  Defaults to dist.\n`)
  process.exit(0)
}

const root = process.cwd()
const outDir = path.resolve(root, arg || 'dist')
const outPath = path.join(outDir, 'artifacts.json')

try {
  const discovery = buildDataDiscovery(root, { includeDraft: false })
  const env = resolveManifestEnv({ env: process.env, cwd: root })
  const manifest = buildArtifactManifest({ discovery, env })

  mkdirSync(outDir, { recursive: true })
  writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`)
  p.log.success(`${green('artifacts.json')} written to ${dim(path.relative(root, outPath) || outPath)}`)
} catch (err) {
  p.log.error(err.message || String(err))
  process.exit(1)
}
