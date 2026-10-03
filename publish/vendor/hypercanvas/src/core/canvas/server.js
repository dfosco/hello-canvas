/**
 * Canvas Server API — CRUD operations for .canvas.jsonl files.
 *
 * Canvas data is stored as an append-only JSONL event stream.
 * Each line is a JSON event object. The first line is always a
 * `canvas_created` event containing the full initial state.
 * Subsequent lines are atomic change events. Current state is
 * derived by replaying the stream via the materializer.
 *
 * Routes (mounted at /_storyboard/canvas/):
 *   GET    /read     — read materialized canvas state
 *   GET    /list     — list all canvases
 *   GET    /folders  — list canvas folders
 *   PUT    /update   — append update events (widgets, sources, settings)
 *   POST   /undo     — append the inverse of a previously-applied event
 *   POST   /redo     — re-apply an undone event (mirror of /undo)
 *   PUT    /rename-page — rename a canvas page file
 *   PUT    /reorder-pages — save page order for a canvas folder
 *   GET    /page-order — read page order for a folder
 *   PUT    /update-folder-meta — update folder .meta.json title
 *   POST   /widget   — append a widget_added event
 *   PATCH  /widget   — update a single widget's props/position
 *   DELETE /widget   — append a widget_removed event
 *   POST   /connector — append a connector_added event
 *   DELETE /connector — append a connector_removed event
 *   POST   /batch    — execute multiple operations in one request (refs, single HMR push)
 *   POST   /create   — create a new .canvas.jsonl file
 *   GET    /stories  — list all .story.{jsx,tsx} files with exports
 *   POST   /create-story — scaffold a new .story.{jsx,tsx} file
 *   GET    /github/available — check if local gh CLI is installed
 *   POST   /github/embed — fetch GitHub issue/discussion/PR/comment metadata via gh
 *   POST   /image    — upload a pasted image to src/canvas/images/
 *   GET    /images/* — serve an image file from src/canvas/images/
 *   POST   /image/toggle-private — toggle ~prefix on image filename
 *   GET    /terminal-buffer/:id — read private terminal buffer (with ?length=N)
 *   GET    /terminal-snapshot/:id — read public terminal snapshot
 */

import fs from 'node:fs'
import path from 'node:path'
import { Buffer } from 'node:buffer'
import { materializeFromText, parseCanvasJsonl, serializeEvent } from './materializer.js'
import { buildInverseEvent } from './undoRedo.js'
import { compactCanvas } from './compact.js'
import { toCanvasId, parseCanvasId } from './identity.js'
import {
  GH_INSTALL_URL,
  GitHubEmbedError,
  fetchGitHubEmbedSnapshot,
  isGhCliAvailable,
  isGitHubEmbedUrl,
} from './githubEmbeds.js'
import { stampBounds, stampBoundsAll, resolvePosition, getWidgetBounds, findBestAnchors } from './collision.js'
import { markCanvasWrite, unmarkCanvasWrite } from './writeGuard.js'
import { devLog } from '../logger/devLogger.js'
import {
  buildHostWorkloadEnv,
  HostRuntimeError,
  quoteShellWord,
  reassertHostPath,
  resolveAgentHostRuntime,
  rewriteAgentCommand,
  rewriteAgentConfig,
} from '../host-tools/runtime.js'
import { getServerWidgetDefinition } from './customWidgets.js'
import { listHubRoles, getDefaultRoleId } from './hub-roles.js'
import { readAgentsConfig } from './configReader.js'
import {
  createTerminalSession,
  snapshotTerminalSession,
  subscribeTerminalSession,
  terminalSessionExists,
  submitTerminalText,
  withTerminalStartup,
  writeTerminalText,
} from './terminal-runtime.js'
import { initPaseoTerminalRuntime } from './paseo-terminal-runtime.js'
import { confirmNotebookPaseoBinding } from './paseo-notebook-binding.js'

/**
 * Read the prompt widget's execution config from the merged widget registry.
 * Returns { default, agents } where each agent has a command template.
 */
function getPromptExecution() {
  const def = getServerWidgetDefinition('prompt')
  return def?.execution || null
}

function canvasContentRoot(root) {
  const notebookCanvas = path.join(root, 'canvas')
  return fs.existsSync(notebookCanvas) ? notebookCanvas : path.join(root, 'src', 'canvas')
}

/**
 * Build the CLI command for a prompt spawn.
 * Reads the prompt widget's execution.agents config and interpolates ${prompt}.
 */
function buildPromptCmd({ prompt, envFile, agentId, agentRuntime }) {
  const execution = getPromptExecution()
  if (!execution) return null
  const id = agentId || execution.default
  const agent = execution.agents?.[id]
  if (!agent?.command) return null
  const promptWord = quoteShellWord(prompt)
  const configured = agent.command.includes('"${prompt}"')
    ? agent.command.replace('"${prompt}"', promptWord)
    : agent.command.replace('${prompt}', promptWord)
  const command = rewriteAgentCommand(agentRuntime, configured)
  return `source ${quoteShellWord(envFile)} && ${reassertHostPath(agentRuntime, `exec ${command}`)}`
}

/**
 * Scan src/canvas/ for directories containing .meta.json files.
 * Returns an object keyed by directory name (without .folder suffix).
 */
function findCanvasMeta(root) {
  const canvasDir = canvasContentRoot(root)
  const groups = {}
  if (!fs.existsSync(canvasDir)) return groups

  const entries = fs.readdirSync(canvasDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dirName = entry.name.replace(/\.folder$/, '')
    const metaPath = path.join(canvasDir, entry.name, `${dirName}.meta.json`)
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        groups[dirName] = meta
      } catch { /* skip invalid meta */ }
    }
  }
  return groups
}

/**
 * Read .meta.json from a canvas folder directory.
 */
function readFolderMeta(folderDir) {
  const dirName = path.basename(folderDir).replace(/\.folder$/, '')
  const metaPath = path.join(folderDir, `${dirName}.meta.json`)
  if (fs.existsSync(metaPath)) {
    try { return JSON.parse(fs.readFileSync(metaPath, 'utf-8')) } catch { /* ignore */ }
  }
  return {}
}

/**
 * Write .meta.json to a canvas folder directory.
 */
function writeFolderMeta(folderDir, meta) {
  const dirName = path.basename(folderDir).replace(/\.folder$/, '')
  const metaPath = path.join(folderDir, `${dirName}.meta.json`)
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf-8')
}

/**
 * Recursively find all .canvas.jsonl files in the project.
 */
function findCanvasFiles(root) {
  const results = []
  const ignore = new Set(['node_modules', 'dist', '.git', '.storyboard', 'publish', '.worktrees', 'worktrees'])

  function walk(dir, rel) {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (ignore.has(entry.name)) continue
      const fullPath = path.join(dir, entry.name)
      const relPath = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        walk(fullPath, relPath)
      } else if (entry.name.endsWith('.canvas.jsonl')) {
        results.push(relPath)
      }
    }
  }

  walk(root, '')
  return results
}

/**
 * Recursively find all .story.{jsx,tsx} files in routable directories
 * (src/canvas/ and src/components/) and extract their named exports.
 */
function findStoryFiles(root) {
  const results = []
  const ignore = new Set(['node_modules', 'dist', '.git', '.storyboard', 'publish', '.worktrees', 'worktrees'])
  const ROUTABLE_DIRS = [
    path.relative(root, canvasContentRoot(root)),
    'src/components',
  ]

  function walk(dir, rel) {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (ignore.has(entry.name)) continue
      if (entry.name.startsWith('_')) continue
      const fullPath = path.join(dir, entry.name)
      const relPath = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        walk(fullPath, relPath)
      } else if (/\.story\.(jsx|tsx)$/.test(entry.name)) {
        const name = entry.name.replace(/\.story\.(jsx|tsx)$/, '')
        const exports = parseExportNames(fullPath)
        results.push({ name, path: relPath, exports })
      }
    }
  }

  for (const dir of ROUTABLE_DIRS) {
    const absDir = path.join(root, dir)
    if (fs.existsSync(absDir)) {
      walk(absDir, dir)
    }
  }
  return results
}

/**
 * Parse named function/const exports from a JSX/TSX file.
 */
function parseExportNames(filePath) {
  try {
    const src = fs.readFileSync(filePath, 'utf-8')
    const names = []
    const re = /export\s+(?:function|const|class)\s+([A-Z]\w*)/g
    let m
    while ((m = re.exec(src)) !== null) names.push(m[1])
    return names
  } catch { return [] }
}

/**
 * Find a canvas JSONL file by canonical ID.
 * Only matches canonical path-based IDs from toCanvasId().
 */
function findCanvasPath(root, canvasId) {
  const files = findCanvasFiles(root)

  for (const file of files) {
    const id = canvasIdForFile(file)
    if (id === canvasId) {
      return path.resolve(root, file)
    }
  }

  return null
}

// Notebooks store canvases at `canvas/`, while application projects use
// `src/canvas/`. Normalize both layouts before creating the public ID.
function canvasIdForFile(file) {
  const normalized = file.replace(/\\/g, '/')
  return toCanvasId(normalized.startsWith('canvas/') ? `src/${normalized}` : normalized)
}

/**
 * Read a .canvas.jsonl file and materialize its current state.
 */
function readCanvas(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8')
  return materializeFromText(raw)
}

function findCanvasWidget(root, widgetId, canvasId = null) {
  const files = canvasId
    ? [findCanvasPath(root, canvasId)].filter(Boolean)
    : findCanvasFiles(root).map(file => path.resolve(root, file))
  for (const file of files) {
    try {
      const widget = readCanvas(file).widgets?.find(entry => entry.id === widgetId)
      if (widget) return widget
    } catch { /* continue past unreadable canvas files */ }
  }
  return null
}

/**
 * Append a single event line to a .canvas.jsonl file.
 */
function appendEventRaw(filePath, event) {
  fs.appendFileSync(filePath, serializeEvent(event) + '\n', 'utf-8')
}

/**
 * Generate a short random event id. Stamped on every canvas event so
 * undo/redo can reference the inverse target by id alone.
 */
function generateEventId() {
  return `evt_${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Hard ceiling for runaway sessions: when a JSONL file grows past this size,
 * compact it once (collapses history into a single `canvas_created` baseline).
 * Set above the normal startup-compaction threshold (500 KB) so most files
 * never hit it — only marathon sessions that don't restart the dev server.
 */
const SOFT_COMPACT_THRESHOLD_BYTES = 2 * 1024 * 1024

/** Per-file lock to avoid compacting the same file repeatedly on bursts. */
const inFlightCompactions = new Set()

/**
 * Check the file size after a write; if past the runaway threshold, kick off
 * a one-shot compaction. Best-effort — failures are swallowed and logged.
 */
function maybeCompactRunawayFile(filePath) {
  if (inFlightCompactions.has(filePath)) return
  let size
  try { size = fs.statSync(filePath).size } catch { return }
  if (size < SOFT_COMPACT_THRESHOLD_BYTES) return
  inFlightCompactions.add(filePath)
  // Run on the next tick so this append's HMR push fires first and the
  // compaction's HMR push lands after — the client treats both consistently
  // (compaction's push is a single canvas_created event that reconciles).
  setImmediate(() => {
    try {
      const result = compactCanvas(filePath, { force: true })
      devLog().logEvent('info', `[canvas] runaway compaction ${path.basename(filePath)}`, {
        before: result.before,
        after: result.after,
      })
    } catch (err) {
      devLog().logEvent('warn', `[canvas] runaway compaction failed for ${filePath}`, { error: err.message })
    } finally {
      inFlightCompactions.delete(filePath)
    }
  })
}

/**
 * Generate a unique widget ID.
 */
function generateWidgetId(type) {
  const suffix = Math.random().toString(36).slice(2, 8)
  return `${type}-${suffix}`
}

/**
 * Create the canvas API route handler.
 */
export function createCanvasHandler(ctx) {
  const { root, sendJson, hotPool, workspaceIdResolver } = ctx
  const headlessSubscriptions = new Map()
  const resolveActiveWorkspaceId = async () => {
    if (typeof workspaceIdResolver === 'function') return workspaceIdResolver(root)
    const confirmed = await confirmNotebookPaseoBinding(root)
    return confirmed.workspaceId
  }

  /**
   * Compute a target position relative to a reference widget.
   * @param {object} refWidget — widget to position near (must have position + type/props)
   * @param {string} direction — 'right' | 'left' | 'above' | 'below' | 'above-right' | 'below-right' | 'above-left' | 'below-left'
   * @param {string} newType — type of the widget being created (for size defaults)
   * @param {object} newProps — props of the widget being created
   * @param {number} gap — spacing between widgets in grid spaces (default 1)
   * @param {number} gridSize — pixel size of one grid unit (default 24)
   * @returns {{ x: number, y: number }}
   */
  /**
   * Map a `--direction` value to the preferred collision-resolution axis.
   * Side placements (left/right/diagonals) cascade vertically so a fan of
   * widgets stacks into a clean column instead of getting shoved further
   * away from the reference widget. Above/below cascade horizontally.
   */
  function directionPreferAxis(direction) {
    if (direction === 'above' || direction === 'below') return 'horizontal'
    return 'vertical'
  }

  function computeNearPosition(refWidget, direction = 'right', newType = 'sticky-note', newProps = {}, gap = 1, gridSize = 24) {
    gap = gap * gridSize
    const refBounds = getWidgetBounds(refWidget)
    const newDefaults = getWidgetBounds({ type: newType, props: newProps, position: { x: 0, y: 0 } })
    const refCenterY = refBounds.y + refBounds.height / 2
    // eslint-disable-next-line no-unused-vars
    const refCenterX = refBounds.x + refBounds.width / 2
    switch (direction) {
      case 'left':
        return { x: refBounds.x - newDefaults.width - gap, y: refBounds.y }
      case 'above':
        return { x: refBounds.x, y: refBounds.y - newDefaults.height - gap }
      case 'below':
        return { x: refBounds.x, y: refBounds.y + refBounds.height + gap }
      case 'above-right':
        return { x: refBounds.x + refBounds.width + gap, y: refCenterY - newDefaults.height - gap / 2 }
      case 'below-right':
        return { x: refBounds.x + refBounds.width + gap, y: refCenterY + gap / 2 }
      case 'above-left':
        return { x: refBounds.x - newDefaults.width - gap, y: refCenterY - newDefaults.height - gap / 2 }
      case 'below-left':
        return { x: refBounds.x - newDefaults.width - gap, y: refCenterY + gap / 2 }
      case 'right':
      default:
        return { x: refBounds.x + refBounds.width + gap, y: refBounds.y }
    }
  }

  /**
   * Compute a smart default position when no --near or explicit x,y is given.
   * Priority chain:
   *   1. Active agent/terminal (source widget ID from request)
   *   2. User-selected widget (from .selectedwidgets.json, same canvas)
   *   3. Viewport center (from .selectedwidgets.json)
   *   4. Last widget on canvas
   *   5. Origin (0, 0) — empty canvas, no viewport
   *
   * @param {object[]} canvasWidgets — current widgets on the canvas
   * @param {string} type — widget type being created
   * @param {object} props — widget props
   * @param {string} projectRoot — project root directory
   * @param {string|null} canvasName — canvas ID for matching selectedwidgets context
   * @param {string|null} sourceWidgetId — caller's widget ID (agent/terminal creating this widget)
   */
  async function computeAutoPosition(canvasWidgets, type, props, projectRoot, canvasName, sourceWidgetId) {
    const widgetMap = new Map((canvasWidgets || []).map(w => [w.id, w]))

    // 1. Place near the source agent/terminal widget
    if (sourceWidgetId && widgetMap.has(sourceWidgetId)) {
      return computeNearPosition(widgetMap.get(sourceWidgetId), 'right', type, props)
    }

    // 2–3. Read .selectedwidgets.json for selection + viewport context
    try {
      const { readSelectedWidgets } = await import('./selectedWidgets.js')
      const sw = readSelectedWidgets(projectRoot)
      if (sw && sw.canvasId === canvasName) {
        // 2. Place near the selected widget
        if (sw.selectedWidgetIds?.length > 0) {
          const selectedId = sw.selectedWidgetIds[0]
          if (widgetMap.has(selectedId)) {
            return computeNearPosition(widgetMap.get(selectedId), 'right', type, props)
          }
        }

        // 3. Place at viewport center
        const vp = sw.viewport
        if (vp && vp.centerX != null && vp.centerY != null) {
          return { x: Math.round(vp.centerX / 24) * 24, y: Math.round(vp.centerY / 24) * 24 }
        }
      }
    } catch { /* selectedWidgets bridge may not be initialized */ }

    // 4. Place near the last widget on the canvas
    if (canvasWidgets && canvasWidgets.length > 0) {
      const lastWidget = canvasWidgets[canvasWidgets.length - 1]
      return computeNearPosition(lastWidget, 'right', type, props)
    }

    // 5. Truly empty canvas, no viewport
    return { x: 0, y: 0 }
  }

  function buildComponents(widgets, connectors) {
    const ids = new Set(widgets.map((w) => w.id))
    const adj = new Map()
    for (const id of ids) adj.set(id, new Set())
    for (const conn of connectors) {
      const a = conn.start?.widgetId
      const b = conn.end?.widgetId
      if (!a || !b || !ids.has(a) || !ids.has(b) || a === b) continue
      adj.get(a).add(b)
      adj.get(b).add(a)
    }

    const seen = new Set()
    const components = []
    for (const id of ids) {
      if (seen.has(id)) continue
      const queue = [id]
      const comp = new Set()
      seen.add(id)
      while (queue.length > 0) {
        const cur = queue.shift()
        comp.add(cur)
        for (const next of adj.get(cur) || []) {
          if (seen.has(next)) continue
          seen.add(next)
          queue.push(next)
        }
      }
      components.push(comp)
    }
    return components
  }

  function computeHubRoleState(widgets, connectors) {
    const roles = listHubRoles(root)
    const defaultRole = getDefaultRoleId(roles)
    const uniqueRoles = new Set(roles.filter((r) => r.type === 'unique').map((r) => r.id))
    const roleById = new Map(roles.map((r) => [r.id, r]))

    const widgetMap = new Map(widgets.map((w) => [w.id, w]))
    const broadcastConnectors = connectors.filter((connector) => {
      const mode = connector.meta?.messagingMode
      return mode === 'one-way' || mode === 'two-way'
    })
    const components = buildComponents(widgets, broadcastConnectors)

    const roleByWidget = new Map()
    for (const comp of components) {
      const compIds = [...comp]
      const compSet = new Set(compIds)
      const compWidgets = compIds.map((id) => widgetMap.get(id)).filter(Boolean)
      const agentWidgets = compWidgets.filter((w) => w.type === 'agent')
      if (compWidgets.length === 0) continue

      // Start with requested role from props, defaulting to "member" (or configured default) for agents.
      for (const w of agentWidgets) {
        const requested = w.props?.role
        const resolved = requested && roleById.has(requested) ? requested : defaultRole
        roleByWidget.set(w.id, resolved)
      }

      // Enforce unique role semantics.
      for (const roleId of uniqueRoles) {
        const holders = agentWidgets.filter((w) => roleByWidget.get(w.id) === roleId)
        if (holders.length <= 1) continue
        // Keep first holder deterministically, revert the rest to default.
        for (const w of holders.slice(1)) roleByWidget.set(w.id, defaultRole)
      }

      // Auto-leader bootstrap for 3+ agent hubs when no leader exists.
      const hasLeader = agentWidgets.some((w) => roleByWidget.get(w.id) === 'leader')
      if (!hasLeader && agentWidgets.length >= 3) {
        const connectorLeader = broadcastConnectors.find((conn) => {
          const startId = conn.start?.widgetId
          const endId = conn.end?.widgetId
          if (!startId || !endId) return false
          if (!compSet.has(startId) || !compSet.has(endId)) return false
          const start = widgetMap.get(startId)
          const end = widgetMap.get(endId)
          return start?.type === 'agent' && end?.type === 'agent'
        })?.start?.widgetId
        if (connectorLeader && compSet.has(connectorLeader)) {
          roleByWidget.set(connectorLeader, 'leader')
        }
      }
    }

    return { roles, defaultRole, roleByWidget }
  }

  /**
   * Update terminal configs when connectors change.
   * Finds all terminal widgets in the canvas, computes their connected widget IDs
   * from the current connector list, and updates their config files.
   */
  async function updateTerminalConnectionsForCanvas(root, canvasName, canvasData, connectors) {
    try {
      const { updateTerminalConnections, initTerminalConfig } = await import('./terminal-config.js')
      const { execSync } = await import('node:child_process')
      initTerminalConfig(root)

      let branch = 'unknown'
      try {
        branch = execSync('git branch --show-current', { encoding: 'utf8', cwd: root }).trim()
      } catch { /* empty */ }

      const widgets = canvasData.widgets || []
      const widgetMap = new Map(widgets.map(w => [w.id, w]))
      const terminalWidgets = widgets.filter((w) => w.type === 'terminal' || w.type === 'agent' || w.type === 'prompt' || w.type === 'agent-chat')
      const { defaultRole, roleByWidget } = computeHubRoleState(widgets, connectors)
      const hubsByWidget = new Map()

      // Sync hub-manager's in-memory state so messaging routes can find hubs
      try {
        const { materializeHubs, getHub, getHubsForCanvas } = await import('../messaging/hub-manager.js')
        const { created: createdHubs } = await materializeHubs(canvasName, widgets, connectors, { roleByWidget, defaultRole })

        for (const hub of getHubsForCanvas(canvasName)) {
          for (const [widgetId, member] of hub.members) {
            if (!hubsByWidget.has(widgetId)) hubsByWidget.set(widgetId, [])
            hubsByWidget.get(widgetId).push({
              hubId: hub.hubId,
              contextVersion: hub.context.version,
              role: member.role,
              promptSummary: hub.context.promptSummary || null,
              channel: hub.channel,
            })
          }
        }

        // Auto-assign "Leader" alias to the leader widget in newly created hubs
        if (createdHubs.length > 0) {
          const hubCanvasPath = findCanvasPath(root, canvasName)
          if (hubCanvasPath) {
            for (const hubId of createdHubs) {
              const hub = getHub(hubId)
              if (!hub) continue
              for (const [wId, member] of hub.members) {
                if (member.role !== 'leader') continue
                const w = widgetMap.get(wId)
                if (!w || w.props?.alias) continue
                appendEventRaw(hubCanvasPath, {
                  event: 'widget_updated',
                  timestamp: new Date().toISOString(),
                  widgetId: wId,
                  props: { alias: 'Leader' },
                })
              }
            }
          }
        }
      } catch { /* messaging module may not be loaded */ }

      const canvasFilePath = findCanvasPath(root, canvasName)

      // Persist computed roles to widget props in the canvas JSONL so the UI
      // (e.g. crown icon) reflects the role without requiring manual assignment.
      // Uses appendEventRaw to avoid triggering a full HMR cycle — treated as content.
      if (canvasFilePath) {
        const ts = new Date().toISOString()
        for (const tw of terminalWidgets) {
          if (tw.type !== 'agent' && tw.type !== 'prompt' && tw.type !== 'agent-chat') continue
          const computedRole = roleByWidget.get(tw.id) || defaultRole
          const currentRole = tw.props?.role || null
          if (computedRole && computedRole !== currentRole) {
            appendEventRaw(canvasFilePath, {
              event: 'widget_updated',
              timestamp: ts,
              widgetId: tw.id,
              props: { role: computedRole },
            })
            // Update in-memory widget so later reads in this cycle see the new role
            if (!tw.props) tw.props = {}
            tw.props.role = computedRole
          }
        }
      }

      for (const tw of terminalWidgets) {
        const connectedIds = new Set()
        const messagingPeers = []
        for (const conn of connectors) {
          let peerId = null
          let direction = null
          if (conn.start?.widgetId === tw.id) {
            peerId = conn.end?.widgetId
            direction = 'outgoing' // tw → peer
          }
          if (conn.end?.widgetId === tw.id) {
            peerId = conn.start?.widgetId
            direction = 'incoming' // peer → tw
          }
          if (peerId) {
            connectedIds.add(peerId)
            const mode = conn.meta?.messagingMode || 'none'
            if (mode !== 'none') {
              const peerWidget = widgetMap.get(peerId)
              if (peerWidget && (peerWidget.type === 'terminal' || peerWidget.type === 'agent' || peerWidget.type === 'agent-chat')) {
                const canSend = mode === 'two-way' || (mode === 'one-way' && direction === 'outgoing')
                const canReceive = mode === 'two-way' || (mode === 'one-way' && direction === 'incoming')
                messagingPeers.push({
                  widgetId: peerId,
                  displayName: peerWidget.props?.alias || peerWidget.props?.prettyName || peerId,
                  configPath: `.storyboard/terminals/${peerId}.json`,
                  type: peerWidget.type,
                  canSend,
                  canReceive,
                  mode,
                })
              }
            }
          }
        }
        connectedIds.delete(undefined)
        connectedIds.delete(null)

        // Resolve full widget objects for connected widgets
        const connectedWidgets = [...connectedIds]
          .map(id => widgetMap.get(id))
          .filter(Boolean)
          .map(w => ({ id: w.id, type: w.type, props: w.props, position: w.position }))

        // Build messaging section if there are messaging-enabled peers
        const messaging = messagingPeers.length > 0 ? { peers: messagingPeers } : null
        const role = roleByWidget.get(tw.id) || (tw.type === 'agent' || tw.type === 'agent-chat' ? defaultRole : 'passive')
        const hubs = hubsByWidget.get(tw.id) || []

        updateTerminalConnections({
          branch,
          canvasId: canvasName,
          widgetId: tw.id,
          connectedWidgets,
          widgetProps: tw.props || null,
          messaging,
          role,
          hubs,
        })
        if (tw.type !== 'agent-chat') {
          const { refreshLiveCodingTarget } = await import('./live-terminal-coding-target.js')
          await refreshLiveCodingTarget(root, tw.id)
        }
      }

    } catch (err) {
      devLog().logEvent('warn', 'Failed to update terminal connections', { error: err.message })
    }
  }

  // Append an event to an existing canvas file.
  // Marks the file in the write guard so the data plugin's watcher handler
  // skips sending a duplicate HMR event (the server pushes its own via
  // pushCanvasUpdate after the write). Stamps a stable random `id` so
  // undo/redo markers can target events by id.
  //
  // Also runs the runaway-session hard ceiling: if the file grows past
  // SOFT_COMPACT_THRESHOLD after writing, kick off a one-shot compaction
  // to keep the JSONL → HMR → React pipeline responsive. The user's per-tab
  // undo stack will lose pre-compaction targets (post-compaction undo calls
  // return 404 which the client interprets as "clear the stack").
  function appendEvent(filePath, event) {
    if (event && typeof event === 'object' && !event.id) {
      event.id = generateEventId()
    }
    markCanvasWrite(filePath)
    appendEventRaw(filePath, event)
    maybeCompactRunawayFile(filePath)
    // Unmark after enough time for the watcher to fire and be suppressed.
    // macOS FSEvents latency is typically 100-500ms; 1s covers edge cases.
    setTimeout(() => unmarkCanvasWrite(filePath), 1000)
    return event.id
  }

  /**
   * Prepare a terminal/agent widget: auto-assign displayName and pre-reserve identity.
   * Shared by POST /widget and batch create-widget.
   * @param {{ type: string, props: Object }} opts
   * @param {string} widgetId
   * @param {string} canvasName
   * @param {import('node:http').IncomingMessage} [req]
   */
  async function prepareTerminalWidget({ type, props, widgetId, canvasName, req }) {
    if (type !== 'terminal' && type !== 'agent' && type !== 'agent-chat') return
    const workspaceId = await resolveActiveWorkspaceId()

    if (type === 'agent') {
      const agents = readAgentsConfig(root) || {}
      const defaultEntry = Object.entries(agents).find(([, config]) => config?.default) || Object.entries(agents)[0]
      const agentId = props?.agentId || defaultEntry?.[0] || null
      const runtime = await resolveAgentHostRuntime(root, agentId)
      const agentConfig = agents[agentId]
      rewriteAgentConfig(runtime, agentConfig)
      props.agentId = agentId
      props.startupCommand = agentConfig.startupCommand
    }

    if (!props.prettyName) {
      try {
        const { generateFriendlyName } = await import('./terminal-registry.js')
        props.prettyName = generateFriendlyName()
      } catch { /* registry not initialized yet */ }
    }

    try {
      const { preReserveTerminalIdentity, initTerminalConfig, writeTerminalConfig } = await import('./terminal-config.js')
      initTerminalConfig(root)
      let branch = 'unknown'
      try {
        const { execSync } = await import('node:child_process')
        branch = execSync('git branch --show-current', { encoding: 'utf8', cwd: root }).trim()
      } catch { /* empty */ }
      const serverUrl = `http://localhost:${req?.socket?.localPort || 1234}`
      if (type === 'agent-chat') {
        // Agent-chat widgets never open a terminal WS, so nothing would later
        // promote a pre-reserved identity into the hash-named config. Write
        // the full config now so the widget has identity from creation.
        writeTerminalConfig({
          branch,
          canvasId: canvasName,
           widgetId,
           serverUrl,
           workspaceId,
           widgetProps: props,
          displayName: props.alias || props.prettyName || null,
        })
      } else {
        preReserveTerminalIdentity({
          widgetId,
          preDisplayName: props.prettyName || null,
           canvasId: canvasName,
           branch,
           serverUrl,
           workspaceId,
           widgetProps: props,
        })
      }
    } catch { /* best effort */ }
  }

  /**
   * Resolve which hot pool to use for a widget type + props.
   * Agent widgets use their agentId as pool ID; terminals use 'terminal'.
   */
  function resolvePoolId(type, props) {
    if (type === 'agent' && props?.agentId) return props.agentId
    return 'terminal'
  }

  /**
   * Non-mutating probe of a hot pool — returns readiness without claiming
   * a slot. Use this when the canvas API just needs to tell the client
   * whether a hot session is available; the actual session claim happens
   * later in terminal-server when the WebSocket connects.
   * @param {Object|null} hotPool — HotPoolManager instance
   * @param {string} poolId — pool to peek at
   * @param {string} [mode] — 'auto' (default), 'hot', or 'cold'
   * @returns {{ ready: boolean }}
   */
  function peekPool(hotPool, poolId, mode) {
    if (!hotPool || mode === 'cold') return { ready: false }
    if (!hotPool.has(poolId)) return { ready: false }
    return hotPool.peek(poolId)
  }

  /**
   * Push live canvas update to connected clients via Vite HMR.
   * Reads the full materialized state from disk and sends it as a custom
   * event so useCanvas can update in-place without a page refresh.
   */
  async function pushCanvasUpdate(canvasName, filePath, viteWs) {
    try {
      const data = readCanvas(filePath)
      viteWs?.send({
        type: 'custom',
        event: 'storyboard:canvas-file-changed',
        data: { canvasId: canvasName, name: canvasName, metadata: data },
      })

      // Refresh terminal config files on every canvas change so agents
      // always see up-to-date connectedWidgets and widget props.
      await updateTerminalConnectionsForCanvas(root, canvasName, data, data.connectors || [])
    } catch { /* best effort — watcher will catch it eventually */ }
  }

  // Write a new JSONL file with a single creation event.
  // New files are detected naturally by Vite's watcher as an `add` event,
  // which correctly triggers a full reload to register new routes.
  function writeNewCanvas(filePath, event) {
    fs.writeFileSync(filePath, serializeEvent(event) + '\n', 'utf-8')
  }

  async function spawnHeadlessAgent(options) {
    const key = `${options.canvasId}:${options.widgetId}`
    return withTerminalStartup(key, async () => {
      const agents = readAgentsConfig(root) || {}
      const targetAgentId = options.agentId
        || getPromptExecution()?.default
        || Object.keys(agents).find((id) => agents[id]?.default)
        || Object.keys(agents)[0]
        || null
      const agentRuntime = await resolveAgentHostRuntime(root, targetAgentId)
      const agentConfig = rewriteAgentConfig(agentRuntime, agents[targetAgentId])
      const workspaceId = await resolveActiveWorkspaceId()
      const warmSession = options.warmPoolId && hotPool?.has(options.warmPoolId)
        ? hotPool.acquire(options.warmPoolId)
        : null
      try {
        const result = await spawnHeadlessAgentUnlocked({
          ...options,
          agentId: targetAgentId,
          agentConfig,
          agentRuntime,
          workspaceId,
          warmSession,
        })
        if (warmSession) hotPool.consume(options.warmPoolId, warmSession.id)
        return result
      } catch (error) {
        if (warmSession) hotPool?.release(options.warmPoolId, warmSession.id)
        throw error
      }
    })
  }

  async function spawnHeadlessAgentUnlocked({
    canvasId,
    widgetId,
    prompt,
    autopilot = true,
    requestedBranch,
    agentId,
    agentConfig,
    agentRuntime,
    workspaceId,
    warmSession = null,
    statusMessage = 'Agent spawning...',
  }) {
    const { execFileSync } = await import('node:child_process')
    const {
      initTerminalConfig,
      updateAgentStatus,
      writeTerminalConfig,
    } = await import('./terminal-config.js')
    const {
      adoptRuntimeSession,
      disconnectSession,
      generateSessionId,
      getSessionByWidget,
      killSession,
      registerSession,
    } = await import('./terminal-registry.js')
    initTerminalConfig(root)
    let branch = requestedBranch || 'unknown'
    if (!requestedBranch) {
      try { branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8', cwd: root }).trim() } catch { /* non-git project */ }
    }
    const sessionId = generateSessionId(branch, canvasId, widgetId)
    const existing = getSessionByWidget(branch, canvasId, widgetId)
    if (existing && await terminalSessionExists(existing.sessionId).catch(() => false)) {
      throw new Error(`Agent session already active for widget ${widgetId}`)
    }
    const runtimeSessionId = warmSession?.runtimeSessionId || sessionId
    const basePath = process.env.VITE_BASE_PATH || '/'
    const serverUrl = `http://localhost:${reqSocketPort || 1234}${basePath.startsWith('/') ? basePath : `/${basePath}`}`.replace(/\/$/, '')
    const envMap = {
      STORYBOARD_WIDGET_ID: widgetId,
      STORYBOARD_CANVAS_ID: canvasId,
      STORYBOARD_BRANCH: branch,
      STORYBOARD_SERVER_URL: serverUrl,
      STORYBOARD_PROJECT_ROOT: root,
      TERM_PROGRAM: 'storyboard',
      FORCE_COLOR: '3',
    }
    const envFile = path.join(root, '.storyboard', 'terminals', `${sessionId}.env`)
    fs.mkdirSync(path.dirname(envFile), { recursive: true })
    fs.writeFileSync(envFile, Object.entries(envMap).map(([key, value]) => `export ${key}=${quoteShellWord(value)}`).join('\n') + '\n')

    // Headless canvas agents also run in terminal PTYs. They cannot show a
    // picker, so ambiguous targets require a saved widget preference.
    const { prepareTerminalCodingLaunch } = await import('../cli/terminal-coding-target.js')
    const { appendTerminalAgentPrompt, isInteractiveTerminalAgent } = await import('./terminal-coding-target.js')
    const codingContext = await prepareTerminalCodingLaunch(root, widgetId, { assignment: prompt })
    const { startTerminalContext, stopTerminalContext } = await import('./live-terminal-coding-target.js')

    const codingRuntime = { ...agentRuntime, path: `${codingContext.binDirectory}${path.delimiter}${agentRuntime.path || agentRuntime.hostPath}` }
    let command
    if (autopilot) {
      command = buildPromptCmd({ prompt: codingContext.prompt, envFile, agentId, agentRuntime: codingRuntime })
      if (!command) throw new Error(`Agent "${agentId || getPromptExecution()?.default || 'unknown'}" has no prompt command configured`)
    } else {
      command = `source ${quoteShellWord(envFile)} && ${reassertHostPath(codingRuntime, `exec ${appendTerminalAgentPrompt(agentConfig.startupCommand, agentId, codingContext.prompt)}`)}`
    }

    startTerminalContext(root, widgetId, { ...codingContext, interactive: !autopilot && isInteractiveTerminalAgent(agentConfig.startupCommand, agentId) })
    const shell = agentRuntime.shell
    const shellFlag = shell.endsWith('/zsh') || shell.endsWith('/bash') ? '-lc' : '-c'
    let entry = null
    let subscription
    let pendingExit = null
    let readinessTimer = null
    let commandStarted = false
    let resolveReadiness
    let rejectReadiness
    let readinessOutput = ''
    const readiness = new Promise((resolveReady, rejectReady) => {
      resolveReadiness = resolveReady
      rejectReadiness = rejectReady
    })
    const checkReadiness = () => {
      if (agentConfig?.readinessSignal && readinessOutput.includes(agentConfig.readinessSignal)) resolveReadiness()
    }
    const handleExit = async (event) => {
      if (readinessTimer) clearTimeout(readinessTimer)
      resolveReadiness()
      if (headlessSubscriptions.get(widgetId) === subscription) headlessSubscriptions.delete(widgetId)
      subscription?.close()
      if (entry) disconnectSession(sessionId, entry.generation)
      const exitCode = event.processStatus?.exitCode
      stopTerminalContext(root, widgetId, codingContext.launchId)
      updateAgentStatus({
        branch,
        canvasId,
        widgetId,
        status: exitCode === 0 ? 'done' : 'error',
        message: event.processStatus?.message || (exitCode === 0 ? 'Agent finished' : 'Agent exited'),
        data: readinessOutput ? { output: readinessOutput.slice(-4000) } : null,
      })
      const { unbindWidget } = await import('../messaging/delivery.js')
      const { leavePresence } = await import('../messaging/presence.js')
      unbindWidget(widgetId)
      leavePresence(widgetId)
    }
    try {
      await initPaseoTerminalRuntime(root, { startupTimeoutMs: 30_000 })
      commandStarted = !warmSession
      const created = await createTerminalSession(sessionId, {
        runtimeSessionId,
        workspaceId,
        program: shell,
        args: warmSession ? [] : [shellFlag, command],
        cwd: agentRuntime.cwd,
        env: buildHostWorkloadEnv(codingRuntime, envMap),
        cols: 80,
        rows: 24,
      })
      const registered = registerSession({ branch, canvasId, widgetId, prettyName: null, runtimeSessionId })
      entry = registered.entry
      if (runtimeSessionId !== sessionId) adoptRuntimeSession(sessionId, runtimeSessionId)
      writeTerminalConfig({ branch, canvasId, widgetId, serverUrl, workspaceId, sessionId })
      updateAgentStatus({ branch, canvasId, widgetId, status: 'running', message: statusMessage })

      headlessSubscriptions.get(widgetId)?.close()
      const snapshot = await snapshotTerminalSession(sessionId)
      readinessOutput = warmSession ? '' : (snapshot.text || snapshot.screen || '')
      subscription = await subscribeTerminalSession(sessionId, {
        readOnly: true,
        afterSequence: snapshot.sequence || 0,
        onOutput: (event) => {
          readinessOutput += Buffer.from(event.bytes || []).toString('utf8')
          checkReadiness()
        },
        onExit: (event) => {
          if (!subscription) pendingExit = event
          else handleExit(event).catch(() => {})
        },
      })
      if (pendingExit || created.running === false) {
        await handleExit(pendingExit || { processStatus: created.processStatus })
        throw new Error('Agent process exited during startup')
      } else {
        headlessSubscriptions.set(widgetId, subscription)
      }

      if (warmSession) {
        await writeTerminalText(sessionId, command, { submit: true })
        commandStarted = true
      }
      checkReadiness()
      readinessTimer = agentConfig?.readinessSignal
        ? setTimeout(() => rejectReadiness(new Error(`Agent readiness timed out waiting for ${JSON.stringify(agentConfig.readinessSignal)}`)), 60_000)
        : setTimeout(resolveReadiness, 1500)
      readinessTimer.unref?.()
      readiness.then(async () => {
        if (readinessTimer) clearTimeout(readinessTimer)
        if (headlessSubscriptions.get(widgetId) !== subscription) return
        updateAgentStatus({ branch, canvasId, widgetId, status: 'ready', message: 'Agent ready' })
        if (!autopilot && agentConfig?.postStartup) await writeTerminalText(sessionId, agentConfig.postStartup, { submit: true }).catch(() => {})
        const { bindWidget } = await import('../messaging/delivery.js')
        const { joinPresence } = await import('../messaging/presence.js')
        await bindWidget({ widgetId, sessionId, branch, canvasId, displayName: widgetId }).catch(() => {})
        await joinPresence({ widgetId, senderName: widgetId, branch, canvasId }).catch(() => {})
      }).catch((error) => {
        if (headlessSubscriptions.get(widgetId) !== subscription) return
        updateAgentStatus({ branch, canvasId, widgetId, status: 'error', message: error.message })
      })

      return { branch, sessionId, runtimeSessionId, warm: Boolean(warmSession) }
    } catch (error) {
      stopTerminalContext(root, widgetId, codingContext.launchId)
      if (readinessTimer) clearTimeout(readinessTimer)
      subscription?.close()
      if (headlessSubscriptions.get(widgetId) === subscription) headlessSubscriptions.delete(widgetId)
      if (entry || commandStarted) await killSession(sessionId).catch(() => {})
      throw error
    }
  }

  let reqSocketPort = null

  return async (req, res, { body, path: routePath, method, __viteWs }) => {
    reqSocketPort = req?.socket?.localPort || reqSocketPort
    // GET /folders — list available canvas folders
    if (routePath === '/folders' && method === 'GET') {
      const canvasDir = canvasContentRoot(root)
      let folders = []
      let entries = []
      try {
        if (fs.existsSync(canvasDir)) {
          const dirEntries = fs.readdirSync(canvasDir, { withFileTypes: true })
          // .folder directories — workspace grouping (sibling canvases shown
          // under a folder header in the workspace, each addressable on its
          // own /canvas/<folder>/<name> route).
          const folderDirs = dirEntries
            .filter((d) => d.isDirectory() && d.name.endsWith('.folder'))
            .map((d) => d.name.replace('.folder', ''))
          // Plain directories containing .canvas.jsonl files — multi-page
          // canvas grouping (each .canvas.jsonl is a "page" of the parent
          // group, surfaced via PageSelector inside the canvas).
          const plainDirs = dirEntries
            .filter((d) => {
              if (!d.isDirectory() || d.name.endsWith('.folder') || d.name.startsWith('_')) return false
              const files = fs.readdirSync(path.join(canvasDir, d.name))
              return files.some((f) => f.endsWith('.canvas.jsonl'))
            })
            .map((d) => d.name)
          folders = [...folderDirs, ...plainDirs]
          entries = [
            ...folderDirs.map((name) => ({ name, kind: 'workspace' })),
            ...plainDirs.map((name) => ({ name, kind: 'pages' })),
          ]
        }
      } catch { /* empty */ }
      // `folders` is the legacy flat name list; `entries` is the new tagged
      // list. Clients can prefer `entries` when they need to know whether a
      // folder is a `.folder/` (workspace) or plain (multi-page) dir.
      sendJson(res, 200, { folders, entries })
      return
    }

    // GET /roles — list hub role definitions from .agents/roles/*.role.md
    if (routePath === '/roles' && method === 'GET') {
      const roles = listHubRoles(root)
      const defaultRole = getDefaultRoleId(roles)
      sendJson(res, 200, { roles, defaultRole, defaultRoleId: defaultRole })
      return
    }

    // GET /read?name=... — read materialized canvas data from disk
    if (routePath.startsWith('/read') && method === 'GET') {
      const url = new URL(routePath, 'http://localhost')
      const name = url.searchParams.get('name')
      if (!name) {
        sendJson(res, 400, { error: 'Canvas name is required (?name=...)' })
        return
      }
      const filePath = findCanvasPath(root, name)
      if (!filePath) {
        sendJson(res, 404, { error: `Canvas "${name}" not found` })
        return
      }
      try {
        const data = readCanvas(filePath)
        const widgetFilter = url.searchParams.get('widget')
        if (widgetFilter) {
          const widget = (data.widgets || []).find((w) => w.id === widgetFilter)
          if (!widget) {
            sendJson(res, 404, { error: `Widget "${widgetFilter}" not found in canvas "${name}"` })
            return
          }
          sendJson(res, 200, { ...data, widgets: [widget] })
        } else {
          sendJson(res, 200, data)
        }
      } catch (err) {
        sendJson(res, 500, { error: `Failed to read canvas: ${err.message}` })
      }
      return
    }

    // GET /list — list all canvases
    if (routePath === '/list' && method === 'GET') {
      const files = findCanvasFiles(root)
      const canvases = files.map((file) => {
        const id = canvasIdForFile(file)
        if (!id) return null
        const { segments } = parseCanvasId(id)
        const group = segments.length > 1 ? segments.slice(0, -1).join('/') : null
        try {
          const data = readCanvas(path.resolve(root, file))
          return {
            name: id,
            title: data.title || segments[segments.length - 1],
            path: file,
            widgetCount: (data.widgets || []).length + (data.sources || []).length,
            group,
          }
        } catch {
          return { name: id, title: segments[segments.length - 1], path: file, widgetCount: 0, group }
        }
      }).filter(Boolean)
      const groups = findCanvasMeta(root)

      // Sort canvases within each group by saved pageOrder from .meta.json
      const groupOrderMaps = new Map()
      for (const [groupName, meta] of Object.entries(groups)) {
        if (Array.isArray(meta.pageOrder)) {
          const orderMap = new Map()
          meta.pageOrder.forEach((entry, idx) => {
            if (typeof entry === 'string' && !entry.startsWith('sep-')) orderMap.set(entry, idx)
          })
          groupOrderMaps.set(groupName, orderMap)
        }
      }
      if (groupOrderMaps.size > 0) {
        canvases.sort((a, b) => {
          if (a.group !== b.group) return 0
          const orderMap = a.group ? groupOrderMaps.get(a.group) : null
          if (!orderMap) return 0
          const ai = orderMap.has(a.name) ? orderMap.get(a.name) : Infinity
          const bi = orderMap.has(b.name) ? orderMap.get(b.name) : Infinity
          return ai - bi
        })
      }

      sendJson(res, 200, { canvases, groups })
      return
    }

    // PUT /update — append update events to the canvas stream
    if (routePath === '/update' && method === 'PUT') {
      const { name, widgets, sources, settings, connectors } = body

      if (!name) {
        sendJson(res, 400, { error: 'Canvas name is required' })
        return
      }

      const filePath = findCanvasPath(root, name)
      if (!filePath) {
        sendJson(res, 404, { error: `Canvas "${name}" not found` })
        return
      }

      try {
        const ts = new Date().toISOString()
        // Snapshot of pre-update state so we can stamp prev* payloads on
        // source_updated and settings_updated events without re-reading.
        const current = readCanvas(filePath)

        if (widgets) {
          // Guard against accidental canvas wipes. Any widget IDs present in
          // current but missing from the incoming array are deletions; we
          // refuse those unless the caller explicitly opts in via replaceAll.
          // This protects against stale-state writers (e.g. a debounced client
          // save fired before an HMR push containing newly-added widgets was
          // reconciled) silently wiping freshly-created widgets.
          const currentWidgets = current.widgets || []
          if (body.replaceAll !== true) {
            const incomingIds = new Set(widgets.map((w) => w && w.id).filter(Boolean))
            const missing = currentWidgets.filter((w) => !incomingIds.has(w.id))
            if (missing.length > 0) {
              sendJson(res, 400, {
                error: `Refusing to drop ${missing.length} widget(s) on PUT /update. `
                  + `Missing IDs: ${missing.map((w) => w.id).slice(0, 10).join(', ')}${missing.length > 10 ? '…' : ''}. `
                  + `Use DELETE /_storyboard/canvas/widget to remove widgets, PATCH to update them, `
                  + `or pass "replaceAll": true to confirm full replacement.`,
                missingIds: missing.map((w) => w.id),
              })
              return
            }
          }
          const stamped = stampBoundsAll(widgets)
          // widgets_replaced is not undoable — emitted only by compaction or
          // explicit replaceAll. The client should use PATCH/POST/DELETE for
          // granular, undoable changes.
          appendEvent(filePath, { event: 'widgets_replaced', timestamp: ts, widgets: stamped })
        }

        if (sources) {
          appendEvent(filePath, {
            event: 'source_updated',
            timestamp: ts,
            sources,
            prevSources: Array.isArray(current.sources) ? current.sources : [],
          })
        }

        if (connectors) {
          // connectors_replaced is not undoable — emitted only by compaction.
          appendEvent(filePath, { event: 'connectors_replaced', timestamp: ts, connectors })
        }

        if (settings) {
          const filtered = {}
          for (const [key, value] of Object.entries(settings)) {
            if (['title', 'description', 'grid', 'gridSize', 'colorMode', 'dotted', 'centered', 'author', 'snapToGrid', 'connectorStyle', 'layout', 'className'].includes(key)) {
              filtered[key] = value
            }
          }
          if (Object.keys(filtered).length > 0) {
            // Capture prior values for the keys being changed.
            const prevSettings = {}
            for (const key of Object.keys(filtered)) {
              prevSettings[key] = current[key]
            }
            appendEvent(filePath, {
              event: 'settings_updated',
              timestamp: ts,
              settings: filtered,
              prevSettings,
            })
          }
        }

        await pushCanvasUpdate(name, filePath, __viteWs)
        sendJson(res, 200, { success: true, name })
      } catch (err) {
        sendJson(res, 500, { error: `Failed to update canvas: ${err.message}` })
      }
      return
    }

    // POST /undo — append the inverse of a previously-applied event, tagged
    // with meta.kind = 'undo' / meta.of = <targetEventId>. Body:
    //   { name, eventId }
    // Returns { success, eventId, inverseEvent: {...} }.
    //
    // POST /redo behaves identically but stamps meta.kind = 'redo'. Per
    // convention the client passes the id of the *undo* event when redoing
    // (so the redo cancels the undo and brings back the original change).
    if ((routePath === '/undo' || routePath === '/redo') && method === 'POST') {
      const { name, eventId } = body
      const kind = routePath === '/undo' ? 'undo' : 'redo'

      if (!name || !eventId) {
        sendJson(res, 400, { error: 'Canvas name and eventId are required' })
        return
      }

      const filePath = findCanvasPath(root, name)
      if (!filePath) {
        sendJson(res, 404, { error: `Canvas "${name}" not found` })
        return
      }

      try {
        const text = fs.readFileSync(filePath, 'utf-8')
        const events = parseCanvasJsonl(text)
        const target = events.find((evt) => evt && evt.id === eventId)
        if (!target) {
          sendJson(res, 404, { error: `Event "${eventId}" not found in canvas "${name}"` })
          return
        }

        const inverse = buildInverseEvent(target, kind)
        if (!inverse) {
          sendJson(res, 400, {
            error: `Event "${eventId}" (type "${target.event}") cannot be ${kind === 'undo' ? 'undone' : 'redone'}: missing inverse payload or unsupported event type`,
          })
          return
        }

        inverse.timestamp = new Date().toISOString()
        const inverseId = appendEvent(filePath, inverse)

        await pushCanvasUpdate(name, filePath, __viteWs)
        sendJson(res, 200, {
          success: true,
          eventId: inverseId,
          inverseEvent: { ...inverse, id: inverseId },
        })
      } catch (err) {
        sendJson(res, 500, { error: `Failed to ${kind} event: ${err.message}` })
      }
      return
    }

    // POST /widget — append a widget_added event
    if (routePath === '/widget' && method === 'POST') {
      const { name, type, props: requestedProps = {}, pool, near, direction, resolve, source, gap } = body
      const props = requestedProps && typeof requestedProps === 'object' ? requestedProps : {}
      let position = body.position || { x: 0, y: 0 }

      // Detect whether the caller provided an explicit position.
      // `near === false` is the explicit opt-out ("put it exactly here").
      const hasExplicitPosition = body.position && (body.position.x !== 0 || body.position.y !== 0)
      const hasNearOptOut = near === false
      const needsAutoPosition = !near && !hasExplicitPosition && !hasNearOptOut

      if (!name) {
        sendJson(res, 400, { error: 'Canvas name is required' })
        return
      }
      if (!type) {
        sendJson(res, 400, { error: 'Widget type is required' })
        return
      }

      const filePath = findCanvasPath(root, name)
      if (!filePath) {
        sendJson(res, 404, { error: `Canvas "${name}" not found` })
        return
      }

      try {
        // Always read canvas when we need near, resolve, or auto-positioning
        const needsCanvasRead = near || resolve || needsAutoPosition
        let canvasWidgets = null
        let canvasData = null
        if (needsCanvasRead) {
          canvasData = readCanvas(filePath)
          canvasWidgets = canvasData.widgets || []
        }

        if (near) {
          const refWidget = canvasWidgets.find((w) => w.id === near)
          if (!refWidget) {
            sendJson(res, 400, { error: `Widget "${near}" not found (--near)` })
            return
          }
          position = computeNearPosition(refWidget, direction || 'right', type, props, gap, (canvasData && canvasData.gridSize) || 24)
        }

        // Auto-position: no --near, no explicit x,y → smart default
        if (needsAutoPosition && !near) {
          position = await computeAutoPosition(canvasWidgets, type, props, root, name, source || null)
        }

        if (near || resolve || needsAutoPosition) {
          const gs = (canvasData && canvasData.gridSize) || 24
          const resolved = resolvePosition({
            x: position.x, y: position.y, type, props,
            widgets: canvasWidgets,
            gridSize: gs,
            // When the user supplied --gap (grid spaces), use the same spacing
            // for collision cascades so cascaded widgets keep the gap, not just
            // sit one gridSize apart.
            gap: near && typeof gap === 'number' ? gap * gs : null,
            preferAxis: near ? directionPreferAxis(direction) : 'horizontal',
          })
          position = { x: resolved.x, y: resolved.y }
        }

        const widgetId = generateWidgetId(type)

        await prepareTerminalWidget({ type, props, widgetId, canvasName: name, req })

        // Hot pool readiness probe for terminal/agent widgets — non-mutating.
        // The actual session claim happens later in terminal-server when the
        // WS connects. Probing here only tells the client whether a hot
        // session is available. (Previously this called acquireFromPool,
        // which leaked a #acquired slot per widget creation because no
        // consume/release ever fired against this acquisition.)
        let hotProbe = { ready: false }
        if ((type === 'terminal' || type === 'agent') && pool !== 'cold') {
          const poolId = resolvePoolId(type, props)
          hotProbe = peekPool(hotPool, poolId, pool)
          if (!hotProbe.ready && pool === 'hot') {
            sendJson(res, 409, { error: `No warm sessions available in pool "${poolId}"` })
            return
          }
        }

        const widget = stampBounds({ id: widgetId, type, position, props })

        const eventId = appendEvent(filePath, {
          event: 'widget_added',
          timestamp: new Date().toISOString(),
          widget,
        })

        const response = { success: true, widget, eventId }
        if (hotProbe.ready) response.hotSession = { id: null, runtimeSessionId: null }
        await pushCanvasUpdate(name, filePath, __viteWs)
        sendJson(res, 201, response)
      } catch (err) {
        sendJson(res, 500, { error: `Failed to add widget: ${err.message}`, code: err.code || null })
      }
      return
    }

    // DELETE /widget — append a widget_removed event
    if (routePath === '/widget' && method === 'DELETE') {
      const { name, widgetId } = body

      if (!name || !widgetId) {
        sendJson(res, 400, { error: 'Canvas name and widgetId are required' })
        return
      }

      const filePath = findCanvasPath(root, name)
      if (!filePath) {
        sendJson(res, 404, { error: `Canvas "${name}" not found` })
        return
      }

      try {
        // Verify the widget exists before appending the removal event
        const data = readCanvas(filePath)
        const widget = (data.widgets || []).find((w) => w.id === widgetId)
        if (!widget) {
          sendJson(res, 404, { error: `Widget "${widgetId}" not found in canvas "${name}"` })
          return
        }

        const eventId = appendEvent(filePath, {
          event: 'widget_removed',
          timestamp: new Date().toISOString(),
          widgetId,
          // Carry the full removed widget so undo can re-add it without
          // walking history. Symmetric to widget_added.widget.
          widget,
        })

        // Orphan terminal session when a terminal widget is deleted (not killed)
        if (widget.type === 'terminal' || widget.type === 'agent') {
          try {
            const { orphanTerminalSession } = await import('./terminal-server.js')
            orphanTerminalSession(widgetId)
          } catch (err) {
            devLog().logEvent('warn', `Failed to orphan terminal session for ${widgetId}`, { widgetId, error: err.message })
          }
        }

        await pushCanvasUpdate(name, filePath, __viteWs)
        sendJson(res, 200, { success: true, removed: 1, eventId })
      } catch (err) {
        sendJson(res, 500, { error: `Failed to remove widget: ${err.message}` })
      }
      return
    }

    // PATCH /widget — update a single widget's props
    if (routePath === '/widget' && method === 'PATCH') {
      const { name, widgetId, props, position } = body

      if (!name || !widgetId) {
        sendJson(res, 400, { error: 'Canvas name and widgetId are required' })
        return
      }
      if (!props && !position) {
        sendJson(res, 400, { error: 'At least one of props or position is required' })
        return
      }

      const filePath = findCanvasPath(root, name)
      if (!filePath) {
        sendJson(res, 404, { error: `Canvas "${name}" not found` })
        return
      }

      try {
        const data = readCanvas(filePath)
        const widget = (data.widgets || []).find((w) => w.id === widgetId)
        if (!widget) {
          sendJson(res, 404, { error: `Widget "${widgetId}" not found in canvas "${name}"` })
          return
        }

        const ts = new Date().toISOString()
        const eventIds = []

        if (props) {
          // Capture only the keys being changed so undo restores them
          // precisely. Missing keys mean "this prop didn't exist before".
          const prevProps = {}
          for (const key of Object.keys(props)) {
            prevProps[key] = widget.props ? widget.props[key] : undefined
          }
          eventIds.push(appendEvent(filePath, {
            event: 'widget_updated',
            timestamp: ts,
            widgetId,
            props,
            prevProps,
          }))
        }

        if (position) {
          // Merge with existing position so partial updates (only --x or --y) are safe
          const mergedPosition = { ...widget.position, ...position }
          eventIds.push(appendEvent(filePath, {
            event: 'widget_moved',
            timestamp: ts,
            widgetId,
            position: mergedPosition,
            prevPosition: widget.position || { x: 0, y: 0 },
          }))
        }

        // Return the merged widget for convenience
        const merged = {
          ...widget,
          props: { ...widget.props, ...(props || {}) },
          position: position ? { ...widget.position, ...position } : widget.position,
        }
        await pushCanvasUpdate(name, filePath, __viteWs)
        sendJson(res, 200, { success: true, widget: merged, eventIds })
      } catch (err) {
        sendJson(res, 500, { error: `Failed to update widget: ${err.message}` })
      }
      return
    }

    // GET /alias — read alias for a widget
    if (routePath === '/alias' && method === 'GET') {
      const name = new URL(req.url, 'http://localhost').searchParams.get('canvas')
      const widgetId = new URL(req.url, 'http://localhost').searchParams.get('widgetId')
      if (!name || !widgetId) {
        sendJson(res, 400, { error: 'canvas and widgetId query params are required' })
        return
      }
      const filePath = findCanvasPath(root, name)
      if (!filePath) { sendJson(res, 404, { error: `Canvas "${name}" not found` }); return }
      try {
        const data = readCanvas(filePath)
        const widget = (data.widgets || []).find(w => w.id === widgetId)
        if (!widget) { sendJson(res, 404, { error: `Widget "${widgetId}" not found` }); return }
        sendJson(res, 200, { widgetId, alias: widget.props?.alias || null, prettyName: widget.props?.prettyName || null })
      } catch (err) {
        sendJson(res, 500, { error: err.message })
      }
      return
    }

    // PUT /alias — set alias for a widget
    if (routePath === '/alias' && method === 'PUT') {
      const { canvas: name, widgetId, alias } = body
      if (!name || !widgetId || !alias) {
        sendJson(res, 400, { error: 'canvas, widgetId, and alias are required' })
        return
      }
      const filePath = findCanvasPath(root, name)
      if (!filePath) { sendJson(res, 404, { error: `Canvas "${name}" not found` }); return }
      try {
        const data = readCanvas(filePath)
        const widget = (data.widgets || []).find(w => w.id === widgetId)
        if (!widget) { sendJson(res, 404, { error: `Widget "${widgetId}" not found` }); return }
        // Persist the alias and refresh derived Hub context.
        appendEventRaw(filePath, {
          event: 'widget_updated',
          timestamp: new Date().toISOString(),
          widgetId,
          props: { alias },
        })
        await pushCanvasUpdate(name, filePath, __viteWs)
        sendJson(res, 200, { success: true, widgetId, alias })
      } catch (err) {
        sendJson(res, 500, { error: err.message })
      }
      return
    }

    // DELETE /alias — clear alias for a widget
    if (routePath === '/alias' && method === 'DELETE') {
      const { canvas: name, widgetId } = body
      if (!name || !widgetId) {
        sendJson(res, 400, { error: 'canvas and widgetId are required' })
        return
      }
      const filePath = findCanvasPath(root, name)
      if (!filePath) { sendJson(res, 404, { error: `Canvas "${name}" not found` }); return }
      try {
        const data = readCanvas(filePath)
        const widget = (data.widgets || []).find(w => w.id === widgetId)
        if (!widget) { sendJson(res, 404, { error: `Widget "${widgetId}" not found` }); return }
        appendEventRaw(filePath, {
          event: 'widget_updated',
          timestamp: new Date().toISOString(),
          widgetId,
          props: { alias: '' },
        })
        await pushCanvasUpdate(name, filePath, __viteWs)
        sendJson(res, 200, { success: true, widgetId, alias: null })
      } catch (err) {
        sendJson(res, 500, { error: err.message })
      }
      return
    }

    // POST /connector — append a connector_added event
    if (routePath === '/connector' && method === 'POST') {
      let { name, startWidgetId, startAnchor, endWidgetId, endAnchor, connectorType = 'default', meta = null,
        className = null, style = null, startEndpoint = null, endEndpoint = null } = body
      const customData = body.data && typeof body.data === 'object' ? body.data : null

      if (!name) {
        sendJson(res, 400, { error: 'Canvas name is required' })
        return
      }
      if (!startWidgetId || !endWidgetId) {
        sendJson(res, 400, { error: 'startWidgetId and endWidgetId are required' })
        return
      }
      if (startWidgetId === endWidgetId) {
        sendJson(res, 400, { error: 'Cannot connect a widget to itself' })
        return
      }

      const filePath = findCanvasPath(root, name)
      if (!filePath) {
        sendJson(res, 404, { error: `Canvas "${name}" not found` })
        return
      }

      try {
        const data = readCanvas(filePath)
        const widgets = data.widgets || []
        const widgetMap = new Map(widgets.map((w) => [w.id, w]))

        if (!widgetMap.has(startWidgetId)) {
          sendJson(res, 404, { error: `Widget "${startWidgetId}" not found` })
          return
        }
        if (!widgetMap.has(endWidgetId)) {
          sendJson(res, 404, { error: `Widget "${endWidgetId}" not found` })
          return
        }

        // Auto-calculate optimal anchors if not provided
        const validAnchors = ['top', 'bottom', 'left', 'right']
        if (!startAnchor || !endAnchor) {
          const computed = findBestAnchors(widgetMap.get(startWidgetId), widgetMap.get(endWidgetId))
          if (!startAnchor) startAnchor = computed.startAnchor
          if (!endAnchor) endAnchor = computed.endAnchor
        }

        // Validate anchors (if explicitly provided)
        if (!validAnchors.includes(startAnchor) || !validAnchors.includes(endAnchor)) {
          sendJson(res, 400, { error: `Anchors must be one of: ${validAnchors.join(', ')}` })
          return
        }

        const validEndpoints = ['circle', 'arrow-start', 'arrow-end', 'none']
        if (startEndpoint != null && !validEndpoints.includes(startEndpoint)) {
          sendJson(res, 400, { error: `startEndpoint must be one of: ${validEndpoints.join(', ')}` })
          return
        }
        if (endEndpoint != null && !validEndpoints.includes(endEndpoint)) {
          sendJson(res, 400, { error: `endEndpoint must be one of: ${validEndpoints.join(', ')}` })
          return
        }

        const connectorId = generateWidgetId('connector')
        const connector = {
          id: connectorId,
          type: 'connector',
          connectorType,
          start: { widgetId: startWidgetId, anchor: startAnchor },
          end: { widgetId: endWidgetId, anchor: endAnchor },
          meta: meta && typeof meta === 'object' ? { ...meta } : {},
        }
        // Optional presentational fields — only stamped when explicitly provided
        // so legacy connectors stay byte-identical.
        if (typeof className === 'string' && className) connector.className = className
        if (style && typeof style === 'object') connector.style = { ...style }
        if (customData) connector.data = { ...customData }
        if (startEndpoint) connector.startEndpoint = startEndpoint
        if (endEndpoint) connector.endEndpoint = endEndpoint

        const eventId = appendEvent(filePath, {
          event: 'connector_added',
          timestamp: new Date().toISOString(),
          connector,
        })

        await pushCanvasUpdate(name, filePath, __viteWs)
        sendJson(res, 201, { success: true, connector, eventId })
      } catch (err) {
        sendJson(res, 500, { error: `Failed to add connector: ${err.message}` })
      }
      return
    }

    // PATCH /connector — update connector anchors, meta, or presentational fields
    if (routePath === '/connector' && method === 'PATCH') {
      const { name, connectorId, meta, startAnchor, endAnchor,
        className, style, startEndpoint, endEndpoint } = body
      const customData = Object.prototype.hasOwnProperty.call(body, 'data') ? body.data : undefined

      if (!name || !connectorId) {
        sendJson(res, 400, { error: 'Canvas name and connectorId are required' })
        return
      }

      const filePath = findCanvasPath(root, name)
      if (!filePath) {
        sendJson(res, 404, { error: `Canvas "${name}" not found` })
        return
      }

      try {
        const data = readCanvas(filePath)
        const connector = (data.connectors || []).find((c) => c.id === connectorId)
        if (!connector) {
          sendJson(res, 404, { error: `Connector "${connectorId}" not found in canvas "${name}"` })
          return
        }

        const validAnchors = ['top', 'right', 'bottom', 'left']
        if (startAnchor && !validAnchors.includes(startAnchor)) {
          sendJson(res, 400, { error: `Invalid startAnchor "${startAnchor}". Must be one of: ${validAnchors.join(', ')}` })
          return
        }
        if (endAnchor && !validAnchors.includes(endAnchor)) {
          sendJson(res, 400, { error: `Invalid endAnchor "${endAnchor}". Must be one of: ${validAnchors.join(', ')}` })
          return
        }

        const validEndpoints = ['circle', 'arrow-start', 'arrow-end', 'none']
        if (startEndpoint != null && !validEndpoints.includes(startEndpoint)) {
          sendJson(res, 400, { error: `startEndpoint must be one of: ${validEndpoints.join(', ')}` })
          return
        }
        if (endEndpoint != null && !validEndpoints.includes(endEndpoint)) {
          sendJson(res, 400, { error: `endEndpoint must be one of: ${validEndpoints.join(', ')}` })
          return
        }

        const updates = {}
        if (meta) updates.meta = { ...meta }
        if (startAnchor) updates.startAnchor = startAnchor
        if (endAnchor) updates.endAnchor = endAnchor
        // Presentational fields: explicit `null` clears, an object merges,
        // anything else is ignored. Mirrors the materializer's handling.
        if (className !== undefined) updates.className = className
        if (style !== undefined) updates.style = style
        if (customData !== undefined) updates.data = customData
        if (startEndpoint !== undefined) updates.startEndpoint = startEndpoint
        if (endEndpoint !== undefined) updates.endEndpoint = endEndpoint

        // Capture the previous values for the keys we're changing so undo
        // can restore them precisely.
        const prevUpdates = {}
        if (meta) {
          const prevMeta = {}
          for (const key of Object.keys(meta)) {
            prevMeta[key] = connector.meta ? connector.meta[key] : undefined
          }
          prevUpdates.meta = prevMeta
        }
        if (startAnchor) prevUpdates.startAnchor = connector.start?.anchor
        if (endAnchor) prevUpdates.endAnchor = connector.end?.anchor
        if (className !== undefined) prevUpdates.className = connector.className ?? null
        if (style !== undefined) {
          // Track only the keys being changed so undo restores exact prior values
          if (style && typeof style === 'object') {
            const prevStyle = {}
            for (const key of Object.keys(style)) {
              prevStyle[key] = connector.style ? connector.style[key] : undefined
            }
            prevUpdates.style = prevStyle
          } else {
            prevUpdates.style = connector.style ?? null
          }
        }
        if (customData !== undefined) {
          if (customData && typeof customData === 'object') {
            const prevData = {}
            for (const key of Object.keys(customData)) {
              prevData[key] = connector.data ? connector.data[key] : undefined
            }
            prevUpdates.data = prevData
          } else {
            prevUpdates.data = connector.data ?? null
          }
        }
        if (startEndpoint !== undefined) prevUpdates.startEndpoint = connector.startEndpoint ?? null
        if (endEndpoint !== undefined) prevUpdates.endEndpoint = connector.endEndpoint ?? null

        const eventId = appendEvent(filePath, {
          event: 'connector_updated',
          timestamp: new Date().toISOString(),
          connectorId,
          updates,
          prevUpdates,
        })

        await pushCanvasUpdate(name, filePath, __viteWs)
        sendJson(res, 200, { success: true, eventId })

      } catch (err) {
        sendJson(res, 500, { error: `Failed to update connector: ${err.message}` })
      }
      return
    }

    // POST /connector/waypoints — set/replace manual routing waypoints on a connector
    if (routePath === '/connector/waypoints' && method === 'POST') {
      const { name, connectorId, waypoints } = body

      if (!name || !connectorId) {
        sendJson(res, 400, { error: 'Canvas name and connectorId are required' })
        return
      }
      if (!Array.isArray(waypoints)) {
        sendJson(res, 400, { error: 'waypoints must be an array of { dx, dy, tHint? } objects' })
        return
      }
      // Validate each waypoint
      for (let i = 0; i < waypoints.length; i++) {
        const wp = waypoints[i]
        if (!wp || typeof wp !== 'object' || typeof wp.dx !== 'number' || typeof wp.dy !== 'number') {
          sendJson(res, 400, { error: `waypoints[${i}] must have numeric dx and dy` })
          return
        }
      }

      const filePath = findCanvasPath(root, name)
      if (!filePath) {
        sendJson(res, 404, { error: `Canvas "${name}" not found` })
        return
      }

      try {
        const data = readCanvas(filePath)
        const existing = (data.connectors || []).find((c) => c.id === connectorId)
        if (!existing) {
          sendJson(res, 404, { error: `Connector "${connectorId}" not found in canvas "${name}"` })
          return
        }

        // Normalize waypoints — keep only known fields
        const normalized = waypoints.map((wp) => {
          const out = { dx: wp.dx, dy: wp.dy }
          if (typeof wp.tHint === 'number') out.tHint = wp.tHint
          if (wp.orientation === 'h' || wp.orientation === 'v') out.orientation = wp.orientation
          return out
        })

        const eventId = appendEvent(filePath, {
          event: 'connector_waypoints_set',
          timestamp: new Date().toISOString(),
          connectorId,
          waypoints: normalized,
          // null prevWaypoints means "this connector had no manual routing
          // before"; undo emits connector_waypoints_cleared in that case.
          prevWaypoints: Array.isArray(existing.waypoints) ? existing.waypoints : null,
        })

        await pushCanvasUpdate(name, filePath, __viteWs)
        sendJson(res, 200, { success: true, waypoints: normalized, eventId })
      } catch (err) {
        sendJson(res, 500, { error: `Failed to set waypoints: ${err.message}` })
      }
      return
    }

    // DELETE /connector/waypoints — clear manual routing, revert to auto-routing
    if (routePath === '/connector/waypoints' && method === 'DELETE') {
      const { name, connectorId } = body

      if (!name || !connectorId) {
        sendJson(res, 400, { error: 'Canvas name and connectorId are required' })
        return
      }

      const filePath = findCanvasPath(root, name)
      if (!filePath) {
        sendJson(res, 404, { error: `Canvas "${name}" not found` })
        return
      }

      try {
        const data = readCanvas(filePath)
        const existing = (data.connectors || []).find((c) => c.id === connectorId)
        if (!existing) {
          sendJson(res, 404, { error: `Connector "${connectorId}" not found in canvas "${name}"` })
          return
        }

        const eventId = appendEvent(filePath, {
          event: 'connector_waypoints_cleared',
          timestamp: new Date().toISOString(),
          connectorId,
          prevWaypoints: Array.isArray(existing.waypoints) ? existing.waypoints : null,
        })

        await pushCanvasUpdate(name, filePath, __viteWs)
        sendJson(res, 200, { success: true, eventId })
      } catch (err) {
        sendJson(res, 500, { error: `Failed to clear waypoints: ${err.message}` })
      }
      return
    }

    // DELETE /connector — append a connector_removed event
    if (routePath === '/connector' && method === 'DELETE') {
      const { name, connectorId } = body

      if (!name || !connectorId) {
        sendJson(res, 400, { error: 'Canvas name and connectorId are required' })
        return
      }

      const filePath = findCanvasPath(root, name)
      if (!filePath) {
        sendJson(res, 404, { error: `Canvas "${name}" not found` })
        return
      }

      try {
        const data = readCanvas(filePath)
        const connector = (data.connectors || []).find((c) => c.id === connectorId)
        if (!connector) {
          sendJson(res, 404, { error: `Connector "${connectorId}" not found in canvas "${name}"` })
          return
        }

        const eventId = appendEvent(filePath, {
          event: 'connector_removed',
          timestamp: new Date().toISOString(),
          connectorId,
          // Carry the full removed connector so undo can re-add it without
          // walking history. Symmetric to connector_added.connector.
          connector,
        })

        await pushCanvasUpdate(name, filePath, __viteWs)
        sendJson(res, 200, { success: true, removed: 1, eventId })
      } catch (err) {
        sendJson(res, 500, { error: `Failed to remove connector: ${err.message}` })
      }
      return
    }

    // POST /broadcast — toggle broadcast messaging for a widget and its connections.
    // Default: direct neighbors only. passThrough: true → BFS full connected component.
    if (routePath === '/broadcast' && method === 'POST') {
      const { name, widgetId, mode = 'two-way', passThrough = false } = body

      if (!name || !widgetId) {
        sendJson(res, 400, { error: 'Canvas name and widgetId are required' })
        return
      }
      if (mode !== 'two-way' && mode !== 'one-way' && mode !== 'none') {
        sendJson(res, 400, { error: 'mode must be "two-way", "one-way", or "none"' })
        return
      }

      const filePath = findCanvasPath(root, name)
      if (!filePath) {
        sendJson(res, 404, { error: `Canvas "${name}" not found` })
        return
      }

      try {
        const data = readCanvas(filePath)
        const widgets = data.widgets || []
        const connectors = data.connectors || []
        const widgetMap = new Map(widgets.map((w) => [w.id, w]))

        const sourceWidget = widgetMap.get(widgetId)
        if (!sourceWidget) {
          sendJson(res, 404, { error: `Widget "${widgetId}" not found` })
          return
        }

        const isTerminalType = (w) => w && (w.type === 'terminal' || w.type === 'agent')

        // Find connectors to update via BFS (or direct neighbors only)
        const affectedConnectorIds = new Set()
        const affectedWidgetIds = new Set([widgetId])

        if (passThrough) {
          // BFS: traverse entire connected component of terminal/agent widgets
          const visited = new Set([widgetId])
          const queue = [widgetId]
          while (queue.length > 0) {
            const current = queue.shift()
            for (const conn of connectors) {
              let peerId = null
              if (conn.start?.widgetId === current && conn.end?.widgetId) peerId = conn.end.widgetId
              if (conn.end?.widgetId === current && conn.start?.widgetId) peerId = conn.start.widgetId
              if (!peerId || visited.has(peerId)) continue
              const peer = widgetMap.get(peerId)
              if (!isTerminalType(peer)) continue
              affectedConnectorIds.add(conn.id)
              affectedWidgetIds.add(peerId)
              visited.add(peerId)
              queue.push(peerId)
            }
          }
        } else {
          // Direct neighbors only
          for (const conn of connectors) {
            let peerId = null
            if (conn.start?.widgetId === widgetId && conn.end?.widgetId) peerId = conn.end.widgetId
            if (conn.end?.widgetId === widgetId && conn.start?.widgetId) peerId = conn.start.widgetId
            if (!peerId) continue
            const peer = widgetMap.get(peerId)
            if (!isTerminalType(peer)) continue
            affectedConnectorIds.add(conn.id)
            affectedWidgetIds.add(peerId)
          }
        }

        // Update all affected connectors
        const ts = new Date().toISOString()
        const messagingMode = mode === 'none' ? null : mode
        for (const connId of affectedConnectorIds) {
          appendEvent(filePath, {
            event: 'connector_updated',
            timestamp: ts,
            connectorId: connId,
            updates: { meta: { messagingMode } },
          })
        }

        await pushCanvasUpdate(name, filePath, __viteWs)
        sendJson(res, 200, {
          success: true,
          affectedConnectors: [...affectedConnectorIds],
          affectedWidgets: [...affectedWidgetIds],
        })

      } catch (err) {
        sendJson(res, 500, { error: `Failed to update broadcast: ${err.message}` })
      }
      return
    }

    // POST /batch — execute multiple canvas operations in a single request.
    // Reads the canvas once, appends all events, pushes ONE HMR update at the end.
    // Operations reference earlier results via $index (auto) or $refName (opt-in).
    if (routePath === '/batch' && method === 'POST') {
      const { name, operations } = body

      if (!name) {
        sendJson(res, 400, { error: 'Canvas name is required' })
        return
      }
      if (!Array.isArray(operations) || operations.length === 0) {
        sendJson(res, 400, { error: 'operations must be a non-empty array' })
        return
      }
      if (operations.length > 200) {
        sendJson(res, 400, { error: 'Maximum 200 operations per batch' })
        return
      }

      const filePath = findCanvasPath(root, name)
      if (!filePath) {
        sendJson(res, 404, { error: `Canvas "${name}" not found` })
        return
      }

      try {
        const canvasData = readCanvas(filePath)
        const widgetIds = new Set((canvasData.widgets || []).map((w) => w.id))
        const connectorIds = new Set((canvasData.connectors || []).map((c) => c.id))
        const widgetMap = new Map((canvasData.widgets || []).map((w) => [w.id, { ...w }]))
        const connectorMap = new Map((canvasData.connectors || []).map((c) => [c.id, { ...c }]))

        const refs = {}
        const results = []
        const validAnchors = ['top', 'bottom', 'left', 'right']

        // Resolve $ref strings — "$0", "$myName", etc.
        function resolveRef(val) {
          if (typeof val !== 'string' || !val.startsWith('$')) return val
          const refName = val.slice(1)
          if (refs[refName] !== undefined) return refs[refName]
          throw new Error(`Unknown ref "${val}"`)
        }

        for (let i = 0; i < operations.length; i++) {
          const op = operations[i]
          const ts = new Date().toISOString()

          try {
            switch (op.op) {
              case 'create-widget': {
                const { type, props: requestedProps = {}, ref, pool, near, direction, resolve: doResolve, source: opSource, gap: opGap } = op
                const props = requestedProps && typeof requestedProps === 'object' ? requestedProps : {}
                let position = op.position || { x: 0, y: 0 }
                if (!type) throw new Error('type is required')

                // Detect whether an explicit position was provided
                const hasExplicitPos = op.position && (op.position.x !== 0 || op.position.y !== 0)
                const hasNearOptOut = near === false
                const needsAuto = !near && !hasExplicitPos && !hasNearOptOut

                // --near: compute position relative to a reference widget
                if (near) {
                  const nearId = resolveRef(near)
                  const refWidget = widgetMap.get(nearId)
                  if (!refWidget) throw new Error(`Widget "${nearId}" not found (near)`)
                  position = computeNearPosition(refWidget, direction || 'right', type, props, opGap, canvasData.gridSize || 24)
                }

                // Auto-position: no --near, no explicit x,y → smart default
                if (needsAuto && !near) {
                  const currentWidgets = Array.from(widgetMap.values())
                  position = await computeAutoPosition(currentWidgets, type, props, root, name, opSource || null)
                }

                // Collision resolution: uses live widgetMap (includes earlier batch creates)
                if (near || doResolve || needsAuto) {
                  const gs = canvasData.gridSize || 24
                  const resolved = resolvePosition({
                    x: position.x, y: position.y, type, props,
                    widgets: Array.from(widgetMap.values()),
                    gridSize: gs,
                    gap: near && typeof opGap === 'number' ? opGap * gs : null,
                    preferAxis: near ? directionPreferAxis(direction) : 'horizontal',
                  })
                  position = { x: resolved.x, y: resolved.y }
                }

                const widgetId = generateWidgetId(type)
                await prepareTerminalWidget({ type, props, widgetId, canvasName: name, req })

                let hotProbe = { ready: false }
                if ((type === 'terminal' || type === 'agent') && pool !== 'cold') {
                  const poolId = resolvePoolId(type, props)
                  hotProbe = peekPool(hotPool, poolId, pool)
                  if (!hotProbe.ready && pool === 'hot') throw new Error(`No warm sessions available in pool "${poolId}"`)
                }

                const widget = stampBounds({ id: widgetId, type, position, props })

                const eventId = appendEvent(filePath, { event: 'widget_added', timestamp: ts, widget })

                widgetIds.add(widgetId)
                widgetMap.set(widgetId, widget)
                refs[String(i)] = widgetId
                if (ref) refs[ref] = widgetId

                const result = { index: i, op: 'create-widget', ref: ref || undefined, widgetId, widget, eventId }
                if (hotProbe.ready) result.hotSession = { id: null, runtimeSessionId: null }
                results.push(result)
                break
              }

              case 'update-widget': {
                const widgetId = resolveRef(op.widgetId)
                const { props } = op
                if (!widgetId) throw new Error('widgetId is required')
                if (!props) throw new Error('props is required')
                if (!widgetIds.has(widgetId)) throw new Error(`Widget "${widgetId}" not found`)

                const existing = widgetMap.get(widgetId)
                const prevProps = {}
                for (const key of Object.keys(props)) {
                  prevProps[key] = existing?.props ? existing.props[key] : undefined
                }
                const eventId = appendEvent(filePath, { event: 'widget_updated', timestamp: ts, widgetId, props, prevProps })

                if (existing) existing.props = { ...existing.props, ...props }

                results.push({ index: i, op: 'update-widget', widgetId, success: true, eventId })
                break
              }

              case 'move-widget': {
                const widgetId = resolveRef(op.widgetId)
                const { position } = op
                if (!widgetId) throw new Error('widgetId is required')
                if (!position) throw new Error('position is required')
                if (!widgetIds.has(widgetId)) throw new Error(`Widget "${widgetId}" not found`)

                const existing = widgetMap.get(widgetId)
                const mergedPosition = { ...(existing?.position || {}), ...position }
                const prevPosition = existing?.position || { x: 0, y: 0 }

                const eventId = appendEvent(filePath, { event: 'widget_moved', timestamp: ts, widgetId, position: mergedPosition, prevPosition })

                if (existing) existing.position = mergedPosition

                results.push({ index: i, op: 'move-widget', widgetId, success: true, eventId })
                break
              }

              case 'delete-widget': {
                const widgetId = resolveRef(op.widgetId)
                if (!widgetId) throw new Error('widgetId is required')
                if (!widgetIds.has(widgetId)) throw new Error(`Widget "${widgetId}" not found`)

                const existing = widgetMap.get(widgetId)
                const eventId = appendEvent(filePath, {
                  event: 'widget_removed',
                  timestamp: ts,
                  widgetId,
                  widget: existing,
                })

                widgetIds.delete(widgetId)
                widgetMap.delete(widgetId)

                results.push({ index: i, op: 'delete-widget', widgetId, success: true, eventId })
                break
              }

              case 'create-connector': {
                const startWidgetId = resolveRef(op.startWidgetId)
                const endWidgetId = resolveRef(op.endWidgetId)
                let { startAnchor, endAnchor, connectorType = 'default', ref } = op

                if (!startWidgetId || !endWidgetId) throw new Error('startWidgetId and endWidgetId are required')
                if (startWidgetId === endWidgetId) throw new Error('Cannot connect a widget to itself')
                if (!widgetIds.has(startWidgetId)) throw new Error(`Widget "${startWidgetId}" not found`)
                if (!widgetIds.has(endWidgetId)) throw new Error(`Widget "${endWidgetId}" not found`)

                // Auto-calculate optimal anchors if not provided
                if (!startAnchor || !endAnchor) {
                  const computed = findBestAnchors(widgetMap.get(startWidgetId), widgetMap.get(endWidgetId))
                  if (!startAnchor) startAnchor = computed.startAnchor
                  if (!endAnchor) endAnchor = computed.endAnchor
                }

                if (!validAnchors.includes(startAnchor) || !validAnchors.includes(endAnchor)) {
                  throw new Error(`Anchors must be one of: ${validAnchors.join(', ')}`)
                }

                const validEndpoints = ['circle', 'arrow-start', 'arrow-end', 'none']
                if (op.startEndpoint != null && !validEndpoints.includes(op.startEndpoint)) {
                  throw new Error(`startEndpoint must be one of: ${validEndpoints.join(', ')}`)
                }
                if (op.endEndpoint != null && !validEndpoints.includes(op.endEndpoint)) {
                  throw new Error(`endEndpoint must be one of: ${validEndpoints.join(', ')}`)
                }

                const connectorId = generateWidgetId('connector')
                const connector = {
                  id: connectorId,
                  type: 'connector',
                  connectorType,
                  start: { widgetId: startWidgetId, anchor: startAnchor },
                  end: { widgetId: endWidgetId, anchor: endAnchor },
                  meta: op.meta && typeof op.meta === 'object' ? { ...op.meta } : {},
                }
                if (typeof op.className === 'string' && op.className) connector.className = op.className
                if (op.style && typeof op.style === 'object') connector.style = { ...op.style }
                if (op.data && typeof op.data === 'object') connector.data = { ...op.data }
                if (op.startEndpoint) connector.startEndpoint = op.startEndpoint
                if (op.endEndpoint) connector.endEndpoint = op.endEndpoint

                const eventId = appendEvent(filePath, { event: 'connector_added', timestamp: ts, connector })

                connectorIds.add(connectorId)
                connectorMap.set(connectorId, connector)
                refs[String(i)] = connectorId
                if (ref) refs[ref] = connectorId

                results.push({ index: i, op: 'create-connector', ref: ref || undefined, connectorId, success: true, eventId })
                break
              }

              case 'delete-connector': {
                const connectorId = resolveRef(op.connectorId)
                if (!connectorId) throw new Error('connectorId is required')
                if (!connectorIds.has(connectorId)) throw new Error(`Connector "${connectorId}" not found`)

                const existing = connectorMap.get(connectorId)
                const eventId = appendEvent(filePath, {
                  event: 'connector_removed',
                  timestamp: ts,
                  connectorId,
                  connector: existing,
                })
                connectorIds.delete(connectorId)
                connectorMap.delete(connectorId)

                results.push({ index: i, op: 'delete-connector', connectorId, success: true, eventId })
                break
              }

              case 'update-connector': {
                const connectorId = resolveRef(op.connectorId)
                const { meta, className, style, data: opData, startEndpoint, endEndpoint } = op
                if (!connectorId) throw new Error('connectorId is required')
                const hasPresentational = className !== undefined || style !== undefined
                  || opData !== undefined || startEndpoint !== undefined || endEndpoint !== undefined
                if (!meta && !hasPresentational) {
                  throw new Error('meta or a presentational field (className/style/data/startEndpoint/endEndpoint) is required')
                }
                if (!connectorIds.has(connectorId)) throw new Error(`Connector "${connectorId}" not found`)

                const validEndpoints = ['circle', 'arrow-start', 'arrow-end', 'none']
                if (startEndpoint != null && startEndpoint !== undefined && !validEndpoints.includes(startEndpoint)) {
                  throw new Error(`startEndpoint must be one of: ${validEndpoints.join(', ')}`)
                }
                if (endEndpoint != null && endEndpoint !== undefined && !validEndpoints.includes(endEndpoint)) {
                  throw new Error(`endEndpoint must be one of: ${validEndpoints.join(', ')}`)
                }

                const existing = connectorMap.get(connectorId)

                const updates = {}
                const prevUpdates = {}
                if (meta) {
                  updates.meta = meta
                  const prevMeta = {}
                  for (const key of Object.keys(meta)) {
                    prevMeta[key] = existing?.meta ? existing.meta[key] : undefined
                  }
                  prevUpdates.meta = prevMeta
                }
                if (className !== undefined) {
                  updates.className = className
                  prevUpdates.className = existing?.className ?? null
                }
                if (style !== undefined) {
                  updates.style = style
                  if (style && typeof style === 'object') {
                    const prevStyle = {}
                    for (const key of Object.keys(style)) {
                      prevStyle[key] = existing?.style ? existing.style[key] : undefined
                    }
                    prevUpdates.style = prevStyle
                  } else {
                    prevUpdates.style = existing?.style ?? null
                  }
                }
                if (opData !== undefined) {
                  updates.data = opData
                  if (opData && typeof opData === 'object') {
                    const prevD = {}
                    for (const key of Object.keys(opData)) {
                      prevD[key] = existing?.data ? existing.data[key] : undefined
                    }
                    prevUpdates.data = prevD
                  } else {
                    prevUpdates.data = existing?.data ?? null
                  }
                }
                if (startEndpoint !== undefined) {
                  updates.startEndpoint = startEndpoint
                  prevUpdates.startEndpoint = existing?.startEndpoint ?? null
                }
                if (endEndpoint !== undefined) {
                  updates.endEndpoint = endEndpoint
                  prevUpdates.endEndpoint = existing?.endEndpoint ?? null
                }

                const eventId = appendEvent(filePath, {
                  event: 'connector_updated',
                  timestamp: ts,
                  connectorId,
                  updates,
                  prevUpdates,
                })

                if (existing) {
                  if (meta) existing.meta = { ...(existing.meta || {}), ...meta }
                  if (className === null) delete existing.className
                  else if (typeof className === 'string') existing.className = className
                  if (style === null) delete existing.style
                  else if (style && typeof style === 'object') existing.style = { ...(existing.style || {}), ...style }
                  if (opData === null) delete existing.data
                  else if (opData && typeof opData === 'object') existing.data = { ...(existing.data || {}), ...opData }
                  if (startEndpoint === null) delete existing.startEndpoint
                  else if (startEndpoint) existing.startEndpoint = startEndpoint
                  if (endEndpoint === null) delete existing.endEndpoint
                  else if (endEndpoint) existing.endEndpoint = endEndpoint
                }

                results.push({ index: i, op: 'update-connector', connectorId, success: true, eventId })
                break
              }

              case 'broadcast': {
                const wId = resolveRef(op.widgetId)
                const mode = op.mode || 'two-way'
                const passThrough = !!op.passThrough
                if (!wId) throw new Error('widgetId is required')
                if (!widgetIds.has(wId)) throw new Error(`Widget "${wId}" not found`)

                const isTerminalType = (w) => w && (w.type === 'terminal' || w.type === 'agent')
                const allConnectors = [...connectorMap.values()]
                const affectedConnectorIds = new Set()
                const affectedWidgetIds = new Set([wId])

                if (passThrough) {
                  const visited = new Set([wId])
                  const queue = [wId]
                  while (queue.length > 0) {
                    const current = queue.shift()
                    for (const conn of allConnectors) {
                      let peerId = null
                      if (conn.start?.widgetId === current && conn.end?.widgetId) peerId = conn.end.widgetId
                      if (conn.end?.widgetId === current && conn.start?.widgetId) peerId = conn.start.widgetId
                      if (!peerId || visited.has(peerId)) continue
                      const peer = widgetMap.get(peerId)
                      if (!isTerminalType(peer)) continue
                      affectedConnectorIds.add(conn.id)
                      affectedWidgetIds.add(peerId)
                      visited.add(peerId)
                      queue.push(peerId)
                    }
                  }
                } else {
                  for (const conn of allConnectors) {
                    let peerId = null
                    if (conn.start?.widgetId === wId && conn.end?.widgetId) peerId = conn.end.widgetId
                    if (conn.end?.widgetId === wId && conn.start?.widgetId) peerId = conn.start.widgetId
                    if (!peerId) continue
                    const peer = widgetMap.get(peerId)
                    if (!isTerminalType(peer)) continue
                    affectedConnectorIds.add(conn.id)
                    affectedWidgetIds.add(peerId)
                  }
                }

                const messagingMode = mode === 'none' ? null : mode
                for (const connId of affectedConnectorIds) {
                  appendEvent(filePath, { event: 'connector_updated', timestamp: ts, connectorId: connId, updates: { meta: { messagingMode } } })
                  const conn = connectorMap.get(connId)
                  if (conn) conn.meta = { ...(conn.meta || {}), messagingMode }
                }

                results.push({
                  index: i, op: 'broadcast',
                  affectedConnectors: [...affectedConnectorIds],
                  affectedWidgets: [...affectedWidgetIds],
                  success: true,
                })
                break
              }

              default:
                throw new Error(`Unknown operation "${op.op}"`)
            }
          } catch (opErr) {
            // Fail-fast: push what we have so far, then return the error
            await pushCanvasUpdate(name, filePath, __viteWs)
            sendJson(res, 400, {
              success: false,
              error: `Operation ${i} (${op.op}) failed: ${opErr.message}`,
              failedAt: i,
              results,
              refs,
            })
            return
          }
        }

        await pushCanvasUpdate(name, filePath, __viteWs)
        sendJson(res, 200, { success: true, results, refs })
      } catch (err) {
        sendJson(res, 500, { error: `Batch failed: ${err.message}` })
      }
      return
    }

    // PUT /rename-page — rename a canvas page file
    if (routePath === '/rename-page' && method === 'PUT') {
      const { name, newTitle } = body

      if (!name || !newTitle) {
        sendJson(res, 400, { error: 'Canvas name and newTitle are required' })
        return
      }

      const filePath = findCanvasPath(root, name)
      if (!filePath) {
        sendJson(res, 404, { error: `Canvas "${name}" not found` })
        return
      }

      const kebab = newTitle
        .replace(/[^a-zA-Z0-9\s_-]/g, '')
        .trim()
        .replace(/[\s_]+/g, '-')
        .toLowerCase()
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')

      if (!kebab) {
        sendJson(res, 400, { error: 'newTitle must contain at least one alphanumeric character' })
        return
      }

      try {
        const dir = path.dirname(filePath)
        const newFilename = `${kebab}.canvas.jsonl`
        const newPath = path.join(dir, newFilename)

        if (newPath !== filePath && fs.existsSync(newPath)) {
          sendJson(res, 409, { error: `A canvas file named "${newFilename}" already exists in this directory` })
          return
        }

        fs.renameSync(filePath, newPath)

        const newCanonicalId = canvasIdForFile(path.relative(root, newPath))

        appendEvent(newPath, {
          event: 'settings_updated',
          timestamp: new Date().toISOString(),
          settings: { title: newTitle },
        })

        // Update pageOrder in .meta.json if it exists
        const metaForOrder = readFolderMeta(dir)
        if (metaForOrder?.pageOrder) {
          try {
            const updated = metaForOrder.pageOrder.map((entry) =>
              typeof entry === 'string' && entry === name ? newCanonicalId : entry
            )
            metaForOrder.pageOrder = updated
            writeFolderMeta(dir, metaForOrder)
          } catch { /* skip */ }
        }

        sendJson(res, 200, { success: true, name: newCanonicalId, route: '/canvas/' + newCanonicalId })
      } catch (err) {
        sendJson(res, 500, { error: `Failed to rename page: ${err.message}` })
      }
      return
    }

    // PUT /reorder-pages — save page order for a canvas folder
    if (routePath === '/reorder-pages' && method === 'PUT') {
      const { folder, order } = body

      if (!folder || !Array.isArray(order)) {
        sendJson(res, 400, { error: 'folder (string) and order (array) are required' })
        return
      }

      const canvasDir = canvasContentRoot(root)
      const folderDir = fs.existsSync(path.join(canvasDir, `${folder}.folder`))
        ? path.join(canvasDir, `${folder}.folder`)
        : fs.existsSync(path.join(canvasDir, folder))
          ? path.join(canvasDir, folder)
          : null

      if (!folderDir) {
        sendJson(res, 404, { error: `Folder "${folder}" not found` })
        return
      }

      try {
        const meta = readFolderMeta(folderDir)
        meta.pageOrder = order
        writeFolderMeta(folderDir, meta)
        sendJson(res, 200, { success: true })
      } catch (err) {
        sendJson(res, 500, { error: `Failed to save page order: ${err.message}` })
      }
      return
    }

    // GET /page-order?folder=... — read page order for a folder
    if (routePath.startsWith('/page-order') && method === 'GET') {
      const pageOrderUrl = new URL(routePath, 'http://localhost')
      const folder = pageOrderUrl.searchParams.get('folder')

      if (!folder) {
        sendJson(res, 400, { error: 'folder query parameter is required' })
        return
      }

      const canvasDir = canvasContentRoot(root)
      const folderDir = fs.existsSync(path.join(canvasDir, `${folder}.folder`))
        ? path.join(canvasDir, `${folder}.folder`)
        : fs.existsSync(path.join(canvasDir, folder))
          ? path.join(canvasDir, folder)
          : null

      if (!folderDir) {
        sendJson(res, 404, { error: `Folder "${folder}" not found` })
        return
      }

      try {
        const meta = readFolderMeta(folderDir)
        sendJson(res, 200, { order: meta?.pageOrder || null })
      } catch (err) {
        sendJson(res, 500, { error: `Failed to read page order: ${err.message}` })
      }
      return
    }

    // PUT /update-folder-meta — update folder .meta.json title
    if (routePath === '/update-folder-meta' && method === 'PUT') {
      const { folder, title } = body

      if (!folder || !title) {
        sendJson(res, 400, { error: 'folder and title are required' })
        return
      }

      const kebab = title
        .replace(/[^a-zA-Z0-9\s_-]/g, '')
        .trim()
        .replace(/[\s_]+/g, '-')
        .toLowerCase()
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')

      if (!kebab) {
        sendJson(res, 400, { error: 'title must contain at least one alphanumeric character' })
        return
      }

      const canvasDir = canvasContentRoot(root)
      const isFolderSuffix = fs.existsSync(path.join(canvasDir, `${folder}.folder`))
      const folderDir = isFolderSuffix
        ? path.join(canvasDir, `${folder}.folder`)
        : fs.existsSync(path.join(canvasDir, folder))
          ? path.join(canvasDir, folder)
          : null

      if (!folderDir) {
        sendJson(res, 404, { error: `Folder "${folder}" not found` })
        return
      }

      try {
        const meta = readFolderMeta(folderDir)
        const dirName = path.basename(folderDir).replace(/\.folder$/, '')
        meta.title = title

        // Rename folder directory if the kebab name differs
        const needsRename = kebab !== dirName
        let newDirName = dirName

        if (needsRename) {
          const suffix = isFolderSuffix ? '.folder' : ''
          const newFolderDir = path.join(canvasDir, `${kebab}${suffix}`)
          if (fs.existsSync(newFolderDir)) {
            sendJson(res, 409, { error: `A folder named "${kebab}" already exists` })
            return
          }
          // Write updated meta, rename file to match new dir name, rename dir
          writeFolderMeta(folderDir, meta)
          const metaPath = path.join(folderDir, `${dirName}.meta.json`)
          const newMetaPath = path.join(folderDir, `${kebab}.meta.json`)
          if (newMetaPath !== metaPath) {
            fs.renameSync(metaPath, newMetaPath)
          }
          fs.renameSync(folderDir, newFolderDir)
          newDirName = kebab
        } else {
          writeFolderMeta(folderDir, meta)
        }

        sendJson(res, 200, { success: true, folder: newDirName, renamed: needsRename })
      } catch (err) {
        sendJson(res, 500, { error: `Failed to update folder meta: ${err.message}` })
      }
      return
    }

    // POST /duplicate — duplicate an existing canvas page with its widgets
    if (routePath === '/duplicate' && method === 'POST') {
      const { name, newTitle } = body

      if (!name || !newTitle) {
        sendJson(res, 400, { error: 'Canvas name and newTitle are required' })
        return
      }

      const filePath = findCanvasPath(root, name)
      if (!filePath) {
        sendJson(res, 404, { error: `Canvas "${name}" not found` })
        return
      }

      const kebab = newTitle
        .replace(/[^a-zA-Z0-9\s_-]/g, '')
        .trim()
        .replace(/[\s_]+/g, '-')
        .toLowerCase()
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')

      if (!kebab) {
        sendJson(res, 400, { error: 'newTitle must contain at least one alphanumeric character' })
        return
      }

      try {
        const sourceData = readCanvas(filePath)
        const dir = path.dirname(filePath)
        const newFilename = `${kebab}.canvas.jsonl`
        const newPath = path.join(dir, newFilename)

        if (fs.existsSync(newPath)) {
          sendJson(res, 409, { error: `A canvas file named "${newFilename}" already exists` })
          return
        }

        // Re-ID all widgets to avoid collisions
        const widgets = (sourceData.widgets || []).map(w => ({
          ...w,
          id: generateWidgetId(w.type || 'widget'),
        }))

        const creationEvent = {
          event: 'canvas_created',
          timestamp: new Date().toISOString(),
          title: newTitle,
          grid: sourceData.grid ?? true,
          gridSize: sourceData.gridSize ?? 24,
          colorMode: sourceData.colorMode ?? 'auto',
          widgets,
        }

        writeNewCanvas(newPath, creationEvent)

        const relPath = path.relative(root, newPath).replace(/\\/g, '/')
        const canonicalName = canvasIdForFile(relPath) || kebab

        sendJson(res, 201, {
          success: true,
          name: canonicalName,
          path: relPath,
          route: `/canvas/${canonicalName}`,
        })
      } catch (err) {
        sendJson(res, 500, { error: `Failed to duplicate canvas: ${err.message}` })
      }
      return
    }

    // POST /create — create a new .canvas.jsonl file
    // Supports `convertFrom` to convert a single-page canvas into a multi-page folder.
    if (routePath === '/create' && method === 'POST') {
      const {
        name,
        title,
        folder,
        folderKind,
        convertFrom,
        author,
        description,
        meta,
        grid = true,
        gridSize = 24,
        colorMode = 'auto',
      } = body

      if (!name || typeof name !== 'string') {
        sendJson(res, 400, { error: 'Canvas name is required' })
        return
      }

      const kebab = name
        .replace(/[^a-zA-Z0-9\s_-]/g, '')
        .trim()
        .replace(/[\s_]+/g, '-')
        .toLowerCase()
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')

      if (!kebab) {
        sendJson(res, 400, { error: 'Name must contain at least one alphanumeric character' })
        return
      }

      // ── Convert single-page canvas to multi-page folder ──────────────
      if (convertFrom && typeof convertFrom === 'string') {
        // Only allow flat root canvases (no path segments, no proto:)
        if (convertFrom.includes('/') || convertFrom.startsWith('proto:')) {
          sendJson(res, 400, { error: 'convertFrom only supports flat root canvases (no path segments or proto: prefix)' })
          return
        }

        const canvasDir = canvasContentRoot(root)
        const existingPath = findCanvasPath(root, convertFrom)
        if (!existingPath) {
          sendJson(res, 404, { error: `Canvas "${convertFrom}" not found` })
          return
        }

        // Verify it's actually a flat file in src/canvas/ (not already in a folder)
        const existingRel = path.relative(canvasDir, existingPath).replace(/\\/g, '/')
        if (existingRel.includes('/')) {
          sendJson(res, 400, { error: `Canvas "${convertFrom}" is already inside a folder` })
          return
        }

        const newDir = path.join(canvasDir, convertFrom)
        const dotFolderDir = path.join(canvasDir, `${convertFrom}.folder`)

        // Preflight: check for collisions
        if (fs.existsSync(newDir)) {
          sendJson(res, 409, { error: `Directory "${convertFrom}" already exists in src/canvas/` })
          return
        }
        if (fs.existsSync(dotFolderDir)) {
          sendJson(res, 409, { error: `Directory "${convertFrom}.folder" already exists in src/canvas/` })
          return
        }

        // Read the existing canvas to extract metadata for .meta.json
        let existingData
        try {
          existingData = readCanvas(existingPath)
        } catch (err) {
          sendJson(res, 500, { error: `Failed to read existing canvas: ${err.message}` })
          return
        }

        const existingBasename = path.basename(existingPath)

        const movedCanvasPath = path.join(newDir, existingBasename)
        const newPagePath = path.join(newDir, `${kebab}.canvas.jsonl`)

        if (existingBasename === `${kebab}.canvas.jsonl`) {
          sendJson(res, 409, { error: `New page name "${kebab}" collides with existing canvas filename` })
          return
        }

        // Perform the conversion with rollback on failure
        const rollbackOps = []
        try {
          // 1. Create the directory
          fs.mkdirSync(newDir, { recursive: true })
          rollbackOps.push(() => { try { fs.rmdirSync(newDir) } catch { /* ignore */ } })

          // 2. Move the existing canvas file
          fs.renameSync(existingPath, movedCanvasPath)
          rollbackOps.push(() => { try { fs.renameSync(movedCanvasPath, existingPath) } catch { /* ignore */ } })

          // 3. Write .meta.json with metadata from the existing canvas
          const metaObj = { title: existingData?.title || convertFrom }
          if (existingData?.description) metaObj.description = existingData.description
          if (existingData?.author) metaObj.author = existingData.author
          const metaPath = path.join(newDir, `${convertFrom}.meta.json`)
          fs.writeFileSync(metaPath, JSON.stringify(metaObj, null, 2) + '\n', 'utf-8')
          rollbackOps.push(() => { try { fs.unlinkSync(metaPath) } catch { /* ignore */ } })

          // 4. Create the new page
          const creationEvent = {
            event: 'canvas_created',
            timestamp: new Date().toISOString(),
            title: title || kebab.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' '),
            grid,
            gridSize,
            colorMode,
            widgets: [],
          }
          writeNewCanvas(newPagePath, creationEvent)

          const relPath = path.relative(root, newPagePath).replace(/\\/g, '/')
          const canonicalName = canvasIdForFile(relPath) || kebab

          try { globalThis.__STORYBOARD_NOTIFY_ARTIFACT_CHANGE__?.(newPagePath, 'add') } catch { /* */ }
          sendJson(res, 201, {
            success: true,
            converted: true,
            name: canonicalName,
            path: relPath,
            route: `/canvas/${canonicalName}`,
          })
        } catch (err) {
          // Rollback in reverse order
          for (let i = rollbackOps.length - 1; i >= 0; i--) {
            rollbackOps[i]()
          }
          sendJson(res, 500, { error: `Failed to convert canvas to folder: ${err.message}` })
        }
        return
      }

      // ── Standard canvas creation ─────────────────────────────────────
      // Determine target directory. When `folder` is set:
      //   - existing `<folder>.folder/` wins → workspace grouping
      //   - existing `<folder>/` wins → multi-page canvas grouping
      //   - otherwise: create a new dir; `folderKind` controls which kind.
      //     Default kind is "pages" for backward compatibility (the legacy
      //     behavior). Pass `"workspace"` to create `<folder>.folder/`.
        const canvasDir = canvasContentRoot(root)
      let targetDir = canvasDir

      if (folder) {
        const dotFolderDir = path.join(canvasDir, `${folder}.folder`)
        const plainDir = path.join(canvasDir, folder)

        if (fs.existsSync(dotFolderDir)) {
          // Existing .folder/ directory (workspace grouping)
          targetDir = dotFolderDir
        } else if (fs.existsSync(plainDir) && fs.statSync(plainDir).isDirectory()) {
          // Existing plain directory (multi-page grouping)
          targetDir = plainDir
        } else {
          // Create a new directory according to the requested kind.
          const useWorkspace = folderKind === 'workspace'
          const newDir = useWorkspace ? dotFolderDir : plainDir
          try {
            fs.mkdirSync(newDir, { recursive: true })
            // Write .meta.json if meta was provided (only meaningful for
            // multi-page groups today; harmless inside a .folder/).
            if (meta && typeof meta === 'object') {
              const metaPath = path.join(newDir, `${folder}.meta.json`)
              fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf-8')
            }
          } catch (err) {
            sendJson(res, 500, { error: `Failed to create directory: ${err.message}` })
            return
          }
          targetDir = newDir
        }
      }

      const canvasPath = path.join(targetDir, `${kebab}.canvas.jsonl`)
      if (fs.existsSync(canvasPath)) {
        sendJson(res, 409, { error: `Canvas "${kebab}" already exists` })
        return
      }

      const creationEvent = {
        event: 'canvas_created',
        timestamp: new Date().toISOString(),
        title: title || kebab.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' '),
        grid,
        gridSize,
        colorMode,
        widgets: [],
      }

      if (author) {
        creationEvent.author = author
      }

      if (description) {
        creationEvent.description = description
      }

      try {
        fs.mkdirSync(targetDir, { recursive: true })
        writeNewCanvas(canvasPath, creationEvent)

        const relPath = path.relative(root, canvasPath).replace(/\\/g, '/')
        const canonicalName = canvasIdForFile(relPath) || kebab

        const result = {
          success: true,
          name: canonicalName,
          path: relPath,
          route: `/canvas/${canonicalName}`,
        }

        try { globalThis.__STORYBOARD_NOTIFY_ARTIFACT_CHANGE__?.(canvasPath, 'add') } catch { /* */ }
        sendJson(res, 201, result)
      } catch (err) {
        sendJson(res, 500, { error: `Failed to create canvas: ${err.message}` })
      }
      return
    }

    // ── Story routes ──────────────────────────────────────────────────

    // GET /stories — list all .story.{jsx,tsx} files with their exports
    if (routePath === '/stories' && method === 'GET') {
      try {
        const storyFiles = findStoryFiles(root)
        sendJson(res, 200, { stories: storyFiles })
      } catch (err) {
        sendJson(res, 500, { error: `Failed to list stories: ${err.message}` })
      }
      return
    }

    // POST /create-story — scaffold a new .story.jsx/.tsx file
    if (routePath === '/create-story' && method === 'POST') {
      const { name, location, format = 'jsx', canvasName: storyCanvasName } = body

      if (!name || typeof name !== 'string') {
        sendJson(res, 400, { error: 'Component name is required' })
        return
      }

      const kebab = name
        .replace(/[^a-zA-Z0-9\s_-]/g, '')
        .trim()
        .replace(/[\s_]+/g, '-')
        .toLowerCase()
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')

      if (!kebab) {
        sendJson(res, 400, { error: 'Name must contain at least one alphanumeric character' })
        return
      }

      const ext = format === 'tsx' ? 'tsx' : 'jsx'

      // Resolve target directory from location + canvas name
      let targetDir
      if (location === 'components') {
        targetDir = path.join(root, 'src', 'components')
      } else if (storyCanvasName) {
        const canvasPath = findCanvasPath(root, storyCanvasName)
         targetDir = canvasPath ? path.dirname(canvasPath) : canvasContentRoot(root)
      } else {
        targetDir = canvasContentRoot(root)
      }

      const storyPath = path.join(targetDir, `${kebab}.story.${ext}`)
      if (fs.existsSync(storyPath)) {
        sendJson(res, 409, { error: `Story "${kebab}.story.${ext}" already exists at ${path.relative(root, targetDir)}` })
        return
      }

      // Check for duplicate story name anywhere in the project (Vite data plugin
      // enforces global uniqueness and would fail the build on duplicates)
      const existing = findStoryFiles(root)
      if (existing.some(s => s.name === kebab)) {
        sendJson(res, 409, { error: `A story named "${kebab}" already exists in the project` })
        return
      }

      const componentName = kebab.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('')
      const content = `/**
 * ${componentName} component stories.
 * Each named export becomes a draggable widget on the canvas.
 */

export function Default() {
  return (
    <div style={{ padding: '1.5rem', minWidth: 200 }}>
      <h3>${componentName}</h3>
      <p>Edit this file to build your component.</p>
    </div>
  )
}
`

      try {
        fs.mkdirSync(targetDir, { recursive: true })
        fs.writeFileSync(storyPath, content, 'utf-8')

        const relPath = path.relative(root, storyPath)
        // Force-invalidate the data index so a follow-up "add to canvas"
        // doesn't race chokidar (StoryWidget would otherwise show
        // "Story not found" until the next refresh).
        try { globalThis.__STORYBOARD_NOTIFY_ARTIFACT_CHANGE__?.(storyPath, 'add') } catch { /* */ }
        sendJson(res, 201, {
          success: true,
          name: kebab,
          path: relPath,
          storyId: kebab,
        })
      } catch (err) {
        sendJson(res, 500, { error: `Failed to create story: ${err.message}` })
      }
      return
    }

    // GET /github/available — check if gh CLI is installed locally
    if (routePath === '/github/available' && method === 'GET') {
      sendJson(res, 200, {
        available: isGhCliAvailable(),
        installUrl: GH_INSTALL_URL,
      })
      return
    }

    // POST /github/embed — fetch metadata for GitHub issue/discussion/comment links
    if (routePath === '/github/embed' && method === 'POST') {
      const rawUrl = typeof body?.url === 'string' ? body.url.trim() : ''

      if (!rawUrl) {
        sendJson(res, 400, { code: 'invalid_url', error: 'url is required' })
        return
      }

      if (!isGitHubEmbedUrl(rawUrl)) {
        sendJson(res, 400, {
          code: 'unsupported_url',
          error: 'Only GitHub issue, discussion, and comment URLs are supported.',
        })
        return
      }

      try {
        const snapshot = fetchGitHubEmbedSnapshot(rawUrl)
        sendJson(res, 200, { success: true, snapshot })
      } catch (error) {
        if (error instanceof GitHubEmbedError) {
          sendJson(res, error.status ?? 500, {
            code: error.code,
            error: error.message,
            installUrl: error.code === 'gh_unavailable' ? GH_INSTALL_URL : undefined,
          })
          return
        }

        sendJson(res, 500, {
          code: 'gh_fetch_failed',
          error: error?.message || 'Failed to fetch GitHub metadata.',
        })
      }
      return
    }

    // ── Image routes ──────────────────────────────────────────────────

    const imagesDir = path.join(root, 'assets', 'canvas', 'images')
    const snapshotsDir = path.join(root, 'assets', 'canvas', 'snapshots')

    const MIME_TO_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }
    const EXT_TO_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }
    const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5 MB

    // Route snapshot uploads (snapshot-* prefix) to the snapshots directory.
    // Canvases inside a `drafts/` segment go to images/drafts/ (gitignored)
    // so draft-only images don't leak into git via assets/canvas/images/.
    function isDraftCanvasId(canvasName) {
      if (!canvasName || typeof canvasName !== 'string') return false
      return canvasName.split('/').some((seg) => seg === 'drafts')
    }
    function resolveWriteDir(canvasName) {
      if (canvasName?.startsWith('snapshot-')) return snapshotsDir
      if (isDraftCanvasId(canvasName)) return path.join(imagesDir, 'drafts')
      return imagesDir
    }

    // Validate a filename coming from the client. Accepts a bare basename
    // (`foo.png`) or one optional `drafts/` segment (`drafts/foo.png`).
    // Returns { dirSegment: '' | 'drafts', basename } or null if invalid.
    function parseValidFilename(filename) {
      if (!filename || typeof filename !== 'string') return null
      if (filename.includes('..') || filename.includes('\\')) return null
      const segments = filename.split('/')
      if (segments.length === 1) {
        return segments[0] ? { dirSegment: '', basename: segments[0] } : null
      }
      if (segments.length === 2 && segments[0] === 'drafts' && segments[1]) {
        return { dirSegment: 'drafts', basename: segments[1] }
      }
      return null
    }

    // Resolve a stored filename to an absolute path on disk.
    //
    // `filename` may be either a bare basename (`foo.png`) or one optional
    // `drafts/` segment followed by a basename (`drafts/foo.png`). The
    // `drafts/` form is reserved for images that belong to draft canvases
    // and resolves only into images/drafts/. Bare basenames intentionally
    // do NOT fall back to images/drafts/ — that would let a public canvas
    // serve a draft-only asset just by sharing a basename.
    //
    // Returns null when the filename is malformed or the file is not found.
    function resolveImagePath(filename) {
      const parsed = parseValidFilename(filename)
      if (!parsed) return null
      if (parsed.dirSegment === 'drafts') {
        const draftPath = path.join(imagesDir, 'drafts', parsed.basename)
        if (fs.existsSync(draftPath)) return draftPath
        return null
      }
      const snapshotPath = path.join(snapshotsDir, parsed.basename)
      if (fs.existsSync(snapshotPath)) return snapshotPath
      const imagePath = path.join(imagesDir, parsed.basename)
      if (fs.existsSync(imagePath)) return imagePath
      return null
    }

    // POST /image — upload a pasted image (base64 data URL)
    if (routePath === '/image' && method === 'POST') {
      const { dataUrl, canvasName } = body

      if (!dataUrl || typeof dataUrl !== 'string') {
        sendJson(res, 400, { error: 'dataUrl is required' })
        return
      }

      const match = dataUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/i)
      if (!match) {
        sendJson(res, 400, { error: 'Invalid data URL format' })
        return
      }

      const mime = match[1].toLowerCase()
      const ext = MIME_TO_EXT[mime]
      if (!ext) {
        sendJson(res, 400, { error: `Unsupported image type: ${mime}` })
        return
      }

      const base64 = match[2]
      const buffer = Buffer.from(base64, 'base64')

      if (buffer.length > MAX_IMAGE_SIZE) {
        sendJson(res, 413, { error: `Image exceeds ${MAX_IMAGE_SIZE / 1024 / 1024}MB limit` })
        return
      }

      const now = new Date()
      const pad = (n) => String(n).padStart(2, '0')
      const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}--${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
      const suffix = `-${Math.random().toString(36).slice(2, 6)}`
      const prefix = canvasName ? `${canvasName.replace(/[/:]/g, '--')}--` : ''

      // Support explicit filename for snapshot uploads (stable naming)
      // and cropped image uploads (user-initiated crop)
      const explicitName = body.filename
      let filename
      if (explicitName && /^snapshot-[a-z0-9_-]+--(latest|light|dark)\.webp$/i.test(explicitName)) {
        filename = explicitName
      } else if (explicitName && /--cropped--\d{4}-\d{2}-\d{2}--\d{2}-\d{2}-\d{2}\.\w+$/.test(explicitName)) {
        // Cropped image: validate format, strip path traversal
        const safeName = explicitName.replace(/[/\\]/g, '')
        if (safeName === explicitName && !explicitName.includes('..')) {
          filename = explicitName
        } else {
          filename = `${prefix}${dateStr}${suffix}.${ext}`
        }
      } else {
        filename = `${prefix}${dateStr}${suffix}.${ext}`
      }
      const targetDir = resolveWriteDir(canvasName || '')
      // Return the filename with a `drafts/` prefix when the write went to
      // the drafts subdirectory, so widget `props.src` includes the
      // directory and the GET route can locate the file unambiguously.
      const responseFilename =
        targetDir === path.join(imagesDir, 'drafts') ? `drafts/${filename}` : filename

      try {
        fs.mkdirSync(targetDir, { recursive: true })
        fs.writeFileSync(path.join(targetDir, filename), buffer)
        sendJson(res, 201, { success: true, filename: responseFilename })
      } catch (err) {
        sendJson(res, 500, { error: `Failed to save image: ${err.message}` })
      }
      return
    }

    // GET /images/<filename> — serve an image file. Filename may include
    // an optional `drafts/` directory segment (e.g. `drafts/foo.png`).
    if (routePath.startsWith('/images/') && method === 'GET') {
      // Strip query string (e.g. ?v=123 cache busters) from filename
      let filename = routePath.slice('/images/'.length)
      const qIdx = filename.indexOf('?')
      if (qIdx !== -1) filename = filename.slice(0, qIdx)

      // Validate (allows optional `drafts/` segment, rejects deeper paths
      // and path traversal)
      if (!parseValidFilename(filename)) {
        sendJson(res, 400, { error: 'Invalid filename' })
        return
      }

      const filePath = resolveImagePath(filename)
      if (!filePath) {
        sendJson(res, 404, { error: 'Image not found' })
        return
      }

      const ext = path.extname(filename).slice(1).toLowerCase()
      const contentType = EXT_TO_MIME[ext] || 'application/octet-stream'

      try {
        const data = fs.readFileSync(filePath)
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': data.length,
          'Cache-Control': 'no-cache',
        })
        res.end(data)
      } catch (err) {
        sendJson(res, 500, { error: `Failed to serve image: ${err.message}` })
      }
      return
    }

    // POST /image/duplicate — copy an image file with a new timestamped name.
    // Accepts a bare basename or one optional `drafts/` segment.
    if (routePath === '/image/duplicate' && method === 'POST') {
      const { filename } = body

      if (!filename || typeof filename !== 'string') {
        sendJson(res, 400, { error: 'filename is required' })
        return
      }

      const parsed = parseValidFilename(filename)
      if (!parsed) {
        sendJson(res, 400, { error: 'Invalid filename' })
        return
      }

      const sourcePath = resolveImagePath(filename)
      if (!sourcePath) {
        sendJson(res, 404, { error: 'Image not found' })
        return
      }

      try {
        const base = parsed.basename
        const ext = path.extname(base)
        const now = new Date()
        const pad = (n) => String(n).padStart(2, '0')
        const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}--${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
        // Preserve privacy prefix on the basename
        const prefix = base.startsWith('~') ? '~' : ''
        const baseName = base.replace(/^~/, '').replace(ext, '')
        // Extract canvas prefix (everything before the date pattern or the full base)
        const canvasMatch = baseName.match(/^(.+?--)\d{4}-/)
        const canvasPrefix = canvasMatch ? canvasMatch[1] : ''
        const newBase = `${prefix}${canvasPrefix}${dateStr}${ext}`
        const targetDir = path.dirname(sourcePath)
        fs.copyFileSync(sourcePath, path.join(targetDir, newBase))
        // Return the filename with the same drafts/ prefix as the source
        const responseFilename = parsed.dirSegment === 'drafts' ? `drafts/${newBase}` : newBase
        sendJson(res, 201, { success: true, filename: responseFilename })
      } catch (err) {
        sendJson(res, 500, { error: `Failed to duplicate image: ${err.message}` })
      }
      return
    }

    // POST /image/toggle-private — toggle tilde prefix on image filename
    if (routePath === '/image/toggle-private' && method === 'POST') {
      const { filename } = body

      if (!filename || typeof filename !== 'string') {
        sendJson(res, 400, { error: 'filename is required' })
        return
      }

      const parsed = parseValidFilename(filename)
      if (!parsed) {
        sendJson(res, 400, { error: 'Invalid filename' })
        return
      }

      const base = parsed.basename
      const isPrivate = base.startsWith('~')
      const newBase = isPrivate ? base.slice(1) : `~${base}`
      const oldPath = resolveImagePath(filename)
      if (!oldPath) {
        sendJson(res, 404, { error: 'Image not found' })
        return
      }
      const parentDir = path.dirname(oldPath)
      const newPath = path.join(parentDir, newBase)
      // Preserve the `drafts/` segment on the returned filename
      const responseFilename = parsed.dirSegment === 'drafts' ? `drafts/${newBase}` : newBase

      try {
        fs.renameSync(oldPath, newPath)
        sendJson(res, 200, { success: true, filename: responseFilename, private: !isPrivate })
      } catch (err) {
        sendJson(res, 500, { error: `Failed to toggle private: ${err.message}` })
      }
      return
    }

    // ── Agent Signal API ──────────────────────────────────────────────────

    // POST /agent/signal — agent signals status (done/error/running)
    if (routePath === '/agent/signal' && method === 'POST') {
      const { widgetId, canvasId, branch, status, message, data: payload } = body

      if (!widgetId || !status) {
        sendJson(res, 400, { error: 'widgetId and status are required' })
        return
      }

      const validStatuses = ['done', 'error', 'running', 'working']
      if (!validStatuses.includes(status)) {
        sendJson(res, 400, { error: `status must be one of: ${validStatuses.join(', ')}` })
        return
      }

      try {
        const { updateAgentStatus, initTerminalConfig } = await import('./terminal-config.js')
        initTerminalConfig(root)
        updateAgentStatus({
          branch: branch || 'unknown',
          canvasId: canvasId || 'unknown',
          widgetId,
          status,
          message: message || null,
          data: payload || null,
        })

        // Push status to canvas clients via Vite WS custom event
        if (__viteWs) {
          __viteWs.send({
            type: 'custom',
            event: 'storyboard:agent-status',
            data: { widgetId, canvasId, status, message, timestamp: new Date().toISOString() },
          })
        }

        sendJson(res, 200, { success: true, status })
      } catch (err) {
        sendJson(res, 500, { error: `Failed to update agent status: ${err.message}` })
      }
      return
    }

    // GET /agents — list storyboard-spawned agent sessions on a canvas
    if (routePath === '/agents' && method === 'GET') {
      const url = new URL(req.url, 'http://localhost')
      const canvasId = url.searchParams.get('canvasId')
      const branch = url.searchParams.get('branch') || null

      if (!canvasId) {
        sendJson(res, 400, { error: 'canvasId query parameter is required' })
        return
      }

      try {
        const { listAgentsForCanvas, initTerminalConfig } = await import('./terminal-config.js')
        initTerminalConfig(root)
        const agents = listAgentsForCanvas({ branch, canvasId })
        sendJson(res, 200, { agents })
      } catch (err) {
        sendJson(res, 500, { error: `Failed to list agents: ${err.message}` })
      }
      return
    }

    // GET /agent/status — poll agent status for a widget
    if (routePath.startsWith('/agent/status') && method === 'GET') {
      const url = new URL(req.url, 'http://localhost')
      const widgetId = url.searchParams.get('widgetId')
      const canvasId = url.searchParams.get('canvasId') || 'unknown'
      const branch = url.searchParams.get('branch') || 'unknown'

      if (!widgetId) {
        sendJson(res, 400, { error: 'widgetId query parameter is required' })
        return
      }

      try {
        const { readTerminalConfig, readTerminalConfigById, initTerminalConfig } = await import('./terminal-config.js')
        initTerminalConfig(root)
        let config = readTerminalConfig({ branch, canvasId, widgetId })
        // Fallback: when canvasId/branch are missing, mismatched, or stale
        // (e.g. the persisted canvasId only captured the parent folder),
        // recover via the widget-id-named symlink that writeTerminalConfig
        // creates next to the hashed config.
        if (!config?.agentStatus) {
          const byId = readTerminalConfigById(widgetId)
          if (byId?.agentStatus) config = byId
        }
        sendJson(res, 200, { agentStatus: config?.agentStatus || null })
      } catch (err) {
        sendJson(res, 500, { error: `Failed to read agent status: ${err.message}` })
      }
      return
    }

    // POST /agent/spawn — spawn a headless agent session
    if (routePath === '/agent/spawn' && method === 'POST') {
      const { canvasId, widgetId, prompt, autopilot = true, branch: reqBranch, agentId } = body

      if (!canvasId || !widgetId || !prompt) {
        sendJson(res, 400, { error: 'canvasId, widgetId, and prompt are required' })
        return
      }

      const configuredAgents = readAgentsConfig(root) || {}
      const targetAgentId = agentId
        || getPromptExecution()?.default
        || Object.keys(configuredAgents).find((id) => configuredAgents[id]?.default)
        || Object.keys(configuredAgents)[0]
        || null
      try {
        const session = await spawnHeadlessAgent({
          canvasId,
          widgetId,
          prompt,
          autopilot,
          requestedBranch: reqBranch,
          agentId: targetAgentId,
          warmPoolId: targetAgentId,
        })
        if (__viteWs) {
          __viteWs.send({
            type: 'custom',
            event: 'storyboard:agent-status',
            data: { widgetId, canvasId, status: 'running', timestamp: new Date().toISOString() },
          })
        }
        sendJson(res, 200, { success: true, sessionId: session.sessionId, status: 'running' })
      } catch (err) {
        sendJson(res, err instanceof HostRuntimeError ? 409 : 500, { error: `Failed to spawn agent: ${err.message}`, code: err.code || null })
      }
      return
    }

    // POST /agent/peek — reconnect a headless agent session to a visible terminal widget
    if (routePath === '/agent/peek' && method === 'POST') {
      const { widgetId, canvasId } = body

      if (!widgetId) {
        sendJson(res, 400, { error: 'widgetId is required' })
        return
      }

      try {
        const { execFileSync } = await import('node:child_process')
        const { findSessionIdForWidget, generateSessionId } = await import('./terminal-registry.js')
        let branch = 'unknown'
        try { branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8', cwd: root }).trim() } catch { /* non-git project */ }
        const sessionId = findSessionIdForWidget(widgetId) || generateSessionId(branch, canvasId || 'unknown', widgetId)
        if (!await terminalSessionExists(sessionId)) {
          sendJson(res, 404, { error: `No PTY session found for widget ${widgetId}` })
          return
        }
        sendJson(res, 200, {
          success: true,
          sessionId,
          widgetId,
          canvasId: canvasId || 'unknown',
          message: 'Session is alive. Create a terminal widget to connect.',
        })
      } catch (err) {
        sendJson(res, 500, { error: `Failed to peek agent session: ${err.message}` })
      }
      return
    }

    // ── Terminal Messaging API ──────────────────────────────────────────

    // POST /terminal/activate-agent — bind an agent launched from terminal-welcome
    if (routePath === '/terminal/activate-agent' && method === 'POST') {
      const { widgetId, canvasId, branch, agentId, prettyName } = body
      if (!widgetId) {
        sendJson(res, 400, { error: 'widgetId is required' })
        return
      }
      try {
        const { activateTerminalAgent } = await import('./terminal-server.js')
        const result = await activateTerminalAgent({ widgetId, canvasId, branch, agentId, prettyName })
        sendJson(res, 200, { success: true, ...result })
      } catch (err) {
        sendJson(res, 500, { error: `Failed to activate terminal agent: ${err.message}` })
      }
      return
    }

    // POST /terminal/context — inspect lifecycle state, acknowledge or retry.
    if (routePath === '/terminal/context' && method === 'POST') {
      const { widgetId, action = 'state', launchId, revision, interactive } = body
      if (typeof widgetId !== 'string' || !widgetId.trim()) {
        sendJson(res, 400, { error: 'widgetId is required' })
        return
      }
      try {
        const { initTerminalConfig, readTerminalConfigById } = await import('./terminal-config.js')
        const context = await import('./live-terminal-coding-target.js')
        initTerminalConfig(root)
        const config = readTerminalConfigById(widgetId)
        if (findCanvasWidget(root, widgetId, config?.canvasId)?.type === 'agent-chat') {
          sendJson(res, 409, { error: 'Agent Chat uses managed prompt delivery, not terminal context' })
          return
        }
        if (!config) {
          sendJson(res, 404, { error: 'Terminal context not found' })
          return
        }
        let state
        if (action === 'start') state = context.startTerminalContext(root, widgetId, { launchId, revision, interactive })
        else if (action === 'exit') state = context.stopTerminalContext(root, widgetId, launchId)
        else if (action === 'ack') state = await context.acknowledgeTerminalContext(root, widgetId, { launchId, revision })
        else if (action === 'retry') state = await context.refreshLiveCodingTarget(root, widgetId, { retry: true })
        else if (action === 'state') state = readTerminalConfigById(widgetId).contextState || null
        else throw new Error('Unknown terminal context action')
        sendJson(res, 200, { success: true, state })
      } catch (error) {
        sendJson(res, 409, { error: error.message })
      }
      return
    }

    // POST /terminal/input — write text to a live PTY, optionally followed by Enter.
    if (routePath === '/terminal/input' && method === 'POST') {
      const { widgetId, sessionId, canvasId, branch, text } = body
      const hasWidgetTarget = body.widgetId !== undefined && body.widgetId !== null
      const hasSessionTarget = body.sessionId !== undefined && body.sessionId !== null
      const targetCount = Number(hasWidgetTarget) + Number(hasSessionTarget)
      const submit = body.submit === undefined ? false : body.submit
      const paste = body.paste === undefined ? false : body.paste
      if (targetCount !== 1) {
        sendJson(res, 400, { code: 'INVALID_TERMINAL_TARGET', error: 'Provide exactly one non-empty widgetId or sessionId' })
        return
      }
      const target = hasWidgetTarget ? widgetId : sessionId
      if (typeof target !== 'string' || !target.trim()) {
        sendJson(res, 400, { code: 'INVALID_TERMINAL_TARGET', error: 'The terminal target must be a non-empty string' })
        return
      }
      if (typeof text !== 'string') {
        sendJson(res, 400, { code: 'INVALID_TERMINAL_TEXT', error: 'text must be a string' })
        return
      }
      if (typeof submit !== 'boolean') {
        sendJson(res, 400, { code: 'INVALID_SUBMIT_OPTION', error: 'submit must be a boolean' })
        return
      }
      if (typeof paste !== 'boolean') {
        sendJson(res, 400, { code: 'INVALID_PASTE_OPTION', error: 'paste must be a boolean' })
        return
      }
      if (canvasId != null && typeof canvasId !== 'string') {
        sendJson(res, 400, { code: 'INVALID_CANVAS_ID', error: 'canvasId must be a string' })
        return
      }
      if (branch != null && typeof branch !== 'string') {
        sendJson(res, 400, { code: 'INVALID_BRANCH', error: 'branch must be a string' })
        return
      }

      let entry = null
      let resolvedSessionId = sessionId || null
      try {
        const { getSession, listSessions } = await import('./terminal-registry.js')
        if (widgetId) {
          const matches = listSessions().filter(session => (
            session.widgetId === widgetId
            && (!canvasId || session.canvasId === canvasId)
            && (!branch || session.branch === branch)
          ))
          if (matches.length > 1) {
            sendJson(res, 409, {
              code: 'AMBIGUOUS_TERMINAL_TARGET',
              error: `Widget ${widgetId} maps to multiple terminal sessions; provide a sessionId or narrow by canvasId and branch`,
            })
            return
          }
          entry = matches[0] || null
          resolvedSessionId = entry?.sessionId || null
          if (!entry) {
            const widget = findCanvasWidget(root, widgetId, canvasId)
            if (widget && ['terminal-read', 'prompt'].includes(widget.type)) {
              sendJson(res, 409, {
                code: 'TERMINAL_READ_ONLY',
                error: `Widget ${widgetId} is a read-only terminal view and cannot accept input`,
              })
              return
            }
            sendJson(res, 404, {
              code: 'TERMINAL_NOT_FOUND',
              error: `No writable PTY session is registered for widget ${widgetId}`,
            })
            return
          }
        } else {
          entry = getSession(sessionId)
          if (entry && canvasId && entry.canvasId !== canvasId) {
            sendJson(res, 404, { code: 'TERMINAL_NOT_FOUND', error: `Session ${sessionId} is not registered in canvas ${canvasId}` })
            return
          }
          if (entry && branch && entry.branch !== branch) {
            sendJson(res, 404, { code: 'TERMINAL_NOT_FOUND', error: `Session ${sessionId} is not registered on branch ${branch}` })
            return
          }
        }

        if (entry) {
          const widget = findCanvasWidget(root, entry.widgetId, entry.canvasId)
          if (widget && ['terminal-read', 'prompt'].includes(widget.type)) {
            sendJson(res, 409, {
              code: 'TERMINAL_READ_ONLY',
              error: `Widget ${entry.widgetId} is a read-only terminal view and cannot accept input`,
            })
            return
          }
        }

        const result = await submitTerminalText(resolvedSessionId, text, { submit, ...(paste ? { paste } : {}) })
        sendJson(res, 200, {
          success: true,
          ...result,
          sessionId: resolvedSessionId,
          ...(entry ? { widgetId: entry.widgetId, canvasId: entry.canvasId } : {}),
        })
      } catch (err) {
        const notRunning = err.code === 'TERMINAL_NOT_RUNNING'
        const status = notRunning ? (entry ? 410 : 404) : (err.statusCode || 502)
        const code = notRunning ? (entry ? 'TERMINAL_EXITED' : 'TERMINAL_NOT_FOUND') : (err.code || 'TERMINAL_INPUT_FAILED')
        sendJson(res, status, {
          code,
          error: notRunning
            ? entry ? `Terminal session ${resolvedSessionId} has exited` : `No live PTY session found for ${sessionId}`
            : err.message || 'Terminal input failed',
        })
      }
      return
    }

    // POST /terminal/output — save latest output to terminal config
    if (routePath === '/terminal/output' && method === 'POST') {
      const { widgetId: outputWidgetId, content, summary } = body

      if (!outputWidgetId) {
        sendJson(res, 400, { error: 'widgetId is required' })
        return
      }

      try {
        const { updateLatestOutput, initTerminalConfig } = await import('./terminal-config.js')
        initTerminalConfig(root)

        updateLatestOutput(outputWidgetId, {
          content: content || '',
          summary: summary || '',
          updatedAt: new Date().toISOString(),
        })

        sendJson(res, 200, { success: true })
      } catch (err) {
        sendJson(res, 500, { error: `Failed to save output: ${err.message}` })
      }
      return
    }

    // POST /prompt/spawn — spawn a prompt agent session (acquires from hot pool)
    if (routePath === '/prompt/spawn' && method === 'POST') {
      const { canvasId, widgetId, prompt, agentId } = body

      if (!canvasId || !widgetId || !prompt) {
        sendJson(res, 400, { error: 'canvasId, widgetId, and prompt are required' })
        return
      }

      try {
        const { updateTerminalConnections } = await import('./terminal-config.js')
        const session = await spawnHeadlessAgent({
          canvasId,
          widgetId,
          prompt,
          agentId,
          warmPoolId: 'prompt',
          statusMessage: 'Prompt agent spawning...',
        })

        // Resolve connected widgets so the terminal-agent has context
        try {
          const canvasFilePath = findCanvasPath(root, canvasId)
          if (canvasFilePath) {
            const canvasData = readCanvas(canvasFilePath)
            const widgetMap = new Map((canvasData.widgets || []).map(w => [w.id, w]))
            const connectors = canvasData.connectors || []
            const connectedIds = new Set()
            for (const conn of connectors) {
              if (conn.start?.widgetId === widgetId) connectedIds.add(conn.end?.widgetId)
              if (conn.end?.widgetId === widgetId) connectedIds.add(conn.start?.widgetId)
            }
            connectedIds.delete(undefined)
            connectedIds.delete(null)
            const connectedWidgets = [...connectedIds]
              .map(id => widgetMap.get(id))
              .filter(Boolean)
              .map(w => ({ id: w.id, type: w.type, props: w.props, position: w.position }))
            if (connectedWidgets.length > 0) {
              updateTerminalConnections({ branch: session.branch, canvasId, widgetId, connectedWidgets })
            }
          }
        } catch (err) {
          devLog().logEvent('warn', 'Failed to resolve prompt connections', { error: err.message })
        }

        if (__viteWs) {
          __viteWs.send({
            type: 'custom',
            event: 'storyboard:agent-status',
            data: { widgetId, canvasId, status: 'running', timestamp: new Date().toISOString() },
          })
        }

        sendJson(res, 200, { success: true, sessionId: session.sessionId, status: 'running', warm: session.warm })
      } catch (err) {
        sendJson(res, err instanceof HostRuntimeError ? 409 : 500, { error: `Failed to spawn prompt agent: ${err.message}`, code: err.code || null })
      }
      return
    }

    // POST /terminal/kill — kill a terminal or agent PTY session
    if (routePath === '/terminal/kill' && method === 'POST') {
      const { widgetId: targetWidgetId } = body

      if (!targetWidgetId) {
        sendJson(res, 400, { error: 'widgetId is required' })
        return
      }

      try {
        const { findSessionIdForWidget, killSession } = await import('./terminal-registry.js')
        const { updateAgentStatus, initTerminalConfig } = await import('./terminal-config.js')

        initTerminalConfig(root)

        const sessionId = findSessionIdForWidget(targetWidgetId)
        if (!sessionId) {
          sendJson(res, 404, { error: `No active session for widget ${targetWidgetId}` })
          return
        }

        // Close any WS connections for this session
        const { orphanTerminalSession } = await import('./terminal-server.js')
        await orphanTerminalSession(targetWidgetId)

        await killSession(sessionId)

        // Update agent status
        const pathParts = req.url.split('/')
        const _canvasIdx = pathParts.indexOf('canvas')
        void _canvasIdx
        let branch = 'unknown'
        try {
          const { execSync } = await import('node:child_process')
          branch = execSync('git branch --show-current', { encoding: 'utf8', cwd: root }).trim()
        } catch { /* empty */ }

        try {
          updateAgentStatus({ branch, canvasId: 'unknown', widgetId: targetWidgetId, status: 'cancelled', message: 'Cancelled by user' })
        } catch { /* empty */ }

        // Notify via HMR
        if (__viteWs) {
          __viteWs.send({
            type: 'custom',
            event: 'storyboard:agent-status',
            data: { widgetId: targetWidgetId, status: 'cancelled', message: 'Cancelled by user', timestamp: new Date().toISOString() },
          })
        }

        sendJson(res, 200, { success: true, killed: sessionId })
      } catch (err) {
        sendJson(res, 500, { error: `Failed to kill session: ${err.message}` })
      }
      return
    }

    // GET /terminal-buffer/:widgetId — read terminal buffer JSON
    // Accepts optional ?length=N query param to truncate scrollback
    if (routePath.startsWith('/terminal-buffer/') && method === 'GET') {
      const widgetId = routePath.slice('/terminal-buffer/'.length).split('?')[0]
      if (!widgetId || widgetId.includes('..') || widgetId.includes('/')) {
        sendJson(res, 400, { error: 'Invalid widgetId' })
        return
      }

      const urlObj = new URL(req.url, 'http://localhost')
      const lengthParam = urlObj.searchParams.get('length')
      const maxLength = lengthParam ? parseInt(lengthParam, 10) : undefined

      try {
        const { readTerminalBuffer } = await import('./terminal-server.js')
        const buffer = readTerminalBuffer(widgetId, { maxLength: maxLength || undefined })
        if (buffer) {
          sendJson(res, 200, buffer)
          return
        }
        sendJson(res, 404, { error: 'Buffer not found' })
      } catch (err) {
        sendJson(res, 500, { error: `Failed to read buffer: ${err.message}` })
      }
      return
    }

    // GET /terminal-snapshot/:widgetId — read terminal snapshot JSON (new + legacy fallback)
    if (routePath.startsWith('/terminal-snapshot/') && method === 'GET') {
      const widgetId = routePath.slice('/terminal-snapshot/'.length)
      if (!widgetId || widgetId.includes('..') || widgetId.includes('/')) {
        sendJson(res, 400, { error: 'Invalid widgetId' })
        return
      }

      try {
        const { readTerminalSnapshot } = await import('./terminal-server.js')

        // Try new path first
        const snapshot = readTerminalSnapshot(widgetId)
        if (snapshot) {
          sendJson(res, 200, snapshot)
          return
        }

        // Legacy fallback: .storyboard/terminal-snapshots/<canvasDir>/<widgetId>.json
        const snapshotsRoot = path.join(root, '.storyboard', 'terminal-snapshots')
        if (fs.existsSync(snapshotsRoot)) {
          const dirs = fs.readdirSync(snapshotsRoot, { withFileTypes: true })
          for (const d of dirs) {
            if (!d.isDirectory()) continue
            const filePath = path.join(snapshotsRoot, d.name, `${widgetId}.json`)
            if (fs.existsSync(filePath)) {
              const data = fs.readFileSync(filePath, 'utf8')
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(data)
              return
            }
          }
        }
        sendJson(res, 404, { error: 'Snapshot not found' })
      } catch (err) {
        sendJson(res, 500, { error: `Failed to read snapshot: ${err.message}` })
      }
      return
    }

    // DELETE /delete-canvas — delete a canvas and its directory
    if (routePath === '/delete-canvas' && method === 'DELETE') {
      const { name } = body
      if (!name || typeof name !== 'string') {
        sendJson(res, 400, { error: 'Canvas name is required' })
        return
      }

      const filePath = findCanvasPath(root, name)
      if (!filePath) {
        sendJson(res, 404, { error: `Canvas "${name}" not found` })
        return
      }

      try {
        const dir = path.dirname(filePath)
        const canvasDir = canvasContentRoot(root)

        // Delete the canvas file
        fs.unlinkSync(filePath)

        // If the parent directory is inside src/canvas/ and now empty (or only has .meta.json), remove it
        if (dir !== canvasDir) {
          const remaining = fs.readdirSync(dir).filter(f => !f.endsWith('.meta.json'))
          if (remaining.length === 0) {
            for (const f of fs.readdirSync(dir)) {
              fs.unlinkSync(path.join(dir, f))
            }
            fs.rmdirSync(dir)
          }
        }

        sendJson(res, 200, { success: true, deleted: name })
      } catch (err) {
        sendJson(res, 500, { error: `Failed to delete canvas: ${err.message}` })
      }
      return
    }

    // PUT /update-meta — update canvas metadata
    if (routePath === '/update-meta' && method === 'PUT') {
      const { name, title, description, author } = body
      if (!name || typeof name !== 'string') {
        sendJson(res, 400, { error: 'Canvas name is required' })
        return
      }

      const filePath = findCanvasPath(root, name)
      if (!filePath) {
        sendJson(res, 404, { error: `Canvas "${name}" not found` })
        return
      }

      try {
        // Try to find and update .meta.json first
        const dir = path.dirname(filePath)
        const dirName = path.basename(dir).replace(/\.folder$/, '')
        const metaPath = path.join(dir, `${dirName}.meta.json`)

        if (fs.existsSync(metaPath)) {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
          if (title !== undefined) meta.title = title
          if (description !== undefined) meta.description = description
          if (author !== undefined) meta.author = author
          fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf-8')
        } else {
          // Update the canvas JSONL's canvas_created event metadata
          const text = fs.readFileSync(filePath, 'utf-8')
          const lines = text.split('\n').filter(Boolean)
          if (lines.length > 0) {
            const firstEvent = JSON.parse(lines[0])
            if (title !== undefined) firstEvent.title = title
            if (description !== undefined) firstEvent.description = description
            if (author !== undefined) firstEvent.author = author
            lines[0] = JSON.stringify(firstEvent)
            fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8')
          }
        }

        // Notify via WebSocket
        await pushCanvasUpdate(name, filePath, __viteWs)

        sendJson(res, 200, { success: true, updated: name })
      } catch (err) {
        sendJson(res, 500, { error: `Failed to update canvas metadata: ${err.message}` })
      }
      return
    }

    sendJson(res, 404, { error: `Unknown route: ${method} ${routePath}` })
  }
}
