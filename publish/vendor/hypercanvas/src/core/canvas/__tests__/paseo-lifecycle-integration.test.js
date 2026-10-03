import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUNDLED_PASEO_VERSION, startDesktopPaseo } from '../paseo-daemon-lifecycle.js'
import { createPaseoConnection, ensurePaseoWorkspaceForRoot } from '../paseo-runtime-client.js'
import { PaseoTerminalRuntime } from '../paseo-terminal-runtime.js'
import { SiteRuntime, probeSite } from '../../site/runtime.js'
import { SiteStore } from '../../site/site.js'

const unavailableDefault = 'ws://127.0.0.1:0/ws'

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function waitForTerminalText(terminal, sessionId, marker, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  let output = ''
  while (Date.now() < deadline) {
    output = (await terminal.snapshot(sessionId)).text
    if (output.includes(marker)) return output
    await delay(100)
  }
  throw new Error(`Timed out waiting for ${marker} in PTY output: ${JSON.stringify(output)}`)
}

function workspaceCount(entries, workspaceId) {
  return entries.filter(entry => entry.id === workspaceId).length
}

async function availablePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return port
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

describe('Paseo daemon lifecycle integration contract', () => {
  it('qualifies ownership, Notebook workspaces, SDK access, a real PTY, persistence, and cleanup', async () => {
    const stateDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'hypercanvas-paseo-integration-')))
    let owner
    let reused
    let connection
    let terminal

    try {
      owner = await startDesktopPaseo({ stateDir, env: {}, defaultUrl: unavailableDefault })
      expect(owner).toMatchObject({ owned: true })
      expect(owner.serverId).toBeTruthy()

      connection = await createPaseoConnection(owner.connectionOptions)
      expect(connection.getDiagnostics().server).toMatchObject({
        serverId: owner.serverId,
        version: BUNDLED_PASEO_VERSION,
      })

      const notebook = path.join(stateDir, 'Notebook')
      const secondNotebook = path.join(stateDir, 'Second Notebook')
      fs.mkdirSync(notebook)
      fs.mkdirSync(secondNotebook)

      const workspaceId = await ensurePaseoWorkspaceForRoot(connection.client, notebook)
      expect(await ensurePaseoWorkspaceForRoot(connection.client, notebook)).toBe(workspaceId)
      const secondWorkspaceId = await ensurePaseoWorkspaceForRoot(connection.client, secondNotebook)
      expect(secondWorkspaceId).not.toBe(workspaceId)

      const workspaces = await connection.client.workspaces.list({})
      expect(workspaceCount(workspaces.entries, workspaceId)).toBe(1)
      expect(workspaceCount(workspaces.entries, secondWorkspaceId)).toBe(1)

      const providers = await connection.client.providers.listAvailable({})
      expect(Array.isArray(providers.providers)).toBe(true)
      expect(providers.providers.every(provider =>
        typeof provider.provider === 'string' && typeof provider.available === 'boolean')).toBe(true)

      const agents = await connection.client.agents.list({})
      expect(Array.isArray(agents.entries)).toBe(true)

      terminal = await new PaseoTerminalRuntime(notebook, { connection }).start()
      const sessionId = 'paseo-integration-qualification'
      const cwdProgram = [
        'const matches = process.cwd() === process.argv[1]',
        'process.stdout.write("PASEO_INTEGRATION_CWD_" + (matches ? "MATCH" : "MISMATCH") + "\\n")',
        'setInterval(() => {}, 1000)',
      ].join('; ')
      await terminal.create({
        sessionId,
        workspaceId,
        cwd: notebook,
        cols: 120,
        rows: 30,
        program: process.execPath,
        args: ['-e', cwdProgram, notebook],
      })

      expect(await waitForTerminalText(terminal, sessionId, 'PASEO_INTEGRATION_CWD_MATCH'))
        .toContain('PASEO_INTEGRATION_CWD_MATCH')
      const liveTerminals = await connection.daemon.listTerminals(notebook, undefined, { workspaceId })
      expect(liveTerminals.terminals).toEqual(expect.arrayContaining([
        expect.objectContaining({ cwd: notebook, workspaceId, name: `hypercanvas:${sessionId}` }),
      ]))
      await terminal.terminate(sessionId)
      terminal = null

      reused = await startDesktopPaseo({
        stateDir,
        env: {
          PASEO_DAEMON_URL: owner.url,
          PASEO_DAEMON_PASSWORD: owner.connectionOptions.password,
        },
      })
      expect(reused).toMatchObject({ owned: false, serverId: owner.serverId, child: null })
      await reused.stop()
      expect(owner.child.exitCode).toBeNull()
      expect(workspaceCount((await connection.client.workspaces.list({})).entries, workspaceId)).toBe(1)

      const firstDaemonChild = owner.child
      const persistentWorkspaceIds = [workspaceId, secondWorkspaceId]
      await connection.close()
      connection = null
      await owner.stop()
      owner = null
      expect(firstDaemonChild.exitCode !== null || firstDaemonChild.signalCode !== null).toBe(true)

      await expect(createPaseoConnection({
        url: reused.url,
        password: reused.connectionOptions.password,
        reconnect: { enabled: false },
        connectTimeoutMs: 1000,
      })).rejects.toThrow()

      owner = await startDesktopPaseo({ stateDir, env: {}, defaultUrl: unavailableDefault })
      connection = await createPaseoConnection(owner.connectionOptions)
      const persistedIds = [
        await ensurePaseoWorkspaceForRoot(connection.client, notebook),
        await ensurePaseoWorkspaceForRoot(connection.client, secondNotebook),
      ]
      expect(persistedIds).toEqual(persistentWorkspaceIds)
      const persistedWorkspaces = await connection.client.workspaces.list({})
      expect(workspaceCount(persistedWorkspaces.entries, workspaceId)).toBe(1)
      expect(workspaceCount(persistedWorkspaces.entries, secondWorkspaceId)).toBe(1)
    } finally {
      await terminal?.terminate('paseo-integration-qualification').catch(() => {})
      await terminal?.shutdown().catch(() => {})
      await connection?.close().catch(() => {})
      await reused?.stop()
      await owner?.stop()
      fs.rmSync(stateDir, { recursive: true, force: true })
    }
  }, 120_000)

  it('runs an external managed Site in a visible terminal tab owned by its Notebook workspace', async () => {
    const stateDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'hypercanvas-site-terminal-')))
    let owner
    let connection
    let terminal
    let runtime

    try {
      owner = await startDesktopPaseo({ stateDir, env: {}, defaultUrl: unavailableDefault })
      connection = await createPaseoConnection(owner.connectionOptions)

      const notebookRoot = path.join(stateDir, 'Notebook')
      const siteRoot = path.join(stateDir, 'External Site')
      fs.mkdirSync(notebookRoot, { recursive: true })
      fs.mkdirSync(siteRoot, { recursive: true })
      const workspaceId = await ensurePaseoWorkspaceForRoot(connection.client, notebookRoot)
      const installMarker = 'SITE_NPM_INSTALL_VISIBLE'
      fs.writeFileSync(path.join(siteRoot, 'package.json'), JSON.stringify({
        name: 'docs-site',
        version: '1.0.0',
        scripts: { preinstall: `node -e "process.stdout.write('${installMarker}\\n')"` },
      }, null, 2))
      fs.writeFileSync(path.join(siteRoot, '.npmrc'), 'audit=false\nfund=false\n')
      const serverFile = path.join(siteRoot, 'site-server.mjs')
      fs.writeFileSync(serverFile, [
        "import { createServer } from 'node:http'",
        'const port = Number(process.argv[2])',
        "process.stdout.write('SITE_TERMINAL_SERVER_READY\\n')",
        "createServer((_request, response) => response.end('SITE_TERMINAL_READY')).listen(port, '127.0.0.1')",
      ].join('\n'))
      const port = await availablePort()
      const url = `http://127.0.0.1:${port}/`
      const store = new SiteStore(notebookRoot)
      store.upsert({ id: 'docs', title: 'Docs' })
      store.upsertBinding('docs', {
        source: 'managed',
        root: siteRoot,
        workspaceId,
        startCommand: `${shellQuote(process.execPath)} ${shellQuote(serverFile)} ${port}`,
        developmentBaseUrl: url,
      })

      terminal = await new PaseoTerminalRuntime(notebookRoot, { connection }).start()
      runtime = new SiteRuntime(store, { ptyRuntime: terminal, requirePtyRuntime: true })
      await runtime.start('docs', { confirmed: true, timeoutMs: 15_000 })

      const runningTerminals = await connection.daemon.listTerminals(undefined, undefined, { workspaceId })
      expect(runningTerminals.terminals).toEqual(expect.arrayContaining([
        expect.objectContaining({
          cwd: notebookRoot,
          workspaceId,
          name: 'hypercanvas:site:docs',
        }),
      ]))
      expect(runningTerminals.terminals.find(terminal => terminal.name === 'hypercanvas:site:docs')?.title)
        .toContain('External Site')
      expect((await connection.client.workspaces.list({})).entries.map(workspace => workspace.id)).toEqual([workspaceId])
      expect(store.getBinding('docs')).toMatchObject({ workspaceId, root: siteRoot })
      expect(await (await fetch(url)).text()).toBe('SITE_TERMINAL_READY')
      const terminalOutput = runtime.getLogs('docs').map(entry => entry.message).join('\n')
      expect(terminalOutput).toContain(installMarker)
      expect(terminalOutput).toContain('SITE_TERMINAL_SERVER_READY')
      expect(terminalOutput.indexOf(installMarker)).toBeLessThan(terminalOutput.indexOf('SITE_TERMINAL_SERVER_READY'))

      await runtime.stop('docs')
      await expect(probeSite(url)).resolves.toMatchObject({ reachable: false })
      const stoppedTerminals = await connection.daemon.listTerminals(undefined, undefined, { workspaceId })
      expect(stoppedTerminals.terminals).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'hypercanvas:site:docs' }),
      ]))
      expect(store.getBinding('docs')).toMatchObject({ status: 'stopped' })
      expect(store.getBinding('docs')).not.toHaveProperty('terminalSessionId')
    } finally {
      await runtime?.close().catch(() => {})
      await terminal?.shutdown().catch(() => {})
      await connection?.close().catch(() => {})
      await owner?.stop()
      fs.rmSync(stateDir, { recursive: true, force: true })
    }
  }, 120_000)
})
