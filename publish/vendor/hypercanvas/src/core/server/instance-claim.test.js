import http from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { INSTANCE_PATH, RELAUNCH_PATH } from './instance-proxy.js'
import {
  attemptInstanceClaim,
  attemptInstanceClaimWithFallback,
  findExistingInstance,
  findListenerPid,
  probeInstanceEndpoint,
} from './instance-claim.js'

const fixturePorts = vi.hoisted(() => new Set())

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal()
  const execFile = (command, args, options, callback) => {
    if (command === 'lsof' && args.includes('-F')) {
      // Discovery sees test-owned listeners, never a user's running Core.
      const output = [...fixturePorts].map((port) => `n127.0.0.1:${port}\nn[::1]:${port}`).join('\n')
      callback(null, output)
      return
    }
    return actual.execFile(command, args, options, callback)
  }
  return { ...actual, execFile, default: { ...actual.default, execFile } }
})

function occupy(port, handler) {
  const server = http.createServer(handler)
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      const boundPort = server.address().port
      fixturePorts.add(boundPort)
      server.once('close', () => fixturePorts.delete(boundPort))
      resolve(server)
    })
  })
}

async function occupyDualLoopback(port, handler) {
  const ipv4 = await occupy(port, handler)
  const ipv6 = http.createServer(handler)
  try {
    await new Promise((resolve, reject) => {
      ipv6.once('error', reject)
      ipv6.listen(ipv4.address().port, '::1', resolve)
    })
  } catch (error) {
    await closeServer(ipv4)
    throw error
  }

  return {
    address: () => ipv4.address(),
    close(callback) {
      Promise.all([closeServer(ipv4), closeServer(ipv6)]).then(() => callback?.())
    },
  }
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve))
}

describe('instance claim', () => {
  it('owns the instance when the port is free', async () => {
    const claim = await attemptInstanceClaim({
      port: 0,
      instanceInfo: { url: 'http://hypercanvas.localhost:2345/', version: 'test' },
    })
    expect(claim.kind).toBe('owned')
    expect(claim.proxy.port).toBeGreaterThan(0)
    await claim.proxy.close()
  })

  it('reports a running Hypercanvas instance with a relaunch token', async () => {
    const holder = await occupy(0, (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      if (req.url === INSTANCE_PATH) {
        res.end(JSON.stringify({ app: 'hypercanvas', ready: true, url: 'http://hypercanvas.localhost:2345/', notebook: { title: 'Demo' } }))
      } else if (req.url === RELAUNCH_PATH) {
        res.end(JSON.stringify({ url: 'http://hypercanvas.localhost:2345/', token: 'fresh-token' }))
      } else {
        res.end(JSON.stringify({}))
      }
    })
    const port = holder.address().port
    const claim = await attemptInstanceClaim({ port })
    expect(claim).toMatchObject({ kind: 'running', url: 'http://hypercanvas.localhost:2345/', token: 'fresh-token' })
    expect(claim.instance.notebook).toEqual({ title: 'Demo' })
    await expect(probeInstanceEndpoint({ port })).resolves.toMatchObject({ app: 'hypercanvas', ready: true })
    await closeServer(holder)
    await expect(probeInstanceEndpoint({ port })).resolves.toBe(null)
  })

  it('waits for an existing proxy to become ready before reporting the instance', async () => {
    let instanceProbes = 0
    const holder = await occupy(0, (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      if (req.url === INSTANCE_PATH) {
        instanceProbes += 1
        res.end(JSON.stringify({
          app: 'hypercanvas',
          ready: instanceProbes > 1,
          url: 'http://hypercanvas.localhost:2345/',
        }))
      } else if (req.url === RELAUNCH_PATH) {
        res.end(JSON.stringify({ url: 'http://hypercanvas.localhost:2345/', token: 'ready-token' }))
      } else {
        res.end('{}')
      }
    })

    const claim = await attemptInstanceClaim({
      port: holder.address().port,
      probeTimeoutMs: 100,
      readinessTimeoutMs: 1000,
      readinessPollIntervalMs: 5,
    })
    expect(claim).toMatchObject({ kind: 'running', token: 'ready-token' })
    expect(instanceProbes).toBeGreaterThan(1)
    await closeServer(holder)
  })

  it('reports the running instance URL without a token when relaunch is unavailable', async () => {
    const holder = await occupy(0, (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      if (req.url === INSTANCE_PATH) {
        res.end(JSON.stringify({ app: 'hypercanvas', ready: true, url: 'http://hypercanvas.localhost:2345/' }))
      } else {
        res.end(JSON.stringify({ error: 'relaunch_unavailable' }))
      }
    })
    const claim = await attemptInstanceClaim({ port: holder.address().port })
    expect(claim).toMatchObject({ kind: 'running', url: 'http://hypercanvas.localhost:2345/', token: null })
    await closeServer(holder)
  })

  it('classifies a foreign holder with a clear error', async () => {
    const holder = await occupy(0, (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('not hypercanvas')
    })
    const claim = await attemptInstanceClaim({ port: holder.address().port })
    expect(claim.kind).toBe('foreign')
    expect(claim.detail).toMatch(/in use by another application/)
    expect(claim.detail).toMatch(/HYPERCANVAS_PROXY_PORT/)
    expect(claim.detail).toMatch(/hypercanvas\.proxyPort/)
    await closeServer(holder)
  })

  it('skips a foreign listener and claims the next available port', async () => {
    const holder = await occupy(0, (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('foreign listener')
    })
    const preferredPort = holder.address().port
    let claim
    try {
      claim = await attemptInstanceClaimWithFallback({ port: preferredPort, maxPort: preferredPort + 10 })
      expect(claim.kind).toBe('owned')
      expect(claim.proxy.port).toBeGreaterThan(preferredPort)
      fixturePorts.add(claim.proxy.port)
      await expect(findExistingInstance({ port: preferredPort })).resolves.toMatchObject({
        port: claim.proxy.port,
        instance: { app: 'hypercanvas' },
      })
    } finally {
      fixturePorts.delete(claim?.proxy?.port)
      await claim?.proxy?.close()
      await closeServer(holder)
    }
  })

  it('reuses Hypercanvas found after a foreign port in the allocation range', async () => {
    let preferredPort
    let existingPort
    let foreign
    let existing
    for (let attempt = 0; attempt < 10; attempt++) {
      existingPort = null
      existing = await occupyDualLoopback(0, (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        if (req.url === INSTANCE_PATH) {
          res.end(JSON.stringify({ app: 'hypercanvas', ready: true, url: `http://hypercanvas.localhost:${existingPort}/` }))
        } else if (req.url === RELAUNCH_PATH) {
          res.end(JSON.stringify({ url: `http://hypercanvas.localhost:${existingPort}/`, token: 'fallback-token' }))
        } else {
          res.end('{}')
        }
      })
      existingPort = existing.address().port
      preferredPort = existingPort - 1
      try {
        foreign = await occupy(preferredPort, (_req, res) => {
          res.writeHead(200, { 'Content-Type': 'text/plain' })
          res.end('foreign listener')
        })
        break
      } catch {
        await closeServer(existing)
        existing = null
      }
    }

    expect(foreign).toBeTruthy()
    try {
      const claim = await attemptInstanceClaimWithFallback({ port: preferredPort, maxPort: existingPort + 1 })
      expect(claim).toMatchObject({
        kind: 'running',
        port: existingPort,
        url: `http://hypercanvas.localhost:${existingPort}/`,
        token: 'fallback-token',
      })
    } finally {
      if (existing) await closeServer(existing)
      if (foreign) await closeServer(foreign)
    }
  })

  it('finds a running instance below a newly configured preferred port', async () => {
    let preferredPort
    let existingPort
    let existing
    for (let attempt = 0; attempt < 10; attempt++) {
      existingPort = null
      existing = await occupyDualLoopback(0, (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        if (req.url === INSTANCE_PATH) {
          res.end(JSON.stringify({ app: 'hypercanvas', ready: true, url: `http://hypercanvas.localhost:${existingPort}/` }))
        } else if (req.url === RELAUNCH_PATH) {
          res.end(JSON.stringify({ url: `http://hypercanvas.localhost:${existingPort}/`, token: 'stale-fallback-token' }))
        } else {
          res.end('{}')
        }
      })
      existingPort = existing.address().port
      preferredPort = existingPort + 1
      if (preferredPort <= 65535) break
      await closeServer(existing)
      existing = null
    }

    expect(existing).toBeTruthy()
    try {
      const claim = await attemptInstanceClaimWithFallback({ port: preferredPort })
      expect(claim).toMatchObject({
        kind: 'running',
        port: existingPort,
        url: `http://hypercanvas.localhost:${existingPort}/`,
        token: 'stale-fallback-token',
      })
    } finally {
      if (existing) await closeServer(existing)
    }
  })

  it('reports exhaustion when every candidate port is foreign', async () => {
    const holder = await occupy(0, (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('foreign listener')
    })
    try {
      const port = holder.address().port
      await expect(attemptInstanceClaimWithFallback({ port, maxPort: port })).resolves.toMatchObject({
        kind: 'exhausted',
        detail: expect.stringContaining(`from ${port} through ${port}`),
      })
    } finally {
      await closeServer(holder)
    }
  })

  it('returns no pid under test so claims stay deterministic', async () => {
    await expect(findListenerPid(2345)).resolves.toBe(null)
  })
})
