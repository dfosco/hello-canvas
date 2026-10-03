import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const tauriBridgeState = vi.hoisted(() => ({ available: true }))

vi.mock('../core/notebook/tauri-bridge.js', () => ({
  invoke: vi.fn(),
  isTauriAvailable: () => tauriBridgeState.available,
  listen: vi.fn(() => Promise.resolve(() => {})),
}))

import Workspace, { CreateMenu } from './Viewfinder.jsx'
import { invoke } from '../core/notebook/tauri-bridge.js'

const notebooks = [
  { name: 'Demo', path: '/tmp/demo' },
  { name: 'Other', path: '/tmp/other' },
]

async function openSwitcher(user) {
  await user.click(screen.getByRole('button', { name: /notebook/i, expanded: false }))
  const dialog = await screen.findByRole('dialog')
  return within(dialog)
}

function renderWorkspace(initialEntries = ['/workspace'], basename) {
  return render(<MemoryRouter basename={basename} initialEntries={initialEntries}><Workspace /></MemoryRouter>)
}

describe('notebook switcher modal — remove notebook', () => {
  beforeEach(() => {
    tauriBridgeState.available = true
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })))
    invoke.mockImplementation(command => {
      if (command === 'list_notebooks') return Promise.resolve(notebooks.map(n => ({ ...n })))
      if (command === 'remove_notebook') return Promise.resolve([{ name: 'Other', path: '/tmp/other' }])
      return Promise.resolve([])
    })
  })

  it('shows a remove button to the right of each notebook', async () => {
    const user = userEvent.setup()
    renderWorkspace()
    const dialog = await openSwitcher(user)
    expect(dialog.getByRole('button', { name: 'Remove Demo' })).toBeTruthy()
    expect(dialog.getByRole('button', { name: 'Remove Other' })).toBeTruthy()
  })

  it('replaces the switcher contents with a removal confirmation', async () => {
    const user = userEvent.setup()
    renderWorkspace()
    let dialog = await openSwitcher(user)
    await user.click(dialog.getByRole('button', { name: 'Remove Demo' }))

    dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByText('Remove notebook?')).toBeTruthy()
    expect(dialog.getByText(/will no longer be listed in\s+Hypercanvas/i)).toBeTruthy()
    expect(dialog.getByText(/will not be deleted/i)).toBeTruthy()
    expect(dialog.queryByText('Switch notebook')).toBeNull()
  })

  it('cancel returns to the switcher without invoking remove_notebook', async () => {
    const user = userEvent.setup()
    renderWorkspace()
    let dialog = await openSwitcher(user)
    await user.click(dialog.getByRole('button', { name: 'Remove Demo' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByText('Switch notebook')).toBeTruthy()
    expect(dialog.getByText('Demo')).toBeTruthy()
    expect(invoke).not.toHaveBeenCalledWith('remove_notebook', { path: '/tmp/demo' })
  })

  it('confirming invokes remove_notebook and unlists the notebook', async () => {
    const user = userEvent.setup()
    renderWorkspace()
    let dialog = await openSwitcher(user)
    await user.click(dialog.getByRole('button', { name: 'Remove Demo' }))
    await user.click(screen.getByRole('button', { name: 'Remove notebook' }))

    expect(invoke).toHaveBeenCalledWith('remove_notebook', { path: '/tmp/demo' })
    await waitFor(() => expect(screen.queryByText('Remove notebook?')).toBeNull())
    dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText('Switch notebook')).toBeTruthy()
    expect(dialog.queryByText('Demo')).toBeNull()
    expect(dialog.getByText('Other')).toBeTruthy()
  })
})

describe('browser Sites workspace', () => {
  afterEach(() => {
    delete window.__HYPERCANVAS_CORE_MODE__
    tauriBridgeState.available = true
    vi.unstubAllGlobals()
  })

  function mockBrowserCore(sites = []) {
    tauriBridgeState.available = false
    window.__HYPERCANVAS_CORE_MODE__ = true
    const fetcher = vi.fn(async url => {
      const value = String(url)
      if (value.includes('/_storyboard/site/list')) return { ok: true, json: async () => ({ sites }) }
      if (value.includes('/_storyboard/notebook-runtime/recent')) return { ok: true, json: async () => ({ notebooks: [] }) }
      if (value.includes('/_storyboard/notebook-runtime/status')) return { ok: true, json: async () => ({
        active: true,
        root: '/tmp/browser-core-notebook',
        notebook: { manifest: { title: 'Browser Core Notebook' } },
        availability: { available: true },
      }) }
      if (value.includes('/_storyboard/diagnostics')) return { ok: true, json: async () => ({
        core: { version: '0.18.0', pid: 42, vitePort: 4317 },
        node: { version: 'v24.21.0', path: '/usr/bin/node' },
        notebook: { active: true, title: 'Browser Core Notebook' },
        paseo: { connection: { status: 'connected' }, terminal: { status: 'connected' } },
        hostTools: { baseline: { status: 'valid' }, agents: { codex: { status: 'installed', path: '/usr/bin/codex' } } },
        agents: { codex: { status: 'installed', path: '/usr/bin/codex' } },
        sites: [],
        terminals: [],
        processes: [],
        watches: { totalDirectories: 2, totalFiles: 4, directories: [] },
        logs: [],
        recovery: ['Core and runtime checks are healthy.'],
      }) }
      return { ok: true, json: async () => ({ items: [] }), text: async () => '' }
    })
    vi.stubGlobal('fetch', fetcher)
    return fetcher
  }

  it('shows Choose folder for an empty Sites view and opens the existing Site creation flow', async () => {
    mockBrowserCore()
    const user = userEvent.setup()
    renderWorkspace()

    await user.click(await screen.findByRole('button', { name: /Sites/ }))
    expect(await screen.findByText(/No Sites connected yet/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Choose folder' }))

    const dialog = await screen.findByRole('dialog', { name: 'New Site' })
    expect(within(dialog).getByRole('button', { name: 'Choose external folder' })).toBeTruthy()
  })

  it('restores the Sites section from the Workspace URL', async () => {
    mockBrowserCore()
    renderWorkspace(['/workspace?section=sites'])

    expect(await screen.findByText(/No Sites connected yet/)).toBeTruthy()
  })

  it('exposes the artifact Create menu without a Tauri bridge', async () => {
    mockBrowserCore()
    const user = userEvent.setup()
    const close = vi.fn()
    const createRequested = vi.fn()
    document.addEventListener('storyboard:create-artifact', createRequested)
    render(<CreateMenu onClose={close} basePath="/" />)

    await user.click(screen.getByRole('button', { name: /Canvas/ }))

    expect(close).toHaveBeenCalledOnce()
    expect(createRequested.mock.calls[0][0].detail).toEqual({ type: 'Canvas' })
    document.removeEventListener('storyboard:create-artifact', createRequested)
  })

  it('routes the browser Create menu selection to its local dialog host', async () => {
    mockBrowserCore()
    const user = userEvent.setup()
    const onCreate = vi.fn()
    render(<CreateMenu onClose={() => {}} onCreate={onCreate} basePath="/" />)

    await user.click(screen.getByRole('button', { name: /Canvas/ }))

    expect(onCreate).toHaveBeenCalledWith('Canvas')
  })

  it('shows original directory and status and allows Sites to be removed from the browser', async () => {
    const fetcher = mockBrowserCore([{
      id: 'docs',
      title: 'Docs',
      binding: { root: '/projects/docs', status: 'running' },
      missing: false,
    }])
    const user = userEvent.setup()
    renderWorkspace()

    await user.click(await screen.findByRole('button', { name: /Sites/ }))
    expect(await screen.findByText('/projects/docs')).toBeTruthy()
    expect(screen.getByText('running')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Remove Docs' }))
    expect(await screen.findByText(/Are you sure you want to delete/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Delete Site' }))

    await waitFor(() => expect(screen.queryByText('Docs')).toBeNull())
    expect(fetcher).toHaveBeenCalledWith('/_storyboard/artifact/', expect.objectContaining({
      method: 'DELETE',
      body: JSON.stringify({ type: 'site', name: 'docs' }),
    }))
  })

  it('restores the Settings and Diagnostics panels from workspace URLs', async () => {
    mockBrowserCore()
    const settingsView = renderWorkspace(['/workspace?panel=settings'])
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeTruthy()
    settingsView.unmount()

    renderWorkspace(['/workspace?panel=diagnostics'])
    expect(await screen.findByRole('heading', { name: 'Core diagnostics' })).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'Core process' })).toBeTruthy()
    expect(await screen.findByText('Paseo agent runtime')).toBeTruthy()
    expect(await screen.findByText('Recovery guidance')).toBeTruthy()
  })

  it('restores route-backed Workspace state under a branch basename', async () => {
    mockBrowserCore()
    renderWorkspace(['/branch--feature/workspace?panel=diagnostics'], '/branch--feature')

    expect(await screen.findByRole('heading', { name: 'Core diagnostics' })).toBeTruthy()
  })

  it('restores the Agent panel from a workspace URL', async () => {
    mockBrowserCore()
    renderWorkspace(['/workspace?panel=agent&agentId=agent-route-test'])

    expect(await screen.findByRole('heading', { name: 'Agent session' })).toBeTruthy()
  })
})
