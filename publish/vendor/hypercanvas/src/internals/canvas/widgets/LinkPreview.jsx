import { useCallback, useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import { GitBranchIcon, GitMergeIcon, GitPullRequestClosedIcon, GitPullRequestDraftIcon, GitPullRequestIcon, MarkGithubIcon } from '@primer/octicons-react'
import WidgetWrapper from './WidgetWrapper.jsx'
import ResizeHandle from './ResizeHandle.jsx'
import { readProp, linkPreviewSchema } from './widgetProps.js'
import ExpandedPane from './ExpandedPane.jsx'
import { findAllConnectedSplitTargets, buildPaneForWidget, buildSplitLayout } from './expandUtils.js'
import { useExpandOverride } from './useExpandOverride.js'
import { markdownToSafeHtml } from './markdown/markdownSanitize.js'
import styles from './LinkPreview.module.css'

const VIDEO_URL_LINE_RE = /^<p>\s*(https?:\/\/[^\s<]+\.(mp4|mov|webm|ogg)(?:\?[^\s<]*)?)\s*<\/p>$/gim

/**
 * Post-process HTML body for canvas rendering:
 * - Links open in new tabs
 * - Unwrap <details> wrappers around videos (GitHub wraps them)
 * - Convert bare video URLs and video-linked images to <video> elements
 * - Mark checked checkboxes with data attribute for accent styling
 */
function postProcessHtml(html) {
  if (!html) return ''
  let out = html

  // Open all links in new tabs
  out = out.replace(/<a\s/g, '<a target="_blank" rel="noopener noreferrer" ')
  // Dedupe target if GitHub already set it
  out = out.replace(/target="_blank"\s*rel="noopener noreferrer"\s*target="_blank"/g, 'target="_blank"')

  // Unwrap <details><summary>...</summary><video ...></details> → just the <video>
  out = out.replace(/<details[^>]*>\s*<summary[^>]*>[\s\S]*?<\/summary>\s*(<video[\s\S]*?<\/video>)\s*<\/details>/gi, '$1')

  // Force remaining <details> elements open so content is visible
  out = out.replace(/<details(?![^>]*\bopen\b)/gi, '<details open')

  // Convert bare video URLs (wrapped in <p>) into <video> elements
  out = out.replace(VIDEO_URL_LINE_RE, (_, url) =>
    `<video src="${url}" controls preload="none"></video>`
  )

  // Convert img tags pointing at video files to <video>
  out = out.replace(/<img\s+([^>]*?)src="([^"]+\.(mp4|mov|webm|ogg)(?:\?[^"]*)?)"([^>]*)\/?>/gi, (_, _pre, url) =>
    `<video src="${url}" controls preload="none"></video>`
  )

  // Existing <video> tags from GitHub: set preload=none to prevent auto-loading spinner
  out = out.replace(/<video\s/g, '<video preload="none" ')
  // Dedupe if we already added it
  out = out.replace(/preload="none"\s+preload="[^"]*"/g, 'preload="none"')

  // Remove disabled from checkboxes so accent-color works (CSS blocks interaction instead)
  out = out.replace(/<input\s+([^>]*?)disabled([^>]*)>/gi, (match, before, after) => {
    if (!match.includes('type="checkbox"')) return match
    return `<input ${before}${after}>`
  })

  // Mark @mention links with a data attribute for pill styling.
  // GitHub API HTML uses class="user-mention" but remark output won't have it.
  // Match <a ...>@username</a> linking to github.com profiles.
  out = out.replace(/<a\s([^>]*)>(@[a-zA-Z0-9_-]+)<\/a>/g, (match, attrs, text) => {
    if (match.includes('data-mention')) return match
    return `<a ${attrs} data-mention>${text}</a>`
  })

  return out
}

function renderMarkdown(text) {
  if (!text) return ''
  return postProcessHtml(markdownToSafeHtml(text))
}

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return ''
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`
  const years = Math.floor(months / 12)
  return `${years} year${years === 1 ? '' : 's'} ago`
}

/**
 * Split a title like "#42 Ship GitHub embeds" into { number: "#42", rest: "Ship GitHub embeds" }.
 */
function splitIssueTitle(title) {
  if (!title) return { number: '', rest: '' }
  const match = title.match(/^(#\d+)\s+(.*)$/)
  if (match) return { number: match[1], rest: match[2] }
  return { number: '', rest: title }
}

const KIND_LABELS = {
  issue: 'Issue',
  pull_request: 'Pull Request',
  discussion: 'Discussion',
  comment: 'Comment',
}

function getCommentKindLabel(github) {
  if (github?.kind !== 'comment') return KIND_LABELS[github?.kind] || 'GitHub'
  if (github?.parentKind === 'issue') return 'Issue Comment'
  if (github?.parentKind === 'pull_request') return 'PR Comment'
  if (github?.parentKind === 'discussion') return 'Discussion Comment'
  return 'Comment'
}

const PR_STATE_META = {
  merged: { label: 'Merged', Icon: GitMergeIcon, className: 'prStateMerged' },
  closed: { label: 'Closed', Icon: GitPullRequestClosedIcon, className: 'prStateClosed' },
  draft: { label: 'Draft', Icon: GitPullRequestDraftIcon, className: 'prStateDraft' },
  open: { label: 'Open', Icon: GitPullRequestIcon, className: 'prStateOpen' },
}

function PullRequestMeta({ github }) {
  if (github?.kind !== 'pull_request') return null
  const stateKey = github?.state || 'open'
  const stateMeta = PR_STATE_META[stateKey] || PR_STATE_META.open
  const { Icon: StateIcon } = stateMeta
  const baseRef = github?.baseRef || null
  const headRef = github?.headRef || null
  const additions = typeof github?.additions === 'number' ? github.additions : null
  const deletions = typeof github?.deletions === 'number' ? github.deletions : null
  const hasDiff = additions !== null || deletions !== null

  return (
    <div className={styles.prMeta}>
      <span className={`${styles.prStateBadge} ${styles[stateMeta.className]}`}>
        <StateIcon size={12} />
        {stateMeta.label}
      </span>
      {(baseRef || headRef) && (
        <span className={styles.prBranchRef} title={`${headRef || '?'} → ${baseRef || '?'}`}>
          <GitBranchIcon size={12} />
          <span className={styles.prBranchName}>{baseRef || '?'}</span>
          <span className={styles.prBranchArrow}>←</span>
          <span className={styles.prBranchName}>{headRef || '?'}</span>
        </span>
      )}
      {hasDiff && (
        <span className={styles.prDiffStat}>
          {additions !== null && <span className={styles.prDiffAdd}>+{additions}</span>}
          {deletions !== null && <span className={styles.prDiffDel}>-{deletions}</span>}
        </span>
      )}
    </div>
  )
}

function GitHubIssueCard({ id, url, title, github, width, collapsed, expanded, expandMode, onCloseExpand }) {
  const authors = Array.isArray(github?.authors)
    ? github.authors.filter((a) => typeof a === 'string' && a.trim())
    : []
  const primaryAuthor = authors[0] || ''
  const createdAgo = timeAgo(github?.createdAt)
  const { number: issueNumber, rest: titleText } = splitIssueTitle(title)

  const kindLabel = getCommentKindLabel(github)

  // Prefer pre-rendered bodyHtml (has signed image URLs), fall back to remark for discussions
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const bodyHtml = useMemo(() => {
    if (github?.bodyHtml) return postProcessHtml(github.bodyHtml)
    return renderMarkdown(github?.body || '')
  }, [github?.bodyHtml, github?.body])

  // Set body HTML via ref — avoids React destroying/recreating video elements on re-render
  const bodyRef = useRef(null)
  const lastHtmlRef = useRef('')
  useEffect(() => {
    if (bodyRef.current && bodyHtml !== lastHtmlRef.current) {
      bodyRef.current.innerHTML = bodyHtml
      lastHtmlRef.current = bodyHtml
    }
  }, [bodyHtml])

  // Also set on initial mount via callback ref
  const setBodyRef = useCallback((el) => {
    bodyRef.current = el
    if (el && bodyHtml && bodyHtml !== lastHtmlRef.current) {
      el.innerHTML = bodyHtml
      lastHtmlRef.current = bodyHtml
    }
  }, [bodyHtml])

  const sizeStyle = {
    ...(width ? { width: `${width}px` } : {}),
  }

  return (
    <>
    <WidgetWrapper>
      <div className={`${styles.issueCard} ${collapsed ? styles.issueCardCollapsed : ''}`} style={sizeStyle}>
        <div className={styles.typeBar}>
          <MarkGithubIcon size={16} />
          <span>{kindLabel}</span>
        </div>
        <header className={styles.issueHeader}>
          <h2 className={styles.issueTitle}>
            <a
              href={url || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.issueTitleLink}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {titleText || url}
              {issueNumber && <span className={styles.issueNumber}> {issueNumber}</span>}
            </a>
          </h2>
        </header>

        <div className={styles.issueByline}>
          <div className={styles.issueBylineLeft}>
            {primaryAuthor && (
              <a
                href={`https://github.com/${primaryAuthor}`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.authorLink}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <img
                  className={styles.avatar}
                  src={`https://github.com/${primaryAuthor}.png?size=40`}
                  alt=""
                  width="20"
                  height="20"
                  loading="lazy"
                />
                {primaryAuthor}
              </a>
            )}
            <span className={styles.bylineText}>
              {primaryAuthor && createdAgo ? ` opened ${createdAgo}` : createdAgo ? `Opened ${createdAgo}` : ''}
            </span>
          </div>
          <PullRequestMeta github={github} />
        </div>

        {bodyHtml && (
          <div
            className={`${styles.issueBody} ${collapsed ? styles.issueBodyScrollable : ''}`}
            ref={setBodyRef}
          />
        )}
      </div>
    </WidgetWrapper>
    {expanded && (
      <LinkPreviewExpandPane
        widgetId={id}
        label={`${kindLabel}: ${titleText || url || 'GitHub'}`}
        splitMode={expandMode === 'split'}
        onClose={onCloseExpand}
      >
        <div className={styles.expandedIssue}>
          <header className={styles.expandedIssueHeader}>
            <h2 className={styles.expandedIssueTitle}>
              <a href={url || '#'} target="_blank" rel="noopener noreferrer">
                {titleText || url}
                {issueNumber && <span className={styles.expandedIssueNumber}> {issueNumber}</span>}
              </a>
            </h2>
            <div className={styles.expandedByline}>
              {primaryAuthor && (
                <a href={`https://github.com/${primaryAuthor}`} target="_blank" rel="noopener noreferrer" className={styles.expandedAuthor}>
                  <img src={`https://github.com/${primaryAuthor}.png?size=40`} alt="" width="20" height="20" className={styles.avatar} loading="lazy" />
                  {primaryAuthor}
                </a>
              )}
              {createdAgo && <span className={styles.expandedBylineText}>{primaryAuthor ? ` opened ${createdAgo}` : `Opened ${createdAgo}`}</span>}
            </div>
            <PullRequestMeta github={github} />
          </header>
          {bodyHtml && <div className={styles.expandedIssueBody} dangerouslySetInnerHTML={{ __html: bodyHtml }} />}
        </div>
      </LinkPreviewExpandPane>
    )}
    </>
  )
}

export default forwardRef(function LinkPreview({ id, props, onUpdate, resizable }, ref) {
  const url = readProp(props, 'url', linkPreviewSchema)
  const title = readProp(props, 'title', linkPreviewSchema)
  const github = props?.github && typeof props.github === 'object' ? props.github : null

  const width = typeof props?.width === 'number' ? props.width : null
  const height = typeof props?.height === 'number' ? props.height : null

  // All hooks must be called before any early return
  const ogImage = props?.ogImage || null
  const description = props?.description || ''
  const canEdit = typeof onUpdate === 'function'
  const cardRef = useRef(null)
  const inputRef = useRef(null)
  const [editing, setEditing] = useState(false)
  const [expandMode, setExpandMode] = useExpandOverride('link', id)
  const expanded = expandMode !== null

  useImperativeHandle(ref, () => ({
    handleAction(actionId) {
      if (actionId === 'expand' || actionId === 'expand-single') { setExpandMode('single'); return true }
      if (actionId === 'split-screen') { setExpandMode('split'); return true }
      if (actionId === 'open-external') {
        if (url) window.open(url, '_blank', 'noopener')
        return true
      }
      return false
    },
  }), [url])

  const startEditing = useCallback(() => {
    if (!canEdit) return
    setEditing(true)
  }, [canEdit])

  const handleTitleChange = useCallback((e) => {
    onUpdate?.({ title: e.target.value })
  }, [onUpdate])

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  if (github) {
    return (
      <GitHubIssueCard
        id={id}
        url={url}
        title={title}
        github={github}
        width={width}
        collapsed={!!props?.collapsed}
        expanded={expanded}
        expandMode={expandMode}
        onCloseExpand={() => setExpandMode(null)}
      />
    )
  }

  const sizeStyle = (width || height)
    ? { ...(width ? { width: `${width}px` } : {}), ...(height ? { minHeight: `${height}px` } : {}) }
    : undefined

  let hostname = ''
  try { hostname = new URL(url).hostname } catch { /* */ }

  const handleResize = (w, h) => onUpdate?.({ width: w, height: h })

  return (
    <>
    <div className={styles.container}>
      <div ref={cardRef} className={styles.card} style={sizeStyle}>
        {ogImage && (
          <img
            className={styles.ogImage}
            src={ogImage}
            alt=""
            loading="lazy"
            onError={(e) => { e.target.style.display = 'none' }}
          />
        )}
        <div className={styles.body}>
          {editing ? (
            <input
              ref={inputRef}
              className={styles.titleInput}
              data-canvas-allow-text-selection
              type="text"
              value={title}
              onChange={handleTitleChange}
              onBlur={() => setEditing(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape') setEditing(false)
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            />
          ) : (
            <p
              className={styles.title}
              data-canvas-allow-text-selection={!canEdit ? '' : undefined}
              onDoubleClick={startEditing}
              role={canEdit ? 'button' : undefined}
              tabIndex={canEdit ? 0 : undefined}
              onKeyDown={canEdit ? (e) => { if (e.key === 'Enter') startEditing() } : undefined}
            >
              {title || hostname || url || 'Untitled'}
            </p>
          )}
          {description && <p className={styles.description}>{description}</p>}
          <a
            href={url || '#'}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.url}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {hostname || url}
          </a>
        </div>
      </div>
      {resizable && <ResizeHandle targetRef={cardRef} width={width} height={height} onResize={handleResize} />}
    </div>
    {expanded && (
      <LinkPreviewExpandPane
        widgetId={id}
        label={title || hostname || 'Link Preview'}
        splitMode={expandMode === 'split'}
        onClose={() => setExpandMode(null)}
      >
        <div className={styles.expandedLink}>
          {ogImage && <img className={styles.expandedOgImage} src={ogImage} alt="" loading="lazy" />}
          <h2 className={styles.expandedTitle}>{title || hostname || url || 'Untitled'}</h2>
          {description && <p className={styles.expandedDescription}>{description}</p>}
          {url && <a href={url} target="_blank" rel="noopener noreferrer" className={styles.expandedUrl}>{url}</a>}
        </div>
      </LinkPreviewExpandPane>
    )}
    </>
  )
})

/**
 * Builds pane configs and renders ExpandedPane for an expanded link-preview widget.
 */
function LinkPreviewExpandPane({ widgetId, label, splitMode, onClose, children }) {
  const connectedWidgets = useMemo(
    () => splitMode ? findAllConnectedSplitTargets(widgetId) : [],
    [widgetId, splitMode],
  )

  const primaryWidget = useMemo(() => {
    const bridge = window.__storyboardCanvasBridgeState
    return bridge?.widgets?.find((w) => w.id === widgetId) || { id: widgetId, type: 'link-preview', position: { x: 0, y: 0 }, props: {} }
  }, [widgetId])

  const buildPaneFn = useCallback((widget) => {
    if (widget.id === widgetId) {
      return {
        id: widgetId,
        label,
        widgetType: 'link-preview',
        kind: 'react',
        render: () => children,
      }
    }
    return buildPaneForWidget(widget)
  }, [widgetId, label, children])

  const layout = useMemo(
    () => buildSplitLayout(primaryWidget, connectedWidgets, buildPaneFn),
    [primaryWidget, connectedWidgets, buildPaneFn],
  )

  return (
    <ExpandedPane
      initialLayout={layout}
      variant={layout.flat().length <= 1 ? 'modal' : 'full'}
      onClose={onClose}
    />
  )
}
