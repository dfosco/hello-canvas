/**
 * storyboard canvas redo — re-apply a previously-undone event.
 *
 * Usage:
 *   storyboard canvas redo --canvas my-canvas --event evt_xxx
 *
 * The --event is the id of the *undo event* (the one with meta.kind = 'undo')
 * that you want to cancel — the server emits the inverse of that, restoring
 * the original change.
 *
 * Flags:
 *   -c, --canvas             Canvas name (required)
 *   -e, --event              Event ID (the undo event) to redo (required)
 *   --json                   Output as JSON
 */

import { post, parseSimpleArgs, jsonOut, die } from './cliHelpers.js'

const args = process.argv.slice(4) // skip: node, sb, canvas, redo

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
  canvas redo flags:

    -c, --canvas             Canvas name (required)
    -e, --event              Event ID (the undo event) to redo (required)
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
  const result = await post('/_storyboard/canvas/redo', { name: canvas, eventId })
  if (flags.json) { jsonOut(result) } else {
    console.log(`Redid event ${eventId} → appended ${result.eventId} (${result.inverseEvent?.event})`)
  }
} catch (err) { die(err.message) }
