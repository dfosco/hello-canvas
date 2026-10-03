/**
 * CommandPaletteTrigger — toolbar trigger button for the command palette.
 * Dispatches a custom event to open the React-based command palette.
 * The actual palette UI is rendered in React (src/components/CommandPalette).
 */

import { useCallback } from 'react'
import { TriggerButton } from '../lib/components/ui/trigger-button/index.js'
import Icon from './Icon.jsx'

export default function CommandPalette({
  tabindex,
  icon = 'iconoir/key-command',
  iconMeta = {},
  oninterceptclick,
}) {
  const openPalette = useCallback(() => {
    if (oninterceptclick) {
      oninterceptclick()
      return
    }
    document.dispatchEvent(new CustomEvent('storyboard:toggle-palette'))
  }, [oninterceptclick])

  return (
    <TriggerButton
      className="text-2xl"
      aria-label="Command Menu"
      tabIndex={tabindex}
      onClick={openPalette}
    >
      <Icon name={icon} size={16} {...iconMeta} />
    </TriggerButton>
  )
}
