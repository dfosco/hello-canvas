import { afterEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import RunningSitesPanel from './RunningSitesPanel.jsx'
import { setNavigationRouter } from '../navigation/sbNavigate.js'

function renderPanel(props = {}) {
  return render(<RunningSitesPanel {...props} />)
}

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

it('keeps failures in the Sites tool panel without opening a duplicate Site sidebar', async () => {
  const siteFailed = vi.fn()
  const openDuplicateSidebar = vi.fn()
  document.addEventListener('storyboard:site-failed', siteFailed)
  document.addEventListener('storyboard:open-site-sidebar', openDuplicateSidebar)
  vi.stubGlobal('fetch', vi.fn(async input => {
    const url = String(input)
    if (url.endsWith('/_storyboard/site/list')) {
      return { ok: true, json: async () => ({ sites: [{ id: 'docs', title: 'Docs', binding: { status: 'stopped' } }] }) }
    }
    if (url.endsWith('/_storyboard/site/docs/start')) {
      return { ok: false, json: async () => ({ error: 'Site did not become healthy', code: 'SITE_START_FAILED' }) }
    }
    throw new Error(`Unexpected request: ${url}`)
  }))

  const view = renderPanel()
  fireEvent.click(await screen.findByRole('button', { name: 'Start' }))

  expect(await screen.findByText('Site did not become healthy')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /terminal output/i })).toBeNull()
  expect(siteFailed).toHaveBeenCalledWith(expect.objectContaining({ detail: { siteId: 'docs' } }))
  expect(openDuplicateSidebar).not.toHaveBeenCalled()
  view.unmount()
  document.removeEventListener('storyboard:site-failed', siteFailed)
  document.removeEventListener('storyboard:open-site-sidebar', openDuplicateSidebar)
})

it('keeps terminal output out of the Sites sidebar', async () => {
  let logRequests = 0
  vi.stubGlobal('fetch', vi.fn(async input => {
    const url = String(input)
    if (url.endsWith('/_storyboard/site/list')) {
      return { ok: true, json: async () => ({ sites: [{ id: 'docs', title: 'Docs', binding: { status: 'running' } }] }) }
    }
    if (url.endsWith('/_storyboard/site/docs/logs')) {
      logRequests += 1
      return {
        ok: true,
        json: async () => ({ logs: logRequests === 1 ? [] : [{ stream: 'terminal', message: 'vite ready on localhost' }] }),
      }
    }
    throw new Error(`Unexpected request: ${url}`)
  }))

  renderPanel()
  await screen.findByText('Docs')

  expect(screen.queryByRole('button', { name: /terminal output/i })).toBeNull()
  await new Promise(resolve => setTimeout(resolve, 30))
  expect(logRequests).toBe(0)
})

it('copies the binding base URL and lets the current SitePage toggle its terminal', async () => {
  const writeText = vi.fn(async () => {})
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ sites: [
      { id: 'docs', title: 'Docs', binding: { status: 'running', developmentBaseUrl: 'http://localhost:5173/' } },
      { id: 'draft', title: 'Draft', binding: null },
    ] }),
  })))

  window.history.replaceState(null, '', '/branch--demo/sites/docs/')
  const toggle = vi.fn()
  document.addEventListener('storyboard:site-terminal-toggle', toggle)
  renderPanel({ basePath: '/branch--demo/' })
  await screen.findByText('Docs')
  const docsCard = screen.getByText('Docs').closest('section')
  expect([...docsCard.querySelectorAll('button')].map(button => button.textContent.trim())).toEqual([
    'Stop',
    'Active',
    'Copy URL',
    'Open terminal',
    'Edit',
  ])
  expect([...docsCard.querySelectorAll('button')].find(button => button.textContent.trim() === 'Active').disabled).toBe(true)
  const draftCard = screen.getByText('Draft').closest('section')
  expect([...draftCard.querySelectorAll('button')].map(button => button.textContent.trim())).toEqual([
    'Start',
    'Switch',
    'Copy URL',
    'Open terminal',
    'Edit',
  ])
  expect([...draftCard.querySelectorAll('button')].find(button => button.textContent.trim() === 'Switch').disabled).toBe(true)
  const copyButtons = screen.getAllByRole('button', { name: 'Copy URL' })
  expect(copyButtons[1].disabled).toBe(true)
  fireEvent.click(copyButtons[0])
  expect(writeText).toHaveBeenCalledWith('http://localhost:5173/')

  fireEvent.click(screen.getAllByRole('button', { name: 'Open terminal' })[0])
  expect(toggle).toHaveBeenCalledWith(expect.objectContaining({ detail: { siteId: 'docs' } }))
  fireEvent(document, new CustomEvent('storyboard:site-terminal-state', { detail: { siteId: 'docs', open: true } }))
  expect(await screen.findByRole('button', { name: 'Close terminal' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Close terminal' }))
  expect(toggle).toHaveBeenCalledTimes(2)
  expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(2)
  document.removeEventListener('storyboard:site-terminal-toggle', toggle)
})

it('reflects terminal=true from the selected SitePage URL', async () => {
  window.history.replaceState(null, '', '/branch--demo/sites/docs/?terminal=true')
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ sites: [{ id: 'docs', title: 'Docs', binding: { status: 'running' } }] }),
  })))

  renderPanel({ basePath: '/branch--demo/' })

  expect(await screen.findByRole('button', { name: 'Close terminal' })).toBeTruthy()
})

it('opens a noncurrent Site viewer with its terminal requested in a new tab', async () => {
  const open = vi.fn()
  vi.stubGlobal('open', open)
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ sites: [
      { id: 'docs', title: 'Docs', binding: { status: 'running', developmentBaseUrl: 'http://localhost:5173/' } },
      { id: 'draft', title: 'Draft', binding: null },
    ] }),
  })))

  window.history.replaceState(null, '', '/branch--demo/workspace/')
  renderPanel({ basePath: '/branch--demo/' })
  await screen.findByText('Docs')

  fireEvent.click(screen.getAllByRole('button', { name: 'Open terminal' })[0])
  expect(open).toHaveBeenCalledWith('/branch--demo/sites/docs/?terminal=true', '_blank', 'noopener,noreferrer')
  expect(screen.queryByRole('button', { name: 'Open' })).toBeNull()
})

it('switches the viewed Site via sbNavigate and enables Switch for running or startable Sites', async () => {
  const navigate = vi.fn()
  setNavigationRouter({ navigate }, '')
  try {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ sites: [
        { id: 'docs', title: 'Docs', binding: { status: 'running', developmentBaseUrl: 'http://localhost:5173/' } },
        { id: 'draft', title: 'Draft', binding: { status: 'running', developmentBaseUrl: 'http://localhost:5174/' } },
        { id: 'archived', title: 'Archived', binding: { status: 'stopped' } },
        { id: 'pending', title: 'Pending', binding: { source: 'managed', startCommand: 'npm run dev', status: 'stopped' } },
      ] }),
    })))

    window.history.replaceState(null, '', '/branch--demo/sites/docs/')
    renderPanel({ basePath: '/branch--demo/' })
    await screen.findByText('Docs')

    const draftCard = screen.getByText('Draft').closest('section')
    const switchButton = [...draftCard.querySelectorAll('button')].find(button => button.textContent.trim() === 'Switch')
    expect(switchButton.disabled).toBe(false)
    fireEvent.click(switchButton)
    expect(navigate).toHaveBeenCalledWith('/branch--demo/sites/draft/', { replace: false })

    const archivedCard = screen.getByText('Archived').closest('section')
    expect([...archivedCard.querySelectorAll('button')].find(button => button.textContent.trim() === 'Switch').disabled).toBe(true)

    // A stopped managed Site can be opened: navigating starts its server.
    const pendingCard = screen.getByText('Pending').closest('section')
    const pendingSwitch = [...pendingCard.querySelectorAll('button')].find(button => button.textContent.trim() === 'Switch')
    expect(pendingSwitch.disabled).toBe(false)
    fireEvent.click(pendingSwitch)
    expect(navigate).toHaveBeenCalledWith('/branch--demo/sites/pending/', { replace: false })
  } finally {
    setNavigationRouter(null)
  }
})

it('refreshes the Sites list when sites-changed is dispatched', async () => {
  let listRequests = 0
  vi.stubGlobal('fetch', vi.fn(async input => {
    if (!String(input).endsWith('/_storyboard/site/list')) throw new Error(`Unexpected request: ${input}`)
    listRequests += 1
    return {
      ok: true,
      json: async () => ({ sites: [{ id: 'docs', title: listRequests > 1 ? 'Docs refreshed' : 'Docs', binding: { status: 'running' } }] }),
    }
  }))

  renderPanel()
  await screen.findByText('Docs')
  fireEvent(document, new CustomEvent('storyboard:sites-changed'))

  expect(await screen.findByText('Docs refreshed')).toBeTruthy()
  expect(listRequests).toBe(2)
})

it('preserves Start and Stop actions', async () => {
  let status = 'running'
  const fetchMock = vi.fn(async input => {
    const url = String(input)
    if (url.endsWith('/_storyboard/site/list')) {
      return { ok: true, json: async () => ({ sites: [{ id: 'docs', title: 'Docs', binding: { status } }] }) }
    }
    if (url.endsWith('/_storyboard/site/docs/stop')) {
      status = 'stopped'
      return { ok: true, json: async () => ({}) }
    }
    throw new Error(`Unexpected request: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)

  renderPanel()
  fireEvent.click(await screen.findByRole('button', { name: 'Stop' }))

  expect(await screen.findByRole('button', { name: 'Start' })).toBeTruthy()
  expect(fetchMock).toHaveBeenCalledWith('/_storyboard/site/docs/stop', expect.objectContaining({ method: 'POST' }))
})
