import { vi } from 'vitest'

const { mockLoadFlow } = vi.hoisted(() => ({
  mockLoadFlow: vi.fn(() => ({ hello: 'world', count: 42 })),
}))

vi.mock('../data/loader.js', () => ({
  loadFlow: mockLoadFlow,
}))

// We need a fresh module for each test since sceneDebug has a module-level
// `stylesInjected` boolean. We test style injection on the very first call,
// then subsequent tests just verify other behavior.
import { mountFlowDebug, mountSceneDebug } from './sceneDebug.js'

afterEach(() => {
  document.body.innerHTML = ''
  mockLoadFlow.mockReset()
  mockLoadFlow.mockReturnValue({ hello: 'world', count: 42 })
})

describe('mountFlowDebug', () => {
  it('injects styles into document.head on first call', () => {
    // This MUST run first to capture the stylesInjected=false → true transition
    mountFlowDebug()

    const styles = document.head.querySelectorAll('style')
    const hasDebugStyle = Array.from(styles).some((el) =>
      el.textContent.includes('.sb-scene-debug')
    )
    expect(hasDebugStyle).toBe(true)
  })

  it('creates an element with class sb-scene-debug', () => {
    const el = mountFlowDebug()

    expect(el.classList.contains('sb-scene-debug')).toBe(true)
  })

  it('appends to document.body by default', () => {
    mountFlowDebug()

    expect(document.body.querySelector('.sb-scene-debug')).toBeInTheDocument()
  })

  it('appends to a custom container', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    mountFlowDebug(container)

    expect(container.querySelector('.sb-scene-debug')).not.toBeNull()
  })

  it('returns the created element', () => {
    const el = mountFlowDebug()

    expect(el).toBeInstanceOf(HTMLElement)
    expect(el.className).toBe('sb-scene-debug')
  })

  it('renders the flow name in the title', () => {
    mountFlowDebug(undefined, 'my-flow')

    const title = document.body.querySelector('.sb-scene-debug-title')
    expect(title).not.toBeNull()
    expect(title.textContent).toContain('my-flow')
  })

  it('defaults flow name to "default" when none is provided', () => {
    mountFlowDebug()

    const title = document.body.querySelector('.sb-scene-debug-title')
    expect(title.textContent).toContain('default')
    expect(mockLoadFlow).toHaveBeenCalledWith('default')
  })

  it('renders JSON data in a pre element', () => {
    mountFlowDebug()

    const pre = document.body.querySelector('.sb-scene-debug-code')
    expect(pre).not.toBeNull()
    expect(pre.tagName).toBe('PRE')

    const parsed = JSON.parse(pre.textContent)
    expect(parsed).toEqual({ hello: 'world', count: 42 })
  })

  it('shows error when loadFlow throws', () => {
    mockLoadFlow.mockImplementation(() => {
      throw new Error('Flow not found')
    })

    const el = mountFlowDebug()

    const errorTitle = el.querySelector('.sb-scene-debug-error-title')
    expect(errorTitle).not.toBeNull()
    expect(errorTitle.textContent).toContain('Error')

    const errorMsg = el.querySelector('.sb-scene-debug-error-message')
    expect(errorMsg.textContent).toContain('Flow not found')

    // Should NOT render the normal title/pre
    expect(el.querySelector('.sb-scene-debug-title')).toBeNull()
    expect(el.querySelector('.sb-scene-debug-code')).toBeNull()
  })

  it('uses ?scene query param when no flowName argument is given', () => {
    window.history.pushState(null, '', '?scene=overview')

    mountFlowDebug()

    expect(mockLoadFlow).toHaveBeenCalledWith('overview')
    const title = document.body.querySelector('.sb-scene-debug-title')
    expect(title.textContent).toContain('overview')

    // Clean up
    window.history.pushState(null, '', '/')
  })

  it('allows multiple debug panels to be mounted', () => {
    mountFlowDebug()
    mountFlowDebug()

    const panels = document.body.querySelectorAll('.sb-scene-debug')
    expect(panels).toHaveLength(2)
  })
})

// ── mountSceneDebug (deprecated alias) ──

describe('mountSceneDebug (deprecated alias)', () => {
  it('is the same function as mountFlowDebug', () => {
    expect(mountSceneDebug).toBe(mountFlowDebug)
  })

  it('mounts a debug panel', () => {
    const el = mountSceneDebug()
    expect(el.classList.contains('sb-scene-debug')).toBe(true)
  })
})
