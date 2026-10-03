/**
 * storyboard canvas duplicate — Duplicate a canvas.
 *
 * Usage:
 *   storyboard canvas duplicate --canvas my-canvas --title "My Copy"
 *
 * Flags:
 *   -c, --canvas     Source canvas name (required)
 *   -t, --title      Title for the new canvas (required)
 *   --json           Output as JSON
 */

import { post, parseSimpleArgs, jsonOut, die } from './cliHelpers.js'

const args = process.argv.slice(4) // skip: node, sb, canvas, duplicate

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
  canvas duplicate flags:

    -c, --canvas     Source canvas name (required)
    -t, --title      Title for the new canvas (required)
    --json           Output as JSON
`)
  process.exit(0)
}

const { flags } = parseSimpleArgs(args)
const canvas = flags.canvas || flags.c
const title = flags.title || flags.t

if (!canvas) die('--canvas is required')
if (!title) die('--title is required')

try {
  const result = await post('/_storyboard/canvas/duplicate', { name: canvas, newTitle: title })
  if (flags.json) {
    jsonOut(result)
  } else {
    console.log(`Canvas duplicated: ${result.name} (${result.path})`)
  }
} catch (err) { die(err.message) }
