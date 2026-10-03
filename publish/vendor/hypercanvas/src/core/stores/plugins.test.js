import { describe, it, expect, beforeEach } from 'vitest'
import { initPlugins, isPluginEnabled, getPluginsConfig } from './plugins.js'

describe('plugins config', () => {
  beforeEach(() => {
    // Reset to empty config between tests
    initPlugins({})
  })

  describe('isPluginEnabled', () => {
    it('returns true by default for unconfigured plugins', () => {
      expect(isPluginEnabled('devtools')).toBe(true)
      expect(isPluginEnabled('comments')).toBe(true)
      expect(isPluginEnabled('anything')).toBe(true)
    })

    it('returns false when a plugin is explicitly disabled', () => {
      initPlugins({ devtools: false })
      expect(isPluginEnabled('devtools')).toBe(false)
    })

    it('returns true when a plugin is explicitly enabled', () => {
      initPlugins({ devtools: true })
      expect(isPluginEnabled('devtools')).toBe(true)
    })

    it('handles multiple plugins independently', () => {
      initPlugins({ devtools: false, comments: true })
      expect(isPluginEnabled('devtools')).toBe(false)
      expect(isPluginEnabled('comments')).toBe(true)
      expect(isPluginEnabled('other')).toBe(true)
    })
  })

  describe('getPluginsConfig', () => {
    it('returns an empty object by default', () => {
      expect(getPluginsConfig()).toEqual({})
    })

    it('returns a copy of the config', () => {
      initPlugins({ devtools: false })
      const config = getPluginsConfig()
      expect(config).toEqual({ devtools: false })

      // Mutating the returned object should not affect internal state
      config.devtools = true
      expect(isPluginEnabled('devtools')).toBe(false)
    })
  })

  describe('initPlugins', () => {
    it('replaces previous config on re-init', () => {
      initPlugins({ devtools: false })
      expect(isPluginEnabled('devtools')).toBe(false)

      initPlugins({ devtools: true })
      expect(isPluginEnabled('devtools')).toBe(true)
    })

    it('does not mutate the passed config object', () => {
      const config = { devtools: false }
      initPlugins(config)
      // Internal state is a copy
      expect(getPluginsConfig()).toEqual({ devtools: false })
      expect(getPluginsConfig()).not.toBe(config)
    })
  })
})
