import http from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { createHypercanvasService } from './hypercanvas-service.js'
import { createWorkspaceServiceRegistry, createWorkspaceServiceRoutes } from './workspace-services.js'

function request(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }))
    }).on('error', reject)
  })
}

describe('app-owned Hypercanvas service', () => {
  it('starts injected API routes without a Vite server', async () => {
    const service = createHypercanvasService({
      routeHandlers: new Map([['health', async (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ owner: 'app' }))
      }]]),
    })

    await service.listen()
    const port = service.server.address().port
    await expect(request(port, '/_storyboard/health')).resolves.toEqual({
      status: 200,
      body: { owner: 'app' },
    })
    await service.close()
  })

  it('keeps the API lifecycle independent while owning the prototype child', async () => {
    const prototypeSupervisor = { start: vi.fn().mockRejectedValue(new Error('vite failed')), close: vi.fn().mockResolvedValue(undefined) }
    const onPrototypeError = vi.fn()
    const service = createHypercanvasService({ prototypeSupervisor, onPrototypeError })
    await service.listen()
    expect(onPrototypeError).toHaveBeenCalledWith(expect.objectContaining({ message: 'vite failed' }))
    await service.close()
    expect(prototypeSupervisor.close).toHaveBeenCalledOnce()
  })

  it('registers and withdraws its workspace service URL with its lifecycle', async () => {
    const registry = createWorkspaceServiceRegistry()
    const service = createHypercanvasService({ workspaceServiceRegistry: registry, workspaceId: 'workspace-1' })
    await service.listen()
    expect(registry.resolve('workspace-1', 'hypercanvas')?.url).toMatch(/^http:\/\/127\.0\.0\.1:/)
    await service.close()
    expect(registry.resolve('workspace-1', 'hypercanvas')).toBe(null)
  })

  it('keeps concurrent workspace service lookups isolated over HTTP', async () => {
    const registry = createWorkspaceServiceRegistry()
    const service = createHypercanvasService({
      routeHandlers: new Map([['workspace-services', createWorkspaceServiceRoutes({ registry, sendJson: (res, status, body) => {
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(body))
      } })]]),
    })
    registry.register({ workspaceId: 'workspace-a', serviceName: 'prototype', url: 'http://127.0.0.1:4101' })
    registry.register({ workspaceId: 'workspace-b', serviceName: 'prototype', url: 'http://127.0.0.1:4102' })
    await service.listen()
    const port = service.server.address().port
    await expect(request(port, '/_storyboard/workspace-services/services/workspace-a/prototype')).resolves.toMatchObject({ body: { url: 'http://127.0.0.1:4101' } })
    await expect(request(port, '/_storyboard/workspace-services/services/workspace-b/prototype')).resolves.toMatchObject({ body: { url: 'http://127.0.0.1:4102' } })
    await service.close()
  })
})
