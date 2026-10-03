import { Component } from 'react'

/**
 * Error boundary for canvas component widgets.
 * Catches render-time errors so a single broken component
 * doesn't crash the entire canvas page.
 *
 * Used as a production fallback when iframe isolation is not available.
 */
export default class ComponentErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error(
      `[storyboard] Component widget "${this.props.name || 'unknown'}" crashed:`,
      error,
      info?.componentStack,
    )
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: '16px',
          color: '#cf222e',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: '13px',
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          minWidth: 200,
          minHeight: 60,
        }}>
          <strong>{this.props.name || 'Component'}</strong>
          <br />
          {String(this.state.error.message || this.state.error)}
        </div>
      )
    }
    return this.props.children
  }
}
