import { useState, useEffect, useRef, Component } from 'react'
import { getMarkdownContentClassName } from '../markdown/markdownClass.js'
import styles from './MdxRenderer.module.css'

// Stable empty scope so the default param doesn't create a new {} on every
// render — otherwise the useEffect below re-fires forever and `compile`
// loops (loading → ready → loading → …).
const EMPTY_SCOPE = Object.freeze({})

// ── Error boundary ────────────────────────────────────────────────────────────

class MdxErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return <ErrorCard message={this.state.error.message} />
    }
    return this.props.children
  }
}

// ── Inline error card ─────────────────────────────────────────────────────────

function ErrorCard({ message, source }) {
  const snippet = source
    ? source.split('\n').slice(0, 3).join('\n')
    : null

  return (
    <div className={styles.errorCard} role="alert">
      <strong className={styles.errorTitle}>MDX Error</strong>
      <pre className={styles.errorMessage}>{message}</pre>
      {snippet && (
        <details className={styles.errorDetails}>
          <summary>Source</summary>
          <pre className={styles.errorSnippet}>{snippet}</pre>
        </details>
      )}
    </div>
  )
}

// ── Name extraction ───────────────────────────────────────────────────────────

function extractComponentName(source) {
  // export default function Foo() or export default function Foo (
  const defaultFn = source.match(/export\s+default\s+function\s+(\w+)/)
  if (defaultFn) return defaultFn[1]

  // export const Foo = () => or = function
  const namedConst = source.match(/export\s+const\s+(\w+)\s*=/)
  if (namedConst) return namedConst[1]

  // first H1: # Heading
  const h1 = source.match(/^#\s+(.+)$/m)
  if (h1) return h1[1].trim()

  return null
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MdxRenderer({ source = '', scope = EMPTY_SCOPE, onComponentName, size = 'small', _debounceMs = 150 }) {
  const [state, setState] = useState({ status: 'loading', Component: null, error: null })
  const debounceRef = useRef(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    debounceRef.current = setTimeout(() => {
      compile(source, scope, setState)
    }, _debounceMs)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [source, scope])

  useEffect(() => {
    if (!onComponentName) return
    const name = extractComponentName(source)
    if (name) onComponentName(name)
  }, [source, onComponentName])

  if (state.status === 'loading') {
    return <div className={styles.loading} aria-label="Compiling MDX…" />
  }

  if (state.status === 'unavailable') {
    return <div className={styles.fallback}>MDX rendering is unavailable in this environment.</div>
  }

  if (state.status === 'error') {
    return <ErrorCard message={state.error} source={source} />
  }

  const MDXContent = state.Component
  // Compose the host root with the shared markdown typography class so MDX
  // headings, paragraphs, lists, code blocks etc. match what <MarkdownView>
  // produces for plain `.md`. MDX may also render arbitrary interactive
  // React components, so we never opt into the `inert` pointer-events
  // cascade here.
  const contentClass = getMarkdownContentClassName({ size, inert: false })
  return (
    <div className={`${styles.root} ${contentClass}`}>
      <MdxErrorBoundary key={source}>
        <MDXContent components={scope} />
      </MdxErrorBoundary>
    </div>
  )
}

// ── Compile helper (outside component to avoid re-creating on render) ─────────

async function compile(source, scope, setState) {
  setState({ status: 'loading', Component: null, error: null })

  let mdxModule
  try {
    mdxModule = await import(/* @vite-ignore */ '@mdx-js/mdx')
  } catch {
    setState({ status: 'unavailable', Component: null, error: null })
    return
  }

  const { evaluate } = mdxModule

  let runtime
  try {
    runtime = await import('react/jsx-runtime')
  } catch {
    setState({ status: 'unavailable', Component: null, error: null })
    return
  }

  try {
    const result = await evaluate(source, {
      ...runtime,
      useMDXComponents: () => scope,
    })
    setState({ status: 'ready', Component: result.default, error: null })
  } catch (err) {
    setState({ status: 'error', Component: null, error: err.message || String(err) })
  }
}
