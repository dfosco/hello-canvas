/**
 * Selected Widgets Bridge — real-time canvas selection & viewport context for agents.
 *
 * Writes `.selectedwidgets.json` at the project root with the currently
 * focused canvas, selected widgets, and user viewport position/zoom.
 * Agents read this file on every prompt to understand what the user is
 * looking at and where to place new widgets.
 *
 * Communication flow:
 *   Browser (CanvasPage.jsx) → HMR events → this module → file on disk
 *
 * Events listened for:
 *   storyboard:canvas-focused     — tab gained focus or canvas mounted
 *   storyboard:selection-changed  — widget selection changed (debounced client-side)
 *   storyboard:viewport-changed   — user scrolled/zoomed (debounced 500ms)
 *   storyboard:canvas-unfocused   — canvas unmounted or tab lost focus
 */

import fs from 'node:fs'
import path from 'node:path'
import { toCanvasId } from './identity.js'
import { devLog } from '../logger/devLogger.js'

const DIR_NAME = '.storyboard'
const FILE_NAME = '.selectedwidgets.json'
const CLEANUP_INTERVAL_MS = 10_000

/**
 * Find a canvas JSONL file by canonical ID (cached).
 */
function createPathResolver(root) {
  const cache = new Map()
  let lastScanFiles = null

  function scanFiles() {
    const results = []
    const ignore = new Set(['node_modules', 'dist', '.git', '.worktrees', 'worktrees'])
    function walk(dir, rel) {
      let entries
      try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        if (ignore.has(entry.name)) continue
        const fullPath = path.join(dir, entry.name)
        const relPath = rel ? `${rel}/${entry.name}` : entry.name
        if (entry.isDirectory()) walk(fullPath, relPath)
        else if (entry.name.endsWith('.canvas.jsonl')) results.push(relPath)
      }
    }
    walk(root, '')
    return results
  }

  return function resolve(canvasId) {
    if (cache.has(canvasId)) return cache.get(canvasId)

    if (!lastScanFiles) lastScanFiles = scanFiles()

    for (const file of lastScanFiles) {
      const id = toCanvasId(file)
      if (id === canvasId) {
        cache.set(canvasId, file)
        return file
      }
    }

    // Cache miss after scan — rescan once (new canvas may have been created)
    lastScanFiles = scanFiles()
    for (const file of lastScanFiles) {
      const id = toCanvasId(file)
      cache.set(id, file)
    }
    return cache.get(canvasId) || null
  }
}

/**
 * Write `.selectedwidgets.json` atomically (tmp + rename).
 */
function writeSelectedWidgets(root, data) {
  const dirPath = path.join(root, DIR_NAME)
  const filePath = path.join(dirPath, FILE_NAME)
  const tmpPath = filePath + '.tmp'
  try {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true })
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
    fs.renameSync(tmpPath, filePath)
  } catch (err) {
    devLog().logEvent('warn', 'Failed to write .selectedwidgets.json', { error: err.message })
  }
}

/**
 * Clear `.selectedwidgets.json` on disk.
 */
function clearSelectedWidgets(root) {
  const filePath = path.join(root, DIR_NAME, FILE_NAME)
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  } catch { /* ignore — file may already be gone */ }
}

/**
 * Read the current viewport from `.selectedwidgets.json`.
 * Returns the viewport object or null if unavailable.
 *
 * @param {string} root — project root directory
 * @returns {{ centerX: number, centerY: number, zoom: number, topLeftX: number, topLeftY: number, width: number, height: number } | null}
 */
export function readCurrentViewport(root) {
  const filePath = path.join(root, DIR_NAME, FILE_NAME)
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw)
    return data?.viewport || null
  } catch { return null }
}

/**
 * Read the full `.selectedwidgets.json` bridge state.
 * Returns { canvasId, selectedWidgetIds, widgets, viewport } or null.
 *
 * @param {string} root — project root directory
 */
export function readSelectedWidgets(root) {
  const filePath = path.join(root, DIR_NAME, FILE_NAME)
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(raw)
  } catch { return null }
}

/**
 * Set up the selected-widgets bridge on a Vite dev server.
 *
 * @param {import('vite').ViteDevServer} server
 * @param {string} root — project root directory
 */
export function setupSelectedWidgets(server, root) {
  const resolvePath = createPathResolver(root)

  // Ensure .storyboard/ directory and initial file exist at startup
  const dirPath = path.join(root, DIR_NAME)
  const filePath = path.join(dirPath, FILE_NAME)
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true })
  if (!fs.existsSync(filePath)) {
    writeSelectedWidgets(root, {
      canvasId: null, canvasFile: null, selectedWidgetIds: [], widgets: [], viewport: null,
    })
  }

  // Active tab state
  let activeTabId = null
  let activeClient = null
  let activeCanvasId = null
  let activeCanvasFile = null
  let activeWidgetIds = []
  let activeWidgets = []
  let activeViewport = null
  let lastViewportJson = null

  function writeCurrentState() {
    writeSelectedWidgets(root, {
      canvasId: activeCanvasId,
      canvasFile: activeCanvasFile,
      selectedWidgetIds: activeWidgetIds,
      widgets: activeWidgets,
      viewport: activeViewport,
    })
  }

  // --- HMR event listeners ---

  server.hot.on('storyboard:canvas-focused', (data, client) => {
    const { tabId, canvasId, widgetIds = [], widgets = [], viewport = null } = data || {}
    if (!tabId || !canvasId) return

    activeTabId = tabId
    activeClient = client
    activeCanvasId = canvasId
    activeCanvasFile = resolvePath(canvasId)
    activeWidgetIds = widgetIds
    activeWidgets = widgets
    if (viewport) activeViewport = viewport

    writeCurrentState()
  })

  server.hot.on('storyboard:selection-changed', (data) => {
    const { tabId, canvasId, widgetIds = [], widgets = [], viewport = null } = data || {}
    if (!tabId || !canvasId) return

    // Only accept updates from the active tab
    if (tabId !== activeTabId) return

    activeWidgetIds = widgetIds
    activeWidgets = widgets
    if (viewport) activeViewport = viewport

    // Update canvas info in case it changed (e.g. page navigation within same tab)
    if (canvasId !== activeCanvasId) {
      activeCanvasId = canvasId
      activeCanvasFile = resolvePath(canvasId)
    }

    writeCurrentState()
  })

  server.hot.on('storyboard:viewport-changed', (data) => {
    const { tabId, canvasId, viewport } = data || {}
    if (!tabId || !canvasId || !viewport) return

    // Only accept from active tab AND matching canvas
    if (tabId !== activeTabId || canvasId !== activeCanvasId) return

    // Skip write if viewport hasn't changed (dedupe)
    const json = JSON.stringify(viewport)
    if (json === lastViewportJson) return
    lastViewportJson = json

    activeViewport = viewport
    writeCurrentState()
  })

  server.hot.on('storyboard:canvas-unfocused', (data) => {
    const { tabId } = data || {}
    if (!tabId) return

    // Only clear if the unfocused tab is the active one
    if (tabId !== activeTabId) return

    activeTabId = null
    activeClient = null
    activeCanvasId = null
    activeCanvasFile = null
    activeWidgetIds = []
    activeWidgets = []
    activeViewport = null
    lastViewportJson = null

    clearSelectedWidgets(root)
  })

  // --- Periodic cleanup: detect disconnected active client ---

  const cleanup = setInterval(() => {
    if (!activeClient) return
    // Check if the active client's WebSocket is still connected
    if (!server.ws.clients.has(activeClient)) {
      activeTabId = null
      activeClient = null
      activeCanvasId = null
      activeCanvasFile = null
      activeWidgetIds = []
      activeWidgets = []
      activeViewport = null
      lastViewportJson = null
      clearSelectedWidgets(root)
    }
  }, CLEANUP_INTERVAL_MS)

  // --- Server shutdown cleanup ---

  server.httpServer?.on('close', () => {
    clearInterval(cleanup)
    clearSelectedWidgets(root)
  })

  // Unwatch the directory to prevent HMR loops
  server.watcher.unwatch(path.join(root, DIR_NAME))
}
