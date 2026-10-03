import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { coreApiPath, coreRequestJson, NOTEBOOK_SIDEBAR_EVENT, openNotebookSidebar } from '../../core/notebook/browserBridge.js'
import { isCustomerHidingAllTools, isCustomerMode } from '../../core/index.js'
import CreateDialog from '../CommandPalette/CreateDialog.jsx'
import NotebookDialog from '../NotebookDialog/NotebookDialog.jsx'
import SettingsDialog from '../settings/SettingsDialog.jsx'
import css from './NotebookShell.module.css'

const TYPE_LABELS = { prototype: 'Prototypes', canvas: 'Canvases', site: 'Sites' }
const TYPE_SINGULAR = { prototype: 'Prototype', canvas: 'Canvas', site: 'Site' }
const TYPE_MARKS = { prototype: 'P', canvas: 'C', site: 'S' }
const LAYOUT_EVENT = 'storyboard:notebook-layout-updated'

export function lastVisitedPageStorageKey(notebookId) {
  return `hypercanvas:notebook:${notebookId}:last-page`
}

export { openNotebookSidebar }

function getStorage(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key)
    return raw == null ? fallback : JSON.parse(raw)
  } catch { return fallback }
}

function setStorage(key, value) {
  try { window.localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage may be disabled */ }
}

function routeMatches(page, pathname) {
  if (!page?.route || typeof pathname !== 'string') return false
  const route = page.route.replace(/\/$/, '') || '/'
  return pathname === route || (route !== '/' && pathname.startsWith(`${route}/`))
}

function hasRouteConflict(page) {
  return Boolean(page?.diagnostics?.some(item => item.code === 'PAGE_ROUTE_CONFLICT'))
}

function buttonTitle(page) {
  const state = page.available ? '' : ' — unavailable'
  return `${page.title || page.id}${state}`
}

function layoutEntries(navigation, pages) {
  const byId = new Map(pages.map(page => [page.id, page]))
  if (navigation?.mode === 'type') {
    return (navigation.type?.groups || []).map(type => ({
      key: type,
      type,
      title: TYPE_LABELS[type] || type,
      pages: (navigation.type?.order?.[type] || []).map(id => byId.get(id)).filter(Boolean),
    }))
  }
  if (!navigation?.sectionsEnabled) return [{ key: 'files-root', title: 'Pages', type: null, pages: (navigation?.files?.flatOrder || []).map(id => byId.get(id)).filter(Boolean) }]
  return (navigation?.files?.entries || []).map((entry, index) => {
    if (entry.type === 'section') {
      const section = navigation.files.sections.find(item => item.id === entry.sectionId)
      return section ? {
        key: `section:${section.id}`,
        section,
        type: 'section',
        title: section.title,
        pages: section.pageIds.map(id => byId.get(id)).filter(Boolean),
      } : null
    }
    const page = byId.get(entry.pageId)
    return page ? { key: `page:${page.id}:${index}`, type: 'single', title: '', pages: [page] } : null
  }).filter(Boolean)
}

function useNotebookCatalog(enabled, published) {
  const [catalog, setCatalog] = useState({ pages: [], navigation: null, notebookId: null, generation: null, revision: null, sites: [] })
  const [error, setError] = useState('')
  const refresh = useCallback(async signal => {
    if (!enabled) return
    try {
      if (published) {
        const exported = window.__HYPERCANVAS_NOTEBOOK_PUBLICATION__
        if (!exported || !Array.isArray(exported.pages)) throw new Error('Published Notebook navigation data is missing.')
        if (signal?.aborted) return
        setCatalog({
          title: exported.title || 'Notebook',
          pages: exported.pages,
          navigation: exported.navigation || null,
          notebookId: exported.notebookId || 'published',
          generation: 'published',
          revision: null,
          sites: [],
        })
        setError('')
        return
      }
      const [pagesData, navigationData, siteData] = await Promise.all([
        coreRequestJson('/_storyboard/notebook/pages', { cache: 'no-store', signal }),
        coreRequestJson('/_storyboard/notebook/navigation', { cache: 'no-store', signal }),
        published ? Promise.resolve({ sites: [] }) : coreRequestJson('/_storyboard/site/list', { cache: 'no-store', signal }).catch(() => ({ sites: [] })),
      ])
      if (signal?.aborted) return
      setCatalog({
        title: pagesData.title || navigationData.title || 'Notebook',
        pages: Array.isArray(pagesData.pages) ? pagesData.pages : [],
        navigation: navigationData.navigation || null,
        notebookId: pagesData.notebookId || navigationData.notebookId || null,
        generation: pagesData.generation ?? navigationData.generation ?? null,
        revision: navigationData.revision || pagesData.revision || null,
        sites: Array.isArray(siteData.sites) ? siteData.sites : [],
      })
      setError('')
    } catch (cause) {
      if (!signal?.aborted) setError(cause?.message || 'Could not load Notebook pages.')
    }
  }, [enabled, published])

  useEffect(() => {
    if (!enabled) return undefined
    const controller = new AbortController()
    refresh(controller.signal)
    const timer = window.setInterval(() => refresh(controller.signal), 4000)
    const layoutUpdated = event => {
      const data = event.detail
      if (!data || data.notebookId !== catalog.notebookId || data.generation !== catalog.generation) return
      setCatalog(current => ({ ...current, navigation: data.navigation || current.navigation, revision: data.revision || current.revision }))
    }
    const catalogChanged = () => refresh(controller.signal)
    window.addEventListener(LAYOUT_EVENT, layoutUpdated)
    window.addEventListener('storyboard:sites-changed', catalogChanged)
    window.addEventListener('storyboard:site-removed', catalogChanged)
    return () => {
      controller.abort()
      window.clearInterval(timer)
      window.removeEventListener(LAYOUT_EVENT, layoutUpdated)
      window.removeEventListener('storyboard:sites-changed', catalogChanged)
      window.removeEventListener('storyboard:site-removed', catalogChanged)
    }
  }, [catalog.generation, catalog.notebookId, enabled, refresh])

  return { catalog, setCatalog, error, refresh }
}

function siteRowState(sites, siteId) {
  const site = sites.find(item => item.id === siteId)
  return site ? { status: site.binding?.status || 'stopped', site } : { status: 'unknown', site: null }
}

/** Shared authoring shell. It stays outside StoryboardProvider so route-level provider branches cannot replace it. */
export default function NotebookShell({ children }) {
  const location = useLocation()
  const navigate = useNavigate()
  const published = import.meta.env.VITE_NOTEBOOK_PUBLISHED === '1'
  const embedded = new URLSearchParams(location.search).has('_sb_embed')
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '')
  const deprecatedWorkspace = location.pathname === `${base}/workspace` || location.pathname.startsWith(`${base}/workspace/`)
  const customerHidden = isCustomerMode() && isCustomerHidingAllTools()
  const enabled = !embedded && !deprecatedWorkspace && !customerHidden
  const { catalog, setCatalog, error, refresh } = useNotebookCatalog(enabled, published)
  const [open, setOpen] = useState(true)
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState({})
  const [pending, setPending] = useState(false)
  const [mutationError, setMutationError] = useState('')
  const [createType, setCreateType] = useState(null)
  const [createContext, setCreateContext] = useState(null)
  const [notebookDialogOpen, setNotebookDialogOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [diagnostics, setDiagnostics] = useState(null)
  const [activePageOverride, setActivePageOverride] = useState(null)
  const [dropTarget, setDropTarget] = useState('')
  const [publishedNavigation, setPublishedNavigation] = useState(null)
  const navRef = useRef(null)
  const pageById = useMemo(() => new Map(catalog.pages.map(page => [page.id, page])), [catalog.pages])
  const routeMatchesHere = catalog.pages.filter(page => routeMatches(page, location.pathname))
  const routePageId = new URLSearchParams(location.search).get('_notebookPage')
  const routePage = routeMatchesHere.find(page => page.id === routePageId) || routeMatchesHere[0] || null
  const activePageId = activePageOverride && pageById.has(activePageOverride) ? activePageOverride : routePage?.id || null
  const activePage = activePageId ? pageById.get(activePageId) : null
  const navigation = published ? (publishedNavigation || catalog.navigation) : catalog.navigation
  const entries = useMemo(() => layoutEntries(navigation, catalog.pages), [catalog.pages, navigation])
  const localPrefKey = catalog.notebookId ? `hypercanvas:notebook:${catalog.notebookId}:sidebar` : null

  useEffect(() => {
    if (!localPrefKey) return
    const preferences = getStorage(localPrefKey, null)
    if (preferences && typeof preferences === 'object') {
      setOpen(preferences.open !== false)
      setCollapsed(preferences.collapsed || {})
      setSearch(typeof preferences.search === 'string' ? preferences.search : '')
    }
    const lastPage = getStorage(lastVisitedPageStorageKey(catalog.notebookId), null)
    if (lastPage && pageById.has(lastPage)) setActivePageOverride(lastPage)
  }, [catalog.notebookId, localPrefKey, pageById])

  useEffect(() => {
    if (!published || !catalog.navigation || !catalog.notebookId) return
    const key = `hypercanvas:notebook:${catalog.notebookId}:published-view`
    const preference = getStorage(key, {})
    setPublishedNavigation({
      ...catalog.navigation,
      mode: preference.mode === 'files' || preference.mode === 'type' ? preference.mode : catalog.navigation.mode,
      sectionsEnabled: typeof preference.sectionsEnabled === 'boolean' ? preference.sectionsEnabled : catalog.navigation.sectionsEnabled,
    })
  }, [catalog.navigation, catalog.notebookId, published])

  useEffect(() => {
    if (localPrefKey) setStorage(localPrefKey, { ...getStorage(localPrefKey, {}), search })
  }, [localPrefKey, search])

  useEffect(() => {
    if (routePage) {
      setActivePageOverride(routePage.id)
      if (catalog.notebookId) setStorage(lastVisitedPageStorageKey(catalog.notebookId), routePage.id)
    }
  }, [catalog.notebookId, location.pathname, location.search, routePage])

  useEffect(() => {
    if (!enabled) return undefined
    const openSidebar = event => {
      setOpen(true)
      setSearch('')
      if (event?.detail?.focusType) setCollapsed({})
      if (localPrefKey) setStorage(localPrefKey, { ...getStorage(localPrefKey, {}), open: true })
      const focusType = event?.detail?.focusType
      requestAnimationFrame(() => {
        const target = focusType
          ? navRef.current?.querySelector(`[data-page-type="${focusType}"] .${css.pageButton}`)
          : navRef.current?.querySelector('button, a')
        target?.scrollIntoView?.({ block: 'nearest' })
        ;(target || navRef.current?.querySelector('button, a'))?.focus()
      })
    }
    const openSettings = () => setSettingsOpen(true)
    window.addEventListener(NOTEBOOK_SIDEBAR_EVENT, openSidebar)
    window.addEventListener('storyboard:open-settings', openSettings)
    return () => {
      window.removeEventListener(NOTEBOOK_SIDEBAR_EVENT, openSidebar)
      window.removeEventListener('storyboard:open-settings', openSettings)
    }
  }, [enabled, localPrefKey])

  const saveOpen = next => {
    setOpen(next)
    if (localPrefKey) setStorage(localPrefKey, { ...getStorage(localPrefKey, {}), open: next })
  }

  const mutate = async operation => {
    if (published || !navigation || pending) return
    setPending(true)
    setMutationError('')
    try {
      const updated = await coreRequestJson('/_storyboard/notebook/navigation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notebookId: catalog.notebookId,
          generation: catalog.generation,
          expectedRevision: catalog.revision,
          operation,
        }),
      })
      setCatalog(current => ({ ...current, navigation: updated.navigation, revision: updated.revision }))
    } catch (cause) {
      setMutationError(cause?.message || 'Could not save Notebook navigation.')
      await refresh()
    } finally {
      setPending(false)
    }
  }

  const openPage = page => {
    setActivePageOverride(page.id)
    setCreateContext({ pageId: page.id, sectionId: null })
    if (catalog.notebookId) setStorage(lastVisitedPageStorageKey(catalog.notebookId), page.id)
    if (page.route) {
      const params = new URLSearchParams(location.search)
      if (hasRouteConflict(page)) params.set('_notebookPage', page.id)
      else params.delete('_notebookPage')
      const search = params.toString()
      const nextLocation = `${page.route}${search ? `?${search}` : ''}${location.hash || ''}`
      const currentLocation = `${location.pathname}${location.search || ''}${location.hash || ''}`
      if (nextLocation !== currentLocation) navigate(nextLocation)
    }
  }

  const startCreate = (type, contextOverride = createContext) => {
    const initialValues = {}
    if (contextOverride?.sectionId) initialValues.sectionId = contextOverride.sectionId
    if (contextOverride?.pageId) {
      const selected = pageById.get(contextOverride.pageId)
      const selectedSection = navigation?.files?.sections?.find(section => section.pageIds.includes(contextOverride.pageId))
      if (navigation?.mode === 'files' && navigation.sectionsEnabled && selectedSection) initialValues.sectionId = selectedSection.id
      else initialValues.insertAfterPageId = contextOverride.pageId
      if (selected && navigation?.mode === 'files' && navigation.sectionsEnabled && !selectedSection) initialValues.insertAfterPageId = selected.id
    }
    setCreateContext(initialValues)
    setCreateType(type)
  }

  const deletePage = async page => {
    if (published) return
    const artifactName = page.type === 'site' ? page.siteId
      : page.type === 'canvas' ? String(page.path || '').split('/').at(-1)?.replace(/\.canvas\.jsonl$/, '')
        : String(page.path || '').split('/').at(-1) || page.title
    const initial = await fetch(coreApiPath('/_storyboard/artifact/'), {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: page.type, name: artifactName }),
    })
    const result = await initial.json().catch(() => ({}))
    if (initial.status === 409 && result.code === 'CONFIRMATION_REQUIRED') {
      const detail = result.affectedFiles?.length
        ? `\n\nAffected files:\n${result.affectedFiles.map(file => `• ${file}`).join('\n')}`
        : ''
      if (!window.confirm(`${result.error || `Delete ${page.title}?`}${detail}`)) return
      const confirmed = await fetch(coreApiPath('/_storyboard/artifact/'), {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: page.type, name: artifactName,
          ...(page.type === 'site' ? { confirmed: true } : { confirmedFiles: result.affectedFiles || [] }),
        }),
      })
      const data = await confirmed.json().catch(() => ({}))
      if (!confirmed.ok) throw new Error(data.error || 'Could not delete page.')
      setActivePageOverride(null)
      await refresh()
      return
    }
    if (!initial.ok) throw new Error(result.error || 'Could not delete page.')
    await refresh()
  }

  const renamePage = async page => {
    if (published) return
    const title = window.prompt('Page title', page.title || '')
    if (!title?.trim() || title.trim() === page.title) return
    const artifactName = page.type === 'site' ? page.siteId
      : page.type === 'canvas' ? String(page.path || '').split('/').at(-1)?.replace(/\.canvas\.jsonl$/, '')
        : String(page.path || '').split('/').at(-1) || page.title
    const response = await fetch(coreApiPath('/_storyboard/artifact/'), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: page.type, name: artifactName, title: title.trim() }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'Could not rename page.')
    await refresh()
  }

  const runSiteAction = async (page, action) => {
    const response = await fetch(coreApiPath(`/_storyboard/site/${encodeURIComponent(page.siteId)}/${action}`), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || `Could not ${action} Site.`)
    await refresh()
  }

  const changeSidebarMode = mode => {
    setSearch('')
    if (published) {
      const next = { ...navigation, mode }
      setPublishedNavigation(next)
      if (catalog.notebookId) setStorage(`hypercanvas:notebook:${catalog.notebookId}:published-view`, { ...getStorage(`hypercanvas:notebook:${catalog.notebookId}:published-view`, {}), mode })
      return
    }
    void mutate({ type: 'setMode', mode })
  }
  const changeSectionVisibility = enabled => {
    if (published) {
      const next = { ...navigation, sectionsEnabled: enabled }
      setPublishedNavigation(next)
      if (catalog.notebookId) setStorage(`hypercanvas:notebook:${catalog.notebookId}:published-view`, { ...getStorage(`hypercanvas:notebook:${catalog.notebookId}:published-view`, {}), sectionsEnabled: enabled })
      return
    }
    void mutate({ type: 'setSectionsEnabled', enabled })
  }
  const toggleCollapsed = key => {
    setCollapsed(current => {
      const next = { ...current, [key]: !current[key] }
      if (localPrefKey) setStorage(localPrefKey, { ...getStorage(localPrefKey, {}), collapsed: next })
      return next
    })
  }
  const reorderPage = (page, direction, layout, sectionId = null, type = page.type) => {
    const order = layout === 'type' ? navigation.type.order[type]
      : layout === 'filesFlat' ? navigation.files.flatOrder
        : sectionId ? navigation.files.sections.find(section => section.id === sectionId)?.pageIds || []
          : navigation.files.entries.filter(entry => entry.type === 'page').map(entry => entry.pageId)
    const index = order.indexOf(page.id)
    if (index < 0) return
    void mutate({ type: 'movePage', layout, pageId: page.id, sectionId, index: index + direction })
  }

  const handleDragStart = (event, item) => {
    if (published || pending || search.trim()) { event.preventDefault(); return }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/x-notebook-order', JSON.stringify(item))
  }
  const handleDrop = (event, target) => {
    event.preventDefault()
    event.stopPropagation()
    setDropTarget('')
    if (published || pending || search.trim()) return
    try {
      const source = JSON.parse(event.dataTransfer.getData('application/x-notebook-order'))
      const bounds = target.kind === 'section'
        ? event.currentTarget.querySelector(`.${css.groupHeader}`)?.getBoundingClientRect() || event.currentTarget.getBoundingClientRect()
        : event.currentTarget.getBoundingClientRect()
      const after = event.clientY > bounds.top + bounds.height / 2
      if (source.kind === 'type-group' && target.kind === 'type-group') {
        const groups = [...navigation.type.groups]
        const from = groups.indexOf(source.type)
        const targetIndex = groups.indexOf(target.type)
        if (from < 0 || targetIndex < 0) return
        groups.splice(from, 1)
        const insertionIndex = targetIndex - (from < targetIndex ? 1 : 0) + (after ? 1 : 0)
        groups.splice(Math.max(0, Math.min(insertionIndex, groups.length)), 0, source.type)
        void mutate({ type: 'reorderTypeGroups', groups })
        return
      }
      if (source.kind === 'section' && (target.kind === 'section' || target.kind === 'root-page')) {
        const rows = [...navigation.files.entries]
        const from = rows.findIndex(entry => entry.type === 'section' && entry.sectionId === source.sectionId)
        if (from < 0) return
        const targetIndex = target.rootIndex
        rows.splice(from, 1)
        const adjustedTarget = targetIndex - (from < targetIndex ? 1 : 0)
        const insertionIndex = adjustedTarget + (after ? 1 : 0)
        void mutate({ type: 'moveSection', sectionId: source.sectionId, index: Math.max(0, Math.min(insertionIndex, rows.length)) })
        return
      }
      if (source.kind !== 'page') return
      const layout = navigation?.mode === 'type' ? 'type' : navigation?.sectionsEnabled ? 'filesSections' : 'filesFlat'
      if (layout === 'type') {
        const targetType = target.type || source.pageType
        if (targetType !== source.pageType) return
        const order = navigation.type.order[targetType] || []
        let index = target.kind === 'type-group' ? order.length : target.index + (after ? 1 : 0)
        if (source.layout === 'type' && source.pageType === targetType && order.indexOf(source.pageId) < target.index) index -= 1
        void mutate({ type: 'movePage', layout, pageId: source.pageId, targetType, index })
      } else if (target.kind === 'section') {
        void mutate({ type: 'movePage', layout, pageId: source.pageId, sectionId: target.sectionId, index: target.pageCount })
      } else if (target.kind === 'page' || target.kind === 'root-page') {
        if (target.kind === 'root-page' && navigation.sectionsEnabled) {
          const rootOrder = navigation.files.entries.filter(entry => entry.type === 'page').map(entry => entry.pageId)
          let index = rootOrder.indexOf(target.pageId) + (after ? 1 : 0)
          if (source.layout === 'filesSections' && !source.sectionId && rootOrder.indexOf(source.pageId) < rootOrder.indexOf(target.pageId)) index -= 1
          void mutate({ type: 'movePage', layout: 'filesSections', pageId: source.pageId, sectionId: null, index })
        } else {
          let index = target.index + (after ? 1 : 0)
          const sameList = source.layout === layout
            && (layout !== 'filesSections' || (source.sectionId || null) === (target.sectionId || null))
          if (sameList) {
            const sourceOrder = layout === 'filesFlat' ? navigation.files.flatOrder
              : layout === 'type' ? navigation.type.order[target.type || source.pageType]
                : target.sectionId ? navigation.files.sections.find(section => section.id === target.sectionId)?.pageIds || []
                  : navigation.files.entries.filter(entry => entry.type === 'page').map(entry => entry.pageId)
            if (sourceOrder.indexOf(source.pageId) < target.index) index -= 1
          }
          void mutate({ type: 'movePage', layout, pageId: source.pageId, sectionId: target.sectionId || null, index })
        }
      }
    } catch { /* ignore non-Notebook drops */ }
  }

  const allowTypeGroupDrop = (event, type) => {
    if (published || pending || search.trim()) return
    event.preventDefault()
    setDropTarget(`type:${type}`)
  }

  const moveSectionByKey = (sectionId, direction) => {
    const entries = navigation?.files?.entries || []
    const index = entries.findIndex(entry => entry.type === 'section' && entry.sectionId === sectionId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= entries.length) return
    void mutate({ type: 'moveSection', sectionId, index: target })
  }

  const handleReorderKeyDown = (event, onMove) => {
    if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    onMove(event.key === 'ArrowUp' ? -1 : 1)
  }

  const rowActions = page => {
    const site = page.type === 'site' ? siteRowState(catalog.sites, page.siteId) : null
    const pageSection = navigation?.files?.sections?.find(section => section.pageIds.includes(page.id))
    const rootCount = navigation?.files?.entries?.filter(entry => entry.type === 'page').length || 0
    return (
      <details className={css.rowMenu} onClick={event => event.stopPropagation()}>
        <summary aria-label={`Actions for ${page.title}`}>•••</summary>
        <div className={css.rowMenuItems}>
          <button type="button" onClick={() => openPage(page)}>Open</button>
          {page.type !== 'site' && <button type="button" onClick={() => renamePage(page).catch(error => setMutationError(error.message))}>Rename</button>}
          {page.type === 'site' && <>
            <button type="button" onClick={() => runSiteAction(page, site?.status === 'running' ? 'stop' : 'start').catch(error => setMutationError(error.message))}>{site?.status === 'running' ? 'Stop' : 'Start'}</button>
            <button type="button" onClick={() => runSiteAction(page, 'restart').catch(error => setMutationError(error.message))}>Restart</button>
            <button type="button" onClick={() => navigate(`${page.route}?edit=true`)}>Edit Site</button>
            <button type="button" onClick={() => navigate(`${page.route}?rebind=true`)}>Rebind directory</button>
            <button type="button" onClick={() => navigate(`${page.route}?terminal=true`)}>Terminal</button>
            {page.productionUrl && <a href={page.productionUrl} target="_blank" rel="noreferrer">Open production URL</a>}
          </>}
          {navigation?.mode === 'files' && navigation.sectionsEnabled && <>
            {pageSection && <button type="button" onClick={() => mutate({ type: 'movePage', layout: 'filesSections', pageId: page.id, index: rootCount })}>Move to root</button>}
            {navigation.files.sections.filter(section => section.id !== pageSection?.id).map(section => <button key={section.id} type="button" onClick={() => mutate({ type: 'movePage', layout: 'filesSections', pageId: page.id, sectionId: section.id, index: section.pageIds.length })}>Move to {section.title}</button>)}
          </>}
          <button type="button" onClick={() => deletePage(page).catch(error => setMutationError(error.message))}>Delete page…</button>
        </div>
      </details>
    )
  }

  const renderPage = (page, { layout, sectionId = null, type = page.type, rootEntryIndex = null } = {}) => {
    const active = page.id === activePageId
    const matchesSearch = !search.trim() || `${page.title} ${page.type} ${page.status || ''}`.toLowerCase().includes(search.trim().toLowerCase())
    if (!matchesSearch) return null
    const order = layout === 'type' ? navigation?.type?.order?.[type] || []
      : layout === 'filesFlat' ? navigation?.files?.flatOrder || []
        : sectionId ? navigation?.files?.sections?.find(section => section.id === sectionId)?.pageIds || []
          : navigation?.files?.entries?.filter(entry => entry.type === 'page').map(entry => entry.pageId) || []
    const localIndex = order.indexOf(page.id)
    const siteState = page.type === 'site' ? siteRowState(catalog.sites, page.siteId) : null
    return (
      <div
        key={page.id}
        data-page-type={page.type}
        className={`${css.pageRow} ${active ? css.pageRowActive : ''} ${!page.available ? css.pageRowUnavailable : ''} ${dropTarget === `page:${page.id}:before` ? css.pageRowDropBefore : ''} ${dropTarget === `page:${page.id}:after` ? css.pageRowDropAfter : ''}`}
        onDragOver={event => {
          if (published || pending || search.trim()) return
          event.preventDefault()
          const bounds = event.currentTarget.getBoundingClientRect()
          const side = event.clientY > bounds.top + bounds.height / 2 ? 'after' : 'before'
          setDropTarget(`page:${page.id}:${side}`)
        }}
        onDragLeave={() => setDropTarget('')}
        onDrop={event => handleDrop(event, {
          kind: rootEntryIndex == null ? 'page' : 'root-page',
          pageId: page.id,
          sectionId,
          pageType: page.type,
          type,
          index: localIndex,
          rootIndex: rootEntryIndex,
        })}
      >
        <button type="button" className={css.pageButton} title={buttonTitle(page)} onClick={() => openPage(page)}>
          <span className={css.typeMark} aria-hidden="true">{TYPE_MARKS[page.type]}</span>
          <span className={css.pageTitle}>{page.title || page.id}</span>
          {!page.available && <span className={css.statusMark} aria-label="Unavailable" title={page.diagnostics?.[0]?.message || 'Unavailable'}>!</span>}
          {siteState && <span className={css.siteStatus} title={`Site ${siteState.status}`}>{siteState.status === 'running' ? '●' : '○'}</span>}
        </button>
        {!published && !search.trim() && <div className={css.rowTools}>
          <button
            type="button"
            className={css.dragHandle}
            draggable={!pending}
            aria-label={`Reorder ${page.title}. Use Alt+ArrowUp or Alt+ArrowDown to move.`}
            title="Drag to reorder. Use Alt+ArrowUp or Alt+ArrowDown to move."
            onDragStart={event => handleDragStart(event, { kind: 'page', pageId: page.id, pageType: page.type, layout, sectionId })}
            onDragEnd={() => setDropTarget('')}
            onKeyDown={event => handleReorderKeyDown(event, direction => reorderPage(page, direction, layout, sectionId, type))}
          >⠿</button>
          {rowActions(page)}
        </div>}
      </div>
    )
  }

  const addSection = () => {
    const title = window.prompt('Section name')
    if (title?.trim()) void mutate({ type: 'createSection', title: title.trim(), index: navigation.files.entries.length })
  }

  const changeTypeGroupOrder = (type, direction) => {
    const groups = [...navigation.type.groups]
    const index = groups.indexOf(type)
    const target = index + direction
    if (target < 0 || target >= groups.length) return
    ;[groups[index], groups[target]] = [groups[target], groups[index]]
    void mutate({ type: 'reorderTypeGroups', groups })
  }

  const fetchDiagnostics = async () => {
    setDiagnosticsOpen(true)
    try { setDiagnostics(await coreRequestJson('/_storyboard/diagnostics', { cache: 'no-store' })) }
    catch (cause) { setDiagnostics({ error: cause?.message || 'Could not load diagnostics.' }) }
  }

  const createDialogInitialValues = createContext && Object.keys(createContext).length ? createContext : null

  if (!enabled) return children

  return (
    <div className={`${css.shell} ${open ? css.shellOpen : css.shellClosed}`}>
      {open && <button type="button" className={css.mobileScrim} aria-label="Close notebook sidebar" onClick={() => saveOpen(false)} />}
      <aside className={css.sidebar} aria-label="Notebook pages" aria-hidden={!open}>
        <div className={css.sidebarHeader}>
          {published
            ? <span className={css.notebookButton}><span className={css.notebookGlyph}>▤</span><span>{catalog.title || 'Notebook'}</span></span>
            : <button type="button" className={css.notebookButton} onClick={() => setNotebookDialogOpen(true)} title="Switch notebook">
              <span className={css.notebookGlyph}>▤</span><span>{catalog.title || 'Notebook'}</span>
            </button>}
          <button type="button" className={css.iconButton} aria-label="Close notebook sidebar" onClick={() => saveOpen(false)}>×</button>
        </div>
        <div className={css.modeBar} role="group" aria-label="Sidebar organization">
          <button type="button" aria-pressed={navigation?.mode === 'type'} disabled={pending} onClick={() => changeSidebarMode('type')}>Type</button>
          <button type="button" aria-pressed={navigation?.mode === 'files'} disabled={pending} onClick={() => changeSidebarMode('files')}>Files</button>
          {navigation?.mode === 'files' && <button type="button" aria-pressed={navigation.sectionsEnabled} disabled={pending} onClick={() => changeSectionVisibility(!navigation.sectionsEnabled)}>Sections</button>}
        </div>
        <label className={css.searchLabel}>
          <span className={css.visuallyHidden}>Search pages</span>
          <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search pages" />
        </label>
        {error && <p className={css.error} role="alert">{error}</p>}
        {mutationError && <p className={css.error} role="alert">{mutationError}</p>}
        <nav ref={navRef} className={css.pageNavigation} aria-label="Primary pages" aria-busy={pending}>
          {navigation?.mode === 'type' ? entries.map(group => (
            <section key={group.key} className={css.group}>
              <header
                className={`${css.groupHeader} ${dropTarget === `type:${group.key}` ? css.groupDrop : ''}`}
                onDragOver={event => allowTypeGroupDrop(event, group.key)}
                onDragLeave={() => setDropTarget('')}
                onDrop={event => handleDrop(event, { kind: 'type-group', type: group.key })}
              >
                <button type="button" className={css.groupTitle} onClick={() => toggleCollapsed(group.key)} aria-expanded={!collapsed[group.key]}>
                  <span>{collapsed[group.key] ? '▸' : '▾'}</span>{group.title}<span className={css.groupCount}>{group.pages.length}</span>
                </button>
                {!published && !search.trim() && <div className={css.groupTools}>
                  <button
                    type="button"
                    className={css.dragHandle}
                    draggable={!pending}
                    aria-label={`Reorder ${group.title} group. Use Alt+ArrowUp or Alt+ArrowDown to move.`}
                    title="Drag to reorder. Use Alt+ArrowUp or Alt+ArrowDown to move."
                    onDragStart={event => handleDragStart(event, { kind: 'type-group', type: group.key })}
                    onDragEnd={() => setDropTarget('')}
                    onKeyDown={event => handleReorderKeyDown(event, direction => changeTypeGroupOrder(group.key, direction))}
                  >⠿</button>
                  <button type="button" aria-label={`Create ${group.title} page`} onClick={() => startCreate(group.key)}>＋</button>
                </div>}
              </header>
              {!collapsed[group.key] && <div className={css.pageList}>
                {group.pages.map((page, index) => renderPage(page, { layout: 'type', index, type: group.key }))}
                {group.pages.length === 0 && !search && !published && <button type="button" className={css.emptyGroupAction} onClick={() => startCreate(group.key)}>Create {group.title.slice(0, -1)}</button>}
              </div>}
            </section>
          )) : navigation?.sectionsEnabled ? (
            <>
              <div className={css.filesToolbar}><span>Files</span>{!published && !search.trim() && <button type="button" onClick={addSection}>New section</button>}</div>
              {entries.map((entry, index) => entry.type === 'section' ? (
                <section
                  key={entry.key}
                  className={css.group}
                  onDragOver={event => {
                    if (published || pending || search.trim()) return
                    event.preventDefault()
                    setDropTarget(entry.key)
                  }}
                  onDragLeave={() => setDropTarget('')}
                  onDrop={event => handleDrop(event, { kind: 'section', sectionId: entry.section.id, rootIndex: index, pageCount: entry.pages.length })}
                >
                  <header className={`${css.groupHeader} ${dropTarget === entry.key ? css.groupDrop : ''}`}>
                    <button type="button" className={css.groupTitle} onClick={() => toggleCollapsed(entry.key)} aria-expanded={!collapsed[entry.key]}>
                      <span>{collapsed[entry.key] ? '▸' : '▾'}</span>{entry.title}<span className={css.groupCount}>{entry.pages.length}</span>
                    </button>
                    {!published && !search.trim() && <div className={css.groupTools}>
                      <details className={css.rowMenu}>
                        <summary aria-label={`Create page in ${entry.title}`}>＋</summary>
                        <div className={css.rowMenuItems}>{['prototype', 'canvas', 'site'].map(type => <button key={type} type="button" onClick={() => startCreate(type, { sectionId: entry.section.id })}>New {TYPE_SINGULAR[type]}</button>)}</div>
                      </details>
                      <button type="button" aria-label={`Rename ${entry.title}`} onClick={() => { const title = window.prompt('Section name', entry.title); if (title?.trim()) void mutate({ type: 'renameSection', sectionId: entry.section.id, title: title.trim() }) }}>✎</button>
                      <button
                        type="button"
                        className={css.dragHandle}
                        draggable={!pending}
                        aria-label={`Reorder ${entry.title}. Use Alt+ArrowUp or Alt+ArrowDown to move.`}
                        title="Drag to reorder. Use Alt+ArrowUp or Alt+ArrowDown to move."
                        onDragStart={event => handleDragStart(event, { kind: 'section', sectionId: entry.section.id })}
                        onDragEnd={() => setDropTarget('')}
                        onKeyDown={event => handleReorderKeyDown(event, direction => moveSectionByKey(entry.section.id, direction))}
                      >⠿</button>
                      <button type="button" aria-label={`Remove ${entry.title}`} onClick={() => mutate({ type: 'removeSection', sectionId: entry.section.id })}>×</button>
                    </div>}
                  </header>
                  {!collapsed[entry.key] && <div className={css.pageList}>
                    {entry.pages.map((page, pageIndex) => renderPage(page, { layout: 'filesSections', index: pageIndex, sectionId: entry.section.id }))}
                    {!published && !search.trim() && <button type="button" className={css.dropHint} onClick={() => startCreate('prototype', { sectionId: entry.section.id })}>Add a page to this section</button>}
                  </div>}
                </section>
              ) : entry.pages.map(page => renderPage(page, { layout: 'filesSections', index, sectionId: null, rootEntryIndex: index })))}
            </>
          ) : (
            <section className={css.group}>
              <header className={css.groupHeader}><span className={css.groupTitle}>Files</span></header>
              <div className={css.pageList}>{(navigation?.files?.flatOrder || []).map(id => pageById.get(id)).filter(Boolean).map((page, index) => renderPage(page, { layout: 'filesFlat', index }))}</div>
            </section>
          )}
        </nav>
        <footer className={css.sidebarFooter}>
          <div className={css.sidebarFooterInfo}>
            <span>{catalog.pages.length} pages</span>
            {!published && <button type="button" onClick={() => setNotebookDialogOpen(true)}>Switch notebook</button>}
          </div>
          {!published && <div className={css.sidebarActions}>
            <details className={css.newPageMenu}>
              <summary>Create +</summary>
              <div>
                {['prototype', 'canvas', 'site'].map(type => <button key={type} type="button" onClick={() => startCreate(type, createContext)}>{TYPE_SINGULAR[type]}</button>)}
              </div>
            </details>
            <button type="button" onClick={() => setSettingsOpen(true)}>Settings</button>
            <button type="button" onClick={fetchDiagnostics}>Diagnostics</button>
          </div>}
        </footer>
      </aside>
      {!open && activePage?.type !== 'canvas' && <button type="button" className={css.reopenButton} onClick={() => saveOpen(true)} aria-label="Open notebook sidebar">☰</button>}
      <main className={css.content}>
        {activePage && !activePage.available ? (
          <section className={css.unavailable} role="status">
            <p className={css.unavailableEyebrow}>{TYPE_LABELS[activePage.type] || 'Page'}</p>
            <h1>{activePage.title || activePage.id}</h1>
            <p>This page is registered, but its source is unavailable or has a conflict.</p>
            <ul>{(activePage.diagnostics || []).map((item, index) => <li key={`${item.code}:${index}`}><strong>{item.code}</strong>: {item.message}</li>)}</ul>
            {!published && <button type="button" onClick={() => { setActivePageOverride(null); void refresh() }}>Refresh page status</button>}
          </section>
        ) : children}
      </main>
      {!published && <CreateDialog type={createType} basePath={import.meta.env.BASE_URL} initialValues={createDialogInitialValues} onClose={() => { setCreateType(null); setCreateContext(null) }} />}
      {!published && <NotebookDialog open={notebookDialogOpen} onOpenChange={setNotebookDialogOpen} variant="switcher" />}
      {!published && <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />}
      {!published && diagnosticsOpen && <div className={css.diagnosticsBackdrop} role="presentation" onClick={() => setDiagnosticsOpen(false)}>
        <section className={css.diagnosticsDialog} role="dialog" aria-modal="true" aria-labelledby="notebook-diagnostics-title" onClick={event => event.stopPropagation()}>
          <header><h2 id="notebook-diagnostics-title">Notebook diagnostics</h2><button type="button" onClick={() => setDiagnosticsOpen(false)}>Close</button></header>
          <pre>{JSON.stringify(diagnostics || { loading: true }, null, 2)}</pre>
        </section>
      </div>}
    </div>
  )
}
