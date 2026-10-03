#!/usr/bin/env node
/**
 * storyboard sessions — interactive terminal session browser.
 *
 * Lists terminal sessions from the dev server registry, grouped by
 * canvas and branch. Uses @clack/prompts for interactive selection.
 *
 * Usage:
 *   storyboard sessions           # list sessions for current branch
 *   storyboard sessions --all     # list sessions across all branches
 */

import * as p from '@clack/prompts'
import { detectWorktreeName, resolveRunningPort } from '../worktree/port.js'
import { parseFlags } from './flags.js'
import { dim, cyan, bold, yellow } from './intro.js'
import { openTerminalRelay } from './terminal-relay.js'
import { getServerUrl } from './serverUrl.js'

const blue = (s) => `\x1b[34m${s}\x1b[0m`
const orange = (s) => `\x1b[38;5;180m${s}\x1b[0m`
const green = (s) => `\x1b[32m${s}\x1b[0m`

const flagSchema = {
  all: { type: 'boolean', description: 'Show sessions from all branches' },
  branch: { type: 'string', description: 'Filter by branch name' },
}

const { flags } = parseFlags(process.argv.slice(3), flagSchema)

/** Resolve the dev server base URL (direct localhost) */
function getBaseUrl(worktreeName, port) {
  void worktreeName
  void port
  const directBase = `${getServerUrl()}/`
  return { directBase }
}

async function fetchSessions(worktreeName, port, branch = null) {
  const { directBase } = getBaseUrl(worktreeName, port)
  const suffix = branch
    ? `_storyboard/terminal/sessions?branch=${encodeURIComponent(branch)}`
    : `_storyboard/terminal/sessions`

  for (const base of [directBase]) {
    try {
      const res = await fetch(`${base}${suffix}`, { signal: AbortSignal.timeout(3000) })
      if (!res.ok) continue
      const data = await res.json()
      return data.sessions || []
    } catch { continue }
  }
  return null
}

function relativeTime(iso) {
  if (!iso) return dim('—')
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function summaryText(entry, showCanvas = true) {
  const name = entry.name || entry.widgetId || 'unknown'
  if (!showCanvas) return name
  const canvas = entry.canvasId && entry.canvasId !== 'unknown'
    ? entry.canvasId.split('/').pop()
    : null
  return canvas ? `${canvas} › ${name}` : name
}

// Column widths (character count, must match between header and rows)
const COL = { num: 6, status: 12, modified: 12, created: 12 }

function truncate(str, len) {
  if (str.length <= len) return str.padEnd(len)
  return str.slice(0, len - 1) + '…'
}

function formatRow(idx, entry, isCurrent = false, showCanvas = true) {
  const num = `${idx + 1}.`.padEnd(COL.num)
  const status = truncate(
    entry.status === 'live' ? 'Live' : entry.status === 'background' ? 'Background' : 'Archived',
    COL.status
  )
  const statusColored = entry.status === 'live' ? blue(status)
    : entry.status === 'background' ? orange(status)
    : dim(status)
  const modified = truncate(relativeTime(entry.lastConnectedAt), COL.modified)
  const created = truncate(relativeTime(entry.createdAt), COL.created)
  const summary = summaryText(entry, showCanvas)

  let badges = ''
  if (isCurrent) badges += ' ' + cyan('(current)')

  // Show removal countdown for archived sessions
  if (entry.status === 'archived' && entry.expiresAt) {
    const remaining = Math.max(0, entry.expiresAt - Date.now())
    const mins = Math.ceil(remaining / 60000)
    badges += ' ' + dim(`(removal in ${mins}m)`)
  }

  const summaryColored = entry.status === 'live'
    ? blue(summary)
    : entry.status === 'background'
      ? orange(summary)
      : dim(summary)

  return `  ${dim(num)}${statusColored}${dim(modified)}${dim(created)}${summaryColored}${badges}`
}

/** Call the bulk cleanup API */
async function cleanupSessions(worktreeName, port, statuses) {
  const { directBase } = getBaseUrl(worktreeName, port)
  for (const base of [directBase]) {
    try {
      const res = await fetch(`${base}_storyboard/terminal/sessions/cleanup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statuses }),
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) return await res.json()
    } catch { continue }
  }
  return null
}

/** Wait for a single keypress and return it. Returns null if not a TTY. */
function waitForKey() {
  const { stdin } = process
  if (!stdin.isTTY) return Promise.resolve(null)
  return new Promise((resolve) => {
    const wasRaw = stdin.isRaw
    stdin.setRawMode(true)
    stdin.resume()
    stdin.once('data', (data) => {
      stdin.setRawMode(wasRaw)
      stdin.pause()
      resolve(data)
    })
  })
}

/** Count sessions by status */
function countByStatus(sessions) {
  let live = 0, background = 0, archived = 0
  for (const s of sessions) {
    if (s.status === 'live') live++
    else if (s.status === 'background') background++
    else if (s.status === 'archived') archived++
  }
  return { live, background, archived }
}

/** Show cleanup pre-prompt. Returns true if user chose cleanup (and it was handled). */
async function showCleanupPrompt(sessions, worktreeName, port) {
  const { live, background, archived } = countByStatus(sessions)
  const cleanable = background + archived
  if (cleanable === 0) return false

  const parts = []
  if (live > 0) parts.push(blue(`${live} live`))
  if (background > 0) parts.push(orange(`${background} background`))
  if (archived > 0) parts.push(dim(`${archived} archived`))

  p.log.info(`${sessions.length} sessions: ${parts.join(dim(' · '))}`)
  process.stdout.write(`\n  ${dim('Press')} Tab ${dim('to clean up sessions, or')} Enter ${dim('to browse')}\n\n`)

  const key = await waitForKey()
  if (!key) return false // non-TTY, skip pre-prompt
  const keyStr = key.toString()

  // Tab = \t, Enter = \r or \n, Ctrl+C = \x03
  if (keyStr === '\x03') {
    p.outro(dim('Done'))
    process.exit(0)
  }

  if (keyStr !== '\t') return false // Enter or any other key → continue to session list

  // Build cleanup options
  const options = []
  if (archived > 0) {
    options.push({
      value: 'archived',
      label: `Remove ${bold(String(archived))} archived session${archived !== 1 ? 's' : ''}`,
    })
  }
  if (cleanable > 0 && (archived > 0 && background > 0)) {
    options.push({
      value: 'all',
      label: `Remove ${bold(String(cleanable))} archived + background sessions`,
    })
  } else if (background > 0 && archived === 0) {
    options.push({
      value: 'all',
      label: `Remove ${bold(String(background))} background session${background !== 1 ? 's' : ''}`,
    })
  }
  options.push({ value: 'cancel', label: dim('Cancel') })

  const action = await p.select({
    message: 'Clean up sessions',
    options,
  })

  if (p.isCancel(action) || action === 'cancel') return false

  const statuses = action === 'archived' ? ['archived'] : ['archived', 'background']
  const targetCount = action === 'archived' ? archived : cleanable
  const statusLabel = action === 'archived' ? 'archived' : 'archived + background'

  const confirm = await p.confirm({
    message: `Remove ${bold(String(targetCount))} ${statusLabel} session${targetCount !== 1 ? 's' : ''}? This cannot be undone.`,
  })
  if (p.isCancel(confirm) || !confirm) return false

  const result = await cleanupSessions(worktreeName, port, statuses)
  if (result && result.success) {
    p.log.success(green(`Removed ${result.removed} session${result.removed !== 1 ? 's' : ''}`))
    const rem = result.remaining
    if (rem && rem.total > 0) {
      p.log.info(dim(`${rem.total} remaining: ${rem.live} live, ${rem.background} background, ${rem.archived} archived`))
    }
  } else {
    p.log.error('Cleanup failed — could not reach dev server')
  }

  return true // handled — re-enter loop to refresh list
}

async function main() {
  const worktreeName = detectWorktreeName()
  const port = resolveRunningPort(worktreeName)
  // Session list loop — user can navigate back here after actions
  while (true) {
    p.intro(bold('Terminal Sessions'))

    // Fetch sessions
    const filterBranch = flags.all ? null : (flags.branch || worktreeName)
    const sessions = await fetchSessions(worktreeName, port, filterBranch)

    if (sessions === null) {
      p.log.error('Could not connect to dev server. Is it running?')
      p.log.info(`Expected at: ${dim(`http://localhost:${port}`)}`)
      p.outro('')
      process.exit(1)
    }

    if (sessions.length === 0) {
      p.log.info('No terminal sessions found.')
      if (!flags.all) {
        p.log.info(`Showing sessions for branch ${cyan(worktreeName)}. Use ${bold('--all')} to see all branches.`)
      }
      p.outro('')
      process.exit(0)
    }

    // Show Tab cleanup pre-prompt when there are cleanable sessions
    const didCleanup = await showCleanupPrompt(sessions, worktreeName, port)
    if (didCleanup) continue // re-fetch and re-render after cleanup

    // Determine if all sessions are from the same canvas (hide canvas name if so)
    const canvasIds = new Set(sessions.map(s => s.canvasId).filter(c => c && c !== 'unknown'))
    const showCanvas = canvasIds.size > 1

    // Build options for clack select — flat list, no separators
    const options = []
    let idx = 0

    for (const s of sessions) {
      options.push({
        value: s.sessionId,
        label: formatRow(idx, s, false, showCanvas),
      })
      idx++
    }

    // Header — uses same COL widths, offset by 2 chars for Clack radio prefix
    const scope = flags.all ? 'All branches' : `Branch: ${cyan(worktreeName)}`
    const header = dim(`    ${'#'.padEnd(COL.num)}${'Status'.padEnd(COL.status)}${'Modified'.padEnd(COL.modified)}${'Created'.padEnd(COL.created)}Summary`)

    const selected = await p.select({
      message: `Select a session ${dim('·')} ${scope} ${dim('·')} ${sessions.length} session${sessions.length !== 1 ? 's' : ''}\n\n${header}\n`,
      options: [
        ...options,
        { value: '__sep', label: '\u200B' },
        { value: '__back', label: dim('Back to options') },
      ],
    })

    if (p.isCancel(selected) || selected === '__back' || selected === '__sep') {
      p.outro(dim('Done'))
      process.exit(0)
    }

    // Find the selected session
    const session = sessions.find(s => s.sessionId === selected)
    if (!session) {
      p.log.error('Session not found')
      continue
    }

    // Session detail loop — user can navigate back to session list
    let stayInDetail = true
    while (stayInDetail) {
      const statusText = session.status === 'live'
        ? blue('Live')
        : session.status === 'background' ? orange('Background')
        : dim('Archived')

      p.log.success(`Selected: ${bold(session.name || session.sessionId)}`)
      p.log.info(`Status: ${statusText} · Canvas: ${cyan(session.canvasId)} · Widget: ${dim(session.widgetId)}`)

      const next = await p.select({
        message: 'What would you like to do?',
        options: [
          { value: 'open', label: 'Open session', hint: 'attach in this terminal' },
          { value: 'remove', label: yellow('Remove session'), hint: 'permanently destroy' },
          { value: 'back', label: dim('Back to sessions') },
        ],
      })

      if (p.isCancel(next) || next === 'back') {
        stayInDetail = false
        continue
      }

      if (next === 'open') {
        // Warn if session is already live on another widget
        if (session.status === 'live') {
          p.log.warn(
            `Session ${cyan(session.name || session.sessionId)} is currently ${blue('Live')} on widget ${dim(session.widgetId)} ` +
            `in canvas ${cyan(session.canvasId)}.`
          )
          const confirm = await p.confirm({
            message: 'Open anyway? This may cause conflicts with the live widget.',
          })
          if (p.isCancel(confirm) || !confirm) continue
        }

        p.outro(`Opening ${bold(session.name || session.sessionId)}...`)
        await openTerminalRelay({ serverUrl: getServerUrl(), session })
        process.exit(0)
      }

      if (next === 'remove') {
        const label = session.name || session.sessionId
        const widgetNote = session.widgetId && session.widgetId !== 'unknown'
          ? `\n  This will also ${yellow('remove the terminal widget')} from canvas ${cyan(session.canvasId)}.`
          : ''
        const confirm = await p.confirm({
          message: `Permanently remove session ${bold(label)}?${widgetNote}\n  The session and all running processes inside it will be destroyed.`,
        })
        if (p.isCancel(confirm) || !confirm) continue

        try {
          const { directBase } = getBaseUrl(worktreeName, port)
          let removed = false
          for (const base of [directBase]) {
            try {
              const res = await fetch(
                `${base}_storyboard/terminal/sessions/${encodeURIComponent(session.sessionId)}`,
                { method: 'DELETE', signal: AbortSignal.timeout(3000) }
              )
              if (res.ok) { removed = true; break }
            } catch { continue }
          }
          if (removed) {
            p.log.success(`Session ${cyan(label)} removed`)
          } else {
            p.log.error('API call failed; the running Storyboard server is required to remove sessions')
          }

          // Remove widget from canvas
          if (session.widgetId && session.widgetId !== 'unknown' && session.canvasId && session.canvasId !== 'unknown') {
            for (const base of [directBase]) {
              try {
                const res = await fetch(`${base}_storyboard/canvas/widget`, {
                  method: 'DELETE',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name: session.canvasId, widgetId: session.widgetId }),
                  signal: AbortSignal.timeout(3000),
                })
                if (res.ok) {
                  p.log.success(`Widget ${dim(session.widgetId)} removed from canvas ${cyan(session.canvasId)}`)
                  break
                }
              } catch { continue }
            }
          }
        } catch {
          p.log.error('Failed to remove session')
        }

        // Go back to session list (re-fetches to show updated list)
        stayInDetail = false
        continue
      }
    }
  }
}

main().catch((err) => {
  p.log.error(err.message)
  process.exit(1)
})
