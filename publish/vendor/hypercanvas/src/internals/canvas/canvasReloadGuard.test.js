import { describe, it, expect, beforeEach } from 'vitest'
import { enableCanvasGuard, disableCanvasGuard, isCanvasGuardActive } from './canvasReloadGuard.js'

describe('canvasReloadGuard', () => {
  beforeEach(() => {
    disableCanvasGuard()
  })

  it('starts inactive', () => {
    expect(isCanvasGuardActive()).toBe(false)
  })

  it('can be enabled and disabled', () => {
    enableCanvasGuard()
    expect(isCanvasGuardActive()).toBe(true)
    disableCanvasGuard()
    expect(isCanvasGuardActive()).toBe(false)
  })

  it('enable is idempotent', () => {
    enableCanvasGuard()
    enableCanvasGuard()
    expect(isCanvasGuardActive()).toBe(true)
    disableCanvasGuard()
    expect(isCanvasGuardActive()).toBe(false)
  })
})
