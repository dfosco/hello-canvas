import {
  isHideMode,
  activateHideMode,
  deactivateHideMode,
  pushSnapshot,
  undo,
  redo,
  getOverrideHistory,
  getCurrentIndex,
  canUndo,
  canRedo,
  getShadow,
  setShadow,
  removeShadow,
  getAllShadows,
  syncHashToHistory,
  installHistorySync,
} from './hideMode.js'

// ── Hide Mode Toggle ──

describe('Hide mode toggle', () => {
  it('isHideMode() returns false by default', () => {
    expect(isHideMode()).toBe(false)
  })

  it('activateHideMode() sets hide flag and clears URL hash', () => {
    window.location.hash = '#foo=bar'
    activateHideMode()
    expect(isHideMode()).toBe(true)
    expect(window.location.hash).toBe('')
  })

  it('deactivateHideMode() removes hide flag and restores params to hash', () => {
    window.location.hash = '#color=red'
    activateHideMode()
    expect(isHideMode()).toBe(true)
    expect(window.location.hash).toBe('')

    deactivateHideMode()
    expect(isHideMode()).toBe(false)
    expect(window.location.hash).toContain('color=red')
  })

  it('round-trip: activate with hash params → deactivate → hash restored', () => {
    window.location.hash = '#a=1&b=2'
    activateHideMode()
    expect(window.location.hash).toBe('')

    deactivateHideMode()
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    expect(params.get('a')).toBe('1')
    expect(params.get('b')).toBe('2')
  })
})

// ── History Stack ──

describe('History stack', () => {
  it('pushSnapshot() creates first entry from current hash', () => {
    window.location.hash = '#x=1'
    pushSnapshot()
    const history = getOverrideHistory()
    expect(history.length).toBe(1)
    expect(history[0][2]).toContain('x=1')
    expect(getCurrentIndex()).toBe(0)
  })

  it('pushSnapshot(paramString, route) uses explicit values', () => {
    pushSnapshot('theme=dark', '/settings')
    const history = getOverrideHistory()
    expect(history[0][1]).toBe('/settings')
    expect(history[0][2]).toBe('theme=dark')
  })

  it('multiple pushes build a stack, getCurrentIndex advances', () => {
    pushSnapshot('a=1', '/')
    pushSnapshot('b=2', '/')
    pushSnapshot('c=3', '/')
    expect(getOverrideHistory().length).toBe(3)
    expect(getCurrentIndex()).toBe(2)
  })

  it('duplicate push (same route+params) is ignored', () => {
    pushSnapshot('a=1', '/')
    pushSnapshot('a=1', '/')
    expect(getOverrideHistory().length).toBe(1)
  })

  it('history max is 200 entries (push 201, oldest trimmed)', () => {
    for (let i = 0; i < 201; i++) {
      pushSnapshot(`i=${i}`, '/')
    }
    const history = getOverrideHistory()
    expect(history.length).toBe(200)
    // Oldest entry should have been trimmed; first entry should be i=1
    expect(history[0][2]).toBe('i=1')
    // Positions should be re-indexed 0..199
    expect(history[0][0]).toBe(0)
    expect(history[199][0]).toBe(199)
  })
})

// ── Undo/Redo ──

describe('Undo/redo', () => {
  it('canUndo() false initially, true after 2+ pushes', () => {
    expect(canUndo()).toBe(false)
    pushSnapshot('a=1', '/')
    expect(canUndo()).toBe(false)
    pushSnapshot('b=2', '/')
    expect(canUndo()).toBe(true)
  })

  it('canRedo() false initially, true after undo', () => {
    expect(canRedo()).toBe(false)
    pushSnapshot('a=1', '/')
    pushSnapshot('b=2', '/')
    expect(canRedo()).toBe(false)
    undo()
    expect(canRedo()).toBe(true)
  })

  it('undo() returns previous {route, params}, moves index back', () => {
    pushSnapshot('a=1', '/page1')
    pushSnapshot('b=2', '/page2')
    const result = undo()
    expect(result).toEqual({ route: '/page1', params: 'a=1' })
    expect(getCurrentIndex()).toBe(0)
  })

  it('redo() returns next {route, params}, moves index forward', () => {
    pushSnapshot('a=1', '/page1')
    pushSnapshot('b=2', '/page2')
    undo()
    const result = redo()
    expect(result).toEqual({ route: '/page2', params: 'b=2' })
    expect(getCurrentIndex()).toBe(1)
  })

  it('undo() returns null when at start', () => {
    pushSnapshot('a=1', '/')
    expect(undo()).toBeNull()
  })

  it('redo() returns null when no redo target', () => {
    pushSnapshot('a=1', '/')
    pushSnapshot('b=2', '/')
    expect(redo()).toBeNull()
  })

  it('new push after undo clears redo (forks timeline)', () => {
    pushSnapshot('a=1', '/')
    pushSnapshot('b=2', '/')
    pushSnapshot('c=3', '/')
    undo() // back to b=2
    expect(canRedo()).toBe(true)

    pushSnapshot('d=4', '/')
    expect(canRedo()).toBe(false)
    expect(getOverrideHistory().length).toBe(3) // a, b, d (c trimmed)
    expect(getCurrentIndex()).toBe(2)
  })
})

// ── Shadow Read/Write ──

describe('Shadow read/write', () => {
  it('getShadow(key) returns null when no snapshot', () => {
    expect(getShadow('foo')).toBeNull()
  })

  it('setShadow(key, value) pushes new snapshot with key', () => {
    pushSnapshot('', '/')
    setShadow('color', 'blue')
    expect(getShadow('color')).toBe('blue')
    expect(getOverrideHistory().length).toBe(2)
  })

  it('removeShadow(key) pushes new snapshot without key', () => {
    pushSnapshot('color=blue', '/')
    removeShadow('color')
    expect(getShadow('color')).toBeNull()
  })

  it('getAllShadows() returns all entries from current snapshot', () => {
    pushSnapshot('a=1&b=2', '/')
    expect(getAllShadows()).toEqual({ a: '1', b: '2' })
  })
})

// ── syncHashToHistory ──

describe('syncHashToHistory', () => {
  it('skips when in hide mode', () => {
    pushSnapshot('a=1', '/')
    activateHideMode()
    window.location.hash = '#new=val'
    const historyBefore = getOverrideHistory().length
    syncHashToHistory()
    expect(getOverrideHistory().length).toBe(historyBefore)
  })

  it('pushes new snapshot when hash does not match any history entry', () => {
    pushSnapshot('a=1', '/')
    window.location.hash = '#x=9'
    syncHashToHistory()
    const history = getOverrideHistory()
    expect(history.length).toBe(2)
    expect(history[1][2]).toContain('x=9')
  })

  it('no-ops when hash matches current entry', () => {
    pushSnapshot('a=1', '/')
    // Set hash to match the current entry
    window.location.hash = '#a=1'
    const lengthBefore = getOverrideHistory().length
    syncHashToHistory()
    expect(getOverrideHistory().length).toBe(lengthBefore)
  })
})

// ── installHistorySync ──

describe('installHistorySync', () => {
  it('records initial page state in normal mode', () => {
    window.location.hash = '#x=1'
    installHistorySync()
    const history = getOverrideHistory()
    expect(history.length).toBe(1)
    expect(history[0][2]).toContain('x=1')
  })

  it('does NOT push empty snapshot on startup when in hide mode', () => {
    // Simulate: user had data, activated hide mode, then refreshed
    window.location.hash = '#color=red'
    activateHideMode()                       // snapshots hash, clears URL
    setShadow('color', 'blue')               // update shadow data
    const historyBefore = getOverrideHistory().length
    const indexBefore = getCurrentIndex()

    // Now simulate page refresh — hash is empty, hide mode still active
    window.location.hash = ''
    installHistorySync()

    // History should NOT have gained an empty snapshot
    expect(getOverrideHistory().length).toBe(historyBefore)
    expect(getCurrentIndex()).toBe(indexBefore)
    // Shadow data should still be intact
    expect(getShadow('color')).toBe('blue')
  })

  it('preserves shadow data through hide→refresh→show cycle', () => {
    window.location.hash = '#name=Alice'
    activateHideMode()
    setShadow('name', 'Bob')

    // Simulate refresh in hide mode
    window.location.hash = ''
    installHistorySync()

    // Now deactivate (show mode) — shadow data should restore to hash
    deactivateHideMode()
    expect(isHideMode()).toBe(false)
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    expect(params.get('name')).toBe('Bob')
  })
})
