import { createRef } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import SiteFrame from './SiteFrame.jsx'

const routeBridge = vi.hoisted(() => ({ onRouteChange: null }))
vi.mock('../../../siteFrameRouteBridge.js', async importOriginal => ({
  ...await importOriginal(),
  observeSiteFrameRoute: vi.fn((_, { onRouteChange }) => {
    routeBridge.onRouteChange = onRouteChange
    return vi.fn()
  }),
}))

const SNAPSHOT_READ = 'frame-snapshot?kind=site'

function stubSnapshotFetch({ descriptor = null, captured = null } = {}) {
  return vi.fn(async (url, options) => {
    if (String(url).includes(SNAPSHOT_READ)) {
      return { ok: true, json: async () => ({ snapshot: descriptor }) }
    }
    if (String(url).endsWith('/frame-snapshot') && options?.method === 'POST') {
      return { ok: true, json: async () => ({ snapshot: captured ?? descriptor }) }
    }
    throw new Error(`Unexpected fetch: ${url}`)
  })
}

/** Stub that also answers Site status/start lifecycle endpoints. */
function stubSiteFetch({ binding = {}, descriptor = null, startError = null } = {}) {
  return vi.fn(async (url, options) => {
    const href = String(url)
    if (href.includes(SNAPSHOT_READ)) return { ok: true, json: async () => ({ snapshot: descriptor }) }
    if (href.endsWith('/frame-snapshot') && options?.method === 'POST') {
      return { ok: true, json: async () => ({ snapshot: descriptor }) }
    }
    if (href.endsWith('/status')) return { ok: true, json: async () => ({ binding }) }
    if (href.endsWith('/start')) {
      if (startError) return { ok: false, json: async () => ({ error: startError }) }
      return { ok: true, json: async () => ({ binding: { ...binding, status: 'running' } }) }
    }
    throw new Error(`Unexpected fetch: ${href}`)
  })
}

function dispatchGateActivation(widgetId) {
  document.dispatchEvent(new CustomEvent('storyboard:interact-gate-activated', {
    detail: { widgetId, widgetType: 'site-frame' },
  }))
}

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); delete window.__SB_LOCAL_DEV__ })

beforeEach(() => {
  // Authoring runtime flag: enables the live preview path under test.
  window.__SB_LOCAL_DEV__ = true
})

it('refreshes only SiteFrames targeting the Site that started', async () => {
  const fetcher = stubSnapshotFetch()
  vi.stubGlobal('fetch', fetcher)
  render(<SiteFrame props={{ siteId: 'alpha' }} />)
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))

  document.dispatchEvent(new CustomEvent('storyboard:site-started', { detail: { siteId: 'beta' } }))
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(fetcher).toHaveBeenCalledTimes(1)

  document.dispatchEvent(new CustomEvent('storyboard:site-started', { detail: { siteId: 'alpha' } }))
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
})

it('renders the prototype-style top bar with a globe icon, title, and route', () => {
  const fetcher = stubSnapshotFetch()
  vi.stubGlobal('fetch', fetcher)
  const { getByTestId } = render(<SiteFrame props={{ siteId: 'docs', title: 'Docs', route: 'guide' }} />)
  const header = getByTestId('site-frame').querySelector('header')
  expect(header.querySelector('svg')).toBeTruthy()
  expect(header.textContent).toContain('Docs')
  expect(header.textContent).toContain('guide')
})

it('builds the namespaced Site URL from Site ID and actual route', async () => {
  const descriptor = { status: 'ready', light: { dataUrl: 'data:image/png;base64,AAAA' }, dark: null, sourceKey: 'a'.repeat(32) }
  const fetcher = stubSnapshotFetch({ descriptor })
  vi.stubGlobal('fetch', fetcher)
  const { getByTitle } = render(<SiteFrame id="frame-1" props={{ siteId: 'docs', route: 'guide/setup', title: 'Docs' }} />)

  dispatchGateActivation('frame-1')

  await waitFor(() => expect(getByTitle('Docs').getAttribute('src')).toBe('/_storyboard/site/docs/preview/guide/setup'))
  expect(fetcher.mock.calls[0][0]).toContain('siteId=docs')
  expect(fetcher.mock.calls[0][0]).toContain('route=guide%2Fsetup')
})

it('persists the route navigated to inside a canvas Site Frame', async () => {
  const descriptor = { status: 'ready', light: { dataUrl: 'data:image/png;base64,AAAA' }, dark: null, sourceKey: 'a'.repeat(32) }
  const fetcher = stubSnapshotFetch({ descriptor })
  const onUpdate = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const { getByTitle } = render(<SiteFrame id="frame-1" props={{ siteId: 'docs', route: 'guide', title: 'Docs' }} onUpdate={onUpdate} />)

  dispatchGateActivation('frame-1')

  const frame = await waitFor(() => getByTitle('Docs'))
  fireEvent.load(frame)

  routeBridge.onRouteChange('explore?tab=all#top')

  expect(onUpdate).toHaveBeenCalledWith({ route: 'explore?tab=all#top' })
})

it('renders no internal interact gate and stays dormant until the chrome gate activates', async () => {
  const descriptor = { status: 'ready', light: { dataUrl: 'data:image/png;base64,AAAA' }, dark: null, sourceKey: 'a'.repeat(32) }
  const fetcher = stubSnapshotFetch({ descriptor })
  vi.stubGlobal('fetch', fetcher)
  const { queryByRole, queryByTitle } = render(<SiteFrame id="frame-1" props={{ siteId: 'docs', title: 'Docs' }} />)
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))

  // The internal gate is gone — the chrome interact gate is the only one.
  expect(queryByRole('button', { name: 'Click to interact' })).toBeNull()
  expect(queryByTitle('Docs')).toBeNull()

  dispatchGateActivation('frame-2')
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(queryByTitle('Docs')).toBeNull()
})

it('activates from the external interact gate and starts a stopped Site', async () => {
  const binding = { source: 'managed', status: 'stopped', startCommand: 'npm run dev' }
  const descriptor = { status: 'ready', light: { dataUrl: 'data:image/png;base64,AAAA' }, dark: null, sourceKey: 'a'.repeat(32) }
  const fetcher = stubSiteFetch({ binding, descriptor })
  vi.stubGlobal('fetch', fetcher)
  const { getByTitle, queryByTitle } = render(<SiteFrame id="frame-1" props={{ siteId: 'docs', title: 'Docs' }} />)
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
  expect(queryByTitle('Docs')).toBeNull()

  dispatchGateActivation('frame-1')

  await waitFor(() => expect(getByTitle('Docs').getAttribute('src')).toBe('/_storyboard/site/docs/preview/'))
  const startCall = fetcher.mock.calls.find(([url]) => String(url).endsWith('/docs/start'))
  expect(startCall).toBeTruthy()
  expect(startCall[0]).toContain('/_storyboard/site/docs/start')
  expect(JSON.parse(startCall[1].body)).toMatchObject({ confirmed: true, timeoutMs: 30000 })
})

it('does not start a Site that is already running', async () => {
  const binding = { source: 'managed', status: 'running', startCommand: 'npm run dev' }
  const descriptor = { status: 'ready', light: { dataUrl: 'data:image/png;base64,AAAA' }, dark: null, sourceKey: 'a'.repeat(32) }
  const fetcher = stubSiteFetch({ binding, descriptor })
  vi.stubGlobal('fetch', fetcher)
  const { getByTitle } = render(<SiteFrame id="frame-1" props={{ siteId: 'docs', title: 'Docs' }} />)
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))

  dispatchGateActivation('frame-1')

  await waitFor(() => expect(getByTitle('Docs')).toBeTruthy())
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/docs/start'))).toBe(false)
})

it('does not start URL-bound Sites', async () => {
  const binding = { source: 'url', status: 'stopped', developmentBaseUrl: 'http://127.0.0.1:4321/' }
  const descriptor = { status: 'ready', light: { dataUrl: 'data:image/png;base64,AAAA' }, dark: null, sourceKey: 'a'.repeat(32) }
  const fetcher = stubSiteFetch({ binding, descriptor })
  vi.stubGlobal('fetch', fetcher)
  const { getByTitle } = render(<SiteFrame id="frame-1" props={{ siteId: 'docs', title: 'Docs' }} />)
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))

  dispatchGateActivation('frame-1')

  await waitFor(() => expect(getByTitle('Docs')).toBeTruthy())
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/docs/start'))).toBe(false)
})

it('shows the start failure when the Site server cannot start', async () => {
  const binding = { source: 'managed', status: 'stopped', startCommand: 'npm run dev' }
  const descriptor = { status: 'ready', light: { dataUrl: 'data:image/png;base64,AAAA' }, dark: null, sourceKey: 'a'.repeat(32) }
  const fetcher = stubSiteFetch({ binding, descriptor, startError: 'Site did not become healthy before timeout: docs' })
  vi.stubGlobal('fetch', fetcher)
  const { getByText } = render(<SiteFrame id="frame-1" props={{ siteId: 'docs', title: 'Docs' }} />)
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))

  dispatchGateActivation('frame-1')

  await waitFor(() => expect(getByText('Site did not become healthy before timeout: docs')).toBeTruthy())
})

it('uses prototype-sized chrome and persists resize dimensions', () => {
  const onUpdate = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async url => String(url).includes('/_storyboard/site/list')
    ? { ok: true, json: async () => ({ sites: [] }) }
    : Promise.reject(new Error(`Unexpected fetch: ${url}`))))
  const { getByTestId, getByRole, rerender } = render(<SiteFrame props={null} onUpdate={onUpdate} resizable />)
  const frame = getByTestId('site-frame')
  expect(frame.style.width).toBe('800px')
  expect(frame.style.height).toBe('600px')
  expect(frame.textContent).toContain('Choose a Site')

  Object.defineProperties(frame, {
    offsetWidth: { configurable: true, value: 800 },
    offsetHeight: { configurable: true, value: 600 },
  })
  fireEvent.mouseDown(getByRole('separator', { name: 'Resize' }), { clientX: 10, clientY: 10 })
  fireEvent.mouseMove(document, { clientX: 110, clientY: 60 })
  fireEvent.mouseUp(document)
  expect(onUpdate).toHaveBeenCalledWith({ width: 900, height: 650 })

  rerender(<SiteFrame props={{ width: 900, height: 650 }} onUpdate={onUpdate} resizable />)
  expect(frame.style.width).toBe('900px')
  expect(frame.style.height).toBe('650px')
})

it('lists available Sites in the empty frame and binds the selected Site', async () => {
  const onUpdate = vi.fn()
  const fetcher = vi.fn(async url => {
    if (String(url).includes('/_storyboard/site/list')) {
      return {
        ok: true,
        json: async () => ({ sites: [
          { id: 'docs', title: 'Documentation' },
          { id: 'shop', title: 'Shop' },
        ] }),
      }
    }
    throw new Error(`Unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetcher)

  const { getByRole } = render(<SiteFrame id="frame-1" props={{}} onUpdate={onUpdate} />)
  const docsOption = await waitFor(() => getByRole('button', { name: 'Use Documentation' }))

  expect(getByRole('group', { name: 'Choose a Site' })).toBeTruthy()
  expect(getByRole('button', { name: 'Use Shop' })).toBeTruthy()
  fireEvent.pointerDown(docsOption)
  fireEvent.click(docsOption)

  expect(onUpdate).toHaveBeenCalledWith({ siteId: 'docs', title: 'Documentation', route: '' })
  expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/_storyboard/site/list'))
})

it('opens its Site viewer route and refreshes the Site preview using frame actions', async () => {
  const open = vi.fn()
  const descriptor = { status: 'ready', light: { dataUrl: 'data:image/png;base64,AAAA' }, dark: null, sourceKey: 'a'.repeat(32) }
  const fetcher = stubSnapshotFetch({ descriptor })
  vi.stubGlobal('open', open)
  vi.stubGlobal('fetch', fetcher)
  const frameRef = createRef()
  render(<SiteFrame ref={frameRef} props={{ siteId: 'docs', route: 'guide' }} />)
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))

  act(() => frameRef.current.handleAction('open-external'))
  expect(open).toHaveBeenCalledWith('/sites/docs/guide', '_blank', 'noopener,noreferrer')
  act(() => frameRef.current.handleAction('refresh-frame'))
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
  expect(fetcher.mock.calls[2][0]).toContain('frame-snapshot')
  expect(JSON.parse(fetcher.mock.calls[2][1].body)).toMatchObject({ force: true, kind: 'site', siteId: 'docs' })
  expect(frameRef.current.handleAction('unrelated-action')).toBe(false)
})

it('renders published Site Frames as a poster linked to the production URL', async () => {
  // No authoring flag: the widget behaves as it does in a published notebook.
  delete window.__SB_LOCAL_DEV__
  const { getByRole } = render(<SiteFrame props={{
    siteId: 'docs',
    title: 'Docs',
    snapshot: 'assets/canvas/snapshots/frames/abc/light.png',
    openUrl: 'https://example.com/docs/guide',
  }} />)
  const link = getByRole('link', { name: 'Docs' })
  expect(link.getAttribute('href')).toBe('https://example.com/docs/guide')
  expect(link.querySelector('img')?.getAttribute('src')).toBe('assets/canvas/snapshots/frames/abc/light.png')
  expect(() => getByRole('button', { name: 'Click to interact' })).toThrow()
})

it('surfaces a failed capture as an error state instead of an eternal capture indicator', async () => {
  const fetcher = vi.fn(async url => {
    if (String(url).includes(SNAPSHOT_READ)) {
      return { ok: true, json: async () => ({ snapshot: { status: 'missing', light: null, dark: null } }) }
    }
    return { ok: false, status: 409, json: async () => ({ error: 'Site is not running: docs', code: 'SITE_NOT_RUNNING' }) }
  })
  vi.stubGlobal('fetch', fetcher)
  const { container } = render(<SiteFrame props={{ siteId: 'docs', route: 'guide' }} />)
  await waitFor(() => expect(container.textContent).toContain('Site is not running'), { timeout: 3000 })
  expect(container.textContent).not.toContain('Capturing preview')
})

it('surfaces an unavailable preview service instead of an eternal capture indicator', async () => {
  const fetcher = vi.fn(async url => String(url).includes(SNAPSHOT_READ)
    ? { ok: false, status: 404, json: async () => ({ error: 'Not found' }) }
    : { ok: false, status: 404, json: async () => ({ error: 'Not found' }) })
  vi.stubGlobal('fetch', fetcher)
  const { container } = render(<SiteFrame props={{ siteId: 'docs' }} />)
  await waitFor(() => expect(container.textContent).toContain('Preview service unavailable'), { timeout: 3000 })
  expect(container.textContent).not.toContain('Capturing preview')
})

it('prefers an explicit manual snapshot and shows it while the Site is down', async () => {
  const fetcher = vi.fn(async () => { throw new Error('Core unavailable') })
  vi.stubGlobal('fetch', fetcher)
  const { container } = render(<SiteFrame props={{ siteId: 'docs', snapshot: '/assets/manual.png' }} />)
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(container.querySelector('img')?.getAttribute('src')).toBe('/assets/manual.png')
  expect(container.textContent).not.toContain('Preview unavailable')
})
