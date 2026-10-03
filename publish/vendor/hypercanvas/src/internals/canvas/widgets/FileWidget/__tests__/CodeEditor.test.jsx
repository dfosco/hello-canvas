import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import { createRef } from 'react'

// ── Hoisted shared state (accessible from vi.mock factories) ──────────────────

const { mockView, updateListenerCapture } = vi.hoisted(() => {
  const updateListenerCapture = { fn: null }
  const mockView = {
    state: { doc: { toString: () => 'test' } },
    destroy: vi.fn(),
    dispatch: vi.fn(),
    focus: vi.fn(),
    contentDOM: {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  }
  return { mockView, updateListenerCapture }
})

// ── CodeMirror module mocks ───────────────────────────────────────────────────

vi.mock('@codemirror/state', () => ({
  EditorState: {
    create: vi.fn(() => ({})),
    tabSize: { of: vi.fn(() => []) },
    readOnly: { of: vi.fn(() => []) },
  },
  // Must be a regular function — arrow functions cannot be used as constructors
  Compartment: vi.fn(function MockCompartment() {
    return {
      of: vi.fn((ext) => ext),
      reconfigure: vi.fn((ext) => ({ type: 'reconfigure', ext })),
    }
  }),
}))

vi.mock('@codemirror/view', () => {
  function MockEditorView() {
    this.state = mockView.state
    this.destroy = mockView.destroy
    this.dispatch = mockView.dispatch
    this.focus = mockView.focus
    this.contentDOM = mockView.contentDOM
  }
  MockEditorView.updateListener = {
    of: vi.fn((fn) => { updateListenerCapture.fn = fn; return fn }),
  }
  MockEditorView.lineWrapping = []
  MockEditorView.placeholder = vi.fn(() => [])

  return {
    EditorView: MockEditorView,
    keymap: { of: vi.fn(() => []) },
  }
})

vi.mock('@codemirror/commands', () => ({ defaultKeymap: [], historyKeymap: [] }))
vi.mock('@codemirror/search', () => ({ searchKeymap: [] }))
vi.mock('codemirror', () => ({ basicSetup: [] }))
vi.mock('@codemirror/theme-one-dark', () => ({ oneDark: [] }))
vi.mock('@codemirror/lang-javascript', () => ({ javascript: vi.fn(() => []) }))
vi.mock('@codemirror/lang-markdown', () => ({ markdown: vi.fn(() => []) }))
vi.mock('@codemirror/lang-css', () => ({ css: vi.fn(() => []) }))
vi.mock('@codemirror/lang-html', () => ({ html: vi.fn(() => []) }))
vi.mock('@codemirror/lang-json', () => ({ json: vi.fn(() => []) }))
vi.mock('@codemirror/lang-yaml', () => ({ yaml: vi.fn(() => []) }))
vi.mock('@codemirror/lang-python', () => ({ python: vi.fn(() => []) }))

// Import component after mocks are declared
import CodeEditor from '../CodeEditor.jsx'

// ── Success tests ─────────────────────────────────────────────────────────────

describe('CodeEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateListenerCapture.fn = null
    mockView.state.doc.toString = () => 'test'
  })

  it('renders a fallback <pre> synchronously before CM loads', () => {
    const { container } = render(
      <CodeEditor path="src/foo.js" value="const x = 1" onChange={vi.fn()} />,
    )
    const pre = container.querySelector('pre')
    expect(pre).toBeInTheDocument()
    expect(pre).toHaveTextContent('const x = 1')
  })

  it('shows placeholder in fallback when value is empty', () => {
    const { container } = render(
      <CodeEditor path="src/foo.js" value="" onChange={vi.fn()} placeholder="Start typing…" />,
    )
    expect(container.querySelector('pre')).toHaveTextContent('Start typing…')
  })

  it('reveals the CM container after editor initialises', async () => {
    const { container } = render(
      <CodeEditor path="src/foo.js" value="hello" onChange={vi.fn()} />,
    )
    const cmContainer = container.querySelector('[class*="cmContainer"]')
    expect(cmContainer).toHaveStyle({ display: 'none' })

    await waitFor(() => {
      expect(cmContainer).not.toHaveStyle({ display: 'none' })
    })
  })

  it('calls onChange when the editor content changes', async () => {
    const onChange = vi.fn()
    render(<CodeEditor path="src/foo.js" value="original" onChange={onChange} />)

    await waitFor(() => expect(updateListenerCapture.fn).not.toBeNull())

    act(() => {
      updateListenerCapture.fn({
        docChanged: true,
        state: { doc: { toString: () => 'updated content' } },
      })
    })

    expect(onChange).toHaveBeenCalledWith('updated content')
  })

  it('does not call onChange when docChanged is false', async () => {
    const onChange = vi.fn()
    render(<CodeEditor path="src/foo.js" value="original" onChange={onChange} />)

    await waitFor(() => expect(updateListenerCapture.fn).not.toBeNull())

    act(() => {
      updateListenerCapture.fn({
        docChanged: false,
        state: { doc: { toString: () => 'same' } },
      })
    })

    expect(onChange).not.toHaveBeenCalled()
  })

  it('exposes focus() via forwarded ref', async () => {
    const ref = createRef()
    render(<CodeEditor path="src/foo.js" value="" onChange={vi.fn()} ref={ref} />)

    await waitFor(() => expect(ref.current).not.toBeNull())

    ref.current.focus()
    expect(mockView.focus).toHaveBeenCalled()
  })

  it('dispatches a change when the value prop updates externally', async () => {
    mockView.state.doc.toString = () => 'initial'

    const { rerender } = render(
      <CodeEditor path="src/foo.js" value="initial" onChange={vi.fn()} />,
    )

    await waitFor(() => expect(updateListenerCapture.fn).not.toBeNull())

    rerender(<CodeEditor path="src/foo.js" value="new value" onChange={vi.fn()} />)

    expect(mockView.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      changes: expect.objectContaining({ insert: 'new value' }),
    }))
  })

  it('skips dispatch when value prop matches current doc', async () => {
    mockView.state.doc.toString = () => 'same'

    const { rerender } = render(
      <CodeEditor path="src/foo.js" value="same" onChange={vi.fn()} />,
    )
    await waitFor(() => expect(updateListenerCapture.fn).not.toBeNull())
    mockView.dispatch.mockClear()

    rerender(<CodeEditor path="src/foo.js" value="same" onChange={vi.fn()} />)

    expect(mockView.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({
      changes: expect.anything(),
    }))
  })

  it('reconfigures the readOnly compartment when the prop changes', async () => {
    const { rerender } = render(
      <CodeEditor path="src/foo.js" value="" onChange={vi.fn()} readOnly={false} />,
    )
    await waitFor(() => expect(updateListenerCapture.fn).not.toBeNull())
    mockView.dispatch.mockClear()

    rerender(<CodeEditor path="src/foo.js" value="" onChange={vi.fn()} readOnly={true} />)

    expect(mockView.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      effects: expect.anything(),
    }))
  })
})

// ── Import failure tests ──────────────────────────────────────────────────────

describe('CodeEditor — import failure', () => {
  it('stays in fallback and logs a warning when CodeMirror fails to load', async () => {
    // vi.doMock overrides the registered mock for subsequent imports
    vi.resetModules()
    vi.doMock('@codemirror/state', () => { throw new Error('CM unavailable') })

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const { default: FreshCodeEditor } = await import('../CodeEditor.jsx')

      const { container } = render(
        <FreshCodeEditor path="test.js" value="fail content" onChange={vi.fn()} />,
      )

      // Synchronous fallback is immediate
      expect(container.querySelector('pre')).toHaveTextContent('fail content')

      // Wait for the async failure + console.warn to fire
      await waitFor(() => {
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('[CodeEditor]'),
          expect.any(String),
        )
      })

      // Confirm still in fallback after the failure resolved
      expect(container.querySelector('pre')).toBeInTheDocument()
    } finally {
      warnSpy.mockRestore()
      vi.resetModules()
    }
  })
})
