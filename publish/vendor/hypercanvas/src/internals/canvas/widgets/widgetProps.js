/**
 * Canvas Widget Props API
 *
 * Every canvas widget receives its data through a structured `props` object
 * stored in .canvas.json. This module defines the prop schema system that
 * widgets use to declare, read, and update their editable properties.
 *
 * ## Prop Categories
 *
 * Widget props are grouped into three categories:
 *
 * ### `content` — User-editable content
 * Text, markdown, URLs — the stuff users type or paste.
 * Updated frequently (every keystroke when editing).
 * Examples: sticky note text, markdown content, embed URL.
 *
 * ### `settings` — Widget configuration
 * One-off choices that affect appearance or behavior.
 * Updated infrequently (user picks from a menu).
 * Examples: sticky note color, markdown width, embed layout.
 *
 * ### `size` — Dimensions
 * Width and height of the widget.
 * Updated via resize handles or explicit input.
 * Examples: markdown block width, prototype embed width/height.
 *
 * ## Storage Format (.canvas.json)
 *
 * Props are stored flat in the widget's `props` object:
 *
 * ```json
 * {
 *   "id": "sticky-1",
 *   "type": "sticky-note",
 *   "position": { "x": 100, "y": 200 },
 *   "props": {
 *     "text": "Hello world",
 *     "color": "yellow"
 *   }
 * }
 * ```
 *
 * ## Widget Contract
 *
 * Every widget component receives:
 *   - `id`       — stable widget identifier
 *   - `props`    — the flat props object (may be null/undefined)
 *   - `onUpdate` — callback to persist prop changes: onUpdate({ key: value })
 *   - `onRemove` — callback to delete the widget
 *
 * `onUpdate` accepts a partial object that is shallow-merged into `props`.
 * Multiple keys can be updated in one call:
 *   onUpdate({ text: 'new text', color: 'blue' })
 *
 * ## Declaring Widget Props (Schema)
 *
 * Widget prop schemas are defined in widgets.config.json (packages/core)
 * and loaded via widgetConfig.js. This module re-exports the generated
 * schemas and provides utility functions for reading props with defaults.
 */

/**
 * @typedef {'text' | 'select' | 'number' | 'url' | 'boolean'} PropType
 *
 * @typedef {Object} PropDef
 * @property {PropType} type        — input type for editing
 * @property {string}   label       — human-readable label
 * @property {string}   category    — 'content' | 'settings' | 'size'
 * @property {*}        defaultValue — fallback when prop is missing
 * @property {Array}    [options]   — choices for 'select' type
 * @property {number}   [min]       — minimum for 'number' type
 * @property {number}   [max]       — maximum for 'number' type
 */

import { schemas as configSchemas } from './widgetConfig.js'

/**
 * Read a prop value with fallback to schema default.
 * @param {object} props    — widget props object (may be null)
 * @param {string} key      — prop name
 * @param {object} schema   — widget schema
 * @returns {*}
 */
export function readProp(props, key, schema) {
  const value = props?.[key]
  if (value !== undefined && value !== null) {
    // Reject NaN for number props — fall through to default
    if (typeof value === 'number' && Number.isNaN(value)) {
      // fall through to default
    } else {
      return value
    }
  }
  return schema[key]?.defaultValue ?? null
}

/**
 * Read all props with defaults applied from schema.
 * @param {object} props  — widget props object (may be null)
 * @param {object} schema — widget schema
 * @returns {object}
 */
export function readAllProps(props, schema) {
  const result = {}
  for (const key of Object.keys(schema)) {
    result[key] = readProp(props, key, schema)
  }
  return result
}

/**
 * Get default props for a widget type from its schema.
 * Used when creating new widgets.
 * @param {object} schema — widget schema
 * @returns {object}
 */
export function getDefaults(schema) {
  const result = {}
  for (const [key, def] of Object.entries(schema)) {
    if (def.defaultValue !== undefined) {
      result[key] = def.defaultValue
    }
  }
  return result
}

// ── Config-driven schemas ───────────────────────────────────────────

/** Schema registry — maps widget type strings to their schemas. */
export const schemas = configSchemas

// Named exports for backward compatibility with widget imports
export const stickyNoteSchema = schemas['sticky-note']
export const markdownSchema = schemas['markdown']
export const prototypeEmbedSchema = schemas['prototype']
export const linkPreviewSchema = schemas['link-preview']
export const imageSchema = schemas['image']
export const figmaEmbedSchema = schemas['figma-embed']
export const terminalSchema = schemas['terminal']
export const promptSchema = schemas['prompt']
