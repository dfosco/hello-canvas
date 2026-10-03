import {
  registerMode,
  unregisterMode,
  getRegisteredModes,
  getCurrentMode,
  activateMode,
  deactivateMode,
  subscribeToMode,
  getModeSnapshot,
  on,
  off,
  emit,
  initTools,
  setToolAction,
  setToolState,
  getToolState,
  getToolsForMode,
  subscribeToTools,
  getToolsSnapshot,
  initModesConfig,
  isModesEnabled,
  getLockedMode,
  isModeSwitcherVisible,
  _resetModes,
} from './modes.js'

afterEach(() => {
  _resetModes()
  const url = new URL(window.location.href)
  url.searchParams.delete('mode')
  window.history.replaceState(null, '', url.toString())
})

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe('registry', () => {
  it('registerMode adds a mode to the registry', () => {
    registerMode('prototype', { label: 'Prototype' })
    expect(getRegisteredModes()).toEqual([{ name: 'prototype', label: 'Prototype' }])
  })

  it('warns when overwriting an existing mode', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    registerMode('prototype', { label: 'V1' })
    registerMode('prototype', { label: 'V2' })
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('overwriting'))
    spy.mockRestore()
  })

  it('getRegisteredModes returns modes in insertion order', () => {
    registerMode('a', { label: 'A' })
    registerMode('b', { label: 'B' })
    registerMode('c', { label: 'C' })
    const names = getRegisteredModes().map((m) => m.name)
    expect(names).toEqual(['a', 'b', 'c'])
  })

  it('unregisterMode removes a mode', () => {
    registerMode('present', { label: 'Present' })
    unregisterMode('present')
    expect(getRegisteredModes()).toEqual([])
  })

  it('cannot unregister the default mode', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    registerMode('prototype', { label: 'Prototype' })
    unregisterMode('prototype')
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Cannot unregister'))
    expect(getRegisteredModes()).toHaveLength(1)
    spy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// getCurrentMode
// ---------------------------------------------------------------------------

describe('getCurrentMode', () => {
  it('returns "prototype" by default', () => {
    expect(getCurrentMode()).toBe('prototype')
  })

  it('reads the ?mode= search param when mode is registered', () => {
    registerMode('present', { label: 'Present' })
    const url = new URL(window.location.href)
    url.searchParams.set('mode', 'present')
    window.history.replaceState(null, '', url.toString())

    expect(getCurrentMode()).toBe('present')
  })

  it('ignores unregistered modes in the URL param', () => {
    const url = new URL(window.location.href)
    url.searchParams.set('mode', 'nonexistent')
    window.history.replaceState(null, '', url.toString())

    expect(getCurrentMode()).toBe('prototype')
  })
})

// ---------------------------------------------------------------------------
// activateMode
// ---------------------------------------------------------------------------

describe('activateMode', () => {
  it('updates the ?mode= URL param', () => {
    registerMode('prototype', { label: 'Prototype' })
    registerMode('present', { label: 'Present' })
    activateMode('present')

    const url = new URL(window.location.href)
    expect(url.searchParams.get('mode')).toBe('present')
  })

  it('calls onDeactivate on the previous mode and onActivate on the new', () => {
    const deactivate = vi.fn()
    const activate = vi.fn()
    registerMode('prototype', { label: 'Prototype', onDeactivate: deactivate })
    registerMode('present', { label: 'Present', onActivate: activate })

    activateMode('present')
    expect(deactivate).toHaveBeenCalledTimes(1)
    expect(activate).toHaveBeenCalledTimes(1)
  })

  it('is a no-op when activating the already-active mode', () => {
    const activate = vi.fn()
    registerMode('prototype', { label: 'Prototype', onActivate: activate })
    // prototype is already active by default
    activateMode('prototype')
    expect(activate).not.toHaveBeenCalled()
  })

  it('warns when activating an unregistered mode', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    activateMode('unknown')
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('not registered'))
    spy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// deactivateMode
// ---------------------------------------------------------------------------

describe('deactivateMode', () => {
  it('returns to prototype mode', () => {
    registerMode('prototype', { label: 'Prototype' })
    registerMode('present', { label: 'Present' })
    activateMode('present')
    deactivateMode()
    expect(getCurrentMode()).toBe('prototype')
  })

  it('removes the ?mode= URL param', () => {
    registerMode('prototype', { label: 'Prototype' })
    registerMode('present', { label: 'Present' })
    activateMode('present')
    deactivateMode()

    const url = new URL(window.location.href)
    expect(url.searchParams.has('mode')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

describe('subscribeToMode', () => {
  it('callback fires on activateMode', () => {
    const cb = vi.fn()
    registerMode('prototype', { label: 'Prototype' })
    registerMode('present', { label: 'Present' })
    const unsub = subscribeToMode(cb)

    activateMode('present')
    expect(cb).toHaveBeenCalled()
    unsub()
  })

  it('callback fires on registerMode', () => {
    const cb = vi.fn()
    const unsub = subscribeToMode(cb)

    registerMode('new-mode', { label: 'New' })
    expect(cb).toHaveBeenCalled()
    unsub()
  })

  it('unsubscribe stops further calls', () => {
    const cb = vi.fn()
    registerMode('prototype', { label: 'Prototype' })
    registerMode('present', { label: 'Present' })
    const unsub = subscribeToMode(cb)
    unsub()

    activateMode('present')
    expect(cb).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// getModeSnapshot
// ---------------------------------------------------------------------------

describe('getModeSnapshot', () => {
  it('changes when mode changes', () => {
    registerMode('prototype', { label: 'Prototype' })
    registerMode('present', { label: 'Present' })
    const snap1 = getModeSnapshot()

    activateMode('present')
    const snap2 = getModeSnapshot()
    expect(snap1).not.toBe(snap2)
  })

  it('changes when registry changes', () => {
    registerMode('prototype', { label: 'Prototype' })
    const snap1 = getModeSnapshot()

    registerMode('present', { label: 'Present' })
    const snap2 = getModeSnapshot()
    expect(snap1).not.toBe(snap2)
  })
})

// ---------------------------------------------------------------------------
// Event bus
// ---------------------------------------------------------------------------

describe('event bus', () => {
  it('on/emit fires the callback with arguments', () => {
    const cb = vi.fn()
    on('test:event', cb)
    emit('test:event', 'a', 'b')
    expect(cb).toHaveBeenCalledWith('a', 'b')
  })

  it('off removes the listener', () => {
    const cb = vi.fn()
    on('test:event', cb)
    off('test:event', cb)
    emit('test:event')
    expect(cb).not.toHaveBeenCalled()
  })

  it('emit with no listeners does not throw', () => {
    expect(() => emit('nonexistent')).not.toThrow()
  })

  it('catches errors thrown by listeners', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    on('bad', () => { throw new Error('boom') })
    expect(() => emit('bad')).not.toThrow()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// Modes config
// ---------------------------------------------------------------------------

describe('modes config', () => {
  it('isModesEnabled returns false by default', () => {
    expect(isModesEnabled()).toBe(false)
  })

  it('initModesConfig({ enabled: true }) enables modes', () => {
    initModesConfig({ enabled: true })
    expect(isModesEnabled()).toBe(true)
  })

  it('initModesConfig({ enabled: false }) disables modes', () => {
    initModesConfig({ enabled: true })
    initModesConfig({ enabled: false })
    expect(isModesEnabled()).toBe(false)
  })

  it('initModesConfig() with no args enables modes (enabled !== false)', () => {
    initModesConfig()
    expect(isModesEnabled()).toBe(true)
  })

  it('_resetModes resets modesEnabled to false', () => {
    initModesConfig({ enabled: true })
    _resetModes()
    expect(isModesEnabled()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Locked mode
// ---------------------------------------------------------------------------

describe('locked mode', () => {
  it('getLockedMode returns null by default', () => {
    expect(getLockedMode()).toBeNull()
  })

  it('initModesConfig({ locked: "present" }) sets locked mode', () => {
    initModesConfig({ enabled: true, locked: 'present' })
    expect(getLockedMode()).toBe('present')
  })

  it('getCurrentMode returns locked mode when set and registered', () => {
    registerMode('present', { label: 'Present' })
    initModesConfig({ enabled: true, locked: 'present' })
    expect(getCurrentMode()).toBe('present')
  })

  it('getCurrentMode falls back to default when locked mode is not registered', () => {
    initModesConfig({ enabled: true, locked: 'nonexistent' })
    expect(getCurrentMode()).toBe('prototype')
  })

  it('activateMode is a no-op when locked', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    registerMode('prototype', { label: 'Prototype' })
    registerMode('present', { label: 'Present' })
    initModesConfig({ enabled: true, locked: 'prototype' })

    activateMode('present')
    expect(getCurrentMode()).toBe('prototype')
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('locked'))
    spy.mockRestore()
  })

  it('isModeSwitcherVisible returns true when modes enabled and not locked', () => {
    initModesConfig({ enabled: true })
    expect(isModeSwitcherVisible()).toBe(true)
  })

  it('isModeSwitcherVisible returns false when locked', () => {
    initModesConfig({ enabled: true, locked: 'prototype' })
    expect(isModeSwitcherVisible()).toBe(false)
  })

  it('isModeSwitcherVisible returns false when modes disabled', () => {
    initModesConfig({ enabled: false })
    expect(isModeSwitcherVisible()).toBe(false)
  })

  it('_resetModes clears locked mode', () => {
    initModesConfig({ enabled: true, locked: 'present' })
    _resetModes()
    expect(getLockedMode()).toBeNull()
    expect(isModeSwitcherVisible()).toBe(false) // modesEnabled also reset
  })
})

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

describe('tool registry', () => {
  const SAMPLE_TOOLS = {
    '*': [
      { id: 'workspace', label: 'Workspace', group: 'dev' },
      { id: 'reset-params', label: 'Reset all params', group: 'dev' },
    ],
    'present': [
      { id: 'comments-toggle', label: 'Comments', group: 'tools' },
    ],
  }

  describe('initTools', () => {
    it('seeds the registry from config', () => {
      initTools(SAMPLE_TOOLS)
      const tools = getToolsForMode('present')
      const ids = tools.map(t => t.id)
      expect(ids).toContain('workspace')
      expect(ids).toContain('comments-toggle')
    })

    it('wildcard tools appear in all modes', () => {
      initTools(SAMPLE_TOOLS)
      const protoTools = getToolsForMode('prototype')
      expect(protoTools.map(t => t.id)).toContain('workspace')
    })

    it('mode-specific tools only appear in their mode', () => {
      initTools(SAMPLE_TOOLS)
      const protoTools = getToolsForMode('prototype')
      expect(protoTools.map(t => t.id)).not.toContain('comments-toggle')
    })

    it('tools start with default state', () => {
      initTools(SAMPLE_TOOLS)
      const state = getToolState('workspace')
      expect(state).toEqual({
        enabled: true,
        active: false,
        busy: false,
        hidden: false,
        badge: null,
      })
    })

    it('merges mode assignments when tool appears in multiple keys', () => {
      initTools({
        '*': [{ id: 'shared', label: 'Shared', group: 'dev' }],
        'inspect': [{ id: 'shared', label: 'Shared', group: 'dev' }],
      })
      const tool = getToolsForMode('inspect').find(t => t.id === 'shared')
      expect(tool.modes).toContain('*')
      expect(tool.modes).toContain('inspect')
    })
  })

  describe('setToolAction', () => {
    it('wires up an action callback', () => {
      initTools({ '*': [{ id: 'test-tool', label: 'Test', group: 'tools' }] })
      const action = vi.fn()
      setToolAction('test-tool', action)

      const tool = getToolsForMode('prototype').find(t => t.id === 'test-tool')
      expect(tool.action).toBe(action)
    })

    it('warns when tool is not declared', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      setToolAction('nonexistent', () => {})
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('not declared'))
      spy.mockRestore()
    })

    it('notifies subscribers', () => {
      initTools({ '*': [{ id: 'tool-a', label: 'A', group: 'tools' }] })
      const cb = vi.fn()
      const unsub = subscribeToTools(cb)
      setToolAction('tool-a', () => {})
      expect(cb).toHaveBeenCalled()
      unsub()
    })
  })

  describe('setToolState', () => {
    it('merges partial state updates', () => {
      initTools({ '*': [{ id: 'tool-b', label: 'B', group: 'tools' }] })
      setToolState('tool-b', { active: true })
      expect(getToolState('tool-b').active).toBe(true)
      expect(getToolState('tool-b').enabled).toBe(true) // unchanged
    })

    it('sets busy state', () => {
      initTools({ '*': [{ id: 'tool-c', label: 'C', group: 'tools' }] })
      setToolState('tool-c', { busy: true })
      expect(getToolState('tool-c').busy).toBe(true)
    })

    it('sets badge', () => {
      initTools({ '*': [{ id: 'tool-d', label: 'D', group: 'tools' }] })
      setToolState('tool-d', { badge: 3 })
      expect(getToolState('tool-d').badge).toBe(3)
    })

    it('warns when tool is not declared', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      setToolState('nonexistent', { enabled: false })
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('not declared'))
      spy.mockRestore()
    })

    it('notifies subscribers', () => {
      initTools({ '*': [{ id: 'tool-e', label: 'E', group: 'tools' }] })
      const cb = vi.fn()
      const unsub = subscribeToTools(cb)
      setToolState('tool-e', { active: true })
      expect(cb).toHaveBeenCalled()
      unsub()
    })
  })

  describe('getToolsForMode', () => {
    it('sorts tools group first, dev second', () => {
      initTools({
        '*': [
          { id: 'dev-tool', label: 'Dev', group: 'dev' },
          { id: 'main-tool', label: 'Main', group: 'tools' },
        ],
      })
      const tools = getToolsForMode('prototype')
      expect(tools[0].id).toBe('main-tool')
      expect(tools[1].id).toBe('dev-tool')
    })

    it('sorts by order within a group', () => {
      initTools({
        '*': [
          { id: 'b', label: 'B', group: 'tools', order: 20 },
          { id: 'a', label: 'A', group: 'tools', order: 10 },
        ],
      })
      const tools = getToolsForMode('prototype')
      expect(tools[0].id).toBe('a')
      expect(tools[1].id).toBe('b')
    })

    it('excludes hidden tools', () => {
      initTools({ '*': [{ id: 'hidden-tool', label: 'Hidden', group: 'tools' }] })
      setToolState('hidden-tool', { hidden: true })
      const tools = getToolsForMode('prototype')
      expect(tools.map(t => t.id)).not.toContain('hidden-tool')
    })

    it('includes state and action in returned tools', () => {
      initTools({ '*': [{ id: 'full-tool', label: 'Full', group: 'tools' }] })
      const action = vi.fn()
      setToolAction('full-tool', action)
      setToolState('full-tool', { active: true, badge: 5 })

      const tool = getToolsForMode('prototype').find(t => t.id === 'full-tool')
      expect(tool.state.active).toBe(true)
      expect(tool.state.badge).toBe(5)
      expect(tool.action).toBe(action)
    })

    it('returns null action when not wired up', () => {
      initTools({ '*': [{ id: 'no-action', label: 'No Action', group: 'tools' }] })
      const tool = getToolsForMode('prototype').find(t => t.id === 'no-action')
      expect(tool.action).toBeNull()
    })
  })

  describe('subscribeToTools', () => {
    it('unsubscribe stops further calls', () => {
      const cb = vi.fn()
      const unsub = subscribeToTools(cb)
      unsub()
      initTools({ '*': [{ id: 'x', label: 'X', group: 'tools' }] })
      expect(cb).not.toHaveBeenCalled()
    })
  })

  describe('getToolsSnapshot', () => {
    it('changes when state changes', () => {
      initTools({ '*': [{ id: 'snap-tool', label: 'Snap', group: 'tools' }] })
      const snap1 = getToolsSnapshot()
      setToolState('snap-tool', { active: true })
      const snap2 = getToolsSnapshot()
      expect(snap1).not.toBe(snap2)
    })

    it('changes when action is set', () => {
      initTools({ '*': [{ id: 'snap-tool2', label: 'Snap2', group: 'tools' }] })
      const snap1 = getToolsSnapshot()
      setToolAction('snap-tool2', () => {})
      const snap2 = getToolsSnapshot()
      expect(snap1).not.toBe(snap2)
    })
  })

  describe('getToolState', () => {
    it('returns null for undeclared tools', () => {
      expect(getToolState('nonexistent')).toBeNull()
    })
  })
})
