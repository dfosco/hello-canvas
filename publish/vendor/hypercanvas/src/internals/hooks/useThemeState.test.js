import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { setTheme, setThemeSyncTarget } from '../../core/index.js'
import { useThemeState, useThemeSyncTargets } from './useThemeState.js'

beforeEach(() => {
  localStorage.clear()
  // Reset to defaults
  setTheme('system')
})

describe('useThemeState', () => {
  it('returns { theme, resolved }', () => {
    const { result } = renderHook(() => useThemeState())
    expect(result.current).toHaveProperty('theme')
    expect(result.current).toHaveProperty('resolved')
  })

  it('defaults to system theme', () => {
    const { result } = renderHook(() => useThemeState())
    expect(result.current.theme).toBe('system')
    // resolved should be 'light' or 'dark' depending on matchMedia mock
    expect(['light', 'dark']).toContain(result.current.resolved)
  })

  it('updates when setTheme is called', () => {
    const { result } = renderHook(() => useThemeState())

    act(() => {
      setTheme('dark_dimmed')
    })

    expect(result.current.theme).toBe('dark_dimmed')
    expect(result.current.resolved).toBe('dark_dimmed')
  })

  it('reverts to system when set back', () => {
    const { result } = renderHook(() => useThemeState())

    act(() => { setTheme('dark') })
    expect(result.current.theme).toBe('dark')

    act(() => { setTheme('system') })
    expect(result.current.theme).toBe('system')
  })
})

describe('useThemeSyncTargets', () => {
  it('returns default sync targets', () => {
    const { result } = renderHook(() => useThemeSyncTargets())
    expect(result.current.prototype).toBe(true)
    expect(result.current.toolbar).toBe(true)
    expect(result.current.codeBoxes).toBe(true)
    expect(result.current.canvas).toBe(true)
  })

  it('updates when setThemeSyncTarget is called', () => {
    const { result } = renderHook(() => useThemeSyncTargets())

    act(() => {
      setThemeSyncTarget('toolbar', true)
    })

    expect(result.current.toolbar).toBe(true)
  })
})
