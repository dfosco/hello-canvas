import { fireEvent, render, screen, act } from '@testing-library/react'
import CanvasPage from './CanvasPage.jsx'
import { updateCanvas, removeWidget, batchOperations } from './canvasApi.js'

const MOCK_UNDO_REDO = {
  track: vi.fn(),
  trackMany: vi.fn(),
  popUndo: vi.fn(),
  popRedo: vi.fn(),
  pushRedo: vi.fn(),
  pushUndo: vi.fn(),
  reset: vi.fn(),
  canUndo: false,
  canRedo: false,
}

vi.mock('./useUndoRedo.js', () => ({
  default: () => MOCK_UNDO_REDO,
}))

// Expose drag callbacks so tests can trigger drags with specific IDs
let capturedOnDragStart = null
let capturedOnDrag = null
let capturedOnDragEnd = null
vi.mock('../../canvas/index.js', () => ({
  Canvas: ({ children, onDragStart, onDrag, onDragEnd }) => {
    capturedOnDragStart = onDragStart
    capturedOnDrag = onDrag
    capturedOnDragEnd = onDragEnd
    return <div data-testid="tiny-canvas">{children}</div>
  },
}))

const mockCanvas = {
  title: 'Multi-Select Test',
  widgets: [
    { id: 'w1', type: 'sticky-note', position: { x: 100, y: 100 }, props: {} },
    { id: 'w2', type: 'sticky-note', position: { x: 300, y: 100 }, props: {} },
    { id: 'w3', type: 'markdown', position: { x: 500, y: 200 }, props: {} },
  ],
  sources: [],
  centered: false,
  dotted: false,
  grid: false,
  gridSize: 18,
  colorMode: 'auto',
}

vi.mock('./useCanvas.js', () => ({
  useCanvas: () => ({
    canvas: mockCanvas,
    jsxExports: null,
    loading: false,
  }),
}))

vi.mock('./widgets/index.js', () => ({
  getWidgetComponent: () => function MockWidget({ id }) {
    return <div data-testid={`widget-content-${id}`}>widget</div>
  },
}))

// WidgetChrome mock that exposes onSelect with shift parameter
vi.mock('./widgets/WidgetChrome.jsx', () => ({
  default: ({ children, onSelect, selected, multiSelected, widgetId }) => (
    <div
      data-testid={`chrome-${widgetId}`}
      data-selected={selected || undefined}
      data-multi-selected={multiSelected || undefined}
    >
      {children}
      <button
        className="tc-drag-handle"
        data-testid={`select-${widgetId}`}
        onClick={(e) => { e.stopPropagation(); onSelect?.(false) }}
      >
        select
      </button>
      <button
        className="tc-drag-handle"
        data-testid={`shift-select-${widgetId}`}
        onClick={(e) => { e.stopPropagation(); onSelect?.(true) }}
      >
        shift-select
      </button>
    </div>
  ),
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
    isSplitScreenCapable: () => false,
    getInteractGate: () => ({ enabled: false, label: 'Click to interact' }),
    getChromeOptions: () => ({ enabled: true }),
    getInteractionOptions: () => ({ selectable: true, movable: true, resize: null, expandable: false, splitScreen: false, interactGate: false, interactGateLabel: 'Click to interact' }),
    isMovable: () => false,
    isEditableInProduction: () => false,
    getWidgetMeta: () => null,
    getConnectorConfig: actual.getConnectorConfig,
    getAnchorState: actual.getAnchorState,
    canAcceptConnection: () => true,
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
  checkGitHubCliAvailable: vi.fn(() => Promise.resolve({ available: true })),
  fetchGitHubEmbed: vi.fn(() => Promise.resolve({ success: false })),
  updateCanvas: vi.fn(() => Promise.resolve({ success: true })),
  patchWidget: vi.fn(() => Promise.resolve({ success: true, eventIds: ['evt_patch'] })),
  removeWidget: vi.fn(() => Promise.resolve({ success: true, eventId: 'evt_remove' })),
  undoEvent: vi.fn(() => Promise.resolve({ status: 200, ok: true, data: { success: true, eventId: 'evt_undo' } })),
  redoEvent: vi.fn(() => Promise.resolve({ status: 200, ok: true, data: { success: true, eventId: 'evt_redo' } })),
  uploadImage: vi.fn(),
  batchOperations: vi.fn(() => Promise.resolve({
    success: true,
    results: [
      { op: 'move-widget', widgetId: 'w1', eventId: 'evt_move_w1' },
      { op: 'move-widget', widgetId: 'w2', eventId: 'evt_move_w2' },
      { op: 'move-widget', widgetId: 'w3', eventId: 'evt_move_w3' },
    ],
  })),
}))

describe('CanvasPage multi-select', () => {
  beforeEach(() => {
    delete window.__storyboardCanvasBridgeState
    window.__SB_LOCAL_DEV__ = true
    vi.clearAllMocks()
    capturedOnDragStart = null
    capturedOnDrag = null
    capturedOnDragEnd = null
  })

  afterEach(() => {
    delete window.__SB_LOCAL_DEV__
  })

  it('shift+click on select handle adds widget to selection', async () => {
    render(<CanvasPage canvasId="test-canvas" />)

    // Select first widget
    fireEvent.click(screen.getByTestId('select-w1'))
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(screen.getByTestId('chrome-w1').dataset.selected).toBeDefined()

    // Shift+select second widget
    fireEvent.click(screen.getByTestId('shift-select-w2'))
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(screen.getByTestId('chrome-w1').dataset.selected).toBeDefined()
    expect(screen.getByTestId('chrome-w2').dataset.selected).toBeDefined()
  })

  it('shift+click on already selected widget removes it from selection', async () => {
    render(<CanvasPage canvasId="test-canvas" />)

    // Select both
    fireEvent.click(screen.getByTestId('select-w1'))
    fireEvent.click(screen.getByTestId('shift-select-w2'))
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(screen.getByTestId('chrome-w1').dataset.selected).toBeDefined()
    expect(screen.getByTestId('chrome-w2').dataset.selected).toBeDefined()

    // Shift+click w1 again to remove it
    fireEvent.click(screen.getByTestId('shift-select-w1'))
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(screen.getByTestId('chrome-w1').dataset.selected).toBeUndefined()
    expect(screen.getByTestId('chrome-w2').dataset.selected).toBeDefined()
  })

  it('normal click replaces multi-selection with single', async () => {
    render(<CanvasPage canvasId="test-canvas" />)

    // Multi-select
    fireEvent.click(screen.getByTestId('select-w1'))
    fireEvent.click(screen.getByTestId('shift-select-w2'))
    fireEvent.click(screen.getByTestId('shift-select-w3'))
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })

    // Normal click on w1 clears multi-select
    fireEvent.click(screen.getByTestId('select-w1'))
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(screen.getByTestId('chrome-w1').dataset.selected).toBeDefined()
    expect(screen.getByTestId('chrome-w2').dataset.selected).toBeUndefined()
    expect(screen.getByTestId('chrome-w3').dataset.selected).toBeUndefined()
  })

  it('sets multiSelected on all selected widgets when multiple are selected', async () => {
    render(<CanvasPage canvasId="test-canvas" />)

    fireEvent.click(screen.getByTestId('select-w1'))
    fireEvent.click(screen.getByTestId('shift-select-w2'))
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })

    expect(screen.getByTestId('chrome-w1').dataset.multiSelected).toBeDefined()
    expect(screen.getByTestId('chrome-w2').dataset.multiSelected).toBeDefined()
    // Unselected widget should not have multiSelected
    expect(screen.getByTestId('chrome-w3').dataset.multiSelected).toBeUndefined()
  })

  it('Escape clears all selection', async () => {
    render(<CanvasPage canvasId="test-canvas" />)

    fireEvent.click(screen.getByTestId('select-w1'))
    fireEvent.click(screen.getByTestId('shift-select-w2'))
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })

    fireEvent.keyDown(document, { key: 'Escape' })
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })

    expect(screen.getByTestId('chrome-w1').dataset.selected).toBeUndefined()
    expect(screen.getByTestId('chrome-w2').dataset.selected).toBeUndefined()
  })

  it('Delete removes all selected widgets and calls updateCanvas', async () => {
    render(<CanvasPage canvasId="test-canvas" />)

    // Multi-select w1 and w2
    fireEvent.click(screen.getByTestId('select-w1'))
    fireEvent.click(screen.getByTestId('shift-select-w2'))
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })

    // Press Delete
    fireEvent.keyDown(document, { key: 'Delete' })
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })

    // Multi-delete now uses individual removeWidget calls (one per selected
    // widget) instead of widgets_replaced — keeps server's wipe guard happy
    // and orphans terminal sessions per widget.
    expect(removeWidget).toHaveBeenCalledWith('test-canvas', 'w1')
    expect(removeWidget).toHaveBeenCalledWith('test-canvas', 'w2')
    expect(removeWidget).toHaveBeenCalledTimes(2)
    // updateCanvas (widgets_replaced) is NOT used for multi-delete
    expect(updateCanvas).not.toHaveBeenCalled()
    // Each remove call's eventId is tracked for undo
    expect(MOCK_UNDO_REDO.track).toHaveBeenCalledWith('evt_remove')
  })

  it('single-select Delete uses removeWidget API', async () => {
    render(<CanvasPage canvasId="test-canvas" />)

    fireEvent.click(screen.getByTestId('select-w1'))
    fireEvent.keyDown(document, { key: 'Backspace' })
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })

    expect(removeWidget).toHaveBeenCalledWith('test-canvas', 'w1')
  })

  it('multi-select move applies delta to all selected widgets', async () => {
    render(<CanvasPage canvasId="test-canvas" />)

    // Multi-select w1 (100,100) and w2 (300,100)
    fireEvent.click(screen.getByTestId('select-w1'))
    fireEvent.click(screen.getByTestId('shift-select-w2'))

    // Wait for selectedIdsRef to sync
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })

    // Drag w1 to (150, 200) → delta is (+50, +100)
    expect(capturedOnDragEnd).toBeTruthy()
    act(() => {
      capturedOnDragEnd('w1', { x: 150, y: 200 })
    })
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })

    // w1 → (150, 200), w2 → (300+50, 100+100) = (350, 200).
    // Multi-move is now persisted as a batch of widget_moved ops instead of
    // a widgets_replaced bomb — fixes the rollback class of bugs.
    expect(batchOperations).toHaveBeenCalledWith(
      'test-canvas',
      expect.arrayContaining([
        expect.objectContaining({ op: 'move-widget', widgetId: 'w1', position: { x: 150, y: 200 } }),
        expect.objectContaining({ op: 'move-widget', widgetId: 'w2', position: { x: 350, y: 200 } }),
      ])
    )
    expect(updateCanvas).not.toHaveBeenCalled()
  })

  it('multi-select drag captures peer articles on drag start', async () => {
    render(<CanvasPage canvasId="test-canvas" />)

    // Multi-select w1 and w2
    fireEvent.click(screen.getByTestId('select-w1'))
    fireEvent.click(screen.getByTestId('shift-select-w2'))
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })

    // All drag callbacks should be captured
    expect(capturedOnDragStart).toBeTruthy()
    expect(capturedOnDrag).toBeTruthy()

    // Trigger drag start — should not throw
    act(() => {
      capturedOnDragStart('w1', { x: 100, y: 100 })
    })

    // Drag tick — peers stay put (no live preview), should not throw
    act(() => {
      capturedOnDrag('w1', { x: 150, y: 200 })
    })
  })

  it('multi-select drag preserves selection after drag end', async () => {
    render(<CanvasPage canvasId="test-canvas" />)

    // Multi-select w1 and w2
    fireEvent.click(screen.getByTestId('select-w1'))
    fireEvent.click(screen.getByTestId('shift-select-w2'))
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })

    expect(screen.getByTestId('chrome-w1').dataset.selected).toBeDefined()
    expect(screen.getByTestId('chrome-w2').dataset.selected).toBeDefined()

    // Simulate full drag: start → drag → end
    act(() => {
      capturedOnDragStart('w1', { x: 100, y: 100 })
    })
    act(() => {
      capturedOnDragEnd('w1', { x: 150, y: 200 })
    })
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })

    // Selection should still include both widgets (justDraggedRef prevents collapse)
    expect(screen.getByTestId('chrome-w1').dataset.selected).toBeDefined()
    expect(screen.getByTestId('chrome-w2').dataset.selected).toBeDefined()
  })

  it('any selected widget can serve as drag handler for the group', async () => {
    render(<CanvasPage canvasId="test-canvas" />)

    // Multi-select w1 (100,100), w2 (300,100), w3 (500,200)
    fireEvent.click(screen.getByTestId('select-w1'))
    fireEvent.click(screen.getByTestId('shift-select-w2'))
    fireEvent.click(screen.getByTestId('shift-select-w3'))
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })

    // Drag w2 (the middle one) to (350, 150) → delta (+50, +50)
    act(() => {
      capturedOnDragStart('w2', { x: 300, y: 100 })
    })
    act(() => {
      capturedOnDragEnd('w2', { x: 350, y: 150 })
    })
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })

    // All selected widgets should move by the same delta (+50, +50) via the
    // batch endpoint.
    expect(batchOperations).toHaveBeenCalledWith(
      'test-canvas',
      expect.arrayContaining([
        expect.objectContaining({ op: 'move-widget', widgetId: 'w1', position: { x: 150, y: 150 } }),
        expect.objectContaining({ op: 'move-widget', widgetId: 'w2', position: { x: 350, y: 150 } }),
        expect.objectContaining({ op: 'move-widget', widgetId: 'w3', position: { x: 550, y: 250 } }),
      ])
    )
    expect(updateCanvas).not.toHaveBeenCalled()
  })
})
