import { describe, expect, it, vi } from 'vitest'
import { createWorkspaceServiceRegistry, createWorkspaceServiceRoutes } from './workspace-services.js'

describe('workspace service registry', () => {
  it('isolates service resolution by workspace', () => {
    const registry = createWorkspaceServiceRegistry()
    registry.register({ workspaceId: 'notebook-a', serviceName: 'prototype', url: 'http://127.0.0.1:4101' })
    registry.register({ workspaceId: 'notebook-b', serviceName: 'prototype', url: 'http://127.0.0.1:4102' })
    expect(registry.resolve('notebook-a', 'prototype').url).toBe('http://127.0.0.1:4101')
    expect(registry.resolve('notebook-b', 'prototype').url).toBe('http://127.0.0.1:4102')
  })

  it('exposes matching register, resolve, list, and unregister API operations', async () => {
    const registry = createWorkspaceServiceRegistry()
    const sendJson = vi.fn()
    const handler = createWorkspaceServiceRoutes({ registry, sendJson })
    const response = {}
    await handler({}, response, { method: 'PUT', path: '/services', body: { workspaceId: 'site-a', serviceName: 'site', url: 'http://127.0.0.1:4200' } })
    expect(sendJson).toHaveBeenLastCalledWith(response, 200, expect.objectContaining({ workspaceId: 'site-a' }))
    await handler({}, response, { method: 'GET', path: '/services/site-a/site', body: {} })
    expect(sendJson).toHaveBeenLastCalledWith(response, 200, expect.objectContaining({ url: 'http://127.0.0.1:4200' }))
    await handler({}, response, { method: 'DELETE', path: '/services/site-a/site', body: {} })
    expect(sendJson).toHaveBeenLastCalledWith(response, 204, null)
  })
})
