import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, fireEvent, waitFor } from '@testing-library/react'
import { useState } from 'react'

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

import NotebookDialog from '../NotebookDialog/NotebookDialog.jsx'
import DropZone from './DropZone.jsx'
import { __resetDropRouter } from '../dragDrop/dropRouter.js'
import { invoke } from '../../core/notebook/tauri-bridge.js'

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

function emit(event, payload) {
  const handler = listenHandlers.get(event)
  if (!handler) throw new Error(`no handler registered for ${event}`)
  handler({ payload })
}

const emitAct = async (event, payload) => {
  await act(async () => { emit(event, payload) })
}

function DialogHarness({ initialOpen = true }) {
  const [open, setOpen] = useState(initialOpen)
  return <NotebookDialog open={open} onOpenChange={setOpen} />
}

beforeEach(() => {
  tauriAvailable = true
  listenHandlers.clear()
  document.body.innerHTML = ''
  __resetDropRouter()
  // jsdom does not implement elementFromPoint — install a mock we can retarget.
  Object.defineProperty(document, 'elementFromPoint', { value: vi.fn(() => null), configurable: true, writable: true })
  vi.mocked(invoke).mockResolvedValue([])
  vi.stubGlobal('fetch', vi.fn(url => Promise.resolve(String(url).includes('/site/list')
    ? { ok: true, json: async () => ({ sites: [] }) }
    : String(url).includes('/notebook-runtime/recent')
      ? { ok: true, json: async () => ({ notebooks: [] }) }
      : { ok: false, json: async () => ({}) })))
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete globalThis.__STORYBOARD_OPEN_NOTEBOOK__
  delete globalThis.__STORYBOARD_PICK_NOTEBOOK_FOLDER__
})

describe('DropZone', () => {
  it('renders a div by default and exposes drop state', () => {
    const { getByTestId } = render(
      <DropZone data-testid="zone">
        {({ isOver }) => <span>{isOver ? 'over' : 'idle'}</span>}
      </DropZone>,
    )
    const zone = getByTestId('zone')
    expect(zone.tagName).toBe('DIV')
    expect(zone.getAttribute('data-dropzone')).toBe('')
    expect(zone.textContent).toBe('idle')
  })

  it('renders a button when clickable', () => {
    const { getByTestId } = render(
      <DropZone as="button" type="button" onClick={() => {}} data-testid="zone">pick</DropZone>,
    )
    expect(getByTestId('zone').tagName).toBe('BUTTON')
  })
})

describe('NotebookDialog intake', () => {
  it('stages a dropped Notebook folder until the user confirms', async () => {
    const opener = vi.fn(() => Promise.resolve({ status: { root: '/tmp/Demo' } }))
    globalThis.__STORYBOARD_OPEN_NOTEBOOK__ = opener
    const { container, getByRole } = render(<DialogHarness />)
    await flush()

    const dropzone = container.querySelector('[data-dropzone]')
    document.elementFromPoint.mockReturnValue(dropzone)
    await emitAct('tauri://drag-enter', { paths: ['/Users/me/Notebooks/Demo'], position: { x: 40, y: 30 } })
    expect(dropzone.textContent).toContain('Drop the Notebook here')

    await emitAct('tauri://drag-drop', { paths: ['/Users/me/Notebooks/Demo'], position: { x: 40, y: 30 } })
    await flush()

    expect(container.textContent).toContain('Demo')
    expect(opener).not.toHaveBeenCalled()
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()

    await act(async () => {
      getByRole('button', { name: 'Add Notebook' }).click()
      await flush()
    })
    expect(opener).toHaveBeenCalledWith('/Users/me/Notebooks/Demo')
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('surfaces invalid Notebook drops with an inline error and a toast instead of failing silently', async () => {
    const opener = vi.fn(() => Promise.reject(new Error('This folder is not a valid Notebook (missing hypercanvas.notebook.json).')))
    globalThis.__STORYBOARD_OPEN_NOTEBOOK__ = opener
    const { container, getByRole } = render(<DialogHarness />)
    await flush()

    const dropzone = container.querySelector('[data-dropzone]')
    document.elementFromPoint.mockReturnValue(dropzone)
    await emitAct('tauri://drag-drop', { paths: ['/Users/me/not-a-notebook'], position: { x: 40, y: 30 } })
    await flush()

    expect(opener).not.toHaveBeenCalled()
    await act(async () => {
      getByRole('button', { name: 'Add Notebook' }).click()
      await flush()
    })

    expect(container.querySelector('[role="alert"]').textContent).toContain('missing hypercanvas.notebook.json')
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('confirms a pathless browser Notebook drop through the Core folder picker', async () => {
    tauriAvailable = false
    const picker = vi.fn(async () => '/tmp/dropped-notebook')
    const opener = vi.fn(async () => ({ active: true, root: '/tmp/dropped-notebook' }))
    globalThis.__STORYBOARD_PICK_NOTEBOOK_FOLDER__ = picker
    globalThis.__STORYBOARD_OPEN_NOTEBOOK__ = opener
    const { container, getByText } = render(<DialogHarness />)
    await flush()

    const dropzone = container.querySelector('[data-dropzone]')
    const drop = new Event('drop', { bubbles: true })
    Object.defineProperty(drop, 'dataTransfer', {
      value: { types: ['Files'], files: [new File(['{}'], 'hypercanvas.notebook.json')], items: [] },
    })
    fireEvent(dropzone, drop)

    expect(container.textContent).toContain('hypercanvas.notebook.json')
    fireEvent.click(getByText('Add Notebook'))
    await waitFor(() => expect(picker).toHaveBeenCalledOnce())
    await waitFor(() => expect(opener).toHaveBeenCalledWith('/tmp/dropped-notebook'))
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })
})
