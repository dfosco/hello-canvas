/**
 * Durable Notebook-owned storage for Frame snapshots.
 *
 * Layout (portable Notebook content):
 *   assets/canvas/snapshots/frames/<sourceKey>/manifest.json
 *   assets/canvas/snapshots/frames/<sourceKey>/<digest>-light.png
 *   assets/canvas/snapshots/frames/<sourceKey>/<digest>-dark.png
 *
 * Private, runtime-only freshness/error metadata:
 *   .storyboard/frame-captures/<sourceKey>.json
 *
 * Writes are atomic: image bytes are validated, written to a temporary file,
 * renamed into place, and only then is the manifest atomically replaced. The
 * manifest is the single source of truth for which images are live; older
 * image files are pruned once unreferenced and past a grace period so
 * concurrent readers never observe a missing referenced file.
 */

import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import process from 'node:process'
import { FRAME_SNAPSHOT_FORMAT_VERSION } from './frameSnapshotContract.js'
import { resolveNotebookPath, resolveNotebookRuntimePath } from '../notebook/runtime.js'

const FRAMES_DIR = 'assets/canvas/snapshots/frames'
const CAPTURE_META_DIR = 'frame-captures'
const IMAGE_GRACE_MS = 5 * 60 * 1000
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const MAX_IMAGE_BYTES = 12 * 1024 * 1024

function snapshotError(code, message) {
  return Object.assign(new Error(message), { code })
}

function assertSourceKey(sourceKey) {
  if (!/^[0-9a-f]{32}$/.test(String(sourceKey || ''))) throw snapshotError('FRAME_SNAPSHOT_KEY_INVALID', 'Invalid Frame snapshot key')
  return sourceKey
}

function assertVariant(variant) {
  if (variant !== 'light' && variant !== 'dark') throw snapshotError('FRAME_SNAPSHOT_VARIANT_INVALID', 'Frame snapshot variant must be light or dark')
  return variant
}

function frameDir(notebookRoot, sourceKey) {
  return resolveNotebookPath(notebookRoot, `${FRAMES_DIR}/${assertSourceKey(sourceKey)}`)
}

function captureMetaPath(notebookRoot, sourceKey) {
  return resolveNotebookRuntimePath(notebookRoot, `${CAPTURE_META_DIR}/${assertSourceKey(sourceKey)}.json`)
}

/** Read PNG pixel dimensions from the IHDR chunk, or null for invalid data. */
export function readPngSize(image) {
  const buffer = Buffer.isBuffer(image) ? image : Buffer.from(image || [])
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

async function atomicWrite(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.tmp`)
  await fs.writeFile(temporary, data)
  await fs.rename(temporary, filePath)
}

async function readManifest(notebookRoot, sourceKey) {
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(frameDir(notebookRoot, sourceKey), 'manifest.json'), 'utf8'))
    return manifest?.formatVersion === FRAME_SNAPSHOT_FORMAT_VERSION ? manifest : null
  } catch { return null }
}

function imageEntry(manifest, variant) {
  const entry = manifest?.images?.[variant]
  return entry && typeof entry.file === 'string' && /^[0-9a-f]{32}$/.test(entry.digest) ? entry : null
}

function dataUrl(buffer) { return `data:image/png;base64,${buffer.toString('base64')}` }

/**
 * Read the live snapshot descriptor for one target: data URLs for each
 * captured theme variant plus a status. Never throws for missing or corrupt
 * assets — absent previews surface as status 'missing'.
 */
export async function readFrameSnapshot(notebookRoot, sourceKey) {
  const key = assertSourceKey(sourceKey)
  const manifest = await readManifest(notebookRoot, key)
  const variants = { light: null, dark: null }
  for (const variant of ['light', 'dark']) {
    const entry = imageEntry(manifest, variant)
    if (!entry) continue
    try {
      const image = await fs.readFile(path.join(frameDir(notebookRoot, key), entry.file))
      variants[variant] = { dataUrl: dataUrl(image), digest: entry.digest, bytes: image.length, stale: Boolean(entry.stale) }
    } catch { /* the referenced image is gone; the variant stays missing */ }
  }
  const captured = variants.light || variants.dark
  let error = null
  if (!captured) {
    try { error = JSON.parse(await fs.readFile(captureMetaPath(notebookRoot, key), 'utf8'))?.error || null } catch { /* no recorded failure */ }
  }
  const hasLight = Boolean(variants.light)
  const hasDark = Boolean(variants.dark)
  return {
    sourceKey: key,
    kind: manifest?.target?.kind || null,
    target: manifest?.target || null,
    viewport: manifest?.viewport || null,
    status: captured ? (hasLight && hasDark ? 'ready' : 'ready') : error ? 'error' : 'missing',
    ...(captured && (!hasLight || !hasDark) ? { partial: true } : {}),
    light: variants.light,
    dark: variants.dark,
    updatedAt: manifest?.updatedAt || null,
    ...(error ? { error } : {}),
  }
}

async function pruneUnreferencedImages(notebookRoot, key, manifest) {
  try {
    const directory = frameDir(notebookRoot, key)
    const referenced = new Set(Object.values(manifest.images || {}).map(entry => entry.file))
    const now = Date.now()
    for (const file of await fs.readdir(directory)) {
      if (!file.endsWith('.png') || referenced.has(file)) continue
      const stat = await fs.stat(path.join(directory, file)).catch(() => null)
      if (stat && now - stat.mtimeMs > IMAGE_GRACE_MS) await fs.rm(path.join(directory, file), { force: true })
    }
  } catch { /* pruning is best effort */ }
}

/**
 * Persist one captured theme variant. The image is written and validated
 * first; the manifest — which publishes the variant — is replaced only after
 * the image bytes are durable.
 */
export async function writeFrameSnapshot({ notebookRoot, sourceKey, target, variant, image, stale = false }) {
  const key = assertSourceKey(sourceKey)
  assertVariant(variant)
  const buffer = Buffer.isBuffer(image) ? image : Buffer.from(image || [])
  const size = readPngSize(buffer)
  if (!size) throw snapshotError('FRAME_SNAPSHOT_IMAGE_INVALID', 'Frame snapshot capture did not produce a valid PNG image')
  if (buffer.length > MAX_IMAGE_BYTES) throw snapshotError('FRAME_SNAPSHOT_IMAGE_TOO_LARGE', 'Frame snapshot capture exceeded the image size limit')
  const digest = createHash('sha256').update(buffer).digest('hex').slice(0, 32)
  const file = `${digest}-${variant}.png`
  const directory = frameDir(notebookRoot, key)
  await fs.mkdir(directory, { recursive: true })
  await atomicWrite(path.join(directory, file), buffer)

  const manifest = (await readManifest(notebookRoot, key)) || {
    formatVersion: FRAME_SNAPSHOT_FORMAT_VERSION,
    sourceKey: key,
    target: target ? JSON.parse(JSON.stringify(target)) : null,
    viewport: target?.viewport || null,
    images: {},
  }
  if (target && !manifest.target) manifest.target = JSON.parse(JSON.stringify(target))
  manifest.images = { ...(manifest.images || {}), [variant]: { file, digest, bytes: buffer.length, width: size.width, height: size.height, stale: stale || undefined, updatedAt: new Date().toISOString() } }
  manifest.updatedAt = new Date().toISOString()
  await atomicWrite(path.join(directory, 'manifest.json'), Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`))
  void pruneUnreferencedImages(notebookRoot, key, manifest)
  return { digest, file, bytes: buffer.length, width: size.width, height: size.height }
}

/** Best-effort private record of the last capture failure for a target. */
export async function writeFrameCaptureError(notebookRoot, sourceKey, error) {
  try {
    await atomicWrite(captureMetaPath(notebookRoot, sourceKey), Buffer.from(`${JSON.stringify({
      sourceKey: assertSourceKey(sourceKey),
      error: { code: error?.code || 'FRAME_CAPTURE_FAILED', message: String(error?.message || 'Frame capture failed') },
      recordedAt: new Date().toISOString(),
    }, null, 2)}\n`))
  } catch { /* diagnostics are best effort */ }
}

/**
 * Adopt a legacy `.storyboard/site-captures` PNG into the portable store.
 * Legacy captures cover the full widget height (including the title bar), so
 * they are marked stale: they remain a visible last-good fallback until a
 * fresh content-viewport capture replaces them. The legacy file is retained.
 */
export async function adoptLegacySiteCapture({ notebookRoot, sourceKey, target, variant, legacyPath }) {
  assertSourceKey(sourceKey)
  assertVariant(variant)
  try {
    const image = await fs.readFile(legacyPath)
    if (!readPngSize(image)) return false
    await writeFrameSnapshot({ notebookRoot, sourceKey, target, variant, image, stale: true })
    return true
  } catch {
    return false
  }
}
