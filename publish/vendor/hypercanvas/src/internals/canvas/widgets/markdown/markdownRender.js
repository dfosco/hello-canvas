/**
 * Pure markdown rendering helpers shared by `MarkdownView` (canvas widget
 * preview) and any consumer that wants HTML output from raw markdown.
 *
 * Split from `MarkdownEditor.jsx` so the latter only exports React
 * components — keeping Fast Refresh happy and the surface area minimal.
 */
import { markdownToSafeHtml } from './markdownSanitize.js'

export function renderMarkdown(text) {
  if (!text) return ''
  return markdownToSafeHtml(text).replace(/<a\s/g, '<a target="_blank" rel="noopener noreferrer" ')
}

let hljsPromise = null
function getHljs() {
  if (!hljsPromise) {
    hljsPromise = import('../../../../core/inspector/highlighter.js').then((mod) => mod)
  }
  return hljsPromise
}

export async function highlightCodeBlocks(html) {
  if (!html.includes('<code class="language-')) return html
  const { createInspectorHighlighter } = await getHljs()
  const hl = await createInspectorHighlighter()
  return html.replace(
    /<pre><code class="language-(\w+)">([\s\S]*?)<\/code><\/pre>/g,
    (match, lang, code) => {
      try {
        const decoded = code
          .replace(/&#x3C;/gi, '<')
          .replace(/&#x3E;/gi, '>')
          .replace(/&#x26;/gi, '&')
          .replace(/&#x22;/gi, '"')
          .replace(/&#x27;/gi, "'")
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&')
        return hl.codeToHtml(decoded, { lang })
      } catch {
        return match
      }
    },
  )
}
