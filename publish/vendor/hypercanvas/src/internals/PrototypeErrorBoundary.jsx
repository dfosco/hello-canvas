/**
 * PrototypeErrorBoundary — catches render-time errors in prototype routes.
 *
 * Injected automatically by routes.jsx on every lazy-loaded route so a single
 * broken prototype never takes down the workspace, other prototypes, or canvases.
 *
 * Also exports ImportErrorFallback for use when the lazy import itself fails
 * (syntax error, missing dependency, etc.).
 */
import { Component } from 'react'
import { useRouteError } from 'react-router-dom'
import css from './PrototypeErrorBoundary.module.css'

/**
 * React Router errorElement component — used as the route-level ErrorBoundary.
 * React Router v6.4+ calls this as a regular component (not a class boundary);
 * the error is accessed via useRouteError().
 */
export default function PrototypeErrorBoundary() {
  const error = useRouteError()
  return <ErrorDisplay error={error} />
}

/**
 * Fallback rendered directly as the route Component when lazy import() fails.
 * Receives the caught import error via props (no useRouteError needed).
 */
export function ImportErrorFallback({ error, route }) {
  return (
    <ErrorDisplay
      error={error}
      hint={route ? `Failed to load module: ${route}` : undefined}
    />
  )
}

/**
 * App-level last-resort error boundary.
 * Exported from _app.jsx as `Catch` — generouted wires it via _app?.Catch.
 * Catches errors that escape route-level boundaries (e.g. StoryboardProvider crash).
 */
export function AppErrorBoundary() {
  const error = useRouteError()
  return (
    <main className={css.container}>
      <div className={css.banner}>
        <strong>Something went wrong</strong>
        {error?.message || String(error)}
      </div>
      <p className={css.meta}>
        An unexpected error crashed the application. Try reloading the page.
      </p>
      <div className={css.actions}>
        <a className={css.homeLink} href="/">← Back to workspace</a>
        <button className={css.retryBtn} onClick={() => window.location.reload()}>
          Reload page
        </button>
      </div>
    </main>
  )
}

/**
 * Shared error display used by both route-level and import-level fallbacks.
 */
function ErrorDisplay({ error, hint }) {
  const message = error?.message || String(error || 'Unknown error')
  const stack = error?.stack || null

  return (
    <main className={css.container}>
      <div className={css.banner}>
        <strong>Prototype error</strong>
        {hint && <span className={css.hint}>{hint}</span>}
        <span>{message}</span>
      </div>
      {stack && <StackTrace stack={stack} />}
      <div className={css.actions}>
        <a className={css.homeLink} href="/">← Back to workspace</a>
      </div>
    </main>
  )
}

/**
 * Collapsible stack trace — hidden by default, toggle to show.
 */
class StackTrace extends Component {
  constructor(props) {
    super(props)
    this.state = { open: false }
  }

  render() {
    return (
      <details className={css.stackDetails}>
        <summary className={css.stackSummary}>Stack trace</summary>
        <pre className={css.stackPre}>{this.props.stack}</pre>
      </details>
    )
  }
}
