/**
 * Lightweight highlight.js highlighter for the inspector panel.
 *
 * Uses highlight.js/core with only the languages the inspector needs
 * (javascript, typescript, xml for JSX), producing small bundles with
 * no WASM dependencies.
 *
 * Theme is resolved at render time via toolbar.config.json's
 * `highlighting` key and the theme sync settings. Colors are applied
 * as inline styles — no global CSS injection, no theme conflicts.
 */

import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import { getToolbarConfig } from '../stores/toolbarConfigStore.js'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('jsx', javascript)
hljs.registerLanguage('tsx', typescript)

// ---------------------------------------------------------------------------
// Color palettes — inline styles, no external CSS needed
// ---------------------------------------------------------------------------

const THEMES = {
  'github-dark-dimmed': {
    bg: '#22272e',
    fg: '#adbac7',
    headerBg: '#2d333b',
    headerFg: '#768390',
    border: '#373e47',
    lineHighlight: 'rgba(99, 110, 123, 0.15)',
    linkHover: '#adbac7',
    keyword: '#f47067',
    string: '#96d0ff',
    number: '#6cb6ff',
    comment: '#768390',
    function: '#dcbdfb',
    title: '#dcbdfb',
    built_in: '#6cb6ff',
    literal: '#6cb6ff',
    type: '#6cb6ff',
    attr: '#6cb6ff',
    tag: '#8ddb8c',
    name: '#8ddb8c',
    attribute: '#6cb6ff',
    variable: '#f69d50',
    'template-variable': '#f69d50',
    params: '#adbac7',
    meta: '#768390',
    regexp: '#96d0ff',
    symbol: '#6cb6ff',
    operator: '#adbac7',
    punctuation: '#adbac7',
    selector: '#8ddb8c',
    property: '#6cb6ff',
  },
  'github-dark': {
    bg: '#0d1117',
    fg: '#e6edf3',
    headerBg: '#161b22',
    headerFg: '#8b949e',
    border: '#30363d',
    lineHighlight: 'rgba(110, 118, 129, 0.15)',
    linkHover: '#c9d1d9',
    keyword: '#ff7b72',
    string: '#a5d6ff',
    number: '#79c0ff',
    comment: '#8b949e',
    function: '#d2a8ff',
    title: '#d2a8ff',
    built_in: '#79c0ff',
    literal: '#79c0ff',
    type: '#79c0ff',
    attr: '#79c0ff',
    tag: '#7ee787',
    name: '#7ee787',
    attribute: '#79c0ff',
    variable: '#ffa657',
    'template-variable': '#ffa657',
    params: '#e6edf3',
    meta: '#8b949e',
    regexp: '#a5d6ff',
    symbol: '#79c0ff',
    operator: '#e6edf3',
    punctuation: '#e6edf3',
    selector: '#7ee787',
    property: '#79c0ff',
  },
  github: {
    bg: '#ffffff',
    fg: '#1f2328',
    headerBg: '#f6f8fa',
    headerFg: '#656d76',
    border: '#d1d9e0',
    lineHighlight: 'rgba(234, 179, 8, 0.12)',
    linkHover: '#1f2328',
    keyword: '#cf222e',
    string: '#0a3069',
    number: '#0550ae',
    comment: '#6e7781',
    function: '#8250df',
    title: '#8250df',
    built_in: '#0550ae',
    literal: '#0550ae',
    type: '#0550ae',
    attr: '#0550ae',
    tag: '#116329',
    name: '#116329',
    attribute: '#0550ae',
    variable: '#953800',
    'template-variable': '#953800',
    params: '#1f2328',
    meta: '#6e7781',
    regexp: '#0a3069',
    symbol: '#0550ae',
    operator: '#1f2328',
    punctuation: '#1f2328',
    selector: '#116329',
    property: '#0550ae',
  },
}

// ---------------------------------------------------------------------------
// Theme resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the current theme ID based on page theme and config.
 * Follows code-box theme (data-sb-code-theme attribute).
 */
function normalizeThemeId(requested, mode) {
  const fallback = mode === 'light' ? 'github' : 'github-dark-dimmed'
  if (!requested || typeof requested !== 'string') return fallback
  if (THEMES[requested]) return requested

  const key = requested.trim().toLowerCase().replace(/[\s_]+/g, '-')
  const aliases = {
    github: 'github',
    'github-light': 'github',
    light: 'github',
    'night-owl-light': 'github',
    'github-dark': 'github-dark',
    dark: 'github-dark-dimmed',
    'dark-dimmed': 'github-dark-dimmed',
    'github-dark-dimmed': 'github-dark-dimmed',
    'night-owl': 'github-dark-dimmed',
  }

  const resolved = aliases[key]
  if (resolved && THEMES[resolved]) return resolved
  return fallback
}

/**
 * Resolve the current theme ID based on page theme and config.
 * Always follows the page theme (data-sb-theme attribute).
 */
function resolveThemeId() {
  const config = getToolbarConfig()
  const highlighting = config?.highlighting || {}
  const darkTheme = normalizeThemeId(highlighting.dark, 'dark')
  const lightTheme = normalizeThemeId(highlighting.light, 'light')

  const codeTheme = typeof document !== 'undefined'
    ? document.documentElement.getAttribute('data-sb-code-theme') || 'light'
    : 'dark'

  return codeTheme.startsWith('dark') ? darkTheme : lightTheme
}

/**
 * Get the color palette for the current theme.
 * Falls back to github-dark-dimmed for unknown theme names.
 * Exported so InspectorPanel can use it for header/container colors.
 */
export function getColors() {
  const id = resolveThemeId()
  return THEMES[id] || THEMES['github-dark-dimmed']
}

// ---------------------------------------------------------------------------
// HTML generation
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Convert highlight.js class-based spans to inline-styled spans.
 * highlight.js emits `<span class="hljs-keyword">` etc.
 * We replace each with `<span style="color:...">` using the palette.
 */
function applyInlineColors(html, colors) {
  return html.replace(
    /<span class="hljs-([^"]+)">/g,
    (_, cls) => {
      const color = colors[cls] || colors.fg
      return `<span style="color:${color}">`
    }
  )
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create the inspector highlighter.
 * Returns an object with codeToHtml() matching the Shiki-compatible API.
 */
export async function createInspectorHighlighter() {
  return {
    /**
     * Highlight code and return HTML string with inline styles.
     *
     * @param {string} code - Source code to highlight
     * @param {object} options
     * @param {string} [options.lang] - Language identifier
     * @param {string} [options.theme] - Ignored (theme resolved from config)
     * @param {boolean} [options.lineNumbers] - Show inline line numbers (default: true)
     * @param {Array<{ start: { line: number }, end: { line: number }, properties: { class: string } }>} [options.decorations]
     * @returns {string} HTML string with highlighted code
     */
    codeToHtml(code, options = {}) {
      const lang = options.lang || 'javascript'
      const decorations = options.decorations || []
      const showLineNumbers = options.lineNumbers !== false
      const colors = getColors()

      let highlighted
      try {
        const resolvedLang = hljs.getLanguage(lang) ? lang : 'plaintext'
        highlighted = hljs.highlight(code, { language: resolvedLang, ignoreIllegals: true }).value
      } catch {
        highlighted = escapeHtml(code)
      }

      // Convert class-based spans to inline styles
      highlighted = applyInlineColors(highlighted, colors)

      const lines = highlighted.split('\n')
      const highlightedLines = new Set()
      for (const dec of decorations) {
        if (dec.start && dec.properties?.class) {
          for (let i = dec.start.line; i <= (dec.end?.line ?? dec.start.line); i++) {
            highlightedLines.add(i)
          }
        }
      }

      const lineNumWidth = String(lines.length).length
      const gutterColor = colors.comment || colors.headerFg || '#636e7b'

      const wrappedLines = lines.map((line, i) => {
        const classes = ['line']
        if (highlightedLines.has(i)) classes.push('highlighted-line')
        const numSpan = showLineNumbers
          ? `<span class="line-number" style="color:${gutterColor};user-select:none;opacity:0.5;display:inline-block;width:${lineNumWidth}ch;text-align:right;margin-right:1.5ch">${String(i + 1).padStart(lineNumWidth)}</span>`
          : ''
        return `<span class="${classes.join(' ')}">${numSpan}${line}</span>`
      }).join('\n')

      return `<pre style="background:${colors.bg};color:${colors.fg};margin:0;padding:8px;overflow-x:auto"><code>${wrappedLines}</code></pre>`
    },
  }
}
