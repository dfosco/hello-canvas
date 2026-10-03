/**
 * Storyboard Server Plugin — core dev-server infrastructure.
 *
 * Always-on Vite plugin that mounts a middleware backbone at `/_storyboard/`.
 * Reads `storyboard.config.json` for workshop features and plugin config.
 * Workshop API routes are wired directly; plugins register via the registry.
 *
 * Usage in vite.config.js:
 *   import storyboardServer from '@dfosco/hypercanvas/vite/server'
 *   storyboardServer()  // reads storyboard.config.json, no args needed
 */

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { parse as parseJsonc } from 'jsonc-parser'
import { getConfig } from '../stores/configSchema.js'
import { getServerWidgetDefinition, initServerWidgets } from '../canvas/customWidgets.js'
import { createDevLogger, setDevLogger } from '../logger/devLogger.js'
import { serverFeatures as workshopFeatures } from '../workshop/features/registry-server.js'
import { docsHandler, collectFiles } from './docs-handler.js'
import { createCanvasHandler } from '../canvas/server.js'
import { setupSelectedWidgets } from '../canvas/selectedWidgets.js'
import { readAgentsConfig, readHotPoolConfig } from '../canvas/configReader.js'
import { HotPoolManager } from '../canvas/hot-pool.js'
import { setOnHotPoolConfigChange } from '../../internals/vite/data-plugin.js'
import { createAutosyncHandler } from '../autosync/server.js'
import { setupTerminalServer } from '../canvas/terminal-server.js'
import { initPaseoTerminalRuntime } from '../canvas/paseo-terminal-runtime.js'
import { listSessions, detachSession, killSession, orphanSession, bulkCleanup, getSessionStats, reconcileRegistry } from '../canvas/terminal-registry.js'
import { execSync as cpExecSync } from 'node:child_process'
import { list as listRunningServers, register as registerServer, unregister as unregisterServer, generateId as generateServerId, findByWorktree } from '../worktree/serverRegistry.js'
import { detectWorktreeName, listWorktrees, worktreeDir } from '../worktree/port.js'
import { desktopUrl, encodeViteDesktopEvent, isAllowedRequestOrigin } from '../cli/devContract.js'
import { initBus, subscribeAll } from '../messaging/bus.js'
import { JsonlAdapter } from '../messaging/storage/jsonl-adapter.js'
import { createMessagingRoutes } from '../messaging/routes.js'
import { initPresence } from '../messaging/presence.js'
import { initDeliveryBridge } from '../messaging/delivery.js'
import { createArtifactRoutes } from '../artifact/routes.js'
import { createPaseoAgentsHandler } from '../canvas/paseo-agents-routes.js'
import { disposePaseoAgentRuntime } from '../canvas/paseo-agent-runtime.js'
import { getPaseoConnectionState } from '../canvas/paseo-runtime-client.js'
import { confirmNotebookPaseoBinding, getNotebookPaseoBinding, invalidateNotebookPaseoBinding } from '../canvas/paseo-notebook-binding.js'
import { createFileHandler, validateNotebookPath } from '../file/server.js'
import { resolveNotebookRuntimePath } from '../notebook/runtime.js'
import { buildArtifactManifest, resolveManifestEnv } from '../data/artifactManifest.js'
import { buildDataDiscovery } from '../../internals/vite/data-plugin.js'
import { createRouteSetup } from './api-router.js'
import { createHypercanvasService } from '../server/hypercanvas-service.js'
import { createApiGate } from './api-router.js'
import { createHostToolsHandler } from '../host-tools/server.js'
import { createHostToolsInstaller } from '../host-tools/installer.js'
import { preflightHostTools } from '../host-tools/preflight.js'
import { createPublishingHandler } from '../notebook/publishing-routes.js'
import { createNotebookNavigationRoutes } from '../notebook/navigation-routes.js'
import { createSiteRoutes } from '../site/routes.js'
import { resolveSiteDevelopmentUrl } from '../site/contract.js'
import { SiteStore } from '../site/site.js'
import { createFrameSnapshotCapture, closeFrameSnapshotBrowser } from '../canvas/frameSnapshotCapture.js'
import { createFrameSnapshotRoutes } from '../canvas/frameSnapshotRoutes.js'
import { createWorkspaceServiceRegistry, createWorkspaceServiceRoutes } from '../server/workspace-services.js'
import { createSystemRoutes } from '../system/routes.js'
import { createFilesystemGrants } from '../system/filesystem-grants.js'
import { createDiagnosticsHandler, readRecentDiagnosticLogs } from '../server/diagnostics.js'
import { createBrowserSession } from '../server/browser-session.js'
import { INTERNAL_RELAUNCH_PATH, INTERNAL_REGISTER_PATH } from '../server/instance-proxy.js'
import { createPaseoServerEnvironment, withoutRuntimeCredentials } from '../runtimeEnvironment.js'

/** Notebook runtime instances already wired to binding revalidation (Vite restarts re-run configureServer). */
const bindingHookedRuntimes = new WeakSet()

/**
 * Send a JSON response.
 */
function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

/**
 * Create a logging wrapper around sendJson.
 * Reads per-request route context from res.__sbLogCtx (set by middleware).
 */
function createLoggedSendJson(logger) {
  return function sendJsonLogged(res, status, data) {
    sendJson(res, status, data)
    if (status >= 400 && logger) {
      const ctx = res.__sbLogCtx || {}
      logger.logResponse({
        status,
        method: ctx.method || 'UNKNOWN',
        url: ctx.url || '',
        route: ctx.route || null,
        subRoute: ctx.subRoute || null,
        error: data?.error || null,
      })
    }
  }
}

let wrapperBrowserSession = null
const coreSessionSecretKey = Symbol.for('hypercanvas.coreSessionSecret.v1')
const CORE_VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).version || 'unknown' } catch { return 'unknown' }
})()

function coreSessionSecret() {
  const inherited = globalThis[coreSessionSecretKey]
  if (typeof inherited === 'string' && inherited) return inherited
  const secret = process.env.HYPERCANVAS_CORE_SESSION_SECRET
  if (typeof secret !== 'string' || !secret) return null
  Object.defineProperty(globalThis, coreSessionSecretKey, { value: secret, configurable: true })
  // The persistent Core supervisor owns this value. Do not pass it onward to
  // Site, agent, or other processes launched by the replaceable Vite worker.
  delete process.env.HYPERCANVAS_CORE_SESSION_SECRET
  return secret
}

/**
 * Read storyboard.config.json from the project root and apply defaults.
 */
function readConfig(root) {
  const configPath = path.join(root, 'storyboard.config.json')
  if (!fs.existsSync(configPath)) return getConfig({})
  try {
    const raw = fs.readFileSync(configPath, 'utf-8')
    return getConfig(parseJsonc(raw) || {})
  } catch {
    return getConfig({})
  }
}

/**
 * Core storyboard server Vite plugin.
 */
export default function storyboardServer({ notebookRuntime = null } = {}) {
  let root = ''
  let configRoot = ''
  let base = '/'
  let config = {}
  let isDev = false

  // Route handler registry — plugins register here during setup
  const routeHandlers = new Map()
  const workspaceServices = createWorkspaceServiceRegistry()
  const filesystemGrants = createFilesystemGrants()
  const clientScripts = []
  const wrapperMode = process.env.HYPERCANVAS_WRAPPER === '1'
  const browserSession = wrapperMode
    ? (wrapperBrowserSession ||= createBrowserSession({
        required: true,
        launchToken: process.env.HYPERCANVAS_LAUNCH_TOKEN || null,
        sessionSecret: coreSessionSecret(),
      }))
    : createBrowserSession()
  let browserSessionHandoffEnabled = false
  const browserCoreMode = wrapperMode || Boolean(process.env.HYPERCANVAS_APP_STATE_DIR)
  if (wrapperMode) delete process.env.HYPERCANVAS_LAUNCH_TOKEN

  // Load packaged favicon once and cache as data URI so every consumer
  // gets the storyboard brand favicon without shipping/copying any asset.
  let faviconDataUri = ''
  try {
    const faviconPath = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      '../../../assets/favicon.svg'
    )
    const svg = fs.readFileSync(faviconPath, 'utf8')
    faviconDataUri = 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64')
  } catch { /* favicon missing — skip injection */ }

  return {
    name: 'storyboard-server',

    config() {
      return {
        optimizeDeps: {
          include: [
            'highlight.js/lib/core',
            'highlight.js/lib/languages/javascript',
            'highlight.js/lib/languages/typescript',
            'highlight.js/lib/languages/xml',
          ],
        },
        server: {
          watch: {
            // Never feed runtime-state directories to Vite's file watcher.
            // These dirs are written to on sub-second cadence by terminals,
            // canvas snapshots, agent state, etc. Letting them reach the
            // watcher produces full-reload loops on any unguarded route.
            // (server.watcher.unwatch() after the fact isn't enough — new
            // files inside the dirs can still be re-added by chokidar.)
            ignored: [
              '**/.storyboard/**',
              '**/assets/canvas/images/**',
              '**/assets/canvas/snapshots/**',
              '**/assets/.storyboard-public/**',
            ],
          },
        },
      }
    },

    configResolved(viteConfig) {
      root = viteConfig.root
      base = viteConfig.base || '/'
      configRoot = notebookRuntime?.status().root || root
      config = readConfig(configRoot)
      browserSessionHandoffEnabled = wrapperMode && config.featureFlags?.browserSessionHandoff === true
      browserSession.setRequired(browserSessionHandoffEnabled)
      isDev = viteConfig.command === 'serve'

      // Seed the server-side custom-widget registry from the consumer's
      // `storyboard.config.json.widgets` block. Consumer entries override
      // built-in widget metadata for collision detection, default sizes,
      // prompt-exec config, etc. Server-side does not load React components
      // — those are seeded in the browser via `mountStoryboardCore({ widgets })`.
      try {
        initServerWidgets(config?.widgets || null)
      } catch (err) {
        console.warn('[storyboard] Failed to init custom widget registry:', err.message)
      }
    },

      configureServer(server) {
      // Keep prototype serving in Vite, but host the Hypercanvas API on a
      // separate local HTTP server. The route map remains shared during this
      // migration so all existing route initialization stays in one place.
        let hypercanvasServer = null
        server.__hypercanvasFilesystemGrants = filesystemGrants
        server.middlewares.use(browserSession.bootstrapMiddleware({ base }))
        const requireNotebookRoot = () => notebookRuntime
          ? notebookRuntime.requireNotebookRoot()
          : configRoot
        // Startup with no active Notebook (never opened, or the selected
        // folder was removed/renamed) must not abort the server: the SPA
        // boots and shows the blocking Notebook switcher instead. Bind
        // startup services to the config root; opening a Notebook restarts
        // the server, which re-runs this hook and rebinds to the real root.
        // Per-request handlers below still use requireNotebookRoot() so they
        // fail cleanly while no Notebook is active.
        const notebookRoot = notebookRuntime?.status().active
          ? requireNotebookRoot()
          : configRoot
        const externalServerUrl = process.env.HYPERCANVAS_SERVER_URL || null
      const standaloneEnabled = process.env.STORYBOARD_STANDALONE_SERVER !== '0' && !externalServerUrl
      // Every session feature gates on a verified Notebook→Paseo binding: a
      // daemon server identity plus a workspace opened for this root on that
      // server. Failures are recorded by the binding module and surfaced in
      // diagnostics + recovery guidance instead of being swallowed.
      const resolveWorkspaceForRoot = async (directory) => {
        const confirmed = await confirmNotebookPaseoBinding(directory)
        return confirmed.workspaceId
      }
      const resolvePaseoWorkspaceId = async () => {
        if (notebookRuntime && !notebookRuntime.status().active) {
          throw new Error('No active Notebook is available for Paseo workspace registration')
        }
        return resolveWorkspaceForRoot(requireNotebookRoot())
      }
      // Notebook switches revalidate the binding: the cached workspace belongs
      // to the previous Notebook root, so drop it and re-confirm for the new
      // one. Hook once per runtime instance — Vite restarts re-run this hook.
      if (typeof notebookRuntime?.subscribe === 'function' && !bindingHookedRuntimes.has(notebookRuntime)) {
        bindingHookedRuntimes.add(notebookRuntime)
        notebookRuntime.subscribe(({ current }) => {
          invalidateNotebookPaseoBinding()
          if (current) {
            void resolveWorkspaceForRoot(current.root).catch((error) => {
              console.warn(`[storyboard] Paseo workspace registration failed: ${error.message}`)
            })
          }
        })
      }
      const sendEvent = (payload) => {
        // Hypercanvas events use its own channel; Vite remains responsible
        // only for source-module HMR and Fast Refresh messages.
        if (!(payload?.type === 'custom' && String(payload.event || '').startsWith('storyboard:'))) {
          server.ws.send(payload)
        }
        hypercanvasServer?.broadcast(payload)
      }
      let apiRegistrationPromise = Promise.resolve(true)
      if (standaloneEnabled) {
        hypercanvasServer = createHypercanvasService({
          base,
          routeHandlers,
          eventSender: sendEvent,
          authorizeRequest: browserSession.isAuthenticated,
          authorizeWebSocket: browserSession.authorizeWebSocket,
        })
        apiRegistrationPromise = hypercanvasServer.listen(0, '127.0.0.1').then(() => {
          const address = hypercanvasServer.server.address()
          if (typeof address !== 'object' || !address) return false
          void resolvePaseoWorkspaceId().then((workspaceId) => {
            if (workspaceId) {
              workspaceServices.register({ workspaceId, serviceName: 'hypercanvas', url: `http://127.0.0.1:${address.port}` })
            }
          }).catch((error) => {
            console.warn(`[storyboard] Paseo workspace registration failed: ${error.message}`)
          })
          return postUpstreamRegistration({ apiPort: address.port, apiWsPath: hypercanvasServer.socketPath })
        }).catch((error) => {
          console.warn(`[storyboard] Standalone Hypercanvas server unavailable; using Vite API fallback: ${error.message}`)
          return false
        })
        server.httpServer?.on('close', () => { void hypercanvasServer.close().catch(() => {}); void closeFrameSnapshotBrowser() })
      }
      server.httpServer?.once('listening', async () => {
        const workspaceId = await resolvePaseoWorkspaceId().catch((error) => {
          console.warn(`[storyboard] Paseo workspace registration failed: ${error.message}`)
          return null
        })
        const address = server.httpServer.address()
        if (workspaceId && typeof address === 'object' && address) {
          workspaceServices.register({ workspaceId, serviceName: 'prototype', url: `http://127.0.0.1:${address.port}${base}` })
        }
      })

      // --- Single-instance proxy registration (ADR-007) -------------------------
      // The Core supervisor claims its selected proxy port before spawning
      // this Vite child and passes its origin via HYPERCANVAS_PROXY_URL. Register
      // the dynamic backend ports here so the proxy can forward HTTP and
      // WebSocket upgrades; without the proxy env the helpers below no-op.
      const proxyOrigin = (process.env.HYPERCANVAS_PROXY_URL || '').replace(/\/$/, '')
      const proxyPort = (() => {
        try {
          const parsed = Number(new URL(process.env.HYPERCANVAS_PROXY_URL).port)
          return Number.isInteger(parsed) && parsed > 0 ? parsed : null
        } catch { return null }
      })()
      const proxyFallbackOrigin = proxyPort ? `http://127.0.0.1:${proxyPort}` : null
      const notebookInfoPayload = () => {
        try {
          const status = notebookRuntime?.status?.()
          if (!status?.active) return null
          return { title: status.notebook?.manifest?.title || null, root: status.root || null }
        } catch { return null }
      }
      const postUpstreamRegistration = (payload) => {
        if (!proxyPort) return Promise.resolve(true)
        const body = JSON.stringify(payload)
        return new Promise((resolve) => {
          let settled = false
          const finish = (success) => {
            if (settled) return
            settled = true
            resolve(success)
          }
          const request = http.request({
            host: '127.0.0.1',
            port: proxyPort,
            path: INTERNAL_REGISTER_PATH,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
              ...(process.env.HYPERCANVAS_PROXY_REGISTRATION_TOKEN
                ? { Authorization: `Bearer ${process.env.HYPERCANVAS_PROXY_REGISTRATION_TOKEN}` }
                : {}),
            },
            timeout: 2000,
          }, (response) => {
            response.resume()
            response.once('end', () => finish(response.statusCode === 200))
          })
          request.once('timeout', () => request.destroy(new Error('Proxy registration timed out')))
          request.once('error', () => finish(false))
          request.end(body)
        })
      }

      // --- Custom URL printer ----------------------------------------------------
      // Vite calls server.printUrls() after its "ready in Xms" banner.
      // Override to suppress Vite's default "➜ Local:" block and let the
      // CLI render our own URL (and mascot) instead. Suppression is opt-in
      // via STORYBOARD_QUIET_VITE=1 — we set this from storyboard dev.js
      // when --verbose is OFF.
      if (process.env.STORYBOARD_QUIET_VITE === '1') {
        const originalPrintUrls = server.printUrls?.bind(server)
        server.printUrls = () => {
          // No-op: caller renders its own URL + mascot.
          void originalPrintUrls
        }
      }

      // --- Reload guard ----------------------------------------------------------
      // Suppress full-reloads and HMR updates for guarded clients.
      //
      // Three guard channels:
      //   1. Canvas guard — canvas pages send heartbeats via storyboard:canvas-hmr-guard.
      //      Controlled by the "canvas-auto-reload" feature flag.
      //   2. Prototype guard — prototype/story pages send heartbeats via storyboard:prototype-reload-guard.
      //      Controlled by the "prototype-auto-reload" feature flag.
      //      The prototype guard only drops `full-reload` payloads; `update` (HMR module /
      //      React Fast Refresh) payloads still flow so component edits hot-update normally.
      //   3. Configuration guard — pages send heartbeats via
      //      storyboard:configuration-reload-guard and only config payloads are filtered.
      //
      // Both guards auto-expire 5s after the last heartbeat so closed tabs never
      // leave them stuck. Custom storyboard events always pass through.
      {
        let recentCanvasMutationAt = 0
        const CANVAS_WINDOW_MS = 1500
        const GUARD_TTL_MS = 5000
        const isCanvasFile = (file = '') => /\.canvas\.jsonl$/i.test(file.replace(/\\/g, '/'))

        const markCanvasMutation = (file = '') => {
          if (isCanvasFile(file)) recentCanvasMutationAt = Date.now()
        }

        server.watcher.on('change', markCanvasMutation)
        server.watcher.on('add', markCanvasMutation)
        server.watcher.on('unlink', markCanvasMutation)

        const canvasGuardedClients = new Map()
        const prototypeGuardedClients = new Map()
        const configurationGuardedClients = new Map()

        server.hot.on('storyboard:canvas-hmr-guard', (data, client) => {
          if (data.active) {
            canvasGuardedClients.set(client, Date.now() + GUARD_TTL_MS)
          } else {
            canvasGuardedClients.delete(client)
          }
        })

        server.hot.on('storyboard:prototype-reload-guard', (data, client) => {
          if (data.active) {
            prototypeGuardedClients.set(client, Date.now() + GUARD_TTL_MS)
          } else {
            prototypeGuardedClients.delete(client)
          }
        })

        server.hot.on('storyboard:configuration-reload-guard', (data, client) => {
          if (data.active) {
            configurationGuardedClients.set(client, Date.now() + GUARD_TTL_MS)
          } else {
            configurationGuardedClients.delete(client)
          }
        })

        const cleanup = setInterval(() => {
          const now = Date.now()
          for (const [client, until] of canvasGuardedClients) {
            if (now > until || !server.ws.clients.has(client)) {
              canvasGuardedClients.delete(client)
            }
          }
          for (const [client, until] of prototypeGuardedClients) {
            if (now > until || !server.ws.clients.has(client)) {
              prototypeGuardedClients.delete(client)
            }
          }
          for (const [client, until] of configurationGuardedClients) {
            if (now > until || !server.ws.clients.has(client)) {
              configurationGuardedClients.delete(client)
            }
          }
        }, 10000)
        server.httpServer?.on('close', () => clearInterval(cleanup))

        function isCanvasClientGuarded(client) {
          const cu = canvasGuardedClients.get(client)
          return cu != null && Date.now() < cu
        }

        function isPrototypeClientGuarded(client) {
          const pu = prototypeGuardedClients.get(client)
          return pu != null && Date.now() < pu
        }

        function isConfigurationClientGuarded(client) {
          const cu = configurationGuardedClients.get(client)
          return cu != null && Date.now() < cu
        }

        function isConfigurationPayload(payload) {
          const updates = Array.isArray(payload?.updates) ? payload.updates : []
          const paths = [payload?.path, ...updates.map((update) => update?.path)]
          return paths.some((file = '') => /(?:^|\/)(?:storyboard|toolbar|commandpalette|paste|widgets|terminal|mascot)\.config\.json$/i.test(file.replace(/\\/g, '/')))
        }

        const originalSend = server.ws.send.bind(server.ws)
        server.ws.send = (payload, ...rest) => {
          // Notebook root switches are explicit user actions — a guarded
          // client must still reload so the new Notebook becomes visible.
          if (payload && payload.type === 'full-reload' && server.__hypercanvasNotebookSwitching) {
            return originalSend(payload, ...rest)
          }
          // Suppress broadcast reloads within the canvas mutation window
          if (
            payload &&
            payload.type === 'full-reload' &&
            Date.now() - recentCanvasMutationAt < CANVAS_WINDOW_MS
          ) {
            return
          }

          // No guarded clients → broadcast normally
          if (canvasGuardedClients.size === 0 && prototypeGuardedClients.size === 0 && configurationGuardedClients.size === 0) {
            return originalSend(payload, ...rest)
          }

          // full-reload: classify config payloads separately; other reloads use
          // the canvas/prototype client policies.
          if (payload && payload.type === 'full-reload') {
            for (const client of server.ws.clients) {
              const blocked = isConfigurationPayload(payload)
                ? isConfigurationClientGuarded(client)
                : (isCanvasClientGuarded(client) || isPrototypeClientGuarded(client))
              if (!blocked) {
                client.send(payload)
              }
            }
            return
          }

          // update (HMR module updates / React Fast Refresh): only drop for
          // CANVAS-guarded clients (canvas state must not be disturbed by
          // unrelated module updates). Prototype-guarded clients still
          // receive updates so React Fast Refresh works while developing.
          if (payload && payload.type === 'update') {
            for (const client of server.ws.clients) {
              if (!isCanvasClientGuarded(client) && (!isConfigurationPayload(payload) || !isConfigurationClientGuarded(client))) {
                client.send(payload)
              }
            }
            return
          }

          // Everything else (custom events, errors) broadcasts normally
          return originalSend(payload, ...rest)
        }
      }
      // --- End reload guard ------------------------------------------------------

      // Initialize dev logger for structured o11y logging
      let currentBranch = null
      try { currentBranch = cpExecSync('git branch --show-current', { encoding: 'utf8', cwd: root }).trim() } catch { /* empty */ }
      const logVerbose = config.featureFlags?.['dev-logs'] || false
      const devDomain = config.repository?.name || null
      const devLogger = createDevLogger({ root: notebookRoot, devDomain, branch: currentBranch, verbose: logVerbose })
      setDevLogger(devLogger) // make available to all server-side modules via devLog()
      const sendJsonLogged = createLoggedSendJson(devLogger)
      routeHandlers.set('workspace-services', createWorkspaceServiceRoutes({ registry: workspaceServices, sendJson: sendJsonLogged }))

      if (process.env.STORYBOARD_DESKTOP === '1') {
        routeHandlers.set('desktop-ready', async (req, res, ctx) => {
          if (ctx.method !== 'POST') return sendJsonLogged(res, 405, { error: 'Method not allowed' })
          if (ctx.body?.mounted !== true) return sendJsonLogged(res, 400, { error: 'Client is not mounted' })
          const marker = process.env.HYPERCANVAS_SMOKE_RENDER_MARKER
          if (marker) fs.writeFileSync(marker, `${JSON.stringify({ mounted: true, pid: process.pid })}\n`)
          sendJsonLogged(res, 200, { ready: true })
        })
      }

      // Start or reconnect to the detached per-project PTY broker. Terminal
      // routes stay mounted when startup fails so clients receive diagnostics
      // instead of taking down unrelated Storyboard behavior.
      const notebookHasActiveRoot = !notebookRuntime || notebookRuntime.status().active
      let ptyRuntimeFailure = null
      let ptyRuntimeStatus = {
        engine: 'paseo',
        connected: false,
        status: process.env.STORYBOARD_DISABLE_PTY_RUNTIME === '1' ? 'disabled' : 'starting',
      }
      const ptyRuntimeReady = process.env.STORYBOARD_DISABLE_PTY_RUNTIME === '1' || !notebookHasActiveRoot
        ? Promise.resolve(null)
        : initPaseoTerminalRuntime(notebookRoot, {
          detached: process.env.STORYBOARD_DESKTOP !== '1',
          requestTimeoutMs: 30_000,
          startupTimeoutMs: 30_000,
        }).then(async (runtime) => {
          const health = await runtime.health()
          ptyRuntimeStatus = {
            engine: 'paseo',
            connected: health.connected === true,
            status: typeof health.state?.status === 'string' ? health.state.status : 'unknown',
          }
          devLogger.logEvent('info', 'Hypercanvas PTY runtime ready', {
            engine: health.engine,
            connected: health.connected,
            connectionState: health.state?.status || 'unknown',
            recoveryState: health.recoveryState || 'unknown',
            lastError: health.lastError || null,
            serverId: health.server?.serverId || null,
            serverVersion: health.server?.version || null,
          })
          return runtime
        }).catch((err) => {
          ptyRuntimeFailure = { code: err.code || 'PTY_RUNTIME_ERROR', message: err.message }
          ptyRuntimeStatus = { engine: 'paseo', connected: false, status: 'error' }
          devLogger.logEvent('error', 'Hypercanvas PTY runtime unavailable', {
            error: err.message,
            code: err.code || null,
          })
          return null
        })

      // Listen for browser-side console errors forwarded via HMR
      server.hot.on('storyboard:client-error', (data) => {
        devLogger.logEvent(data.level || 'error', data.message || 'Unknown browser error', {
          source: 'browser',
          url: data.url || null,
          line: data.line || null,
          col: data.col || null,
          stack: data.stack || null,
          route: data.route || null,
        })
      })

      const workshopConfig = config.workshop || {}
      const enabledFeatures = workshopConfig.features || {}

      // Wire workshop API routes — compose handlers from all enabled features
      const workshopHandlers = []
      for (const [featureName, featureModule] of Object.entries(workshopFeatures)) {
        if (enabledFeatures[featureName] === false) continue
        if (featureModule.serverSetup) {
          workshopHandlers.push(featureModule.serverSetup({ root: notebookRoot, sendJson: sendJsonLogged, workshopConfig }))
        }
      }
      if (workshopHandlers.length > 0) {
        routeHandlers.set('workshop', async (req, res, ctx) => {
          for (const handler of workshopHandlers) {
            await handler(req, res, ctx)
            if (res.writableEnded) return
          }
          sendJsonLogged(res, 404, { error: `Unknown workshop route: ${ctx.method} ${ctx.path}` })
        })
      }

      // Wire docs API routes (always enabled — serves README + source files)
      routeHandlers.set('docs', docsHandler({ root, sendJson: sendJsonLogged }))

      // Create shared hot pool manager (per-type pre-warmed sessions)
        const hotPoolConfig = readHotPoolConfig(notebookRoot, root)
        const agentsConfig = readAgentsConfig(notebookRoot, root)
      const wsSend = sendEvent
      const promptAgentId = getServerWidgetDefinition('prompt')?.execution?.default || null
      const hotPool = new HotPoolManager({
        root: notebookRoot,
        config: hotPoolConfig,
        agentsConfig,
        promptAgentId,
        wsSend,
        workspaceIdResolver: () => resolvePaseoWorkspaceId(),
      })
      ptyRuntimeReady.then((runtime) => {
        if (!runtime) return
        hotPool.start().catch((err) => {
          devLogger.logEvent('error', 'Hot pool failed to start', { error: err.message })
        })
      })

      // Reconfigure hot pool when settings dialog saves hotPool.* changes
       setOnHotPoolConfigChange(() => {
          hotPool.reconfigure(readHotPoolConfig(notebookRoot, root))
      })

      // Warm, unassigned sessions are disposable. Widget-owned broker sessions
      // deliberately survive ordinary Vite shutdown and reconnect on restart.
      const shutdownPool = () => { hotPool.stop() }
      const shutdownDesktopRuntime = async () => {
        await routeHandlers.get('site')?.close?.().catch(() => {})
        if (process.env.STORYBOARD_DESKTOP !== '1') return
        await ptyRuntimeReady.then((runtime) => runtime?.shutdown()).catch(() => {})
      }
      process.on('SIGINT', shutdownPool)
      process.on('SIGTERM', shutdownPool)
      server.httpServer?.on('close', shutdownPool)
      server.httpServer?.on('close', disposePaseoAgentRuntime)
      server.httpServer?.on('close', shutdownDesktopRuntime)

      // Canvas content belongs to the active Notebook, while the rest of this
      // server remains rooted in the immutable application shell. Resolve the
      // handler per root so switching does not leave CRUD pointed at the demo.
      const canvasHandlers = new Map()
      routeHandlers.set('canvas', async (...args) => {
        const notebookRoot = requireNotebookRoot()
        if (!canvasHandlers.has(notebookRoot)) {
          canvasHandlers.set(notebookRoot, createCanvasHandler({
            root: notebookRoot,
            sendJson: sendJsonLogged,
            hotPool,
            workspaceIdResolver: () => resolvePaseoWorkspaceId(),
          }))
        }
        return canvasHandlers.get(notebookRoot)(...args)
      })

      // Selected widgets bridge — writes .selectedwidgets.json for Copilot context
       setupSelectedWidgets(server, notebookRoot)

      // Terminal WebSocket server — PTY backend for terminal canvas widgets
      if (server.httpServer && notebookHasActiveRoot) {
        let branch = 'unknown'
        try {
          branch = cpExecSync('git branch --show-current', { encoding: 'utf8', cwd: root }).trim()
        } catch { /* empty */ }
         setupTerminalServer(
           server.httpServer,
           base,
           branch,
           hotPool,
           ptyRuntimeReady,
           notebookRoot,
           () => resolvePaseoWorkspaceId(),
         )
        ptyRuntimeReady.then((runtime) => runtime && reconcileRegistry()).catch(() => {})
      }

      // Self-register in .storyboard/servers.json so sibling workflows
      // (cli helpers, BranchBar, agent terminals) can discover this Vite.
      // Registration happens once the HTTP server is actually listening so
      // the recorded port is the real one (handles strictPort fallbacks).
      if (server.httpServer) {
        const serverId = generateServerId()
        const worktreeName = detectWorktreeName()
        const onListening = async () => {
          try {
            const addr = server.httpServer.address()
            const port = typeof addr === 'object' && addr ? addr.port : null
            if (port) {
              const host = process.env.STORYBOARD_DESKTOP_HOST || '127.0.0.1'
              const browserOrigin = `http://${host}:${port}`
              browserSession.registerBrowserOrigin(browserOrigin)
              filesystemGrants.registerBrowserOrigin(browserOrigin)
              if (proxyOrigin) {
                browserSession.registerBrowserOrigin(proxyOrigin)
                filesystemGrants.registerBrowserOrigin(proxyOrigin)
              }
              if (proxyFallbackOrigin) {
                // Safari fallback for installations where *.localhost does
                // not resolve as expected. It shares the proxy listener, so
                // browser sessions and picker grants must trust this origin.
                browserSession.registerBrowserOrigin(proxyFallbackOrigin)
                filesystemGrants.registerBrowserOrigin(proxyFallbackOrigin)
              }
              // Register the address Vite actually bound (it may be IPv6
              // ::1 when launched with --host localhost) so the proxy dials
              // a reachable upstream instead of assuming IPv4 loopback.
              const boundAddress = typeof addr === 'object' && addr && typeof addr.address === 'string'
                ? addr.address
                : '127.0.0.1'
              const viteHost = boundAddress === '::' || boundAddress === '0.0.0.0' ? '127.0.0.1' : boundAddress
              await apiRegistrationPromise
              const apiAddress = hypercanvasServer?.server.address()
              const registered = await postUpstreamRegistration({
                vitePort: port,
                viteHost,
                ...(typeof apiAddress === 'object' && apiAddress
                  ? { apiPort: apiAddress.port, apiWsPath: hypercanvasServer.socketPath }
                  : {}),
                notebook: notebookInfoPayload(),
              })
              if (proxyPort && !registered) {
                const message = 'Could not register Core with the Hypercanvas instance proxy'
                if (process.env.STORYBOARD_DESKTOP === '1') {
                  process.stdout.write(`${encodeViteDesktopEvent('error', { message })}\n`)
                } else {
                  console.error(`[storyboard] ${message}`)
                }
                return
              }
              if (process.env.STORYBOARD_DESKTOP === '1') {
                const viteBase = server.config.base || '/'
                process.stdout.write(`${encodeViteDesktopEvent('ready', {
                  url: proxyOrigin ? `${proxyOrigin}${viteBase === '/' ? '/' : viteBase}` : desktopUrl(host, port, viteBase),
                  pid: process.pid,
                  port,
                  apiPort: typeof apiAddress === 'object' && apiAddress ? apiAddress.port : null,
                  proxyPort,
                  version: CORE_VERSION,
                  nodePath: process.execPath,
                  nodeVersion: process.version,
                })}\n`)
              }
              // The server registry is discovery metadata, not part of the
              // desktop startup contract. A filesystem failure must not
              // prevent the native host from receiving `ready`.
              try {
                registerServer({ id: serverId, worktree: worktreeName, pid: process.pid, port }, root)
              } catch { /* best effort */ }
            }
          } catch (error) {
            if (proxyPort) {
              const message = `Could not register Core with the Hypercanvas instance proxy: ${error.message}`
              if (process.env.STORYBOARD_DESKTOP === '1') {
                process.stdout.write(`${encodeViteDesktopEvent('error', { message })}\n`)
              } else {
                console.error(`[storyboard] ${message}`)
              }
            }
          }
        }
        if (server.httpServer.listening) onListening()
        else server.httpServer.once('listening', onListening)

        const unregister = () => {
          try { unregisterServer(serverId, root) } catch { /* */ }
        }
        server.httpServer.on('close', unregister)
        process.on('SIGINT', unregister)
        process.on('SIGTERM', unregister)
        process.on('exit', unregister)
      }

      // Ignore assets/canvas/ so image/snapshot writes don't trigger reloads
      server.watcher.unwatch(path.join(notebookRoot, 'assets', 'canvas', 'images'))
      server.watcher.unwatch(path.join(notebookRoot, 'assets', 'canvas', 'snapshots'))
      server.watcher.unwatch(path.join(notebookRoot, 'assets', '.storyboard-public', 'terminal-snapshots'))
      // The entire `.storyboard/` directory is gitignored runtime state
      // (terminal buffers + snapshots, hub messages, selectedwidgets,
      // logs, server registry). None of it should ever feed Vite's
      // watcher — active terminals especially write here on a sub-second
      // cadence, which previously produced full-reload loops on any
      // route without the canvas/prototype HMR guard.
      server.watcher.unwatch(path.join(notebookRoot, '.storyboard'))

      // Wire autosync API routes (always enabled — git automation for dev)
      routeHandlers.set('autosync', createAutosyncHandler({ root: notebookRoot, sendJson: sendJsonLogged }))

      // Wire messaging bus (shared event log for multi-agent communication)
      const messagingAdapter = new JsonlAdapter({ root: notebookRoot })
      messagingAdapter.initSync()
      initBus(messagingAdapter)
      initPresence()
      initDeliveryBridge({ root: notebookRoot })
      routeHandlers.set('messages', createMessagingRoutes({ sendJson: sendJsonLogged }))

      // Paseo agent chat API — same-origin proxy to the Paseo daemon.
      // Daemon credentials stay server-side; events forward via HMR custom event.
        routeHandlers.set('paseo-agents', createPaseoAgentsHandler({
          root: notebookRoot,
         sendJson: sendJsonLogged,
         wsSend,
           workspaceIdResolver: async () => {
             if (notebookRuntime && !notebookRuntime.status().active) {
               throw new Error('No active Notebook is available for Paseo workspace registration')
             }
             return resolveWorkspaceForRoot(requireNotebookRoot())
           },
       }))

      // File Widget API — read/write/list repo files
      const fileHandlers = new Map()
      routeHandlers.set('file', async (...args) => {
        const notebookRoot = requireNotebookRoot()
        const key = `notebook:${notebookRoot}`
        if (!fileHandlers.has(key)) {
          fileHandlers.set(key, createFileHandler({
            root: notebookRoot,
            sendJson: sendJsonLogged,
            validatePath: validateNotebookPath,
          }))
        }
        return fileHandlers.get(key)(...args)
      })

      // Notebook export and managed publishing API.
      routeHandlers.set('publishing', createPublishingHandler({
        root: notebookRoot,
        applicationRoot: root,
        getNotebookRoot: requireNotebookRoot,
        sendJson: sendJsonLogged,
      }))
      routeHandlers.set('notebook', createNotebookNavigationRoutes({
        runtime: notebookRuntime,
        sendJson: sendJsonLogged,
        eventSender: sendEvent,
      }))
      const siteRoot = notebookRoot
      const siteRoutes = createSiteRoutes({
        root: siteRoot,
        sendJson: sendJsonLogged,
        filesystemGrants,
        resolveNotebookWorkspaceId: resolvePaseoWorkspaceId,
        ptyRuntime: ptyRuntimeReady,
        workspaceScripts: async () => (await ptyRuntimeReady)?.connection?.daemon || null,
        eventSender: sendEvent,
        serviceResolver: async (workspaceId, serviceName) => {
          const binding = workspaceServices.resolve(workspaceId, serviceName)
          if (!binding) {
            const error = new Error(`Workspace service not found: ${workspaceId}/${serviceName}`)
            error.code = 'SERVICE_NOT_FOUND'
            throw error
          }
          return binding.url
        },
      })
      routeHandlers.set('site', siteRoutes)

      // Persistent Frame snapshots: read/capture/capability routes shared by
      // Prototype and Site Frames. Snapshots live in Notebook-owned assets;
      // capture reuses one headless browser and never destroys prior images.
      const siteBindingForCapture = siteId => {
        const binding = new SiteStore(notebookRoot).getBinding(siteId)
        if (!binding?.developmentBaseUrl) {
          throw Object.assign(new Error(`Site is not running: ${siteId}`), { code: 'SITE_NOT_RUNNING' })
        }
        return binding
      }
      const frameSnapshots = createFrameSnapshotCapture({
        notebookRoot,
        eventSender: sendEvent,
        resolveSiteUrl: (siteId, route) => resolveSiteDevelopmentUrl(siteBindingForCapture(siteId).developmentBaseUrl, route),
      })
      routeHandlers.set('frame-snapshot', createFrameSnapshotRoutes({
        root: notebookRoot,
        sendJson: sendJsonLogged,
        capture: frameSnapshots,
        siteStore: new SiteStore(notebookRoot),
        eventSender: sendEvent,
      }))

      routeHandlers.set('diagnostics', createDiagnosticsHandler({
        sendJson: sendJsonLogged,
        getSnapshot: async () => {
          const viteAddress = server.httpServer?.address()
          const vitePort = typeof viteAddress === 'object' && viteAddress ? viteAddress.port : null
          const apiAddress = hypercanvasServer?.server.address()
          const apiPort = typeof apiAddress === 'object' && apiAddress ? apiAddress.port : null
          const notebookStatus = notebookRuntime?.status?.() || { active: false, root: null, notebook: null }
          let notebookAvailable = false
          try { notebookAvailable = Boolean(notebookStatus.root && fs.statSync(notebookStatus.root).isDirectory()) } catch { /* missing Notebook */ }
          const preflight = await preflightHostTools().catch(() => null)
          const hostTools = preflight ? {
            status: preflight.status,
            support: preflight.support,
            baseline: preflight.baseline,
            agents: preflight.agents,
          } : { status: 'unavailable', baseline: null, agents: {} }
          const connectionState = getPaseoConnectionState()
          const paseoBinding = getNotebookPaseoBinding()
          const paseo = {
            startup: {
              usePaseoApp: process.env.HYPERCANVAS_PASEO_USE_APP === undefined ? null : process.env.HYPERCANVAS_PASEO_USE_APP === '1',
              reuseProbeFailure: process.env.HYPERCANVAS_PASEO_REUSE_FAILURE || null,
              restartRequired: true,
            },
            connection: {
              status: typeof connectionState?.status === 'string' ? connectionState.status : 'unknown',
              connected: connectionState?.status === 'connected',
            },
            binding: paseoBinding,
            terminal: {
              ...ptyRuntimeStatus,
              errorCode: ptyRuntimeFailure?.code || null,
            },
          }
          const sites = siteRoutes.diagnostics()
          const terminals = listSessions().map(({ sessionId, name, branch, canvasId, widgetId, status }) => ({
            sessionId, name, branch, canvasId, widgetId, status,
          }))
          const watched = server.watcher?.getWatched?.() || {}
          const watchedDirectories = Object.entries(watched)
            .filter(([, files]) => Array.isArray(files) && files.length > 0)
            .map(([directory, files]) => ({ directory, fileCount: files.length }))
          const recovery = []
          if (!notebookStatus.active || !notebookAvailable) recovery.push('Open or rebind a Notebook in the Notebook switcher.')
          if (paseoBinding.state === 'failed' && paseoBinding.lastError) {
            recovery.push(`Paseo workspace registration failed: ${paseoBinding.lastError.message}. Verify the daemon is running and compatible, then restart Hypercanvas Core.`)
          } else if (paseoBinding.state === 'stale' || (notebookStatus.active && paseoBinding.state === 'idle')) {
            recovery.push('Paseo workspace registration is pending. Sessions will confirm once the daemon reconnects.')
          }
          if (!paseo.terminal.connected) recovery.push('Paseo PTY is unavailable. Check the daemon state, then restart Hypercanvas Core.')
          if (hostTools.baseline?.status !== 'valid') recovery.push('Review Node/npm status in Settings → Host tools.')
          const missingAgents = Object.entries(hostTools.agents || {}).filter(([, agent]) => agent?.status !== 'installed').map(([id]) => id)
          if (missingAgents.length) recovery.push(`Install or configure these agent CLIs in Settings → Host tools: ${missingAgents.join(', ')}.`)
          if (!recovery.length) recovery.push('Core and runtime checks are healthy.')

          return {
            core: {
              version: CORE_VERSION,
              pid: process.pid,
              uptimeSeconds: Math.floor(process.uptime()),
              vitePort,
              apiPort,
              base,
              mode: wrapperMode ? 'rust-wrapper' : 'browser-core',
            },
            node: { version: process.version, path: process.execPath },
            paseo,
            notebook: {
              active: Boolean(notebookStatus.active),
              available: notebookAvailable,
              root: notebookStatus.root || null,
              id: notebookStatus.notebook?.manifest?.id || null,
              title: notebookStatus.notebook?.manifest?.title || null,
            },
            hostTools,
            agents: hostTools.agents,
            sites,
            terminals,
            processes: [
              { kind: 'core', name: 'Hypercanvas Core', pid: process.pid, status: 'running' },
              ...sites.filter((site) => Number.isInteger(site.pid) && site.pid > 0).map((site) => ({
                kind: 'site', name: site.title || site.id, pid: site.pid, status: site.status,
              })),
            ],
            watches: {
              directories: watchedDirectories.slice(0, 20),
              totalDirectories: watchedDirectories.length,
              totalFiles: watchedDirectories.reduce((sum, entry) => sum + entry.fileCount, 0),
            },
            logs: readRecentDiagnosticLogs(resolveNotebookRuntimePath(notebookRoot, 'logs')),
            recovery,
          }
        },
      }))

      // Artifact CRUD delegates Site deletion to the same runtime owner used
      // by the Site API so removing metadata cannot orphan its process.
      routeHandlers.set('artifact', createArtifactRoutes({
        root: notebookRoot,
        sendJson: sendJsonLogged,
        deleteSite: siteRoutes.deleteSite,
      }))

      // One stateful installer owns plans and operations for this Vite server.
      const hostToolsInstaller = createHostToolsInstaller()
      routeHandlers.set('host-tools', createHostToolsHandler({
        installer: hostToolsInstaller,
        preflight: preflightHostTools,
        sendJson: sendJsonLogged,
      }))
      const selectE2eDirectory = process.env.STORYBOARD_E2E_PICKER === '1'
        ? async ({ purpose, e2eDirectory } = {}) => {
          const configuredRoot = process.env.STORYBOARD_E2E_PICKER_ROOT
          const requested = e2eDirectory || process.env[purpose === 'site' ? 'STORYBOARD_E2E_SITE_DIRECTORY' : 'STORYBOARD_E2E_NOTEBOOK_DIRECTORY']
          if (!configuredRoot || !requested) return null
          const allowedRoot = fs.realpathSync.native(path.resolve(configuredRoot))
          const selectedRoot = fs.realpathSync.native(path.resolve(requested))
          const relative = path.relative(allowedRoot, selectedRoot)
          if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
            throw new Error('E2E picker selection must stay inside its fixture directory.')
          }
          if (!fs.statSync(selectedRoot).isDirectory()) throw new Error('E2E picker selection must be a directory.')
          return selectedRoot
        }
        : undefined
      routeHandlers.set('system', createSystemRoutes({
        sendJson: sendJsonLogged,
        getNotebookRoot: requireNotebookRoot,
        eventSender: sendEvent,
        filesystemGrants,
        ...(selectE2eDirectory ? { selectDirectory: selectE2eDirectory } : {}),
      }))

      // Push all bus events to browser clients via Vite HMR WebSocket
      subscribeAll((channel, event) => {
        sendEvent({
          type: 'custom',
          event: 'storyboard:message',
          data: { channel, event },
        })
      })

      // Terminal sessions API — list, detach, kill sessions
      routeHandlers.set('terminal', async (req, res, ctx) => {
        // Strip query string and leading slash from path
        const rawPath = (ctx.path || '/').replace(/^\//, '')
        const subpath = rawPath.split('?')[0]

        // GET /sessions — list all sessions (optional ?branch= filter)
        if (ctx.method === 'GET' && (subpath === 'sessions' || subpath === 'sessions/')) {
          const url = new URL(req.url, 'http://localhost')
          const filterBranch = url.searchParams.get('branch') || null
          sendJsonLogged(res, 200, { sessions: listSessions(filterBranch) })
          return
        }

        // GET /sessions/stats — quick session counts by status
        if (ctx.method === 'GET' && subpath === 'sessions/stats') {
          sendJsonLogged(res, 200, getSessionStats())
          return
        }

        // POST /sessions/cleanup — bulk remove sessions by status
        if (ctx.method === 'POST' && subpath === 'sessions/cleanup') {
          try {
            const { statuses } = ctx.body || {}
            const allowed = new Set(['archived', 'background'])
            if (!Array.isArray(statuses) || statuses.length === 0) {
              sendJsonLogged(res, 400, { error: 'statuses must be a non-empty array' })
              return
            }
            const invalid = statuses.filter(s => !allowed.has(s))
            if (invalid.length > 0) {
              sendJsonLogged(res, 400, { error: `Invalid statuses: ${invalid.join(', ')}. Allowed: archived, background` })
              return
            }
            const result = await bulkCleanup({ statuses })
            sendJsonLogged(res, 200, { success: true, ...result })
          } catch {
            sendJsonLogged(res, 400, { error: 'Invalid JSON body' })
          }
          return
        }

        // POST /sessions/:name/detach — detach a session
        const detachMatch = subpath.match(/^sessions\/(.+)\/detach$/)
        if (ctx.method === 'POST' && detachMatch) {
          const sessionId = decodeURIComponent(detachMatch[1])
          const entry = detachSession(sessionId)
          if (!entry) {
            sendJsonLogged(res, 404, { error: 'Session not found' })
            return
          }
          sendJsonLogged(res, 200, { success: true, session: entry })
          return
        }

        // POST /sessions/:name/orphan — archive a session with grace timer
        const orphanMatch = subpath.match(/^sessions\/(.+)\/orphan$/)
        if (ctx.method === 'POST' && orphanMatch) {
          const sessionId = decodeURIComponent(orphanMatch[1])
          orphanSession(sessionId)
          sendJsonLogged(res, 200, { success: true })
          return
        }

        // DELETE /sessions/:name — kill a session immediately
        const deleteMatch = subpath.match(/^sessions\/(.+)$/)
        if (ctx.method === 'DELETE' && deleteMatch) {
          const sessionId = decodeURIComponent(deleteMatch[1])
          await killSession(sessionId)
          sendJsonLogged(res, 200, { success: true })
          return
        }

        // ── Hot Pool routes (/terminal/hot-pool/*) ──────────────

        // GET /hot-pool — pool status
        if (ctx.method === 'GET' && subpath === 'hot-pool') {
          sendJsonLogged(res, 200, hotPool.status())
          return
        }

        // PUT /hot-pool — reconfigure pool
        if (ctx.method === 'PUT' && subpath === 'hot-pool') {
          hotPool.reconfigure(ctx.body || {})
          sendJsonLogged(res, 200, hotPool.status())
          return
        }

        // POST /hot-pool/acquire — acquire a warm session from a specific pool
        if (ctx.method === 'POST' && subpath === 'hot-pool/acquire') {
          const poolId = ctx.body?.poolId || 'terminal'
          const session = hotPool.acquire(poolId)
          if (!session) {
            sendJsonLogged(res, 200, { acquired: false, poolId, session: null })
            return
          }
          sendJsonLogged(res, 200, { acquired: true, poolId, session: { id: session.id, runtimeSessionId: session.runtimeSessionId, poolId: session.poolId } })
          return
        }

        sendJsonLogged(res, 404, { error: 'Not found' })
      })

      // Worktrees API — merge live registry with on-disk worktree list so the
      // BranchBar can show running siblings (with port + url) AND siblings
      // that exist but aren't running (so the UI can offer to spin them up).
      routeHandlers.set('worktrees', async (req, res) => {
        try {
          const servers = listRunningServers(root)
          const runningByName = new Map(servers.map(s => [s.worktree, s]))
          const allNames = new Set(['main', ...listWorktrees(root)])
          for (const name of runningByName.keys()) allNames.add(name)

          const branches = []
          for (const name of allNames) {
            const srv = runningByName.get(name)
            const isMain = name === 'main'
            branches.push({
              branch: name,
              folder: isMain ? '' : `branch--${name}/`,
              running: !!srv,
              port: srv?.port ?? null,
              url: srv ? `http://localhost:${srv.port}/storyboard/` : null,
            })
          }
          // Main first, then alphabetical
          branches.sort((a, b) => a.branch === 'main' ? -1 : b.branch === 'main' ? 1 : a.branch.localeCompare(b.branch))
          sendJsonLogged(res, 200, branches)
        } catch { sendJsonLogged(res, 200, []) }
      })

      // Switch-branch API — spawn a detached `storyboard dev` for the
      // requested worktree and wait until it self-registers, then return
      // its URL so the BranchBar can navigate directly.
      routeHandlers.set('switch-branch', async (req, res) => {
        const body = await new Promise((resolve) => {
          let buf = ''
          req.on('data', (c) => buf += c)
          req.on('end', () => { try { resolve(JSON.parse(buf || '{}')) } catch { resolve({}) } })
          req.on('error', () => resolve({}))
        })
        const branch = String(body.branch || '').trim()
        if (!branch) { sendJsonLogged(res, 400, { error: 'Missing "branch"' }); return }

        // Already running? Return immediately.
        const existing = findByWorktree(branch, root)
        if (existing.length > 0) {
          const srv = existing[0]
          sendJsonLogged(res, 200, { status: 'already_running', url: `http://localhost:${srv.port}/storyboard/`, port: srv.port, id: srv.id })
          return
        }

        // Resolve target cwd
        const cwd = branch === 'main' ? root : worktreeDir(branch, root)
        if (!fs.existsSync(path.resolve(cwd, '.git'))) {
          sendJsonLogged(res, 404, { error: `Worktree "${branch}" does not exist` })
          return
        }

        // Detached spawn — exits independently of this Vite process.
        const { spawn } = await import('node:child_process')
        const npmBin = process.platform === 'win32' ? 'npx.cmd' : 'npx'
        try {
          const child = spawn(npmBin, ['storyboard', 'dev'], {
            cwd,
            detached: true,
            stdio: 'ignore',
            // A branch dev server is another Core server, so it receives the
            // resolved daemon settings but not the browser launch token.
            env: createPaseoServerEnvironment(withoutRuntimeCredentials(process.env), {
              url: process.env.PASEO_DAEMON_URL,
              password: process.env.PASEO_DAEMON_PASSWORD,
              authHeader: process.env.PASEO_DAEMON_AUTH_HEADER,
            }),
          })
          child.unref()
        } catch (err) {
          sendJsonLogged(res, 500, { error: `Spawn failed: ${err.message}` })
          return
        }

        // Poll registry up to 30s.
        const start = Date.now()
        while (Date.now() - start < 30000) {
          await new Promise(r => setTimeout(r, 500))
          const matches = findByWorktree(branch, root)
          if (matches.length > 0) {
            const srv = matches[matches.length - 1]
            sendJsonLogged(res, 200, { status: 'started', url: `http://localhost:${srv.port}/storyboard/`, port: srv.port, id: srv.id })
            return
          }
        }
        sendJsonLogged(res, 504, { error: `Spawned but did not self-register within 30s` })
      })

      // Git user — return git config user name and GitHub login (via gh CLI)
      routeHandlers.set('git-user', async (req, res) => {
        try {
          const { execSync } = await import('node:child_process')
          const name = execSync('git config user.name', { cwd: root, encoding: 'utf8' }).trim()
          let login = null
          try {
            const status = execSync('gh auth status 2>&1', { cwd: root, encoding: 'utf8' })
            const m = status.match(/Logged in to github\.com account (\S+)/) || status.match(/Logged in to github\.com as (\S+)/)
            if (m) login = m[1]
          } catch { /* gh not installed or not logged in */ }
          sendJsonLogged(res, 200, { name, login })
        } catch { sendJsonLogged(res, 200, { name: null, login: null }) }
      })

      // Current branch — live read of HEAD via git. The BranchBar uses
      // this as the source of truth instead of parsing /branch--<name>/
      // out of the URL (which doesn't exist anymore).
      routeHandlers.set('current-branch', async (req, res) => {
        try {
          const { execSync } = await import('node:child_process')
          const branch = execSync('git branch --show-current', { cwd: root, encoding: 'utf8' }).trim() || null
          sendJsonLogged(res, 200, { branch })
        } catch { sendJsonLogged(res, 200, { branch: null }) }
      })

      // Per-branch artifact manifest parity route for local dev.
      routeHandlers.set('artifacts.json', async (req, res) => {
        try {
          const discovery = buildDataDiscovery(requireNotebookRoot(), { includeDraft: true, contentOnly: true })
          const env = resolveManifestEnv({ env: { ...process.env, basePath: base || '/' }, cwd: requireNotebookRoot() })
          sendJsonLogged(res, 200, buildArtifactManifest({ discovery, env }))
        } catch (err) {
          sendJsonLogged(res, 500, { error: err.message || 'Failed to build artifacts manifest' })
        }
      })

      // Watch all config domains and tag their reloads so the configuration
      // guard remains independent from canvas UI and prototype policies.
      const configNames = [
        'storyboard.config.json',
        'toolbar.config.json',
        'commandpalette.config.json',
        'paste.config.json',
        'widgets.config.json',
        'terminal.config.json',
        'mascot.config.json',
      ]
      const configPaths = configNames.flatMap((filename) => [
        path.resolve(notebookRoot, filename),
        path.resolve(root, 'packages/storyboard', filename),
      ])
      server.watcher.add(configPaths)
      server.watcher.on('change', (filePath) => {
        const resolved = path.resolve(filePath)
        if (configPaths.includes(resolved)) {
          // Invalidate the cached JSON module so Vite re-reads from disk
          const mods = server.moduleGraph.getModulesByFile(resolved)
          if (mods) for (const mod of mods) {
              server.moduleGraph.invalidateModule(mod)
          }
          server.ws.send({ type: 'full-reload', path: resolved })
        }
      })

      // Workshop client UI is now mounted by mountStoryboardCore() via the
      // compiled UI bundle. No script injection needed.

      // Plugin registry for external plugins (future use).
      // Plugins call registerRoutes/registerClientScript in their setup().
      // const pluginCtx = { server, root, config, registerRoutes, registerClientScript }
      // Future: auto-discover and initialize plugins from pluginsConfig here

      // Mount the /_storyboard/ middleware router
      // Vite's dev server strips the base path from req.url for middleware,
      // but the base-redirect plugin may redirect bare URLs first.
      // We check both with and without base prefix.
      const apiSetup = createRouteSetup({
        base,
        routeHandlers,
        sendJson: sendJsonLogged,
        ws: server.ws,
        proxyUrl: externalServerUrl || (() => {
          const address = hypercanvasServer?.server.address()
          return typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : 'http://127.0.0.1:0'
        }),
        proxyAll: () => Boolean(externalServerUrl || hypercanvasServer?.server.listening),
      })
      server.middlewares.use((req, res, next) => {
        let url = req.url || ''
        const baseNoTrail = base.replace(/\/$/, '')
        if (baseNoTrail && url.startsWith(baseNoTrail)) url = url.slice(baseNoTrail.length) || '/'
        if (url === '/_storyboard/ws-url' && hypercanvasServer?.server.listening) {
          const address = hypercanvasServer.server.address()
          const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws'
          if (typeof address === 'object' && address) {
            // Behind the instance proxy the browser must stay same-origin:
            // derive the WebSocket URL from the request Host instead of the
            // dynamic backend port.
            if (proxyOrigin && req.headers.host) {
              return sendJsonLogged(res, 200, { url: `${protocol}://${req.headers.host}${hypercanvasServer.socketPath}` })
            }
            return sendJsonLogged(res, 200, { url: `${protocol}://127.0.0.1:${address.port}${hypercanvasServer.socketPath}` })
          }
        }
        if (url === INTERNAL_RELAUNCH_PATH && req.method === 'POST') {
          // Duplicate-launch handoff: the instance proxy forwards relaunch
          // requests here so the token is minted by the browser-session
          // owner. Loopback callers only — the proxy already gates this,
          // and the check below covers direct local access.
          const peer = req.socket?.remoteAddress
          if (peer !== '127.0.0.1' && peer !== '::1' && peer !== '::ffff:127.0.0.1') {
            return sendJsonLogged(res, 403, { error: 'relaunch_loopback_only' })
          }
          const registrationToken = process.env.HYPERCANVAS_PROXY_REGISTRATION_TOKEN
          if (registrationToken && req.headers.authorization !== `Bearer ${registrationToken}`) {
            return sendJsonLogged(res, 401, { error: 'internal_auth_required' })
          }
          req.resume()
          req.on('end', () => {
            const viteBase = server.config.base || '/'
            const launchUrl = proxyOrigin ? `${proxyOrigin}${viteBase === '/' ? '/' : viteBase}` : null
            if (!launchUrl) {
              return sendJsonLogged(res, 503, { error: 'relaunch_unavailable' })
            }
            return sendJsonLogged(res, 200, { url: launchUrl, token: browserSession.issueLaunchToken() })
          })
          return
        }
        return next()
      })
      server.middlewares.use(siteRoutes.previewMiddleware({
        base,
        authorizeRequest: browserSession.isAuthenticated,
      }))
      server.middlewares.use(createApiGate({
        base,
        apiMiddleware: apiSetup.middleware,
        sendJson: sendJsonLogged,
        isAllowedOrigin: (headers, options) => isAllowedRequestOrigin(headers, {
          ...options,
          allowForwardedHttpsOrigin: wrapperMode && !browserSessionHandoffEnabled,
        }),
        isAuthorized: browserSession.isAuthenticated,
        desktop: process.env.STORYBOARD_DESKTOP === '1',
        getNotebookRuntimeMiddleware: () => server.__hypercanvasNotebookRuntime,
      }))
    },

    transformIndexHtml() {
      const tags = []

      if (browserCoreMode) {
        tags.push({
          tag: 'script',
          children: 'window.__HYPERCANVAS_CORE_MODE__=true',
          injectTo: 'head',
        })
      }

      // Inject local dev flag only during dev server (not production builds)
      if (isDev) {
        tags.push({
          tag: 'script',
          children: 'window.__SB_LOCAL_DEV__=true',
          injectTo: 'head',
        })

        // Inject dev domain name for branch bar display.
        // Sourced from config.repository.name, with the project directory
        // basename as a fallback so every repo gets a labelled bar even
        // before storyboard.config.json is filled in.
        // Use the main repo root (not cwd) so worktrees don't shadow the
        // project name with the worktree directory name (which often equals
        // the branch name).
        let projectRoot = process.cwd()
        try {
          const commonDir = cpExecSync('git rev-parse --path-format=absolute --git-common-dir', {
            cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
          }).trim()
          if (commonDir) projectRoot = commonDir.replace(/\/?\.git\/?$/, '') || projectRoot
        } catch { /* not a git repo — fall back to cwd */ }
        const devDomainLabel = config.repository?.name || path.basename(projectRoot)
        if (devDomainLabel) {
          tags.push({
            tag: 'script',
            children: `window.__SB_DEV_DOMAIN__=${JSON.stringify(devDomainLabel)}`,
            injectTo: 'head',
          })
        }

        // Inject per-domain branch bar color (configurable via devDomainColor)
        if (config.devDomainColor) {
          tags.push({
            tag: 'script',
            children: `window.__SB_DEV_DOMAIN_COLOR__=${JSON.stringify(config.devDomainColor)}`,
            injectTo: 'head',
          })
        }

        // Browser error bridge — forwards console.error/warn and uncaught
        // exceptions to the dev server via HMR for structured o11y logging
        tags.push({
          tag: 'script',
          attrs: { type: 'module' },
          children: `
(function() {
  if (!import.meta.hot) return;
  var MAX_LEN = 2000;
  function trunc(s) { return typeof s === 'string' && s.length > MAX_LEN ? s.slice(0, MAX_LEN) + '…' : s; }
  function route() { return location.pathname + location.hash; }
  function send(level, msg, extra) {
    try { import.meta.hot.send('storyboard:client-error', Object.assign({ level: level, message: trunc(msg), route: route() }, extra || {})); } catch {}
  }
  // Patch console.error and console.warn
  ['error', 'warn'].forEach(function(level) {
    var orig = console[level];
    console[level] = function() {
      orig.apply(console, arguments);
      var parts = [];
      for (var i = 0; i < arguments.length; i++) {
        try { parts.push(typeof arguments[i] === 'string' ? arguments[i] : JSON.stringify(arguments[i])); } catch { parts.push(String(arguments[i])); }
      }
      send(level, parts.join(' '));
    };
  });
  // Uncaught errors
  window.addEventListener('error', function(e) {
    send('error', e.message || 'Uncaught error', { url: e.filename, line: e.lineno, col: e.colno, stack: trunc(e.error && e.error.stack) });
  });
  // Unhandled promise rejections
  window.addEventListener('unhandledrejection', function(e) {
    var msg = e.reason ? (e.reason.message || String(e.reason)) : 'Unhandled rejection';
    send('error', msg, { stack: trunc(e.reason && e.reason.stack) });
  });
})();
`.trim(),
          injectTo: 'head',
        })
      }

      if (process.env.HYPERCANVAS_SMOKE_RENDER_MARKER) {
        const renderTimeoutMs = (Number(process.env.HYPERCANVAS_SMOKE_RENDER_TIMEOUT_SECS) || 120) * 1000
        tags.push({
          tag: 'script',
          children: `
(function(){
  var observer;
  var interval;
  function stopWatching(){
    if (observer) observer.disconnect();
    if (interval) clearInterval(interval);
  }
  function reportMounted(){
    if (window.__HYPERCANVAS_CLIENT_MOUNTED__ !== true) return false;
    fetch('/_storyboard/desktop-ready', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mounted: true })
    }).catch(function(){});
    stopWatching();
    return true;
  }
  if (reportMounted()) return;
  observer = new MutationObserver(reportMounted);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  interval = setInterval(reportMounted, 1000);
  setTimeout(stopWatching, ${renderTimeoutMs + 15000});
})();
`.trim(),
          injectTo: 'body',
        })
      }

      // Auto-reload on Vite's "outdated optimize dep" 504 errors.
      // Happens when the dep graph IDs in cached chunks no longer match
      // what Vite is serving (after upgrades, dep additions, etc).
      // We catch failed fetches inside the page and trigger a full reload
      // once — the second load will see the freshly-built optimize deps.
      if (isDev) {
        tags.push({
          tag: 'script',
          children: `
(function(){
  var reloaded = false;
  function maybeReload(reason){
    if (reloaded) return;
    if (sessionStorage.getItem('__sb_outdated_reload__')) return;
    reloaded = true;
    sessionStorage.setItem('__sb_outdated_reload__', '1');
    console.warn('[storyboard] Reloading: ' + reason);
    setTimeout(function(){ sessionStorage.removeItem('__sb_outdated_reload__'); }, 5000);
    location.reload();
  }
  // Clear stale guard from previous successful loads.
  if (document.readyState === 'complete') {
    sessionStorage.removeItem('__sb_outdated_reload__');
  } else {
    window.addEventListener('load', function(){
      setTimeout(function(){ sessionStorage.removeItem('__sb_outdated_reload__'); }, 2000);
    });
  }
  // Catch module load failures.
  window.addEventListener('error', function(e){
    var msg = (e && e.message) || '';
    if (/Outdated Optimize Dep|Failed to fetch dynamically imported module|504/i.test(msg)) {
      maybeReload('outdated dep / dynamic import failure');
    }
  }, true);
  // Catch unhandled promise rejections from dynamic imports.
  window.addEventListener('unhandledrejection', function(e){
    var msg = (e && e.reason && (e.reason.message || String(e.reason))) || '';
    if (/Outdated Optimize Dep|Failed to fetch dynamically imported module|504/i.test(msg)) {
      maybeReload('outdated dep / dynamic import failure');
    }
  });
})();
`.trim(),
          injectTo: 'head',
        })
      }

      // Inject base path so the inspector UI can resolve static assets
      // (e.g. inspector.json) when deployed under a subpath
      tags.push({
        tag: 'script',
        children: `window.__STORYBOARD_BASE_PATH__=${JSON.stringify(base)}`,
        injectTo: 'head',
      })

      for (const src of clientScripts) {
        tags.push({
          tag: 'script',
          attrs: { type: 'module', src: base + src.replace(/^\//, '') },
          injectTo: 'body',
        })
      }

      // Inject the storyboard brand favicon as a data URI. Appending to
      // head means it wins over any earlier <link rel="icon"> the consumer
      // declared (browsers use the last declaration).
      if (faviconDataUri) {
        tags.push({
          tag: 'link',
          attrs: { rel: 'icon', type: 'image/svg+xml', href: faviconDataUri },
          injectTo: 'head',
        })
      }

      return tags
    },

    // Build-time: emit a static JSON with source files so the inspector
    // works in deployed environments without the dev middleware.
    async generateBundle() {
      const srcDir = path.join(root, 'src')
      const prototypesDir = path.join(root, 'src', 'prototypes')

      // Collect file lists (prototypes for the files index, all src/ for sources)
      const [prototypeFiles, allSrcFiles] = await Promise.all([
        collectFiles(prototypesDir, root),
        collectFiles(srcDir, root),
      ])

      // Read all source file contents
      const sources = {}
      await Promise.all(
        allSrcFiles.map(async (relPath) => {
          try {
            sources[relPath] = await fs.promises.readFile(
              path.join(root, relPath),
              'utf-8'
            )
          } catch { /* skip unreadable files */ }
        })
      )

      // Resolve repo info (same logic as docs-handler)
      let repo = null
      try {
        const { execSync } = await import('node:child_process')
        const remote = execSync('git remote get-url origin', {
          cwd: root,
          encoding: 'utf-8',
        }).trim()
        const match = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)/)
        if (match) repo = { owner: match[1], name: match[2] }
      } catch { /* no git or no remote */ }

      if (!repo) {
        const configPath = path.join(root, 'storyboard.config.json')
        try {
          const raw = await fs.promises.readFile(configPath, 'utf-8')
          const cfg = JSON.parse(raw)
          if (cfg.repository?.owner && cfg.repository?.name) {
            repo = { owner: cfg.repository.owner, name: cfg.repository.name }
          }
        } catch { /* config not available */ }
      }

      this.emitFile({
        type: 'asset',
        fileName: '_storyboard/inspector.json',
        source: JSON.stringify({
          files: prototypeFiles.sort(),
          sources,
          repo,
        }),
      })

      // Emit README as static JSON so the docs panel works in deployed builds.
      // Dev server serves this dynamically; production needs the static file.
      let readmeContent = null
      for (const candidate of ['README.md', 'readme.md', 'Readme.md']) {
        try {
          readmeContent = await fs.promises.readFile(path.join(root, candidate), 'utf-8')
          break
        } catch { /* try next */ }
      }
      if (readmeContent) {
        this.emitFile({
          type: 'asset',
          fileName: '_storyboard/docs/readme',
          source: JSON.stringify({ content: readmeContent, path: 'README.md' }),
        })
      }

      // Emit repo info so the docs panel GitHub link works in deployed builds.
      if (repo) {
        this.emitFile({
          type: 'asset',
          fileName: '_storyboard/docs/repo',
          source: JSON.stringify(repo),
        })
      }

      // Emit story sources JSON so the "show code" widget action works in
      // deployed builds. In dev, StoryWidget uses Vite's ?raw import; in prod
      // it fetches this static JSON instead.
      const storySources = {}
      const storyExts = ['.story.jsx', '.story.tsx', '.story.js', '.story.ts']
      for (const relPath of allSrcFiles) {
        if (storyExts.some(ext => relPath.endsWith(ext))) {
          storySources[relPath] = sources[relPath] || ''
        }
      }
      if (Object.keys(storySources).length > 0) {
        this.emitFile({
          type: 'asset',
          fileName: '_storyboard/stories/sources.json',
          source: JSON.stringify(storySources),
        })
      }

      // Emit canvas images so they're available in deployed (static) builds.
      // Dev server serves these dynamically; production needs the static files.
      // Private images (prefixed with ~) are excluded from the build.
      for (const dir of [
        path.join(root, 'assets', 'canvas', 'images'),
        path.join(root, 'assets', 'canvas', 'snapshots'),
      ]) {
        try {
          const imageFiles = await fs.promises.readdir(dir)
          const subdir = dir.endsWith('snapshots') ? 'snapshots' : 'images'
          for (const file of imageFiles) {
            if (file.startsWith('~') || file.startsWith('.')) continue
            try {
              const data = await fs.promises.readFile(path.join(dir, file))
              this.emitFile({
                type: 'asset',
                fileName: `_storyboard/canvas/${subdir}/${file}`,
                source: data,
              })
            } catch { /* skip unreadable files */ }
          }
        } catch { /* directory doesn't exist */ }
      }

      // GitHub Pages uses Jekyll which ignores _-prefixed directories.
      // Emit .nojekyll to ensure _storyboard/ is served.
      this.emitFile({
        type: 'asset',
        fileName: '.nojekyll',
        source: '',
      })

      // Emit CNAME for GitHub Pages custom domain if configured.
      // Without this, deploy scripts that clean the gh-pages root will
      // delete the CNAME on every push, causing intermittent 404s.
      const customDomain = (config.customDomain || '').trim()
      if (customDomain && !customDomain.includes('/') && !customDomain.includes(':') && !customDomain.includes(' ')) {
        this.emitFile({
          type: 'asset',
          fileName: 'CNAME',
          source: customDomain + '\n',
        })
      }
    },
  }
}

export { sendJson }
