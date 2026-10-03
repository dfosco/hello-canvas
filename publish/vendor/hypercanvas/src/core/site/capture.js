import fs from 'node:fs/promises'
import path from 'node:path'
import { Buffer } from 'node:buffer'
import { normalizeSiteReference, siteCaptureKey } from './publish.js'
import { resolveNotebookRuntimePath } from '../notebook/runtime.js'

export function siteCapturePath(notebookRoot, reference, options = {}) {
  const normalized = normalizeSiteReference(reference)
  const key = siteCaptureKey(normalized, options)
  return resolveNotebookRuntimePath(notebookRoot, path.join('site-captures', normalized.siteId, `${key}.png`))
}

export async function readSiteCapture(notebookRoot, reference, options = {}) {
  const filePath = siteCapturePath(notebookRoot, reference, options)
  try {
    const data = await fs.readFile(filePath)
    return { ...normalizeSiteReference(reference), captureKey: path.basename(filePath, '.png'), dataUrl: `data:image/png;base64,${data.toString('base64')}` }
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

export async function captureSiteFrame({ notebookRoot, reference, developmentUrl, captureAdapter, bindingRevision = 0, theme = 'light', force = false } = {}) {
  if (typeof captureAdapter !== 'function') throw new Error('Site capture requires a browser capture adapter')
  const normalized = normalizeSiteReference(reference)
  const outputPath = siteCapturePath(notebookRoot, normalized, { bindingRevision, theme })
  if (!force) {
    try { await fs.access(outputPath); return { ...normalized, captureKey: path.basename(outputPath, '.png'), path: outputPath, cached: true } } catch { /* capture is missing */ }
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  const result = await captureAdapter({ url: developmentUrl, outputPath, viewport: { width: normalized.width ?? 800, height: normalized.height ?? 600 }, colorScheme: theme === 'dark' ? 'dark' : 'light' })
  if (Buffer.isBuffer(result) || result instanceof Uint8Array) await fs.writeFile(outputPath, result)
  await fs.access(outputPath)
  return { ...normalized, captureKey: path.basename(outputPath, '.png'), path: outputPath, cached: false }
}
