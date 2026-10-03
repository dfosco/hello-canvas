/**
 * storyboard canvas delete-canvas — Delete a canvas and its directory.
 *
 * Usage:
 *   storyboard canvas delete-canvas --canvas my-canvas
 *
 * Flags:
 *   -c, --canvas     Canvas name to delete (required)
 *   --json           Output as JSON
 */

import { del, parseSimpleArgs, jsonOut, die } from './cliHelpers.js'

const args = process.argv.slice(4) // skip: node, sb, canvas, delete-canvas

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
  canvas delete-canvas flags:

    -c, --canvas     Canvas name to delete (required)
    --json           Output as JSON
`)
  process.exit(0)
}

const { flags } = parseSimpleArgs(args)
const canvas = flags.canvas || flags.c

if (!canvas) die('--canvas is required')

try {
  const result = await del('/_storyboard/canvas/delete-canvas', { name: canvas })
  if (flags.json) { jsonOut(result) } else { console.log(`Canvas "${canvas}" deleted`) }
} catch (err) { die(err.message) }
