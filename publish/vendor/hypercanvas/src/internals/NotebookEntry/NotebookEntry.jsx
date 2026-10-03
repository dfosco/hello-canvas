import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { coreRequestJson } from '../../core/notebook/browserBridge.js'
import { getCustomerModeHomepage, isCustomerMode, resolveHomepageTarget } from '../../core/stores/customerModeConfig.js'
import css from './NotebookEntry.module.css'

function savedPageIds(navigation) {
  if (navigation?.mode === 'type') {
    return (navigation.type?.groups || []).flatMap(type => navigation.type?.order?.[type] || [])
  }
  if (!navigation?.sectionsEnabled) return navigation?.files?.flatOrder || []
  const sections = new Map((navigation.files?.sections || []).map(section => [section.id, section.pageIds || []]))
  return (navigation.files?.entries || []).flatMap(entry => entry.type === 'page'
    ? [entry.pageId]
    : sections.get(entry.sectionId) || [])
}

function pageEntryUrl(target, search, hash) {
  const params = new URLSearchParams(search || '')
  if (target?.diagnostics?.some(item => item.code === 'PAGE_ROUTE_CONFLICT')) params.set('_notebookPage', target.id)
  else params.delete('_notebookPage')
  const query = params.toString()
  return `${target.route}${query ? `?${query}` : ''}${hash || ''}`
}

export default function NotebookEntry() {
  const location = useLocation()
  const navigate = useNavigate()
  const [message, setMessage] = useState(() => {
    if (isCustomerMode() && getCustomerModeHomepage() === true) return ''
    if (import.meta.env.VITE_NOTEBOOK_PUBLISHED === '1' && !window.__HYPERCANVAS_NOTEBOOK_PUBLICATION__?.pages?.length) {
      return 'This publication does not contain any registered pages.'
    }
    return 'Opening notebook…'
  })

  useEffect(() => {
    let cancelled = false
    const homepage = getCustomerModeHomepage()
    if (isCustomerMode() && homepage !== false) {
      if (homepage === true) {
        return () => { cancelled = true }
      }
      const target = resolveHomepageTarget(homepage)
      if (/^https?:\/\//i.test(target)) window.location.replace(target)
      else if (target) navigate(target, { replace: true })
      return () => { cancelled = true }
    }

    if (import.meta.env.VITE_NOTEBOOK_PUBLISHED === '1') {
      const exported = window.__HYPERCANVAS_NOTEBOOK_PUBLICATION__
      const pages = Array.isArray(exported?.pages) ? exported.pages : []
      if (!pages.length) {
        return () => { cancelled = true }
      }
      let preference = {}
      try { preference = JSON.parse(window.localStorage.getItem(`hypercanvas:notebook:${exported.notebookId}:published-view`) || '{}') } catch { /* storage can be disabled */ }
      const navigation = {
        ...exported.navigation,
        mode: preference.mode === 'files' || preference.mode === 'type' ? preference.mode : exported.navigation?.mode,
        sectionsEnabled: typeof preference.sectionsEnabled === 'boolean' ? preference.sectionsEnabled : exported.navigation?.sectionsEnabled,
      }
      const pageById = new Map(pages.map(page => [page.id, page]))
      const target = savedPageIds(navigation).map(id => pageById.get(id)).find(Boolean) || pages[0]
      if (!target?.route) {
        queueMicrotask(() => {
          if (!cancelled) setMessage(`${target?.title || 'The first page'} is registered, but has no resolved route.`)
        })
        return () => { cancelled = true }
      }
      navigate(pageEntryUrl(target, location.search, location.hash), { replace: true })
      return () => { cancelled = true }
    }

    const controller = new AbortController()
    Promise.all([
      coreRequestJson('/_storyboard/notebook/pages', { cache: 'no-store', signal: controller.signal }),
      coreRequestJson('/_storyboard/notebook/navigation', { cache: 'no-store', signal: controller.signal }),
    ]).then(([catalog, saved]) => {
      if (cancelled) return
      const pages = Array.isArray(catalog.pages) ? catalog.pages : []
      if (!pages.length) {
        setMessage('This notebook has no pages yet. Use “New page” in the sidebar to create a Prototype, Canvas, or Site.')
        return
      }
      const pageById = new Map(pages.map(page => [page.id, page]))
      const target = savedPageIds(saved.navigation).map(id => pageById.get(id)).find(Boolean) || pages[0]
      if (!target?.route) {
        setMessage(`${target?.title || 'The first page'} is registered, but has no resolved route. Select it in the sidebar for diagnostics.`)
        return
      }
      navigate(pageEntryUrl(target, location.search, location.hash), { replace: true })
    }).catch(error => {
      if (!cancelled) setMessage(error?.message || 'Could not load this notebook. Open the sidebar and check Notebook diagnostics.')
    })
    return () => { cancelled = true; controller.abort() }
  }, [location.hash, location.search, navigate])

  return message ? (
    <main className={css.message}>
      <h1>Notebook</h1>
      <p role="status">{message}</p>
    </main>
  ) : null
}
