import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import MdxRenderer from '../MdxRenderer.jsx'

// All tests use _debounceMs={0} so compile fires immediately (no fake timers needed).
const WAIT = { timeout: 3000 }

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MdxRenderer', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders a loading placeholder while compile is pending', () => {
    // Initial render is synchronous — loading state appears before any async work
    render(<MdxRenderer source="# Hello" _debounceMs={99999} />)
    const loading = document.querySelector('[aria-label="Compiling MDX…"]')
    expect(loading).not.toBeNull()
  })

  it('renders an MDX heading and paragraph', async () => {
    render(<MdxRenderer source={'# Hello World\n\nThis is a paragraph.'} _debounceMs={0} />)
    await waitFor(() => expect(screen.getByText('Hello World')).toBeTruthy(), WAIT)
    expect(screen.getByText('This is a paragraph.')).toBeTruthy()
  })

  it('shows an error card for compile errors', async () => {
    const badSource = '# Bad MDX\n\n<Unclosed'
    render(<MdxRenderer source={badSource} _debounceMs={0} />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy(), WAIT)
    expect(screen.getByText('MDX Error')).toBeTruthy()
  })

  it('shows an error boundary card for runtime errors in MDX', async () => {
    // {(null).foo} compiles fine but throws at render time → ErrorBoundary catches it
    const runtimeErrorSource = '{(null).foo}'
    render(<MdxRenderer source={runtimeErrorSource} _debounceMs={0} />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy(), WAIT)
  })

  it('renders fallback message when @mdx-js/mdx import fails', async () => {
    // Reset modules so the fresh re-import picks up the doMock
    vi.resetModules()
    vi.doMock('@mdx-js/mdx', () => {
      throw new Error('Module not found')
    })

    const { default: MdxRendererFresh } = await import('../MdxRenderer.jsx')
    render(<MdxRendererFresh source="# Hello" _debounceMs={0} />)
    await waitFor(
      () =>
        expect(
          screen.getByText('MDX rendering is unavailable in this environment.'),
        ).toBeTruthy(),
      WAIT,
    )

    vi.doUnmock('@mdx-js/mdx')
    vi.resetModules()
  })

  it('calls onComponentName with export default function name', async () => {
    const onComponentName = vi.fn()
    const source = 'export default function MyArticle() {\n  return <p>hi</p>\n}'
    render(<MdxRenderer source={source} onComponentName={onComponentName} _debounceMs={0} />)
    await waitFor(() => expect(onComponentName).toHaveBeenCalledWith('MyArticle'), WAIT)
  })

  it('calls onComponentName with H1 text when no export default function', async () => {
    const onComponentName = vi.fn()
    const source = '# My Great Post\n\nContent here.'
    render(<MdxRenderer source={source} onComponentName={onComponentName} _debounceMs={0} />)
    await waitFor(() => expect(onComponentName).toHaveBeenCalledWith('My Great Post'), WAIT)
  })

  it('does not crash when onComponentName is not provided', async () => {
    render(<MdxRenderer source="# Hello" _debounceMs={0} />)
    await waitFor(() => screen.getByText('Hello'), WAIT)
  })
})
