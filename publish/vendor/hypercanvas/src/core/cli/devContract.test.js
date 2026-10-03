import { describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createDesktopEvent,
  desktopUrl,
  encodeDesktopEvent,
  encodeViteDesktopEvent,
  parseViteDesktopEvent,
  isAllowedRequestOrigin,
  ignoreBrokenPipeErrors,
  readConfiguredInstanceProxyPort,
  readConfiguredUsePaseoApp,
  resolveInstanceProxyPort,
  selectEphemeralPort,
} from './devContract.js'

describe('desktop dev contract', () => {
  it('creates stable versioned lifecycle events', () => {
    expect(createDesktopEvent('ready', { url: 'http://127.0.0.1:4312/' })).toEqual({
      schemaVersion: 1,
      source: 'storyboard-dev',
      event: 'ready',
      url: 'http://127.0.0.1:4312/',
    })
    expect(JSON.parse(encodeDesktopEvent('starting', { port: 4312 }))).toMatchObject({
      schemaVersion: 1,
      event: 'starting',
      port: 4312,
    })
  })

  it('extracts only valid prefixed Vite events', () => {
    const line = `vite chatter ${encodeViteDesktopEvent('ready', { pid: 42 })}`
    expect(parseViteDesktopEvent(line)).toMatchObject({ event: 'ready', pid: 42 })
    expect(parseViteDesktopEvent('vite ready in 12ms')).toBeNull()
    expect(parseViteDesktopEvent('__HYPERCANVAS_DESKTOP_EVENT__not-json')).toBeNull()
  })

  it('ignores broken output pipes but preserves other stream errors', () => {
    const stream = new EventEmitter()
    ignoreBrokenPipeErrors(stream)

    expect(() => stream.emit('error', Object.assign(new Error('closed'), { code: 'EPIPE' }))).not.toThrow()
    expect(() => stream.emit('error', new Error('write failed'))).toThrow('write failed')
  })

  it('builds the loopback URL with a rooted base path', () => {
    expect(desktopUrl('127.0.0.1', 4312, '/')).toBe('http://127.0.0.1:4312/')
    expect(desktopUrl('127.0.0.1', 4312, 'storyboard/')).toBe('http://127.0.0.1:4312/storyboard/')
  })

  it('selects an ephemeral loopback port', async () => {
    const port = await selectEphemeralPort()
    expect(port).toBeGreaterThan(0)
    expect(port).toBeLessThanOrEqual(65535)
  })

  it('resolves the preferred instance-proxy port with config and env overrides', () => {
    expect(resolveInstanceProxyPort({})).toBe(1234)
    expect(resolveInstanceProxyPort({ HYPERCANVAS_PROXY_PORT: '' })).toBe(1234)
    expect(resolveInstanceProxyPort({}, 4321)).toBe(4321)
    expect(resolveInstanceProxyPort({ HYPERCANVAS_PROXY_PORT: '0' })).toBe(0)
    expect(resolveInstanceProxyPort({ HYPERCANVAS_PROXY_PORT: '4317' })).toBe(4317)
    expect(resolveInstanceProxyPort({ HYPERCANVAS_PROXY_PORT: '4317' }, 4321)).toBe(4317)
    expect(resolveInstanceProxyPort({ HYPERCANVAS_INSTANCE_PROXY: '0' })).toBe(null)
    expect(() => resolveInstanceProxyPort({ HYPERCANVAS_PROXY_PORT: 'nope' })).toThrow('Invalid HYPERCANVAS_PROXY_PORT')
    expect(() => resolveInstanceProxyPort({ HYPERCANVAS_PROXY_PORT: '70000' })).toThrow('Invalid HYPERCANVAS_PROXY_PORT')
  })

  it('reads proxy port from the active Notebook before the launch config', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'hc-proxy-config-'))
    const notebookRoot = join(cwd, 'notebook')
    const appConfig = join(cwd, 'storyboard.config.json')
    const notebookConfig = join(notebookRoot, 'storyboard.config.json')
    try {
      mkdirSync(notebookRoot)
      writeFileSync(appConfig, JSON.stringify({ hypercanvas: { proxyPort: 4321 }, port: 7000 }))
      writeFileSync(notebookConfig, JSON.stringify({ hypercanvas: { proxyPort: 5432 } }))
      expect(readConfiguredInstanceProxyPort({ cwd, notebookRoot })).toBe(5432)
      rmSync(notebookConfig)
      expect(readConfiguredInstanceProxyPort({ cwd, notebookRoot })).toBe(4321)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('rejects invalid proxy port config values', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'hc-proxy-config-'))
    try {
      writeFileSync(join(cwd, 'storyboard.config.json'), JSON.stringify({ hypercanvas: { proxyPort: 0 } }))
      expect(() => readConfiguredInstanceProxyPort({ cwd, notebookRoot: null })).toThrow('Invalid hypercanvas.proxyPort')
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('defaults to the App daemon and reads the startup Notebook before the launch config', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'hc-paseo-config-'))
    const notebookRoot = join(cwd, 'notebook')
    const appConfig = join(cwd, 'storyboard.config.json')
    const notebookConfig = join(notebookRoot, 'storyboard.config.json')
    try {
      mkdirSync(notebookRoot)
      expect(readConfiguredUsePaseoApp({ cwd, notebookRoot })).toBe(true)
      writeFileSync(appConfig, JSON.stringify({ featureFlags: { usePaseoApp: false } }))
      expect(readConfiguredUsePaseoApp({ cwd, notebookRoot })).toBe(false)
      writeFileSync(notebookConfig, JSON.stringify({ featureFlags: { usePaseoApp: true } }))
      expect(readConfiguredUsePaseoApp({ cwd, notebookRoot })).toBe(true)
      writeFileSync(notebookConfig, JSON.stringify({ featureFlags: null }))
      expect(readConfiguredUsePaseoApp({ cwd, notebookRoot })).toBe(false)
      writeFileSync(appConfig, 'null')
      expect(readConfiguredUsePaseoApp({ cwd, notebookRoot })).toBe(true)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it.each([null, 'false', 0])('rejects non-boolean startup daemon policy %s', value => {
    const cwd = mkdtempSync(join(tmpdir(), 'hc-paseo-config-'))
    try {
      writeFileSync(join(cwd, 'storyboard.config.json'), JSON.stringify({ featureFlags: { usePaseoApp: value } }))
      expect(() => readConfiguredUsePaseoApp({ cwd, notebookRoot: null })).toThrow('Invalid featureFlags.usePaseoApp')
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('allows only exact loopback origins for desktop requests', () => {
    expect(isAllowedRequestOrigin(
      { host: '127.0.0.1:4312', origin: 'http://127.0.0.1:4312' },
      { desktop: true },
    )).toBe(true)
    expect(isAllowedRequestOrigin(
      { host: 'hypercanvas.localhost:2345', origin: 'http://hypercanvas.localhost:2345' },
      { desktop: true },
    )).toBe(true)
    expect(isAllowedRequestOrigin(
      { host: 'hypercanvas.local:2345', origin: 'http://hypercanvas.local:2345' },
      { desktop: true },
    )).toBe(false)
    expect(isAllowedRequestOrigin(
      { host: '127.0.0.1:4312', origin: 'https://malicious.example' },
      { desktop: true },
    )).toBe(false)
    expect(isAllowedRequestOrigin(
      { host: 'rebound.example:4312', origin: 'http://rebound.example:4312' },
      { desktop: true },
    )).toBe(false)
  })

  it('allows a same-host HTTPS origin forwarded by a remote-access tunnel when configured', () => {    expect(isAllowedRequestOrigin(
      { host: 'share.example.trycloudflare.com', origin: 'https://share.example.trycloudflare.com' },
      { desktop: true, allowForwardedHttpsOrigin: true },
    )).toBe(true)
    expect(isAllowedRequestOrigin(
      { host: 'share.example.trycloudflare.com', origin: 'https://attacker.example' },
      { desktop: true, allowForwardedHttpsOrigin: true },
    )).toBe(false)
    expect(isAllowedRequestOrigin(
      { host: 'share.example.trycloudflare.com', origin: 'http://share.example.trycloudflare.com' },
      { desktop: true, allowForwardedHttpsOrigin: true },
    )).toBe(false)
  })
})
