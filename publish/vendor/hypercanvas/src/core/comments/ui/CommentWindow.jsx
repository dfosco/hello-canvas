/**
 * CommentWindow — thread viewer popup showing a comment with replies and reactions.
 * Uses shadcn Button, Textarea, Avatar, Badge, Separator.
 */

import { useState, useMemo } from 'react'
import { replyToComment, addReaction, removeReaction, resolveComment, unresolveComment, editComment, editReply, deleteComment } from '../api.js'
import { saveDraft, getDraft, clearDraft, replyDraftKey } from '../commentDrafts.js'
import { Button } from '../../lib/components/ui/button/index.js'
import { Textarea } from '../../lib/components/ui/textarea/index.js'
import * as Avatar from '../../lib/components/ui/avatar/index.js'
import { Separator } from '../../lib/components/ui/separator/index.js'
import { cn } from '../../lib/utils/index.js'

const REACTION_EMOJI = {
  THUMBS_UP: '👍', THUMBS_DOWN: '👎', LAUGH: '😄', HOORAY: '🎉',
  CONFUSED: '😕', HEART: '❤️', ROCKET: '🚀', EYES: '👀',
}
const emojiEntries = Object.entries(REACTION_EMOJI)

function timeAgo(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function emojiFor(content) { return REACTION_EMOJI[content] ?? content }

function pillClass(active) {
  return cn(
    'inline-flex items-center text-xs px-2 py-0.5 rounded-full border cursor-pointer transition-colors',
    active ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-transparent text-muted-foreground'
  )
}

function emojiPickerBtnClass(active) {
  return cn(
    'flex items-center justify-center w-7 h-7 rounded border-none text-base cursor-pointer transition-colors',
    active ? 'bg-primary/10' : 'bg-transparent hover:bg-muted'
  )
}

export default function CommentWindow({ comment, discussion, user = null, onClose, onMove, winEl }) {
  const draftKey = useMemo(() => replyDraftKey(comment.id), [comment.id])

  const [resolving, setResolving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const [saving, setSaving] = useState(false)
  const [replyText, setReplyText] = useState(() => getDraft(draftKey)?.text ?? '')
  const [submittingReply, setSubmittingReply] = useState(false)
  const [editingReply, setEditingReply] = useState(-1)
  const [editReplyText, setEditReplyText] = useState('')
  const [savingReply, setSavingReply] = useState(false)
  const [pickerTarget, setPickerTarget] = useState(null)
  const [reactions, setReactions] = useState(() => [...(comment.reactionGroups ?? [])])
  const [replyReactions, setReplyReactions] = useState(() => (comment.replies ?? []).map((r) => [...(r.reactionGroups ?? [])]))
  const [replyTexts, setReplyTexts] = useState(() => (comment.replies ?? []).map((r) => r.text ?? r.body ?? ''))

  const resolved = !!comment.meta?.resolved
  const commentText = comment.text ?? ''
  const replies = comment.replies ?? []
  const canEdit = !!(user && comment.author?.login === user.login)
  const discussionId = discussion?.id ?? comment.discussionId ?? comment.discussion?.id ?? null
  const canReply = !!(user && discussionId)

  function handleReplyBlur() {
    if (replyText.trim()) {
      saveDraft(draftKey, { type: 'reply', text: replyText })
    } else {
      clearDraft(draftKey)
    }
  }

  function isReacted(content) { return reactions.some((r) => r.content === content && r.viewerHasReacted) }
  function isReplyReacted(ri, content) { return (replyReactions[ri] ?? []).some((r) => r.content === content && r.viewerHasReacted) }

  async function toggleResolve() {
    setResolving(true)
    try {
      if (resolved) {
        await unresolveComment(comment.id, comment._rawBody ?? comment.body ?? '')
        comment.meta = { ...comment.meta }; delete comment.meta.resolved
        setResolving(false); onMove?.()
      } else {
        await resolveComment(comment.id, comment._rawBody ?? comment.body ?? '')
        comment.meta = { ...comment.meta, resolved: true }; onMove?.(); onClose?.()
      }
    } catch (err) { console.error('[storyboard] Failed to toggle resolve:', err); setResolving(false) }
  }

  function copyLink() {
    const url = new URL(window.location.href); url.searchParams.set('comment', comment.id)
    navigator.clipboard.writeText(url.toString()).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }).catch(() => {})
  }

  async function saveEdit() {
    const t = editText.trim(); if (!t) return; setSaving(true)
    try { await editComment(comment.id, comment._rawBody ?? comment.body ?? '', t); comment.text = t; comment._rawBody = null; setEditing(false) } catch (err) { console.error('[storyboard] Failed to edit:', err) } finally { setSaving(false) }
  }

  async function toggleReaction(content, gi) {
    const group = gi !== undefined ? reactions[gi] : reactions.find((r) => r.content === content)
    const was = group?.viewerHasReacted ?? false
    let next
    if (was && group) {
      group.users = { totalCount: Math.max(0, (group.users?.totalCount ?? 1) - 1) }; group.viewerHasReacted = false
      next = group.users.totalCount === 0 ? reactions.filter((r) => r.content !== content) : [...reactions]
    } else if (group) {
      group.users = { totalCount: (group.users?.totalCount ?? 0) + 1 }; group.viewerHasReacted = true; next = [...reactions]
    } else {
      next = [...reactions, { content, users: { totalCount: 1 }, viewerHasReacted: true }]
    }
    setReactions(next)
    comment.reactionGroups = next
    try { if (was) await removeReaction(comment.id, content); else await addReaction(comment.id, content) } catch { /* ignore */ }
  }

  async function toggleReplyReaction(ri, content, rgi) {
    const reply = replies[ri]; if (!reply) return
    const groups = [...(replyReactions[ri] ?? [])]
    const group = rgi !== undefined ? groups[rgi] : groups.find((r) => r.content === content)
    const was = group?.viewerHasReacted ?? false
    if (was && group) {
      group.users = { totalCount: Math.max(0, (group.users?.totalCount ?? 1) - 1) }; group.viewerHasReacted = false
      if (group.users.totalCount === 0) groups.splice(groups.indexOf(group), 1)
    } else if (group) {
      group.users = { totalCount: (group.users?.totalCount ?? 0) + 1 }; group.viewerHasReacted = true
    } else {
      groups.push({ content, users: { totalCount: 1 }, viewerHasReacted: true })
    }
    const nextRR = [...replyReactions]; nextRR[ri] = groups
    setReplyReactions(nextRR)
    reply.reactionGroups = groups
    try { if (was) await removeReaction(reply.id, content); else await addReaction(reply.id, content) } catch { /* ignore */ }
  }

  async function submitReply() {
    const t = replyText.trim(); if (!t) return; setSubmittingReply(true)
    try {
      await replyToComment(discussionId, comment.id, t)
      setReplyText('')
      clearDraft(draftKey)
      onMove?.()
    } catch (err) { console.error('[storyboard] Reply failed:', err) } finally { setSubmittingReply(false) }
  }

  async function saveReply(ri) {
    const t = editReplyText.trim(); if (!t) return
    const reply = replies[ri]; if (!reply) return; setSavingReply(true)
    try {
      await editReply(reply.id, t); reply.text = t; reply.body = t
      const nextTexts = [...replyTexts]; nextTexts[ri] = t; setReplyTexts(nextTexts)
      setEditingReply(-1)
    } catch (err) { console.error('[storyboard] Edit reply failed:', err) } finally { setSavingReply(false) }
  }

  async function deleteReplyAt(ri) {
    const reply = replies[ri]; if (!reply || !confirm('Delete this reply?')) return
    try { await deleteComment(reply.id); onMove?.() } catch (err) { console.error('[storyboard] Delete failed:', err) }
  }

  function startDrag(e) {
    const target = e.target
    if (target.closest('[data-no-drag]') || !winEl) return
    const startX = e.clientX, startY = e.clientY, rect = winEl.getBoundingClientRect()
    const sx = rect.left, sy = rect.top; target.style.cursor = 'grabbing'
    const mv = (ev) => { winEl.style.position = 'fixed'; winEl.style.left = `${sx + ev.clientX - startX}px`; winEl.style.top = `${sy + ev.clientY - startY}px`; winEl.style.transform = 'none' }
    const up = () => { target.style.cursor = 'grab'; document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up) }
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up); e.preventDefault()
  }

  function handleReplyKeydown(e) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitReply() }
  }

  return (
    <div className="font-sans" onClick={(e) => e.stopPropagation()}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-border cursor-grab select-none" onMouseDown={startDrag}>
        <div className="flex items-center gap-2">
          {comment.author?.avatarUrl && (
            <Avatar.Root className="h-6 w-6">
              <Avatar.Image src={comment.author.avatarUrl} alt={comment.author?.login} />
              <Avatar.Fallback className="text-[10px]">{(comment.author?.login ?? '?')[0]?.toUpperCase()}</Avatar.Fallback>
            </Avatar.Root>
          )}
          <div className="flex flex-col">
            <span className="text-xs font-semibold">{comment.author?.login ?? 'unknown'}</span>
            {comment.createdAt && (
              <span className="text-[11px] text-muted-foreground leading-tight">{timeAgo(comment.createdAt)}</span>
            )}
          </div>
        </div>
        <div className="flex items-center shrink-0 gap-1.5" data-no-drag onMouseDown={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" className={cn('h-6 px-2 text-[11px]', resolved ? 'text-success' : 'text-muted-foreground')} disabled={resolving} onClick={toggleResolve}>
            {resolving ? (resolved ? 'Unresolving…' : 'Resolving…') : (resolved ? 'Resolved ✓' : 'Resolve')}
          </Button>
          <Button variant="ghost" size="sm" className={cn('h-6 px-2 text-[11px]', copied ? 'text-success' : 'text-muted-foreground')} onClick={copyLink}>
            {copied ? 'Copied!' : 'Copy link'}
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground" aria-label="Close" onClick={onClose}>×</Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-auto overflow-y-auto px-3 pt-3 no-scrollbar">
        {!editing ? (
          <p className="text-sm leading-relaxed m-0 mb-2 break-words">{commentText}</p>
        ) : (
          <div className="mb-2">
            <Textarea className="min-h-[40px] max-h-[100px] text-xs mb-2" value={editText} onChange={(e) => setEditText(e.target.value)} />
            <div className="flex justify-end gap-1">
              <Button variant="outline" size="sm" className="h-6 text-xs border border-input text-foreground" onClick={() => setEditing(false)}>Cancel</Button>
              <Button size="sm" className="h-6 text-xs" disabled={saving} onClick={saveEdit}>{saving ? 'Saving…' : 'Save'}</Button>
            </div>
          </div>
        )}

        {/* Reactions */}
        <div className="flex items-center flex-wrap gap-1 mb-2">
          {reactions.map((group, gi) => (
            (group.users?.totalCount ?? 0) > 0 && (
              <button key={group.content} className={pillClass(group.viewerHasReacted)}
                      onClick={(e) => { e.stopPropagation(); toggleReaction(group.content, gi) }}>
                <span className="mr-1">{emojiFor(group.content)}</span><span>{group.users?.totalCount ?? 0}</span>
              </button>
            )
          ))}
          <div className="relative">
            <button className="inline-flex items-center text-xs px-2 py-0.5 rounded-full border border-border bg-transparent text-muted-foreground cursor-pointer hover:border-primary"
                    onClick={(e) => { e.stopPropagation(); setPickerTarget(pickerTarget === 'comment' ? null : 'comment') }}>😀 +</button>
            {pickerTarget === 'comment' && (
              <div className="absolute bottom-full left-0 mb-1 flex gap-0.5 p-1 bg-popover border border-border rounded-lg shadow-lg z-10">
                {emojiEntries.map(([key, emoji]) => (
                  <button key={key} className={emojiPickerBtnClass(isReacted(key))}
                          onClick={(e) => { e.stopPropagation(); toggleReaction(key); setPickerTarget(null) }}>{emoji}</button>
                ))}
              </div>
            )}
          </div>
          {!editing && canEdit && (
            <button className="ml-auto text-xs text-muted-foreground bg-transparent border-none cursor-pointer hover:underline" onClick={() => { setEditing(true); setEditText(commentText) }}>Edit</button>
          )}
        </div>

        {/* Replies */}
        {replies.length > 0 && (
          <>
            <Separator className="my-2" />
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{replies.length} {replies.length === 1 ? 'Reply' : 'Replies'}</div>
            {replies.map((reply, ri) => (
              <div key={reply.id ?? ri} className="flex mb-2 gap-2">
                {reply.author?.avatarUrl && (
                  <Avatar.Root className="h-5 w-5 shrink-0">
                    <Avatar.Image src={reply.author.avatarUrl} alt={reply.author?.login} />
                    <Avatar.Fallback className="text-[10px]">{(reply.author?.login ?? '?')[0]?.toUpperCase()}</Avatar.Fallback>
                  </Avatar.Root>
                )}
                <div className="flex-auto min-w-0">
                  <div className="flex items-start justify-between mb-0.5">
                    <div className="flex flex-col">
                      <span className="text-xs font-semibold">{reply.author?.login ?? 'unknown'}</span>
                      {reply.createdAt && <span className="text-[11px] text-muted-foreground leading-tight">{timeAgo(reply.createdAt)}</span>}
                    </div>
                    {user && reply.author?.login === user.login && (
                      <div className="flex gap-2 ml-auto shrink-0">
                        {editingReply !== ri && (
                          <>
                            <button className="text-[11px] text-muted-foreground bg-transparent border-none cursor-pointer hover:underline" onClick={() => { setEditingReply(ri); setEditReplyText(replyTexts[ri]) }}>Edit</button>
                            <button className="text-[11px] text-destructive bg-transparent border-none cursor-pointer hover:underline" onClick={() => deleteReplyAt(ri)}>Delete</button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  {editingReply !== ri ? (
                    <p className="text-sm leading-relaxed m-0 break-words">{replyTexts[ri] ?? reply.text ?? reply.body}</p>
                  ) : (
                    <div>
                      <Textarea className="min-h-[40px] max-h-[100px] text-xs mb-1" value={editReplyText} onChange={(e) => setEditReplyText(e.target.value)} />
                      <div className="flex justify-end gap-1">
                        <Button variant="outline" size="sm" className="h-6 text-xs border border-input text-foreground" onClick={() => setEditingReply(-1)}>Cancel</Button>
                        <Button size="sm" className="h-6 text-xs" disabled={savingReply} onClick={() => saveReply(ri)}>{savingReply ? 'Saving…' : 'Save'}</Button>
                      </div>
                    </div>
                  )}
                  {/* Reply reactions */}
                  <div className="flex items-center flex-wrap gap-1 mt-1">
                    {(replyReactions[ri] ?? []).map((rg, rgi) => (
                      (rg.users?.totalCount ?? 0) > 0 && (
                        <button key={rg.content} className={pillClass(rg.viewerHasReacted)}
                                onClick={(e) => { e.stopPropagation(); toggleReplyReaction(ri, rg.content, rgi) }}>
                          <span className="mr-1">{emojiFor(rg.content)}</span><span>{rg.users?.totalCount ?? 0}</span>
                        </button>
                      )
                    ))}
                    <div className="relative">
                      <button className="inline-flex items-center text-xs px-2 py-0.5 rounded-full border border-border bg-transparent text-muted-foreground cursor-pointer"
                              onClick={(e) => { e.stopPropagation(); setPickerTarget(pickerTarget === `reply-${ri}` ? null : `reply-${ri}`) }}>😀 +</button>
                      {pickerTarget === `reply-${ri}` && (
                        <div className="absolute bottom-full left-0 mb-1 flex gap-0.5 p-1 bg-popover border border-border rounded-lg shadow-lg z-10">
                          {emojiEntries.map(([key, emoji]) => (
                            <button key={key} className={emojiPickerBtnClass(isReplyReacted(ri, key))}
                                    onClick={(e) => { e.stopPropagation(); toggleReplyReaction(ri, key); setPickerTarget(null) }}>{emoji}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Reply form */}
      {canReply && (
        <div className="border-t border-border px-3 py-3 flex flex-col">
          <Textarea className="min-h-[40px] max-h-[100px] text-xs mb-1" placeholder="Reply…" value={replyText} onChange={(e) => setReplyText(e.target.value)} onKeyDown={handleReplyKeydown} onBlur={handleReplyBlur} />
          <div className="flex justify-end mt-1">
            <Button size="sm" className="text-xs" disabled={!replyText.trim() || submittingReply} onClick={submitReply}>
              {submittingReply ? 'Posting…' : 'Reply'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
