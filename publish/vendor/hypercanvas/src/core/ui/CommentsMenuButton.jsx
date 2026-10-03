import { useState, useEffect } from 'react'
import { TriggerButton } from '../lib/components/ui/trigger-button/index.js'
import Icon from './Icon.jsx'
import { isAuthenticated } from '../comments/auth.js'
import { isCommentModeActive, toggleCommentMode, subscribeToCommentMode } from '../comments/commentMode.js'
import { openAuthModal } from '../comments/ui/authModal.js'

export default function CommentsMenuButton({ config = {}, data: _data, localOnly: _localOnly, tabindex }) {
  void _data
  void _localOnly
  const [commentModeOn, setCommentModeOn] = useState(isCommentModeActive())

  useEffect(() => {
    const unsubscribe = subscribeToCommentMode((active) => {
      setCommentModeOn(active)
    })
    return unsubscribe
  }, [])

  async function handleClick() {
    if (!isAuthenticated()) {
      const user = await openAuthModal()
      if (user) toggleCommentMode()
      return
    }
    toggleCommentMode()
  }

  return (
    <TriggerButton
      active={commentModeOn}
      size="icon-xl"
      aria-label={config.ariaLabel || 'Comments'}
      tabIndex={tabindex}
      onClick={handleClick}
    >
      <Icon name={config.icon || 'primer/comment'} size={16} {...(config.meta || {})} />
    </TriggerButton>
  )
}
