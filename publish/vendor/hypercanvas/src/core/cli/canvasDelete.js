/**
 * storyboard canvas delete <widgetId> — Delete a widget from a canvas.
 *
 * Usage:
 *   storyboard canvas delete <widgetId> --canvas my-canvas
 *
 * Flags:
 *   Positional: <widgetId>   Widget ID to delete (required)
 *   -c, --canvas             Canvas name (required)
 *   --json                   Output as JSON
 */

import { del, parseSimpleArgs, jsonOut, die } from './cliHelpers.js'

const args = process.argv.slice(4) // skip: node, sb, canvas, delete

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
  canvas delete flags:

    Positional: <widgetId>   Widget ID to delete (required)
    -c, --canvas             Canvas name (required)
    --json                   Output as JSON
`)
  process.exit(0)
}

const { positional, flags } = parseSimpleArgs(args)
const widgetId = positional[0]
const canvas = flags.canvas || flags.c

if (!widgetId) die('Widget ID is required')
if (!canvas) die('--canvas is required')

try {
  const result = await del('/_storyboard/canvas/widget', { name: canvas, widgetId })
  if (flags.json) { jsonOut(result) } else { console.log(`Widget ${widgetId} deleted`) }
} catch (err) { die(err.message) }
