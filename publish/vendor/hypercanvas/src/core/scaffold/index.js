/**
 * storyboard-scaffold — sync scaffold files from @dfosco/storyboard.
 *
 * Two passes per run, driven by `packages/storyboard/scaffold/scaffold.config.json`:
 *
 *   1. Whole-file pass (`files[]`):
 *      - `mode: "scaffold"`   — copy library file to client only if target is missing
 *      - `mode: "updateable"` — always overwrite client file with library version
 *      Both call `stripLibraryMarkers()` on the source content first so library
 *      bare markers (`<!-- <id> --start-->`) never leak into client output.
 *
 *   2. Fragment-replace pass (`fragmentSources[]`):
 *      - For every client file that contains `<!-- storyboard:<src>:<id> --start-->`
 *        markers, rewrite each fragment body from the corresponding library
 *        source. Content outside markers is preserved exactly.
 *      - Scans `files[]` targets plus a curated set of well-known config files
 *        (`.gitignore`, `AGENTS.md`, `README.md`) so clients can opt in to
 *        fragment-only updates without listing the file in `files[]`.
 *
 * A one-shot legacy migration runs before pass 2: any `.gitignore` containing
 * the pre-0.6.10 ad-hoc storyboard banner is rewritten into marker form so
 * subsequent scaffolds keep it in sync.
 *
 * Backwards-compat: if `scaffold.config.json` is missing but the old
 * `manifest.json` exists, we read it and emit a deprecation warning.
 *
 * Usage:
 *   npx storyboard-scaffold                  # both passes
 *   npx storyboard-scaffold --fragments-only # skip pass 1, only rewrite fragments
 *   npx storyboard-scaffold --files-only     # skip pass 2, only copy whole files
 */

import fs from 'node:fs'
import path from 'node:path'
import { applyFragments, extractFragment, stripLibraryMarkers } from './fragments.js'
import { migrateLegacyGitignoreFile, cleanupOrphanedGitignoreFile } from './migrateLegacyGitignore.js'

const __dirname = path.dirname(new URL(import.meta.url).pathname)

// We're at packages/storyboard/src/core/scaffold/index.js — the library
// scaffold tree lives at packages/storyboard/scaffold/
const scaffoldRoot = path.resolve(__dirname, '..', '..', '..', 'scaffold')
const consumerRoot = process.cwd()

// Targets that clients commonly mark up with fragment markers but might not
// have in `files[]`. Always scanned during the fragment pass.
const WELL_KNOWN_FRAGMENT_TARGETS = ['.gitignore', 'AGENTS.md', 'README.md']

const args = new Set(process.argv.slice(2))
const filesOnly = args.has('--files-only')
const fragmentsOnly = args.has('--fragments-only')

function loadConfig() {
  const cfgPath = path.join(scaffoldRoot, 'scaffold.config.json')
  if (fs.existsSync(cfgPath)) {
    return JSON.parse(fs.readFileSync(cfgPath, 'utf-8'))
  }
  // Backcompat fallback for one release — manifest.json was the old name.
  const legacyPath = path.join(scaffoldRoot, 'manifest.json')
  if (fs.existsSync(legacyPath)) {
    console.warn(
      '  ⚠ Reading legacy scaffold/manifest.json — rename to scaffold.config.json (this fallback is removed in the next release)'
    )
    return JSON.parse(fs.readFileSync(legacyPath, 'utf-8'))
  }
  console.error('❌ Could not find scaffold/scaffold.config.json in @dfosco/storyboard')
  process.exit(1)
}

const config = loadConfig()

// ---------------------------------------------------------------------------
// FS helpers
// ---------------------------------------------------------------------------

function ensureDir(dest) {
  const dir = path.dirname(dest)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function writeStripped(srcPath, destPath) {
  ensureDir(destPath)
  const text = fs.readFileSync(srcPath, 'utf-8')
  const { text: stripped, stripped: count } = stripLibraryMarkers(text)
  fs.writeFileSync(destPath, stripped)
  if (destPath.endsWith('.sh')) fs.chmodSync(destPath, 0o755)
  return count
}

function copyFileStripped(srcPath, destPath) {
  // Binary files: just copy bytes.
  if (isLikelyBinary(srcPath)) {
    ensureDir(destPath)
    fs.copyFileSync(srcPath, destPath)
    if (destPath.endsWith('.sh')) fs.chmodSync(destPath, 0o755)
    return 0
  }
  return writeStripped(srcPath, destPath)
}

function copyDirStripped(srcDir, destDir) {
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
  let stripped = 0
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name)
    const d = path.join(destDir, entry.name)
    if (entry.isDirectory()) {
      stripped += copyDirStripped(s, d)
    } else {
      stripped += copyFileStripped(s, d)
    }
  }
  return stripped
}

function isLikelyBinary(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  return [
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.icns',
    '.woff', '.woff2', '.ttf', '.otf',
    '.zip', '.gz', '.tgz', '.tar',
    '.mp4', '.mov', '.webm',
  ].includes(ext)
}

// ---------------------------------------------------------------------------
// Pass 1: whole-file copies
// ---------------------------------------------------------------------------

function runFilesPass() {
  let created = 0
  let updated = 0
  let skipped = 0
  let strippedTotal = 0

  for (const file of config.files) {
    const srcPath = path.join(scaffoldRoot, path.relative('scaffold', file.source))
    const destPath = path.join(consumerRoot, file.target)

    if (file.directory) {
      if (file.mode === 'updateable') {
        strippedTotal += copyDirStripped(srcPath, destPath)
        updated++
        console.log(`  ✔ Updated ${file.target} (sync)`)
      } else if (!fs.existsSync(destPath)) {
        strippedTotal += copyDirStripped(srcPath, destPath)
        created++
        console.log(`  ✔ Created ${file.target} (scaffold)`)
      } else {
        skipped++
        console.log(`  ⏭ Skipped ${file.target} (already exists)`)
      }
      continue
    }

    if (file.mode === 'scaffold') {
      if (fs.existsSync(destPath)) {
        skipped++
        console.log(`  ⏭ Skipped ${file.target} (already exists)`)
      } else {
        strippedTotal += copyFileStripped(srcPath, destPath)
        created++
        console.log(`  ✔ Created ${file.target} (scaffold)`)
      }
    } else if (file.mode === 'updateable') {
      strippedTotal += copyFileStripped(srcPath, destPath)
      updated++
      console.log(`  ✔ Updated ${file.target} (sync)`)
    }
  }

  return { created, updated, skipped, strippedTotal }
}

// ---------------------------------------------------------------------------
// Pass 2: fragment-replace on client files
// ---------------------------------------------------------------------------

// Cache parsed fragment bodies per (srcRelPath, fragmentId).
const fragmentCache = new Map()

function lookupFragment(srcRelPath, fragmentId) {
  const key = `${srcRelPath}::${fragmentId}`
  if (fragmentCache.has(key)) return fragmentCache.get(key)

  // srcRelPath looks like "scaffold/gitignore". Resolve against the library
  // scaffold root which already starts with .../packages/storyboard/scaffold,
  // so we strip the leading "scaffold/" before joining.
  const rel = srcRelPath.replace(/^scaffold\//, '')
  const absPath = path.join(scaffoldRoot, rel)
  if (!fs.existsSync(absPath)) {
    fragmentCache.set(key, null)
    return null
  }
  const srcText = fs.readFileSync(absPath, 'utf-8')
  const body = extractFragment(srcText, fragmentId)
  fragmentCache.set(key, body)
  return body
}

function gatherFragmentTargets() {
  const set = new Set(WELL_KNOWN_FRAGMENT_TARGETS)
  for (const file of config.files) {
    if (file.directory) continue
    set.add(file.target)
  }
  return [...set]
}

function runFragmentsPass() {
  let synced = 0
  let unchanged = 0
  const errors = []

  for (const rel of gatherFragmentTargets()) {
    const destPath = path.join(consumerRoot, rel)
    if (!fs.existsSync(destPath)) continue
    if (isLikelyBinary(destPath)) continue

    let clientText
    try {
      clientText = fs.readFileSync(destPath, 'utf-8')
    } catch {
      continue
    }
    if (!clientText.includes('storyboard:')) continue

    try {
      const result = applyFragments(clientText, lookupFragment)
      if (result.replaced > 0) {
        fs.writeFileSync(destPath, result.text)
        synced += result.replaced
        console.log(`  ✔ Synced ${result.replaced} fragment(s) in ${rel}`)
      }
      unchanged += result.unchanged
    } catch (err) {
      errors.push({ path: rel, message: err.message })
    }
  }

  return { synced, unchanged, errors }
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

let filesStats = { created: 0, updated: 0, skipped: 0, strippedTotal: 0 }
let fragmentStats = { synced: 0, unchanged: 0, errors: [] }
let migratedLegacy = false

if (!fragmentsOnly) {
  filesStats = runFilesPass()
}

if (!filesOnly) {
  // One-shot migration of pre-0.6.10 ad-hoc gitignore banner.
  try {
    migratedLegacy = migrateLegacyGitignoreFile(path.join(consumerRoot, '.gitignore'))
    if (migratedLegacy) {
      console.log('  ✔ Migrated legacy .gitignore block to fragment markers')
    }
  } catch (err) {
    console.warn(`  ⚠ Failed to migrate legacy .gitignore: ${err.message}`)
  }

  fragmentStats = runFragmentsPass()

  // Drop storyboard-managed orphan lines left outside the marker block by
  // pre-fragment whole-file scaffolds (runs after the fragment pass so the
  // block body is current before we dedupe absorbed lines against it).
  try {
    if (cleanupOrphanedGitignoreFile(path.join(consumerRoot, '.gitignore'))) {
      console.log('  ✔ Cleaned up legacy orphan lines in .gitignore')
    }
  } catch (err) {
    console.warn(`  ⚠ Failed to clean up legacy .gitignore lines: ${err.message}`)
  }
}

console.log('')
const parts = []
if (!fragmentsOnly) {
  parts.push(`${filesStats.created} created`)
  parts.push(`${filesStats.updated} updated`)
  parts.push(`${filesStats.skipped} skipped`)
  if (filesStats.strippedTotal > 0) parts.push(`${filesStats.strippedTotal} markers stripped`)
}
if (!filesOnly) {
  parts.push(`${fragmentStats.synced} fragment(s) synced`)
  if (fragmentStats.unchanged > 0) parts.push(`${fragmentStats.unchanged} unchanged`)
}
console.log(`✔ Scaffold complete: ${parts.join(', ')}.`)

if (fragmentStats.errors.length > 0) {
  console.error('')
  console.error(`❌ ${fragmentStats.errors.length} fragment error(s):`)
  for (const e of fragmentStats.errors) {
    console.error(`   ${e.path}: ${e.message}`)
  }
  process.exit(1)
}
