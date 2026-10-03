import { afterEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import SitePage from './SitePage.jsx'

const routeBridge = vi.hoisted(() => ({ onRouteChange: null }))
vi.mock('../siteFrameRouteBridge.js', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    observeSiteFrameRoute: vi.fn((_, { onRouteChange }) => {
      routeBridge.onRouteChange = onRouteChange
      return vi.fn()
    }),
  }
})

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

function CurrentLocation() {
  const { pathname, search, hash } = useLocation()
  return <output data-testid="current-location">{`${pathname}${search}${hash}`}</output>
}

function ChangeSearchButton({ name, params }) {
  const [, setParams] = useSearchParams()
  return <button type="button" onClick={() => setParams(params)}>{name}</button>
}

function NavigateButton({ name, to }) {
  const navigate = useNavigate()
  return <button type="button" onClick={() => navigate(to)}>{name}</button>
}

it('loads a deep-linked Site route at a branch-prefixed Core URL without adding the Site ID to its upstream', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ site: {
    id: 'my-site', title: 'My Site', binding: { status: 'running', developmentBaseUrl: 'http://127.0.0.1:4321/' },
  } }) })))
  const view = render(<MemoryRouter initialEntries={['/branch--test/sites/my-site/guide?mode=full#intro']}><Routes><Route path="/branch--test/sites/:siteId/*" element={<SitePage basePath="/branch--test/" />} /></Routes></MemoryRouter>)
  const frame = await screen.findByTitle('My Site')
  expect(frame.tagName).toBe('IFRAME')
  expect(frame.getAttribute('src')).toBe('/branch--test/_storyboard/site/my-site/preview/guide?mode=full#intro')
  expect(view.container.querySelector('main > header')).toBeNull()
  expect(view.queryByRole('status')).toBeNull()
  expect(view.queryByRole('navigation', { name: 'Site tools' })).toBeNull()
  expect(view.queryByRole('button', { name: 'Stop Site' })).toBeNull()
  expect(view.queryByRole('button', { name: 'Edit Site metadata' })).toBeNull()
  expect(view.queryByRole('button', { name: 'Rebind directory' })).toBeNull()
})

it('omits the Site-specific top bar without changing the Site route', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ site: {
    id: 'my-site', title: 'My Site', binding: { status: 'stopped' },
  } }) })))
  const view = render(<MemoryRouter initialEntries={['/branch--test/sites/my-site/']}>
    <CurrentLocation />
    <Routes>
      <Route path="/branch--test/sites/:siteId/*" element={<SitePage basePath="/branch--test/" />} />
    </Routes>
  </MemoryRouter>)

  await screen.findByText('Site is stopped')
  expect(view.container.querySelector('main > header')).toBeNull()
  expect(screen.getByTestId('current-location').textContent).toBe('/branch--test/sites/my-site/')
})

it('keeps editor query parameters out of the Site iframe URL', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ site: {
    id: 'my-site', title: 'My Site', binding: { status: 'running', developmentBaseUrl: 'http://127.0.0.1:4321/' },
  } }) })))
  render(<MemoryRouter initialEntries={['/sites/my-site/?edit=true']}><Routes><Route path="/sites/:siteId/*" element={<SitePage />} /></Routes></MemoryRouter>)
  expect((await screen.findByTitle('My Site')).getAttribute('src')).toBe('/_storyboard/site/my-site/preview/')
  expect(await screen.findByRole('dialog', { name: 'Edit Site metadata' })).toBeTruthy()
})

it('opens metadata and rebind dialogs when the query changes without remounting', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ site: {
    id: 'my-site', title: 'My Site', binding: { status: 'stopped' },
  } }) })))
  render(<MemoryRouter initialEntries={['/sites/my-site/']}>
    <ChangeSearchButton name="Open rebind" params={{ rebind: 'true' }} />
    <ChangeSearchButton name="Open edit" params={{ edit: 'true' }} />
    <Routes><Route path="/sites/:siteId/*" element={<SitePage />} /></Routes>
  </MemoryRouter>)

  await screen.findByText('Site is stopped')
  fireEvent.click(screen.getByRole('button', { name: 'Open rebind' }))
  expect(await screen.findByRole('dialog', { name: 'Rebind directory' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  fireEvent.click(screen.getByRole('button', { name: 'Open edit' }))
  expect(await screen.findByRole('dialog', { name: 'Edit Site metadata' })).toBeTruthy()
})

it('updates a branch-prefixed Core URL when the embedded Site changes route', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ site: {
    id: 'my-site', title: 'My Site', binding: { status: 'running', developmentBaseUrl: 'http://127.0.0.1:4321/' },
  } }) })))
  render(<MemoryRouter initialEntries={['/branch--test/sites/my-site/']}>
    <CurrentLocation />
    <Routes><Route path="/branch--test/sites/:siteId/*" element={<SitePage basePath="/branch--test/" />} /></Routes>
  </MemoryRouter>)
  const frame = await screen.findByTitle('My Site')
  fireEvent.load(frame)

  routeBridge.onRouteChange('explore?mode=grid#top')

  await waitFor(() => expect(screen.getByTestId('current-location').textContent).toBe('/branch--test/sites/my-site/explore?mode=grid#top'))
})

it('opens terminal output from the URL, synchronizes its state, and supports resizing', async () => {
  const terminalStates = []
  const onTerminalState = event => terminalStates.push(event.detail)
  document.addEventListener('storyboard:site-terminal-state', onTerminalState)
  vi.stubGlobal('fetch', vi.fn(async url => String(url).endsWith('/logs')
    ? ({ ok: true, json: async () => ({ logs: [] }) })
    : ({ ok: true, json: async () => ({ site: {
      id: 'my-site', title: 'My Site', binding: { status: 'running', developmentBaseUrl: 'http://127.0.0.1:4321/' },
    } }) })))
  const view = render(<MemoryRouter initialEntries={['/sites/my-site/?terminal=true']}>
    <CurrentLocation />
    <NavigateButton name="Change route query" to="/sites/my-site/guide?terminal=true&mode=changed#hash" />
    <Routes><Route path="/sites/:siteId/*" element={<SitePage />} /></Routes>
  </MemoryRouter>)
  const frame = await screen.findByTitle('My Site')
  expect(frame.getAttribute('src')).toBe('/_storyboard/site/my-site/preview/')

  await screen.findByRole('separator', { name: 'Resize terminal output' })
  expect(terminalStates.at(-1)).toEqual({ siteId: 'my-site', open: true })
  fireEvent(document, new CustomEvent('storyboard:site-terminal-toggle', { detail: { siteId: 'other-site' } }))
  expect(view.getByLabelText('Site terminal output')).toBeTruthy()
  fireEvent(document, new CustomEvent('storyboard:site-terminal-toggle', { detail: { siteId: 'my-site' } }))
  await waitFor(() => expect(view.queryByLabelText('Site terminal output')).toBeNull())
  expect(document.documentElement.dataset.siteTerminalOpen).toBeUndefined()
  expect(document.documentElement.style.getPropertyValue('--site-terminal-toolbar-offset')).toBe('')
  expect(terminalStates.at(-1)).toEqual({ siteId: 'my-site', open: false })
  fireEvent(document, new CustomEvent('storyboard:site-terminal-toggle', { detail: { siteId: 'my-site' } }))
  expect(await view.findByLabelText('Site terminal output')).toBeTruthy()

  const separator = view.getByRole('separator', { name: 'Resize terminal output' })
  const output = view.getByLabelText('Site terminal output')
  await waitFor(() => expect(document.documentElement.dataset.siteTerminalOpen).toBe('true'))
  expect(document.documentElement.style.getPropertyValue('--site-terminal-toolbar-offset')).toBe('244px')
  const pageChildren = Array.from(view.container.querySelector('main').children)
  expect(pageChildren.indexOf(frame)).toBeLessThan(pageChildren.indexOf(separator))
  expect(pageChildren.indexOf(separator)).toBeLessThan(pageChildren.indexOf(output))
  const stateCount = terminalStates.length
  fireEvent.click(screen.getByRole('button', { name: 'Change route query' }))
  expect(await screen.findByTestId('current-location')).toHaveTextContent('/sites/my-site/guide?terminal=true&mode=changed#hash')
  await waitFor(() => expect(terminalStates.length).toBeGreaterThan(stateCount))
  expect(terminalStates.at(-1)).toEqual({ siteId: 'my-site', open: true })

  const startingHeight = Number(separator.getAttribute('aria-valuenow'))
  fireEvent.pointerDown(separator, { clientY: 200 })
  fireEvent.pointerMove(separator, { clientY: 170 })
  expect(Number(separator.getAttribute('aria-valuenow'))).toBe(startingHeight + 30)
  fireEvent.pointerUp(separator)

  fireEvent.keyDown(separator, { key: 'ArrowDown' })
  expect(Number(separator.getAttribute('aria-valuenow'))).toBe(startingHeight + 14)
  document.removeEventListener('storyboard:site-terminal-state', onTerminalState)
})

it('shows the stopped state without rendering a Site top bar', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ site: {
    id: 'my-site', title: 'My Site', binding: { status: 'stopped' },
  } }) })))
  render(<MemoryRouter initialEntries={['/sites?id=my-site']}><SitePage /></MemoryRouter>)
  expect(await screen.findByText('Site is stopped')).toBeTruthy()
  expect(screen.queryByRole('banner')).toBeNull()
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Start Site' })).toBeNull()
})

it('reloads the active Site iframe when that Site starts', async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ site: {
      id: 'my-site', title: 'My Site', binding: { status: 'stopped' },
    } }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ site: {
      id: 'my-site', title: 'My Site', binding: { status: 'running', developmentBaseUrl: 'http://127.0.0.1:4321/' },
    } }) })
  vi.stubGlobal('fetch', fetcher)
  render(<MemoryRouter initialEntries={['/sites?id=my-site']}><SitePage /></MemoryRouter>)
  expect(await screen.findByText('Site is stopped')).toBeTruthy()
  document.dispatchEvent(new CustomEvent('storyboard:site-started', { detail: { siteId: 'my-site' } }))
  const originalFrame = await screen.findByTitle('My Site')
  expect(originalFrame.getAttribute('src')).toBe('/_storyboard/site/my-site/preview/')
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it('shows the missing-folder status without toolbar recovery actions', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ site: { id: 'gone', title: 'Gone', missing: true, binding: { status: 'stopped', root: '/missing' } } }) })))
  render(<MemoryRouter initialEntries={['/sites?id=gone']}><SitePage /></MemoryRouter>)
  expect(await screen.findByText('Site folder is missing')).toBeTruthy()
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Rebind directory' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Start Site' })).toBeNull()
})

it('returns to the branch-prefixed Notebook entry when the viewed Site is removed', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ site: {
    id: 'my-site', title: 'My Site', binding: { status: 'stopped' },
  } }) })))
  render(<MemoryRouter initialEntries={['/branch--test/sites/my-site/']}>
    <CurrentLocation />
    <Routes>
      <Route path="/branch--test/sites/:siteId/*" element={<SitePage basePath="/branch--test/" />} />
      <Route path="/branch--test/" element={<h1>Notebook entry</h1>} />
    </Routes>
  </MemoryRouter>)
  await screen.findByText('Site is stopped')
  fireEvent(document, new CustomEvent('storyboard:site-removed', { detail: { siteId: 'other-site' } }))
  expect(screen.getByTestId('current-location').textContent).toBe('/branch--test/sites/my-site/')
  fireEvent(document, new CustomEvent('storyboard:site-removed', { detail: { siteId: 'my-site' } }))
  expect(await screen.findByText('Notebook entry')).toBeTruthy()
  expect(screen.getByTestId('current-location').textContent).toBe('/branch--test/')
})

it('starts a stopped managed Site automatically when opened', async () => {
  const startBodies = []
  let siteStatus = 'stopped'
  const fetcher = vi.fn(async (input, init) => {
    const url = String(input)
    if (url.endsWith('/start')) {
      startBodies.push(JSON.parse(init?.body))
      siteStatus = 'running'
      return { ok: true, json: async () => ({ binding: { status: 'running', developmentBaseUrl: 'http://127.0.0.1:4321/' } }) }
    }
    return { ok: true, json: async () => ({ site: {
      id: 'my-site', title: 'My Site',
      binding: {
        source: 'managed', startCommand: 'npm run dev', root: '/projects/my-site', status: siteStatus,
        ...(siteStatus === 'running' ? { developmentBaseUrl: 'http://127.0.0.1:4321/' } : {}),
      },
    } }) }
  })
  vi.stubGlobal('fetch', fetcher)
  render(<MemoryRouter initialEntries={['/sites?id=my-site']}><SitePage /></MemoryRouter>)
  const frame = await screen.findByTitle('My Site')
  expect(frame.getAttribute('src')).toBe('/_storyboard/site/my-site/preview/')
  expect(startBodies).toEqual([{ confirmed: true, timeoutMs: 30000 }])
})

it('shows the starting state while the automatic start runs', async () => {
  vi.stubGlobal('fetch', vi.fn(async input => String(input).endsWith('/start')
    ? new Promise(() => {})
    : { ok: true, json: async () => ({ site: {
      id: 'my-site', title: 'My Site', binding: { source: 'managed', startCommand: 'npm run dev', root: '/projects/my-site', status: 'stopped' },
    } }) }))
  render(<MemoryRouter initialEntries={['/sites?id=my-site']}><SitePage /></MemoryRouter>)
  expect(await screen.findByText('Site is starting')).toBeTruthy()
  expect(screen.queryByRole('status')).toBeNull()
})

it('surfaces an automatic start failure once, with the terminal output open', async () => {
  let startCalls = 0
  const fetcher = vi.fn(async input => {
    const url = String(input)
    if (url.endsWith('/start')) {
      startCalls += 1
      return { ok: false, json: async () => ({ error: 'Site did not become healthy before timeout: my-site', code: 'SITE_START_FAILED' }) }
    }
    if (url.endsWith('/logs')) return { ok: true, json: async () => ({ logs: [{ stream: 'terminal', message: 'boom' }] }) }
    return { ok: true, json: async () => ({ site: {
      id: 'my-site', title: 'My Site', binding: { source: 'managed', startCommand: 'npm run dev', root: '/projects/my-site', status: 'error' },
    } }) }
  })
  vi.stubGlobal('fetch', fetcher)
  render(<MemoryRouter initialEntries={['/sites?id=my-site']}><SitePage /></MemoryRouter>)
  expect(await screen.findByText('Site did not become healthy before timeout: my-site')).toBeTruthy()
  expect(await screen.findByText('Site failed to start')).toBeTruthy()
  expect(await screen.findByLabelText('Site terminal output')).toBeTruthy()
  await new Promise(resolve => setTimeout(resolve, 50))
  expect(startCalls).toBe(1)
})

it('treats a cancelled automatic start as benign and stays stopped', async () => {
  vi.stubGlobal('fetch', vi.fn(async input => String(input).endsWith('/start')
    ? { ok: false, json: async () => ({ error: 'Site start was cancelled', code: 'SITE_START_CANCELLED' }) }
    : { ok: true, json: async () => ({ site: {
      id: 'my-site', title: 'My Site', binding: { source: 'managed', startCommand: 'npm run dev', root: '/projects/my-site', status: 'stopped' },
    } }) }))
  render(<MemoryRouter initialEntries={['/sites?id=my-site']}><SitePage /></MemoryRouter>)
  expect(await screen.findByText('Site is stopped')).toBeTruthy()
  expect(screen.queryByText('Site start was cancelled')).toBeNull()
  expect(screen.queryByLabelText('Site terminal output')).toBeNull()
})

it('follows a start that began elsewhere until the preview is running', async () => {
  let siteStatus = 'starting'
  vi.stubGlobal('fetch', vi.fn(async input => {
    if (String(input).endsWith('/start')) throw new Error('Unexpected automatic start')
    return { ok: true, json: async () => ({ site: {
      id: 'my-site', title: 'My Site',
      binding: {
        source: 'managed', startCommand: 'npm run dev', root: '/projects/my-site', status: siteStatus,
        ...(siteStatus === 'running' ? { developmentBaseUrl: 'http://127.0.0.1:4321/' } : {}),
      },
    } }) }
  }))
  render(<MemoryRouter initialEntries={['/sites?id=my-site']}><SitePage /></MemoryRouter>)
  expect(await screen.findByText('Site is starting')).toBeTruthy()
  siteStatus = 'running'
  await waitFor(() => expect(screen.getByTitle('My Site').getAttribute('src')).toBe('/_storyboard/site/my-site/preview/'), { timeout: 2500 })
})
