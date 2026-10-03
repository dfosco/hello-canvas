import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getConfig } from '../index.js'
import CanvasCreateMenu from './CanvasCreateMenu.jsx'
import { initFeatureFlags, resetFlags, setFlag } from '../stores/featureFlags.js'

vi.mock('../index.js', () => ({
  getConfig: vi.fn(),
  buildPrototypeIndex: vi.fn(() => ({ folders: [], prototypes: [] })),
}))
vi.mock('./Icon.jsx', () => ({ default: ({ name }) => <span aria-hidden="true">{name}</span> }))
vi.mock('../notebook/tauri-bridge.js', () => ({ isTauriAvailable: () => false }))

beforeEach(() => {
  vi.clearAllMocks()
  getConfig.mockReturnValue({})
  initFeatureFlags()
})

afterEach(() => {
  resetFlags()
  vi.unstubAllGlobals()
})

async function openMenu() {
  const user = userEvent.setup()
  render(<CanvasCreateMenu />)
  await user.click(screen.getByRole('button', { name: 'Add widget' }))
  await screen.findByText('Sticky Note')
  return user
}

it('hides Prompt and Agent Chat from the add-widget menu while their flags are off', async () => {
  await openMenu()
  expect(screen.queryByText('Prompt')).toBeNull()
  expect(screen.queryByText('Agent Chat')).toBeNull()
  expect(screen.getByText('Sticky Note')).toBeTruthy()
  expect(screen.getByText('Terminal')).toBeTruthy()
})

it('shows Prompt and Agent Chat once their feature flags are enabled', async () => {
  setFlag('prompt-widget', true)
  setFlag('agent-chat-widget', true)
  await openMenu()
  expect(screen.getByText('Prompt')).toBeTruthy()
  expect(screen.getByText('Agent Chat')).toBeTruthy()
})
