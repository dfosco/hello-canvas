/**
 * storyboard canvas connector — Create, update, or delete connectors.
 *
 * Usage:
 *   storyboard canvas connector create --canvas <name> --start <id> --end <id> [--start-anchor right] [--end-anchor left]
 *   storyboard canvas connector update <connectorId> --canvas <name> [--start-anchor top] [--end-anchor bottom] [--meta '{}']
 *   storyboard canvas connector delete <connectorId> --canvas <name>
 */

import { post, patch, del, parseSimpleArgs, jsonOut, die } from './cliHelpers.js'

const args = process.argv.slice(4) // skip: node, sb, canvas, connector
const sub = args[0]

if (!sub || sub === '--help' || sub === '-h') {
  console.log(`
  canvas connector subcommands:

    create     Create a connector between two widgets
    update     Update a connector's anchors, meta, or presentational fields
    delete     Delete a connector
    waypoints  Set or clear manual routing waypoints on a connector

  create flags:
    -c, --canvas         Canvas name (required)
    --start              Start widget ID (required)
    --end                End widget ID (required)
    --start-anchor       Start anchor: top, bottom, left, right (auto-calculated if omitted)
    --end-anchor         End anchor: top, bottom, left, right (auto-calculated if omitted)
    --connector-type     Connector type [default: default]
    --meta               Connector meta as JSON string
    --class-name         Custom class(es) appended to the connector's <g> elements
    --style              Inline style as JSON (e.g. '{"--connector-stroke":"#f0f"}')
    --data               data-* attrs as JSON (e.g. '{"variant":"dashed"}')
    --start-endpoint     Endpoint shape at start: circle, arrow-start, arrow-end, none
    --end-endpoint       Endpoint shape at end:   circle, arrow-start, arrow-end, none
    --json               Output as JSON

  update flags:
    Positional: <connectorId>
    -c, --canvas         Canvas name (required)
    --start-anchor       New start anchor
    --end-anchor         New end anchor
    --meta               Meta as JSON string (merged)
    --class-name         Replace className (pass empty string to clear)
    --style              Inline style JSON, merged into existing (pass 'null' to clear)
    --data               data-* JSON, merged into existing (pass 'null' to clear)
    --start-endpoint     Endpoint shape at start (pass empty or 'null' to clear)
    --end-endpoint       Endpoint shape at end (pass empty or 'null' to clear)

  delete flags:
    Positional: <connectorId>
    -c, --canvas         Canvas name (required)

  waypoints subcommands:
    set <connectorId>    Set manual waypoints — requires --waypoints '[{"dx":0,"dy":0,"tHint":0.5}]'
    clear <connectorId>  Drop manual waypoints (revert to auto-routing)

  waypoints flags:
    -c, --canvas         Canvas name (required)
    --waypoints          JSON array of { dx, dy, tHint? } objects (set only)
    --json               Output as JSON
`)
  process.exit(0)
}

const rest = args.slice(1)
const { positional, flags } = parseSimpleArgs(rest)

const canvas = flags.canvas || flags.c
if (!canvas) die('--canvas is required')

if (sub === 'create') {
  const startWidgetId = flags.start
  const endWidgetId = flags.end
  if (!startWidgetId || !endWidgetId) die('--start and --end widget IDs are required')

  const body = {
    name: canvas,
    startWidgetId,
    endWidgetId,
    connectorType: flags['connector-type'] || 'default',
  }

  // Only include anchors if explicitly provided (server auto-calculates if omitted)
  if (flags['start-anchor']) body.startAnchor = flags['start-anchor']
  if (flags['end-anchor']) body.endAnchor = flags['end-anchor']

  if (flags.meta) {
    try { body.meta = JSON.parse(flags.meta) } catch { die('--meta must be valid JSON') }
  }
  if (typeof flags['class-name'] === 'string' && flags['class-name']) body.className = flags['class-name']
  if (typeof flags.style === 'string') {
    try { body.style = JSON.parse(flags.style) } catch { die('--style must be valid JSON') }
  }
  if (typeof flags.data === 'string') {
    try { body.data = JSON.parse(flags.data) } catch { die('--data must be valid JSON') }
  }
  if (typeof flags['start-endpoint'] === 'string') body.startEndpoint = flags['start-endpoint']
  if (typeof flags['end-endpoint'] === 'string') body.endEndpoint = flags['end-endpoint']

  try {
    const result = await post('/_storyboard/canvas/connector', body)
    if (flags.json) {
      jsonOut(result)
    } else {
      const c = result.connector
      console.log(`Connector created: ${c?.id || 'ok'} (${c?.start?.anchor} → ${c?.end?.anchor})`)
    }
  } catch (err) { die(err.message) }

} else if (sub === 'update') {
  const connectorId = positional[0]
  if (!connectorId) die('Connector ID is required')

  const body = { name: canvas, connectorId }
  if (flags['start-anchor']) body.startAnchor = flags['start-anchor']
  if (flags['end-anchor']) body.endAnchor = flags['end-anchor']
  if (flags.meta) {
    try { body.meta = JSON.parse(flags.meta) } catch { die('--meta must be valid JSON') }
  }
  // Presentational fields: empty string, "null", or a bare flag (--foo with
  // no value, parsed as `true`) clears the field; JSON-valued flags merge
  // into existing state (matches server/materializer semantics).
  const isClear = (v) => v === '' || v === 'null' || v === true
  if (Object.prototype.hasOwnProperty.call(flags, 'class-name')) {
    const v = flags['class-name']
    body.className = isClear(v) ? null : v
  }
  if (Object.prototype.hasOwnProperty.call(flags, 'style')) {
    const v = flags.style
    if (isClear(v)) body.style = null
    else {
      try { body.style = JSON.parse(v) } catch { die('--style must be valid JSON or "null"') }
    }
  }
  if (Object.prototype.hasOwnProperty.call(flags, 'data')) {
    const v = flags.data
    if (isClear(v)) body.data = null
    else {
      try { body.data = JSON.parse(v) } catch { die('--data must be valid JSON or "null"') }
    }
  }
  if (Object.prototype.hasOwnProperty.call(flags, 'start-endpoint')) {
    const v = flags['start-endpoint']
    body.startEndpoint = isClear(v) ? null : v
  }
  if (Object.prototype.hasOwnProperty.call(flags, 'end-endpoint')) {
    const v = flags['end-endpoint']
    body.endEndpoint = isClear(v) ? null : v
  }

  try {
    const result = await patch('/_storyboard/canvas/connector', body)
    if (flags.json) { jsonOut(result) } else { console.log('Connector updated') }
  } catch (err) { die(err.message) }

} else if (sub === 'delete') {
  const connectorId = positional[0]
  if (!connectorId) die('Connector ID is required')

  try {
    const result = await del('/_storyboard/canvas/connector', { name: canvas, connectorId })
    if (flags.json) { jsonOut(result) } else { console.log('Connector deleted') }
  } catch (err) { die(err.message) }

} else if (sub === 'waypoints') {
  const wpSub = positional[0]
  const connectorId = positional[1]
  if (!wpSub || (wpSub !== 'set' && wpSub !== 'clear')) {
    die('waypoints subcommand must be "set" or "clear"')
  }
  if (!connectorId) die('Connector ID is required')

  if (wpSub === 'set') {
    if (!flags.waypoints) die('--waypoints JSON array is required for set')
    let waypoints
    try { waypoints = JSON.parse(flags.waypoints) } catch { die('--waypoints must be valid JSON') }
    if (!Array.isArray(waypoints)) die('--waypoints must be a JSON array')

    try {
      const result = await post('/_storyboard/canvas/connector/waypoints', { name: canvas, connectorId, waypoints })
      if (flags.json) { jsonOut(result) } else { console.log(`Waypoints set: ${waypoints.length} point(s)`) }
    } catch (err) { die(err.message) }
  } else {
    try {
      const result = await del('/_storyboard/canvas/connector/waypoints', { name: canvas, connectorId })
      if (flags.json) { jsonOut(result) } else { console.log('Waypoints cleared (auto-routing restored)') }
    } catch (err) { die(err.message) }
  }

} else {
  die(`Unknown connector subcommand: ${sub}. Use create, update, delete, or waypoints.`)
}
