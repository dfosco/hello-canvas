/** storyboard message — identity-derived direct and broadcast Hub messages. */

import { parseSimpleArgs, jsonOut, die, post } from './cliHelpers.js'

const sub = process.argv[3]
const { positional, flags } = parseSimpleArgs(process.argv.slice(4))
const senderId = process.env.STORYBOARD_WIDGET_ID
const canvasId = process.env.STORYBOARD_CANVAS_ID
if (!senderId || !canvasId) die('STORYBOARD_WIDGET_ID and STORYBOARD_CANVAS_ID are required')

async function run() {
  if (sub === 'send') {
    const recipient = flags.to || positional[0]
    const body = flags.body || positional.slice(flags.to ? 0 : 1).join(' ')
    if (!recipient || !body) die('Usage: storyboard message send <collaborator> "message"')
    return jsonOut(await post('/_storyboard/messages/message/send', {
      senderId, canvasId, hubId: flags.hub || null, recipient, body, intent: flags.intent || 'inform',
    }))
  }
  if (sub === 'broadcast') {
    const body = flags.body || positional.join(' ')
    if (!body) die('Usage: storyboard message broadcast "message"')
    return jsonOut(await post('/_storyboard/messages/message/broadcast', {
      senderId, canvasId, hubId: flags.hub || null, body, intent: flags.intent || 'inform',
    }))
  }
  die('Usage: storyboard message <send|broadcast> ...')
}

run().catch((error) => die(error.message))
