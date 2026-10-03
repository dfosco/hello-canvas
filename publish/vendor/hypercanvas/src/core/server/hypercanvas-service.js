/**
 * App-owned Hypercanvas service boundary.
 *
 * The service owns the Hypercanvas HTTP/WS transport and accepts route
 * handlers from the application. Vite may host a compatibility instance, but
 * the service does not depend on Vite and can be started by another app host.
 */

import { createHypercanvasServer } from './hypercanvas-server.js'

export function createHypercanvasService(options = {}) {
  const { prototypeSupervisor = null, workspaceServiceRegistry = null, workspaceId = null, serviceName = 'hypercanvas', ...serverOptions } = options
  const transport = createHypercanvasServer(serverOptions)
  const listen = transport.listen
  const close = transport.close
  transport.listen = async (...args) => {
    await listen(...args)
    await prototypeSupervisor?.start().catch((error) => options.onPrototypeError?.(error))
    const address = transport.server.address()
    if (workspaceServiceRegistry && workspaceId && typeof address === 'object' && address) {
      workspaceServiceRegistry.register({ workspaceId, serviceName, url: `http://127.0.0.1:${address.port}` })
    }
    return transport.server
  }
  transport.close = async () => {
    await prototypeSupervisor?.close()
    if (workspaceServiceRegistry && workspaceId) workspaceServiceRegistry.unregister(workspaceId, serviceName)
    return close()
  }
  return transport
}
