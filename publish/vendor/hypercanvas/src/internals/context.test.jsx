import { act, render, screen } from '@testing-library/react'
import { useContext } from 'react'
import { init } from '../core/index.js'
import StoryboardProvider, { StoryboardContext } from './context.jsx'


const mockUseLocation = vi.fn(() => ({ pathname: '/', search: '', hash: '' }))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useParams: vi.fn(() => ({})),
    useLocation: (...args) => mockUseLocation(...args),
  }
})

beforeEach(() => {
  init({
    flows: {
      default: { title: 'Default Scene' },
      other: { title: 'Other Scene' },
    },
    objects: {},
    records: {},
  })
})

/** Helper component that reads context and renders it. */
function ContextReader({ path }) {
  const ctx = useContext(StoryboardContext)
  if (!ctx) return <span>no context</span>
  if (ctx.error) return <span>error: {ctx.error}</span>
  const value = path ? ctx.data?.[path] : JSON.stringify(ctx)
  return <span data-testid="ctx">{String(value)}</span>
}

describe('StoryboardProvider', () => {
  it('renders children when flow loads successfully', () => {
    render(
      <StoryboardProvider>
        <span>child content</span>
      </StoryboardProvider>,
    )
    expect(screen.getByText('child content')).toBeInTheDocument()
  })

  it('shows a reconnect state when the Core websocket disconnects', () => {
    render(
      <StoryboardProvider>
        <span>workspace content</span>
      </StoryboardProvider>,
    )
    act(() => window.dispatchEvent(new CustomEvent('storyboard:core-connection', { detail: { state: 'disconnected' } })))
    expect(screen.getByRole('status')).toHaveTextContent('Hypercanvas is disconnected')
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument()
    act(() => window.dispatchEvent(new CustomEvent('storyboard:core-connection', { detail: { state: 'connected' } })))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('does not show a Core reconnect overlay in a static publication', () => {
    vi.stubGlobal('__HYPERCANVAS_NOTEBOOK_PUBLICATION__', true)
    render(
      <StoryboardProvider>
        <span>published workspace content</span>
      </StoryboardProvider>,
    )
    act(() => window.dispatchEvent(new CustomEvent('storyboard:core-connection', { detail: { state: 'disconnected' } })))
    expect(screen.getByText('published workspace content')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('provides flow data via context', () => {
    render(
      <StoryboardProvider>
        <ContextReader path="title" />
      </StoryboardProvider>,
    )
    expect(screen.getByTestId('ctx')).toHaveTextContent('Default Scene')
  })

  it('uses flowName prop when provided', () => {
    render(
      <StoryboardProvider flowName="other">
        <ContextReader path="title" />
      </StoryboardProvider>,
    )
    expect(screen.getByTestId('ctx')).toHaveTextContent('Other Scene')
  })

  it('uses sceneName prop for backward compat', () => {
    render(
      <StoryboardProvider sceneName="other">
        <ContextReader path="title" />
      </StoryboardProvider>,
    )
    expect(screen.getByTestId('ctx')).toHaveTextContent('Other Scene')
  })

  it("falls back to 'default' flow when no ?scene= param", () => {
    render(
      <StoryboardProvider>
        <ContextReader path="title" />
      </StoryboardProvider>,
    )
    expect(screen.getByTestId('ctx')).toHaveTextContent('Default Scene')
  })

  it('shows error message when flow fails to load', () => {
    render(
      <StoryboardProvider flowName="nonexistent">
        <ContextReader />
      </StoryboardProvider>,
    )
    expect(screen.getByText(/Error loading flow/)).toBeInTheDocument()
  })

  it('provides flowName in context value', () => {
    function FlowNameReader() {
      const ctx = useContext(StoryboardContext)
      return <span data-testid="name">{ctx?.flowName}</span>
    }
    render(
      <StoryboardProvider flowName="other">
        <FlowNameReader />
      </StoryboardProvider>,
    )
    expect(screen.getByTestId('name')).toHaveTextContent('other')
  })

  it('provides sceneName (backward compat) in context value', () => {
    function SceneNameReader() {
      const ctx = useContext(StoryboardContext)
      return <span data-testid="name">{ctx?.sceneName}</span>
    }
    render(
      <StoryboardProvider flowName="other">
        <SceneNameReader />
      </StoryboardProvider>,
    )
    expect(screen.getByTestId('name')).toHaveTextContent('other')
  })

  it('provides loading: false in context value', () => {
    function LoadingReader() {
      const ctx = useContext(StoryboardContext)
      return <span data-testid="loading">{String(ctx?.loading)}</span>
    }
    render(
      <StoryboardProvider>
        <LoadingReader />
      </StoryboardProvider>,
    )
    expect(screen.getByTestId('loading')).toHaveTextContent('false')
  })

  it('auto-matches flow by pathname and resolves $ref data', () => {
    init({
      flows: {
        default: { title: 'Default' },
        Repositories: {
          '$global': ['navigation'],
          heading: 'All repos',
        },
      },
      objects: {
        navigation: { topnav: [{ label: 'Home' }, { label: 'Repos' }] },
      },
      records: {},
    })

    // Simulate navigating to /base/Repositories
    mockUseLocation.mockReturnValue({ pathname: '/base/Repositories', search: '', hash: '' })

    render(
      <StoryboardProvider>
        <ContextReader path="heading" />
      </StoryboardProvider>,
    )
    expect(screen.getByTestId('ctx')).toHaveTextContent('All repos')
  })

  it('resolves $ref objects when auto-matching flow by pathname', () => {
    init({
      flows: {
        default: { title: 'Default' },
        Repositories: {
          '$global': ['navigation'],
          heading: 'All repos',
        },
      },
      objects: {
        navigation: { topnav: [{ label: 'Home' }, { label: 'Repos' }] },
      },
      records: {},
    })

    mockUseLocation.mockReturnValue({ pathname: '/base/Repositories', search: '', hash: '' })

    function NavReader() {
      const ctx = useContext(StoryboardContext)
      const topnav = ctx?.data?.topnav
      return <span data-testid="nav">{topnav ? topnav.map(n => n.label).join(',') : 'none'}</span>
    }

    render(
      <StoryboardProvider>
        <NavReader />
      </StoryboardProvider>,
    )
    // $global navigation object should be resolved — topnav merged at root
    expect(screen.getByTestId('nav')).toHaveTextContent('Home,Repos')
  })

  it('reads ?flow= param from location.search', () => {
    mockUseLocation.mockReturnValue({ pathname: '/whatever', search: '?flow=other', hash: '' })

    render(
      <StoryboardProvider>
        <ContextReader path="title" />
      </StoryboardProvider>,
    )
    expect(screen.getByTestId('ctx')).toHaveTextContent('Other Scene')
  })

  it('reads ?scene= as alias for ?flow=', () => {
    mockUseLocation.mockReturnValue({ pathname: '/whatever', search: '?scene=other', hash: '' })

    render(
      <StoryboardProvider>
        <ContextReader path="title" />
      </StoryboardProvider>,
    )
    expect(screen.getByTestId('ctx')).toHaveTextContent('Other Scene')
  })

  it('prefers ?flow= over ?scene= when both present', () => {
    mockUseLocation.mockReturnValue({ pathname: '/whatever', search: '?flow=other&scene=default', hash: '' })

    render(
      <StoryboardProvider>
        <ContextReader path="title" />
      </StoryboardProvider>,
    )
    expect(screen.getByTestId('ctx')).toHaveTextContent('Other Scene')
  })

  it('loads prototype flow for sub-pages when no page-specific flow exists', () => {
    init({
      flows: {
        default: { title: 'Global Default' },
        'Example/example': { title: 'Example Flow' },
      },
      objects: {},
      records: {},
    })

    // /Example/Forms — no Forms flow exists, should fall back to Example/example
    mockUseLocation.mockReturnValue({ pathname: '/Example/Forms', search: '', hash: '' })

    render(
      <StoryboardProvider>
        <ContextReader path="title" />
      </StoryboardProvider>,
    )
    expect(screen.getByTestId('ctx')).toHaveTextContent('Example Flow')
  })

  it('page-specific flow takes priority over prototype flow', () => {
    init({
      flows: {
        default: { title: 'Global Default' },
        'Example/example': { title: 'Example Flow' },
        'Example/Forms': { title: 'Forms Flow' },
      },
      objects: {},
      records: {},
    })

    mockUseLocation.mockReturnValue({ pathname: '/Example/Forms', search: '', hash: '' })

    render(
      <StoryboardProvider>
        <ContextReader path="title" />
      </StoryboardProvider>,
    )
    expect(screen.getByTestId('ctx')).toHaveTextContent('Forms Flow')
  })

  it('falls to global default when no prototype flow exists', () => {
    init({
      flows: {
        default: { title: 'Global Default' },
      },
      objects: {},
      records: {},
    })

    mockUseLocation.mockReturnValue({ pathname: '/NoProto/SomePage', search: '', hash: '' })

    render(
      <StoryboardProvider>
        <ContextReader path="title" />
      </StoryboardProvider>,
    )
    expect(screen.getByTestId('ctx')).toHaveTextContent('Global Default')
  })

  it('shows a simple 404 for unknown canvas routes with an index link', () => {
    mockUseLocation.mockReturnValue({ pathname: '/canvas/unknown-board', search: '', hash: '' })

    render(
      <StoryboardProvider>
        <ContextReader />
      </StoryboardProvider>,
    )

    expect(screen.getByText('Canvas not found')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /go to index page/i })).toHaveAttribute('href', '/')
  })

  it('strips dev-domain prefix in local dev (Caddy proxy) so canvas routes resolve', () => {
    // Local dev via Caddy: window.location.pathname includes the /{devDomain}/
    // prefix even though BASE_URL is `/` (the proxy strips it before forwarding
    // to the dev server). Without stripping, isCanvasPath returns false and the
    // 404 never renders — the canvas page just stays blank.
    const origLocalDev = window.__SB_LOCAL_DEV__
    const origDomain = window.__SB_DEV_DOMAIN__
    window.__SB_LOCAL_DEV__ = true
    window.__SB_DEV_DOMAIN__ = 'storyboard'
    try {
      mockUseLocation.mockReturnValue({ pathname: '/storyboard/canvas/unknown-board', search: '', hash: '' })

      render(
        <StoryboardProvider>
          <ContextReader />
        </StoryboardProvider>,
      )

      expect(screen.getByText('Canvas not found')).toBeInTheDocument()
    } finally {
      window.__SB_LOCAL_DEV__ = origLocalDev
      window.__SB_DEV_DOMAIN__ = origDomain
    }
  })

  it('does not strip dev-domain prefix when __SB_LOCAL_DEV__ is not set', () => {
    // Same URL shape, but production-like: prefix should be left alone so it
    // doesn't accidentally match canvas routes for unrelated path segments.
    const origDomain = window.__SB_DEV_DOMAIN__
    window.__SB_DEV_DOMAIN__ = 'storyboard'
    try {
      mockUseLocation.mockReturnValue({ pathname: '/storyboard/canvas/unknown-board', search: '', hash: '' })

      render(
        <StoryboardProvider>
          <ContextReader />
        </StoryboardProvider>,
      )

      // isCanvasPath sees `/storyboard/canvas/...` → does NOT start with `/canvas/`
      // → no 404, just renders flow context
      expect(screen.queryByText('Canvas not found')).not.toBeInTheDocument()
    } finally {
      window.__SB_DEV_DOMAIN__ = origDomain
    }
  })
})
