/**
 * Terminal Messaging CLI — send messages between terminals and save output.
 *
 * Commands:
 *   storyboard terminal output --summary "..." --content "..."  Save latest output
 *   storyboard terminal status <widgetId>               Check terminal status
 *   storyboard terminal read <widgetId>                 Read terminal buffer
 *   storyboard terminal input --widget <id> --text "..." [--enter]
 *                                                     Submit text to a terminal PTY
 */

import { getServerUrl } from './serverUrl.js'
import { resolveNotebookRoot } from './filesystemRoots.js'

function parseArgs(args) {
  const result = { positional: [], flags: {} }
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const equalsIndex = args[i].indexOf('=')
      if (equalsIndex !== -1) {
        result.flags[args[i].slice(2, equalsIndex)] = args[i].slice(equalsIndex + 1)
        continue
      }
      const key = args[i].slice(2)
      const next = args[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        result.flags[key] = next
        i++
      } else {
        result.flags[key] = true
      }
    } else {
      result.positional.push(args[i])
    }
  }
  return result
}

export async function requestTerminalInput(request) {
  const serverUrl = getServerUrl()
  const response = await fetch(`${serverUrl}/_storyboard/canvas/terminal/input`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(10000),
  })
  const result = await response.json()
  if (!response.ok || !result.success) {
    const error = new Error(result.error || `Terminal input failed with HTTP ${response.status}`)
    error.code = result.code || 'TERMINAL_INPUT_FAILED'
    error.statusCode = response.status
    throw error
  }
  return result
}

export async function handleInput() {
  const args = process.argv.slice(4) // skip: node, sb, terminal, input
  const { positional, flags } = parseArgs(args)
  const allowedFlags = new Set(['widget', 'session', 'text', 'enter', 'paste', 'canvas', 'branch'])
  const unknownFlag = Object.keys(flags).find(key => !allowedFlags.has(key))
  const widgetId = typeof flags.widget === 'string' ? flags.widget : null
  const sessionId = typeof flags.session === 'string' ? flags.session : null
  const text = flags.text

  if (unknownFlag) {
    console.error(`Error: unknown option --${unknownFlag}`)
    process.exit(1)
    return
  }
  if (positional.length || Number(Boolean(widgetId)) + Number(Boolean(sessionId)) !== 1 || typeof text !== 'string') {
    console.error('Usage: storyboard terminal input (--widget <id> | --session <id>) --text "..." [--enter] [--paste] [--canvas <id>] [--branch <name>]')
    process.exit(1)
    return
  }
  if (flags.enter !== undefined && flags.enter !== true) {
    console.error('Error: --enter takes no value; omit it to insert text without submitting')
    process.exit(1)
    return
  }
  if (flags.paste !== undefined && flags.paste !== true) {
    console.error('Error: --paste takes no value')
    process.exit(1)
    return
  }
  if (flags.canvas !== undefined && typeof flags.canvas !== 'string') {
    console.error('Error: --canvas requires a canvas ID')
    process.exit(1)
    return
  }
  if (flags.branch !== undefined && typeof flags.branch !== 'string') {
    console.error('Error: --branch requires a branch name')
    process.exit(1)
    return
  }

  const request = {
    ...(widgetId ? { widgetId } : { sessionId }),
    text,
    submit: flags.enter === true,
    ...(flags.paste === true ? { paste: true } : {}),
    ...(flags.canvas ? { canvasId: flags.canvas } : {}),
    ...(flags.branch ? { branch: flags.branch } : {}),
  }
  try {
    const result = await requestTerminalInput(request)
    console.log(`Terminal runtime accepted ${result.written} bytes; Enter ${result.submitted ? 'sent' : 'not sent'}.`)
  } catch (error) {
    if (error.name === 'TimeoutError') {
      console.error(`Error: request timed out — is the dev server running? (tried ${getServerUrl()})`)
    } else {
      console.error(`Error: ${error.message}`)
    }
    process.exit(1)
  }
}

export async function requestAgentActivation(agentId = null) {
  const widgetId = process.env.STORYBOARD_WIDGET_ID
  if (!widgetId) throw new Error('STORYBOARD_WIDGET_ID is not set')
  const serverUrl = getServerUrl()
  const response = await fetch(`${serverUrl}/_storyboard/canvas/terminal/activate-agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      widgetId,
      canvasId: process.env.STORYBOARD_CANVAS_ID || 'unknown',
      branch: process.env.STORYBOARD_BRANCH || 'unknown',
      agentId,
    }),
    signal: AbortSignal.timeout(65_000),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'Agent activation failed')
  return result
}

export async function handleActivateAgent() {
  const agentId = process.argv[4] || null
  try {
    const result = await requestAgentActivation(agentId)
    console.log(`Agent activated for terminal ${result.sessionId}`)
  } catch (error) {
    console.error(`Error: ${error.message}`)
    process.exit(1)
  }
}

export async function handleOutput() {
  const args = process.argv.slice(4) // skip: node, sb, terminal, output
  const { flags } = parseArgs(args)

  const widgetId = flags.widget || process.env.STORYBOARD_WIDGET_ID
  const summary = flags.summary || ''
  const content = flags.content || ''

  if (!widgetId) {
    console.error('Error: --widget <id> or $STORYBOARD_WIDGET_ID required')
    process.exit(1)
  }

  const serverUrl = getServerUrl()
  try {
    const res = await fetch(`${serverUrl}/_storyboard/canvas/terminal/output`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ widgetId, content, summary }),
      signal: AbortSignal.timeout(10000),
    })
    const data = await res.json()
    if (data.success) {
      console.log('Output saved')
    } else {
      console.error(`Failed: ${data.error}`)
      process.exit(1)
    }
  } catch (err) {
    if (err.name === 'TimeoutError') {
      console.error(`Error: request timed out — is the dev server running? (tried ${serverUrl})`)
    } else {
      console.error(`Error: ${err.message}`)
    }
    process.exit(1)
  }
}

export async function handleStatus() {
  const args = process.argv.slice(4) // skip: node, sb, terminal, status
  const { positional } = parseArgs(args)

  const widgetId = positional[0]
  if (!widgetId) {
    console.error('Usage: storyboard terminal status <widgetId>')
    process.exit(1)
  }

  try {
    const { readTerminalConfigById, initTerminalConfig } = await import('../canvas/terminal-config.js')
    initTerminalConfig(resolveNotebookRoot())
    const config = readTerminalConfigById(widgetId)
    if (!config) {
      console.error(`No config found for ${widgetId}`)
      process.exit(1)
    }
    console.log(JSON.stringify({
      widgetId: config.widgetId,
      displayName: config.displayName || null,
      agentStatus: config.agentStatus || null,
      latestOutput: config.latestOutput ? { summary: config.latestOutput.summary, updatedAt: config.latestOutput.updatedAt } : null,
      hubs: config.hubs || [],
    }, null, 2))
  } catch (err) {
    console.error(`Error: ${err.message}`)
    process.exit(1)
  }
}

export async function handleRead() {
  const args = process.argv.slice(4) // skip: node, sb, terminal, read
  const { positional, flags } = parseArgs(args)

  const widgetId = positional[0] || process.env.STORYBOARD_WIDGET_ID
  if (!widgetId) {
    console.error('Usage: storyboard terminal read <widgetId> [--length N]')
    process.exit(1)
  }

  const length = flags.length ? parseInt(flags.length, 10) : undefined

  // Try HTTP API first (dev server may have fresher data)
  try {
    const serverUrl = getServerUrl()
    const qs = length ? `?length=${length}` : ''
    const res = await fetch(`${serverUrl}/_storyboard/canvas/terminal-buffer/${encodeURIComponent(widgetId)}${qs}`, {
      signal: AbortSignal.timeout(3000),
    })
    if (res.ok) {
      const data = await res.json()
      console.log(JSON.stringify(data, null, 2))
      return
    }
  } catch {
    // Server not reachable — read directly from file
  }

  // Fallback: read buffer file directly
  try {
    const { readFileSync, existsSync } = await import('node:fs')
    const { join } = await import('node:path')
    const bufferPath = join(resolveNotebookRoot(), '.storyboard', 'terminal-buffers', `${widgetId}.buffer.json`)
    if (!existsSync(bufferPath)) {
      console.error(`No buffer found for ${widgetId}`)
      process.exit(1)
    }
    const data = JSON.parse(readFileSync(bufferPath, 'utf8'))
    if (length) {
      if (data.scrollback && data.scrollback.length > length) {
        data.scrollback = data.scrollback.slice(-length)
      }
      if (data.paneContent && data.paneContent.length > length) {
        data.paneContent = data.paneContent.slice(-length)
      }
    }
    console.log(JSON.stringify(data, null, 2))
  } catch (err) {
    console.error(`Error: ${err.message}`)
    process.exit(1)
  }
}

export async function handleKill() {
  const args = process.argv.slice(4) // skip: node, sb, terminal, kill
  const { positional, flags } = parseArgs(args)

  const widgetId = positional[0] || flags.widget || flags.w

  if (!widgetId) {
    console.error('Usage: storyboard terminal kill <widgetId>')
    console.error('       storyboard terminal kill --widget <widgetId>')
    process.exit(1)
  }

  const serverUrl = getServerUrl()
  try {
    const res = await fetch(`${serverUrl}/_storyboard/canvas/terminal/kill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ widgetId }),
      signal: AbortSignal.timeout(10000),
    })
    const data = await res.json()
    if (data.success) {
      console.log(`Terminal ${widgetId} killed (session: ${data.killed || 'unknown'})`)
    } else {
      console.error(`Failed: ${data.error}`)
      process.exit(1)
    }
  } catch (err) {
    if (err.name === 'TimeoutError') {
      console.error(`Error: request timed out — is the dev server running? (tried ${serverUrl})`)
    } else {
      console.error(`Error: ${err.message}`)
    }
    process.exit(1)
  }
}
