/**
 * storyboard canvas read — Read canvas state and list widgets with their IDs, URLs, and content.
 *
 * Usage:
 *   storyboard canvas read my-canvas             List all widgets
 *   storyboard canvas read my-canvas --json      Output as JSON
 *   storyboard canvas read my-canvas --id abc    Get a specific widget by ID
 *
 * Output includes:
 *   - Widget ID
 *   - Widget type
 *   - Position (x, y)
 *   - Content (text, url, src depending on type)
 *   - File path (for images)
 */

import * as p from '@clack/prompts'
import { getServerUrl } from './serverUrl.js'
import { getWidgetBounds } from '../canvas/collision.js'

const dim = (s) => `\x1b[2m${s}\x1b[0m`
const bold = (s) => `\x1b[1m${s}\x1b[0m`
const cyan = (s) => `\x1b[36m${s}\x1b[0m`

async function checkServer() {
  try {
    await fetch(`${getServerUrl()}/_storyboard/canvas/list`, { signal: AbortSignal.timeout(2000) })
    return true
  } catch {
    return false
  }
}

/**
 * Compute positional bounds for a widget.
 */
function computeBounds(widget) {
  const { x, y, width, height } = getWidgetBounds(widget)
  return {
    width,
    height,
    startX: x,
    startY: y,
    endX: x + width,
    endY: y + height,
  }
}

/**
 * Get bounds for a widget — uses persisted bounds if available, computes otherwise.
 */
function getBounds(widget) {
  if (widget.bounds && typeof widget.bounds.startX === 'number') {
    return widget.bounds
  }
  return computeBounds(widget)
}

/**
 * Extract the primary content from a widget based on its type.
 */
function getWidgetContent(widget) {
  const { type, props = {} } = widget
  switch (type) {
    case 'sticky-note':
      return { content: props.text || '', contentType: 'text' }
    case 'markdown':
      return { content: props.content || '', contentType: 'markdown' }
    case 'prototype':
      return { content: props.src || '', contentType: 'url', url: props.src }
    case 'figma-embed':
      return { content: props.url || '', contentType: 'url', url: props.url }
    case 'link-preview':
      return { content: props.url || '', contentType: 'url', url: props.url }
    case 'image':
      return {
        content: props.src || '',
        contentType: 'image',
        url: props.src ? `/_storyboard/canvas/images/${props.src}` : '',
        filePath: props.src ? `assets/canvas/images/${props.src}` : '',
      }
    default:
      return { content: JSON.stringify(props), contentType: 'props' }
  }
}

/**
 * Format a widget for human-readable output.
 */
function formatWidget(widget) {
  const { id, type, position = {} } = widget
  const { content, contentType, url, filePath } = getWidgetContent(widget)
  const bounds = getBounds(widget)

  const lines = []
  lines.push(`${bold(id)} ${dim(`(${type})`)}`)
  lines.push(`  Position: ${position.x ?? 0}, ${position.y ?? 0}`)
  lines.push(`  Bounds: ${bounds.startX},${bounds.startY} → ${bounds.endX},${bounds.endY} ${dim(`(${bounds.width}×${bounds.height})`)}`)

  if (contentType === 'image') {
    lines.push(`  File: ${cyan(filePath)}`)
    if (content) lines.push(`  Filename: ${content}`)
  } else if (contentType === 'url') {
    lines.push(`  URL: ${cyan(url || content)}`)
  } else if (content) {
    const preview = content.length > 80 ? content.slice(0, 77) + '...' : content
    lines.push(`  Content: ${preview}`)
  }

  return lines.join('\n')
}

async function canvasRead() {
  const args = process.argv.slice(4)

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
  canvas read — Read canvas state and list widgets

  Usage:
    storyboard canvas read <canvas-name>          List all widgets
    storyboard canvas read <canvas-name> --json   Output as JSON
    storyboard canvas read <canvas-name> --id <widget-id>  Get specific widget

  Output includes widget ID, type, position, content, URLs, and file paths.
`)
    process.exit(0)
  }

  // Parse args
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

  // Check server
  const serverUp = await checkServer()
  if (!serverUp) {
    p.log.error('Dev server is not running. Start it with: storyboard dev')
    process.exit(1)
  }

  const base = getServerUrl()

  // If no canvas name, list available canvases
  if (!canvasName) {
    try {
      const res = await fetch(`${base}/_storyboard/canvas/list`)
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const data = await res.json()
      const canvases = data.canvases || []

      if (outputJson) {
        console.log(JSON.stringify(canvases, null, 2))
      } else {
        if (canvases.length === 0) {
          p.log.info('No canvases found')
        } else {
          console.log('\nAvailable canvases:\n')
          for (const c of canvases) {
            console.log(`  ${bold(c.name)} ${dim(`(${c.widgetCount} widgets)`)}`)
          }
          console.log('')
        }
      }
    } catch (err) {
      p.log.error(`Failed to list canvases: ${err.message}`)
      process.exit(1)
    }
    return
  }

  // Read canvas state
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

    // If filtering by widget ID
    if (widgetId) {
      const widget = widgets[0]
      if (!widget) {
        p.log.error(`Widget "${widgetId}" not found in canvas "${canvasName}"`)
        process.exit(1)
      }

      if (outputJson) {
        const enriched = { ...widget, ...getWidgetContent(widget), bounds: getBounds(widget) }
        console.log(JSON.stringify(enriched, null, 2))
      } else {
        console.log('')
        console.log(formatWidget(widget))
        console.log('')
      }
      return
    }

    // List all widgets
    if (outputJson) {
      const enriched = widgets.map((w) => ({ ...w, ...getWidgetContent(w), bounds: getBounds(w) }))
      console.log(JSON.stringify({ ...data, widgets: enriched }, null, 2))
    } else {
      console.log(`\n${bold(data.title || canvasName)} ${dim(`(${widgets.length} widgets)`)}\n`)

      if (widgets.length === 0) {
        console.log('  No widgets on this canvas.\n')
      } else {
        for (const widget of widgets) {
          console.log(formatWidget(widget))
          console.log('')
        }
      }
    }
  } catch (err) {
    p.log.error(`Failed to read canvas: ${err.message}`)
    process.exit(1)
  }
}

canvasRead()
