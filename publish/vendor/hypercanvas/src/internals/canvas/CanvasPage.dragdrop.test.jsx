/**
 * Tests for canvas image drag-and-drop functionality.
 *
 * Tests the event handling for dropping images from Finder/file manager
 * onto the canvas, including coordinate conversion and file filtering.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import CanvasPage from './CanvasPage.jsx'
import { addWidget, uploadImage } from './canvasApi.js'

// Mock dependencies
vi.mock('../../canvas/index.js', () => ({
  Canvas: ({ children }) => <div data-testid="tiny-canvas">{children}</div>,
}))

const mockCanvas = {
  title: 'Drag Drop Test Canvas',
  widgets: [],
  sources: [],
  centered: false,
  dotted: false,
  grid: true,
  gridSize: 24,
  colorMode: 'auto',
}

vi.mock('./useCanvas.js', () => ({
  useCanvas: () => ({
    canvas: mockCanvas,
    jsxExports: {},
    loading: false,
  }),
}))

vi.mock('./widgets/index.js', () => ({
  getWidgetComponent: () => function MockWidget() {
    return <div>mock widget</div>
  },
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
  addWidget: vi.fn(() => Promise.resolve({ success: true, widget: { id: 'image-abc', type: 'image' } })),
  updateCanvas: vi.fn(() => Promise.resolve({ success: true })),
  removeWidget: vi.fn(),
  uploadImage: vi.fn(() => Promise.resolve({ success: true, filename: 'test-image.png' })),
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

// Helper to create a mock File
function createMockImageFile(name = 'test.png', type = 'image/png') {
  const blob = new Blob(['fake image data'], { type })
  return new File([blob], name, { type })
}

// Helper to create a DataTransfer-like object
function createDataTransfer(files, types = ['Files']) {
  return {
    files,
    types,
    dropEffect: 'none',
  }
}

describe('CanvasPage image drag-and-drop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Mock FileReader for blobToDataUrl
    global.FileReader = class {
      readAsDataURL() {
        setTimeout(() => {
          this.result = 'data:image/png;base64,fakedata'
          this.onload?.()
        }, 0)
      }
    }
    // Mock Image for getImageDimensions
    global.Image = class {
      set src(val) {
        setTimeout(() => {
          this.naturalWidth = 800
          this.naturalHeight = 600
          this.onload?.()
        }, 0)
      }
    }
  })

  afterEach(() => {
    delete global.FileReader
    delete global.Image
  })

  it('allows drop by preventing default on dragover with Files', () => {
    render(<CanvasPage canvasId="test-canvas" />)
    const scrollContainer = document.querySelector('[data-storyboard-canvas-scroll]')

    const dragOverEvent = new Event('dragover', { bubbles: true, cancelable: true })
    dragOverEvent.dataTransfer = createDataTransfer([], ['Files'])
    dragOverEvent.preventDefault = vi.fn()

    scrollContainer.dispatchEvent(dragOverEvent)

    expect(dragOverEvent.preventDefault).toHaveBeenCalled()
    expect(dragOverEvent.dataTransfer.dropEffect).toBe('copy')
  })

  it('ignores dragover without Files type (internal widget drag)', () => {
    render(<CanvasPage canvasId="test-canvas" />)
    const scrollContainer = document.querySelector('[data-storyboard-canvas-scroll]')

    const dragOverEvent = new Event('dragover', { bubbles: true, cancelable: true })
    dragOverEvent.dataTransfer = createDataTransfer([], ['text/plain'])
    dragOverEvent.preventDefault = vi.fn()

    scrollContainer.dispatchEvent(dragOverEvent)

    expect(dragOverEvent.preventDefault).not.toHaveBeenCalled()
  })

  it('uploads image and creates widget on drop', async () => {
    render(<CanvasPage canvasId="test-canvas" />)
    const scrollContainer = document.querySelector('[data-storyboard-canvas-scroll]')

    const imageFile = createMockImageFile('photo.png', 'image/png')
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
    dropEvent.dataTransfer = createDataTransfer([imageFile], ['Files'])
    dropEvent.clientX = 200
    dropEvent.clientY = 150
    dropEvent.preventDefault = vi.fn()
    dropEvent.stopPropagation = vi.fn()

    // Mock getBoundingClientRect for coordinate calculation
    scrollContainer.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 1000,
      height: 800,
    })
    scrollContainer.scrollLeft = 0
    scrollContainer.scrollTop = 0

    await act(async () => {
      scrollContainer.dispatchEvent(dropEvent)
      // Wait for async processing
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(dropEvent.preventDefault).toHaveBeenCalled()
    expect(uploadImage).toHaveBeenCalledWith(
      expect.stringContaining('data:image/png'),
      'test-canvas'
    )
    expect(addWidget).toHaveBeenCalledWith(
      'test-canvas',
      expect.objectContaining({
        type: 'image',
        props: expect.objectContaining({
          src: 'test-image.png',
          private: false,
        }),
        position: expect.objectContaining({
          x: expect.any(Number),
          y: expect.any(Number),
        }),
      })
    )
  })

  it('ignores non-image files but prevents browser default', async () => {
    render(<CanvasPage canvasId="test-canvas" />)
    const scrollContainer = document.querySelector('[data-storyboard-canvas-scroll]')

    const textFile = new File(['text content'], 'readme.txt', { type: 'text/plain' })
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
    dropEvent.dataTransfer = createDataTransfer([textFile], ['Files'])
    dropEvent.clientX = 200
    dropEvent.clientY = 150
    dropEvent.preventDefault = vi.fn()
    dropEvent.stopPropagation = vi.fn()

    scrollContainer.getBoundingClientRect = () => ({ left: 0, top: 0 })

    await act(async () => {
      scrollContainer.dispatchEvent(dropEvent)
      await new Promise((r) => setTimeout(r, 50))
    })

    // Should prevent default (stops browser from opening the file)
    expect(dropEvent.preventDefault).toHaveBeenCalled()
    // But should not call upload or add widget for non-image files
    expect(uploadImage).not.toHaveBeenCalled()
    expect(addWidget).not.toHaveBeenCalled()
  })

  it('processes multiple image files on drop', async () => {
    render(<CanvasPage canvasId="test-canvas" />)
    const scrollContainer = document.querySelector('[data-storyboard-canvas-scroll]')

    const image1 = createMockImageFile('photo1.png', 'image/png')
    const image2 = createMockImageFile('photo2.jpg', 'image/jpeg')
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
    dropEvent.dataTransfer = createDataTransfer([image1, image2], ['Files'])
    dropEvent.clientX = 100
    dropEvent.clientY = 100
    dropEvent.preventDefault = vi.fn()
    dropEvent.stopPropagation = vi.fn()

    scrollContainer.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 800 })
    scrollContainer.scrollLeft = 0
    scrollContainer.scrollTop = 0

    await act(async () => {
      scrollContainer.dispatchEvent(dropEvent)
      // Wait longer for multiple async operations
      await new Promise((r) => setTimeout(r, 150))
    })

    // Should call upload for each image
    expect(uploadImage).toHaveBeenCalledTimes(2)
    expect(addWidget).toHaveBeenCalledTimes(2)
  })

  it('ignores drop without Files type', async () => {
    render(<CanvasPage canvasId="test-canvas" />)
    const scrollContainer = document.querySelector('[data-storyboard-canvas-scroll]')

    const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
    dropEvent.dataTransfer = createDataTransfer([], ['text/html'])
    dropEvent.preventDefault = vi.fn()

    await act(async () => {
      scrollContainer.dispatchEvent(dropEvent)
    })

    expect(dropEvent.preventDefault).not.toHaveBeenCalled()
    expect(uploadImage).not.toHaveBeenCalled()
  })

  it('snaps drop position to grid when snap is enabled', async () => {
    // Enable snap in mock data
    const originalSnapToGrid = mockCanvas.snapToGrid
    mockCanvas.snapToGrid = true

    render(<CanvasPage canvasId="test-canvas" />)
    const scrollContainer = document.querySelector('[data-storyboard-canvas-scroll]')

    const imageFile = createMockImageFile()
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
    dropEvent.dataTransfer = createDataTransfer([imageFile], ['Files'])
    // Position that should snap: 137 → 144 (gridSize 24: round(137/24)*24 = 144)
    dropEvent.clientX = 137
    dropEvent.clientY = 85 // 85 → 96

    dropEvent.preventDefault = vi.fn()
    dropEvent.stopPropagation = vi.fn()

    scrollContainer.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 800 })
    scrollContainer.scrollLeft = 0
    scrollContainer.scrollTop = 0

    await act(async () => {
      scrollContainer.dispatchEvent(dropEvent)
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(addWidget).toHaveBeenCalledWith(
      'test-canvas',
      expect.objectContaining({
        position: { x: 144, y: 96 },
      })
    )

    // Restore
    mockCanvas.snapToGrid = originalSnapToGrid
  })

  it('does not snap drop position when snap is disabled', async () => {
    // Ensure snap is disabled (default from mock)
    const originalSnapToGrid = mockCanvas.snapToGrid
    mockCanvas.snapToGrid = false

    render(<CanvasPage canvasId="test-canvas" />)
    const scrollContainer = document.querySelector('[data-storyboard-canvas-scroll]')

    const imageFile = createMockImageFile()
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
    dropEvent.dataTransfer = createDataTransfer([imageFile], ['Files'])
    // Position should round to nearest integer, not snap to grid
    dropEvent.clientX = 137
    dropEvent.clientY = 85

    dropEvent.preventDefault = vi.fn()
    dropEvent.stopPropagation = vi.fn()

    scrollContainer.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 800 })
    scrollContainer.scrollLeft = 0
    scrollContainer.scrollTop = 0

    await act(async () => {
      scrollContainer.dispatchEvent(dropEvent)
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(addWidget).toHaveBeenCalledWith(
      'test-canvas',
      expect.objectContaining({
        position: { x: 137, y: 85 }, // No snapping, just rounded integers
      })
    )

    // Restore
    mockCanvas.snapToGrid = originalSnapToGrid
  })

  // ── VSCode-style drops: text/uri-list only, no File bytes ──────────────────
  describe('text/uri-list (VSCode Explorer)', () => {
    let fetchSpy

    beforeEach(() => {
      fetchSpy = vi.fn()
      global.fetch = fetchSpy
    })
    afterEach(() => {
      delete global.fetch
    })

    function createUriListTransfer(uriListText, codeUriListText = uriListText) {
      const map = {
        'text/uri-list': uriListText,
        'application/vnd.code.uri-list': codeUriListText,
      }
      return {
        files: [],
        types: ['text/uri-list', 'application/vnd.code.uri-list'],
        dropEffect: 'none',
        getData: (mime) => map[mime] || '',
      }
    }

    it('preventDefault on dragover with text/uri-list (avoids about:blank#blocked)', () => {
      render(<CanvasPage canvasId="test-canvas" />)
      const scrollContainer = document.querySelector('[data-storyboard-canvas-scroll]')

      const dragOverEvent = new Event('dragover', { bubbles: true, cancelable: true })
      dragOverEvent.dataTransfer = createUriListTransfer('file:///tmp/foo.md')
      dragOverEvent.preventDefault = vi.fn()

      scrollContainer.dispatchEvent(dragOverEvent)

      expect(dragOverEvent.preventDefault).toHaveBeenCalled()
      expect(dragOverEvent.dataTransfer.dropEffect).toBe('copy')
    })

    it('POSTs absolute paths to /file/resolve and creates a file widget', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{ ok: true, kind: 'file', path: 'src/hello.md' }],
        }),
      })

      render(<CanvasPage canvasId="test-canvas" />)
      const scrollContainer = document.querySelector('[data-storyboard-canvas-scroll]')

      const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
      dropEvent.dataTransfer = createUriListTransfer('file:///Users/me/repo/src/hello.md')
      dropEvent.clientX = 100
      dropEvent.clientY = 100
      dropEvent.preventDefault = vi.fn()
      dropEvent.stopPropagation = vi.fn()
      scrollContainer.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 800 })
      scrollContainer.scrollLeft = 0
      scrollContainer.scrollTop = 0

      await act(async () => {
        scrollContainer.dispatchEvent(dropEvent)
        await new Promise((r) => setTimeout(r, 50))
      })

      expect(dropEvent.preventDefault).toHaveBeenCalled()
      const resolveCall = fetchSpy.mock.calls.find(([url]) => url.includes('/_storyboard/file/resolve'))
      expect(resolveCall).toBeTruthy()
      expect(JSON.parse(resolveCall[1].body)).toEqual({
        paths: ['/Users/me/repo/src/hello.md'],
      })
      expect(addWidget).toHaveBeenCalledWith(
        'test-canvas',
        expect.objectContaining({
          type: 'file',
          props: { path: 'src/hello.md' },
        }),
      )
      expect(uploadImage).not.toHaveBeenCalled()
    })

    it('creates an image widget when /file/resolve returns kind:image', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{ ok: true, kind: 'image', src: 'photo.png' }],
        }),
      })

      render(<CanvasPage canvasId="test-canvas" />)
      const scrollContainer = document.querySelector('[data-storyboard-canvas-scroll]')

      const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
      dropEvent.dataTransfer = createUriListTransfer('file:///Users/me/repo/src/photo.png')
      dropEvent.clientX = 100
      dropEvent.clientY = 100
      dropEvent.preventDefault = vi.fn()
      dropEvent.stopPropagation = vi.fn()
      scrollContainer.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 800 })
      scrollContainer.scrollLeft = 0
      scrollContainer.scrollTop = 0

      await act(async () => {
        scrollContainer.dispatchEvent(dropEvent)
        await new Promise((r) => setTimeout(r, 50))
      })

      expect(addWidget).toHaveBeenCalledWith(
        'test-canvas',
        expect.objectContaining({
          type: 'image',
          props: expect.objectContaining({ src: 'photo.png', private: false }),
        }),
      )
      // Image bytes are already on disk — no re-upload via /image API
      expect(uploadImage).not.toHaveBeenCalled()
    })

    it('skips results with ok:false (e.g. outside_repo) without crashing', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            { ok: false, reason: 'outside_repo', absPath: '/etc/passwd' },
            { ok: true, kind: 'file', path: 'src/ok.md' },
          ],
        }),
      })

      render(<CanvasPage canvasId="test-canvas" />)
      const scrollContainer = document.querySelector('[data-storyboard-canvas-scroll]')

      const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
      dropEvent.dataTransfer = createUriListTransfer(
        'file:///etc/passwd\nfile:///Users/me/repo/src/ok.md',
      )
      dropEvent.clientX = 100
      dropEvent.clientY = 100
      dropEvent.preventDefault = vi.fn()
      dropEvent.stopPropagation = vi.fn()
      scrollContainer.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 800 })
      scrollContainer.scrollLeft = 0
      scrollContainer.scrollTop = 0

      await act(async () => {
        scrollContainer.dispatchEvent(dropEvent)
        await new Promise((r) => setTimeout(r, 50))
      })

      // Only the ok result becomes a widget
      expect(addWidget).toHaveBeenCalledTimes(1)
      expect(addWidget).toHaveBeenCalledWith(
        'test-canvas',
        expect.objectContaining({ type: 'file', props: { path: 'src/ok.md' } }),
      )
    })

    it('ignores comment lines and non-file:// URIs in text/uri-list', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{ ok: true, kind: 'file', path: 'a.md' }] }),
      })

      render(<CanvasPage canvasId="test-canvas" />)
      const scrollContainer = document.querySelector('[data-storyboard-canvas-scroll]')

      const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
      dropEvent.dataTransfer = createUriListTransfer(
        '# this is a comment\nhttps://example.com/foo\nfile:///Users/me/repo/a.md\n',
      )
      dropEvent.clientX = 50
      dropEvent.clientY = 50
      dropEvent.preventDefault = vi.fn()
      dropEvent.stopPropagation = vi.fn()
      scrollContainer.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 800 })
      scrollContainer.scrollLeft = 0
      scrollContainer.scrollTop = 0

      await act(async () => {
        scrollContainer.dispatchEvent(dropEvent)
        await new Promise((r) => setTimeout(r, 50))
      })

      const resolveCall = fetchSpy.mock.calls.find(([url]) => url.includes('/_storyboard/file/resolve'))
      expect(JSON.parse(resolveCall[1].body)).toEqual({
        paths: ['/Users/me/repo/a.md'],
      })
    })
  })
})
