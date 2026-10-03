import StickyNote from './StickyNote.jsx'
import MarkdownBlock from './MarkdownBlock.jsx'
import PrototypeEmbed from './PrototypeEmbed.jsx'
import LinkPreview from './LinkPreview.jsx'
import ImageWidget from './ImageWidget.jsx'
import KnobsWidget from './KnobsWidget.jsx'
import FigmaEmbed from './FigmaEmbed.jsx'
import CodePenEmbed from './CodePenEmbed.jsx'
import StoryWidget from './StoryWidget.jsx'
import StorySetWidget from './StorySetWidget.jsx'
import TerminalWidget from './TerminalWidget.jsx'
import TerminalReadWidget from './TerminalReadWidget.jsx'
import PromptWidget from './PromptWidget.jsx'
import FileWidget from './FileWidget/FileWidget.jsx'
import AgentChatWidget from './AgentChatWidget.jsx'
import SiteFrame from './SiteFrame/SiteFrame.jsx'
import { getWidgetDefinition } from '../../../core/stores/widgetRegistry.js'

/**
 * Built-in widget components, keyed by type string.
 * These are the fallback components when no consumer registration overrides
 * a given type. Consumers can override any of these by registering a widget
 * with the same `type` key via `mountStoryboardCore({ widgets })` or
 * `registerWidget()`.
 */
export const widgetRegistry = {
  'sticky-note': StickyNote,
  'markdown': MarkdownBlock,
  'prototype': PrototypeEmbed,
  'link-preview': LinkPreview,
  'image': ImageWidget,
  'knobs': KnobsWidget,
  'figma-embed': FigmaEmbed,
  'codepen-embed': CodePenEmbed,
  'story': StoryWidget,
  'component-set': StorySetWidget,
  'terminal': TerminalWidget,
  'terminal-read': TerminalReadWidget,
  'agent': TerminalWidget,
  'prompt': PromptWidget,
  'file': FileWidget,
  'agent-chat': AgentChatWidget,
  'site-frame': SiteFrame,
}

/**
 * Resolve a widget type string to its React component.
 *
 * Lookup order:
 *   1. Consumer registry (`registerWidget`/`mountStoryboardCore({ widgets })`)
 *      — `def.component` wins if present
 *   2. Built-in `widgetRegistry` above
 *   3. null (unknown type)
 *
 * @param {string} type
 * @returns {React.ComponentType | null}
 */
export function getWidgetComponent(type) {
  const def = getWidgetDefinition(type)
  if (def?.component) return def.component
  return widgetRegistry[type] ?? null
}
