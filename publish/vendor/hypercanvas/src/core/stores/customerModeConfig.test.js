import { describe, it, expect, beforeEach, vi } from 'vitest'

import {
  initCustomerModeConfig,
  getCustomerModeConfig,
  getCustomerModeHomepage,
  isCustomerHidingHomepage,
  isCustomerHidingAllTools,
  isCustomerHidingCommandPalette,
  isCustomerHidingBranchBar,
  isCustomerToolHidden,
  resolveHomepageTarget,
  isCustomerMode,
  _resetCustomerModeConfig,
} from './customerModeConfig.js'

beforeEach(() => {
  _resetCustomerModeConfig()
})

describe('customerModeConfig — canonical shape', () => {
  it('defaults all canonical keys when given an empty object', () => {
    initCustomerModeConfig({})
    const cfg = getCustomerModeConfig()
    expect(cfg.enabled).toBe(false)
    expect(cfg.homepage).toBe(false)
    expect(cfg.tools).toBe('all')
    expect(cfg.commandPalette).toBe(true)
    expect(cfg.branchBar).toBe(true)
  })

  it('accepts and round-trips canonical values', () => {
    initCustomerModeConfig({
      enabled: true,
      homepage: 'landing',
      tools: { hide: ['create'] },
      commandPalette: false,
      branchBar: false,
    })
    const cfg = getCustomerModeConfig()
    expect(cfg.enabled).toBe(true)
    expect(cfg.homepage).toBe('landing')
    expect(cfg.tools).toEqual({ hide: ['create'] })
    expect(cfg.commandPalette).toBe(false)
    expect(cfg.branchBar).toBe(false)
  })

  it('master toggle gates every getter', () => {
    initCustomerModeConfig({
      enabled: false,
      homepage: 'landing',
      tools: 'none',
      commandPalette: false,
      branchBar: false,
    })
    expect(isCustomerMode()).toBe(false)
    expect(isCustomerHidingHomepage()).toBe(false)
    expect(isCustomerHidingAllTools()).toBe(false)
    expect(isCustomerHidingCommandPalette()).toBe(false)
    expect(isCustomerHidingBranchBar()).toBe(false)
    expect(isCustomerToolHidden('anything')).toBe(false)
  })
})

describe('customerModeConfig — homepage', () => {
  it('treats false as the default (no hiding, no redirect)', () => {
    initCustomerModeConfig({ enabled: true, homepage: false })
    expect(isCustomerHidingHomepage()).toBe(false)
    expect(getCustomerModeHomepage()).toBe(false)
  })

  it('treats true as "hide workspace, no redirect"', () => {
    initCustomerModeConfig({ enabled: true, homepage: true })
    expect(isCustomerHidingHomepage()).toBe(true)
    expect(getCustomerModeHomepage()).toBe(true)
  })

  it('treats a string as "redirect" (any non-false value hides workspace)', () => {
    initCustomerModeConfig({ enabled: true, homepage: 'landing' })
    expect(isCustomerHidingHomepage()).toBe(true)
    expect(getCustomerModeHomepage()).toBe('landing')
  })

  it('trims whitespace from string homepage values', () => {
    initCustomerModeConfig({ enabled: true, homepage: '  /MyProto  ' })
    expect(getCustomerModeHomepage()).toBe('/MyProto')
  })

  it('coerces invalid types to false', () => {
    initCustomerModeConfig({ enabled: true, homepage: 42 })
    expect(getCustomerModeHomepage()).toBe(false)
  })
})

describe('customerModeConfig — tools', () => {
  it('"all" hides nothing', () => {
    initCustomerModeConfig({ enabled: true, tools: 'all' })
    expect(isCustomerHidingAllTools()).toBe(false)
    expect(isCustomerToolHidden('flows')).toBe(false)
    expect(isCustomerToolHidden('command-palette')).toBe(false)
  })

  it('"none" hides everything', () => {
    initCustomerModeConfig({ enabled: true, tools: 'none' })
    expect(isCustomerHidingAllTools()).toBe(true)
    expect(isCustomerToolHidden('flows')).toBe(true)
    expect(isCustomerToolHidden('anything-else')).toBe(true)
  })

  it('{ hide: [...] } hides only listed', () => {
    initCustomerModeConfig({ enabled: true, tools: { hide: ['create', 'flows'] } })
    expect(isCustomerHidingAllTools()).toBe(false)
    expect(isCustomerToolHidden('create')).toBe(true)
    expect(isCustomerToolHidden('flows')).toBe(true)
    expect(isCustomerToolHidden('themes')).toBe(false)
  })

  it('{ only: [...] } shows only listed', () => {
    initCustomerModeConfig({ enabled: true, tools: { only: ['flows'] } })
    expect(isCustomerHidingAllTools()).toBe(false)
    expect(isCustomerToolHidden('flows')).toBe(false)
    expect(isCustomerToolHidden('create')).toBe(true)
    expect(isCustomerToolHidden('themes')).toBe(true)
  })

  it('only with non-array values falls back to "all"', () => {
    initCustomerModeConfig({ enabled: true, tools: { hide: 'not-an-array' } })
    expect(isCustomerToolHidden('create')).toBe(false)
  })

  it('empty hide / only arrays fall back to "all"', () => {
    initCustomerModeConfig({ enabled: true, tools: { hide: [] } })
    expect(getCustomerModeConfig().tools).toBe('all')
    initCustomerModeConfig({ enabled: true, tools: { only: [] } })
    expect(getCustomerModeConfig().tools).toBe('all')
  })

  it('filters non-string entries from hide / only', () => {
    initCustomerModeConfig({
      enabled: true,
      tools: { hide: ['create', 42, null, 'flows'] },
    })
    expect(getCustomerModeConfig().tools).toEqual({ hide: ['create', 'flows'] })
  })

  it('prefers only over hide when both are provided', () => {
    initCustomerModeConfig({
      enabled: true,
      tools: { hide: ['create'], only: ['flows'] },
    })
    expect(getCustomerModeConfig().tools).toEqual({ only: ['flows'] })
  })
})

describe('customerModeConfig — command palette & branch bar', () => {
  it('commandPalette: false hides palette + the command-palette tool key', () => {
    initCustomerModeConfig({ enabled: true, commandPalette: false })
    expect(isCustomerHidingCommandPalette()).toBe(true)
    expect(isCustomerToolHidden('command-palette')).toBe(true)
    expect(isCustomerToolHidden('flows')).toBe(false)
  })

  it('branchBar: false flips the getter (used to seed ui.hide("branch-bar"))', () => {
    initCustomerModeConfig({ enabled: true, branchBar: false })
    expect(isCustomerHidingBranchBar()).toBe(true)
  })
})

describe('customerModeConfig — legacy back-compat', () => {
  it('maps hideHomepage: true → homepage: true', () => {
    initCustomerModeConfig({ enabled: true, hideHomepage: true })
    expect(getCustomerModeHomepage()).toBe(true)
    expect(isCustomerHidingHomepage()).toBe(true)
    expect(getCustomerModeConfig().hideHomepage).toBe(true)
  })

  it('maps protoHomepage: "/X" → homepage: "/X"', () => {
    initCustomerModeConfig({ enabled: true, protoHomepage: '/MyProto' })
    expect(getCustomerModeHomepage()).toBe('/MyProto')
    expect(getCustomerModeConfig().protoHomepage).toBe('/MyProto')
    expect(getCustomerModeConfig().canvasHomepage).toBe('')
  })

  it('maps canvasHomepage: "X" → homepage: "X"', () => {
    initCustomerModeConfig({ enabled: true, canvasHomepage: 'landing' })
    expect(getCustomerModeHomepage()).toBe('landing')
    expect(getCustomerModeConfig().canvasHomepage).toBe('landing')
    expect(getCustomerModeConfig().protoHomepage).toBe('')
  })

  it('canvasHomepage wins over protoHomepage (and warns)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    initCustomerModeConfig({
      enabled: true,
      canvasHomepage: 'landing',
      protoHomepage: '/MyProto',
    })
    expect(getCustomerModeHomepage()).toBe('landing')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('explicit homepage wins over all legacy keys (and warns)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    initCustomerModeConfig({
      enabled: true,
      homepage: 'real',
      canvasHomepage: 'ignored',
      protoHomepage: '/ignored',
      hideHomepage: true,
    })
    expect(getCustomerModeHomepage()).toBe('real')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('maps hideChrome: true → tools: "none", commandPalette: false, branchBar: false', () => {
    initCustomerModeConfig({ enabled: true, hideChrome: true })
    expect(isCustomerHidingAllTools()).toBe(true)
    expect(isCustomerHidingCommandPalette()).toBe(true)
    expect(isCustomerHidingBranchBar()).toBe(true)
    expect(getCustomerModeConfig().hideChrome).toBe(true)
  })

  it('explicit tools / commandPalette / branchBar override hideChrome', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    initCustomerModeConfig({
      enabled: true,
      hideChrome: true,
      tools: 'all',
      commandPalette: true,
      branchBar: true,
    })
    expect(isCustomerHidingAllTools()).toBe(false)
    expect(isCustomerHidingCommandPalette()).toBe(false)
    expect(isCustomerHidingBranchBar()).toBe(false)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('preserves legacy fields on the returned config (effective state)', () => {
    initCustomerModeConfig({ enabled: true, hideChrome: true })
    const cfg = getCustomerModeConfig()
    expect(cfg).toMatchObject({
      enabled: true,
      tools: 'none',
      commandPalette: false,
      branchBar: false,
      hideChrome: true,
      hideHomepage: false,
      protoHomepage: '',
      canvasHomepage: '',
    })
  })
})

describe('resolveHomepageTarget', () => {
  it('returns empty string for non-string / empty input', () => {
    expect(resolveHomepageTarget('')).toBe('')
    expect(resolveHomepageTarget(undefined)).toBe('')
    expect(resolveHomepageTarget(null)).toBe('')
    expect(resolveHomepageTarget(true)).toBe('')
    expect(resolveHomepageTarget(false)).toBe('')
  })

  it('prefixes a bare canvas id with /canvas/', () => {
    expect(resolveHomepageTarget('landing')).toBe('/canvas/landing')
    expect(resolveHomepageTarget('research/intake')).toBe('/canvas/research/intake')
  })

  it('passes through values that start with /', () => {
    expect(resolveHomepageTarget('/canvas/landing')).toBe('/canvas/landing')
    expect(resolveHomepageTarget('/MyProto')).toBe('/MyProto')
    expect(resolveHomepageTarget('/landing')).toBe('/landing')
  })

  it('passes through http(s) URLs unchanged', () => {
    expect(resolveHomepageTarget('https://example.com')).toBe('https://example.com')
    expect(resolveHomepageTarget('http://localhost:3000/x')).toBe('http://localhost:3000/x')
    expect(resolveHomepageTarget('HTTPS://Caps.Test')).toBe('HTTPS://Caps.Test')
  })
})
