/**
 * CommandPaletteTrigger — toolbar button that opens the ⌘K command palette.
 * Used as a tool component on the command-toolbar surface.
 */

import { useCallback } from 'react'
import { TriggerButton } from '../lib/components/ui/trigger-button/index.js'
import Icon from './Icon.jsx'

export default function CommandPaletteTrigger({ config = {}, tabindex }) {
  const openPalette = useCallback(() => {
    document.dispatchEvent(new CustomEvent('storyboard:toggle-palette'))
  }, [])

  return (
    <TriggerButton
      aria-label="Command palette"
      size={config.size || 'icon-xl'}
      tabIndex={tabindex}
      onClick={openPalette}
    >
      <Icon name={config.icon || 'iconoir/key-command'} size={16} {...(config.meta || {})} />
    </TriggerButton>
  )
}
