/**
 * Workspace — SaaS-style homescreen for Storyboard.
 *
 * Sidebar + grid layout wired to real data from buildPrototypeIndex and listStories.
 * Formerly known as Viewfinder — renamed to match the /workspace route.
 */
import { useState, useEffect, useRef, useMemo, useCallback, useSyncExternalStore } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  buildPrototypeIndex,
  listStories,
  getStoryData,
  BranchSelect,
  isCustomerHidingHomepage,
  getConfig,
  isMenuHidden,
  trackRecent,
  subscribeToRecent,
  getRecentSnapshot,
} from '../core/index.js'
import { buildBranchArtifactHref, mergeArtifactIndexIntoPrototypeIndex } from '../core/data/artifactIndex.js'
import { GitBranchIcon, ChevronRightIcon, PlusIcon, StarIcon, StarFillIcon, ThreeBarsIcon, XIcon, StackIcon, TrashIcon, KebabHorizontalIcon, PencilIcon, EyeClosedIcon } from '@primer/octicons-react'
import { Menu } from '@base-ui/react/menu'
import Tooltip from './Tooltip.jsx'
import Icon from './Icon.jsx'
import { useBranches } from './BranchBar/useBranches.js'
import { useArtifactIndex } from './hooks/useArtifactIndex.js'
import BranchesDropdown from './BranchesDropdown/BranchesDropdown.jsx'
import SettingsDialog from './settings/SettingsDialog.jsx'
import NotebookDialog from './NotebookDialog/NotebookDialog.jsx'
import CreateDialog from './CommandPalette/CreateDialog.jsx'
import AgentChatWidget from './canvas/widgets/AgentChatWidget.jsx'
import css from './Viewfinder.module.css'
import { invoke, isTauriAvailable } from '../core/notebook/tauri-bridge.js'
import { coreRequestJson, isBrowserCoreMode, openNotebookPath } from '../core/notebook/browserBridge.js'

/* ─── Theme sync: read toolbar theme from DOM and apply to Primer/BaseUI ─── */

function getToolbarThemeAttrs() {
  const theme = document.documentElement.getAttribute('data-sb-toolbar-theme') || 'light'
  if (theme === 'dark_dimmed') {
    return { 'data-color-mode': 'dark', 'data-dark-theme': 'dark_dimmed', 'data-light-theme': 'light' }
  }
  if (theme.startsWith('dark')) {
    return { 'data-color-mode': 'dark', 'data-dark-theme': 'dark', 'data-light-theme': 'light' }
  }
  return { 'data-color-mode': 'light', 'data-light-theme': 'light', 'data-dark-theme': 'dark' }
}

function useToolbarTheme() {
  const [attrs, setAttrs] = useState(getToolbarThemeAttrs)

  useEffect(() => {
    const update = () => setAttrs(getToolbarThemeAttrs())
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-sb-toolbar-theme'] })
    update()
    return () => observer.disconnect()
  }, [])

  // Sync to document.body so BaseUI portals inherit Primer theme
  useEffect(() => {
    for (const [key, value] of Object.entries(attrs)) {
      document.body.setAttribute(key, value)
    }
  }, [attrs])

  return attrs
}

/* ─── GitHub user hook ─── */

const COMMENTS_USER_KEY = 'sb-comments-user'
const COMMENTS_TOKEN_KEY = 'sb-comments-token'

/**
 * Resolve the current GitHub user for display in the sidebar.
 * Priority: 1) PAT-cached user (from comments auth), 2) gh CLI login via git-user endpoint.
 */
function useGitHubUser() {
  const [user, setUser] = useState(() => {
    try {
      const raw = localStorage.getItem(COMMENTS_USER_KEY)
      const token = localStorage.getItem(COMMENTS_TOKEN_KEY)
      if (token && raw) {
        const parsed = JSON.parse(raw)
        if (parsed?.login) return parsed
      }
    } catch { /* ignore */ }
    return null
  })

  // Listen for auth changes (when user signs in via AuthModal)
  useEffect(() => {
    const handler = () => {
      try {
        const raw = localStorage.getItem(COMMENTS_USER_KEY)
        const token = localStorage.getItem(COMMENTS_TOKEN_KEY)
        if (token && raw) {
          const parsed = JSON.parse(raw)
          if (parsed?.login) { setUser(parsed); return }
        }
        setUser(null)
      } catch { setUser(null) }
    }
    window.addEventListener('storage', handler)
    document.addEventListener('storyboard:auth-changed', handler)
    return () => {
      window.removeEventListener('storage', handler)
      document.removeEventListener('storyboard:auth-changed', handler)
    }
  }, [])

  return user
}

/* ─── localStorage helpers ─── */

const STARRED_KEY = 'sb-workspace-starred'
const GROUP_BY_FOLDERS_KEY = 'sb-workspace-group-folders'
const COLLAPSED_FOLDERS_KEY = 'sb-workspace-collapsed-folders'

function readJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback }
  catch { return fallback }
}

function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
  window.dispatchEvent(new StorageEvent('storage', { key }))
}

function createLocalStorageStore(key, fallback) {
  const subscribe = (cb) => {
    const handler = (e) => { if (!e.key || e.key === key) cb() }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }
  const getSnapshot = () => localStorage.getItem(key) || JSON.stringify(fallback)
  return { subscribe, getSnapshot }
}

const starredStore = createLocalStorageStore(STARRED_KEY, [])

function useStarred() {
  const raw = useSyncExternalStore(starredStore.subscribe, starredStore.getSnapshot)
  const ids = JSON.parse(raw)
  const toggle = useCallback((id) => {
    const current = readJSON(STARRED_KEY, [])
    const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id]
    writeJSON(STARRED_KEY, next)
  }, [])
  return { starred: new Set(ids), toggle }
}

/**
 * Map a recent store entry `{type, key}` to the composite id used by the
 * workspace `itemMap` (`proto:`, `canvas:`, `component:`).
 *
 * The unified recent store uses `'story'` as the canonical type for
 * component/story artifacts (matches `core/stores/paletteProviders.js`),
 * but the workspace's items use `'component'` for the same things.
 */
function recentEntryToItemId(entry) {
  if (!entry || typeof entry.type !== 'string' || typeof entry.key !== 'string') return null
  switch (entry.type) {
    case 'prototype': return `proto:${entry.key}`
    case 'canvas':    return `canvas:${entry.key}`
    case 'story':
    case 'component': return `component:${entry.key}`
    default:          return `${entry.type}:${entry.key}`
  }
}

/**
 * Map a workspace `item.type` value to the canonical type stored in the
 * recent artifacts store. The workspace uses `'component'` for stories
 * but the recent store (shared with the command palette) uses `'story'`.
 */
function itemTypeToRecentType(itemType) {
  if (itemType === 'component') return 'story'
  return itemType
}

function useRecent() {
  const raw = useSyncExternalStore(subscribeToRecent, getRecentSnapshot)
  return useMemo(() => {
    try {
      const entries = JSON.parse(raw)
      if (!Array.isArray(entries)) return []
      const ids = []
      for (const entry of entries) {
        const id = recentEntryToItemId(entry)
        if (id) ids.push(id)
      }
      return ids
    } catch {
      return []
    }
  }, [raw])
}

function trackRecentItem(item) {
  if (!item || !item.id) return
  const colonIdx = item.id.indexOf(':')
  if (colonIdx <= 0) return
  const key = item.id.slice(colonIdx + 1)
  const type = itemTypeToRecentType(item.type)
  if (!type) return
  trackRecent(type, key, item.name || key)
}

/* ─── URL helpers ─── */

function withBase(basePath, route) {
  const normalizedRoute = route.startsWith('/') ? route : `/${route}`
  const normalizedBase = (basePath || '/').replace(/\/+$/, '')
  if (!normalizedBase || normalizedBase === '/') return normalizedRoute
  return `${normalizedBase}${normalizedRoute}`.replace(/\/+/g, '/')
}

/* ─── Type helpers ─── */

function getTypeLabel(type) {
  if (type === 'prototype') return 'PROTOTYPE'
  if (type === 'canvas') return 'CANVAS'
  if (type === 'component') return 'COMPONENT'
  if (type === 'site') return 'SITE'
  return type?.toUpperCase() || ''
}

function getTypeIcon(type, size = 14) {
  if (type === 'prototype') return <Icon name="prototype" size={size} />
  if (type === 'canvas') return <Icon name="canvas" size={size} />
  if (type === 'component') return <Icon name="iconoir/keyframe" size={size} />
  if (type === 'site') return <Icon name="iconoir/globe" size={size} />
  return null
}

/* ─── Avatar Stack ─── */

function AvatarStack({ authors }) {
  if (!authors || authors.length === 0) return null
  const list = Array.isArray(authors) ? authors : [authors]
  return (
    <div className={css.avatarStack}>
      {list.map(username => (
        <img
          key={username}
          className={css.avatarImg}
          src={`https://github.com/${username}.png?size=48`}
          alt={username}
          width={24}
          height={24}
          loading="lazy"
          onError={(e) => { e.target.style.display = 'none' }}
        />
      ))}
    </div>
  )
}

/* ─── Star Button ─── */

function StarBtn({ active, onClick, inline }) {
  const cls = inline
    ? (active ? css.iconBtnInlineActive : css.iconBtnInline)
    : (active ? css.iconBtnActive : css.iconBtn)
  return (
    <button
      className={cls}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick() }}
      aria-label={active ? 'Remove favorite' : 'Favorite'}
      title={active ? 'Remove favorite' : 'Favorite'}
    >
      {active ? <StarFillIcon size={16} /> : <StarIcon size={16} />}
    </button>
  )
}

/* ─── Card Actions Menu ─── */

function CardActionsMenu({ typeLabel, onEdit, onDelete }) {
  return (
    <Menu.Root>
      <Menu.Trigger
        className={css.iconBtn}
        onClick={(e) => { e.preventDefault(); e.stopPropagation() }}
        aria-label="Actions"
        render={<button />}
      >
        <KebabHorizontalIcon size={16} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className={css.actionsMenuPositioner} side="inline-end" alignment="end" sideOffset={8}>
          <Menu.Popup className={css.actionsMenu} onClick={(e) => { e.preventDefault(); e.stopPropagation() }}>
            <Menu.Item
              className={css.actionsMenuItem}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit() }}
              render={<button />}
            >
              <PencilIcon size={16} />
              Edit {typeLabel}
            </Menu.Item>
            <Menu.Item
              className={css.actionsMenuItemDanger}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete() }}
              render={<button />}
            >
              <TrashIcon size={16} />
              Delete {typeLabel}
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

/* ─── Edit Artifact Modal ─── */

function EditArtifactModal({ item, dirName, basePath, onClose }) {
  const [name, setName] = useState(item.name || '')
  const [description, setDescription] = useState(item.description || '')
  const [author, setAuthor] = useState(
    item.author
      ? (Array.isArray(item.author) ? item.author.join(', ') : item.author)
      : ''
  )
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const overlayRef = useRef(null)

  const typeLabel = item.type === 'canvas' ? 'Canvas' : item.type === 'prototype' ? 'Prototype' : 'Component'

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)

    const apiBase = (basePath || '/').replace(/\/+$/, '')
    let endpoint
    let method = 'PATCH'

    endpoint = `${apiBase}/_storyboard/artifact/`

    const body = {
      type: item.type,
      name: dirName,
      title: name.trim(),
      description: description.trim(),
      author: author.trim(),
    }
    if (item.folder) body.folder = item.folder

    try {
      const res = await fetch(endpoint, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `Request failed (${res.status})`)
      }
      window.location.reload()
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <div className={css.modalOverlay} onClick={(e) => { if (e.target === overlayRef.current) onClose() }} ref={overlayRef}>
      <div className={css.modalContent} onClick={(e) => e.stopPropagation()}>
        <form onSubmit={handleSubmit}>
          <div className={css.createFormHeader}>
            <div className={css.createMenuTitle}>Edit {typeLabel}</div>
            <button type="button" className={css.createFormClose} onClick={onClose} aria-label="Close">
              <XIcon size={16} />
            </button>
          </div>

          <div className={css.createFormField}>
            <label className={css.createFormLabel}>Name</label>
            <input
              className={css.createFormInput}
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className={css.createFormField}>
            <label className={css.createFormLabel}>Description</label>
            <input
              className={css.createFormInput}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>

          <div className={css.createFormField}>
            <label className={css.createFormLabel}>Author</label>
            <input
              className={css.createFormInput}
              value={author}
              onChange={e => setAuthor(e.target.value)}
              placeholder="GitHub username(s), comma-separated"
            />
          </div>

          {error && <div className={css.createFormError}>{error}</div>}

          <div className={css.modalActions}>
            <button type="button" className={css.modalCancelBtn} onClick={onClose}>Cancel</button>
            <button type="submit" className={css.modalSubmitBtn} disabled={submitting}>
              {submitting ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ─── Delete Artifact Modal ─── */

function DeleteArtifactModal({ item, dirName, basePath, typeLabel, onClose, onDeleted }) {
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const overlayRef = useRef(null)

  const handleDelete = async () => {
    setError('')
    setDeleting(true)

    const apiBase = (basePath || '/').replace(/\/+$/, '')
    const endpoint = `${apiBase}/_storyboard/artifact/`

    const body = { type: item.type, name: dirName }
    if (item.folder) body.folder = item.folder

    try {
      const res = await fetch(endpoint, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `Request failed (${res.status})`)
      }
      onDeleted?.()
      if (item.type === 'site') document.dispatchEvent(new CustomEvent('storyboard:sites-changed'))
      onClose()
    } catch (err) {
      setError(err.message)
      setDeleting(false)
    }
  }

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <div className={css.modalOverlay} onClick={(e) => { if (e.target === overlayRef.current) onClose() }} ref={overlayRef}>
      <div className={css.modalContent} onClick={(e) => e.stopPropagation()}>
        <div className={css.createFormHeader}>
          <div className={css.createMenuTitle}>Delete {typeLabel}</div>
          <button type="button" className={css.createFormClose} onClick={onClose} aria-label="Close">
            <XIcon size={16} />
          </button>
        </div>

        <p className={css.deleteMessage}>
          Are you sure you want to delete <strong>{item.name}</strong>? This action cannot be undone.
        </p>

        {error && <div className={css.createFormError}>{error}</div>}

        <div className={css.modalActions}>
          <button type="button" className={css.modalCancelBtn} onClick={onClose}>Cancel</button>
          <button
            type="button"
            className={css.deleteConfirmBtn}
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? 'Deleting…' : `Delete ${typeLabel}`}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Artifact Card ─── */

function ArtifactCard({ item, basePath, branchBasePath, currentBranch, starred, onToggleStar, onItemDeleted }) {
  const isBranchOnly = !!item.isBranchOnly
  const isExternal = item.isExternal
  const branchOnlyHref = isBranchOnly
    ? isExternal
      ? item.externalUrl
      : buildBranchArtifactHref(branchBasePath || basePath, item.homeBranch?.folder, item.homeBranch?.route || item.route)
    : null
  const href = item.route ? withBase(basePath, item.route) : '#'

  const handleClick = () => {
    if (!isBranchOnly) trackRecentItem(item)
  }

  const Tag = 'a'
  const linkProps = isBranchOnly
    ? { href: branchOnlyHref || '#', target: '_blank', rel: 'noopener noreferrer' }
    : isExternal
      ? { href: item.externalUrl, target: '_blank', rel: 'noopener noreferrer' }
      : { href }

  const authorList = item.author
    ? (Array.isArray(item.author) ? item.author : [item.author])
    : item.gitAuthor ? [item.gitAuthor] : []

  const [showEdit, setShowEdit] = useState(false)
  const [showDelete, setShowDelete] = useState(false)

  // Extract dirName from item.id (format: "type:dirName")
  const dirName = item.id.split(':').slice(1).join(':')
  const typeLabel = item.type === 'canvas' ? 'Canvas' : item.type === 'prototype' ? 'Prototype' : item.type === 'site' ? 'Site' : 'Component'
  const canEditDelete = !isBranchOnly && (item.type === 'canvas' || item.type === 'prototype')
  // Cards intentionally look identical regardless of `isBranchOnly`. The
  // only marker that a prototype lives on another branch is now the
  // subtle blue tint on the BranchesDropdown button (see below). The
  // previous full-card .branchOnlyCard background drew the eye too
  // strongly for what is effectively a "hint, not a blocker" state.
  const cardClass = `${css.card}${item.isPrivate ? ' ' + css.cardPrivate : ''}`

  return (
    <>
      <Tag className={cardClass} {...linkProps} onClick={handleClick}>
        <div className={css.cardHeader}>
          <div className={css.cardBadgeGroup}>
            <span className={css.cardBadge}>{getTypeLabel(item.type)}</span>
            {item.isPrivate && !isBranchOnly && (
              <Tooltip text={`${typeLabel} not published, only visible to you`} direction="n">
                <button
                  type="button"
                  className={css.cardPrivateBadge}
                  aria-label={`Private ${typeLabel.toLowerCase()}`}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation() }}
                >
                  <EyeClosedIcon size={12} />
                </button>
              </Tooltip>
            )}
          </div>
          <div className={css.cardActions}>
            {!isBranchOnly && <StarBtn active={starred} onClick={() => onToggleStar(item.id)} inline />}
            {!isBranchOnly && item.flows?.length > 1 && <FlowsDropdown flows={item.flows} basePath={basePath} />}
            {!isBranchOnly && item.pages?.length > 1 && <PagesDropdown pages={item.pages} basePath={basePath} />}
            <BranchesDropdown
              branches={item.branches || []}
              branchBasePath={branchBasePath}
              currentBranch={currentBranch}
              homeTitle={item.name}
              homeFolder={item.folder}
              isBranchOnly={isBranchOnly}
            />
            {canEditDelete && (
              <CardActionsMenu
                typeLabel={typeLabel}
                onEdit={() => setShowEdit(true)}
                onDelete={() => setShowDelete(true)}
              />
            )}
            {item.type === 'site' && <button type="button" className={css.iconBtn} aria-label={`Edit ${item.name}`} onClick={event => {
              event.preventDefault()
              event.stopPropagation()
              const siteId = item.id.replace(/^site:/, '')
              window.location.href = withBase(basePath, `/sites/${encodeURIComponent(siteId)}/?edit=true`)
            }}><PencilIcon size={16} /></button>}
            {item.type === 'site' && <button type="button" className={css.iconBtn} aria-label={`Remove ${item.name}`} title="Remove Site" onClick={event => {
              event.preventDefault()
              event.stopPropagation()
              setShowDelete(true)
            }}><TrashIcon size={16} /></button>}
          </div>
        </div>
        <div className={css.cardBody}>
          <div className={css.cardBodyContent}>
            <div className={css.cardTitleRow}>
              <div className={css.cardTitle}>
                {item.name}
                {isExternal && <span className={css.externalBadge}>↗</span>}
              </div>
            </div>
            {item.description && (
              <div className={css.cardDescription}>{item.description}</div>
            )}
            <div className={css.cardFooter}>
              <AvatarStack authors={authorList} />
              <div className={css.cardMeta}>
                {authorList.length > 0 && <span>{authorList.join(', ')}</span>}
                {authorList.length > 0 && formatRelativeTime(item.lastModified) && <span className={css.cardMetaDot} />}
                {formatRelativeTime(item.lastModified) && <span>{formatRelativeTime(item.lastModified)}</span>}
                {item.type === 'site' && <span className={item.missing ? css.siteStatusMissing : css.siteStatus}>{item.missing ? 'Folder missing' : item.binding?.status || 'Stopped'}</span>}
              </div>
            </div>
          </div>
        </div>
      </Tag>
      {showEdit && !isBranchOnly && (
        <EditArtifactModal
          item={item}
          dirName={dirName}
          basePath={basePath}
          onClose={() => setShowEdit(false)}
        />
      )}
      {showDelete && !isBranchOnly && (
        <DeleteArtifactModal
          item={item}
          dirName={dirName}
          basePath={basePath}
          typeLabel={typeLabel}
          onClose={() => setShowDelete(false)}
          onDeleted={() => onItemDeleted?.(item.id)}
        />
      )}
    </>
  )
}

function formatRelativeTime(dateStr) {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return ''
  const now = Date.now()
  const diff = now - date.getTime()
  if (diff < 0) return ''
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return date.toLocaleDateString()
}

/* ─── Flows Dropdown ─── */

function FlowsDropdown({ flows, basePath }) {
  if (!flows || flows.length === 0) return null
  return (
    <Menu.Root>
      <Menu.Trigger
        className={css.iconBtn}
        onClick={(e) => { e.preventDefault(); e.stopPropagation() }}
        aria-label="See flows"
        title="See flows"
      >
        <Icon name="flow" size={16} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className={css.flowsPositioner} side="bottom" align="end" sideOffset={4}>
          <Menu.Popup className={css.flowsPopup}>
            <div className={css.flowsTitle}>Flows</div>
            {flows.map(flow => (
              <Menu.Item
                key={flow.key}
                className={css.flowsItem}
              >
                <a
                  href={withBase(basePath, flow.route)}
                  className={css.flowsItemLink}
                >
                  {flow.meta?.title || flow.name}
                </a>
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

/* ─── Pages Dropdown ─── */

function PagesDropdown({ pages, basePath }) {
  if (!pages || pages.length < 2) return null
  return (
    <Menu.Root>
      <Menu.Trigger
        className={css.iconBtn}
        onClick={(e) => { e.preventDefault(); e.stopPropagation() }}
        aria-label="See pages"
        title="See pages"
      >
        <StackIcon size={16} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className={css.flowsPositioner} side="bottom" align="end" sideOffset={4}>
          <Menu.Popup className={css.flowsPopup}>
            <div className={css.flowsTitle}>Pages</div>
            {pages.map(page => (
              <Menu.Item
                key={page.route}
                className={css.flowsItem}
              >
                <a
                  href={withBase(basePath, page.route)}
                  className={css.flowsItemLink}
                  title={page.isPrivate ? 'Local-only page — gitignored, dev-only' : undefined}
                >
                  {page.name}
                  {page.isPrivate && (
                    <EyeClosedIcon size={12} className={css.flowsItemPrivateIcon} />
                  )}
                </a>
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

/* ─── Folder Section ─── */

function FolderSection({ folder, collapsed, onToggle, basePath, branchBasePath, currentBranch, starred, onToggleStar, onItemDeleted }) {
  const sectionClass = collapsed ? css.folderSectionCollapsed : css.folderSection
  return (
    <section className={`${sectionClass}${folder.isPrivate ? ' ' + css.folderSectionPrivate : ''}`}>
      <div
        className={css.folderHeader}
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}
      >
        <Icon name={collapsed ? 'folder' : 'folder-open'} size={16} className={css.folderIcon} />
        <span className={css.folderName}>{folder.name}</span>
        {folder.isPrivate && (
          <Tooltip text="Folder not published, only visible to you" direction="n">
            <button
              type="button"
              className={css.folderPrivateBadge}
              aria-label="Private folder"
              onClick={(e) => { e.preventDefault(); e.stopPropagation() }}
            >
              <EyeClosedIcon size={12} />
            </button>
          </Tooltip>
        )}
        <span className={css.folderCount}>{folder.items.length}</span>
        <ChevronRightIcon
          size={14}
          className={collapsed ? css.folderChevron : css.folderChevronExpanded}
        />
      </div>
      {!collapsed && (
        <div className={css.grid}>
          {folder.items.map(item => (
            <ArtifactCard
              key={item.id}
              item={item}
              basePath={basePath}
              branchBasePath={branchBasePath}
              currentBranch={currentBranch}
              starred={starred.has(item.id)}
              onToggleStar={onToggleStar}
              onItemDeleted={onItemDeleted}
            />
          ))}
        </div>
      )}
    </section>
  )
}

/* ─── Create Footer ─── */

function CreateTip() {
  return (
    <div className={css.createTip}>
      <span className={css.createTipText}>
        Tip: You can ask your AI assistant to create any of these artifacts: <code className={css.createTipCode}>Create a prototype</code>, <code className={css.createTipCode}>Create a canvas</code>, etc
      </span>
    </div>
  )
}
/* ─── Create Form ─── */

function slugify(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9\s_-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .toLowerCase()
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function CreateForm({ type, onClose, basePath }) {
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [author, setAuthor] = useState('')
  const [url, setUrl] = useState('')
  const [isExternal, setIsExternal] = useState(false)
  const [prototype, setPrototype] = useState('')
  const [prototypes, setPrototypes] = useState([])
  const [partial, setPartial] = useState('')
  const [partials, setPartials] = useState([])
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const needsPrototype = type === 'Flow' || type === 'Page'
  const showPartials = type === 'Prototype' && !isExternal
  // Types that expose a Title field derive their Name from a slug of the
  // Title; Component/Page have no Title so Name stays the primary field.
  const hasTitle = type !== 'Component' && type !== 'Page'

  // Prefill author from the currently authed gh user (login preferred, then
  // git user.name), mirroring the CLI `create` behavior.
  useEffect(() => {
    const apiBase = (basePath || '/').replace(/\/+$/, '')
    fetch(`${apiBase}/_storyboard/git-user`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const resolved = data?.login || data?.name
        if (resolved) setAuthor(resolved)
      })
      .catch(() => {})
  }, [basePath])

  useEffect(() => {
    if (!needsPrototype) return
    const apiBase = (basePath || '/').replace(/\/+$/, '')
    fetch(`${apiBase}/_storyboard/artifact/list?type=prototype`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.items) setPrototypes(data.items.map(p => ({ name: p.name })))
      })
      .catch(() => {})
  }, [needsPrototype, basePath])

  useEffect(() => {
    if (type !== 'Prototype') return
    const apiBase = (basePath || '/').replace(/\/+$/, '')
    fetch(`${apiBase}/_storyboard/workshop/prototypes`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.partials) setPartials(data.partials) })
      .catch(() => {})
  }, [type, basePath])

  // When the user finishes editing Title, auto-fill Name with a slug of the
  // Title — unless they've already typed their own Name.
  const handleTitleBlur = () => {
    if (nameTouched) return
    const slug = slugify(title)
    if (slug) setName(slug)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required'); return }
    if (needsPrototype && !prototype) { setError('Select a prototype'); return }
    setError('')
    setSubmitting(true)

    const apiBase = (basePath || '/').replace(/\/+$/, '')
    const endpoint = `${apiBase}/_storyboard/artifact/`

    // Map UI type to API type
    const typeMap = { Canvas: 'canvas', Prototype: 'prototype', Component: 'component', Flow: 'flow', Page: 'page', Object: 'object', Record: 'record' }
    const apiType = typeMap[type]

    // Build payload
    const payload = { type: apiType, name: name.trim() }
    if (title.trim()) payload.title = title.trim()
    if (description.trim()) payload.description = description.trim()
    if (hasTitle && author.trim()) payload.author = author.trim()
    if (needsPrototype && prototype) payload.prototype = prototype
    if (type === 'Prototype' && isExternal && url.trim()) payload.url = url.trim()
    if (type === 'Prototype' && !isExternal && partial) payload.partial = partial
    if (type === 'Page') payload.path = name.trim()

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || `Request failed (${res.status})`)
      }
      const data = await res.json().catch(() => ({}))
      const route = data.route || data.path || `/${name.trim()}`
      window.location.href = withBase(basePath, route)
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  const typeLabels = { Canvas: 'Canvas', Prototype: 'Prototype', Component: 'Component', Flow: 'Prototype Flow', Page: 'Prototype Page', Object: 'Object', Record: 'Record' }

  const nameField = (
    <div className={css.createFormField}>
      <label className={css.createFormLabel}>Name *</label>
      <input
        className={css.createFormInput}
        value={name}
        onChange={e => { setName(e.target.value); setNameTouched(true) }}
        placeholder={type === 'Page' ? 'my-page' : `my-${type.toLowerCase()}`}
        autoFocus={!needsPrototype && !hasTitle}
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  )

  return (
    <form onSubmit={handleSubmit}>
      <div className={css.createFormHeader}>
        <div className={css.createMenuTitle}>New {typeLabels[type] || type}</div>
        <button type="button" className={css.createFormClose} onClick={onClose} aria-label="Close">
          <XIcon size={16} />
        </button>
      </div>

      {needsPrototype && (
        <div className={css.createFormField}>
          <label className={css.createFormLabel}>Prototype *</label>
          <select
            className={css.createFormInput}
            value={prototype}
            onChange={e => setPrototype(e.target.value)}
          >
            <option value="">Select a prototype…</option>
            {prototypes.map(p => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
        </div>
      )}

      {hasTitle ? (
        <>
          <div className={css.createFormField}>
            <label className={css.createFormLabel}>Title</label>
            <input
              className={css.createFormInput}
              value={title}
              onChange={e => setTitle(e.target.value)}
              onBlur={handleTitleBlur}
              placeholder="Optional display title"
              autoFocus={!needsPrototype}
            />
          </div>
          {nameField}
          <div className={css.createFormField}>
            <label className={css.createFormLabel}>Description</label>
            <input
              className={css.createFormInput}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>
        </>
      ) : (
        nameField
      )}

      {type === 'Prototype' && (
        <>
          <div className={css.createFormField}>
            <label className={css.createFormCheckbox}>
              <input
                type="checkbox"
                checked={isExternal}
                onChange={e => setIsExternal(e.target.checked)}
              />
              External prototype
            </label>
          </div>
          {isExternal && (
            <div className={css.createFormField}>
              <label className={css.createFormLabel}>URL</label>
              <input
                className={css.createFormInput}
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://example.com"
              />
            </div>
          )}
          {showPartials && partials.length > 0 && (
            <div className={css.createFormField}>
              <label className={css.createFormLabel}>Template / Recipe</label>
              <select
                className={css.createFormInput}
                value={partial}
                onChange={e => setPartial(e.target.value)}
              >
                <option value="">Blank prototype</option>
                {Object.entries(partials.reduce((acc, p) => {
                  const kindLabel = p.kind === 'recipe' ? 'Recipes' : 'Templates'
                  const group = p.scope === 'global'
                    ? kindLabel
                    : `${p.folder ? p.folder + ' / ' : ''}${p.prototype || 'local'} / ${kindLabel}`
                  ;(acc[group] = acc[group] || []).push(p)
                  return acc
                }, {})).map(([group, opts]) => (
                  <optgroup key={group} label={group}>
                    {opts.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
          )}
        </>
      )}

      {error && <div className={css.createFormError}>{error}</div>}

      <div className={css.createFormActions}>
        <button type="submit" className={css.createFormSubmit} disabled={submitting}>
          {submitting ? 'Creating…' : `Create ${typeLabels[type] || type}`}
        </button>
      </div>
    </form>
  )
}

/* ─── Create Menu (Dropdown) ─── */

export function CreateMenu({ onClose, onCreate, basePath }) {
  void basePath

  // Each menu item is enabled by default; a workshop.features.create<X> flag
  // can opt it out per consumer. Preserves current behavior when no flags are
  // set, and lets a consumer hide individual artifact types by adding e.g.
  //   { "workshop": { "features": { "createComponent": false } } }
  // to their storyboard.config.json.
  const features = getConfig('workshop')?.features || {}
  const isEnabled = (flag) => features[flag] !== false

  const items = [
    { icon: <Icon name="canvas" size={18} />, title: 'Canvas', desc: 'Interactive board for prototypes, components, and documents', flag: 'createCanvas' },
    { icon: <Icon name="prototype" size={18} />, title: 'Prototype', desc: 'Interactive page flow', flag: 'createPrototype' },
    { icon: <Icon name="iconoir/globe" size={18} />, title: 'Site', desc: 'Local development project', flag: 'createSite' },
  ].filter(it => isEnabled(it.flag))

  if (!isTauriAvailable() && !isBrowserCoreMode()) return null

  return (
    <>
      <div className={css.createDropdownTitle}>Create new artifact</div>
      <div className={css.createDropdownGrid}>
        {items.map(it => (
          <button key={it.title} className={css.createMenuItem} onClick={() => {
            onClose?.()
            if (onCreate) onCreate(it.title)
            else document.dispatchEvent(new CustomEvent('storyboard:create-artifact', { detail: { type: it.title } }))
          }}>
            <div className={css.createMenuIcon}>{it.icon}</div>
            <div>
              <div className={css.createMenuItemTitle}>{it.title}</div>
              <div className={css.createMenuItemDesc}>{it.desc}</div>
            </div>
          </button>
        ))}
      </div>

      <CreateTip />
    </>
  )
}

/* ─── PAT Dialog ─── */

/* ─── Nav config ─── */

const NAV_ITEMS = [
  { id: 'all', label: 'All artifacts', iconName: 'iconoir/view-grid' },
  { id: 'prototypes', label: 'Prototypes', iconName: 'prototype' },
  { id: 'canvases', label: 'Canvas', iconName: 'canvas' },
  { id: 'components', label: 'Components', iconName: 'component' },
  { id: 'sites', label: 'Sites', iconName: 'iconoir/globe' },
]

const TAB_FILTERS = ['All', 'Recent', 'Starred']
const TYPE_MAP = { prototypes: 'prototype', canvases: 'canvas', components: 'component', sites: 'site' }

/* ─── Branch Navigation ─── */

function BranchNav({ basePath }) {
  const isLocalDev = typeof window !== 'undefined' && window.__SB_LOCAL_DEV__ === true
  const { branches, currentBranch, branchBasePath } = useBranches(basePath)
  const [switching, setSwitching] = useState(null)

  // Branch switcher is meaningful only in deployed environments where users
  // need to jump between branch deploys. In local dev each worktree is its own
  // process; switching is handled via `sb dev` / `sb code`.
  if (isLocalDev) return null
  if (!branches || branches.length === 0) return null

  // Ensure `main` is always present and sorted first. CI's `branches.json`
  // historically lists only `branch--*/` folders, so `main` is missing on
  // prod deploys — without this the <select> falls back to its first option
  // (often something like `0.5.0-fix-…`) when the user is actually on main.
  const branchNames = [
    'main',
    ...branches
      .map(b => b.branch)
      .filter(b => b && b !== 'main')
      .sort((a, b) => a.localeCompare(b)),
  ]

  const navigate = async (branch) => {
    if (switching) return
    const target = branches.find(b => b.branch === branch)
    const folder = target?.folder || (branch === 'main' ? '' : `branch--${branch}/`)
    const directUrl = `${branchBasePath}${folder}`

    if (!isLocalDev) {
      window.location.href = directUrl
      return
    }

    // Local dev: ask server to spin up the branch, then navigate
    setSwitching(branch)
    const apiBase = (basePath || '/').replace(/\/$/, '')
    try {
      const res = await fetch(`${apiBase}/_storyboard/switch-branch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch }),
      })
      const data = await res.json()
      window.location.href = (res.ok && data.url) ? data.url : directUrl
    } catch {
      window.location.href = directUrl
    }
  }

  return (
    <>
      <div className={css.branchNav}>
        <GitBranchIcon size={14} />
        <BranchSelect
          branches={branchNames}
          value={currentBranch}
          onChange={(e) => navigate(e.target.value)}
          disabled={!!switching}
        />
      </div>
      {switching && <div className={css.switchOverlay}>
        <div className={css.switchSpinner} />
        <span>Starting {switching}…</span>
      </div>}
    </>
  )
}

/* ─── Main Component ─── */

function WorkspaceImpl({
  pageModules = {},
  basePath,
  title = 'Storyboard',
  subtitle,
  logo,
  logoIcon = 'iconoir/key-command',
  showAllArtifacts = false,
  showPrototypes = true,
  showCanvases = true,
  showComponents = true,
  showSites = true,
}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const panel = searchParams.get('panel') || ''
  const settingsOpen = panel === 'settings'
  const notebooksOpen = panel === 'notebooks'
  const updateRouteParams = useCallback((updates, { replace = false } = {}) => {
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(updates)) {
      if (value == null || value === '') next.delete(key)
      else next.set(key, String(value))
    }
    setSearchParams(next, { replace })
  }, [searchParams, setSearchParams])
  const themeAttrs = useToolbarTheme()
  const ghUser = useGitHubUser(basePath)
  const { currentBranch, branchBasePath } = useBranches(basePath)
  const { artifactIndex } = useArtifactIndex(basePath)
  const [notebookOpen, setNotebookOpen] = useState(false)
  const [pendingRemoveNotebook, setPendingRemoveNotebook] = useState(null)
  const [notebooks, setNotebooks] = useState([])
  const [currentNotebook, setCurrentNotebook] = useState('Notebook')
  const [notebookError, setNotebookError] = useState(null)
  const [openingNotebookPath, setOpeningNotebookPath] = useState(null)
  const [sites, setSites] = useState([])
  const browserCoreMode = isBrowserCoreMode()
  const notebookUiEnabled = browserCoreMode || isTauriAvailable()

  useEffect(() => {
    let cancelled = false
    const refresh = () => fetch(withBase(basePath, '/_storyboard/site/list'))
      .then(response => response.ok ? response.json() : null)
      .then(data => { if (!cancelled) setSites(Array.isArray(data?.sites) ? data.sites : []) })
      .catch(() => {})
    refresh()
    document.addEventListener('storyboard:sites-changed', refresh)
    return () => {
      cancelled = true
      document.removeEventListener('storyboard:sites-changed', refresh)
    }
  }, [basePath])

  useEffect(() => {
    let cancelled = false
    if (!browserCoreMode && !isTauriAvailable()) return undefined
    const refreshNotebookState = async () => {
      try {
        if (browserCoreMode) {
          const [recent, status] = await Promise.all([
            coreRequestJson('/_storyboard/notebook-runtime/recent', { cache: 'no-store' }),
            coreRequestJson('/_storyboard/notebook-runtime/status', { cache: 'no-store' }),
          ])
          if (cancelled) return
          const entries = Array.isArray(recent?.notebooks) ? recent.notebooks : []
          setNotebooks(entries.filter(entry => typeof entry?.root === 'string').map(entry => ({
            name: entry.title || String(entry.root).split(/[\\/]/).filter(Boolean).pop() || 'Notebook',
            path: entry.root,
            available: entry.available !== false,
            lastOpened: entry.lastOpened || null,
          })))
          const root = status?.root
          const name = status?.notebook?.manifest?.title
            || (root ? String(root).split(/[\\/]/).filter(Boolean).pop() : null)
          if (name) setCurrentNotebook(name)
          else if (!status?.active) setCurrentNotebook('Choose a notebook')
          setNotebookError(null)
          return
        }
        const saved = await invoke('list_notebooks')
        if (!cancelled && Array.isArray(saved)) setNotebooks(saved)
        const response = await fetch(withBase(basePath, '/_storyboard/notebook-runtime/status'))
        const status = response.ok ? await response.json() : null
        if (cancelled) return
        const root = status?.root
        const name = status?.notebook?.manifest?.title
          || (root ? String(root).split(/[\\/]/).filter(Boolean).pop() : null)
        if (name) setCurrentNotebook(name)
      } catch (failure) {
        if (!cancelled) setNotebookError(failure?.message || 'Could not load recent notebooks from Core.')
      }
    }
    refreshNotebookState()
    const timer = browserCoreMode ? setInterval(refreshNotebookState, 5000) : null
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [basePath, browserCoreMode])

  useEffect(() => {
    const opened = event => {
      const root = event.detail?.root
      if (!root || !isTauriAvailable()) return
      const name = event.detail?.notebook?.manifest?.title
        || String(root).split(/[\\/]/).filter(Boolean).pop()
        || 'Notebook'
      invoke('remember_notebook', { name, path: root }).then(setNotebooks).catch(() => {})
      setCurrentNotebook(name)
      updateRouteParams({ panel: null })
    }
    window.addEventListener('storyboard:notebook-opened', opened)
    return () => window.removeEventListener('storyboard:notebook-opened', opened)
  }, [updateRouteParams])

  function switchNotebook(notebook) {
    if (!notebook?.path || notebook.available === false) return
    updateRouteParams({ panel: null })
    setNotebookError(null)
    setOpeningNotebookPath(notebook.path)
    const opener = browserCoreMode ? openNotebookPath(notebook.path) : globalThis.__STORYBOARD_OPEN_NOTEBOOK__?.(notebook.path)
    Promise.resolve(opener)
      .catch(failure => setNotebookError(failure?.message || 'The notebook could not be opened.'))
      .finally(() => setOpeningNotebookPath(null))
  }

  function removeNotebook(notebook) {
    if (!notebook?.path) { setPendingRemoveNotebook(null); return }
    if (!isTauriAvailable()) { setPendingRemoveNotebook(null); return }
    invoke('remove_notebook', { path: notebook.path })
      .then(saved => {
        if (Array.isArray(saved)) setNotebooks(saved)
        setPendingRemoveNotebook(null)
      })
      .catch(() => {
        setPendingRemoveNotebook(null)
      })
  }

  function closeNotebooks() {
    setPendingRemoveNotebook(null)
    updateRouteParams({ panel: null })
  }

  useEffect(() => {
    const open = () => updateRouteParams({ panel: 'settings' })
    document.addEventListener('storyboard:open-settings', open)
    return () => document.removeEventListener('storyboard:open-settings', open)
  }, [updateRouteParams])

  const handleRemoveToken = useCallback(() => {
    try {
      localStorage.removeItem(COMMENTS_TOKEN_KEY)
      localStorage.removeItem(COMMENTS_USER_KEY)
    } catch { /* ignore */ }
    document.dispatchEvent(new CustomEvent('storyboard:auth-changed'))
    updateRouteParams({ panel: null })
  }, [updateRouteParams])

  // Re-render when the canvas/story HMR index changes (add/remove on disk).
  // The data-plugin dispatches these events after live-patching the virtual
  // module so the Viewfinder list stays in sync without a full page reload.
  const [canvasIndexTick, setCanvasIndexTick] = useState(0)
  useEffect(() => {
    const bump = () => setCanvasIndexTick(t => t + 1)
    document.addEventListener('storyboard:canvas-index-changed', bump)
    document.addEventListener('storyboard:story-index-changed', bump)
    return () => {
      document.removeEventListener('storyboard:canvas-index-changed', bump)
      document.removeEventListener('storyboard:story-index-changed', bump)
    }
  }, [])

  // Build data index from real prototype/canvas/story data
  const knownRoutes = useMemo(() =>
    Object.keys(pageModules)
      .map(p => p.replace('/src/prototypes/', '').replace('.jsx', ''))
      .filter(n => !n.startsWith('_') && n !== 'index' && n !== 'workspace' && n !== 'viewfinder' && n !== 'create'),
    [pageModules],
  )

  // canvasIndexTick is an intentional re-render trigger from HMR events
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const localPrototypeIndex = useMemo(() => buildPrototypeIndex(knownRoutes), [knownRoutes, canvasIndexTick])
  const prototypeIndex = useMemo(
    () => mergeArtifactIndexIntoPrototypeIndex(localPrototypeIndex, artifactIndex, currentBranch),
    [localPrototypeIndex, artifactIndex, currentBranch],
  )

  // Build unified items list from all sources
  const allItems = useMemo(() => {
    const items = []

    // Prototypes (ungrouped + from folders)
    const addProto = (proto) => {
      // Prefer a flow marked as default, fall back to the first flow
      const defaultFlow = proto.flows?.find(f => f.meta?.default === true)
      const route = defaultFlow
        ? defaultFlow.route
        : proto.flows?.length > 0
          ? proto.flows[0].route
          : `/${proto.dirName}`

      items.push({
        id: proto.id || `proto:${proto.dirName}`,
        name: proto.name,
        type: 'prototype',
        author: proto.author,
        gitAuthor: proto.gitAuthor,
        lastModified: proto.lastModified,
        route: proto.route || route,
        isExternal: proto.isExternal,
        externalUrl: proto.externalUrl,
        folder: proto.folder,
        description: proto.description,
        flows: proto.flows || [],
        isPrivate: !!proto.isPrivate,
        branches: proto.branches || [],
        isBranchOnly: !!proto.isBranchOnly,
        homeBranch: proto.homeBranch || null,
      })
    }

    for (const proto of prototypeIndex.prototypes || []) addProto(proto)
    for (const folder of prototypeIndex.folders || []) {
      for (const proto of folder.prototypes || []) addProto(proto)
    }

    // Canvases (ungrouped + from folders)
    const addCanvas = (canvas) => {
      items.push({
        id: canvas.id || `canvas:${canvas.dirName}`,
        name: canvas.name,
        type: 'canvas',
        author: canvas.author,
        gitAuthor: canvas.gitAuthor,
        lastModified: canvas.lastModified || null,
        route: canvas.route,
        isExternal: false,
        externalUrl: null,
        folder: canvas.folder,
        description: canvas.description,
        pages: canvas.pages || null,
        isPrivate: !!canvas.isPrivate,
        branches: canvas.branches || [],
        isBranchOnly: !!canvas.isBranchOnly,
        homeBranch: canvas.homeBranch || null,
      })
    }

    for (const canvas of prototypeIndex.canvases || []) addCanvas(canvas)
    for (const folder of prototypeIndex.folders || []) {
      for (const canvas of folder.canvases || []) addCanvas(canvas)
    }

    // Components (stories)
    const storyNames = listStories()
    for (const name of storyNames) {
      const data = getStoryData(name)
      if (!data) continue
      const displayName = (name.split('/').pop() || name).replace(/^~/, '')
      items.push({
        id: `component:${name}`,
        name: displayName.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
        type: 'component',
        author: null,
        gitAuthor: null,
        lastModified: null,
        route: data._route || `/components/${name}`,
        isExternal: false,
        externalUrl: null,
        folder: null,
        description: null,
        isPrivate: !!data._isPrivate,
      })
    }

    for (const site of sites) {
      items.push({
        id: `site:${site.id}`,
        name: site.title || site.id,
        type: 'site',
        author: null,
        gitAuthor: null,
        lastModified: site.binding?.updatedAt || null,
        route: `/sites/${encodeURIComponent(site.id)}/`,
        isExternal: false,
        externalUrl: site.deployments?.[site.defaultDeployment]?.baseUrl || site.binding?.developmentBaseUrl || null,
        folder: null,
        description: site.binding?.root || site.description || 'No directory bound',
        binding: site.binding || null,
        missing: site.missing === true,
      })
    }

    return items
  }, [prototypeIndex, sites])

  const itemMap = useMemo(() => Object.fromEntries(allItems.map(i => [i.id, i])), [allItems])

  // Filter nav items based on visibility props AND `ui.hide` config keys.
  // `ui.hide` entries take the form `workspace:<navId>` (e.g.
  // "workspace:components") and let consumers hide individual nav items
  // without passing component props.
  const visibleNavItems = useMemo(() => {
    const visibility = {
      all: showAllArtifacts,
      prototypes: showPrototypes,
      canvases: showCanvases,
      components: showComponents,
      sites: showSites,
    }
    return NAV_ITEMS.filter(nav => visibility[nav.id] && !isMenuHidden(`workspace:${nav.id}`))
  }, [showAllArtifacts, showPrototypes, showCanvases, showComponents, showSites])

  // Workspace location state lives in the URL so browser reloads and tabs
  // reopen the same section and filter.
  const defaultNav = visibleNavItems[0]?.id || 'prototypes'
  const requestedSection = searchParams.get('section')
  const activeNav = visibleNavItems.some(nav => nav.id === requestedSection) ? requestedSection : defaultNav
  const requestedFilter = searchParams.get('filter')
  const activeTab = TAB_FILTERS.includes(requestedFilter) ? requestedFilter : 'All'
  const agentId = searchParams.get('agentId') || ''
  const agentWidgetId = searchParams.get('widgetId') || 'agent-browser-session'
  const [showCreate, setShowCreate] = useState(false)
  const [createType, setCreateType] = useState(null)
  const [diagnostics, setDiagnostics] = useState(null)
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false)
  const isLocalDev = typeof window !== 'undefined' && window.__SB_LOCAL_DEV__ === true
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [groupByFolders, setGroupByFolders] = useState(() => {
    try { return localStorage.getItem(GROUP_BY_FOLDERS_KEY) !== 'false' } catch { return true }
  })
  const [collapsedFolders, setCollapsedFolders] = useState(() => {
    try {
      const raw = localStorage.getItem(COLLAPSED_FOLDERS_KEY)
      const parsed = raw ? JSON.parse(raw) : []
      return new Set(Array.isArray(parsed) ? parsed : [])
    } catch { return new Set() }
  })
  const [hiddenItems, setHiddenItems] = useState(new Set())
  const { starred, toggle: toggleStar } = useStarred()
  const recentIds = useRecent()

  const refreshDiagnostics = useCallback(async () => {
    setDiagnosticsLoading(true)
    try {
      setDiagnostics(await coreRequestJson('/_storyboard/diagnostics', { cache: 'no-store' }))
    } catch (failure) {
      setDiagnostics({ error: failure?.message || String(failure) })
    } finally {
      setDiagnosticsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (panel === 'diagnostics') refreshDiagnostics()
  }, [panel, refreshDiagnostics])

  // Filter by nav category
  const navFiltered = useMemo(() => {
    let filtered = activeNav === 'all' ? allItems : allItems.filter(i => i.type === TYPE_MAP[activeNav])
    if (hiddenItems.size > 0) filtered = filtered.filter(i => !hiddenItems.has(i.id))
    return filtered
  }, [allItems, activeNav, hiddenItems])

  // Filter by tab
  const items = useMemo(() => {
    if (activeTab === 'Recent') {
      const ordered = recentIds.map(id => itemMap[id]).filter(item => item && !item.isBranchOnly)
      if (activeNav !== 'all') {
        return ordered.filter(i => i.type === TYPE_MAP[activeNav])
      }
      return ordered
    }
    const base = activeTab === 'Starred'
      ? navFiltered.filter(i => !i.isBranchOnly && starred.has(i.id))
      : navFiltered
    return [...base].sort((a, b) => {
      const aTime = a.lastModified ? new Date(a.lastModified).getTime() : 0
      const bTime = b.lastModified ? new Date(b.lastModified).getTime() : 0
      return bTime - aTime
    })
  }, [activeTab, activeNav, navFiltered, recentIds, itemMap, starred])

  // Grouped items for folder view
  const grouped = useMemo(() => {
    if (!groupByFolders) return null
    const folderItems = {}
    const ungrouped = []
    for (const item of items) {
      if (item.folder) {
        if (!folderItems[item.folder]) folderItems[item.folder] = []
        folderItems[item.folder].push(item)
      } else {
        ungrouped.push(item)
      }
    }
    const folderMeta = {}
    for (const f of prototypeIndex.folders || []) folderMeta[f.dirName] = f
    const folders = Object.entries(folderItems).map(([dirName, fItems]) => ({
      dirName,
      name: folderMeta[dirName]?.name || dirName,
      isPrivate: !!folderMeta[dirName]?.isPrivate,
      items: fItems,
    }))
    folders.sort((a, b) => {
      const aMax = Math.max(0, ...a.items.map(i => i.lastModified ? new Date(i.lastModified).getTime() : 0))
      const bMax = Math.max(0, ...b.items.map(i => i.lastModified ? new Date(i.lastModified).getTime() : 0))
      return bMax - aMax
    })
    return { ungrouped, folders }
  }, [items, groupByFolders, prototypeIndex])

  const toggleGrouping = useCallback(() => {
    setGroupByFolders(prev => {
      const next = !prev
      try { localStorage.setItem(GROUP_BY_FOLDERS_KEY, String(next)) } catch { /* empty */ }
      return next
    })
  }, [])

  const toggleFolder = useCallback((dirName) => {
    setCollapsedFolders(prev => {
      const next = new Set(prev)
      if (next.has(dirName)) next.delete(dirName)
      else next.add(dirName)
      try { localStorage.setItem(COLLAPSED_FOLDERS_KEY, JSON.stringify([...next])) } catch { /* empty */ }
      return next
    })
  }, [])

  function createSite() {
    setCreateType('Site')
  }

  function openSettings() {
    updateRouteParams({ panel: 'settings' })
  }

  function openDiagnostics() {
    updateRouteParams({ panel: 'diagnostics' })
  }

  function openNotebookSwitcher() {
    updateRouteParams({ panel: 'notebooks' })
  }

  function returnToWorkspace() {
    updateRouteParams({ panel: null, agentId: null, widgetId: null, canvasId: null })
  }

  function updateAgentRoute(updates) {
    updateRouteParams({ panel: 'agent', agentId: updates.agentId || null })
  }

  const handleItemDeleted = useCallback((itemId) => {
    setHiddenItems(prev => new Set(prev).add(itemId))
  }, [])

  // Counts
  const visibleItems = useMemo(() =>
    hiddenItems.size > 0 ? allItems.filter(i => !hiddenItems.has(i.id)) : allItems
  , [allItems, hiddenItems])

  const counts = useMemo(() => ({
    all: visibleItems.length,
    prototypes: visibleItems.filter(i => i.type === 'prototype').length,
    canvases: visibleItems.filter(i => i.type === 'canvas').length,
    components: visibleItems.filter(i => i.type === 'component').length,
    sites: visibleItems.filter(i => i.type === 'site').length,
  }), [visibleItems])

  // Starred items for sidebar
  const starredItems = useMemo(() => visibleItems.filter(i => !i.isBranchOnly && starred.has(i.id)), [visibleItems, starred])

  return (
    <>
    <div className={css.layout} {...themeAttrs}>
      {/* ─── Full-width Header ─── */}
      <header className={css.topBar}>
        <div className={css.topBarLeft}>
          <button
            className={css.hamburgerBtn}
            onClick={() => setSidebarOpen(prev => !prev)}
            aria-label="Toggle menu"
          >
            {sidebarOpen ? <XIcon size={18} /> : <ThreeBarsIcon size={18} />}
          </button>
          {logo
            ? <div className={`${css.logo} smooth-corners`}>{logo}</div>
            : <div className={`${css.logo} smooth-corners`}><Icon name={logoIcon} size={22} color="#fff" /></div>}
          <div>
            <div className={css.appName}>{title}</div>
            {subtitle && <div className={css.appSubtitle}>{subtitle}</div>}
          </div>
        </div>
        <div className={css.topActions}>
          <BranchNav basePath={basePath} />
          {(browserCoreMode || (isLocalDev && isTauriAvailable())) && (
            <Menu.Root open={showCreate} onOpenChange={setShowCreate}>
              <Menu.Trigger className={css.createBtn}>
                <PlusIcon size={14} /> Create
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Positioner className={css.createDropdownPositioner} side="bottom" align="end" sideOffset={4}>
                  <Menu.Popup className={css.createDropdown}>
                    <CreateMenu onClose={() => setShowCreate(false)} onCreate={setCreateType} basePath={basePath} />
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.Root>
          )}
        </div>
      </header>
      <NotebookDialog open={notebookOpen} onOpenChange={setNotebookOpen} />
      <CreateDialog type={createType} basePath={basePath} onClose={() => setCreateType(null)} />
      {notebooksOpen && (
        <div className={css.notebookModalBackdrop} role="presentation" onMouseDown={event => event.target === event.currentTarget && closeNotebooks()}>
          <section
            className={css.notebookModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby={pendingRemoveNotebook ? 'notebook-remove-title' : 'notebook-switcher-title'}
          >
            <button className={css.notebookModalClose} type="button" aria-label="Close" onClick={closeNotebooks}>×</button>
            {pendingRemoveNotebook ? (
              <>
                <h2 id="notebook-remove-title">Remove notebook?</h2>
                <p className={css.notebookModalText}>
                  “{pendingRemoveNotebook.name || pendingRemoveNotebook.path}” will no longer be listed in
                  Hypercanvas. The notebook folder will not be deleted.
                </p>
                <div className={css.notebookModalActions}>
                  <button className={css.notebookModalBtn} type="button" onClick={() => setPendingRemoveNotebook(null)}>Cancel</button>
                  <button className={css.notebookModalBtnDanger} type="button" onClick={() => removeNotebook(pendingRemoveNotebook)}>Remove notebook</button>
                </div>
              </>
            ) : (
              <>
                <h2 id="notebook-switcher-title">Switch notebook</h2>
                {notebooks.length === 0 && (
                  <p className={css.notebookModalText}>{notebookError || 'No recent notebooks yet. Choose a folder to open or create one.'}</p>
                )}
                {notebooks.map(notebook => (
                  <div key={notebook.path} className={css.notebookMenuRow}>
                    <button className={css.notebookMenuItem} type="button" disabled={openingNotebookPath === notebook.path || notebook.available === false} onClick={() => switchNotebook(notebook)}>
                      <StackIcon size={14} />
                      <span className={css.notebookMenuLabel}>{notebook.name || notebook.path}{notebook.available === false ? ' — Folder missing' : ''}</span>
                    </button>
                    {isTauriAvailable() && <button
                      className={css.notebookMenuRemove}
                      type="button"
                      aria-label={`Remove ${notebook.name || notebook.path}`}
                      title="Remove from list"
                      onClick={() => setPendingRemoveNotebook(notebook)}
                    >
                      <TrashIcon size={14} />
                    </button>}
                  </div>
                ))}
                <button className={css.notebookMenuAdd} type="button" onClick={() => { updateRouteParams({ panel: null }); setNotebookOpen(true) }}>
                  <PlusIcon size={14} /> Add notebook
                </button>
                {notebookError && notebooks.length > 0 && <p className={css.notebookModalText} role="alert">{notebookError}</p>}
              </>
            )}
          </section>
        </div>
      )}

      {/* ─── Body: Sidebar + Content ─── */}
      <div className={css.body}>
        {/* ─── Sidebar ─── */}
        <aside className={`${css.sidebar}${sidebarOpen ? ` ${css.sidebarOpen}` : ''}`}>
          <div className={css.sidebarContent}>
          <nav className={css.navSection}>
            {visibleNavItems.map(nav => (
              <button
                key={nav.id}
                className={activeNav === nav.id ? css.navItemActive : css.navItem}
                onClick={() => { updateRouteParams({ section: nav.id }); setSidebarOpen(false) }}
              >
                <span className={css.navIcon}><Icon name={nav.iconName} size={16} /></span>
                {nav.label}
                <span className={css.navCount}>{counts[nav.id]}</span>
              </button>
            ))}
          </nav>

          <div className={css.separator} />

          <div className={css.sectionLabel}>Starred</div>
          {starredItems.length === 0 && (
            <div className={css.starredEmpty}>Star items to pin them here</div>
          )}
          {starredItems.map(s => (
            <a
              key={s.id}
              className={css.starredItem}
              href={s.isExternal ? s.externalUrl : withBase(basePath, s.route)}
              {...(s.isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              onClick={() => trackRecentItem(s)}
            >
              <span className={css.starredIcon}>{getTypeIcon(s.type)}</span>
              {s.name}
            </a>
          ))}
          </div>

          {/* User profile / settings */}
          <div className={css.sidebarFooter}>
            {notebookUiEnabled && <div className={css.notebookSwitcher}>
              <button className={css.notebookSwitcherButton} type="button" onClick={openNotebookSwitcher} aria-expanded={notebooksOpen}>
                <StackIcon size={16} />
                <span>{currentNotebook}</span>
                <ChevronRightIcon size={14} />
              </button>
            </div>}
            {ghUser ? (
              <div className={css.footerRow}>
                <button className={css.userBtn} onClick={openSettings}>
                  <img
                    className={css.userAvatar}
                    src={ghUser.avatarUrl || `https://github.com/${ghUser.login}.png?size=64`}
                    alt={ghUser.login}
                    width={32}
                    height={32}
                  />
                  <div className={css.userInfo}>
                    <div className={css.userName}>{ghUser.login}</div>
                  </div>
                </button>
              </div>
            ) : (
              <div className={css.footerRow}>
                <button className={css.loginBtn} onClick={openSettings}>
                  <span className={css.avatar}><Icon name="iconoir/settings" size={16} /></span>
                  <span className={css.userName}>Settings</span>
                </button>
              </div>
            )}
            {browserCoreMode && <button className={css.diagnosticsButton} type="button" onClick={openDiagnostics}>
              Diagnostics
            </button>}
          </div>
          <SettingsDialog
            open={settingsOpen}
            onOpenChange={open => updateRouteParams({ panel: open ? 'settings' : null })}
            user={ghUser}
            onRemoveToken={handleRemoveToken}
          />
        </aside>

        {/* ─── Main ─── */}
        <main className={css.main}>
          {panel === 'agent' ? (
            <section className={css.routePanel} aria-labelledby="agent-route-title">
              <header className={css.routePanelHeader}>
                <div>
                  <h1 id="agent-route-title">Agent session</h1>
                  <p>{agentId ? `Agent ${agentId}` : 'Start a new agent chat from this browser tab.'}</p>
                </div>
                <button type="button" onClick={returnToWorkspace}>Back to workspace</button>
              </header>
              <div className={css.agentRouteContent}>
                <AgentChatWidget
                  id={agentWidgetId}
                  props={{ agentId }}
                  onUpdate={updateAgentRoute}
                  resizable={false}
                />
              </div>
            </section>
          ) : panel === 'diagnostics' ? (
            <section className={css.routePanel} aria-labelledby="diagnostics-route-title" aria-busy={diagnosticsLoading}>
              <header className={css.routePanelHeader}>
                <div>
                  <h1 id="diagnostics-route-title">Core diagnostics</h1>
                  <p>Live health and state reported by local Core services.</p>
                </div>
                <div className={css.routePanelActions}>
                  <button type="button" onClick={refreshDiagnostics} disabled={diagnosticsLoading}>
                    {diagnosticsLoading ? 'Refreshing…' : 'Refresh'}
                  </button>
                  <button type="button" onClick={returnToWorkspace}>Back to workspace</button>
                </div>
              </header>
              {!diagnostics && diagnosticsLoading && <p role="status">Checking Core services…</p>}
              {diagnostics?.error && <p role="alert">{diagnostics.error}</p>}
              {diagnostics && !diagnostics.error && <div className={css.diagnosticsGrid}>
                {[
                  ['core', 'Core process'],
                  ['node', 'Selected Node'],
                  ['notebook', 'Active Notebook'],
                  ['paseo', 'Paseo agent runtime'],
                  ['hostTools', 'Host tools'],
                  ['agents', 'Agent executables'],
                  ['sites', 'Sites'],
                  ['terminals', 'Terminal sessions'],
                  ['processes', 'Processes'],
                  ['watches', 'Filesystem watches'],
                  ['logs', 'Recent Core logs'],
                  ['recovery', 'Recovery guidance'],
                ].map(([key, label]) => (
                  <article key={key} className={css.diagnosticCard}>
                    <h2>{label}</h2>
                    <pre>{JSON.stringify(diagnostics[key] ?? null, null, 2)}</pre>
                  </article>
                ))}
              </div>}
            </section>
          ) : (
            <>
          {/* Tabs */}
          <div className={css.tabs}>
            {TAB_FILTERS.map(t => (
              <button
                key={t}
                className={activeTab === t ? css.tabActive : css.tab}
                onClick={() => updateRouteParams({ filter: t === 'All' ? null : t })}
              >
                {t}
              </button>
            ))}
            <div className={css.tabOptions}>
              <label className={css.groupByFolders}>
                <input
                  type="checkbox"
                  className={css.groupByFoldersCheckbox}
                  checked={groupByFolders}
                  onChange={toggleGrouping}
                />
                Group by folders
              </label>
              {activeNav === 'sites' && sites.length > 0 && <button type="button" className={css.siteCreateButton} onClick={createSite}>
                <PlusIcon size={14} /> Add Site
              </button>}
            </div>
          </div>

          {/* Grid */}
          <div className={css.content}>
            {items.length === 0 ? (
              <div className={css.emptyState}>
                {activeNav === 'sites' && sites.length === 0 ? <>
                  <p>No Sites connected yet. Choose a project folder to reference it in this Notebook.</p>
                  <button type="button" className={css.siteCreateButton} onClick={createSite}>
                    <PlusIcon size={14} /> Choose folder
                  </button>
                </> : <>
                  {activeTab === 'Recent' && 'No recently opened items yet.'}
                  {activeTab === 'Starred' && 'No starred items. Click ☆ on a card to star it.'}
                  {activeTab === 'All' && 'No items found. Create a prototype, canvas, or component to get started.'}
                </>}
              </div>
            ) : groupByFolders && grouped && activeTab === 'All' ? (
              <>
                {grouped.folders.map(folder => (
                  <FolderSection
                    key={folder.dirName}
                    folder={folder}
                    collapsed={collapsedFolders.has(folder.dirName)}
                    onToggle={() => toggleFolder(folder.dirName)}
                    basePath={basePath}
                    branchBasePath={branchBasePath}
                    currentBranch={currentBranch}
                    starred={starred}
                    onToggleStar={toggleStar}
                    onItemDeleted={handleItemDeleted}
                  />
                ))}
                {grouped.ungrouped.length > 0 && (
                  <div className={css.grid}>
                    {grouped.ungrouped.map(item => (
                      <ArtifactCard
                        key={item.id}
                        item={item}
                        basePath={basePath}
                        branchBasePath={branchBasePath}
                        currentBranch={currentBranch}
                        starred={starred.has(item.id)}
                        onToggleStar={toggleStar}
                        onItemDeleted={handleItemDeleted}
                      />
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className={css.grid}>
                {items.map(item => (
                  <ArtifactCard
                    key={item.id}
                    item={item}
                    basePath={basePath}
                    branchBasePath={branchBasePath}
                    currentBranch={currentBranch}
                    starred={starred.has(item.id)}
                    onToggleStar={toggleStar}
                    onItemDeleted={handleItemDeleted}
                  />
                ))}
              </div>
            )}
          </div>
            </>
          )}
        </main>
      </div>
    </div>
    </>
  )
}

/**
 * Workspace wrapper — short-circuits to an empty page when customer mode
 * has the homepage hidden or redirected (`hideHomepage` true, or any
 * non-default `homepage` value). Without this guard the workspace would
 * flash before `mountStoryboardCore.applyCustomerMode` resolves the
 * redirect. Wrapping (instead of an early return inside WorkspaceImpl)
 * keeps the inner component's hooks call order stable.
 */
export default function Workspace(props) {
  if (isCustomerHidingHomepage()) return null
  return <WorkspaceImpl {...props} />
}
