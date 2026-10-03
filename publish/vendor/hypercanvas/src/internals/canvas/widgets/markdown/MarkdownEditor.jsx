/**
 * Shared markdown editing primitives used by both `MarkdownBlock` (canvas
 * widget) and `FileWidget` (markdown flavor). Extracting these ensures the
 * view ↔ edit interaction (auto-focus textarea on enter, Escape / blur to
 * exit, double-click preview to enter) behaves the same wherever markdown is
 * shown on the canvas.
 *
 * Pure rendering helpers live in `./markdownRender.js`. Shared typography
 * lives in `./markdownContent.module.css` — `<MarkdownView>` applies it
 * automatically based on `size`/`inert` props, and `<MdxRenderer>` opts
 * into the same stylesheet so markdown and MDX render identically.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { renderMarkdown, highlightCodeBlocks } from './markdownRender.js'
import { getMarkdownContentClassName } from './markdownClass.js'
import sharedStyles from './MarkdownEditor.module.css'

/**
 * Read-only markdown preview that auto-highlights code blocks when the theme
 * changes. When `canEdit` is true, double-clicking (or pressing Enter while
 * focused) calls `onStartEditing` so the parent can swap to a text editor.
 *
 * Typography is applied automatically via the shared `markdownContent.module.css`
 * — pass `size: 'small' | 'large'` to pick the variant, and `inert: true` to
 * opt into the canvas drag-friendly pointer-events cascade.
 *
 * @param {object} props
 * @param {string} props.content                 Raw markdown source.
 * @param {boolean} [props.canEdit=false]        Enables double-click-to-edit.
 * @param {() => void} [props.onStartEditing]    Called when user wants to edit.
 * @param {(e: React.ClipboardEvent) => void} [props.onCopy]
 *                                               Optional read-only copy handler
 *                                               (used by MarkdownBlock to copy
 *                                               raw markdown source).
 * @param {string} [props.className]             Wrapper class for layout
 *                                               (flex / overflow / size).
 *                                               Composed with the shared
 *                                               typography class.
 * @param {React.CSSProperties} [props.style]    Inline styles for the container.
 * @param {string} [props.emptyHtml]             Fallback HTML when content is empty.
 *                                               Default depends on canEdit.
 * @param {boolean} [props.allowTextSelection=false] Adds the
 *                                               data-canvas-allow-text-selection
 *                                               attribute so the canvas pan
 *                                               handler ignores drags here.
 * @param {'small' | 'large'} [props.size='small']
 *                                               Picks typography variant.
 * @param {boolean} [props.inert=false]          Makes children non-interactive
 *                                               except for links/imgs so the
 *                                               canvas drag handler can grab
 *                                               the widget.
 */
export function MarkdownView({
  content,
  canEdit = false,
  onStartEditing,
  onCopy,
  className,
  style,
  emptyHtml,
  allowTextSelection = false,
  size = 'small',
  inert = false,
}) {
  const rawHtml = useMemo(() => renderMarkdown(content), [content])
  const [renderedHtml, setRenderedHtml] = useState(rawHtml)

  const [themeKey, setThemeKey] = useState(0)
  useEffect(() => {
    function onThemeChanged() { setThemeKey((k) => k + 1) }
    document.addEventListener('storyboard:theme:changed', onThemeChanged)
    return () => document.removeEventListener('storyboard:theme:changed', onThemeChanged)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRenderedHtml(rawHtml)
    if (!rawHtml.includes('<code class="language-')) return
    let cancelled = false
    highlightCodeBlocks(rawHtml).then((highlighted) => {
      if (!cancelled) setRenderedHtml(highlighted)
    })
    return () => { cancelled = true }
  }, [rawHtml, themeKey])

  const fallback = emptyHtml ?? (canEdit
    ? `<p class="${sharedStyles.placeholder} placeholder">Double-click to edit…</p>`
    : `<p class="${sharedStyles.placeholder} placeholder">No content</p>`)

  const contentClass = getMarkdownContentClassName({ size, inert })
  const fullClassName = className ? `${className} ${contentClass}` : contentClass

  return (
    <div
      className={fullClassName}
      style={style}
      data-canvas-allow-text-selection={allowTextSelection ? '' : undefined}
      onClick={!canEdit ? (e) => e.stopPropagation() : undefined}
      onCopy={onCopy}
      onDoubleClick={canEdit ? onStartEditing : undefined}
      role={canEdit ? 'button' : undefined}
      tabIndex={canEdit ? 0 : undefined}
      onKeyDown={canEdit ? (e) => { if (e.key === 'Enter') onStartEditing?.() } : undefined}
      dangerouslySetInnerHTML={{ __html: renderedHtml || fallback }}
    />
  )
}

/**
 * Textarea editor for markdown source. Auto-focuses on mount, stops
 * pointer/mouse propagation so the canvas pan handler doesn't grab the
 * user's drag-to-select.
 *
 * Exit semantics are split so consumers can decide what blur means:
 *   - onEscape: invoked when the user presses Escape (and also fires onExit)
 *   - onBlur:   invoked when the textarea loses focus (and also fires onExit)
 *   - onExit:   convenience for "either of the above"
 *
 * @param {object} props
 * @param {string} props.content              Current markdown source.
 * @param {(value: string) => void} props.onChange
 *                                            Called on every keystroke.
 * @param {() => void} [props.onEscape]       Called when the user presses Escape.
 * @param {() => void} [props.onBlur]         Called when the textarea blurs.
 * @param {() => void} [props.onExit]         Called on Escape OR blur (in addition
 *                                            to the more specific handlers).
 * @param {string} [props.placeholder='Write markdown…']
 * @param {string} props.className            Class for the textarea.
 * @param {React.CSSProperties} [props.style] Inline styles for the textarea.
 * @param {React.RefObject} [props.textareaRef] Optional external ref.
 */
export function MarkdownTextEditor({
  content,
  onChange,
  onEscape,
  onBlur,
  onExit,
  placeholder = 'Write markdown…',
  className,
  style,
  textareaRef: externalRef,
}) {
  const internalRef = useRef(null)
  const textareaRef = externalRef || internalRef

  // Auto-focus on mount and place caret at end (without scrolling parent).
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    const len = ta.value.length
    try { ta.setSelectionRange(len, len) } catch { /* noop */ }
    ta.focus({ preventScroll: true })
    // We intentionally only run this on mount — re-focusing on every content
    // change would yank the caret around.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <textarea
      ref={textareaRef}
      className={className}
      style={style}
      data-canvas-allow-text-selection
      value={content}
      onChange={(e) => onChange?.(e.target.value)}
      onBlur={() => { onBlur?.(); onExit?.() }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { onEscape?.(); onExit?.() }
      }}
      placeholder={placeholder}
    />
  )
}
