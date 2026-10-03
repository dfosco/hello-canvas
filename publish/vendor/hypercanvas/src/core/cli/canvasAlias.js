import { get, put, del, parseSimpleArgs, jsonOut, die } from './cliHelpers.js'

/**
 * storyboard canvas alias <get|set|clear>
 */
export async function handleAlias(args) {
  const sub = args[0]
  const rest = args.slice(1)

  if (!sub || sub === '--help') {
    console.log(`
  canvas alias subcommands:

    get      Read alias for a widget
    set      Set alias for a widget
    clear    Clear alias for a widget

  get flags:
    -w, --widget         Widget ID (required)
    -c, --canvas         Canvas name (required)
    --json               Output as JSON

  set flags:
    -w, --widget         Widget ID (required)
    -c, --canvas         Canvas name (required)
    -a, --alias          Alias value (required)

  clear flags:
    -w, --widget         Widget ID (required)
    -c, --canvas         Canvas name (required)
`)
    return
  }

  const opts = parseSimpleArgs(rest, {
    '-w': 'widget', '--widget': 'widget',
    '-c': 'canvas', '--canvas': 'canvas',
    '-a': 'alias', '--alias': 'alias',
    '--json': { flag: true, key: 'json' },
  })

  const { widget, canvas, alias, json } = opts
  if (!widget) die('--widget is required')
  if (!canvas) die('--canvas is required')

  if (sub === 'get') {
    const data = await get(`/_storyboard/canvas/alias?widgetId=${encodeURIComponent(widget)}&canvas=${encodeURIComponent(canvas)}`)
    if (json) { jsonOut(data); return }
    if (data.alias) {
      console.log(`${data.alias} (prettyName: ${data.prettyName || 'none'})`)
    } else {
      console.log(`No alias set (prettyName: ${data.prettyName || 'none'})`)
    }
    return
  }

  if (sub === 'set') {
    if (!alias) die('--alias is required')
    const data = await put('/_storyboard/canvas/alias', { canvas, widgetId: widget, alias })
    if (json) { jsonOut(data); return }
    console.log(`Alias set to "${alias}"`)
    return
  }

  if (sub === 'clear') {
    const data = await del(`/_storyboard/canvas/alias`, { canvas, widgetId: widget })
    if (json) { jsonOut(data); return }
    console.log('Alias cleared')
    return
  }

  die(`Unknown alias subcommand: ${sub}`)
}
