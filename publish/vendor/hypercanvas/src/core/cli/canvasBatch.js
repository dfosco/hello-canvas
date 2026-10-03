/**
 * storyboard canvas batch — Execute multiple canvas operations in one call.
 *
 * Usage:
 *   storyboard canvas batch --canvas my-canvas --ops '[{"op":"create-widget","type":"sticky-note","props":{"text":"Hi"}}]'
 *   storyboard canvas batch --canvas my-canvas --ops-file ops.json
 *   cat ops.json | storyboard canvas batch --canvas my-canvas --ops-file -
 *
 * Always outputs JSON. Designed for scripting and agent use.
 */

import fs from 'node:fs'
import { parseFlags, formatFlagHelp } from './flags.js'
import { ensureDevServer, serverPost } from './create.js'

const batchSchema = {
  canvas: {
    type: 'string',
    required: true,
    description: 'Target canvas name',
    aliases: ['c'],
  },
  ops: {
    type: 'string',
    description: 'Operations as a JSON string (array)',
  },
  'ops-file': {
    type: 'string',
    description: 'Path to JSON file with operations (use - for stdin)',
    aliases: ['f'],
  },
}

async function canvasBatch() {
  const rest = process.argv.slice(4)

  if (rest.includes('--help') || rest.includes('-h')) {
    console.log(`\n  canvas batch flags:\n`)
    console.log(formatFlagHelp(batchSchema))
    console.log(`\n  Operations: create-widget, update-widget, move-widget, delete-widget, create-connector, delete-connector`)
    console.log(`  Refs: use $0, $1 etc. to reference IDs from earlier create ops. Named refs via "ref" field.\n`)
    process.exit(0)
  }

  const { flags, errors } = parseFlags(rest, batchSchema)

  if (errors.length) {
    for (const e of errors) console.error(e)
    process.exit(1)
  }

  if (!flags.ops && !flags['ops-file']) {
    console.error(JSON.stringify({ error: 'Provide --ops (JSON string) or --ops-file (path or - for stdin)' }))
    process.exit(1)
  }

  await ensureDevServer({ quiet: true })

  let operations
  try {
    if (flags['ops-file']) {
      let raw
      if (flags['ops-file'] === '-') {
        // Read from stdin
        const chunks = []
        for await (const chunk of process.stdin) chunks.push(chunk)
        raw = Buffer.concat(chunks).toString('utf8')
      } else {
        raw = fs.readFileSync(flags['ops-file'], 'utf8')
      }
      operations = JSON.parse(raw)
    } else {
      operations = JSON.parse(flags.ops)
    }
  } catch (err) {
    console.error(JSON.stringify({ error: `Failed to parse operations: ${err.message}` }))
    process.exit(1)
  }

  if (!Array.isArray(operations)) {
    console.error(JSON.stringify({ error: 'Operations must be a JSON array' }))
    process.exit(1)
  }

  try {
    const result = await serverPost('/_storyboard/canvas/batch', {
      name: flags.canvas,
      operations,
    })
    console.log(JSON.stringify(result))
    if (!result.success) process.exit(1)
  } catch (err) {
    console.error(JSON.stringify({ error: err.message }))
    process.exit(1)
  }
}

canvasBatch()
