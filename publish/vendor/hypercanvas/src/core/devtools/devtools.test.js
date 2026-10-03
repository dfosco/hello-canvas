/**
 * Tests for devtools.js — command menu mount lifecycle.
 * Mocks the React component to avoid jsdom lifecycle issues.
 */

import { vi } from 'vitest'

const mockRender = vi.fn()
const mockUnmount = vi.fn()
const mockCreateRoot = vi.fn(() => ({ render: mockRender, unmount: mockUnmount }))

vi.mock('react', () => ({
  createElement: vi.fn((comp, props) => ({ comp, props })),
}))

vi.mock('react-dom/client', () => ({
  createRoot: mockCreateRoot,
}))

vi.mock('../ui/CoreUIBar.jsx', () => ({ default: () => null }))

describe('mountDevTools', () => {
  let mountDevTools, unmountDevTools

  beforeEach(async () => {
    document.body.innerHTML = ''
    vi.resetModules()

    vi.doMock('react', () => ({
      createElement: vi.fn((comp, props) => ({ comp, props })),
    }))
    vi.doMock('react-dom/client', () => ({
      createRoot: vi.fn(() => ({ render: vi.fn(), unmount: vi.fn() })),
    }))
    vi.doMock('../ui/CoreUIBar.jsx', () => ({ default: () => null }))

    const mod = await import('./devtools.js')
    mountDevTools = mod.mountDevTools
    unmountDevTools = mod.unmountDevTools
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates a wrapper element in the DOM', async () => {
    await mountDevTools()
    expect(document.getElementById('sb-core-ui')).not.toBeNull()
  })

  it('appends to document.body by default', async () => {
    await mountDevTools()
    expect(document.getElementById('sb-core-ui')).toBeInTheDocument()
  })

  it('accepts a custom container', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    await mountDevTools({ container })
    expect(container.querySelector('#sb-core-ui')).not.toBeNull()
  })

  it('is idempotent — calling twice does not double-mount', async () => {
    await mountDevTools()
    await mountDevTools()
    expect(document.querySelectorAll('#sb-core-ui').length).toBe(1)
  })

  it('unmountDevTools removes the wrapper', async () => {
    await mountDevTools()
    expect(document.getElementById('sb-core-ui')).not.toBeNull()
    await unmountDevTools()
    expect(document.getElementById('sb-core-ui')).toBeNull()
  })
})
