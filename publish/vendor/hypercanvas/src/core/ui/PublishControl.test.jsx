import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import PublishControl, { PublishPanel } from './PublishControl.jsx'
import { _resetSidePanel, sidePanelState } from '../stores/sidePanelStore.js'

afterEach(() => {
  cleanup()
  _resetSidePanel()
  vi.unstubAllGlobals()
})

it('renders the outline upload icon even with a staged solid-icon toolbar config', () => {
  render(<PublishControl config={{ icon: 'iconoir/upload-square-solid' }} />)

  const button = screen.getByRole('button', { name: 'Publish' })
  expect(button.querySelector('svg path[d="M12 14V6M12 6L15.5 9.5M12 6L8.5 9.5"]')).not.toBeNull()
  expect(button.textContent).toBe('')
})

it('opens the shared Publish side panel instead of a modal dialog', () => {
  let state
  const unsubscribe = sidePanelState.subscribe(value => { state = value })
  render(<PublishControl />)

  const button = screen.getByRole('button', { name: 'Publish' })
  fireEvent.click(button)

  expect(state).toMatchObject({ open: true, activeTab: 'publish' })
  expect(button.closest('[data-trigger-button]')).toHaveAttribute('aria-expanded', 'true')
  expect(screen.queryByRole('dialog')).toBeNull()
  unsubscribe()
})

it('renders captured Git output in a read-only recovery terminal without creating a session', async () => {
  const operation = {
    id: 'publish-op',
    kind: 'publish',
    status: 'failed',
    steps: [{ name: 'push', status: 'failed' }],
    error: { message: 'Git push failed' },
    output: ['$ git push\nfatal: remote rejected the update'],
  }
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ operations: [operation], auth: { authenticated: false } }),
  })))

  render(<PublishPanel />)

  const publishScope = await screen.findByLabelText('Publish')
  expect(publishScope).toHaveValue('default')
  expect(screen.getByRole('option', { name: 'Published folder (static site)' })).toBeInTheDocument()
  expect(screen.getByRole('option', { name: 'Notebook folder (also includes source files)' })).toBeInTheDocument()

  const terminal = await screen.findByRole('region', { name: 'Publish terminal output' })
  await waitFor(() => expect(terminal.textContent).toContain('fatal: remote rejected the update'))
  expect(terminal.textContent).toContain('$ git push')
  expect(screen.queryByText(/Start a new agent session/)).toBeNull()
  expect(screen.queryByText('Open Notebook recovery terminal')).toBeNull()
})
