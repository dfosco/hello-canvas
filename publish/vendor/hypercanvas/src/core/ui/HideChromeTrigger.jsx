/**
 * HideChromeTrigger — toolbar button that toggles toolbar/branch bar visibility.
 * Always visible (even in hide mode). Uses the lightbulb icon.
 * In hide mode: goes 50% opacity.
 * In completely-hidden mode: not rendered at all.
 */

import { useState, useEffect, useCallback } from 'react'
import { TriggerButton } from '../lib/components/ui/trigger-button/index.js'
import Icon from './Icon.jsx'

export default function HideChromeTrigger({ config = {}, tabindex }) {
  const [hidden, setHidden] = useState(
    () => document.documentElement.classList.contains('storyboard-chrome-hidden')
  )
  const [completelyHidden, setCompletelyHidden] = useState(
    () => document.documentElement.classList.contains('storyboard-chrome-completely-hidden')
  )

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setHidden(document.documentElement.classList.contains('storyboard-chrome-hidden'))
      setCompletelyHidden(document.documentElement.classList.contains('storyboard-chrome-completely-hidden'))
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  const toggle = useCallback(() => {
    document.documentElement.classList.toggle('storyboard-chrome-hidden')
    document.documentElement.classList.remove('storyboard-chrome-completely-hidden')
  }, [])

  if (completelyHidden) return null

  return (
    <span style={{ opacity: hidden ? 0.5 : 1, transition: 'opacity 0.15s' }}>
      <TriggerButton
        aria-label={config.ariaLabel || 'Toggle toolbars'}
        size={config.size || 'icon-xl'}
        tabIndex={tabindex}
        onClick={toggle}
      >
        <Icon name={config.icon || 'primer/light-bulb'} size={16} {...(config.meta || {})} />
      </TriggerButton>
    </span>
  )
}
