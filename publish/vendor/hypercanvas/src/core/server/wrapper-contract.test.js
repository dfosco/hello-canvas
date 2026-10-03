import { describe, expect, it } from 'vitest'
import { createWrapperEvent, encodeWrapperEvent } from './wrapper-contract.js'

describe('Core wrapper lifecycle contract', () => {
  it('sends versioned readiness without exposing daemon credentials', () => {
    expect(JSON.parse(encodeWrapperEvent('ready', { url: 'http://127.0.0.1:4317/', pid: 123 }))).toEqual({
      schemaVersion: 1,
      source: 'hypercanvas-core',
      event: 'ready',
      url: 'http://127.0.0.1:4317/',
      pid: 123,
    })
  })

  it('rejects unknown lifecycle events before serializing them', () => {
    expect(() => createWrapperEvent('paseo-ready')).toThrow('Unsupported wrapper lifecycle event')
  })

  it('encodes the running-instance handoff for duplicate launches', () => {
    expect(JSON.parse(encodeWrapperEvent('running', {
      url: 'http://hypercanvas.localhost:2345/',
      token: 'relaunch-token',
      instance: { notebook: { title: 'Demo' } },
    }))).toEqual({
      schemaVersion: 1,
      source: 'hypercanvas-core',
      event: 'running',
      url: 'http://hypercanvas.localhost:2345/',
      token: 'relaunch-token',
      instance: { notebook: { title: 'Demo' } },
    })
  })
})
