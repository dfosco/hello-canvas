/**
 * storyboard canvas undo — append the inverse of a previously-applied event.
 *
 * Usage:
 *   storyboard canvas undo --canvas my-canvas --event evt_xxx
 *
 * Flags:
 *   -c, --canvas             Canvas name (required)
 *   -e, --event              Event ID to undo (required)
 *   --json                   Output as JSON
 */

import { post, parseSimpleArgs, jsonOut, die } from './cliHelpers.js'

const args = process.argv.slice(4) // skip: node, sb, canvas, undo

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
  canvas undo flags:

    -c, --canvas             Canvas name (required)
    -e, --event              Event ID to undo (required)
    --json                   Output as JSON
`)
  process.exit(0)
}

const { flags } = parseSimpleArgs(args)
const canvas = flags.canvas || flags.c
const eventId = flags.event || flags.e

if (!canvas) die('--canvas is required')
if (!eventId) die('--event is required')

try {
  const result = await post('/_storyboard/canvas/undo', { name: canvas, eventId })
  if (flags.json) { jsonOut(result) } else {
    console.log(`Undid event ${eventId} → appended ${result.eventId} (${result.inverseEvent?.event})`)
  }
} catch (err) { die(err.message) }
