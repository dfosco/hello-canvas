import { fireEvent, render, screen, act, waitFor } from '@testing-library/react'
import CanvasPage from './CanvasPage.jsx'
import { getCanvasPrimerAttrs, getCanvasThemeVars } from './canvasTheme.js'
import { addWidget, checkGitHubCliAvailable, fetchGitHubEmbed, updateCanvas } from './canvasApi.js'

vi.mock('../../canvas/index.js', () => ({
  Canvas: ({ children, onDragEnd }) => (
    <div data-testid="tiny-canvas">
      {children}
      <button
        data-testid="drag-widget"
        onClick={() => onDragEnd?.('widget-1', { x: 111.4, y: 222.7 })}
      >
        drag widget
      </button>
      <button
        data-testid="drag-widget-negative"
        onClick={() => onDragEnd?.('widget-1', { x: -50, y: -30 })}
      >
        drag widget negative
      </button>
      <button
        data-testid="drag-source"
        onClick={() => onDragEnd?.('jsx-PrimaryButtons', { x: 333.2, y: 444.8 })}
      >
        drag source
      </button>
    </div>
  ),
}))

const mockCanvas = {
  title: 'Bridge Test Canvas',
  widgets: [{ id: 'widget-1', type: 'mock-widget', position: { x: 10, y: 20 }, props: {} }],
  sources: [{ export: 'PrimaryButtons', position: { x: 1, y: 2 } }],
  centered: false,
  dotted: false,
  grid: false,
  gridSize: 18,
  colorMode: 'auto',
}

vi.mock('./useCanvas.js', () => ({
  useCanvas: () => ({
    canvas: mockCanvas,
    jsxExports: {
      PrimaryButtons: () => <div data-testid="jsx-widget-content">jsx widget</div>,
    },
    loading: false,
  }),
}))

vi.mock('./widgets/index.js', () => ({
  getWidgetComponent: () => function MockWidget() { return <div>mock widget</div> },
}))

vi.mock('./widgets/WidgetChrome.jsx', () => ({
  default: ({ children }) => <div data-testid="widget-chrome">{children}</div>,
}))

vi.mock('./widgets/widgetProps.js', () => ({
  schemas: {},
  getDefaults: () => ({}),
}))

vi.mock('./widgets/widgetConfig.js', async () => {
  const actual = await vi.importActual('./widgets/widgetConfig.js')
  return {
    getFeatures: () => [],
    isResizable: () => false,
    isExpandable: () => false,
    getAnchorState: () => ({}),
    canAcceptConnection: () => false,
    isSplitScreenCapable: () => false,
    getChromeOptions: () => ({ enabled: true }),
    getInteractionOptions: () => ({ selectable: true, movable: true, resize: null, expandable: false, splitScreen: false, interactGate: false, interactGateLabel: 'Click to interact' }),
    isMovable: () => false,
    isEditableInProduction: () => false,
    schemas: {},
    getMenuWidgetTypes: () => [],
    getConnectorDefaults: actual.getConnectorDefaults,
  }
})

vi.mock('./widgets/figmaUrl.js', () => ({
  isFigmaUrl: () => false,
  sanitizeFigmaUrl: (url) => url,
}))

vi.mock('./canvasApi.js', () => ({
  addWidget: vi.fn(),
  checkGitHubCliAvailable: vi.fn(),
  fetchGitHubEmbed: vi.fn(),
  updateCanvas: vi.fn(() => Promise.resolve({ success: true })),
  removeWidget: vi.fn(),
  uploadImage: vi.fn(),
}))

vi.mock('./useUndoRedo.js', () => ({
  default: () => ({
    snapshot: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    reset: vi.fn(),
    canUndo: false,
    canRedo: false,
  }),
}))

describe('CanvasPage canvas bridge', () => {
  function dispatchTextPaste(text) {
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: {
        getData: (type) => (type === 'text/plain' ? text : ''),
        items: [],
      },
    })
    document.dispatchEvent(event)
  }

  beforeEach(() => {
    delete window.__storyboardCanvasBridgeState
    vi.clearAllMocks()
    addWidget.mockResolvedValue({
      success: true,
      widget: { id: 'widget-link', type: 'link-preview', position: { x: 0, y: 0 }, props: {} },
    })
    checkGitHubCliAvailable.mockResolvedValue({ available: true })
    fetchGitHubEmbed.mockResolvedValue({ success: false })
  })

  it('publishes bridge state and responds to status requests', () => {
    const mountedHandler = vi.fn()
    const statusHandler = vi.fn()
    document.addEventListener('storyboard:canvas:mounted', mountedHandler)
    document.addEventListener('storyboard:canvas:status', statusHandler)

    const { unmount } = render(<CanvasPage canvasId="design-overview" />)

    expect(window.__storyboardCanvasBridgeState).toEqual({
      active: true,
      canvasId: 'design-overview',
      connectors: [],
      widgets: [{ id: 'widget-1', type: 'mock-widget', position: { x: 10, y: 20 }, props: {} }],
      zoom: 100,
    })
    expect(mountedHandler).toHaveBeenCalled()

    document.dispatchEvent(new CustomEvent('storyboard:canvas:status-request'))
    expect(statusHandler).toHaveBeenCalled()
    expect(statusHandler.mock.calls.at(-1)?.[0]?.detail).toEqual({
      active: true,
      canvasId: 'design-overview',
      connectors: [],
      widgets: [{ id: 'widget-1', type: 'mock-widget', position: { x: 10, y: 20 }, props: {} }],
      zoom: 100,
    })

    unmount()

    document.removeEventListener('storyboard:canvas:mounted', mountedHandler)
    document.removeEventListener('storyboard:canvas:status', statusHandler)
  })

  it('marks bridge inactive on unmount', () => {
    const unmountedHandler = vi.fn()
    document.addEventListener('storyboard:canvas:unmounted', unmountedHandler)

    const { unmount } = render(<CanvasPage canvasId="design-overview" />)
    unmount()

    expect(unmountedHandler).toHaveBeenCalled()
    expect(window.__storyboardCanvasBridgeState).toEqual({
      active: false,
      canvasId: '',
      zoom: 100,
    })

    document.removeEventListener('storyboard:canvas:unmounted', unmountedHandler)
  })

  it('shows gh install banner when gh is unavailable during GitHub URL paste', async () => {
    checkGitHubCliAvailable.mockResolvedValue({
      available: false,
      installUrl: 'https://github.com/cli/cli',
    })

    render(<CanvasPage name="design-overview" />)

    await act(async () => {
      dispatchTextPaste('https://github.com/dfosco/storyboard/issues/42')
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(addWidget).toHaveBeenCalled()
    })
    expect(fetchGitHubEmbed).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: 'Install GitHub CLI' })).toHaveAttribute(
      'href',
      'https://github.com/cli/cli',
    )
  })

  it('hydrates GitHub metadata when gh is available during paste', async () => {
    checkGitHubCliAvailable.mockResolvedValue({ available: true })
    fetchGitHubEmbed.mockResolvedValue({
      success: true,
      snapshot: {
        kind: 'issue',
        parentKind: 'issue',
        context: 'GitHub · dfosco/storyboard · Issue #42',
        title: '#42 Ship GitHub embeds',
        body: 'Details from GitHub',
        authors: ['dfosco'],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
      },
    })

    render(<CanvasPage name="design-overview" />)

    await act(async () => {
      dispatchTextPaste('https://github.com/dfosco/storyboard/issues/42')
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(fetchGitHubEmbed).toHaveBeenCalledWith('https://github.com/dfosco/storyboard/issues/42')
    })
    expect(addWidget).toHaveBeenCalledWith(
      'design-overview',
      expect.objectContaining({
        type: 'link-preview',
        props: expect.objectContaining({
          title: '#42 Ship GitHub embeds',
          width: 580,
          height: 400,
          github: expect.objectContaining({
            context: 'GitHub · dfosco/storyboard · Issue #42',
            body: 'Details from GitHub',
          }),
        }),
      }),
    )
  })

  it('pastes a localhost URL as a Site Frame and preserves the upstream path', async () => {
    vi.stubGlobal('fetch', vi.fn(async url => {
      if (String(url).includes('/_storyboard/site/list')) return {
        ok: true,
        json: async () => ({ sites: [{ id: 'docs', title: 'Docs', binding: { developmentBaseUrl: 'http://localhost:5173/' } }] }),
      }
      throw new Error(`Unexpected request: ${url}`)
    }))
    render(<CanvasPage canvasId="design-overview" />)

    await act(async () => {
      dispatchTextPaste('http://localhost:5173/docs/guide?mode=full#intro')
      await Promise.resolve()
    })

    await waitFor(() => expect(addWidget).toHaveBeenCalledWith('design-overview', expect.objectContaining({
      type: 'site-frame',
      props: { siteId: 'docs', route: 'docs/guide?mode=full#intro', title: 'Docs', width: 800, height: 600 },
    })))
  })

  it('pastes a registered Site base URL as a Site Frame instead of opening Site creation', async () => {
    const openCreate = vi.fn()
    document.addEventListener('storyboard:open-site-create', openCreate)
    vi.stubGlobal('fetch', vi.fn(async url => {
      if (String(url).includes('/_storyboard/site/list')) return {
        ok: true,
        json: async () => ({ sites: [{ id: 'docs', title: 'Docs', binding: { developmentBaseUrl: 'http://localhost:5173/' } }] }),
      }
      throw new Error(`Unexpected request: ${url}`)
    }))
    render(<CanvasPage canvasId="design-overview" />)

    await act(async () => {
      dispatchTextPaste('http://localhost:5173/?from=copy#top')
      await Promise.resolve()
    })

    await waitFor(() => expect(addWidget).toHaveBeenCalledWith('design-overview', expect.objectContaining({
      type: 'site-frame',
      props: { siteId: 'docs', route: '?from=copy#top', title: 'Docs', width: 800, height: 600 },
    })))
    expect(openCreate).not.toHaveBeenCalled()
    document.removeEventListener('storyboard:open-site-create', openCreate)
  })

  it('resolves a nested viewer URL to its Site route rather than the viewer path', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ sites: [
        { id: 'docs', title: 'Docs', binding: { developmentBaseUrl: 'http://localhost:5173/' } },
        { id: 'other', title: 'Other', binding: { developmentBaseUrl: 'http://localhost:4321/' } },
      ] }),
    })))
    render(<CanvasPage canvasId="design-overview" />)

    await act(async () => {
      dispatchTextPaste(`${window.location.origin}/sites/other/guide/chapter?mode=full#intro`)
      await Promise.resolve()
    })

    await waitFor(() => expect(addWidget).toHaveBeenCalledWith('design-overview', expect.objectContaining({
      type: 'site-frame',
      props: { siteId: 'other', route: 'guide/chapter?mode=full#intro', title: 'Other', width: 800, height: 600 },
    })))
  })

  it('opens a prefilled Site creation form for an unmatched localhost Site URL', async () => {
    const openCreate = vi.fn()
    document.addEventListener('storyboard:open-site-create', openCreate)
    vi.stubGlobal('fetch', vi.fn(async url => {
      if (String(url).includes('/_storyboard/site/list')) return { ok: true, json: async () => ({ sites: [] }) }
      throw new Error(`Unexpected request: ${url}`)
    }))
    render(<CanvasPage canvasId="design-overview" />)

    await act(async () => {
      dispatchTextPaste('http://localhost:5173/new-docs/guide?lang=en')
      await Promise.resolve()
    })

    await waitFor(() => expect(openCreate).toHaveBeenCalledWith(expect.objectContaining({
      detail: { title: 'New Docs', developmentBaseUrl: 'http://localhost:5173/', route: 'new-docs/guide?lang=en' },
    })))
    expect(addWidget).not.toHaveBeenCalled()
    document.removeEventListener('storyboard:open-site-create', openCreate)
  })

  it.skip('persists dragged JSON widgets and JSX sources to canvas JSONL via update API', async () => {
    render(<CanvasPage canvasId="design-overview" />)

    fireEvent.click(screen.getByTestId('drag-widget'))
    // Flush the promise-based write queue
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(updateCanvas).toHaveBeenCalledWith(
      'design-overview',
      expect.objectContaining({
        widgets: expect.arrayContaining([
          expect.objectContaining({
            id: 'widget-1',
            position: { x: 111, y: 223 },
          }),
        ]),
      })
    )

    fireEvent.click(screen.getByTestId('drag-source'))
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(updateCanvas).toHaveBeenCalledWith(
      'design-overview',
      expect.objectContaining({
        sources: expect.arrayContaining([
          expect.objectContaining({
            export: 'PrimaryButtons',
            position: { x: 333, y: 445 },
          }),
        ]),
      })
    )
  })

  it.skip('clamps negative drag positions to zero', async () => {
    render(<CanvasPage canvasId="design-overview" />)

    fireEvent.click(screen.getByTestId('drag-widget-negative'))
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(updateCanvas).toHaveBeenCalledWith(
      'design-overview',
      expect.objectContaining({
        widgets: expect.arrayContaining([
          expect.objectContaining({
            id: 'widget-1',
            position: { x: 0, y: 0 },
          }),
        ]),
      })
    )
  })
})

describe('getCanvasThemeVars', () => {
  it('is a no-op shim — canvas color tokens now cascade via data-sb-canvas-theme + tailwind.css', () => {
    expect(getCanvasThemeVars('light')).toEqual({})
    expect(getCanvasThemeVars('dark')).toEqual({})
    expect(getCanvasThemeVars('dark_dimmed')).toEqual({})
    expect(getCanvasThemeVars('dark_high_contrast')).toEqual({})
    expect(getCanvasThemeVars('dark_colorblind')).toEqual({})
    expect(getCanvasThemeVars('light_colorblind')).toEqual({})
    expect(getCanvasThemeVars('unknown')).toEqual({})
  })
})

describe('getCanvasPrimerAttrs', () => {
  it('maps canvas theme to local Primer mode attrs', () => {
    expect(getCanvasPrimerAttrs('light')).toEqual({
      'data-color-mode': 'light',
      'data-dark-theme': 'dark',
      'data-light-theme': 'light',
    })
    expect(getCanvasPrimerAttrs('light_colorblind')).toEqual({
      'data-color-mode': 'light',
      'data-dark-theme': 'dark',
      'data-light-theme': 'light_colorblind',
    })
    expect(getCanvasPrimerAttrs('dark')).toEqual({
      'data-color-mode': 'dark',
      'data-dark-theme': 'dark',
      'data-light-theme': 'light',
    })
    expect(getCanvasPrimerAttrs('dark_dimmed')).toEqual({
      'data-color-mode': 'dark',
      'data-dark-theme': 'dark_dimmed',
      'data-light-theme': 'light',
    })
    expect(getCanvasPrimerAttrs('dark_high_contrast')).toEqual({
      'data-color-mode': 'dark',
      'data-dark-theme': 'dark_high_contrast',
      'data-light-theme': 'light',
    })
    expect(getCanvasPrimerAttrs('dark_colorblind')).toEqual({
      'data-color-mode': 'dark',
      'data-dark-theme': 'dark_colorblind',
      'data-light-theme': 'light',
    })
  })
})

describe('canvas target fallback', () => {
  it('stays light when canvas target is unchecked even if stale canvas attribute is dark', () => {
    localStorage.setItem('sb-theme-sync', JSON.stringify({
      prototype: true,
      toolbar: true,
      codeBoxes: true,
      canvas: false,
    }))
    localStorage.setItem('sb-color-scheme', 'dark')
    document.documentElement.setAttribute('data-sb-canvas-theme', 'dark')

    render(<CanvasPage canvasId="design-overview" />)

    const scroll = document.querySelector('[data-storyboard-canvas-scroll]')
    const jsxWidget = document.getElementById('jsx-PrimaryButtons')
    // Canvas color attribute should be light when canvas sync is off, even
    // if a stale dark attribute remains on the root — CanvasPage reapplies
    // the resolved theme attribute on its own scroll wrapper.
    expect(scroll?.getAttribute('data-color-mode')).toBe('light')
    expect(jsxWidget?.getAttribute('data-color-mode')).toBe('light')
  })
})
