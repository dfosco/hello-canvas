/**
 * Composer — inline comment textarea at click position.
 * Uses shadcn Button, Textarea, Avatar.
 */

import { useState, useMemo } from 'react'
import { Button } from '../../lib/components/ui/button/index.js'
import { Textarea } from '../../lib/components/ui/textarea/index.js'
import * as Avatar from '../../lib/components/ui/avatar/index.js'
import { saveDraft, getDraft, clearDraft, composerDraftKey } from '../commentDrafts.js'

export default function Composer({ user = null, route = '', onCancel, onSubmit }) {
  const draftKey = useMemo(() => composerDraftKey(route), [route])
  const [text, setText] = useState(() => getDraft(draftKey)?.text ?? '')

  function submit() {
    const val = text.trim()
    if (!val) return
    onSubmit?.(val)
  }

  function cancel() {
    onCancel?.()
  }

  function handleBlur() {
    if (text.trim()) {
      saveDraft(draftKey, { type: 'comment', text })
    } else {
      clearDraft(draftKey)
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit() }
  }

  return (
    <div className="flex flex-col font-sans" onKeyDown={handleKeydown}>
      {user && (
        <div className="flex items-center px-3 pt-2 gap-2">
          <Avatar.Root className="h-5 w-5">
            <Avatar.Image src={user.avatarUrl} alt={user.login} />
            <Avatar.Fallback className="text-[10px]">{user.login[0]?.toUpperCase()}</Avatar.Fallback>
          </Avatar.Root>
          <span className="text-xs text-muted-foreground font-medium">{user.login}</span>
        </div>
      )}
      <div className="px-3 pt-3">
        <Textarea
          className="min-h-[60px] max-h-[160px] resize-y text-sm"
          placeholder="Leave a comment…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={handleBlur}
        />
      </div>
      <div className="flex items-center justify-end p-3 gap-1">
        <Button variant="outline" size="sm" className="border border-input text-foreground" onClick={cancel}>Cancel</Button>
        <Button size="sm" onClick={submit}>Comment</Button>
      </div>
    </div>
  )
}
