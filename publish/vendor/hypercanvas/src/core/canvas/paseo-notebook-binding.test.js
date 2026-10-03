import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  confirmNotebookPaseoBinding,
  getNotebookPaseoBinding,
  invalidateNotebookPaseoBinding,
  paseoDaemonOwnership,
  resetNotebookPaseoBindingForTests,
} from './paseo-notebook-binding.js'

const mocks = vi.hoisted(() => ({
  getPaseoConnection: vi.fn(),
  getPaseoConnectionDiagnostics: vi.fn(),
}))
vi.mock('./paseo-runtime-client.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    getPaseoConnection: mocks.getPaseoConnection,
    getPaseoConnectionDiagnostics: mocks.getPaseoConnectionDiagnostics,
  }
})

const temporary = []
function notebookRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hypercanvas-binding-'))
  temporary.push(root)
  return root
}

function fakeConnection({ serverId = 'server-a', workspaceId = 'workspace-a', status = 'connected' } = {}) {
  const connection = {
    reconnectHandler: null,
    client: {
      workspaces: {
        open: vi.fn(async ({ cwd }) => ({ id: workspaceId, workspaceDirectory: cwd })),
      },
    },
    daemon: {
      getConnectionState: () => ({ status }),
      getLastServerInfoMessage: () => ({ serverId, version: '0.8.0-beta.1' }),
      subscribeConnectionStatus: vi.fn((handler) => { connection.reconnectHandler = handler; return () => {} }),
    },
    getDiagnostics: () => ({
      status,
      connected: status === 'connected',
      state: { status },
      server: { serverId, version: '0.8.0-beta.1' },
    }),
    close: vi.fn().mockResolvedValue(undefined),
  }
  return connection
}

function reportDiagnostics(connection) {
  mocks.getPaseoConnectionDiagnostics.mockReturnValue(connection.getDiagnostics())
}

afterEach(async () => {
  delete process.env.HYPERCANVAS_PASEO_DAEMON_OWNED
  await resetNotebookPaseoBindingForTests()
  mocks.getPaseoConnection.mockReset()
  mocks.getPaseoConnectionDiagnostics.mockReset()
  for (const root of temporary.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('paseoDaemonOwnership', () => {
  it('maps the Core daemon-lifecycle env marker to reused | owned | unknown', () => {
    expect(paseoDaemonOwnership({})).toBe('unknown')
    expect(paseoDaemonOwnership({ HYPERCANVAS_PASEO_DAEMON_OWNED: '0' })).toBe('reused')
    expect(paseoDaemonOwnership({ HYPERCANVAS_PASEO_DAEMON_OWNED: '1' })).toBe('owned')
  })
})

describe('confirmNotebookPaseoBinding', () => {
  it('confirms a server identity and workspace for the Notebook root', async () => {
    const connection = fakeConnection()
    mocks.getPaseoConnection.mockResolvedValue(connection)
    reportDiagnostics(connection)

    const confirmed = await confirmNotebookPaseoBinding(notebookRoot())

    expect(confirmed).toMatchObject({
      state: 'confirmed',
      serverId: 'server-a',
      workspaceId: 'workspace-a',
      ownership: 'unknown',
    })
    expect(getNotebookPaseoBinding()).toMatchObject({ state: 'confirmed', serverId: 'server-a', workspaceId: 'workspace-a' })
  })

  it('keeps the confirmed binding across repeat confirmations on the same daemon', async () => {
    const connection = fakeConnection()
    mocks.getPaseoConnection.mockResolvedValue(connection)
    reportDiagnostics(connection)
    const root = notebookRoot()

    await confirmNotebookPaseoBinding(root)
    const second = await confirmNotebookPaseoBinding(root)

    expect(second.state).toBe('confirmed')
    expect(mocks.getPaseoConnection).toHaveBeenCalledOnce()
    expect(connection.client.workspaces.open).toHaveBeenCalledOnce()
  })

  it('re-resolves and never reuses a workspace ID from another Paseo server', async () => {
    const first = fakeConnection({ serverId: 'server-a', workspaceId: 'workspace-a' })
    const second = fakeConnection({ serverId: 'server-b', workspaceId: 'workspace-b' })
    mocks.getPaseoConnection.mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    reportDiagnostics(first)
    const root = notebookRoot()

    await confirmNotebookPaseoBinding(root)
    reportDiagnostics(second)
    const confirmed = await confirmNotebookPaseoBinding(root)

    expect(confirmed).toMatchObject({ serverId: 'server-b', workspaceId: 'workspace-b' })
    expect(first.client.workspaces.open).toHaveBeenCalledOnce()
    expect(second.client.workspaces.open).toHaveBeenCalledOnce()
  })

  it('coalesces concurrent confirmations for the same root', async () => {
    const connection = fakeConnection()
    reportDiagnostics(connection)
    mocks.getPaseoConnection.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(connection), 5)))
    const root = notebookRoot()

    const [a, b] = await Promise.all([
      confirmNotebookPaseoBinding(root),
      confirmNotebookPaseoBinding(root),
    ])

    expect(a.workspaceId).toBe(b.workspaceId)
    expect(mocks.getPaseoConnection).toHaveBeenCalledOnce()
  })

  it('records registration failures so they stay visible', async () => {
    const connection = fakeConnection()
    mocks.getPaseoConnection.mockResolvedValue(connection)
    reportDiagnostics(connection)
    connection.client.workspaces.open.mockRejectedValue(new Error('registration rejected'))

    await expect(confirmNotebookPaseoBinding(notebookRoot())).rejects.toThrow('registration rejected')
    expect(getNotebookPaseoBinding()).toMatchObject({ state: 'failed' })
    expect(getNotebookPaseoBinding().lastError).toMatchObject({ message: 'registration rejected' })
  })

  it('reports stale once the connection is no longer connected', async () => {
    const connection = fakeConnection({ status: 'disconnected' })
    mocks.getPaseoConnection.mockResolvedValue(connection)
    reportDiagnostics(connection)

    await confirmNotebookPaseoBinding(notebookRoot())
    expect(getNotebookPaseoBinding().state).toBe('stale')

    invalidateNotebookPaseoBinding()
    expect(getNotebookPaseoBinding().state).toBe('idle')
  })

  it('invalidates on daemon reconnect when the server identity changes', async () => {
    const connection = fakeConnection({ serverId: 'server-a', workspaceId: 'workspace-a' })
    mocks.getPaseoConnection.mockResolvedValue(connection)
    reportDiagnostics(connection)
    const root = notebookRoot()

    await confirmNotebookPaseoBinding(root)
    expect(getNotebookPaseoBinding()).toMatchObject({ serverId: 'server-a', workspaceId: 'workspace-a' })

    // The daemon reconnects as a different Paseo server.
    connection.daemon.getLastServerInfoMessage = () => ({ serverId: 'server-b', version: '0.8.0-beta.1' })
    connection.getDiagnostics = () => ({
      status: 'connected',
      connected: true,
      state: { status: 'connected' },
      server: { serverId: 'server-b', version: '0.8.0-beta.1' },
    })
    reportDiagnostics(connection)
    connection.reconnectHandler?.({ status: 'connected' })

    expect(getNotebookPaseoBinding().state).toBe('idle')

    // The next confirmation resolves a workspace from the new server.
    connection.client.workspaces.open = vi.fn(async ({ cwd }) => ({ id: 'workspace-b', workspaceDirectory: cwd }))
    const confirmed = await confirmNotebookPaseoBinding(root)
    expect(confirmed).toMatchObject({ serverId: 'server-b', workspaceId: 'workspace-b' })
  })
})
