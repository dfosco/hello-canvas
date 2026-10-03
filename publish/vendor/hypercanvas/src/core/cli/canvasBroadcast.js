/**
 * storyboard canvas broadcast — Toggle broadcast messaging for a widget and its connections.
 *
 * Usage:
 *   storyboard canvas broadcast --canvas my-canvas --widget <id> --mode two-way --pass-through
 *   storyboard canvas broadcast --canvas my-canvas --widget <id> --mode none
 *
 * Modes:
 *   two-way   Both sides can send and receive (default)
 *   one-way   Only the source widget sends
 *   none      Disable broadcast
 *
 * Flags:
 *   -c, --canvas         Target canvas name (required)
 *   -w, --widget         Source widget ID (required, defaults to $STORYBOARD_WIDGET_ID)
 *   -m, --mode           Messaging mode: two-way, one-way, none [default: two-way]
 *   --pass-through       BFS traverse entire connected component [default: false]
 *   --json               Output result as JSON [default: false]
 */

import * as p from '@clack/prompts'
import { ensureDevServer, serverPost } from './create.js'
import { parseFlags, hasFlags, formatFlagHelp } from './flags.js'

const broadcastSchema = {
  canvas: {
    type: 'string',
    required: true,
    description: 'Target canvas name',
    aliases: ['c'],
  },
  widget: {
    type: 'string',
    description: 'Source widget ID (defaults to $STORYBOARD_WIDGET_ID)',
    aliases: ['w'],
  },
  mode: {
    type: 'string',
    description: 'Messaging mode: two-way, one-way, none',
    aliases: ['m'],
    default: 'two-way',
  },
  'pass-through': {
    type: 'boolean',
    description: 'BFS traverse entire connected component',
    default: false,
  },
  json: {
    type: 'boolean',
    description: 'Output result as JSON',
    default: false,
  },
}

async function canvasBroadcast() {
  const rest = process.argv.slice(4)

  if (rest.includes('--help') || rest.includes('-h')) {
    console.log(`\n  canvas broadcast flags:\n`)
    console.log(formatFlagHelp(broadcastSchema))
    console.log('')
    process.exit(0)
  }

  const flagMode = hasFlags(rest) || rest.length > 0
  const { flags, errors } = flagMode ? parseFlags(rest, broadcastSchema) : { flags: {}, errors: [] }
  const jsonOutput = flags.json || false

  if (errors.length) {
    for (const e of errors) p.log.error(e)
    process.exit(1)
  }

  if (!jsonOutput) p.intro('storyboard canvas broadcast')
  await ensureDevServer({ quiet: jsonOutput })

  const canvasName = flags.canvas
  if (!canvasName) {
    if (jsonOutput) {
      console.error(JSON.stringify({ error: '--canvas is required' }))
      process.exit(1)
    }
    p.log.error('--canvas is required')
    process.exit(1)
  }

  const widgetId = flags.widget || process.env.STORYBOARD_WIDGET_ID
  if (!widgetId) {
    const msg = '--widget is required (or set $STORYBOARD_WIDGET_ID)'
    if (jsonOutput) {
      console.error(JSON.stringify({ error: msg }))
      process.exit(1)
    }
    p.log.error(msg)
    process.exit(1)
  }

  const mode = flags.mode || 'two-way'
  if (!['two-way', 'one-way', 'none'].includes(mode)) {
    const msg = '--mode must be "two-way", "one-way", or "none"'
    if (jsonOutput) {
      console.error(JSON.stringify({ error: msg }))
      process.exit(1)
    }
    p.log.error(msg)
    process.exit(1)
  }

  const passThrough = flags['pass-through'] || false

  const body = {
    name: canvasName,
    widgetId,
    mode,
    passThrough,
  }

  if (jsonOutput) {
    try {
      const result = await serverPost('/_storyboard/canvas/broadcast', body)
      console.log(JSON.stringify(result))
    } catch (err) {
      console.error(JSON.stringify({ error: err.message }))
      process.exit(1)
    }
    return
  }

  const s = p.spinner()
  s.start(`Setting broadcast ${mode}${passThrough ? ' (pass-through)' : ''}`)

  try {
    const result = await serverPost('/_storyboard/canvas/broadcast', body)
    const count = result.affectedConnectors ?? result.updated ?? 0
    s.stop(`Broadcast updated!`)
    p.log.success(`  mode: ${mode}, connectors: ${count}, pass-through: ${passThrough}`)
    p.outro('')
  } catch (err) {
    s.stop('Failed to set broadcast')
    p.log.error(err.message)
    p.outro('')
  }
}

canvasBroadcast()
