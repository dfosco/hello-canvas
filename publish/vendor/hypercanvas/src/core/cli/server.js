/**
 * storyboard server — inspect and control the single global Hypercanvas instance.
 *
 * One instance per machine owns one selected proxy port (ADR-007). `list` and
 * `status` probe it; bare `start` launches the instance when absent; `stop`
 * terminates it. Worktree-targeted starts are disconnected from the CLI —
 * Notebook switching happens inside the running instance instead. The
 * previous worktree implementation is retained below as
 * DEPRECATED_serverStartWorktree for a future refactor and is no longer
 * reachable through routing or help.
 *
 * Usage:
 *   storyboard server               Show the running instance
 *   storyboard server list          Show the running instance
 *   storyboard server status        Show instance details
 *   storyboard server start         Start the instance when absent (detached)
 *   storyboard server stop          Stop the instance
 */

import * as p from '@clack/prompts'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { detectWorktreeName, repoRoot, worktreeDir } from '../worktree/port.js'
import { findByWorktree } from '../worktree/serverRegistry.js'
import { findExistingInstance, probeInstanceEndpoint } from '../server/instance-claim.js'
import { DEFAULT_INSTANCE_PORT } from '../server/instance-proxy.js'
import { readConfiguredInstanceProxyPort, resolveInstanceProxyPort } from './devContract.js'
import { parseFlags } from './flags.js'
import { dim, green } from './intro.js'
import { createPaseoServerEnvironment, withoutRuntimeCredentials } from '../runtimeEnvironment.js'

const flagSchema = {}

function instancePort() {
  const configuredPort = readConfiguredInstanceProxyPort({
    cwd: process.cwd(),
    notebookRoot: process.env.HYPERCANVAS_NOTEBOOK_ROOT,
  })
  return resolveInstanceProxyPort(process.env, configuredPort ?? undefined) ?? DEFAULT_INSTANCE_PORT
}

async function findInstance() {
  return findExistingInstance({ port: instancePort() })
}

function disconnectedNotice(command) {
  p.log.error(`Worktree-targeted \`server ${command}\` is disconnected under the single-instance model.`)
  p.log.info('Switch Notebooks inside the running Hypercanvas instance instead.')
  process.exit(1)
}

async function serverList() {
  const found = await findInstance()
  if (!found) {
    p.log.info('No Hypercanvas instance running.')
    p.log.info(dim('Start one with: storyboard server start'))
    return
  }
  p.log.info('Hypercanvas instance:\n')
  printInstance(found.instance, found.port)
  console.log()
  p.log.info(dim('Stop it with: storyboard server stop'))
}

async function serverStatus() {
  const found = await findInstance()
  if (!found) {
    p.log.info('No Hypercanvas instance running.')
    return
  }
  const { instance, port } = found
  printInstance(instance, port)
  console.log(`  version:  ${instance.version || 'unknown'}`)
  console.log(`  ready:    ${instance.ready ? 'yes' : 'starting'}`)
  const notebook = instance.notebook || {}
  console.log(`  notebook: ${notebook.title || 'none'}${notebook.root ? ` (${notebook.root})` : ''}`)
}

function printInstance(instance, port) {
  console.log(`  ${green('running')}  :${String(port).padEnd(5)}  PID ${String(instance.pid).padEnd(7)}  ${instance.url || ''}`)
}

async function waitForInstance(port, { ready = false, timeoutMs = 30000 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const found = await findExistingInstance({ port })
    if (found && (!ready || found.instance.ready)) return found
    await new Promise(r => setTimeout(r, 500))
  }
  return null
}

async function serverStart() {
  const port = instancePort()
  const running = await findInstance()
  if (running?.instance.url) {
    p.log.info(`Hypercanvas is already running at ${running.instance.url}`)
    return
  }

  p.log.step('Spawning detached Hypercanvas Core…')
  const npmBin = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const child = spawn(npmBin, ['storyboard', 'dev'], {
    cwd: repoRoot(),
    detached: true,
    stdio: 'ignore',
    env: createPaseoServerEnvironment(withoutRuntimeCredentials({
      ...process.env,
      HYPERCANVAS_PROXY_PORT: String(port),
    }), {
      url: process.env.PASEO_DAEMON_URL,
      password: process.env.PASEO_DAEMON_PASSWORD,
      authHeader: process.env.PASEO_DAEMON_AUTH_HEADER,
    }),
  })
  child.unref()

  // Poll for up to ~30s while Core claims its selected socket and reports
  // readiness. Discovery remains independent of the final selected port.
  const found = await waitForInstance(port, { ready: true })
  if (found?.instance.url) {
    p.log.success(`${found.instance.url}  (pid ${found.instance.pid})`)
  } else {
    p.log.warn('Spawned but the instance did not become ready within 30s — check it manually.')
  }
}

async function serverStop() {
  const found = await findInstance()
  if (!found) {
    p.log.info('No Hypercanvas instance running.')
    return
  }
  const { port, instance } = found
  try {
    process.kill(instance.pid, 'SIGTERM')
  } catch (err) {
    if (err.code === 'ESRCH') p.log.info(`Instance (pid ${instance.pid}) was already dead.`)
    else p.log.error(`Failed to kill pid ${instance.pid}: ${err.message}`)
    return
  }
  const start = Date.now()
  while (Date.now() - start < 10000) {
    await new Promise(r => setTimeout(r, 500))
    if (!await probeInstanceEndpoint({ port })) {
      p.log.success(`Stopped the Hypercanvas instance (pid ${instance.pid}, port ${port} freed)`)
      return
    }
  }
  p.log.warn(`Signaled pid ${instance.pid} but port ${port} is still bound — check it manually.`)
}

/**
 * DEPRECATED — worktree-targeted start, disconnected from the CLI.
 *
 * Retained for a future refactor; do not route to it. The single-instance
 * model (ADR-007) replaced per-worktree servers with one global instance.
 */
async function DEPRECATED_serverStartWorktree(branchArg, flags) {
  const worktreeName = branchArg || detectWorktreeName()
  const targetCwd = resolveTargetCwd(worktreeName)

  if (!targetCwd) {
    p.log.error(`Worktree "${worktreeName}" does not exist.`)
    p.log.info(`Create it with: storyboard branch ${worktreeName}`)
    process.exit(1)
  }

  if (!flags.multiple) {
    const existing = findByWorktree(worktreeName)
    if (existing.length > 0) {
      p.log.warn(`Server already running for "${worktreeName}" (id ${existing[0].id}, port ${existing[0].port}).`)
      p.log.info(`URL: http://localhost:${existing[0].port}/storyboard/`)
      p.log.info(`Stop it with: storyboard server stop ${existing[0].id}`)
      return
    }
  }

  p.log.step(`Spawning detached dev server for "${worktreeName}"…`)
  const npmBin = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const child = spawn(npmBin, ['storyboard', 'dev'], {
    cwd: targetCwd,
    detached: true,
    stdio: 'ignore',
    env: createPaseoServerEnvironment(withoutRuntimeCredentials(process.env), {
      url: process.env.PASEO_DAEMON_URL,
      password: process.env.PASEO_DAEMON_PASSWORD,
      authHeader: process.env.PASEO_DAEMON_AUTH_HEADER,
    }),
  })
  child.unref()

  const start = Date.now()
  let entry = null
  while (Date.now() - start < 30000) {
    await new Promise(r => setTimeout(r, 500))
    const matches = findByWorktree(worktreeName)
    if (matches.length > 0) { entry = matches[matches.length - 1]; break }
  }

  if (entry) {
    p.log.success(`http://localhost:${entry.port}/storyboard/  (id ${entry.id}, pid ${entry.pid})`)
  } else {
    p.log.warn(`Spawned but did not self-register within 30s — check the worktree manually.`)
  }
}

// Referenced so the retained implementation survives lint while disconnected.
void DEPRECATED_serverStartWorktree

function resolveTargetCwd(name) {
  if (!name || name === 'main') return repoRoot()
  const dir = worktreeDir(name)
  if (!existsSync(resolve(dir, '.git'))) return null
  return dir
}

async function main() {
  const { positional } = parseFlags(process.argv.slice(3), flagSchema)
  const subcommand = positional[0]

  p.intro('storyboard server')

  switch (subcommand) {
    case undefined:
    case 'list':
      await serverList()
      break
    case 'status':
      await serverStatus()
      break
    case 'start':
      if (positional[1]) disconnectedNotice('start')
      await serverStart()
      break
    case 'stop':
      if (positional[1]) disconnectedNotice('stop')
      await serverStop()
      break
    default:
      p.log.error(`Unknown server command "${subcommand}".`)
      p.log.info(dim('Available: list, status, start, stop'))
      process.exit(1)
  }
  p.outro('')
}

main().catch((err) => {
  p.log.error(err.message || String(err))
  process.exit(1)
})
