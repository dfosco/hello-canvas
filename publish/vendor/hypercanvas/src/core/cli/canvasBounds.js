/**
 * storyboard canvas bounds — Get size and positional bounds for a widget.
 *
 * Usage:
 *   storyboard canvas bounds <canvas-name> --id <widget-id>   Get bounds for a specific widget
 *   storyboard canvas bounds <canvas-name>                    Get bounds for all widgets
 *   storyboard canvas bounds <canvas-name> --json             Output as JSON
 *
 * Output includes:
 *   - Widget ID and type
 *   - width, height
 *   - startX, startY (top-left)
 *   - endX, endY (bottom-right)
 */

import * as p from '@clack/prompts'
import { getServerUrl } from './serverUrl.js'
import { getWidgetBounds, getDefaultSize } from '../canvas/collision.js'

const dim = (s) => `\x1b[2m${s}\x1b[0m`
const bold = (s) => `\x1b[1m${s}\x1b[0m`

async function checkServer() {
  try {
    await fetch(`${getServerUrl()}/_storyboard/canvas/list`, { signal: AbortSignal.timeout(2000) })
    return true
  } catch {
    return false
  }
}

/**
 * Compute bounds for a widget — uses persisted bounds if available, computes otherwise.
 */
function getBounds(widget) {
  if (widget.bounds && typeof widget.bounds.startX === 'number') {
    return widget.bounds
  }
  const { x, y, width, height } = getWidgetBounds(widget)
  return { width, height, startX: x, startY: y, endX: x + width, endY: y + height }
}

function formatBounds(widget) {
  const { id, type } = widget
  const b = getBounds(widget)
  const lines = []
  lines.push(`${bold(id)} ${dim(`(${type})`)}`)
  lines.push(`  Size: ${b.width} × ${b.height}`)
  lines.push(`  Start: ${b.startX}, ${b.startY}`)
  lines.push(`  End:   ${b.endX}, ${b.endY}`)
  return lines.join('\n')
}

async function canvasBounds() {
  const args = process.argv.slice(4)

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
  canvas bounds — Get size and positional bounds for canvas widgets

  Usage:
    storyboard canvas bounds <canvas-name>                    All widgets
    storyboard canvas bounds <canvas-name> --id <widget-id>   Specific widget
    storyboard canvas bounds <canvas-name> --json             JSON output
    storyboard canvas bounds --type <widget-type>             Show default size for a type
`)
    process.exit(0)
  }

  // --type mode: just show default size, no server needed
  const typeIdx = args.indexOf('--type')
  if (typeIdx !== -1 && args[typeIdx + 1]) {
    const type = args[typeIdx + 1]
    const size = getDefaultSize(type)
    const outputJson = args.includes('--json')
    if (outputJson) {
      console.log(JSON.stringify({ type, ...size }))
    } else {
      console.log(`\n${bold(type)} default size: ${size.width} × ${size.height}\n`)
    }
    return
  }

  let canvasName = ''
  let outputJson = false
  let widgetId = ''

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--json') {
      outputJson = true
    } else if (arg === '--id' && args[i + 1]) {
      widgetId = args[++i]
    } else if (!arg.startsWith('-') && !canvasName) {
      canvasName = arg
    }
  }

  if (!canvasName) {
    p.log.error('Canvas name is required. Usage: storyboard canvas bounds <canvas-name> [--id <widget-id>]')
    process.exit(1)
  }

  const serverUp = await checkServer()
  if (!serverUp) {
    p.log.error('Dev server is not running. Start it with: storyboard dev')
    process.exit(1)
  }

  const base = getServerUrl()

  try {
    let url = `${base}/_storyboard/canvas/read?name=${encodeURIComponent(canvasName)}`
    if (widgetId) url += `&widget=${encodeURIComponent(widgetId)}`
    const res = await fetch(url)
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`${res.status} ${res.statusText}${text ? ': ' + text : ''}`)
    }
    const data = await res.json()
    const widgets = data.widgets || []

    if (widgetId) {
      const widget = widgets[0]
      if (!widget) {
        p.log.error(`Widget "${widgetId}" not found in canvas "${canvasName}"`)
        process.exit(1)
      }
      if (outputJson) {
        console.log(JSON.stringify({ id: widget.id, type: widget.type, ...getBounds(widget) }))
      } else {
        console.log('')
        console.log(formatBounds(widget))
        console.log('')
      }
      return
    }

    // All widgets
    if (outputJson) {
      const result = widgets.map((w) => ({ id: w.id, type: w.type, ...getBounds(w) }))
      console.log(JSON.stringify(result, null, 2))
    } else {
      console.log(`\n${bold(data.title || canvasName)} ${dim(`(${widgets.length} widgets)`)}\n`)
      if (widgets.length === 0) {
        console.log('  No widgets on this canvas.\n')
      } else {
        for (const widget of widgets) {
          console.log(formatBounds(widget))
          console.log('')
        }
      }
    }
  } catch (err) {
    p.log.error(`Failed to read canvas bounds: ${err.message}`)
    process.exit(1)
  }
}

canvasBounds()
