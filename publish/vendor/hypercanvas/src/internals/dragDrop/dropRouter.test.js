import { beforeEach, describe, expect, it, vi } from 'vitest'

const listenHandlers = new Map()

vi.mock('../../core/notebook/tauri-bridge.js', () => ({
  isTauriAvailable: () => true,
  invoke: vi.fn(),
  listen: vi.fn(async (event, handler) => {
    listenHandlers.set(event, handler)
    return () => listenHandlers.delete(event)
  }),
}))

import { __resetDropRouter, registerDropArea } from './dropRouter.js'

function emit(event, payload) {
  const handler = listenHandlers.get(event)
  if (!handler) throw new Error(`no handler registered for ${event}`)
  return handler({ payload })
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

// jsdom does not implement elementFromPoint — install a mock we can retarget.
function stubElementFromPoint() {
  const fn = vi.fn(() => null)
  Object.defineProperty(document, 'elementFromPoint', { value: fn, configurable: true, writable: true })
  return fn
}

function mountDom() {
  const parent = document.createElement('div')
  const child = document.createElement('div')
  const leaf = document.createElement('span')
  parent.appendChild(child)
  child.appendChild(leaf)
  document.body.appendChild(parent)
  return { parent, child, leaf }
}

function areaFor(element, overrides = {}) {
  return {
    getElement: () => element,
    accepts: overrides.accepts,
    onDrop: overrides.onDrop || vi.fn(),
    onDragStateChange: overrides.onDragStateChange,
    disabled: overrides.disabled,
  }
}

beforeEach(async () => {
  __resetDropRouter()
  listenHandlers.clear()
  document.body.innerHTML = ''
  Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true, writable: true })
  Object.defineProperty(navigator, 'platform', { value: 'Linux x86_64', configurable: true })
  stubElementFromPoint()
  await flush()
})

describe('dropRouter', () => {
  it('listens to Tauri drag events once an area registers', async () => {
    mountDom()
    const element = document.querySelector('div')
    registerDropArea(areaFor(element))
    await flush()
    expect(listenHandlers.has('tauri://drag-enter')).toBe(true)
    expect(listenHandlers.has('tauri://drag-over')).toBe(true)
    expect(listenHandlers.has('tauri://drag-drop')).toBe(true)
    expect(listenHandlers.has('tauri://drag-leave')).toBe(true)
  })

  it('delivers the drop to the innermost claiming area only', async () => {
    const { parent, child } = mountDom()
    const parentDrop = vi.fn()
    const childDrop = vi.fn()
    registerDropArea(areaFor(parent, { onDrop: parentDrop }))
    registerDropArea(areaFor(child, { onDrop: childDrop }))
    await flush()

    document.elementFromPoint.mockReturnValue(child)
    emit('tauri://drag-drop', { paths: ['/tmp/Notebook'], position: { x: 40, y: 20 } })

    expect(childDrop).toHaveBeenCalledTimes(1)
    expect(childDrop).toHaveBeenCalledWith(expect.objectContaining({ paths: ['/tmp/Notebook'] }))
    expect(parentDrop).not.toHaveBeenCalled()
  })

  it('delivers to the outer area when the hit lands on it', async () => {
    const { parent, child } = mountDom()
    const parentDrop = vi.fn()
    const childDrop = vi.fn()
    registerDropArea(areaFor(parent, { onDrop: parentDrop }))
    registerDropArea(areaFor(child, { onDrop: childDrop }))
    await flush()

    document.elementFromPoint.mockReturnValue(parent)
    emit('tauri://drag-drop', { paths: ['/tmp/Notebook'], position: { x: 5, y: 5 } })

    expect(parentDrop).toHaveBeenCalledTimes(1)
    expect(childDrop).not.toHaveBeenCalled()
  })

  it('lets a declining area pass the claim to an outer area', async () => {
    const { parent, child } = mountDom()
    const parentDrop = vi.fn()
    const childDrop = vi.fn()
    registerDropArea(areaFor(parent, { onDrop: parentDrop }))
    registerDropArea(areaFor(child, { onDrop: childDrop, accepts: () => false }))
    await flush()

    document.elementFromPoint.mockReturnValue(child)
    emit('tauri://drag-drop', { paths: ['/tmp/Notebook'], position: { x: 10, y: 10 } })

    expect(parentDrop).toHaveBeenCalledTimes(1)
    expect(childDrop).not.toHaveBeenCalled()
  })

  it('skips disabled areas', async () => {
    const { parent, child } = mountDom()
    const parentDrop = vi.fn()
    const childDrop = vi.fn()
    registerDropArea(areaFor(parent, { onDrop: parentDrop }))
    registerDropArea(areaFor(child, { onDrop: childDrop, disabled: () => true }))
    await flush()

    document.elementFromPoint.mockReturnValue(child)
    emit('tauri://drag-drop', { paths: ['/tmp/x'], position: { x: 1, y: 1 } })

    expect(parentDrop).toHaveBeenCalledTimes(1)
    expect(childDrop).not.toHaveBeenCalled()
  })

  it('ignores drops that claim no area', async () => {
    const { leaf } = mountDom()
    const drop = vi.fn()
    registerDropArea(areaFor(document.createElement('div'), { onDrop: drop }))
    await flush()

    document.elementFromPoint.mockReturnValue(leaf)
    expect(emit('tauri://drag-drop', { paths: ['/tmp/x'], position: { x: 1, y: 1 } })).toBeNull()
    expect(drop).not.toHaveBeenCalled()
  })

  it('marks only the hovered area as over and clears on leave', async () => {
    const { parent, child } = mountDom()
    const childState = vi.fn()
    const parentState = vi.fn()
    registerDropArea(areaFor(parent, { onDragStateChange: parentState }))
    registerDropArea(areaFor(child, { onDragStateChange: childState }))
    await flush()

    document.elementFromPoint.mockReturnValue(child)
    emit('tauri://drag-enter', { paths: ['/tmp/Notebook'], position: { x: 10, y: 10 } })
    expect(childState).toHaveBeenLastCalledWith(expect.objectContaining({ isOver: true }))
    expect(parentState).not.toHaveBeenCalledWith(expect.objectContaining({ isOver: true }))

    emit('tauri://drag-over', { position: { x: 12, y: 12 } })
    emit('tauri://drag-leave')
    expect(childState).toHaveBeenLastCalledWith(expect.objectContaining({ isOver: false }))
  })

  it('converts physical pixels to CSS pixels via devicePixelRatio', async () => {
    const { child } = mountDom()
    const elementFromPoint = document.elementFromPoint.mockReturnValue(child)
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true, writable: true })
    registerDropArea(areaFor(child))
    await flush()

    emit('tauri://drag-drop', { paths: ['/tmp/x'], position: { x: 200, y: 100 } })
    expect(elementFromPoint).toHaveBeenCalledWith(100, 50)
  })

  it('accepts macOS Wry coordinates without Retina scaling', async () => {
    const { child } = mountDom()
    const elementFromPoint = document.elementFromPoint
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true, writable: true })
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true })
    elementFromPoint.mockImplementation((x, y) => x === 200 && y === 100 ? child : null)
    const drop = vi.fn()
    registerDropArea(areaFor(child, { onDrop: drop }))
    await flush()

    emit('tauri://drag-drop', { paths: ['/tmp/x'], position: { x: 200, y: 100 } })
    expect(elementFromPoint).toHaveBeenCalledWith(200, 100)
    expect(drop).toHaveBeenCalledTimes(1)
  })

  it('stops delivering after unregister', async () => {
    const { child } = mountDom()
    const drop = vi.fn()
    const unregister = registerDropArea(areaFor(child, { onDrop: drop }))
    await flush()
    unregister()

    document.elementFromPoint.mockReturnValue(child)
    emit('tauri://drag-drop', { paths: ['/tmp/x'], position: { x: 1, y: 1 } })
    expect(drop).not.toHaveBeenCalled()
  })

  it('keeps delivering to remaining areas when one unregisters', async () => {
    const { parent, child } = mountDom()
    const parentDrop = vi.fn()
    const childDrop = vi.fn()
    const unregisterParent = registerDropArea(areaFor(parent, { onDrop: parentDrop }))
    registerDropArea(areaFor(child, { onDrop: childDrop }))
    await flush()
    unregisterParent()

    document.elementFromPoint.mockReturnValue(child)
    emit('tauri://drag-drop', { paths: ['/tmp/x'], position: { x: 1, y: 1 } })
    expect(childDrop).toHaveBeenCalledTimes(1)
  })
})
