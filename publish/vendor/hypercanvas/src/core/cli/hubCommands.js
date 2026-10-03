/** storyboard hub — query and establish broadcast-defined Hub context. */

import { parseSimpleArgs, jsonOut, die, post, get } from './cliHelpers.js'

const sub = process.argv[3]
const sub2 = process.argv[4]
const args = process.argv.slice(sub === 'context' && sub2 === 'set' ? 5 : 4)
const { positional, flags } = parseSimpleArgs(args)
const base = '/_storyboard/messages'

function identity() {
  const widgetId = flags.widget || process.env.STORYBOARD_WIDGET_ID
  const canvasId = flags.canvas || flags.c || process.env.STORYBOARD_CANVAS_ID
  if (!widgetId) die('STORYBOARD_WIDGET_ID is required')
  if (!canvasId) die('STORYBOARD_CANVAS_ID is required')
  return { widgetId, canvasId }
}

function hubQuery(path) {
  const { widgetId, canvasId } = identity()
  const params = new URLSearchParams({ widgetId, canvasId })
  if (flags.hub) params.set('hubId', flags.hub)
  return `${base}/${path}?${params}`
}

if (!sub || sub === '--help' || sub === '-h') {
  console.log(`
  hub subcommands:

    context              Show authoritative context for the current Hub
    context set <prompt> Establish or replace the current Hub prompt
    agents               List current collaborators
    state                Inspect all Hubs on a canvas
    presence             List live agent presence
    bindings             List optional runtime adapter bindings
    dissolve             Dissolve all Hubs on a canvas
`)
  process.exit(0)
}

async function run() {
  if (sub === 'context' && sub2 === 'set') {
    const { widgetId, canvasId } = identity()
    const prompt = flags.prompt || positional.join(' ')
    if (!prompt) die('Usage: storyboard hub context set "prompt"')
    return jsonOut(await post(`${base}/hub/context`, {
      senderId: widgetId, canvasId, hubId: flags.hub || null, prompt, promptSummary: flags.summary || null,
    }))
  }
  if (sub === 'context') return jsonOut(await get(hubQuery('hub/context')))
  if (sub === 'agents') return jsonOut(await get(hubQuery('hub/agents')))
  if (sub === 'state') {
    const { canvasId } = identity()
    const params = new URLSearchParams()
    if (flags.hub) params.set('hubId', flags.hub)
    return jsonOut(await get(`${base}/hub/${encodeURIComponent(canvasId)}?${params}`))
  }
  if (sub === 'presence') {
    const { canvasId } = identity()
    const branch = flags.branch || process.env.STORYBOARD_BRANCH || 'unknown'
    const suffix = flags.widget ? `/${encodeURIComponent(flags.widget)}` : ''
    return jsonOut(await get(`${base}/presence/${encodeURIComponent(branch)}/${encodeURIComponent(canvasId)}${suffix}`))
  }
  if (sub === 'bindings') return jsonOut(await get(`${base}/bindings`))
  if (sub === 'dissolve') {
    const { canvasId } = identity()
    return jsonOut(await post(`${base}/hub/dissolve`, { canvasId }))
  }
  die(`Unknown hub subcommand: ${sub}`)
}

run().catch((error) => die(error.message))
