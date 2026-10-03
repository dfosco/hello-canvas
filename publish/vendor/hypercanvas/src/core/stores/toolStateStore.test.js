import {
  TOOL_STATES,
  initToolbarToolStates,
  setToolbarToolState,
  getToolbarToolState,
  isToolbarToolLocalOnly,
  subscribeToToolbarToolStates,
  getToolbarToolStatesSnapshot,
  _resetToolbarToolStates,
} from './toolStateStore.js'

afterEach(() => {
  _resetToolbarToolStates()
})

describe('toolStateStore', () => {
  describe('TOOL_STATES', () => {
    it('exports all 5 state constants', () => {
      expect(TOOL_STATES.ACTIVE).toBe('active')
      expect(TOOL_STATES.INACTIVE).toBe('inactive')
      expect(TOOL_STATES.HIDDEN).toBe('hidden')
      expect(TOOL_STATES.DIMMED).toBe('dimmed')
      expect(TOOL_STATES.DISABLED).toBe('disabled')
      expect(Object.keys(TOOL_STATES)).toHaveLength(5)
    })
  })

  describe('getToolbarToolState', () => {
    it('returns "active" for unknown tool IDs', () => {
      expect(getToolbarToolState('nonexistent')).toBe('active')
    })

    it('returns "active" after init with no state in config', () => {
      initToolbarToolStates({ myTool: { prod: true } })
      expect(getToolbarToolState('myTool')).toBe('active')
    })
  })

  describe('initToolbarToolStates', () => {
    it('seeds states from config', () => {
      initToolbarToolStates({
        inspector: { state: 'hidden', prod: true },
        comments: { state: 'dimmed', prod: true },
      })
      expect(getToolbarToolState('inspector')).toBe('hidden')
      expect(getToolbarToolState('comments')).toBe('dimmed')
    })

    it('defaults to active when no state specified', () => {
      initToolbarToolStates({ inspector: { render: 'panel', prod: true } })
      expect(getToolbarToolState('inspector')).toBe('active')
    })

    it('reads state from config when specified', () => {
      initToolbarToolStates({ inspector: { state: 'inactive', prod: true } })
      expect(getToolbarToolState('inspector')).toBe('inactive')
    })

    it('dev-only (no prod flag) + !isLocalDev → disabled (overrides config state)', () => {
      initToolbarToolStates(
        { devTool: { state: 'active' } },
        { isLocalDev: false },
      )
      expect(getToolbarToolState('devTool')).toBe('disabled')
    })

    it('dev-only (no prod flag) + isLocalDev → uses config state (active by default)', () => {
      initToolbarToolStates(
        { devTool: {} },
        { isLocalDev: true },
      )
      expect(getToolbarToolState('devTool')).toBe('active')
    })

    it('prod tool + !isLocalDev → uses config state', () => {
      initToolbarToolStates(
        { prodTool: { prod: true, state: 'active' } },
        { isLocalDev: false },
      )
      expect(getToolbarToolState('prodTool')).toBe('active')
    })

    it('legacy localOnly + isLocalDev → disabled takes precedence', () => {
      initToolbarToolStates(
        { devTool: { localOnly: true, prod: true } },
        { isLocalDev: false },
      )
      expect(getToolbarToolState('devTool')).toBe('disabled')
    })

    it('handles empty config', () => {
      initToolbarToolStates({})
      expect(getToolbarToolState('anything')).toBe('active')
    })

    it('replaces previous state on re-init', () => {
      initToolbarToolStates({ inspector: { state: 'hidden', prod: true } })
      expect(getToolbarToolState('inspector')).toBe('hidden')

      initToolbarToolStates({ inspector: { state: 'dimmed', prod: true } })
      expect(getToolbarToolState('inspector')).toBe('dimmed')
    })
  })

  describe('setToolbarToolState', () => {
    it('updates state for a known tool', () => {
      initToolbarToolStates({ inspector: { prod: true } })
      setToolbarToolState('inspector', 'hidden')
      expect(getToolbarToolState('inspector')).toBe('hidden')
    })

    it('updates state for unknown tool (creates entry)', () => {
      setToolbarToolState('newTool', 'dimmed')
      expect(getToolbarToolState('newTool')).toBe('dimmed')
    })

    it('warns on invalid state value', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      setToolbarToolState('inspector', 'bogus')
      expect(spy).toHaveBeenCalledOnce()
      expect(spy.mock.calls[0][0]).toContain('Invalid tool state')
      spy.mockRestore()
    })

    it('notifies subscribers on change', () => {
      const cb = vi.fn()
      subscribeToToolbarToolStates(cb)
      initToolbarToolStates({ inspector: {} })
      const callsBefore = cb.mock.calls.length

      setToolbarToolState('inspector', 'inactive')
      expect(cb).toHaveBeenCalledTimes(callsBefore + 1)
    })
  })

  describe('isToolbarToolLocalOnly', () => {
    it('returns true for dev-only tools (no prod flag)', () => {
      initToolbarToolStates(
        { devTool: {} },
        { isLocalDev: true },
      )
      expect(isToolbarToolLocalOnly('devTool')).toBe(true)
    })

    it('returns false for prod tools', () => {
      initToolbarToolStates({ inspector: { prod: true } })
      expect(isToolbarToolLocalOnly('inspector')).toBe(false)
    })

    it('returns false for unknown tools', () => {
      expect(isToolbarToolLocalOnly('nonexistent')).toBe(false)
    })
  })

  describe('subscribeToToolbarToolStates', () => {
    it('calls callback on state changes', () => {
      const cb = vi.fn()
      subscribeToToolbarToolStates(cb)
      initToolbarToolStates({ inspector: {} })
      expect(cb).toHaveBeenCalled()
    })

    it('returns working unsubscribe function', () => {
      const cb = vi.fn()
      const unsub = subscribeToToolbarToolStates(cb)
      unsub()

      initToolbarToolStates({ inspector: {} })
      expect(cb).not.toHaveBeenCalled()
    })

    it('supports multiple subscribers', () => {
      const cb1 = vi.fn()
      const cb2 = vi.fn()
      subscribeToToolbarToolStates(cb1)
      subscribeToToolbarToolStates(cb2)

      initToolbarToolStates({ inspector: {} })
      expect(cb1).toHaveBeenCalled()
      expect(cb2).toHaveBeenCalled()
    })
  })

  describe('getToolbarToolStatesSnapshot', () => {
    it('returns string', () => {
      expect(typeof getToolbarToolStatesSnapshot()).toBe('string')
    })

    it('changes on mutation', () => {
      const before = getToolbarToolStatesSnapshot()
      initToolbarToolStates({ inspector: {} })
      const after = getToolbarToolStatesSnapshot()
      expect(after).not.toBe(before)
    })

    it('does not change without mutation', () => {
      const a = getToolbarToolStatesSnapshot()
      const b = getToolbarToolStatesSnapshot()
      expect(a).toBe(b)
    })
  })

  describe('_resetToolbarToolStates', () => {
    it('clears all state', () => {
      initToolbarToolStates({ inspector: { state: 'hidden', prod: true } }, { isLocalDev: true })
      _resetToolbarToolStates()
      expect(getToolbarToolState('inspector')).toBe('active')
      expect(isToolbarToolLocalOnly('inspector')).toBe(false)
    })

    it('clears all listeners', () => {
      const cb = vi.fn()
      subscribeToToolbarToolStates(cb)
      _resetToolbarToolStates()

      initToolbarToolStates({ inspector: {} })
      expect(cb).not.toHaveBeenCalled()
    })
  })
})
