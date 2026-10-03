import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { createRef } from 'react'
import FileWidget from '../FileWidget.jsx'

// ── Mock fileContentStore ─────────────────────────────────────────────────────

let mockSubscribeCallback = null
let mockEntry = {
  content: '',
  exists: true,
  loading: false,
  dirty: false,
  error: null,
  hasExternalChange: false,
}

vi.mock('../fileContentStore.js', () => ({
  subscribe: vi.fn((path, cb) => {
    mockSubscribeCallback = cb
    cb(mockEntry)
    return vi.fn()
  }),
  loadFile: vi.fn(),
  saveFile: vi.fn(),
  updateContent: vi.fn(),
  refetchFile: vi.fn(),
  renameFile: vi.fn(),
  getFileEntry: vi.fn(() => mockEntry),
}))

// ── Mock CodeEditor ───────────────────────────────────────────────────────────

vi.mock('../CodeEditor.jsx', () => ({
  default: vi.fn(({ value, onChange, onBlur, readOnly, path }) => (
    <div data-testid="code-editor" data-path={path} data-readonly={readOnly ? 'true' : undefined}>
      <textarea
        data-testid="code-editor-textarea"
        value={value || ''}
        onChange={(e) => onChange?.(e.target.value)}
        onBlur={onBlur}
        readOnly={readOnly}
      />
    </div>
  )),
  preloadCodeMirror: vi.fn(() => Promise.resolve(null)),
}))

// ── Mock MdxRenderer ──────────────────────────────────────────────────────────

vi.mock('../MdxRenderer.jsx', () => ({
  default: vi.fn(({ source }) => {
    // Use useEffect to avoid setState-during-render warning
    // In tests we just render the stub immediately
    return <div data-testid="mdx-renderer" data-source={source} />
  }),
}))

// ── Import mocked modules for assertion ──────────────────────────────────────

import { subscribe, saveFile, refetchFile } from '../fileContentStore.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
function setEntry(updates) {
  mockEntry = { ...mockEntry, ...updates }
  if (mockSubscribeCallback) {
    act(() => mockSubscribeCallback(mockEntry))
  }
}

function renderWidget(propOverrides = {}, options = {}) {
  const ref = options.ref || createRef()
  const onUpdate = options.onUpdate || vi.fn()
  const result = render(
    <FileWidget
      id="widget-1"
      props={{ path: 'src/README.md', width: 560, height: 360, ...propOverrides }}
      onUpdate={onUpdate}
      ref={ref}
    />,
  )
  return { ...result, ref, onUpdate }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockSubscribeCallback = null
  mockEntry = {
    content: '',
    exists: true,
    loading: false,
    dirty: false,
    error: null,
    hasExternalChange: false,
  }
})

describe('FileWidget', () => {
  describe('empty state', () => {
    it('renders empty state when props.path is empty', () => {
      render(<FileWidget id="w1" props={{ path: '', width: 560, height: 360 }} />)
      expect(screen.getByText('No file selected.')).toBeTruthy()
      expect(screen.getByText('Pick a file…')).toBeTruthy()
    })

    it('dispatches open-file-picker event when Pick a file button is clicked', () => {
      const listener = vi.fn()
      document.addEventListener('storyboard:canvas:open-file-picker', listener)
      render(<FileWidget id="w1" props={{ path: '', width: 560, height: 360 }} />)
      fireEvent.click(screen.getByText('Pick a file…'))
      expect(listener).toHaveBeenCalledOnce()
      expect(listener.mock.calls[0][0].detail).toEqual({ widgetId: 'w1' })
      document.removeEventListener('storyboard:canvas:open-file-picker', listener)
    })
  })

  describe('store subscription', () => {
    it('subscribes to the store on mount with the given path', () => {
      renderWidget({ path: 'src/app.js' })
      expect(subscribe).toHaveBeenCalledWith('src/app.js', expect.any(Function))
    })

    it('resubscribes when path prop changes', () => {
      const { rerender } = render(
        <FileWidget id="w1" props={{ path: 'src/a.js', width: 560, height: 360 }} onUpdate={vi.fn()} />,
      )
      rerender(
        <FileWidget id="w1" props={{ path: 'src/b.js', width: 560, height: 360 }} onUpdate={vi.fn()} />,
      )
      expect(subscribe).toHaveBeenCalledWith('src/a.js', expect.any(Function))
      expect(subscribe).toHaveBeenCalledWith('src/b.js', expect.any(Function))
    })
  })

  describe('loading state', () => {
    it('renders loading placeholder while entry is loading and exists is undefined', () => {
      mockEntry = { content: '', exists: undefined, loading: true, dirty: false, error: null, hasExternalChange: false }
      renderWidget()
      expect(document.querySelector('[aria-label="Loading…"]')).toBeTruthy()
    })
  })

  describe('file not found', () => {
    it('renders error card when file does not exist', () => {
      mockEntry = { ...mockEntry, exists: false }
      renderWidget({ path: 'src/gone.md' })
      expect(screen.getByText('File not found')).toBeTruthy()
      expect(screen.getByText('src/gone.md')).toBeTruthy()
      expect(screen.getByText('This file no longer exists.')).toBeTruthy()
      expect(screen.getByText('Remove widget')).toBeTruthy()
    })

    it('dispatches delete-widget event when Remove widget is clicked', () => {
      mockEntry = { ...mockEntry, exists: false }
      const listener = vi.fn()
      document.addEventListener('storyboard:canvas:delete-widget', listener)
      renderWidget({ path: 'src/gone.md' })
      fireEvent.click(screen.getByText('Remove widget'))
      expect(listener).toHaveBeenCalledOnce()
      expect(listener.mock.calls[0][0].detail).toEqual({ widgetId: 'widget-1' })
      document.removeEventListener('storyboard:canvas:delete-widget', listener)
    })
  })

  describe('markdown flavor — view mode', () => {
    it('renders markdown as HTML in view mode', () => {
      mockEntry = { ...mockEntry, content: '# Hello World', exists: true }
      renderWidget({ path: 'src/README.md' })
      // rendered markdown should contain h1 with text
      const heading = document.querySelector('h1')
      expect(heading).toBeTruthy()
      expect(heading.textContent).toBe('Hello World')
    })

    it('does NOT render a textarea in view mode', () => {
      mockEntry = { ...mockEntry, content: '# Hello', exists: true }
      renderWidget({ path: 'README.md' })
      expect(screen.queryByRole('textbox')).toBeNull()
    })
  })

  describe('markdown flavor — edit mode', () => {
    it('renders textarea in edit mode', () => {
      mockEntry = { ...mockEntry, content: '# Hello', exists: true }
      const ref = createRef()
      renderWidget({ path: 'README.md' }, { ref })
      act(() => ref.current.handleAction('toggle-edit'))
      expect(screen.getByRole('textbox')).toBeTruthy()
    })

    it('textarea shows current content', () => {
      mockEntry = { ...mockEntry, content: 'Some content', exists: true }
      const ref = createRef()
      renderWidget({ path: 'README.md' }, { ref })
      act(() => ref.current.handleAction('toggle-edit'))
      expect(screen.getByRole('textbox').value).toBe('Some content')
    })
  })

  describe('MDX flavor', () => {
    it('renders MdxRenderer in view mode', () => {
      mockEntry = { ...mockEntry, content: 'export default function Foo() {}', exists: true }
      renderWidget({ path: 'src/Widget.mdx' })
      expect(screen.getByTestId('mdx-renderer')).toBeTruthy()
    })

    it('renders CodeEditor in edit mode', () => {
      mockEntry = { ...mockEntry, content: '# MDX', exists: true }
      const ref = createRef()
      renderWidget({ path: 'src/Widget.mdx' }, { ref })
      act(() => ref.current.handleAction('toggle-edit'))
      expect(screen.getByTestId('code-editor')).toBeTruthy()
    })
  })

  describe('code flavor', () => {
    it('renders CodeEditor for code files', () => {
      mockEntry = { ...mockEntry, content: 'const x = 1', exists: true }
      renderWidget({ path: 'src/index.js' })
      expect(screen.getByTestId('code-editor')).toBeTruthy()
    })

    it('CodeEditor is not in readonly mode when onUpdate is provided', () => {
      mockEntry = { ...mockEntry, content: 'let x = 1', exists: true }
      renderWidget({ path: 'src/app.ts' })
      const editor = screen.getByTestId('code-editor')
      expect(editor.dataset.readonly).toBeUndefined()
    })

    it('CodeEditor is readonly when onUpdate is not provided', () => {
      mockEntry = { ...mockEntry, content: 'let x = 1', exists: true }
      render(
        <FileWidget
          id="w1"
          props={{ path: 'src/app.ts', width: 560, height: 360 }}
        />,
      )
      const editor = screen.getByTestId('code-editor')
      expect(editor.dataset.readonly).toBe('true')
    })
  })

  describe('unsupported flavor', () => {
    it('renders unsupported empty state for binary files', () => {
      mockEntry = { ...mockEntry, content: '', exists: true }
      renderWidget({ path: 'image.png' })
      expect(screen.getByText('Cannot edit this file type.')).toBeTruthy()
    })
  })

  describe('handleAction', () => {
    it('toggle-edit flips editing state for markdown', () => {
      mockEntry = { ...mockEntry, content: '# Hi', exists: true }
      const ref = createRef()
      renderWidget({ path: 'README.md' }, { ref })
      expect(screen.queryByRole('textbox')).toBeNull()
      act(() => ref.current.handleAction('toggle-edit'))
      expect(screen.getByRole('textbox')).toBeTruthy()
      act(() => ref.current.handleAction('toggle-edit'))
      expect(screen.queryByRole('textbox')).toBeNull()
    })

    it('toggle-edit saves when exiting edit mode with dirty content', () => {
      mockEntry = { ...mockEntry, content: '# Hi', exists: true, dirty: true }
      const ref = createRef()
      renderWidget({ path: 'README.md' }, { ref })
      act(() => ref.current.handleAction('toggle-edit'))
      expect(saveFile).not.toHaveBeenCalled()
      act(() => ref.current.handleAction('toggle-edit'))
      expect(saveFile).toHaveBeenCalledWith('README.md')
    })

    it('toggle-edit does NOT save when exiting clean', () => {
      mockEntry = { ...mockEntry, content: '# Hi', exists: true, dirty: false }
      const ref = createRef()
      renderWidget({ path: 'README.md' }, { ref })
      act(() => ref.current.handleAction('toggle-edit'))
      act(() => ref.current.handleAction('toggle-edit'))
      expect(saveFile).not.toHaveBeenCalled()
    })

    it('toggle-edit is a no-op for code flavor (always editing)', () => {
      mockEntry = { ...mockEntry, content: 'x=1', exists: true }
      const ref = createRef()
      renderWidget({ path: 'src/app.js' }, { ref })
      expect(screen.getByTestId('code-editor')).toBeTruthy()
      act(() => ref.current.handleAction('toggle-edit'))
      expect(screen.getByTestId('code-editor')).toBeTruthy()
    })

    it('save calls saveFile', () => {
      mockEntry = { ...mockEntry, content: 'hello', exists: true }
      const ref = createRef()
      renderWidget({ path: 'src/app.js' }, { ref })
      act(() => ref.current.handleAction('save'))
      expect(saveFile).toHaveBeenCalledWith('src/app.js')
    })

    it('copy-path calls navigator.clipboard.writeText', () => {
      const writeText = vi.fn()
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, writable: true, configurable: true })
      mockEntry = { ...mockEntry, content: '', exists: true }
      const ref = createRef()
      renderWidget({ path: 'src/app.js' }, { ref })
      act(() => ref.current.handleAction('copy-path'))
      expect(writeText).toHaveBeenCalledWith('src/app.js')
    })

    it('unknown action returns false', () => {
      mockEntry = { ...mockEntry, content: '', exists: true }
      const ref = createRef()
      renderWidget({ path: 'src/app.js' }, { ref })
      let result
      act(() => { result = ref.current.handleAction('delete') })
      expect(result).toBe(false)
    })
  })

  describe('cmd+S document-level shortcut', () => {
    // Regression: previously the cmd+S handler was bound to the widget's
    // root via React's onKeyDown. Browser intercepted the shortcut first
    // (Save Page As…) before the React handler fired. Now the binding is
    // a document-level capture-phase listener that preventDefaults.
    it('calls saveFile and preventDefault when widget owns focus', () => {
      mockEntry = { ...mockEntry, content: 'hello', exists: true }
      const ref = createRef()
      const { container } = renderWidget({ path: 'src/app.js' }, { ref })
      // Focus an element inside the widget so the handler activates
      const textarea = screen.getByTestId('code-editor-textarea')
      textarea.focus()
      expect(container.contains(document.activeElement)).toBe(true)

      const evt = new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true })
      const prevented = !document.dispatchEvent(evt)

      expect(saveFile).toHaveBeenCalledWith('src/app.js')
      expect(prevented || evt.defaultPrevented).toBe(true)
    })

    it('does NOT save when focus is outside the widget', () => {
      mockEntry = { ...mockEntry, content: 'hello', exists: true }
      const ref = createRef()
      renderWidget({ path: 'src/app.js' }, { ref })
      // Blur to body
      if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur()
      }
      const evt = new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true })
      document.dispatchEvent(evt)
      expect(saveFile).not.toHaveBeenCalled()
    })
  })

  describe('save on blur', () => {
    it('calls saveFile on blur when entry is dirty', () => {
      mockEntry = { ...mockEntry, content: 'hello', exists: true, dirty: true }
      const ref = createRef()
      renderWidget({ path: 'src/app.js' }, { ref })
      const textarea = screen.getByTestId('code-editor-textarea')
      fireEvent.blur(textarea)
      expect(saveFile).toHaveBeenCalledWith('src/app.js')
    })

    it('does NOT call saveFile on blur when entry is not dirty', () => {
      mockEntry = { ...mockEntry, content: 'hello', exists: true, dirty: false }
      const ref = createRef()
      renderWidget({ path: 'src/app.js' }, { ref })
      const textarea = screen.getByTestId('code-editor-textarea')
      fireEvent.blur(textarea)
      expect(saveFile).not.toHaveBeenCalled()
    })

    // Regression: handleBlur must read dirty from the store (getFileEntry),
    // not from the React state snapshot — updateContent flips dirty on the
    // cache synchronously but setState only schedules a re-render, so a
    // type-then-immediately-blur sequence races and the closure sees the
    // pre-update value.
    it('calls saveFile on blur when the store reports dirty even if React state has not flushed', () => {
      // Initial render: entry from props perspective is NOT dirty…
      mockEntry = { ...mockEntry, content: 'hello', exists: true, dirty: false }
      const ref = createRef()
      renderWidget({ path: 'src/app.js' }, { ref })
      // …but the store now reports dirty (simulating a fresh updateContent
      // call whose subscriber notification has not yet propagated to React).
      mockEntry = { ...mockEntry, dirty: true }
      const textarea = screen.getByTestId('code-editor-textarea')
      fireEvent.blur(textarea)
      expect(saveFile).toHaveBeenCalledWith('src/app.js')
    })
  })

  describe('external change banner', () => {
    it('shows banner when entry.hasExternalChange is true', () => {
      mockEntry = { ...mockEntry, content: 'hello', exists: true, dirty: true, hasExternalChange: true }
      renderWidget({ path: 'src/app.js' })
      expect(screen.getByText('File was modified on disk.')).toBeTruthy()
      expect(screen.getByText('Discard my changes & reload')).toBeTruthy()
    })

    it('does NOT show banner when hasExternalChange is false', () => {
      mockEntry = { ...mockEntry, content: 'hello', exists: true, hasExternalChange: false }
      renderWidget({ path: 'src/app.js' })
      expect(screen.queryByText('File was modified on disk.')).toBeNull()
    })

    it('calls refetchFile when discard button is clicked', () => {
      mockEntry = { ...mockEntry, content: 'hello', exists: true, dirty: true, hasExternalChange: true }
      renderWidget({ path: 'src/app.js' })
      fireEvent.click(screen.getByText('Discard my changes & reload'))
      expect(refetchFile).toHaveBeenCalledWith('src/app.js')
    })
  })

  describe('title-bar Edit/Save button', () => {
    it('shows "Edit" when not editing and "Save" when editing for markdown files', () => {
      mockEntry = { ...mockEntry, content: '# hi', exists: true }
      const ref = createRef()
      renderWidget({ path: 'README.md' }, { ref })
      // Not editing — button reads "Edit"
      expect(screen.getByRole('button', { name: /edit file/i })).toBeTruthy()
      // Enter edit mode
      act(() => ref.current.handleAction('toggle-edit'))
      // Now reads "Save"
      expect(screen.getByRole('button', { name: /save file and exit edit mode/i })).toBeTruthy()
    })

    it('clicking "Edit" enters edit mode', () => {
      mockEntry = { ...mockEntry, content: '# hi', exists: true }
      renderWidget({ path: 'README.md' })
      expect(screen.queryByRole('textbox')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: /edit file/i }))
      expect(screen.getByRole('textbox')).toBeTruthy()
    })

    it('clicking "Save" exits edit mode and saves when dirty', () => {
      mockEntry = { ...mockEntry, content: '# hi', exists: true, dirty: true }
      const ref = createRef()
      renderWidget({ path: 'README.md' }, { ref })
      act(() => ref.current.handleAction('toggle-edit'))
      fireEvent.click(screen.getByRole('button', { name: /save file and exit edit mode/i }))
      expect(saveFile).toHaveBeenCalledWith('README.md')
      expect(screen.queryByRole('textbox')).toBeNull()
    })

    it('renders the legacy disabled-on-clean Save button for code files', () => {
      mockEntry = { ...mockEntry, content: 'x', exists: true, dirty: false }
      renderWidget({ path: 'src/app.js' })
      const btn = screen.getByRole('button', { name: /save file/i })
      expect(btn).toBeTruthy()
      expect(btn.disabled).toBe(true)
    })
  })

  describe('preview has no double-click-to-edit', () => {
    it('does not enter edit mode when the markdown preview is double-clicked', () => {
      mockEntry = { ...mockEntry, content: '# Hello', exists: true }
      const { container } = renderWidget({ path: 'README.md' })
      const heading = container.querySelector('h1')
      expect(heading).toBeTruthy()
      fireEvent.doubleClick(heading)
      expect(screen.queryByRole('textbox')).toBeNull()
    })
  })

  describe('saves on tab/window blur while editing', () => {
    it('saves dirty content when window blurs and stays in edit mode', () => {
      mockEntry = { ...mockEntry, content: '# Hi', exists: true, dirty: true }
      const ref = createRef()
      renderWidget({ path: 'README.md' }, { ref })
      act(() => ref.current.handleAction('toggle-edit'))
      expect(screen.getByRole('textbox')).toBeTruthy()
      act(() => {
        window.dispatchEvent(new Event('blur'))
      })
      expect(saveFile).toHaveBeenCalledWith('README.md')
      // Critical: edit mode is NOT exited — the user may have just
      // cmd-tabbed away to look something up.
      expect(screen.getByRole('textbox')).toBeTruthy()
    })

    it('saves dirty content when document visibility becomes hidden', () => {
      mockEntry = { ...mockEntry, content: '# Hi', exists: true, dirty: true }
      const ref = createRef()
      renderWidget({ path: 'README.md' }, { ref })
      act(() => ref.current.handleAction('toggle-edit'))
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      })
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
      expect(saveFile).toHaveBeenCalledWith('README.md')
      // Restore so subsequent tests aren't affected
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      })
    })

    it('does not save on window blur when not editing', () => {
      mockEntry = { ...mockEntry, content: '# Hi', exists: true, dirty: true }
      renderWidget({ path: 'README.md' })
      act(() => {
        window.dispatchEvent(new Event('blur'))
      })
      expect(saveFile).not.toHaveBeenCalled()
    })

    it('does not save on window blur when content is clean', () => {
      mockEntry = { ...mockEntry, content: '# Hi', exists: true, dirty: false }
      const ref = createRef()
      renderWidget({ path: 'README.md' }, { ref })
      act(() => ref.current.handleAction('toggle-edit'))
      act(() => {
        window.dispatchEvent(new Event('blur'))
      })
      expect(saveFile).not.toHaveBeenCalled()
    })
  })
})
