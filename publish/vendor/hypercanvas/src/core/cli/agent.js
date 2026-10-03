#!/usr/bin/env node
/**
 * storyboard agent signal — signal agent status to the canvas server.
 *
 * Usage:
 *   npx storyboard agent signal --widget <id> --canvas <canvasId> --status done|error|running|working [--message "..."]
 *
 * Environment variables (auto-set by terminal server):
 *   STORYBOARD_WIDGET_ID  — widget ID (fallback if --widget not provided)
 *   STORYBOARD_CANVAS_ID  — canvas ID (fallback if --canvas not provided)
 *   STORYBOARD_SERVER_URL — server base URL
 *   STORYBOARD_BRANCH     — current branch
 */

import { parseFlags } from './flags.js'
import { dim, bold, cyan, yellow } from './intro.js'
import { getServerUrl } from './serverUrl.js'
import { resolveNotebookRoot } from './filesystemRoots.js'

/**
 * Resolve a list of candidate server URLs to try, in priority order:
 *   1. Live server registry / worktree port (getServerUrl)
 *   2. STORYBOARD_SERVER_URL env (set when terminal was spawned — may be stale)
 *   3. Terminal config file (`.storyboard/terminals/<widgetId>.json`)
 *
 * Registry-first because the env var can be stale if the dev server was
 * restarted on a new port since the agent was spawned.
 */
async function resolveServerUrlCandidates(widgetId) {
  const urls = []
  const add = (u) => {
    if (!u) return
    const norm = String(u).replace(/\/$/, '')
    if (!urls.includes(norm)) urls.push(norm)
  }
  try { add(getServerUrl()) } catch { /* ignore */ }
  add(process.env.STORYBOARD_SERVER_URL)
  if (widgetId) {
    try {
      const { readFileSync, existsSync } = await import('node:fs')
      const path = await import('node:path')
      const cfgPath = path.join(resolveNotebookRoot(), '.storyboard', 'terminals', `${widgetId}.json`)
      if (existsSync(cfgPath)) {
        const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
        add(cfg.serverUrl)
      }
    } catch { /* ignore */ }
  }
  return urls
}

/**
 * POST to the first reachable candidate. Returns { url, res } on a server
 * response (caller checks res.ok). Returns null if every candidate failed
 * at the network layer.
 */
async function postWithFallback(candidates, pathSuffix, body, headers) {
  let lastErr = null
  for (const base of candidates) {
    const url = `${base}${pathSuffix}`
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(5000),
        })
        if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 404)) {
          return { url, res }
        }
        if (attempt === 1) break
        await new Promise((r) => setTimeout(r, 200))
      } catch (err) {
        lastErr = err
        break
      }
    }
  }
  if (lastErr) throw lastErr
  return null
}

const subcommand = process.argv[3]

if (subcommand === 'signal') {
  const flagSchema = {
    widget: { type: 'string', description: 'Widget ID' },
    canvas: { type: 'string', description: 'Canvas ID' },
    status: { type: 'string', required: true, description: 'Status: done, error, running, or working' },
    message: { type: 'string', description: 'Optional status message' },
  }

  const { flags } = parseFlags(process.argv.slice(4), flagSchema)

  const widgetId = flags.widget || process.env.STORYBOARD_WIDGET_ID
  const canvasId = flags.canvas || process.env.STORYBOARD_CANVAS_ID
  const status = flags.status
  const message = flags.message || null
  const branch = process.env.STORYBOARD_BRANCH || 'unknown'

  if (!widgetId || !canvasId || !status) {
    console.error(`${bold('Usage:')} npx storyboard agent signal --status done|error|running|working`)
    console.error(`${dim('Widget and canvas IDs are read from environment if not provided.')}`)
    process.exit(1)
  }

  const validStatuses = ['done', 'error', 'running', 'working']
  if (!validStatuses.includes(status)) {
    console.error(`${bold('Error:')} Status must be one of: ${validStatuses.join(', ')}`)
    process.exit(1)
  }

  const candidates = await resolveServerUrlCandidates(widgetId)
  const body = JSON.stringify({ widgetId, canvasId, branch, status, message })
  const headers = { 'Content-Type': 'application/json' }

  try {
    const result = candidates.length > 0
      ? await postWithFallback(candidates, '/_storyboard/canvas/agent/signal', body, headers)
      : null
    if (result && result.res.ok) {
      console.log(`${cyan('✓')} Agent status: ${bold(status)}${message ? ` — ${message}` : ''} ${dim(`(${result.url})`)}`)
    } else if (result) {
      const data = await result.res.json().catch(() => ({}))
      console.error(`${yellow('⚠')} Server returned ${result.res.status}: ${data.error || 'unknown error'} ${dim(`(${result.url})`)}`)
      await fallbackWrite({ branch, canvasId, widgetId, status, message })
    } else {
      console.error(`${yellow('⚠')} No reachable server. Tried: ${candidates.join(', ') || '(none resolved)'}`)
      await fallbackWrite({ branch, canvasId, widgetId, status, message })
    }
  } catch (err) {
    console.error(`${yellow('⚠')} Signal failed (${err.message}). Tried: ${candidates.join(', ')}`)
    await fallbackWrite({ branch, canvasId, widgetId, status, message })
  }
} else if (subcommand === 'spawn') {
  // POST /agent/spawn — spawn a headless agent session
  const { flags: spawnFlags } = parseFlags(process.argv.slice(4), {
    widget: { type: 'string', description: 'Widget ID' },
    canvas: { type: 'string', description: 'Canvas ID' },
    prompt: { type: 'string', required: true, description: 'Prompt / task for the agent' },
    'agent-id': { type: 'string', description: 'Agent binary key (copilot, claude, codex, opencode)' },
    autopilot: { type: 'boolean', description: 'Run in autopilot mode', default: true },
    branch: { type: 'string', description: 'Git branch override' },
  })

  const widgetId = spawnFlags.widget || process.env.STORYBOARD_WIDGET_ID
  const canvasId = spawnFlags.canvas || process.env.STORYBOARD_CANVAS_ID
  const prompt = spawnFlags.prompt
  const agentId = spawnFlags['agent-id'] || undefined
  const autopilot = spawnFlags.autopilot !== false
  const branchOverride = spawnFlags.branch || undefined
  const serverUrl = getServerUrl()

  if (!canvasId || !widgetId || !prompt) {
    console.error(`${bold('Usage:')} npx storyboard agent spawn --prompt "task description"`)
    console.error(`${dim('Canvas and widget IDs are read from environment if not provided.')}`)
    process.exit(1)
  }

  try {
    const res = await fetch(`${serverUrl}/_storyboard/canvas/agent/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canvasId, widgetId, prompt, autopilot, agentId, branch: branchOverride }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      console.log(`${cyan('✓')} Agent spawned: ${bold(data.sessionId || widgetId)} (status: ${data.status || 'running'})`)
    } else {
      console.error(`${yellow('⚠')} Server returned ${res.status}: ${data.error || 'unknown error'}`)
      process.exit(1)
    }
  } catch (err) {
    console.error(`Error: ${err.message}`)
    process.exit(1)
  }

} else if (subcommand === 'status') {
  // GET /agent/status — poll agent status
  const { flags: statusFlags } = parseFlags(process.argv.slice(4), {
    widget: { type: 'string', description: 'Widget ID' },
    canvas: { type: 'string', description: 'Canvas ID' },
    branch: { type: 'string', description: 'Git branch' },
  })

  const widgetId = statusFlags.widget || process.env.STORYBOARD_WIDGET_ID
  const canvasId = statusFlags.canvas || process.env.STORYBOARD_CANVAS_ID || 'unknown'
  const branch = statusFlags.branch || process.env.STORYBOARD_BRANCH || 'unknown'
  const serverUrl = getServerUrl()

  if (!widgetId) {
    console.error(`${bold('Usage:')} npx storyboard agent status --widget <id>`)
    process.exit(1)
  }

  try {
    const res = await fetch(`${serverUrl}/_storyboard/canvas/agent/status?widgetId=${encodeURIComponent(widgetId)}&canvasId=${encodeURIComponent(canvasId)}&branch=${encodeURIComponent(branch)}`, {
      signal: AbortSignal.timeout(10000),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      console.log(JSON.stringify(data, null, 2))
    } else {
      console.error(`${yellow('⚠')} ${data.error || `Status ${res.status}`}`)
      process.exit(1)
    }
  } catch (err) {
    console.error(`Error: ${err.message}`)
    process.exit(1)
  }

} else if (subcommand === 'peek') {
  // POST /agent/peek — read the headless PTY snapshot for a widget
  const { flags: peekFlags } = parseFlags(process.argv.slice(4), {
    widget: { type: 'string', required: true, description: 'Widget ID' },
    canvas: { type: 'string', description: 'Canvas ID' },
  })

  const widgetId = peekFlags.widget || process.env.STORYBOARD_WIDGET_ID
  const canvasId = peekFlags.canvas || process.env.STORYBOARD_CANVAS_ID
  const serverUrl = getServerUrl()

  if (!widgetId) {
    console.error(`${bold('Usage:')} npx storyboard agent peek --widget <id>`)
    process.exit(1)
  }

  try {
    const res = await fetch(`${serverUrl}/_storyboard/canvas/agent/peek`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ widgetId, canvasId }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      console.log(JSON.stringify(data, null, 2))
    } else {
      console.error(`${yellow('⚠')} ${data.error || `Status ${res.status}`}`)
      process.exit(1)
    }
  } catch (err) {
    console.error(`Error: ${err.message}`)
    process.exit(1)
  }

} else if (subcommand === 'list') {
  // GET /agents — list storyboard-spawned agent sessions on a canvas
  const { flags: listFlags } = parseFlags(process.argv.slice(4), {
    canvas: { type: 'string', description: 'Canvas ID' },
    branch: { type: 'string', description: 'Git branch (optional filter)' },
    json: { type: 'boolean', description: 'Print raw JSON instead of a table' },
  })

  const canvasId = listFlags.canvas || process.env.STORYBOARD_CANVAS_ID
  const branch = listFlags.branch || process.env.STORYBOARD_BRANCH || null
  const serverUrl = getServerUrl()

  if (!canvasId) {
    console.error(`${bold('Usage:')} npx storyboard agent list --canvas <id> [--branch <name>] [--json]`)
    process.exit(1)
  }

  try {
    const params = new URLSearchParams({ canvasId })
    if (branch) params.set('branch', branch)
    const res = await fetch(`${serverUrl}/_storyboard/canvas/agents?${params.toString()}`, {
      signal: AbortSignal.timeout(10000),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      console.error(`${yellow('⚠')} ${data.error || `Status ${res.status}`}`)
      process.exit(1)
    }
    if (listFlags.json) {
      console.log(JSON.stringify(data, null, 2))
    } else {
      const agents = Array.isArray(data.agents) ? data.agents : []
      if (agents.length === 0) {
        console.log(`${dim('No storyboard-spawned agents on canvas')} ${bold(canvasId)}${branch ? ` (branch ${branch})` : ''}`)
      } else {
        console.log(`${bold(`${agents.length} agent${agents.length === 1 ? '' : 's'}`)} on canvas ${cyan(canvasId)}${branch ? dim(` · branch ${branch}`) : ''}`)
        console.log(dim('(excludes external agents running outside storyboard)'))
        for (const a of agents) {
          const ts = a.statusUpdatedAt || a.updatedAt || ''
          const when = ts ? dim(` · ${ts}`) : ''
          const msg = a.message ? ` — ${a.message}` : ''
          console.log(`  ${bold(a.widgetId)} ${cyan(a.status)}${when}${msg}`)
        }
      }
    }
  } catch (err) {
    console.error(`Error: ${err.message}`)
    process.exit(1)
  }

} else {
  console.error(`${bold('Usage:')} npx storyboard agent <signal|spawn|status|peek|list>`)
  console.error(`${dim('Subcommands: signal, spawn, status, peek, list')}`)
  process.exit(1)
}

async function fallbackWrite({ branch, canvasId, widgetId, status, message }) {
  try {
    const { updateAgentStatus, initTerminalConfig } = await import('../canvas/terminal-config.js')
    initTerminalConfig(resolveNotebookRoot())
    updateAgentStatus({ branch, canvasId, widgetId, status, message })
    console.error(`${yellow('⚠')} Agent status persisted to config file only — UI will NOT update until server reconnects: ${bold(status)}`)
  } catch (err) {
    console.error(`Failed to write agent status: ${err.message}`)
    process.exit(1)
  }
}
