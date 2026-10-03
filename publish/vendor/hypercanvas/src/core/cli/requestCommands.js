/** storyboard request — expected-work messages and attached results. */

import { parseSimpleArgs, jsonOut, die, post } from './cliHelpers.js'

const sub = process.argv[3]
const { positional, flags } = parseSimpleArgs(process.argv.slice(4))
const senderId = process.env.STORYBOARD_WIDGET_ID
const canvasId = process.env.STORYBOARD_CANVAS_ID
if (!senderId || !canvasId) die('STORYBOARD_WIDGET_ID and STORYBOARD_CANVAS_ID are required')

function dependencies(value) {
  if (!value) return []
  if (value.trim().startsWith('[')) {
    try { return JSON.parse(value) } catch { die('--depends-on must be a comma list or JSON array') }
  }
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

async function run() {
  if (sub === 'send') {
    const recipient = flags.to || positional[0]
    const body = flags.body || positional.slice(flags.to ? 0 : 1).join(' ')
    if (!recipient || !body) die('Usage: storyboard request send <collaborator> "request"')
    return jsonOut(await post('/_storyboard/messages/request/send', {
      senderId, canvasId, hubId: flags.hub || null, recipient, body, dependsOn: dependencies(flags['depends-on']),
    }))
  }
  if (sub === 'complete') {
    const requestId = flags.request || positional[0]
    const body = flags.body || positional.slice(flags.request ? 0 : 1).join(' ')
    if (!requestId || !body) die('Usage: storyboard request complete <request-id> "result"')
    return jsonOut(await post('/_storyboard/messages/request/complete', {
      senderId, canvasId, hubId: flags.hub || null, requestId, body,
    }))
  }
  die('Usage: storyboard request <send|complete> ...')
}

run().catch((error) => die(error.message))
