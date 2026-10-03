/**
 * storyboard messages — Low-level messaging bus CLI.
 *
 * Subcommands:
 *   storyboard messages publish --channel <ch> --type <type> --sender <id> [--body "text"] [--payload '{}']
 *   storyboard messages send --channel <ch> --type <type> --sender <id> [--body "text"] [--timeout 30000]
 *   storyboard messages read --channel <ch> [--since <ulid>] [--limit N] [--type <prefix>]
 *   storyboard messages batch --ops '{ "publish": [...], "read": [...] }'
 */

import { parseSimpleArgs, jsonOut, die, post, get } from './cliHelpers.js'

const sub = process.argv[3]
const MESSAGING_BASE = '/_storyboard/messages'

if (!sub || sub === '--help' || sub === '-h') {
  console.log(`
  messages subcommands:

    publish    Publish a single event to a channel
    send       Publish and wait for a correlated response
    read       Read events from a channel
    batch      Batch publish + read in one call

  Use --help on any subcommand for flags.
`)
  process.exit(0)
}

const args = process.argv.slice(4)

if (args.includes('--help') || args.includes('-h')) {
  const helpMap = {
    publish: `    --channel       Channel name (required)\n    --type          Event type (required)\n    --sender        Sender ID (required)\n    --body          Event body text\n    --payload       JSON payload\n    --status        Event status\n    --correlation   Correlation ID`,
    send: `    --channel       Channel name (required)\n    --type          Event type (required)\n    --sender        Sender ID (required)\n    --body          Event body text\n    --timeout       Timeout in ms [default: 30000]`,
    read: `    --channel       Channel name (required)\n    --since         ULID to read after\n    --limit         Max events to return\n    --type          Filter by type prefix`,
    batch: `    --ops           JSON with publish and/or read arrays (required)\n    --ops-file      Path to JSON file with operations`,
  }
  console.log(`\n  messages ${sub} flags:\n\n${helpMap[sub] || '    (see source)'}`)
  process.exit(0)
}

const { positional, flags } = parseSimpleArgs(args)

async function run() {
  switch (sub) {
    case 'publish': {
      const channel = flags.channel
      const type = flags.type
      const senderId = flags.sender || process.env.STORYBOARD_WIDGET_ID
      if (!channel) die('--channel is required')

      const payload = { channel, senderId }
      if (type) payload.type = type
      if (flags.body) payload.body = flags.body
      if (flags.status) payload.status = flags.status
      if (flags.correlation) payload.correlationId = flags.correlation
      if (flags.payload) {
        try { Object.assign(payload, JSON.parse(flags.payload)) } catch { die('--payload must be valid JSON') }
      }

      const data = await post(`${MESSAGING_BASE}/publish`, payload)
      jsonOut(data)
      break
    }

    case 'send': {
      const channel = flags.channel
      const type = flags.type
      const senderId = flags.sender || process.env.STORYBOARD_WIDGET_ID
      if (!channel) die('--channel is required')

      const payload = { channel, senderId }
      if (type) payload.type = type
      if (flags.body) payload.body = flags.body
      if (flags.timeout) payload.timeout = parseInt(flags.timeout, 10)

      const data = await post(`${MESSAGING_BASE}/send`, payload)
      jsonOut(data)
      break
    }

    case 'read': {
      const channel = flags.channel || positional[0]
      const channels = flags.channels
      if (!channel && !channels) die('--channel or --channels is required')

      const params = []
      if (channel) params.push(`channel=${encodeURIComponent(channel)}`)
      if (channels) params.push(`channels=${encodeURIComponent(channels)}`)
      if (flags.since) params.push(`since=${encodeURIComponent(flags.since)}`)
      if (flags.limit) params.push(`limit=${encodeURIComponent(flags.limit)}`)
      if (flags.type) params.push(`type=${encodeURIComponent(flags.type)}`)

      const data = await get(`${MESSAGING_BASE}/read?${params.join('&')}`)
      jsonOut(data)
      break
    }

    case 'batch': {
      let ops
      if (flags['ops-file']) {
        const { readFileSync } = await import('node:fs')
        try { ops = JSON.parse(readFileSync(flags['ops-file'], 'utf8')) } catch (err) { die(`Failed to read ops file: ${err.message}`) }
      } else if (flags.ops) {
        try { ops = JSON.parse(flags.ops) } catch { die('--ops must be valid JSON') }
      } else {
        die('--ops or --ops-file is required')
      }
      const data = await post(`${MESSAGING_BASE}/batch`, ops)
      jsonOut(data)
      break
    }

    default:
      die(`Unknown messages subcommand: ${sub}. Use --help for a list.`)
  }
}

run().catch((err) => die(err.message))
