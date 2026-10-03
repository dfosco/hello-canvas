export function isTouchKeyboardDevice(windowObject = window) {
  const navigatorObject = windowObject?.navigator
  return Boolean(
    navigatorObject?.maxTouchPoints > 0
    && windowObject?.matchMedia?.('(pointer: coarse)').matches,
  )
}

export function inputFromMobileBeforeInput(event) {
  if (event?.isComposing || event?.inputType === 'insertCompositionText' || event?.inputType === 'insertFromComposition') {
    return null
  }
  if (typeof event?.data === 'string' && event.data.length > 0) return event.data
  switch (event?.inputType) {
    case 'insertLineBreak':
    case 'insertParagraph':
      return '\r'
    case 'deleteContentBackward':
      return '\x7f'
    case 'deleteContentForward':
      return '\x1b[3~'
    default:
      return null
  }
}

export function installMobileBeforeInputBridge(target, { isTouchDevice = isTouchKeyboardDevice, send } = {}) {
  const handler = (event) => {
    if (!isTouchDevice()) return
    const data = inputFromMobileBeforeInput(event)
    if (data) send?.(data)
  }
  target?.addEventListener('beforeinput', handler)
  return () => target?.removeEventListener('beforeinput', handler)
}
