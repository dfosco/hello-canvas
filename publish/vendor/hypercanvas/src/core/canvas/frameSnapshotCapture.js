/**
 * Core-owned headless capture service for Frame snapshots.
 *
 * One shared Playwright Chromium instance serves all Frame captures; each
 * target/theme pair gets an isolated browser context. Captures are
 * deduplicated and serialized (one active capture at a time, bounded queue)
 * so a canvas full of Frames cannot stampede the host. Successful variants
 * are committed atomically through the snapshot store and announced with a
 * small targeted event. Failures never destroy previously captured images.
 */

import fs from 'node:fs'
import { frameSnapshotSourceKey, frameSnapshotThemes, normalizeFrameCaptureUrl, normalizeFrameSnapshotTarget } from './frameSnapshotContract.js'
import { readFrameSnapshot, writeFrameCaptureError, writeFrameSnapshot } from './frameSnapshotStore.js'

const NAVIGATION_TIMEOUT_MS = 45_000
const NETWORK_IDLE_TIMEOUT_MS = 8_000
const SETTLE_MS = 400
const BROWSER_IDLE_MS = 15_000
const MAX_QUEUED_CAPTURES = 8

const CHROMIUM_FALLBACKS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Edge',
]

function captureError(code, message, detail = null) {
  return Object.assign(new Error(message), { code, ...(detail ? { detail } : {}) })
}

let browserState = null

function forgetBrowser() {
  if (browserState) clearTimeout(browserState.timer)
  browserState = null
}

async function acquireBrowser(chromium) {
  if (browserState) {
    clearTimeout(browserState.timer)
    browserState.timer = setTimeout(() => { void closeBrowser() }, BROWSER_IDLE_MS).unref?.()
    return browserState.browser
  }
  let browser
  try {
    browser = await chromium.launch({ headless: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes("Executable doesn't exist")) {
      throw captureError('CAPTURE_BROWSER_LAUNCH_FAILED', `Frame capture browser could not be launched: ${message}`)
    }
    for (const executablePath of CHROMIUM_FALLBACKS) {
      if (!fs.existsSync(executablePath)) continue
      try { browser = await chromium.launch({ executablePath, headless: true }); break } catch { /* try the next installed browser */ }
    }
    if (!browser) {
      throw captureError('CAPTURE_BROWSER_UNAVAILABLE', 'Frame capture browser is not installed. Run: npx playwright install chromium', message)
    }
  }
  const timer = setTimeout(() => { void closeBrowser() }, BROWSER_IDLE_MS).unref?.()
  browserState = { browser, timer }
  return browser
}

async function closeBrowser() {
  const current = browserState
  forgetBrowser()
  try { await current?.browser?.close() } catch { /* already closed */ }
}

/** Close any pooled capture browser (used by server shutdown). */
export async function closeFrameSnapshotBrowser() {
  await closeBrowser()
}

async function captureVariant(browser, url, viewport, variant) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme: variant === 'dark' ? 'dark' : 'light',
    deviceScaleFactor: 2,
  })
  const page = await context.newPage()
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS })
    await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => {})
    await page.evaluate(() => { try { return document.fonts?.ready ?? null } catch { return null } }).catch(() => {})
    await page.waitForTimeout(SETTLE_MS)
    return await page.screenshot({ animations: 'disabled', type: 'png' })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/net::ERR|Timeout.*exceeded|Navigation failed/i.test(message)) {
      throw captureError('CAPTURE_NAVIGATION_FAILED', `Frame capture could not load the Frame document: ${message}`)
    }
    throw captureError('CAPTURE_FAILED', `Frame capture failed: ${message}`)
  } finally {
    await context.close().catch(() => {})
  }
}

/**
 * Create a Frame snapshot capture service bound to one Notebook root.
 *
 * `resolveSiteUrl(siteId, route)` must be injected by the host (Core routes
 * or CLI) and resolves the validated development URL of a running Site; it
 * throws a `SITE_NOT_RUNNING`-coded error when the Site is stopped.
 */
export function createFrameSnapshotCapture({ notebookRoot, eventSender = null, resolveSiteUrl = null }) {
  const pending = new Map()
  let chain = Promise.resolve()

  function resolveCaptureUrl(captureUrl, target, origin) {
    if (target.kind === 'site') {
      if (typeof resolveSiteUrl !== 'function') throw captureError('SITE_RESOLUTION_UNAVAILABLE', 'Site capture requires the Site runtime')
      return resolveSiteUrl(target.siteId, target.route)
    }
    return normalizeFrameCaptureUrl(captureUrl, { origin })
  }

  async function runCapture(normalized, sourceKey, url, themes, identity) {
    let chromium
    try { ({ chromium } = await import(/* @vite-ignore */ 'playwright')) } catch {
      throw captureError('CAPTURE_BROWSER_UNAVAILABLE', 'Frame capture requires playwright — install it with: npm install playwright && npx playwright install chromium')
    }
    if (!chromium) throw captureError('CAPTURE_BROWSER_UNAVAILABLE', 'Frame capture requires playwright chromium')
    const browser = await acquireBrowser(chromium)
    const images = {}
    try {
      for (const variant of themes) {
        images[variant] = await captureVariant(browser, url, normalized.viewport, variant)
      }
    } catch (error) {
      await writeFrameCaptureError(notebookRoot, sourceKey, error)
      throw error
    }
    for (const [variant, image] of Object.entries(images)) {
      await writeFrameSnapshot({ notebookRoot, sourceKey, target: normalized, variant, image })
    }
    const descriptor = await readFrameSnapshot(notebookRoot, sourceKey)
    eventSender?.({
      type: 'custom',
      event: 'storyboard:frame-snapshot:updated',
      data: { sourceKey, kind: normalized.kind, ...(identity?.widgetId ? { widgetId: identity.widgetId } : {}), ...(identity?.canvasId ? { canvasId: identity.canvasId } : {}) },
    })
    return descriptor
  }

  return {
    /**
     * Capture (or reuse) snapshots for one Frame target.
     * Returns the full descriptor, including data URLs per theme variant.
     */
    async capture(target, { theme = 'light', force = false, origin = null, identity = null } = {}) {
      // The Frame document URL is capture-only input (never part of portable
      // identity); it is validated at capture time, not read time.
      const captureUrl = typeof target?.captureUrl === 'string' ? target.captureUrl : ''
      const normalized = normalizeFrameSnapshotTarget(target)
      const sourceKey = frameSnapshotSourceKey(normalized)
      const themes = frameSnapshotThemes(theme)
      if (!force) {
        const existing = await readFrameSnapshot(notebookRoot, sourceKey)
        if (themes.every(variant => existing[variant]?.dataUrl)) return { ...existing, cached: true }
      }
      const url = resolveCaptureUrl(captureUrl, normalized, origin)
      const jobKey = `${sourceKey}:${themes.join('+')}:${force ? 'force' : 'cached'}`
      if (pending.has(jobKey)) return pending.get(jobKey)
      const run = chain.then(() => runCapture(normalized, sourceKey, url, themes, identity))
      pending.set(jobKey, run.catch(() => { /* callers observe the rejection via their own await */ }))
      chain = run.then(() => undefined, () => undefined)
      if (pending.size > MAX_QUEUED_CAPTURES) {
        const oldest = pending.keys().next().value
        pending.delete(oldest)
      }
      return run
    },
    /** Read-only descriptor lookup: side-effect free and source-independent. */
    read(target) {
      const sourceKey = frameSnapshotSourceKey(normalizeFrameSnapshotTarget(target))
      return readFrameSnapshot(notebookRoot, sourceKey)
    },
  }
}
