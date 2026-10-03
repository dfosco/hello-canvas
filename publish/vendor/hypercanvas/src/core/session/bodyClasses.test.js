import {
  syncOverrideClasses,
  setFlowClass,
  setSceneClass,
  installBodyClassSync,
} from './bodyClasses.js'
import { activateHideMode, deactivateHideMode, setShadow } from './hideMode.js'

/**
 * Collect all sb- prefixed classes currently on document.body.
 * @returns {string[]}
 */
function getSbClasses() {
  return [...document.body.classList].filter((c) => c.startsWith('sb-'))
}

beforeEach(() => {
  // Clear all sb- classes and hash between tests
  for (const cls of getSbClasses()) {
    document.body.classList.remove(cls)
  }
  window.location.hash = ''
  // Ensure hide mode is off
  try {
    deactivateHideMode()
  } catch {
    // ignore if not active
  }
})

// ── Override Classes ──

describe('Override body classes', () => {
  it('adds sb- classes for hash overrides', () => {
    window.location.hash = '#theme=dark&sidebar=collapsed'
    syncOverrideClasses()
    expect(getSbClasses()).toContain('sb-theme--dark')
    expect(getSbClasses()).toContain('sb-sidebar--collapsed')
  })

  it('removes stale classes when overrides are cleared', () => {
    window.location.hash = '#theme=dark&sidebar=collapsed'
    syncOverrideClasses()
    expect(getSbClasses()).toContain('sb-theme--dark')

    window.location.hash = '#sidebar=collapsed'
    syncOverrideClasses()
    expect(getSbClasses()).not.toContain('sb-theme--dark')
    expect(getSbClasses()).toContain('sb-sidebar--collapsed')
  })

  it('removes all override classes when hash is empty', () => {
    window.location.hash = '#theme=dark'
    syncOverrideClasses()
    expect(getSbClasses()).toContain('sb-theme--dark')

    window.location.hash = ''
    syncOverrideClasses()
    const overrideClasses = getSbClasses().filter((c) => !c.startsWith('sb-scene--'))
    expect(overrideClasses).toEqual([])
  })

  it('sanitizes dot-notation keys (dots become dashes)', () => {
    window.location.hash = '#settings.theme=dark'
    syncOverrideClasses()
    expect(getSbClasses()).toContain('sb-settings-theme--dark')
  })

  it('sanitizes values with special characters', () => {
    window.location.hash = '#mode=dark.dimmed'
    syncOverrideClasses()
    expect(getSbClasses()).toContain('sb-mode--dark-dimmed')
  })

  it('skips overrides with empty values', () => {
    window.location.hash = '#theme='
    syncOverrideClasses()
    const overrideClasses = getSbClasses().filter((c) => !c.startsWith('sb-scene--'))
    expect(overrideClasses).toEqual([])
  })

  it('updates classes when override value changes', () => {
    window.location.hash = '#theme=dark'
    syncOverrideClasses()
    expect(getSbClasses()).toContain('sb-theme--dark')

    window.location.hash = '#theme=light'
    syncOverrideClasses()
    expect(getSbClasses()).not.toContain('sb-theme--dark')
    expect(getSbClasses()).toContain('sb-theme--light')
  })
})

// ── Non-override sb-* classes preserved ──

describe('Non-override sb-* classes', () => {
  it('does not strip sb-comment-mode during sync', () => {
    document.body.classList.add('sb-comment-mode')
    window.location.hash = '#theme=dark'
    syncOverrideClasses()
    expect(document.body.classList.contains('sb-comment-mode')).toBe(true)
    expect(getSbClasses()).toContain('sb-theme--dark')
  })

  it('does not strip sb-ff-* feature flag classes during sync', () => {
    document.body.classList.add('sb-ff-dark-mode')
    syncOverrideClasses()
    expect(document.body.classList.contains('sb-ff-dark-mode')).toBe(true)
  })

  it('still removes stale override classes', () => {
    document.body.classList.add('sb-comment-mode')
    window.location.hash = '#theme=dark'
    syncOverrideClasses()
    window.location.hash = ''
    syncOverrideClasses()
    expect(document.body.classList.contains('sb-comment-mode')).toBe(true)
    expect(getSbClasses()).not.toContain('sb-theme--dark')
  })
})

// ── Flow Classes ──

describe('Flow body classes', () => {
  it('sets sb-scene-- class', () => {
    setFlowClass('Dashboard')
    expect(getSbClasses()).toContain('sb-scene--dashboard')
  })

  it('replaces previous flow class', () => {
    setFlowClass('Dashboard')
    setFlowClass('Settings')
    expect(getSbClasses()).not.toContain('sb-scene--dashboard')
    expect(getSbClasses()).toContain('sb-scene--settings')
  })

  it('removes flow class when called with empty string', () => {
    setFlowClass('Dashboard')
    setFlowClass('')
    const flowClasses = getSbClasses().filter((c) => c.startsWith('sb-scene--'))
    expect(flowClasses).toEqual([])
  })

  it('does not interfere with override classes', () => {
    window.location.hash = '#theme=dark'
    syncOverrideClasses()
    setFlowClass('Dashboard')
    expect(getSbClasses()).toContain('sb-theme--dark')
    expect(getSbClasses()).toContain('sb-scene--dashboard')
  })
})

// ── setSceneClass (deprecated alias) ──

describe('setSceneClass (deprecated alias)', () => {
  it('is the same function as setFlowClass', () => {
    expect(setSceneClass).toBe(setFlowClass)
  })

  it('sets sb-scene-- class', () => {
    setSceneClass('Dashboard')
    expect(getSbClasses()).toContain('sb-scene--dashboard')
  })
})

// ── Hide Mode ──

describe('Hide mode body classes', () => {
  it('reflects shadow overrides as body classes', () => {
    activateHideMode()
    setShadow('theme', 'dark')
    syncOverrideClasses()
    expect(getSbClasses()).toContain('sb-theme--dark')
  })
})

// ── installBodyClassSync ──

describe('installBodyClassSync', () => {
  it('runs initial sync on install', () => {
    window.location.hash = '#layout=compact'
    const unsub = installBodyClassSync()
    expect(getSbClasses()).toContain('sb-layout--compact')
    unsub()
  })

  it('returns an unsubscribe function', () => {
    const unsub = installBodyClassSync()
    expect(typeof unsub).toBe('function')
    unsub()
  })
})
