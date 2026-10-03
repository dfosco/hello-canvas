import { describe, expect, it } from 'vitest'
import { createPaseoServerEnvironment, withoutRuntimeCredentials } from './runtimeEnvironment.js'

describe('runtime environment credential boundaries', () => {
  it('passes the latched startup policy and fallback reason to the Core worker', () => {
    const source = { HYPERCANVAS_PASEO_REUSE_FAILURE: 'old failure' }
    expect(createPaseoServerEnvironment(source, {}, { owned: false, usePaseoApp: true })).toMatchObject({
      HYPERCANVAS_PASEO_DAEMON_OWNED: '0',
      HYPERCANVAS_PASEO_USE_APP: '1',
    })
    expect(createPaseoServerEnvironment(source, {}, { owned: false })).not.toHaveProperty('HYPERCANVAS_PASEO_REUSE_FAILURE')
    expect(createPaseoServerEnvironment({}, {}, { owned: true, usePaseoApp: false, reuseProbeFailure: 'unavailable' })).toMatchObject({
      HYPERCANVAS_PASEO_DAEMON_OWNED: '1',
      HYPERCANVAS_PASEO_USE_APP: '0',
      HYPERCANVAS_PASEO_REUSE_FAILURE: 'unavailable',
    })
    expect(source.HYPERCANVAS_PASEO_REUSE_FAILURE).toBe('old failure')
  })
  it('copies resolved daemon settings only into the Core server environment', () => {
    const source = {
      PATH: '/usr/bin',
      PASEO_DAEMON_URL: 'ws://old-daemon/ws',
      PASEO_DAEMON_PASSWORD: 'old-password',
      PASEO_DAEMON_AUTH_HEADER: 'old-header',
      PASEO_PASSWORD: 'daemon-child-password',
      HYPERCANVAS_LAUNCH_TOKEN: 'browser-bootstrap-token',
    }

    const result = createPaseoServerEnvironment(source, {
      url: 'ws://127.0.0.1:45678/ws',
      password: 'resolved-password',
    })

    expect(result).toMatchObject({
      PATH: '/usr/bin',
      PASEO_DAEMON_URL: 'ws://127.0.0.1:45678/ws',
      PASEO_DAEMON_PASSWORD: 'resolved-password',
      HYPERCANVAS_LAUNCH_TOKEN: 'browser-bootstrap-token',
    })
    expect(result).not.toHaveProperty('PASEO_DAEMON_AUTH_HEADER')
    expect(result).not.toHaveProperty('PASEO_PASSWORD')
    expect(source.PASEO_DAEMON_URL).toBe('ws://old-daemon/ws')
    expect(source.PASEO_DAEMON_PASSWORD).toBe('old-password')
  })

  it('removes daemon, launch, and proxy registration credentials from unrelated child environments', () => {
    const childEnvironment = withoutRuntimeCredentials({
      PATH: '/usr/bin',
      PROVIDER_API_KEY: 'preserved-provider-key',
      PASEO_DAEMON_URL: 'ws://127.0.0.1:45678/ws',
      PASEO_DAEMON_PASSWORD: 'daemon-password',
      PASEO_DAEMON_AUTH_HEADER: 'auth-header',
      PASEO_PASSWORD: 'server-password',
      HYPERCANVAS_LAUNCH_TOKEN: 'browser-token',
      HYPERCANVAS_PROXY_REGISTRATION_TOKEN: 'proxy-registration-secret',
    })

    expect(childEnvironment).toEqual({ PATH: '/usr/bin', PROVIDER_API_KEY: 'preserved-provider-key' })
  })
})
