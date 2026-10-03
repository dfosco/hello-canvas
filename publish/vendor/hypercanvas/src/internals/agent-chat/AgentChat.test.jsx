import { expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { AgentChat } from './AgentChat.jsx'

it('exposes a stable open-in-tab action for an existing agent session', () => {
  const onOpenInTab = vi.fn()
  const chat = {
    state: {
      agentId: 'agent-1234567890',
      items: [],
      head: [],
      permissions: [],
      olderAvailable: false,
      turnActive: false,
      cancelling: false,
      attention: false,
      error: '',
      sendError: '',
    },
    actions: {
      loadOlder: vi.fn(),
      send: vi.fn(),
      cancel: vi.fn(),
      respondToPermission: vi.fn(),
      setAgentId: vi.fn(),
    },
  }

  render(<AgentChat chat={chat} providers={[]} onOpenInTab={onOpenInTab} />)
  fireEvent.click(screen.getByRole('button', { name: 'Open agent in new tab' }))

  expect(onOpenInTab).toHaveBeenCalledOnce()
})
