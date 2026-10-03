/**
 * storyboard dev — start the single global Hypercanvas instance.
 *
 * The first action is the global instance claim (ADR-007): a loopback proxy
 * binds the configured port (default 1234), advancing past foreign listeners,
 * before any scaffold, Paseo, or Vite work. A duplicate launch reports the
 * running instance and exits instead of starting a second runtime. The
 * `/_storyboard/*` API endpoints are mounted by `core/vite/server-plugin` as
 * Vite middleware, so a single child process owns everything behind the proxy.
 *
 * Usage:
 *   storyboard dev          # start in current cwd
 *   storyboard dev --port=N # override the Vite backend port
 *
 * Env:
 *   HYPERCANVAS_PROXY_PORT=0    # bind an ephemeral proxy port (e2e isolation)
 *   HYPERCANVAS_INSTANCE_PROXY=0 # skip the claim entirely (legacy behavior)
 */

import * as p from '@clack/prompts'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { dirname, resolve, join } from 'node:path'
import { createRequire } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { detectWorktreeName, getPort, releasePort } from '../worktree/port.js'
import { startFileWatcher } from '../file-watcher/watcher.js'
import { compactAll } from '../canvas/compact.js'
import { parseFlags } from './flags.js'
import { setupNeeded, writeUserState, getInstalledStoryboardVersion } from './userState.js'
import { dim, magenta, bold } from './intro.js'
import { resolveBasePath } from './serverUrl.js'
import { rmSync } from 'node:fs'
import { desktopUrl, encodeDesktopEvent, ignoreBrokenPipeErrors, parseViteDesktopEvent, readConfiguredInstanceProxyPort, readConfiguredUsePaseoApp, resolveInstanceProxyPort, selectEphemeralPort } from './devContract.js'
import { resolveStartupNotebook, runStartupScaffolds } from './startupScaffolds.js'
import { resolveNotebookStateDirectory } from '../notebook/stateDirectory.js'
import { encodeWrapperEvent } from '../server/wrapper-contract.js'
import { INSTANCE_HOSTNAME } from '../server/instance-proxy.js'
import { attemptInstanceClaimWithFallback } from '../server/instance-claim.js'
import { startDesktopPaseo } from '../canvas/paseo-daemon-lifecycle.js'
import { createPaseoServerEnvironment, withoutRuntimeCredentials } from '../runtimeEnvironment.js'

let desktopPaseo
let instanceProxy = null

/** Find the mascot directory shipped with the storyboard package. */
function mascotPaths(targetCwd) {
  // Prefer a user override at project root, fall back to the library dir.
  const userConfig = join(targetCwd, 'mascot.config.json')
  const userDir = join(targetCwd, 'mascot')
  if (existsSync(userConfig) && existsSync(userDir)) {
    return { configPath: userConfig, framesDir: userDir }
  }
  // dev.js → src/core/cli/dev.js → package root is 3 dirs up.
  const libRoot = resolve(import.meta.dirname, '..', '..', '..')
  return {
    configPath: join(libRoot, 'mascot.config.json'),
    framesDir: join(libRoot, 'mascot'),
  }
}

/** Apply magenta to the mascot's eye glyphs, dim to the dots/frame. */
function colorizeMascot(text) {
  const eyes = /[●◠◡]/g
  return text
    .split('\n')
    .map((line) => line.replace(eyes, (m) => magenta(m)).replace(/[·│╭╮╰╯─]/g, (m) => dim(m)))
    .join('\n')
}

/**
 * Render the mascot with an in-place loop animation, then settle on the
 * configured final frame with the URL beside it.
 *
 * Called AFTER Vite prints "ready in Xms" and the storyboard-server plugin
 * has suppressed Vite's own URL block. From this moment, Vite is in idle
 * watch mode and won't print again unless code changes — so our cursor-up
 * redraws can safely own the bottom of the screen.
 */
function renderMascot({ configPath, framesDir }, urlLine, stopLine) {
  if (!existsSync(configPath)) return false
  let config
  try { config = JSON.parse(readFileSync(configPath, 'utf8')) } catch { return false }
  if (config.enabled === false) return false
  const rawEntries = Array.isArray(config.frames) ? config.frames : []
  if (rawEntries.length === 0) return false
  const defaultDuration = Number(config.frameDurationMs) || 180
  const loops = Math.max(1, Number(config.loops) || 1)

  // Each entry is either a string filename or a [filename, delayMs] tuple.
  // Per-frame delay falls back to frameDurationMs when missing.
  const entries = rawEntries.map((e) => {
    if (Array.isArray(e)) return { name: String(e[0]), delay: Number(e[1]) || defaultDuration }
    return { name: String(e), delay: defaultDuration }
  })
  const settleName = config.settleFrame || entries[entries.length - 1].name

  let rawFrames
  try { rawFrames = entries.map((e) => readFileSync(join(framesDir, e.name), 'utf8')) } catch { return false }
  let settleRaw
  try { settleRaw = readFileSync(join(framesDir, settleName), 'utf8') } catch { settleRaw = rawFrames[rawFrames.length - 1] }

  // Pad every frame to the same height/width so cursor-up redraws fully
  // overwrite the previous frame.
  const trim = (s) => s.replace(/\n+$/, '')
  const split = [...rawFrames, settleRaw].map((f) => trim(f).split('\n'))
  const maxLines = Math.max(...split.map((l) => l.length))
  const maxCols = Math.max(...split.flatMap((lines) => lines.map((l) => l.length)))
  const normalized = split.map((lines) => {
    while (lines.length < maxLines) lines.push('')
    return lines.map((l) => l.padEnd(maxCols, ' ')).join('\n')
  })
  const loopFrames = normalized.slice(0, -1)
  const settleFrame = normalized[normalized.length - 1]
  const lineCount = maxLines

  const composeSettle = () => {
    const lines = colorizeMascot(settleFrame).split('\n')
    if (lines[1] != null) lines[1] = lines[1] + '  ' + urlLine
    if (lines[2] != null) lines[2] = lines[2] + '  ' + stopLine
    return lines.join('\n')
  }

  if (!process.stdout.isTTY) {
    process.stdout.write(composeSettle() + '\n')
    return true
  }

  // Reserve vertical space with blank lines so cursor-up redraws have a
  // stable region to overwrite.
  process.stdout.write('\n'.repeat(lineCount))
  const draw = (frame) => {
    process.stdout.write(`\x1b[${lineCount}A`)
    for (const line of frame.split('\n')) {
      process.stdout.write('\x1b[2K' + line + '\n')
    }
  }

  return new Promise((resolveAnim) => {
    let loopIdx = 0
    let frameIdx = 0
    // Recursive setTimeout so each frame can have its own delay.
    const step = () => {
      if (loopIdx >= loops) {
        draw(composeSettle())
        resolveAnim(true)
        return
      }
      draw(colorizeMascot(loopFrames[frameIdx]))
      const thisDelay = entries[frameIdx].delay
      frameIdx++
      if (frameIdx >= loopFrames.length) { frameIdx = 0; loopIdx++ }
      const t = setTimeout(step, thisDelay)
      if (typeof t.unref === 'function') t.unref()
    }
    step()
  })
}

const flagSchema = {
  port: { type: 'number', description: 'Override dev server port' },
  host: { type: 'string', description: 'Override dev server host' },
  'strict-port': { type: 'boolean', default: false, description: 'Fail instead of selecting another port' },
  desktop: { type: 'boolean', default: false, description: 'Emit machine-readable desktop lifecycle events' },
  'no-buddy': { type: 'boolean', default: false, description: 'Omit the storyboard mascot' },
  verbose: { type: 'boolean', default: false, description: 'Show full setup/Vite output' },
}

/** Read the Vite backend port from storyboard.config.json, if any. */
function readConfiguredPort(cwd) {
  const file = resolve(cwd, 'storyboard.config.json')
  if (!existsSync(file)) return null
  try {
    const cfg = JSON.parse(readFileSync(file, 'utf8'))
    const n = Number(cfg.port)
    return Number.isInteger(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

async function main() {
  const { flags, positional, errors } = parseFlags(process.argv.slice(3), flagSchema)
  if (errors.length > 0) throw new Error(errors.join('; '))
  if (positional.length > 0) throw new Error(`Unexpected arguments: ${positional.join(' ')}`)

  const verbose = flags.verbose
  const desktop = flags.desktop
  const wrapper = desktop && process.env.HYPERCANVAS_WRAPPER === '1'
  // Core outlives its replaceable Notebook Vite worker. Sign browser sessions
  // with a per-Core-run secret so a worker restart does not invalidate the
  // browser cookie or require a new wrapper launch handoff.
  const browserSessionSecret = wrapper ? randomBytes(32).toString('base64url') : null
  const encodeRuntimeEvent = wrapper ? encodeWrapperEvent : encodeDesktopEvent
  if (!desktop && flags.port === 0) {
    throw new Error('--port 0 requires --desktop so the resolved URL can be reported')
  }
  const host = flags.host || (desktop ? '127.0.0.1' : 'localhost')
  if (desktop && host !== '127.0.0.1') {
    throw new Error(`Desktop mode requires host 127.0.0.1, received ${host}`)
  }
  const worktreeName = detectWorktreeName()
  const targetCwd = resolve(process.cwd())

  // Global instance claim (ADR-007): bind the preferred proxy port before
  // scaffolds/Paseo/Vite, skipping foreign listeners until a port is free.
  const configuredProxyPort = readConfiguredInstanceProxyPort({
    cwd: targetCwd,
    notebookRoot: process.env.HYPERCANVAS_NOTEBOOK_ROOT,
  })
  const instanceProxyPort = resolveInstanceProxyPort(process.env, configuredProxyPort ?? undefined)
  let instanceProxyUrl = null
  let proxyRegistrationToken = null
  if (instanceProxyPort !== null) {
    proxyRegistrationToken = randomBytes(32).toString('base64url')
    const claim = await attemptInstanceClaimWithFallback({
      port: instanceProxyPort,
      registrationToken: proxyRegistrationToken,
      instanceInfo: {
        url: `http://${INSTANCE_HOSTNAME}:${instanceProxyPort}/`,
        version: getInstalledStoryboardVersion(targetCwd),
        notebook: process.env.HYPERCANVAS_NOTEBOOK_ROOT
          ? { root: process.env.HYPERCANVAS_NOTEBOOK_ROOT, title: null }
          : null,
      },
    })
    if (claim.kind === 'exhausted') throw new Error(claim.detail)
    if (claim.kind === 'running') {
      if (desktop) {
        process.stdout.write(`${encodeRuntimeEvent('running', { url: claim.url, token: claim.token, instance: claim.instance })}\n`)
      } else if (claim.url) {
        p.log.info(`Hypercanvas is already running at ${claim.url}`)
        if (claim.instance?.notebook?.title) p.log.info(`Active Notebook: ${claim.instance.notebook.title}`)
      } else {
        p.log.info('Hypercanvas is already running.')
      }
      process.exit(0)
    }
    if (!desktop && claim.proxy.port !== instanceProxyPort && instanceProxyPort !== 0) {
      p.log.warn(`Proxy port ${instanceProxyPort} is occupied; using port ${claim.proxy.port}.`)
    }
    instanceProxy = claim.proxy
    instanceProxyUrl = `http://${INSTANCE_HOSTNAME}:${claim.proxy.port}/`
    instanceProxy.setInstanceInfo({ url: instanceProxyUrl })
  }

  const profile = process.env.HYPERCANVAS_SCAFFOLD_PROFILE
    || (desktop && process.env.HYPERCANVAS_PRODUCTION_BUNDLE === '1' ? 'production' : 'development')
  process.env.HYPERCANVAS_NOTEBOOK_STATE_DIR ||= resolveNotebookStateDirectory({ profile })
  try {
    const scaffolds = runStartupScaffolds({ profile })
    if (scaffolds['demo-notebook']) {
      process.env.HYPERCANVAS_NOTEBOOK_ROOT = resolveStartupNotebook({
        profile,
        activeNotebook: process.env.HYPERCANVAS_NOTEBOOK_ROOT,
        stateDirectory: process.env.HYPERCANVAS_NOTEBOOK_STATE_DIR,
        fallback: scaffolds['demo-notebook'],
      })
    }
    if (verbose) p.log.info(`Startup scaffolds ready (${profile})`)
  } catch (error) {
    throw new Error(`Startup scaffolding failed: ${error.message}`, { cause: error })
  }

  // Port resolution priority (Vite always rolls forward to the next free
  // port — never strict, even when storyboard.config.json pins a port):
  //   1. --port CLI flag
  //   2. config.port from storyboard.config.json — but ONLY for the main
  //      worktree. Worktrees ignore the pinned port so they can run
  //      concurrently with main on auto-assigned ports.
  //   3. auto-assigned per-worktree port
  const rawConfiguredPort = readConfiguredPort(targetCwd)
  const configuredPort = worktreeName === 'main' ? rawConfiguredPort : null
  const requestedPort = flags.port ?? configuredPort ?? getPort(worktreeName)
  const port = desktop && requestedPort === 0
    ? await selectEphemeralPort(host)
    : requestedPort
  const basePath = resolveBasePath(targetCwd)
  const devUrl = instanceProxy ? `${instanceProxyUrl}${basePath.slice(1)}` : desktopUrl(host, port, basePath)
  instanceProxy?.setInstanceInfo({ url: devUrl })

  // Quiet header: just `worktree: …` and `port: …`. Everything else
  // (setup logs, compaction, intro/outro frames) is hidden unless --verbose.
  if (desktop) {
    process.stdout.write(`${encodeRuntimeEvent('starting', { host, port, pid: process.pid })}\n`)
  } else if (verbose) {
    p.intro('storyboard dev')
    p.log.info(`worktree: ${worktreeName}`)
  } else {
    console.log(`  ${dim('worktree:')} ${bold(worktreeName)}`)
  }

  // Re-run setup automatically if it has never run here, or if the installed
  // @dfosco/storyboard version no longer matches the one setup was last run
  // against. This lets `npm install` upgrades trigger fresh scaffolding
  // without requiring `npx storyboard update`.
  {
    const need = desktop ? null : setupNeeded(targetCwd)
    if (need) {
      const why = need.reason === 'first-run'
        ? 'first run in this repo'
        : `version changed ${need.from} → ${need.to}`
      if (verbose) p.log.info(`Running setup (${why})…`)

      // Invalidate Vite's optimize-deps cache when the storyboard version
      // changes. Otherwise the browser hits 504 Outdated Optimize Dep
      // because the dep graph IDs no longer match the cached chunks.
      try { rmSync(join(targetCwd, 'node_modules', '.vite'), { recursive: true, force: true }) } catch { /* empty */ }
      await new Promise((resolveSetup) => {
        const setupChild = spawn(
          process.platform === 'win32' ? 'npx.cmd' : 'npx',
          ['storyboard', 'setup', '--skip-branch', '--no-buddy'],
          {
            cwd: targetCwd,
            // In quiet mode swallow the spawned-setup output; verbose passes through.
            stdio: verbose ? 'inherit' : 'ignore',
            env: withoutRuntimeCredentials({ ...process.env, STORYBOARD_NO_BUDDY: '1' }),
          }
        )
        setupChild.on('exit', () => resolveSetup())
        setupChild.on('error', () => resolveSetup())
      })
      const version = getInstalledStoryboardVersion(targetCwd)
      if (version) writeUserState({ setupVersion: version, setupRanAt: new Date().toISOString() }, targetCwd)
    }
  }

  // Compact bloated canvas JSONL files before booting Vite.
  const compacted = compactAll(targetCwd)
  if (verbose) {
    for (const r of compacted) {
      p.log.info(`[compact] ${r.name}: ${(r.before / 1024).toFixed(0)}KB → ${(r.after / 1024).toFixed(0)}KB`)
    }
  }

  const renameWatcher = startFileWatcher(targetCwd)
  // Note: no background compaction timer — the previous 15-min interval
  // would silently wipe per-tab undo history mid-session. Files are now
  // compacted on dev startup (above) and via a 2 MB hard-ceiling check
  // inside the canvas server's appendEvent (kicks in only for runaway
  // sessions that genuinely need it).

  const npmBin = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const viteArgs = ['vite', '--host', host]
  if (port !== 0) viteArgs.push('--port', String(port))
  if ((desktop && port !== 0) || flags['strict-port']) viteArgs.push('--strictPort')
  if (!desktop) console.log(`  ${dim('port:')} ${bold(port)}`)
  const viteCommand = desktop ? process.execPath : npmBin
  const commandArgs = desktop
    ? [join(dirname(createRequire(import.meta.url).resolve('vite/package.json')), 'bin/vite.js'), ...viteArgs.slice(1)]
    : viteArgs

  if (desktop && process.env.STORYBOARD_TEST_SKIP_PASEO !== '1') {
    desktopPaseo = await startDesktopPaseo({
      stateDir: process.env.HYPERCANVAS_APP_STATE_DIR,
      env: { ...process.env },
      usePaseoApp: readConfiguredUsePaseoApp({ cwd: targetCwd, notebookRoot: process.env.HYPERCANVAS_NOTEBOOK_ROOT }),
    })
    // Paseo readiness is intermediate. The Tauri compatibility host may log
    // it, but the Rust wrapper waits for Core's final HTTP-ready event.
    if (!wrapper) process.stdout.write(`${encodeDesktopEvent('paseo-ready', { owned: desktopPaseo.owned, usePaseoApp: desktopPaseo.usePaseoApp, serverId: desktopPaseo.serverId || null, reuseProbeFailure: desktopPaseo.reuseProbeFailure || null })}\n`)
    process.stderr.write(`[hypercanvas] Paseo: ${desktopPaseo.owned ? 'private daemon' : 'Paseo App/configured daemon'} (${desktopPaseo.serverId}).${desktopPaseo.reuseProbeFailure ? ` App daemon probe failed: ${desktopPaseo.reuseProbeFailure}.` : ''} Daemon selection changes require an app restart.\n`)
  }
  const viteEnvironment = desktop
    ? createPaseoServerEnvironment(process.env, desktopPaseo?.connectionOptions, desktopPaseo || {})
    : { ...process.env }

  const showBuddy = !flags['no-buddy'] && process.env.STORYBOARD_NO_BUDDY !== '1'

  // Spawn Vite with piped stdio so we can:
  //   - In quiet mode: suppress noisy plugin chatter ([storyboard]/[generouted]/etc)
  //     until Vite prints "ready in", then render the mascot + URL, then
  //     stream the rest through unchanged.
  //   - In verbose mode: stream everything through unchanged from the start.
  const child = spawn(viteCommand, commandArgs, {
    cwd: targetCwd,
    stdio: verbose && !desktop ? 'inherit' : [desktop ? 'ignore' : 'inherit', 'pipe', 'pipe'],
    env: {
      ...viteEnvironment,
      STORYBOARD_WORKTREE: worktreeName,
      ...(instanceProxyUrl ? {
        HYPERCANVAS_PROXY_URL: instanceProxyUrl,
        HYPERCANVAS_PROXY_REGISTRATION_TOKEN: proxyRegistrationToken,
      } : {}),
      ...(desktop ? {
        STORYBOARD_DESKTOP: '1',
        STORYBOARD_DESKTOP_HOST: host,
        STORYBOARD_DESKTOP_PORT_AUTO: requestedPort === 0 ? '1' : '0',
        VITE_HYPERCANVAS_DESKTOP: '1',
        STORYBOARD_NO_BUDDY: '1',
        BROWSER: 'none',
        NO_COLOR: '1',
      } : {}),
      ...(wrapper ? { HYPERCANVAS_CORE_SESSION_SECRET: browserSessionSecret } : {}),
      // Tells the storyboard-server vite plugin to suppress its default
      // "➜ Local:" URL block — we render our own URL beside the mascot.
      ...(verbose && !desktop ? {} : { STORYBOARD_QUIET_VITE: '1' }),
    },
  })

  let desktopReady = false
  let desktopFailed = false
  let desktopExitStarted = false
  const emitDesktopFailure = (message, details = {}) => {
    if (!desktop || desktopFailed) return
    desktopFailed = true
    process.stdout.write(`${encodeRuntimeEvent('error', { message, ...details })}\n`)
  }

  if (desktop) {
    ignoreBrokenPipeErrors(process.stdout)
    ignoreBrokenPipeErrors(process.stderr)
    const emitDesktopReady = () => {
      if (desktopReady) return
      desktopReady = true
      process.stdout.write(`${encodeRuntimeEvent('ready', { url: devUrl, pid: child.pid })}\n`)
    }
    const forwardLines = (source, isStdout) => {
      let buffer = ''
      source?.on('data', (chunk) => {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop()
        for (const line of lines) {
          const event = isStdout ? parseViteDesktopEvent(line) : null
          if (event) {
            if (event.event === 'ready') desktopReady = true
            if (!wrapper || ['starting', 'ready', 'error', 'stopped'].includes(event.event)) {
              process.stdout.write(`${wrapper ? encodeRuntimeEvent(event.event, event) : JSON.stringify(event)}\n`)
            }
          } else if (isStdout && /ready in \d/.test(line) && !instanceProxy) {
            // Without the instance proxy, Vite's ready line is the fallback.
            // With the proxy, wait for the plugin's post-registration ready
            // event so the first browser request cannot race upstream setup.
            emitDesktopReady()
          } else if (line) {
            process.stderr.write(`${line}\n`)
          }
        }
      })
    }
    forwardLines(child.stdout, true)
    forwardLines(child.stderr, false)
    const timeout = setTimeout(() => {
      if (desktopReady) return
      emitDesktopFailure('Timed out waiting for the desktop server to become ready')
      try { child.kill('SIGTERM') } catch { /* empty */ }
    }, 45000)
    timeout.unref?.()
    child.on('error', (error) => {
      if (desktopExitStarted) return
      desktopExitStarted = true
      emitDesktopFailure(`Could not start Vite: ${error.message}`)
      shutdown()
      void Promise.resolve(desktopPaseo?.stop())
        .catch(() => {})
        .finally(() => process.exit(1))
    })
    desktopPaseo?.child?.on('exit', () => {
      if (shuttingDown) return
      emitDesktopFailure('The bundled Paseo daemon stopped unexpectedly')
      shutdown()
    })
  } else if (!verbose) {
    let mascotShown = false
    let mascotDone = false
    const queued = [] // [sink, line] pairs queued during animation
    const flushQueue = () => {
      while (queued.length) {
        const [s, l] = queued.shift()
        s.write(l + '\n')
      }
    }
    const renderOnce = async () => {
      if (mascotShown) return
      mascotShown = true
      console.log()
      const animated = showBuddy && renderMascot(
        mascotPaths(targetCwd),
        bold(devUrl),
        dim('Stop with Ctrl+C'),
      )
      if (!animated) {
        console.log(`  ${bold(devUrl)}`)
        console.log(`  ${dim('Stop with Ctrl+C')}`)
      }
      // Wait for animation to settle, then flush anything Vite emitted
      // during the animation window so it doesn't shift the cursor mid-frame.
      const isPromise = animated && typeof animated.then === 'function'
      if (isPromise) await animated
      mascotDone = true
      console.log()
      flushQueue()
    }

    const makeFilter = (sink) => {
      let buf = ''
      // stderr must always pass through, even before "ready in" — otherwise
      // pre-ready failures get swallowed and the CLI appears to exit
      // silently. We still route through the queue once the mascot starts
      // animating so the redraw isn't shifted mid-frame.
      const isErr = sink === process.stderr
      return (chunk) => {
        buf += chunk.toString()
        const lines = buf.split('\n')
        buf = lines.pop()
        for (const line of lines) {
          if (mascotDone) {
            sink.write(line + '\n')
            continue
          }
          if (mascotShown) {
            // Animation in flight — buffer subsequent Vite output so it
            // can't shift our cursor mid-redraw.
            queued.push([sink, line])
            continue
          }
          // Pre-ready: only let the "ready in" line through, then start
          // the mascot animation. Stderr is always passed through so
          // startup errors aren't silently dropped.
          if (/ready in \d/.test(line)) {
            sink.write(line + '\n')
            renderOnce()
          } else if (isErr) {
            sink.write(line + '\n')
          }
          // else: swallow pre-ready stdout chatter
        }
      }
    }
    child.stdout?.on('data', makeFilter(process.stdout))
    child.stderr?.on('data', makeFilter(process.stderr))
    // Safety net: if Vite never prints "ready in" within 8s, render anyway.
    setTimeout(() => { renderOnce() }, 8000).unref?.()
  }

  let shuttingDown = false
  let parentWatchdog
  let forceProcessGroupShutdown = false
  const killProcessGroup = () => {
    try { process.kill(-process.pid, 'SIGKILL') } catch { process.exit(137) }
  }
  function shutdown(forceProcessGroup = false) {
    forceProcessGroupShutdown ||= forceProcessGroup
    if (shuttingDown) {
      // Second Ctrl+C → hard exit, kill child with SIGKILL.
      if (forceProcessGroupShutdown) killProcessGroup()
      try { child.kill('SIGKILL') } catch { /* empty */ }
      process.exit(130)
    }
    shuttingDown = true
    clearInterval(parentWatchdog)
    if (forceProcessGroupShutdown) setTimeout(killProcessGroup, 7000)
    renameWatcher.close()
    void instanceProxy?.close()
    // Suppress Vite's shutdown-time esbuild noise ("Pre-transform error:
    // The service was stopped" for every in-flight transform) AND the
    // orphan-archive log spam from the storyboard-server plugin teardown.
    try { child.stdout?.removeAllListeners('data') } catch { /* empty */ }
    try { child.stderr?.removeAllListeners('data') } catch { /* empty */ }
    try { child.stdout?.destroy() } catch { /* empty */ }
    try { child.stderr?.destroy() } catch { /* empty */ }
    releasePort(worktreeName)
    void (async () => {
      // SIGINT first (clean esbuild shutdown), then SIGTERM after 2s if
      // Vite is still alive, then SIGKILL after 5s as last resort.
      try { child.kill('SIGINT') } catch { /* already dead */ }
      const term = setTimeout(() => { try { child.kill('SIGTERM') } catch { /* empty */ } }, 2000)
      const kill = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* empty */ } }, 5000)
      term.unref?.(); kill.unref?.()
    })()
  }
  process.on('SIGINT', () => shutdown())
  process.on('SIGTERM', () => shutdown())

  const desktopParentPid = Number(process.env.HYPERCANVAS_DESKTOP_PARENT_PID)
  if (desktop && Number.isInteger(desktopParentPid) && desktopParentPid > 1) {
    parentWatchdog = setInterval(() => {
      if (process.ppid !== desktopParentPid) shutdown(true)
    }, 500)
    parentWatchdog.unref?.()
  }

  child.on('exit', async (code) => {
    if (desktopExitStarted) return
    desktopExitStarted = true
    shuttingDown = true
    renameWatcher.close()
    releasePort(worktreeName)
    if (desktop && !desktopReady) {
      emitDesktopFailure('Vite exited before the desktop server became ready', { exitCode: code })
    }
    if (forceProcessGroupShutdown) killProcessGroup()
    await desktopPaseo?.stop()
    await instanceProxy?.close()
    process.exit(code ?? 0)
  })
}

main().catch(async (err) => {
  await desktopPaseo?.stop()
  await instanceProxy?.close()
  const message = err.message || String(err)
  if (process.argv.slice(3).includes('--desktop')) {
    process.stdout.write(`${process.env.HYPERCANVAS_WRAPPER === '1' ? encodeWrapperEvent('error', { message }) : encodeDesktopEvent('error', { message })}\n`)
  } else {
    p.log.error(message)
  }
  process.exit(1)
})
