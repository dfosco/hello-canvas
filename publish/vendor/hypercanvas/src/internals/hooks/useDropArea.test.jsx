import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'

let tauriAvailable = true
const listenHandlers = new Map()

vi.mock('../../core/notebook/tauri-bridge.js', () => ({
  isTauriAvailable: () => tauriAvailable,
  invoke: vi.fn(),
  listen: vi.fn(async (event, handler) => {
    listenHandlers.set(event, handler)
    return () => listenHandlers.delete(event)
  }),
}))

import { useDropArea } from './useDropArea.js'
import { __resetDropRouter } from '../dragDrop/dropRouter.js'

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

function emit(event, payload) {
  const handler = listenHandlers.get(event)
  if (!handler) throw new Error(`no handler registered for ${event}`)
  return handler({ payload })
}

const emitAct = async (event, payload) => {
  await act(async () => { emit(event, payload) })
}

function fileDropEvent(type, files) {
  const event = new Event(type, { bubbles: true })
  Object.defineProperty(event, 'dataTransfer', {
    value: { types: ['Files'], files, items: [] },
  })
  return event
}

function Harness({ onDrop, accepts, disabled }) {
  const { ref, isOver } = useDropArea({ accepts, onDrop, disabled })
  return (
    <div ref={ref} data-testid="area">
      <span data-testid="state">{isOver ? 'over' : 'idle'}</span>
    </div>
  )
}

function NestedHarness({ parentOnDrop, childOnDrop, childAccepts }) {
  const { ref: parentRef } = useDropArea({ onDrop: parentOnDrop })
  const { ref: childRef } = useDropArea({ onDrop: childOnDrop, accepts: childAccepts })
  return (
    <div ref={parentRef} data-testid="parent">
      <div ref={childRef} data-testid="child">
        <span data-testid="leaf">leaf</span>
      </div>
    </div>
  )
}

beforeEach(() => {
  tauriAvailable = true
  listenHandlers.clear()
  document.body.innerHTML = ''
  __resetDropRouter()
  // jsdom does not implement elementFromPoint — install a mock we can retarget.
  Object.defineProperty(document, 'elementFromPoint', { value: vi.fn(() => null), configurable: true, writable: true })
})

describe('useDropArea', () => {
  it('registers with the router in desktop mode and receives claimed drops', async () => {
    const onDrop = vi.fn()
    const { getByTestId } = render(<Harness onDrop={onDrop} />)
    await flush()

    const area = getByTestId('area')
    document.elementFromPoint.mockReturnValue(area)
    await emitAct('tauri://drag-enter', { paths: ['/tmp/Notebook'], position: { x: 10, y: 10 } })
    expect(getByTestId('state').textContent).toBe('over')

    await emitAct('tauri://drag-drop', { paths: ['/tmp/Notebook'], position: { x: 10, y: 10 } })
    expect(onDrop).toHaveBeenCalledWith(expect.objectContaining({ paths: ['/tmp/Notebook'] }))
    expect(getByTestId('state').textContent).toBe('idle')
  })

  it('does not attach HTML5 listeners in desktop mode', async () => {
    const onDrop = vi.fn()
    const { getByTestId } = render(<Harness onDrop={onDrop} />)
    await flush()

    getByTestId('area').dispatchEvent(fileDropEvent('drop', [new File(['x'], 'a.txt')]))
    expect(onDrop).not.toHaveBeenCalled()
  })

  it('falls back to HTML5 events in browser mode', async () => {
    tauriAvailable = false
    const onDrop = vi.fn()
    const { getByTestId } = render(<Harness onDrop={onDrop} />)
    await flush()
    expect(listenHandlers.size).toBe(0)

    const area = getByTestId('area')
    await act(async () => { area.dispatchEvent(fileDropEvent('dragenter', [])) })
    expect(getByTestId('state').textContent).toBe('over')

    const file = new File(['hello'], 'a.txt')
    await act(async () => { area.dispatchEvent(fileDropEvent('drop', [file])) })
    expect(onDrop).toHaveBeenCalledWith(expect.objectContaining({ paths: null, files: [file] }))
    expect(getByTestId('state').textContent).toBe('idle')
  })

  it('browser drop claims with stopPropagation so outer areas never react', async () => {
    tauriAvailable = false
    const parentOnDrop = vi.fn()
    const childOnDrop = vi.fn()
    const { getByTestId } = render(<NestedHarness parentOnDrop={parentOnDrop} childOnDrop={childOnDrop} />)
    await flush()

    const child = getByTestId('child')
    child.dispatchEvent(fileDropEvent('drop', [new File(['x'], 'a.txt')]))

    expect(childOnDrop).toHaveBeenCalledTimes(1)
    expect(parentOnDrop).not.toHaveBeenCalled()
  })

  it('a declining browser area passes the claim to an outer area', async () => {
    tauriAvailable = false
    const parentOnDrop = vi.fn()
    const childOnDrop = vi.fn()
    const { getByTestId } = render(
      <NestedHarness parentOnDrop={parentOnDrop} childOnDrop={childOnDrop} childAccepts={() => false} />,
    )
    await flush()

    getByTestId('child').dispatchEvent(fileDropEvent('drop', [new File(['x'], 'a.txt')]))

    expect(parentOnDrop).toHaveBeenCalledTimes(1)
    expect(childOnDrop).not.toHaveBeenCalled()
  })

  it('respects disabled in browser mode', async () => {
    tauriAvailable = false
    const onDrop = vi.fn()
    const { getByTestId } = render(<Harness onDrop={onDrop} disabled />)
    await flush()

    getByTestId('area').dispatchEvent(fileDropEvent('drop', [new File(['x'], 'a.txt')]))
    expect(onDrop).not.toHaveBeenCalled()
  })

  it('unregisters from the router on unmount', async () => {
    const onDrop = vi.fn()
    const { unmount } = render(<Harness onDrop={onDrop} />)
    await flush()
    unmount()

    document.elementFromPoint.mockReturnValue(document.body)
    expect(() => emit('tauri://drag-drop', { paths: ['/tmp/x'], position: { x: 1, y: 1 } })).not.toThrow()
    expect(onDrop).not.toHaveBeenCalled()
  })
})
