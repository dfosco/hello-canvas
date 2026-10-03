import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import { detectFlavor } from './fileFlavor.js'
import { useConfig } from '../../../hooks/useConfig.js'
import styles from './CodeEditor.module.css'

// ── CodeMirror lazy loader ────────────────────────────────────────────────────

let cmPromise = null

/**
 * Trigger the CodeMirror dynamic imports. Returns the in-flight promise so
 * callers can `await` it. Idempotent — subsequent calls return the same
 * promise. Exported as `preloadCodeMirror` so the FileWidget can start the
 * load on mount rather than waiting until the editor itself mounts (which
 * for code/MDX files is also on mount, but for markdown happens only when
 * the user enters edit mode — pre-warming here means the markdown editor
 * is instantly responsive too).
 */
export function preloadCodeMirror() {
  return loadCodeMirror()
}

function loadCodeMirror() {
  if (!cmPromise) {
    cmPromise = Promise.all([
      import(/* @vite-ignore */ '@codemirror/state'),
      import(/* @vite-ignore */ '@codemirror/view'),
      import(/* @vite-ignore */ '@codemirror/commands'),
      import(/* @vite-ignore */ '@codemirror/search'),
      import(/* @vite-ignore */ 'codemirror'),
      import(/* @vite-ignore */ '@codemirror/theme-one-dark'),
    ]).then(([state, view, commands, search, core, themeOneDark]) => ({
      ...state,
      ...view,
      ...commands,
      ...search,
      basicSetup: core.basicSetup,
      oneDark: themeOneDark.oneDark,
    })).catch((err) => {
      console.warn('[CodeEditor] CodeMirror not available:', err.message)
      cmPromise = null
      return null
    })
  }
  return cmPromise
}

async function loadLanguageExtension(language, ext) {
  try {
    switch (language) {
      case 'javascript': {
        const { javascript } = await import(/* @vite-ignore */ '@codemirror/lang-javascript')
        return javascript({ jsx: ext === 'jsx' })
      }
      case 'typescript': {
        const { javascript } = await import(/* @vite-ignore */ '@codemirror/lang-javascript')
        return javascript({ jsx: true, typescript: true })
      }
      case 'markdown': {
        const { markdown } = await import(/* @vite-ignore */ '@codemirror/lang-markdown')
        return markdown()
      }
      case 'css': {
        const { css } = await import(/* @vite-ignore */ '@codemirror/lang-css')
        return css()
      }
      case 'html': {
        const { html } = await import(/* @vite-ignore */ '@codemirror/lang-html')
        return html()
      }
      case 'json': {
        const { json } = await import(/* @vite-ignore */ '@codemirror/lang-json')
        return json()
      }
      case 'yaml': {
        const { yaml } = await import(/* @vite-ignore */ '@codemirror/lang-yaml')
        return yaml()
      }
      case 'python': {
        const { python } = await import(/* @vite-ignore */ '@codemirror/lang-python')
        return python()
      }
      default:
        return []
    }
  } catch {
    return []
  }
}

// ── Theme helpers ─────────────────────────────────────────────────────────────

/**
 * Resolve the current code-surface mode. Reads `data-sb-code-theme` written
 * by themeStore (from the `codeBoxes` surface) and treats any value starting
 * with "dark" as dark mode. Falls back to legacy `data-color-mode` /
 * `data-sb-canvas-theme` for embeds that haven't booted the surface yet.
 *
 * @returns {'light' | 'dark'}
 */
function resolveCodeMode() {
  if (typeof document === 'undefined') return 'light'
  const html = document.documentElement
  const code = html.getAttribute('data-sb-code-theme')
  if (code) return code.startsWith('dark') ? 'dark' : 'light'
  if (html.getAttribute('data-color-mode') === 'dark') return 'dark'
  const canvasTheme = html.getAttribute('data-sb-canvas-theme')
  if (canvasTheme && canvasTheme.startsWith('dark')) return 'dark'
  return 'light'
}

/**
 * Map a configured theme value to a CodeMirror extension.
 *
 * @param {*} value - null/'default'/'none' → no theme; 'oneDark' → bundled;
 *                    `{ spec, dark }` → inline EditorView.theme spec.
 * @param {object} cm - The loaded CodeMirror module bundle.
 * @returns CodeMirror extension (may be an empty array).
 */
function buildThemeExtension(value, cm) {
  if (!value || value === 'default' || value === 'none') return []
  if (value === 'oneDark') return cm.oneDark || []
  if (typeof value === 'object' && value.spec) {
    try {
      return cm.EditorView.theme(value.spec, { dark: !!value.dark })
    } catch {
      return []
    }
  }
  return []
}

/** Pick the configured theme value for the current mode. */
function pickThemeValue(fileEditorCfg, mode) {
  const theme = fileEditorCfg?.theme
  if (!theme) return mode === 'dark' ? 'oneDark' : null
  return mode === 'dark' ? theme.dark : theme.light
}

// ── Component ─────────────────────────────────────────────────────────────────

export default forwardRef(function CodeEditor(
  { path, value, onChange, onBlur, readOnly = false, placeholder },
  ref,
) {
  const containerRef = useRef(null)
  const viewRef = useRef(null)
  const cmRef = useRef(null)
  const langCompartment = useRef(null)
  const themeCompartment = useRef(null)
  const readOnlyCompartment = useRef(null)
  const isInternalChange = useRef(false)
  const onChangeRef = useRef(onChange)
  const onBlurRef = useRef(onBlur)

  const canvasCfg = useConfig('canvas')
  const fileEditorCfg = canvasCfg?.fileEditor
  const fileEditorCfgRef = useRef(fileEditorCfg)
  useEffect(() => { fileEditorCfgRef.current = fileEditorCfg }, [fileEditorCfg])

  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  // Keep callbacks current without re-running the init effect
  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  useEffect(() => { onBlurRef.current = onBlur }, [onBlur])

  // ── Initialize CodeMirror on mount ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    async function init() {
      const cm = await loadCodeMirror()
      if (!cm) {
        if (!cancelled) setFailed(true)
        return
      }
      if (cancelled || !containerRef.current) return

      cmRef.current = cm
      const {
        EditorState, EditorView, Compartment,
        keymap, defaultKeymap, historyKeymap, searchKeymap,
        basicSetup,
      } = cm

      const { language, extension: ext } = detectFlavor(path)
      langCompartment.current = new Compartment()
      themeCompartment.current = new Compartment()
      readOnlyCompartment.current = new Compartment()

      const langExt = await loadLanguageExtension(language, ext)
      if (cancelled) return

      const themeExt = buildThemeExtension(
        pickThemeValue(fileEditorCfgRef.current, resolveCodeMode()),
        cm,
      )

      const state = EditorState.create({
        doc: value || '',
        extensions: [
          basicSetup,
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          EditorState.tabSize.of(2),
          EditorView.lineWrapping,
          langCompartment.current.of(langExt),
          themeCompartment.current.of(themeExt),
          readOnlyCompartment.current.of(EditorState.readOnly.of(readOnly)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              isInternalChange.current = true
              onChangeRef.current?.(update.state.doc.toString())
              isInternalChange.current = false
            }
          }),
          ...(placeholder ? [EditorView.placeholder(placeholder)] : []),
        ],
      })

      const view = new EditorView({ state, parent: containerRef.current })
      viewRef.current = view
      view.contentDOM.addEventListener('blur', () => onBlurRef.current?.())

      if (!cancelled) setReady(true)
    }

    init().catch((err) => {
      console.warn('[CodeEditor] Init error:', err.message)
      if (!cancelled) setFailed(true)
    })

    return () => {
      cancelled = true
      viewRef.current?.destroy()
      viewRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync external value changes ─────────────────────────────────────────────
  useEffect(() => {
    const view = viewRef.current
    if (!view || isInternalChange.current) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value || '' },
    })
  }, [value])

  // ── Sync readOnly prop ───────────────────────────────────────────────────────
  useEffect(() => {
    const view = viewRef.current
    const cm = cmRef.current
    if (!view || !cm || !readOnlyCompartment.current) return
    view.dispatch({
      effects: readOnlyCompartment.current.reconfigure(cm.EditorState.readOnly.of(readOnly)),
    })
  }, [readOnly])

  // ── Theme switching ──────────────────────────────────────────────────────────
  // Reacts to both the global theme event (storyboard:theme:changed) and any
  // change to the `canvas.fileEditor` config slice (e.g. user edits
  // storyboard.config.json — HMR re-emits via the config store).
  useEffect(() => {
    function applyTheme() {
      const view = viewRef.current
      const cm = cmRef.current
      if (!view || !cm || !themeCompartment.current) return
      const themeExt = buildThemeExtension(
        pickThemeValue(fileEditorCfgRef.current, resolveCodeMode()),
        cm,
      )
      view.dispatch({
        effects: themeCompartment.current.reconfigure(themeExt),
      })
    }
    document.addEventListener('storyboard:theme:changed', applyTheme)
    applyTheme()
    return () => document.removeEventListener('storyboard:theme:changed', applyTheme)
  }, [fileEditorCfg])

  // ── Forwarded ref ────────────────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    focus() {
      viewRef.current?.focus()
    },
  }), [])

  return (
    <div className={styles.editor}>
      {(!ready || failed) && (
        <pre className={`${styles.fallback}${!failed && !ready ? ` ${styles.loading}` : ''}`}>
          {value || placeholder || ''}
        </pre>
      )}
      <div
        ref={containerRef}
        className={styles.cmContainer}
        style={ready ? undefined : { display: 'none' }}
      />
    </div>
  )
})
