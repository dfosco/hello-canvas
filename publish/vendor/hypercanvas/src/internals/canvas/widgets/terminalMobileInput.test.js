import { describe, expect, it, vi } from 'vitest'
import { inputFromMobileBeforeInput, installMobileBeforeInputBridge, isTouchKeyboardDevice } from './terminalMobileInput.js'

describe('terminal mobile input', () => {
  it('enables the bridge only for coarse touch devices', () => {
    expect(isTouchKeyboardDevice({
      navigator: { maxTouchPoints: 5 },
      matchMedia: () => ({ matches: true }),
    })).toBe(true)
    expect(isTouchKeyboardDevice({
      navigator: { maxTouchPoints: 0 },
      matchMedia: () => ({ matches: true }),
    })).toBe(false)
    expect(isTouchKeyboardDevice({
      navigator: { maxTouchPoints: 5 },
      matchMedia: () => ({ matches: false }),
    })).toBe(false)
  })

  it('converts mobile beforeinput text and terminal editing actions', () => {
    expect(inputFromMobileBeforeInput({ inputType: 'insertText', data: 'a' })).toBe('a')
    expect(inputFromMobileBeforeInput({ inputType: 'insertLineBreak', data: null })).toBe('\r')
    expect(inputFromMobileBeforeInput({ inputType: 'deleteContentBackward', data: null })).toBe('\x7f')
    expect(inputFromMobileBeforeInput({ inputType: 'deleteContentForward', data: null })).toBe('\x1b[3~')
  })

  it('leaves IME composition to Ghostty to avoid duplicate input', () => {
    expect(inputFromMobileBeforeInput({ inputType: 'insertCompositionText', data: 'a' })).toBeNull()
    expect(inputFromMobileBeforeInput({ inputType: 'insertFromComposition', data: 'a' })).toBeNull()
    expect(inputFromMobileBeforeInput({ inputType: 'insertText', data: 'a', isComposing: true })).toBeNull()
  })

  it('forwards only mobile beforeinput data through the installed bridge', () => {
    const target = document.createElement('div')
    const send = vi.fn()
    const remove = installMobileBeforeInputBridge(target, { isTouchDevice: () => true, send })

    target.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: 'x', bubbles: true }))
    target.dispatchEvent(new InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true }))
    expect(send).toHaveBeenNthCalledWith(1, 'x')
    expect(send).toHaveBeenNthCalledWith(2, '\x7f')

    remove()
    target.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: 'y', bubbles: true }))
    expect(send).toHaveBeenCalledTimes(2)
  })
})
