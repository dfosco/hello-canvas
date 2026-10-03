import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SettingsDialog from './SettingsDialog.jsx'

const flags = vi.hoisted(() => ({ setFlag: vi.fn() }))
vi.mock('../../core/stores/featureFlags.js', () => ({
  getAllFlags: () => ({ usePaseoApp: { current: true, default: true } }),
  setFlag: flags.setFlag,
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('startup-only Paseo setting', () => {
  it('persists to server config only on Save, never to browser-local runtime flags', async () => {
    const user = userEvent.setup()
    const config = { featureFlags: { usePaseoApp: true, browserSessionHandoff: false } }
    const fetchMock = vi.fn(async (_url, options) => ({
      ok: true,
      json: async () => ({ config: options?.method === 'PUT' ? JSON.parse(options.body).updates.featureFlags : config }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    render(<SettingsDialog open onOpenChange={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Feature Flags' }))
    const toggle = within(screen.getByText('usePaseoApp').closest('label')).getByRole('switch')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText(/restart Hypercanvas to apply/)).toBeTruthy()
    await user.click(toggle)
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(flags.setFlag).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      updates: { featureFlags: { usePaseoApp: false, browserSessionHandoff: false } },
    })
  })

  it('defaults true with partial config and discards an unsaved selection on Cancel', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ config: {} }) }))
    vi.stubGlobal('fetch', fetchMock)
    render(<SettingsDialog open onOpenChange={onOpenChange} />)
    await user.click(await screen.findByRole('button', { name: 'Feature Flags' }))
    const toggle = within(screen.getByText('usePaseoApp').closest('label')).getByRole('switch')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    await user.click(toggle)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(flags.setFlag).not.toHaveBeenCalled()
  })
})
