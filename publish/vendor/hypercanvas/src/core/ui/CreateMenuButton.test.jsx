import { afterEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import CreateMenuButton from './CreateMenuButton.jsx'

vi.mock('../notebook/tauri-bridge.js', () => ({ isTauriAvailable: vi.fn(() => true) }))
vi.mock('../index.js', () => ({ isExcludedByRoute: () => false }))

afterEach(() => vi.clearAllMocks())

it('opens the Site modal request directly from + Create rather than an inline form', async () => {
  const handler = vi.fn()
  document.addEventListener('storyboard:create-artifact', handler)
  const { unmount } = render(<CreateMenuButton config={{ label: 'Create', actions: [{ id: 'site', type: 'default', label: 'New site', artifactType: 'Site' }] }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Create' }))
  fireEvent.click(await screen.findByText('New site'))
  expect(handler).toHaveBeenCalledWith(expect.objectContaining({ detail: { type: 'Site' } }))
  unmount()
  document.removeEventListener('storyboard:create-artifact', handler)
})
