/**
 * Global instance claim for Hypercanvas Core.
 *
 * The claim is the selected proxy socket itself (see instance-proxy.js):
 * binding it wins ownership, losing the bind means another process holds the
 * port. The holder is classified by probing the proxy-owned instance
 * endpoint — a running Hypercanvas answers, anything else is foreign.
 */

import { execFile } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import {
  DEFAULT_INSTANCE_PORT,
  INSTANCE_PATH,
  RELAUNCH_PATH,
  acquireInstanceProxy,
} from './instance-proxy.js'

const INSTANCE_SCAN_LOOKAHEAD = 64
const INSTANCE_PROBE_CONCURRENCY = 16
const LEGACY_INSTANCE_PORT = 2345

function fetchJson({ host, port, path, method = 'GET', timeoutMs }) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host, port, path, method, timeout: timeoutMs }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => {
        try {
          resolve({ status: response.statusCode, body: JSON.parse(body) })
        } catch {
          reject(new Error(`Non-JSON response from ${path}`))
        }
      })
    })
    request.once('timeout', () => request.destroy(new Error(`Timed out probing ${path}`)))
    request.once('error', reject)
    request.end()
  })
}

/**
 * Probe the instance endpoint without claiming, across loopback stacks.
 * Returns the Hypercanvas instance payload ({ app, pid, version, url,
 * notebook, ready }) or null when the port is closed, foreign, or silent.
 */
export function probeInstanceEndpoint({ port, timeoutMs = 1500 } = {}) {
  return findInstance({ port, timeoutMs }).then((found) => (found ? found.body : null))
}

function isListening({ host, port, timeoutMs = 250 }) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    let settled = false
    const finish = (listening) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(listening)
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(timeoutMs, () => finish(true))
  })
}

async function portIsListening(port, timeoutMs) {
  const [ipv4, ipv6] = await Promise.all([
    isListening({ host: '127.0.0.1', port, timeoutMs }),
    isListening({ host: '::1', port, timeoutMs }),
  ])
  return ipv4 && ipv6
}

function listLoopbackProxyPorts() {
  return new Promise((resolve) => {
    execFile('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'n'], { timeout: 2000 }, (error, stdout) => {
      if (error) {
        resolve(null)
        return
      }
      const loopbackStacks = new Map()
      for (const line of String(stdout || '').split('\n')) {
        const match = line.match(/^n(.*):(\d+)$/)
        const address = match?.[1]
        const matchedPort = Number(match?.[2])
        if (!Number.isInteger(matchedPort) || matchedPort < 1 || matchedPort > 65535) continue
        const stack = address === '127.0.0.1'
          ? 'ipv4'
          : address === '[::1]' || address === '::1'
            ? 'ipv6'
            : null
        if (!stack) continue
        const existing = loopbackStacks.get(matchedPort) || new Set()
        existing.add(stack)
        loopbackStacks.set(matchedPort, existing)
      }
      // The proxy deliberately owns both loopback stacks; Vite and other
      // backends are separate listeners and must not be probed as candidates.
      resolve([...loopbackStacks]
        .filter(([, stacks]) => stacks.has('ipv4') && stacks.has('ipv6'))
        .map(([port]) => port)
        .sort((a, b) => a - b))
    })
  })
}

async function firstInstanceOnPorts(ports, timeoutMs) {
  for (let index = 0; index < ports.length; index += INSTANCE_PROBE_CONCURRENCY) {
    const batch = ports.slice(index, index + INSTANCE_PROBE_CONCURRENCY)
    const matches = await Promise.all(batch.map(async (port) => {
      const instance = await probeInstanceEndpoint({ port, timeoutMs })
      return instance ? { port, instance } : null
    }))
    const found = matches.filter(Boolean).sort((a, b) => a.port - b.port)[0]
    if (found) return found
  }
  return null
}

/** Find an existing Hypercanvas instance, including one on a prior fallback port. */
export async function findExistingInstance({ port, probeTimeoutMs = 250 } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null

  const proxyPorts = await listLoopbackProxyPorts()
  if (proxyPorts?.length) {
    return firstInstanceOnPorts(proxyPorts, probeTimeoutMs)
  }

  // Portable fallback for systems without lsof: check a small neighborhood
  // around the preferred port, plus the current and previous default ports,
  // so a selected fallback remains discoverable if an earlier blocker exits.
  const candidates = new Set([
    ...Array.from(
      { length: INSTANCE_SCAN_LOOKAHEAD * 2 + 1 },
      (_, offset) => port - INSTANCE_SCAN_LOOKAHEAD + offset,
    ),
    DEFAULT_INSTANCE_PORT,
    LEGACY_INSTANCE_PORT,
  ])
  const listeningCandidates = []
  for (const candidate of [...candidates].filter((value) => value > 0 && value <= 65535).sort((a, b) => a - b)) {
    if (await portIsListening(candidate, probeTimeoutMs)) listeningCandidates.push(candidate)
  }
  return firstInstanceOnPorts(listeningCandidates, probeTimeoutMs)
}

async function findInstance({ port, timeoutMs }) {
  for (const probeHost of ['127.0.0.1', '::1']) {
    const found = await fetchJson({ host: probeHost, port, path: INSTANCE_PATH, timeoutMs })
      .then(({ body }) => (body?.app === 'hypercanvas' ? { host: probeHost, body } : null))
      .catch(() => null)
    if (found) return found
  }
  return null
}

/**
 * Best-effort pid lookup for a listener (macOS lsof). Returns null when the
 * platform helper is unavailable — including under NODE_ENV=test so claim
 * tests stay deterministic.
 */
export function findListenerPid(port) {
  if (process.env.NODE_ENV === 'test') return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile('lsof', ['-ti', `:${port}`, '-sTCP:LISTEN'], { timeout: 2000 }, (error, stdout) => {
      if (error) {
        resolve(null)
        return
      }
      const pid = Number.parseInt(String(stdout || '').split('\n')[0], 10)
      resolve(Number.isInteger(pid) && pid > 0 ? pid : null)
    })
  })
}

/**
 * Attempt to claim the global instance.
 *
 * @returns {object} one of:
 *   { kind: 'owned', proxy } — this process owns the instance
 *   { kind: 'running', url, token, instance } — another Hypercanvas owns it
 *   { kind: 'foreign', pid, detail } — another application holds the port
 */
async function attemptInstanceClaimAtPort({
  port,
  host = null,
  probeTimeoutMs = 500,
  readinessTimeoutMs = 45_000,
  readinessPollIntervalMs = 100,
  ...proxyOptions
} = {}) {
  let proxy = null
  try {
    proxy = await acquireInstanceProxy({ port, host, ...proxyOptions })
    return { kind: 'owned', proxy }
  } catch (error) {
    if (error?.code !== 'EADDRINUSE') throw error
  }

  const running = await claimRunningInstance(port, {
    probeTimeoutMs,
    readinessTimeoutMs,
    readinessPollIntervalMs,
  })
  if (running) return running

  return { kind: 'foreign', port }
}

async function claimRunningInstance(port, {
  probeTimeoutMs = 500,
  readinessTimeoutMs = 45_000,
  readinessPollIntervalMs = 100,
} = {}) {
  let found = await findInstance({ port, timeoutMs: probeTimeoutMs })
  if (!found) return null
  if (found && !found.body.ready) {
    const deadline = Date.now() + readinessTimeoutMs
    while (!found.body.ready && Date.now() < deadline) {
      await delay(readinessPollIntervalMs)
      found = await findInstance({ port, timeoutMs: probeTimeoutMs })
      if (!found) {
        throw new Error('The existing Hypercanvas instance stopped during startup; retry the launch.')
      }
    }
    if (!found.body.ready) {
      throw new Error(`The Hypercanvas instance on port ${port} did not become ready within ${readinessTimeoutMs}ms.`)
    }
  }
  if (found) {
    const relaunch = await fetchJson({ host: found.host, port, path: RELAUNCH_PATH, method: 'POST', timeoutMs: probeTimeoutMs })
      .then(({ body }) => (body?.url && body?.token ? body : null))
      .catch(() => null)
    return {
      kind: 'running',
      url: relaunch?.url || found.body.url,
      token: relaunch?.token || null,
      instance: found.body,
    }
  }
  return null
}

function describeForeignPort(port, pid) {
  return {
    kind: 'foreign',
    port,
    pid,
    detail: pid
      ? `Port ${port} is in use by another application (pid ${pid}). Stop that process or choose a different port with HYPERCANVAS_PROXY_PORT or hypercanvas.proxyPort in storyboard.config.json.`
      : `Port ${port} is in use by another application. Stop that process or choose a different port with HYPERCANVAS_PROXY_PORT or hypercanvas.proxyPort in storyboard.config.json.`,
  }
}

/** Attempt to claim one specific port, preserving explicit conflict details. */
export async function attemptInstanceClaim(options = {}) {
  const claim = await attemptInstanceClaimAtPort(options)
  if (claim.kind !== 'foreign') return claim
  const pid = await findListenerPid(options.port).catch(() => null)
  return describeForeignPort(options.port, pid)
}

/** Claim the first available port at or above `port`, skipping foreign listeners. */
export async function attemptInstanceClaimWithFallback({ port, maxPort = 65535, ...options } = {}) {
  if (port === 0) return attemptInstanceClaimAtPort({ ...options, port })

  // Search all currently listening candidates before binding the preferred
  // port. This also finds an instance on a fallback port if an earlier
  // foreign listener has since exited.
  const existing = await findExistingInstance({
    port,
    probeTimeoutMs: options.probeTimeoutMs ?? 250,
  })
  if (existing) {
    const running = await claimRunningInstance(existing.port, options)
    if (running) return { ...running, port: existing.port }
  }

  for (let candidate = port; candidate <= maxPort; candidate++) {
    const claim = await attemptInstanceClaimAtPort({
      ...options,
      port: candidate,
      probeTimeoutMs: options.probeTimeoutMs ?? 250,
    })
    if (claim.kind !== 'foreign') return { ...claim, port: candidate }
  }

  return {
    kind: 'exhausted',
    port,
    detail: `No available Hypercanvas proxy port from ${port} through ${maxPort}. Free a port or change hypercanvas.proxyPort in storyboard.config.json.`,
  }
}
