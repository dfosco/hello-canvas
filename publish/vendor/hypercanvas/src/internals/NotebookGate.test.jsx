import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const openNotebook = vi.fn()

vi.mock('../core/notebook/tauri-bridge.js', () => ({
  invoke: vi.fn(),
  isTauriAvailable: () => true,
  listen: vi.fn(() => Promise.resolve(() => {})),
}))

vi.mock('./NotebookDialog/NotebookDialog.jsx', () => ({
  default: ({ open }) => (open ? <div role="dialog" aria-label="Add a Notebook" /> : null),
}))

import NotebookGate from './NotebookGate/NotebookGate.jsx'
import { invoke } from '../core/notebook/tauri-bridge.js'

const notebooks = [
  { name: 'Demo', path: '/tmp/demo' },
  { name: 'Other', path: '/tmp/other' },
]

function statusResponse(status) {
  return { ok: true, json: () => Promise.resolve(status) }
}

function mockStatus(status) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(statusResponse(status))))
}

describe('NotebookGate', () => {
  beforeEach(() => {
    vi.stubGlobal('__STORYBOARD_OPEN_NOTEBOOK__', openNotebook)
    invoke.mockImplementation(command => {
      if (command === 'list_notebooks') return Promise.resolve(notebooks.map(n => ({ ...n })))
      if (command === 'remember_notebook') return Promise.resolve(notebooks.map(n => ({ ...n })))
      return Promise.resolve([])
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('stays hidden while the active notebook is available', async () => {
    mockStatus({ active: true, root: '/tmp/demo', availability: { available: true } })
    render(<NotebookGate />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens an uncloseable switcher with a yellow banner when the folder is removed or renamed', async () => {
    mockStatus({ active: true, root: '/tmp/demo', availability: { available: false, reason: 'missing' } })
    render(<NotebookGate />)

    const banner = await screen.findByRole('status')
    expect(banner.textContent).toContain('was removed or renamed')

    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText('Choose a notebook')).toBeTruthy()
    expect(dialog.getByRole('button', { name: 'Demo' })).toBeTruthy()
    expect(dialog.getByRole('button', { name: 'Other' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /close/i })).toBeNull()
  })

  it('reports a tracked move and offers to reopen the notebook at its new path', async () => {
    const user = userEvent.setup()
    openNotebook.mockResolvedValue({})
    mockStatus({
      active: true,
      root: '/tmp/demo',
      availability: { available: false, reason: 'moved', movedTo: '/tmp/renamed' },
    })
    render(<NotebookGate />)

    const banner = await screen.findByRole('status')
    expect(banner.textContent).toContain('was moved or renamed')
    expect(banner.textContent).toContain('/tmp/renamed')

    await user.click(screen.getByRole('button', { name: /Open “renamed”/ }))
    await waitFor(() => expect(openNotebook).toHaveBeenCalledWith('/tmp/renamed'))
  })

  it('opens the switcher without a banner when the app starts with no notebook pointer', async () => {
    mockStatus({ active: false, root: null, notice: null })
    render(<NotebookGate />)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/No notebook is open/)).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Demo' })).toBeTruthy()
  })

  it('loads Core recents in browser mode and requires folder selection for a missing notebook', async () => {
    const user = userEvent.setup()
    openNotebook.mockResolvedValue({})
    vi.stubGlobal('__HYPERCANVAS_CORE_MODE__', true)
    vi.stubGlobal('fetch', vi.fn(async url => ({
      ok: true,
      json: async () => String(url).includes('/recent')
        ? { notebooks: [
            { title: 'Available', root: '/tmp/available', available: true },
            { title: 'Missing', root: '/tmp/missing', available: false },
          ] }
        : { active: false, root: null },
    })))
    render(<NotebookGate />)

    const dialog = await screen.findByRole('dialog')
    const available = within(dialog).getByRole('button', { name: 'Available' })
    const missing = within(dialog).getByRole('button', { name: /Missing — Folder missing/ })
    expect(available.disabled).toBe(false)
    expect(missing.disabled).toBe(true)
    await user.click(available)
    await waitFor(() => expect(openNotebook).toHaveBeenCalledWith('/tmp/available'))
  })

  it('shows the runtime notice in the banner when reopening without the last notebook', async () => {
    mockStatus({
      active: false,
      root: null,
      notice: 'The previously opened Notebook folder was removed or renamed: /tmp/demo.',
    })
    render(<NotebookGate />)

    const banner = await screen.findByRole('status')
    expect(banner.textContent).toContain('removed or renamed: /tmp/demo')
  })

  it('opening a listed notebook invokes the native opener and clears the gate', async () => {
    const user = userEvent.setup()
    openNotebook.mockResolvedValue({})
    mockStatus({ active: false, root: null, notice: null })
    render(<NotebookGate />)

    await user.click(await screen.findByRole('button', { name: 'Demo' }))
    await waitFor(() => expect(openNotebook).toHaveBeenCalledWith('/tmp/demo'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('stays open and shows an error when opening a notebook fails', async () => {
    const user = userEvent.setup()
    openNotebook.mockRejectedValue(new Error('Notebook must be valid before it can become active.'))
    mockStatus({ active: false, root: null, notice: null })
    render(<NotebookGate />)

    await user.click(await screen.findByRole('button', { name: 'Demo' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Notebook must be valid')
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})
