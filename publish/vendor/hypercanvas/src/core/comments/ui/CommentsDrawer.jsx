/**
 * CommentsDrawer — right-side panel listing all comments across all routes.
 * Uses shadcn Avatar, Badge, Button.
 */

import { useState, useEffect } from 'react'
import { listDiscussions, fetchRouteDiscussion } from '../api.js'
import { getCommentsConfig } from '../config.js'
import * as Avatar from '../../lib/components/ui/avatar/index.js'
import { Badge } from '../../lib/components/ui/badge/index.js'
import { Button } from '../../lib/components/ui/button/index.js'

function timeAgo(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function CommentsDrawer({ onClose, onNavigate }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [groups, setGroups] = useState([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const discussions = await listDiscussions()
        if (cancelled) return
        if (!discussions || discussions.length === 0) { setLoading(false); return }
        const basePath = getCommentsConfig()?.basePath ?? '/'
        const result = []
        for (const disc of discussions) {
          const routeMatch = disc.title?.match(/^Comments:\s*(.+)$/)
          if (!routeMatch) continue
          const route = routeMatch[1]
          if (!route.startsWith(basePath)) continue
          let discussion
          try { discussion = await fetchRouteDiscussion(route) } catch { continue }
          if (!discussion?.comments?.length) continue
          result.push({ route, comments: discussion.comments })
        }
        if (!cancelled) setGroups(result)
      } catch (err) { if (!cancelled) setError(err.message) }
      finally { if (!cancelled) setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [])

  return (
    <>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <h2 className="text-base font-semibold">All Comments</h2>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" aria-label="Close" onClick={onClose}>&#215;</Button>
      </div>

      <div className="flex-auto overflow-y-auto">
        {loading && (
          <div className="py-8 px-4 text-center text-sm text-muted-foreground">Loading comments&#8230;</div>
        )}
        {!loading && error && (
          <div className="py-8 px-4 text-center text-sm text-muted-foreground">Failed to load comments: {error}</div>
        )}
        {!loading && !error && groups.length === 0 && (
          <div className="py-8 px-4 text-center text-sm text-muted-foreground">No comments yet</div>
        )}
        {!loading && !error && groups.map((group) => (
          <div key={group.route} className="border-b border-border">
            <div className="flex items-center px-4 py-2 bg-muted/50 text-xs font-semibold text-muted-foreground">
              <code className="text-primary">{group.route}</code>
              <span className="ml-auto font-normal whitespace-nowrap">{group.comments.length} {group.comments.length !== 1 ? 'comments' : 'comment'}</span>
            </div>
            {group.comments.map((comment) => (
              <button
                key={comment.id}
                className={`flex px-4 py-2 cursor-pointer border-none bg-transparent w-full text-left font-sans hover:bg-accent/50 transition-colors${comment.meta?.resolved ? ' opacity-60' : ''}`}
                onClick={() => onNavigate?.(group.route, comment.id)}
              >
                {comment.author?.avatarUrl && (
                  <Avatar.Root className="h-6 w-6 shrink-0 mr-2">
                    <Avatar.Image src={comment.author.avatarUrl} alt={comment.author?.login ?? ''} />
                    <Avatar.Fallback className="text-[10px]">{(comment.author?.login ?? '?')[0]?.toUpperCase()}</Avatar.Fallback>
                  </Avatar.Root>
                )}
                <div className="flex flex-col flex-auto min-w-0 gap-0.5">
                  <div className="flex items-center gap-1">
                    <span className={`text-xs font-semibold ${comment.meta?.resolved ? 'text-muted-foreground' : 'text-foreground'}`}>{comment.author?.login ?? 'unknown'}</span>
                    {comment.createdAt && <span className="text-[11px] text-muted-foreground">{timeAgo(comment.createdAt)}</span>}
                    {comment.meta?.resolved && <Badge variant="outline" className="text-success text-[10px] px-1 py-0">Resolved</Badge>}
                  </div>
                  <p className={`text-sm leading-snug overflow-hidden whitespace-nowrap text-ellipsis m-0 ${comment.meta?.resolved ? 'text-muted-foreground' : 'text-foreground'}`}>{(comment.text ?? '').slice(0, 100)}</p>
                  {(comment.replies?.length ?? 0) > 0 && (
                    <div className="text-[11px] text-muted-foreground mt-0.5">&#128172; {comment.replies.length} {comment.replies.length === 1 ? 'reply' : 'replies'}</div>
                  )}
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>
    </>
  )
}
