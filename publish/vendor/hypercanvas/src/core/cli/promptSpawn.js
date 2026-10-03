/**
 * storyboard prompt spawn — Spawn a prompt agent session (acquires from hot pool).
 *
 * Usage:
 *   storyboard prompt spawn --canvas <id> --widget <id> --prompt "task"
 *
 * Flags:
 *   -c, --canvas     Canvas ID (required, defaults to $STORYBOARD_CANVAS_ID)
 *   -w, --widget     Widget ID (required, defaults to $STORYBOARD_WIDGET_ID)
 *   -p, --prompt     Prompt / task text (required)
 *   --json           Output as JSON
 */

import { post, parseSimpleArgs, jsonOut, die } from './cliHelpers.js'

const sub = process.argv[3]

if (sub === '--help' || sub === '-h' || !sub) {
  console.log(`
  prompt subcommands:

    spawn    Spawn a prompt agent session

  spawn flags:
    -c, --canvas     Canvas ID (defaults to $STORYBOARD_CANVAS_ID)
    -w, --widget     Widget ID (defaults to $STORYBOARD_WIDGET_ID)
    -p, --prompt     Prompt / task text (required)
    --json           Output as JSON
`)
  process.exit(0)
}

if (sub !== 'spawn') die(`Unknown prompt subcommand: ${sub}. Use: prompt spawn`)

const args = process.argv.slice(4)
const { flags } = parseSimpleArgs(args)

const canvasId = flags.canvas || flags.c || process.env.STORYBOARD_CANVAS_ID
const widgetId = flags.widget || flags.w || process.env.STORYBOARD_WIDGET_ID
const prompt = flags.prompt || flags.p

if (!canvasId || !widgetId || !prompt) {
  die('--canvas, --widget, and --prompt are required (canvas/widget default from env)')
}

try {
  const result = await post('/_storyboard/canvas/prompt/spawn', { canvasId, widgetId, prompt })
  if (flags.json) {
    jsonOut(result)
  } else {
    console.log(`Prompt agent spawned: ${result.sessionId || widgetId} (status: ${result.status || 'running'})`)
  }
} catch (err) { die(err.message) }
