/** storyboard inbox — read or consume durable Hub inbox items. */

import { formatInboxBatch } from '../messaging/coordination-service.js'
import { parseSimpleArgs, jsonOut, die, post, get } from './cliHelpers.js'

const sub = process.argv[3]
const { flags } = parseSimpleArgs(process.argv.slice(4))
const widgetId = process.env.STORYBOARD_WIDGET_ID
const canvasId = process.env.STORYBOARD_CANVAS_ID
if (!widgetId || !canvasId) die('STORYBOARD_WIDGET_ID and STORYBOARD_CANVAS_ID are required')

async function writeOutput(value) {
  await new Promise((resolve, reject) => process.stdout.write(value, (error) => error ? reject(error) : resolve()))
}

async function run() {
  if (sub === 'consume') {
    const itemIds = String(flags.items || '').split(',').map((item) => item.trim()).filter(Boolean)
    if (itemIds.length === 0) die('Usage: storyboard inbox consume --items <id[,id]>')
    return jsonOut(await post('/_storyboard/messages/inbox/consume', {
      widgetId, canvasId, itemIds, consumer: flags.consumer || 'manual',
    }))
  }
  if (sub !== 'poll' && sub !== 'read') die('Usage: storyboard inbox <poll|read|consume>')
  const params = new URLSearchParams({ widgetId, canvasId, limit: flags.limit || '50' })
  const inbox = await get(`/_storyboard/messages/inbox/read?${params}`)
  if (sub === 'read') return jsonOut(inbox)
  if (!inbox.items?.length) {
    if (flags.json) jsonOut({ ok: true, items: [], consumed: [] })
    return
  }
  if (!flags.json) await writeOutput(formatInboxBatch(inbox.items))
  const consumed = await post('/_storyboard/messages/inbox/consume', {
    widgetId, canvasId, itemIds: inbox.items.map((item) => item.id), consumer: 'poll',
  })
  if (flags.json) jsonOut({ ok: true, items: inbox.items, consumed: consumed.consumed || [] })
}

run().catch((error) => die(error.message))
