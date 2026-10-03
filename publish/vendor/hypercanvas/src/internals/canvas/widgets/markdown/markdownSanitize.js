/**
 * Shared markdown → safe-HTML pipeline.
 *
 * Renders markdown (with GFM) to HTML while preserving inline HTML that
 * users legitimately embed in markdown widgets and GitHub issue/PR bodies
 * (`<video>`, `<audio>`, `<details>`, …), but runs every node through a
 * trusted allow-list sanitizer (`rehype-sanitize` / `hast-util-sanitize`).
 *
 * Because the sanitizer is allow-list based, anything not explicitly
 * permitted is dropped: `<script>`/`<iframe>`, every `on*` event handler,
 * and dangerous URL protocols (`javascript:`, `data:`) are statically
 * removed. The extra tags re-admitted below are all *inert* elements, and
 * only safe attributes (no event handlers) with `http(s)`-only `src`/`poster`
 * are allowed.
 */
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeStringify from 'rehype-stringify'

const schema = {
  ...defaultSchema,
  // `details`/`summary` are already in the default allow-list; add the inert
  // media elements consumers embed in markdown.
  tagNames: [...new Set([...(defaultSchema.tagNames || []), 'video', 'audio', 'track'])],
  attributes: {
    ...defaultSchema.attributes,
    video: ['src', 'poster', 'controls', 'loop', 'muted', 'autoPlay', 'playsInline', 'preload', 'width', 'height'],
    audio: ['src', 'controls', 'loop', 'muted', 'autoPlay', 'preload'],
    source: [...(defaultSchema.attributes?.source || []), 'src', 'type'],
    track: ['src', 'kind', 'srcLang', 'label', 'default'],
  },
  protocols: {
    ...defaultSchema.protocols,
    // Restrict media sources to http(s) — blocks `javascript:`/`data:` URLs.
    src: ['http', 'https'],
    poster: ['http', 'https'],
  },
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeSanitize, schema)
  .use(rehypeStringify)

/**
 * Render markdown to sanitized HTML.
 * @param {string} text Raw markdown.
 * @returns {string} Safe HTML string.
 */
export function markdownToSafeHtml(text) {
  if (!text) return ''
  return String(processor.processSync(text))
}
