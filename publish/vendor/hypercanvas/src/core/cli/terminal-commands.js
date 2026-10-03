#!/usr/bin/env node
/**
 * storyboard terminal {close|open|remove} --id <name-or-id>
 *
 * Subcommands for managing terminal sessions by friendly name, session ID, or widget ID.
 */

import * as p from '@clack/prompts'
import { detectWorktreeName, resolveRunningPort } from '../worktree/port.js'
import { parseFlags } from './flags.js'
import { dim, cyan, bold, yellow } from './intro.js'
import { openTerminalRelay } from './terminal-relay.js'
import { getServerUrl } from './serverUrl.js'

const flagSchema = {
  id: { type: 'string', required: true, description: 'Session name, session ID, or widget ID' },
}

const subcommand = process.argv[3]
const { flags, missing, errors } = parseFlags(process.argv.slice(4), flagSchema)

/** Resolve the dev server base URL (direct localhost) */
function getBaseUrl(worktreeName, port) {
  void worktreeName
  void port
  const directBase = `${getServerUrl()}/`
  return { directBase }
}

/** Fetch all sessions from the dev server */
async function fetchSessions(worktreeName, port) {
  const { directBase } = getBaseUrl(worktreeName, port)
  for (const base of [directBase]) {
    try {
      const res = await fetch(`${base}_storyboard/terminal/sessions`, { signal: AbortSignal.timeout(3000) })
      if (!res.ok) continue
      const data = await res.json()
      return { sessions: data.sessions || [], base }
    } catch { continue }
  }
  return null
}

/** POST/DELETE helper that tries proxy then direct */
async function apiRequest(worktreeName, port, path, method = 'POST', body = null) {
  const { directBase } = getBaseUrl(worktreeName, port)
  for (const base of [directBase]) {
    try {
      const opts = { method, signal: AbortSignal.timeout(5000) }
      if (body) {
        opts.headers = { 'Content-Type': 'application/json' }
        opts.body = JSON.stringify(body)
      }
      const res = await fetch(`${base}${path}`, opts)
      if (res.ok) return { ok: true, data: await res.json().catch(() => ({})) }
    } catch { continue }
  }
  return { ok: false }
}

/**
 * Resolve --id to a session entry. Tries:
 * 1. Friendly name match (e.g. "red-robin")
 * 2. Exact session ID match (e.g. "sb-abc123def456")
 * 3. Widget ID match (e.g. "terminal-abc123")
 */
function resolveSession(sessions, id) {
  // Friendly name
  const byName = sessions.find(s => s.name === id)
  if (byName) return byName
  const bySession = sessions.find(s => s.sessionId === id)
  if (bySession) return bySession
  // Widget ID
  const byWidget = sessions.find(s => s.widgetId === id)
  if (byWidget) return byWidget
  return null
}

// ── Close (archive) ──

async function closeSession(session, worktreeName, port) {
  p.intro(bold('Close session'))

  const label = session.name || session.sessionId

  if (session.status === 'live') {
    p.log.info(`Session ${cyan(label)} is live — detaching first...`)
    const detachResult = await apiRequest(
      worktreeName, port,
      `_storyboard/terminal/sessions/${encodeURIComponent(session.sessionId)}/detach`,
    )
    if (!detachResult.ok) {
      p.log.warn('Could not detach via API, continuing with archive...')
    }
  }

  // Orphan the session (archive with grace timer)
  const orphanResult = await apiRequest(
    worktreeName, port,
    `_storyboard/terminal/sessions/${encodeURIComponent(session.sessionId)}/orphan`,
  )

  if (orphanResult.ok) {
    p.log.success(`Session ${cyan(label)} archived with a grace timer.`)
  } else {
    p.log.error(`Failed to archive session ${cyan(label)}`)
    process.exit(1)
  }

  p.outro('')
}

// ── Open (attach) ──

async function openSession(session) {
  p.intro(bold('Open session'))

  const label = session.name || session.sessionId

  if (session.status === 'live') {
    p.log.warn(
      `Session ${cyan(label)} is currently live on widget ${dim(session.widgetId)} ` +
      `in canvas ${cyan(session.canvasId)}.`
    )
    const confirm = await p.confirm({
      message: 'Attach anyway? This may cause conflicts with the live widget.',
    })
    if (p.isCancel(confirm) || !confirm) {
      p.outro(dim('Cancelled'))
      process.exit(0)
    }
  }

  p.outro(`Attaching to ${bold(label)}...`)
  await openTerminalRelay({ serverUrl: getServerUrl(), session })
}

// ── Remove (destroy) ──

async function removeSession(session, worktreeName, port) {
  p.intro(bold('Remove session'))

  const label = session.name || session.sessionId

  const widgetNote = session.widgetId && session.widgetId !== 'unknown'
    ? `\n  This will also ${yellow('remove the terminal widget')} from canvas ${cyan(session.canvasId)}.`
    : ''

  const confirm = await p.confirm({
    message: `Permanently destroy session ${bold(label)}?${widgetNote}\n  The PTY session and all running processes inside it will be lost.`,
  })

  if (p.isCancel(confirm) || !confirm) {
    p.outro(dim('Cancelled'))
    process.exit(0)
  }

  // Kill via API
  const killResult = await apiRequest(
    worktreeName, port,
    `_storyboard/terminal/sessions/${encodeURIComponent(session.sessionId)}`,
    'DELETE',
  )

  if (killResult.ok) {
    p.log.success(`Session ${cyan(label)} destroyed`)
  } else {
    p.log.error('Failed to kill session through the running Storyboard server')
    process.exit(1)
  }

  // Remove widget from canvas
  if (session.widgetId && session.widgetId !== 'unknown' && session.canvasId && session.canvasId !== 'unknown') {
    const removeResult = await apiRequest(
      worktreeName, port,
      '_storyboard/canvas/widget',
      'DELETE',
      { name: session.canvasId, widgetId: session.widgetId },
    )
    if (removeResult.ok) {
      p.log.success(`Widget ${dim(session.widgetId)} removed from canvas ${cyan(session.canvasId)}`)
    }
  }

  p.outro('')
}

// ── Main ──

async function main() {
  if (missing.length > 0 || errors.length > 0) {
    p.intro(bold('Terminal'))
    if (errors.length) errors.forEach(e => p.log.error(e))
    if (missing.length) p.log.error(`Missing required flag: ${bold('--id')}`)
    p.log.info(`Usage: ${cyan(`storyboard terminal ${subcommand} --id <name-or-id>`)}`)
    p.outro('')
    process.exit(1)
  }

  const worktreeName = detectWorktreeName()
  const port = resolveRunningPort(worktreeName)
  const result = await fetchSessions(worktreeName, port)

  if (!result) {
    p.intro(bold('Terminal'))
    p.log.error('Could not connect to dev server. Is it running?')
    p.outro('')
    process.exit(1)
  }

  const session = resolveSession(result.sessions, flags.id)
  if (!session) {
    p.intro(bold('Terminal'))
    p.log.error(`No session found matching ${bold(flags.id)}`)
    p.log.info(`Try ${cyan('storyboard terminal')} to browse sessions.`)
    p.outro('')
    process.exit(1)
  }

  switch (subcommand) {
    case 'close':
    case 'archive':
      await closeSession(session, worktreeName, port)
      break
    case 'open':
      await openSession(session, worktreeName, port)
      break
    case 'remove':
      await removeSession(session, worktreeName, port)
      break
    default:
      p.log.error(`Unknown subcommand: ${subcommand}`)
      process.exit(1)
  }
}

main().catch((err) => {
  p.log.error(err.message)
  process.exit(1)
})
