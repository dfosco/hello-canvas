/**
 * SimpleWorkspace — minimal "old index"-style homescreen for /
 *
 * Renders only in **dev mode**. In prod (or when ?prodMode is on), delegates
 * to the full <Workspace /> so deployed environments keep the existing UX.
 *
 * Defaults to showing artifacts created by the current git user — solo / small
 * teams see a focused list instead of every artifact in the repo. The "Show all"
 * button at the bottom expands to the full set without leaving the simplified view.
 *
 * Filter rules for "mine":
 *   - item.gitAuthor === git user.name (the file's git creator), OR
 *   - item.author (string or array) contains the GitHub login (case-insensitive,
 *     normalized — strips leading @, trims, splits comma-separated strings).
 *
 * Note: "edited by you" is not tracked per file — only creator data is available.
 * If we add `lastAuthor` later, extend `isMine()` to include it.
 *
 * Draft / private artifacts (e.g. canvases under `drafts/` or folders marked
 * `_isPrivate`) are NOT filtered out — they render with an EyeClosedIcon badge
 * to match the full Workspace's behaviour, so the user can still reach their
 * own work-in-progress from the simplified homepage.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  buildPrototypeIndex,
  isCustomerHidingHomepage,
} from '../../core/index.js'
import { isProdMode } from '../../core/utils/prodMode.js'
import {
  mergeArtifactIndexIntoPrototypeIndex,
  buildBranchArtifactHref,
} from '../../core/data/artifactIndex.js'
import { ChevronRightIcon, EyeClosedIcon, PlusIcon } from '@primer/octicons-react'
import { Menu } from '@base-ui/react/menu'
import { useBranches } from '../BranchBar/useBranches.js'
import { useArtifactIndex } from '../hooks/useArtifactIndex.js'
import Workspace, { CreateMenu } from '../Viewfinder.jsx'
import CreateDialog from '../CommandPalette/CreateDialog.jsx'
import { isTauriAvailable } from '../../core/notebook/tauri-bridge.js'
import { isBrowserCoreMode } from '../../core/notebook/browserBridge.js'
import Icon from '../Icon.jsx'
import css from './SimpleWorkspace.module.css'

/* ─── localStorage keys ─── */

const SHOW_DRAFTS_KEY = 'sb-home-show-drafts'
const GROUP_BY_FOLDERS_KEY = 'sb-home-group-folders'
const COLLAPSED_FOLDERS_KEY = 'sb-home-collapsed-folders'

/* ─── Helpers ─── */

function withBase(basePath, route) {
  const normalizedRoute = route.startsWith('/') ? route : `/${route}`
  const normalizedBase = (basePath || '/').replace(/\/+$/, '')
  if (!normalizedBase || normalizedBase === '/') return normalizedRoute
  return `${normalizedBase}${normalizedRoute}`.replace(/\/+/g, '/')
}

function normalizeAuthorList(author) {
  if (!author) return []
  const raw = Array.isArray(author) ? author : String(author).split(',')
  return raw
    .map(a => String(a).trim().replace(/^@/, '').toLowerCase())
    .filter(Boolean)
}

/**
 * Returns true when an item was created by the current user, or explicitly
 * lists them as a metadata author.
 */
function isMine(item, gitName, ghLogin) {
  if (gitName && item.gitAuthor && item.gitAuthor === gitName) return true
  if (ghLogin) {
    const login = ghLogin.toLowerCase()
    const authors = normalizeAuthorList(item.author)
    if (authors.includes(login)) return true
  }
  return false
}

/* ─── Current user (name + login) ─── */

const USER_CACHE_KEY = 'sb:simple-workspace:git-user-v1'

function readCachedUser() {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage?.getItem(USER_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      return { name: parsed.name || null, login: parsed.login || null }
    }
  } catch {
    // Ignore storage / parse errors — fall through to null.
  }
  return null
}

function writeCachedUser(user) {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage?.setItem(USER_CACHE_KEY, JSON.stringify(user))
  } catch {
    // Ignore quota / privacy-mode write failures.
  }
}

/**
 * Reads the current git user. Synchronously hydrates from sessionStorage on
 * mount so subsequent loads in the same tab never flash unfiltered content.
 * Exposes a `loaded` flag so the consumer can suppress rendering until we know
 * whether the "mine" filter should apply — otherwise the page paints with all
 * items, then snaps to "mine only" once the fetch resolves.
 */
function useCurrentUser(basePath) {
  const cached = useMemo(() => readCachedUser(), [])
  const [user, setUser] = useState(cached || { name: null, login: null })
  const [loaded, setLoaded] = useState(!!cached)
  useEffect(() => {
    const apiBase = (basePath || '/').replace(/\/$/, '')
    let cancelled = false
    fetch(`${apiBase}/_storyboard/git-user`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (cancelled) return
        if (data) {
          const next = { name: data.name || null, login: data.login || null }
          setUser(next)
          writeCachedUser(next)
        }
        setLoaded(true)
      })
      .catch(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [basePath])
  return { ...user, loaded }
}

/* ─── Avatars ─── */

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
          width={20}
          height={20}
          loading="lazy"
          onError={(e) => { e.target.style.display = 'none' }}
        />
      ))}
    </div>
  )
}

/* ─── Cards ─── */

function FolderCard({ folder, collapsed, onToggle }) {
  const isPrivate = !!folder.isPrivate
  return (
    <button
      type="button"
      className={`${css.folderCard} ${css.folderCardButton}${isPrivate ? ' ' + css.folderCardPrivate : ''}`}
      onClick={onToggle}
      aria-expanded={!collapsed}
    >
      <span
        className={collapsed ? css.folderChevron : css.folderChevronExpanded}
        aria-hidden="true"
      >
        <ChevronRightIcon size={14} />
      </span>
      <span className={css.folderIcon} aria-hidden="true">
        <Icon name={collapsed ? 'folder' : 'folder-open'} size={18} />
      </span>
      <span className={css.folderName}>{folder.dirName.replace(/\.folder$/, '').toUpperCase()}</span>
      {isPrivate && (
        <span
          className={css.privateBadge}
          aria-label="Draft folder — only visible to you"
          title="Draft folder — only visible to you"
        >
          <EyeClosedIcon size={12} />
        </span>
      )}
      {folder.description && <span className={css.folderDesc}>{folder.description}</span>}
    </button>
  )
}

function ArtifactRow({ item, basePath, branchBasePath }) {
  const isBranchOnly = !!item.isBranchOnly
  const isExternal = item.isExternal
  const branchOnlyHref = isBranchOnly
    ? isExternal
      ? item.externalUrl
      : buildBranchArtifactHref(branchBasePath || basePath, item.homeBranch?.folder, item.homeBranch?.route || item.route)
    : null
  const href = isBranchOnly
    ? branchOnlyHref || '#'
    : isExternal
      ? item.externalUrl
      : item.route ? withBase(basePath, item.route) : '#'

  const linkProps = isBranchOnly || isExternal
    ? { href, target: '_blank', rel: 'noopener noreferrer' }
    : { href }

  const authorList = Array.isArray(item.author)
    ? item.author
    : item.author
      ? [item.author]
      : item.gitAuthor ? [item.gitAuthor] : []

  const isPrivate = !!item.isPrivate
  const typeLabel = item.type === 'canvas' ? 'Canvas' : item.type === 'prototype' ? 'Prototype' : item.type === 'site' ? 'Site' : 'Item'
  const cardClass = `${css.card}${isPrivate ? ' ' + css.cardPrivate : ''}`

  return (
    <a className={cardClass} {...linkProps}>
      <div className={css.cardBody}>
        <div className={css.cardTitleRow}>
          <span className={css.cardTitle}>{item.name}</span>
          {isPrivate && (
            <span
              className={css.privateBadge}
              aria-label={`Draft ${typeLabel.toLowerCase()} — only visible to you`}
              title={`Draft ${typeLabel.toLowerCase()} — only visible to you`}
            >
              <EyeClosedIcon size={12} />
            </span>
          )}
          <ChevronRightIcon size={16} className={css.cardChevron} />
        </div>
        {item.description && (
          <div className={css.cardDescription}>{item.description}</div>
        )}
        {authorList.length > 0 && (
          <div className={css.cardFooter}>
            <AvatarStack authors={authorList} />
            <span className={css.cardAuthorList}>{authorList.join(', ')}</span>
          </div>
        )}
      </div>
    </a>
  )
}

/* ─── Tabs ─── */

const TABS = [
  { id: 'prototypes', label: 'Prototypes' },
  { id: 'canvases', label: 'Canvas' },
  { id: 'sites', label: 'Sites' },
]

/* ─── Impl ─── */

function SimpleWorkspaceImpl({
  pageModules = {},
  basePath,
  title = 'Storyboard',
  subtitle,
}) {
  const ghUser = useCurrentUser(basePath)
  const { currentBranch, branchBasePath } = useBranches(basePath)
  const { artifactIndex } = useArtifactIndex(basePath)
  const [sites, setSites] = useState([])

  useEffect(() => {
    const apiBase = (basePath || '/').replace(/\/+$/, '')
    const refresh = () => fetch(`${apiBase}/_storyboard/site/list`)
      .then(response => response.ok ? response.json() : null)
      .then(data => setSites(data?.sites ?? []))
      .catch(() => setSites([]))
    refresh()
    document.addEventListener('storyboard:sites-changed', refresh)
    return () => document.removeEventListener('storyboard:sites-changed', refresh)
  }, [basePath])

  // Re-render on canvas/story HMR events so the list stays in sync with disk.
  const [hmrTick, setHmrTick] = useState(0)
  useEffect(() => {
    const bump = () => setHmrTick(t => t + 1)
    document.addEventListener('storyboard:canvas-index-changed', bump)
    document.addEventListener('storyboard:story-index-changed', bump)
    return () => {
      document.removeEventListener('storyboard:canvas-index-changed', bump)
      document.removeEventListener('storyboard:story-index-changed', bump)
    }
  }, [])

  const knownRoutes = useMemo(() =>
    Object.keys(pageModules)
      .map(p => p.replace('/src/prototypes/', '').replace('.jsx', ''))
      .filter(n => !n.startsWith('_') && n !== 'index' && n !== 'workspace' && n !== 'viewfinder' && n !== 'create'),
    [pageModules],
  )

  // hmrTick is an intentional re-render trigger from HMR events
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const localIndex = useMemo(() => buildPrototypeIndex(knownRoutes), [knownRoutes, hmrTick])
  const protoIndex = useMemo(
    () => mergeArtifactIndexIntoPrototypeIndex(localIndex, artifactIndex, currentBranch),
    [localIndex, artifactIndex, currentBranch],
  )

  // Flatten prototypes + canvases (preserve folder membership) into a single list.
  const allItems = useMemo(() => {
    const items = []

    const addProto = (proto) => {
      const defaultFlow = proto.flows?.find(f => f.meta?.default === true)
      const route = proto.route
        ?? (defaultFlow?.route
          ?? (proto.flows?.length > 0 ? proto.flows[0].route : `/${proto.dirName}`))
      items.push({
        id: proto.id || `proto:${proto.dirName}`,
        name: proto.name,
        type: 'prototype',
        author: proto.author,
        gitAuthor: proto.gitAuthor,
        lastModified: proto.lastModified,
        route,
        isExternal: proto.isExternal,
        externalUrl: proto.externalUrl,
        folder: proto.folder,
        description: proto.description,
        isPrivate: !!proto.isPrivate,
        isBranchOnly: !!proto.isBranchOnly,
        homeBranch: proto.homeBranch || null,
      })
    }

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
        isPrivate: !!canvas.isPrivate,
        isBranchOnly: !!canvas.isBranchOnly,
        homeBranch: canvas.homeBranch || null,
      })
    }

    for (const site of sites) {
      items.push({
        id: site.id,
        name: site.title || site.id,
        type: 'site',
        description: site.binding?.root || 'External Site',
        author: null,
        isExternal: false,
        externalUrl: site.deployments?.[site.defaultDeployment]?.baseUrl || null,
        route: `/sites/${encodeURIComponent(site.id)}/`,
        isPrivate: false,
        isBranchOnly: false,
      })
    }

    for (const proto of protoIndex.prototypes || []) addProto(proto)
    for (const folder of protoIndex.folders || []) {
      for (const proto of folder.prototypes || []) addProto(proto)
      for (const canvas of folder.canvases || []) addCanvas(canvas)
    }
    for (const canvas of protoIndex.canvases || []) addCanvas(canvas)

    return items
  }, [protoIndex, sites])

  // Tab + "Show all" state
  const [activeTab, setActiveTab] = useState('prototypes')
  const [showAll, setShowAll] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [createType, setCreateType] = useState(null)

  // List-control state (persisted to localStorage)
  const [showDrafts, setShowDrafts] = useState(() => {
    try { return localStorage.getItem(SHOW_DRAFTS_KEY) !== 'false' } catch { return true }
  })
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
  const activeLabel = activeTab === 'prototypes' ? 'prototypes' : activeTab === 'sites' ? 'sites' : 'canvases'

  const toggleShowDrafts = useCallback(() => {
    setShowDrafts(prev => {
      const next = !prev
      try { localStorage.setItem(SHOW_DRAFTS_KEY, String(next)) } catch { /* empty */ }
      return next
    })
  }, [])
  const toggleGroupByFolders = useCallback(() => {
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

  const canFilter = !!(ghUser.name || ghUser.login)

  // Filter by tab + (optionally) "mine" + (optionally) drafts.
  // Draft / private items (e.g. canvases under `drafts/`) render with an
  // EyeClosedIcon badge; the "Show drafts" toggle can hide them entirely.
  const visibleItems = useMemo(() => {
    const tabType = activeTab === 'prototypes' ? 'prototype' : activeTab === 'sites' ? 'site' : 'canvas'
    let pool = allItems.filter(i => i.type === tabType)
    if (!showAll && canFilter && tabType !== 'site') {
      pool = pool.filter(i => isMine(i, ghUser.name, ghUser.login))
    }
    if (!showDrafts) {
      pool = pool.filter(i => !i.isPrivate)
    }
    return pool
  }, [allItems, activeTab, showAll, canFilter, ghUser.name, ghUser.login, showDrafts])

  // Folders visible only if they contain at least one visible item of the active tab type.
  // Private folders (e.g. `drafts/`) are kept and rendered with a draft badge.
  const visibleFolders = useMemo(() => {
    const folderDirs = new Set(visibleItems.map(i => i.folder).filter(Boolean))
    return (protoIndex.folders || []).filter(f => folderDirs.has(f.dirName))
  }, [protoIndex, visibleItems])

  // Counts for the "Show all" button label
  const allTabCount = useMemo(() => {
    const tabType = activeTab === 'prototypes' ? 'prototype' : activeTab === 'sites' ? 'site' : 'canvas'
    return allItems.filter(i => i.type === tabType).length
  }, [allItems, activeTab])
  const mineTabCount = useMemo(() => {
    if (!canFilter) return allTabCount
    const tabType = activeTab === 'prototypes' ? 'prototype' : activeTab === 'sites' ? 'site' : 'canvas'
    return allItems.filter(
      i => i.type === tabType && isMine(i, ghUser.name, ghUser.login),
    ).length
  }, [allItems, activeTab, canFilter, ghUser.name, ghUser.login, allTabCount])
  const hiddenCount = Math.max(0, allTabCount - mineTabCount)

  // Sort items by lastModified desc (newest first)
  const sortedItems = useMemo(() => {
    return [...visibleItems].sort((a, b) => {
      const aTime = a.lastModified ? new Date(a.lastModified).getTime() : 0
      const bTime = b.lastModified ? new Date(b.lastModified).getTime() : 0
      return bTime - aTime
    })
  }, [visibleItems])

  // Group sorted items by folder for rendering
  const grouped = useMemo(() => {
    const byFolder = new Map()
    const ungrouped = []
    for (const item of sortedItems) {
      if (item.folder) {
        if (!byFolder.has(item.folder)) byFolder.set(item.folder, [])
        byFolder.get(item.folder).push(item)
      } else {
        ungrouped.push(item)
      }
    }
    return { byFolder, ungrouped }
  }, [sortedItems])

  const handleToggleShowAll = useCallback(() => setShowAll(s => !s), [])

  return (
    <div className={css.page}>
      <div className={css.inner}>
        {/* Header */}
        <header className={css.header}>
          <div className={css.headerTop}>
            <div>
              <h1 className={css.title}>{title}</h1>
              {subtitle && <p className={css.subtitle}>{subtitle}</p>}
            </div>
            {(isTauriAvailable() || isBrowserCoreMode()) && <Menu.Root open={showCreate} onOpenChange={setShowCreate}>
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
            </Menu.Root>}
          </div>

          <div className={css.tabs} role="tablist">
            {TABS.map(tab => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeTab === tab.id}
                className={activeTab === tab.id ? css.tabActive : css.tab}
                onClick={() => setActiveTab(tab.id)}
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div>
        </header>

        {/* Cards */}
        <div className={css.list}>
          {!ghUser.loaded ? (
            // Suppress paint until we know whether to filter to "mine".
            // Otherwise the page flashes the full list, then snaps to "mine only"
            // once the git-user fetch resolves.
            null
          ) : visibleFolders.length === 0 && sortedItems.length === 0 ? (
            <div className={css.empty}>
              {canFilter && !showAll
                ? `No ${activeLabel} created by you yet.`
                : `No ${activeLabel} found.`}
            </div>
          ) : !groupByFolders ? (
            /* Flat list — folders ignored, all items inline */
            sortedItems.map(item => (
              <ArtifactRow
                key={item.id}
                item={item}
                basePath={basePath}
                branchBasePath={branchBasePath}
              />
            ))
          ) : (
            <>
              {/* Ungrouped items first (no folder) */}
              {grouped.ungrouped.map(item => (
                <ArtifactRow
                  key={item.id}
                  item={item}
                  basePath={basePath}
                  branchBasePath={branchBasePath}
                />
              ))}

              {/* Then each folder as a collapsible section: header + its items */}
              {visibleFolders.map(folder => {
                const folderItems = grouped.byFolder.get(folder.dirName) || []
                const collapsed = collapsedFolders.has(folder.dirName)
                return (
                  <section key={folder.dirName} className={css.folderSection}>
                    <FolderCard
                      folder={folder}
                      collapsed={collapsed}
                      onToggle={() => toggleFolder(folder.dirName)}
                    />
                    {!collapsed && (
                      <div className={css.folderItems}>
                        {folderItems.map(item => (
                          <ArtifactRow
                            key={item.id}
                            item={item}
                            basePath={basePath}
                            branchBasePath={branchBasePath}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                )
              })}
            </>
          )}
        </div>

        {/* Footer actions */}
        <div className={css.footer}>
          <div className={css.controls}>
            <label className={css.controlLabel}>
              <input
                type="checkbox"
                className={css.controlCheckbox}
                checked={showDrafts}
                onChange={toggleShowDrafts}
              />
              Show drafts
            </label>
            <label className={css.controlLabel}>
              <input
                type="checkbox"
                className={css.controlCheckbox}
                checked={groupByFolders}
                onChange={toggleGroupByFolders}
              />
              Group by folders
            </label>
          </div>
          {ghUser.loaded && canFilter && hiddenCount > 0 && (
            <button
              type="button"
              className={css.expandBtn}
              onClick={handleToggleShowAll}
            >
              {showAll
                ? `Show only my ${activeLabel}`
                : `Show all ${activeLabel} (${hiddenCount} more)`}
            </button>
          )}
          <a className={css.expandBtn} href={withBase(basePath, '/workspace')}>
            See full workspace
          </a>
        </div>
      </div>
      <CreateDialog type={createType} basePath={basePath} onClose={() => setCreateType(null)} />
    </div>
  )
}

/* ─── Public wrapper ─── */

/**
 * SimpleWorkspace — a minimal dev-mode homescreen.
 *
 * In prod (or with ?prodMode), delegates to the full <Workspace />.
 * Short-circuits to an empty render whenever customer mode is hiding
 * or redirecting the homepage, so the simple homepage doesn't flash before
 * `mountStoryboardCore.applyCustomerMode` resolves the redirect.
 */
export default function SimpleWorkspace(props) {
  if (isCustomerHidingHomepage()) return null
  if (isProdMode()) return <Workspace {...props} />  // SSR / non-browser fallback: render full Workspace so static prerenders
  // produce the expected output.
  if (typeof window === 'undefined') return <Workspace {...props} />
  // Local dev (window.__SB_LOCAL_DEV__ true and no ?prodMode)
  if (window.__SB_LOCAL_DEV__ !== true) return <Workspace {...props} />
  return <SimpleWorkspaceImpl {...props} />
}
