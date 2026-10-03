import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { getConfig } from '../index.js'
import CanvasAgentSetupDialog from './CanvasAgentSetupDialog.jsx'
import CanvasAgentsMenu from './CanvasAgentsMenu.jsx'

vi.mock('../index.js', () => ({ getConfig: vi.fn() }))
vi.mock('./Icon.jsx', () => ({ default: ({ name }) => <span aria-hidden="true">{name}</span> }))

const agentsConfig = {
  agents: {
    codex: { label: 'Codex CLI', startupCommand: 'codex', icon: 'codex' },
    claude: { label: 'Claude Code', startupCommand: 'claude', icon: 'claude' },
    copilot: { label: 'Copilot CLI', startupCommand: 'copilot', icon: 'copilot' },
    opencode: { label: 'OpenCode', startupCommand: 'opencode', icon: 'opencode' },
  },
}

function tool(status, extra = {}) {
  return { status, path: null, version: null, ...extra }
}

function preflight(overrides = {}) {
  return {
    status: 'supported',
    support: { status: 'supported', platform: 'darwin', arch: 'arm64' },
    baseline: { status: 'valid', minimumNodeMajor: 22 },
    agents: {
      codex: tool('missing'),
      claude: tool('missing'),
      copilot: tool('missing'),
      opencode: tool('missing'),
    },
    ...overrides,
  }
}

function plan(selectedAgentIds = ['codex']) {
  return {
    id: 'plan-1',
    selectedAgentIds,
    steps: [
      { id: 'preflight', action: 'rerun', label: 'Re-run host tools preflight' },
      { id: 'agents', action: 'install-selected', label: `Install or preserve ${selectedAgentIds.length} selected agent CLIs` },
    ],
    disclosures: selectedAgentIds.map((id) => ({
      id: `agent-${id}`,
      title: `${id} official installer`,
      detail: 'Vendor controls installer integrity.',
      origin: `https://example.com/${id}/install.sh`,
      destination: `~/.local/bin/${id}`,
      modifiesShellProfile: id === 'claude',
      authentication: 'user-managed',
    })),
  }
}

function operation(status = 'queued', overrides = {}) {
  return {
    id: 'operation-1',
    status,
    phase: status === 'running' ? 'agents' : null,
    phases: [
      { id: 'preflight', status: status === 'queued' ? 'pending' : 'succeeded' },
      { id: 'agents', status: status === 'running' ? 'running' : status },
    ],
    cancellation: { available: false, requested: false },
    output: [],
    result: null,
    error: null,
    ...overrides,
  }
}

function client(overrides = {}) {
  return {
    preflight: vi.fn().mockResolvedValue(preflight()),
    plan: vi.fn().mockResolvedValue(plan()),
    install: vi.fn().mockResolvedValue(operation()),
    operation: vi.fn().mockResolvedValue(operation('succeeded', {
      result: { partialSuccess: false, agents: { codex: { status: 'succeeded' } } },
    })),
    cancel: vi.fn().mockResolvedValue(operation('cancelled')),
    ...overrides,
  }
}

async function openAgentsMenu(user) {
  await user.click(screen.getByRole('button', { name: 'Add agent' }))
  await screen.findByText('Host tools verified')
}

async function reviewAndStart(hostClient) {
  fireEvent.click(screen.getByRole('button', { name: 'Review setup plan' }))
  await waitFor(() => expect(hostClient.plan).toHaveBeenCalled())
  fireEvent.click(screen.getByRole('checkbox', { name: /I reviewed this exact plan/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Install selected CLIs' }))
  await waitFor(() => expect(hostClient.install).toHaveBeenCalledWith('plan-1'))
}

beforeEach(() => {
  vi.clearAllMocks()
  getConfig.mockReturnValue(agentsConfig)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('CanvasAgentsMenu', () => {
  it('launches an installed verified agent with the existing add-widget event', async () => {
    const user = userEvent.setup()
    const hostClient = client({
      preflight: vi.fn().mockResolvedValue(preflight({
        agents: { codex: tool('installed', { path: '/Users/test/.local/bin/codex', version: '1.2.3' }) },
      })),
    })
    const listener = vi.fn()
    document.addEventListener('storyboard:canvas:add-widget', listener)
    render(<CanvasAgentsMenu canvasName="research" hostToolsClient={hostClient} />)

    await openAgentsMenu(user)
    expect(screen.getByRole('menuitem', { name: 'Manage Agent CLIs...' })).toBeVisible()
    await user.click(screen.getByRole('menuitem', { name: /Codex CLI/ }))

    expect(listener).toHaveBeenCalledOnce()
    expect(listener.mock.calls[0][0].detail).toEqual({
      type: 'agent',
      canvasName: 'research',
      props: { agentId: 'codex', startupCommand: 'codex' },
    })
    document.removeEventListener('storyboard:canvas:add-widget', listener)
  })

  it('opens setup with a missing agent selected instead of creating a widget', async () => {
    const user = userEvent.setup()
    const hostClient = client()
    const listener = vi.fn()
    document.addEventListener('storyboard:canvas:add-widget', listener)
    render(<CanvasAgentsMenu canvasName="research" hostToolsClient={hostClient} />)

    await openAgentsMenu(user)
    await user.click(screen.getByRole('menuitem', { name: /Codex CLI/ }))

    expect(await screen.findByRole('dialog', { name: 'Set up agent CLIs' })).toBeVisible()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Codex/ })).toBeChecked()
    expect(listener).not.toHaveBeenCalled()
    document.removeEventListener('storyboard:canvas:add-widget', listener)
  })

  it('shows unsupported and request-failed states without assuming response fields exist', async () => {
    const user = userEvent.setup()
    const hostClient = client({
      preflight: vi.fn()
        .mockResolvedValueOnce({ status: 'unsupported', support: { status: 'unsupported' }, baseline: null, agents: null })
        .mockRejectedValueOnce(new Error('offline')),
    })
    const { unmount } = render(<CanvasAgentsMenu hostToolsClient={hostClient} />)

    await user.click(screen.getByRole('button', { name: 'Add agent' }))
    expect(await screen.findByText('Setup supports macOS Apple silicon')).toBeVisible()
    expect(screen.getAllByText('Unsupported').length).toBeGreaterThan(0)
    unmount()

    render(<CanvasAgentsMenu hostToolsClient={hostClient} />)
    await user.click(screen.getByRole('button', { name: 'Add agent' }))
    expect(await screen.findByText('Host check failed')).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'Retry host check' })).toBeVisible()
  })

  it('uses the CoreUIBar branch base path for browser preflight', async () => {
    const user = userEvent.setup()
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(preflight()),
    })
    vi.stubGlobal('fetch', fetchImpl)
    render(<CanvasAgentsMenu basePath="/branch--agent-setup/" />)

    await openAgentsMenu(user)

    expect(fetchImpl).toHaveBeenCalledWith('/branch--agent-setup/_storyboard/host-tools/preflight', { method: 'GET' })
  })
})

describe('CanvasAgentSetupDialog', () => {
  it('supports multi-selection and gates install on an exact reviewed plan and consent', async () => {
    const hostClient = client({ plan: vi.fn().mockImplementation((ids) => Promise.resolve(plan(ids))) })
    render(
      <CanvasAgentSetupDialog
        open
        onOpenChange={vi.fn()}
        initialSelectedAgentIds={['codex']}
        preflight={preflight({ baseline: { status: 'outdated', minimumNodeMajor: 22 } })}
        client={hostClient}
      />,
    )

    expect(screen.getByText(/below the supported baseline/)).toBeVisible()
    expect(screen.queryByRole('checkbox', { name: /I reviewed this exact plan/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: /Claude/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Review setup plan' }))

    expect(await screen.findByText('Re-run host tools preflight')).toBeVisible()
    expect(hostClient.plan).toHaveBeenCalledWith(['codex', 'claude'])
    expect(screen.getByText('https://example.com/codex/install.sh')).toBeVisible()
    expect(screen.getByText('~/.local/bin/claude')).toBeVisible()
    expect(screen.getByText(/never asks for passwords, tokens, API keys/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Install selected CLIs' })).toBeDisabled()

    fireEvent.click(screen.getByRole('checkbox', { name: /I reviewed this exact plan/ }))
    expect(screen.getByRole('button', { name: 'Install selected CLIs' })).toBeEnabled()
  })

  it('polls operation progress and continues pending creation only after verified success', async () => {
    const onAgentReady = vi.fn()
    const hostClient = client({
      operation: vi.fn().mockResolvedValue(operation('succeeded', {
        output: [{ phase: 'agents', text: 'Codex installed' }],
        result: { partialSuccess: false, agents: { codex: { status: 'succeeded' } } },
      })),
    })
    render(
      <CanvasAgentSetupDialog
        open
        onOpenChange={vi.fn()}
        initialSelectedAgentIds={['codex']}
        pendingLaunchAgentId="codex"
        preflight={preflight()}
        onAgentReady={onAgentReady}
        client={hostClient}
        pollInterval={5}
      />,
    )

    await reviewAndStart(hostClient)
    expect(onAgentReady).not.toHaveBeenCalled()
    expect(await screen.findByText('Setup finished and selected agents passed verification.')).toBeVisible()
    expect(screen.getByLabelText('Installation output')).toHaveTextContent('Codex installed')
    expect(onAgentReady).toHaveBeenCalledWith('codex')
  })

  it('offers cancellation only while the server marks the operation cancellable', async () => {
    const running = operation('running', { cancellation: { available: true, requested: false } })
    const hostClient = client({
      install: vi.fn().mockResolvedValue(running),
      cancel: vi.fn().mockResolvedValue(operation('cancelled', {
        result: { partialSuccess: true, completedPhases: ['preflight'] },
      })),
    })
    render(
      <CanvasAgentSetupDialog
        open
        onOpenChange={vi.fn()}
        initialSelectedAgentIds={['codex']}
        preflight={preflight()}
        client={hostClient}
        pollInterval={10000}
      />,
    )

    await reviewAndStart(hostClient)
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel setup' }))

    await waitFor(() => expect(hostClient.cancel).toHaveBeenCalledWith('operation-1'))
    expect(await screen.findByText(/Completed changes were left in place/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Cancel setup' })).not.toBeInTheDocument()
  })

  it('retries request errors through a fresh preflight and plan', async () => {
    const hostClient = client({
      preflight: vi.fn().mockResolvedValue(preflight({ baseline: { status: 'partial' } })),
      plan: vi.fn()
        .mockRejectedValueOnce(new Error('Plan expired'))
        .mockResolvedValueOnce(plan()),
    })
    render(
      <CanvasAgentSetupDialog
        open
        onOpenChange={vi.fn()}
        initialSelectedAgentIds={['codex']}
        preflight={null}
        onPreflight={vi.fn()}
        client={hostClient}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Review setup plan' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Plan expired')
    fireEvent.click(screen.getByRole('button', { name: 'Retry with fresh check' }))

    await waitFor(() => expect(hostClient.preflight).toHaveBeenCalledOnce())
    await screen.findByText('Exact setup plan')
    expect(hostClient.plan).toHaveBeenCalledTimes(2)
  })

  it('handles null preflight data and disables setup on unsupported hosts', async () => {
    const hostClient = client()
    const { rerender } = render(
      <CanvasAgentSetupDialog open onOpenChange={vi.fn()} preflight={null} client={hostClient} />,
    )
    expect(screen.getByText('Host Node and npm status is unavailable.')).toBeVisible()

    await act(async () => {
      rerender(
        <CanvasAgentSetupDialog
          open
          onOpenChange={vi.fn()}
          initialSelectedAgentIds={['codex']}
          preflight={{ status: 'unsupported', support: null, baseline: null, agents: null }}
          client={hostClient}
        />,
      )
    })
    expect(screen.getByRole('button', { name: 'Review setup plan' })).toBeDisabled()
  })
})
