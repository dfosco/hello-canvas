import { expect, it, vi } from 'vitest'
import { observeSiteFrameRoute } from './siteFrameRouteBridge.js'

it('observes Site history changes and reports route, query, hash, and browser-back state', () => {
  const childWindow = new EventTarget()
  childWindow.location = {
    origin: window.location.origin,
    href: `${window.location.origin}/branch--test/_storyboard/site/docs/preview/guide?mode=full#intro`,
  }
  childWindow.CustomEvent = CustomEvent
  childWindow.history = {
    pushState: (_state, _title, url) => { childWindow.location.href = new URL(url, childWindow.location.href).href },
    replaceState: (_state, _title, url) => { childWindow.location.href = new URL(url, childWindow.location.href).href },
  }
  const onRouteChange = vi.fn()
  const cleanup = observeSiteFrameRoute({ contentWindow: childWindow }, {
    siteId: 'docs',
    basePath: '/branch--test/',
    onRouteChange,
  })

  expect(onRouteChange).toHaveBeenLastCalledWith('guide?mode=full#intro', { replace: false })
  childWindow.history.pushState({}, '', '/explore?tab=all#top')
  expect(onRouteChange).toHaveBeenLastCalledWith('explore?tab=all#top', { replace: false })
  childWindow.history.replaceState({}, '', '/settings')
  expect(onRouteChange).toHaveBeenLastCalledWith('settings', { replace: true })
  childWindow.dispatchEvent(new PopStateEvent('popstate'))
  expect(onRouteChange).toHaveBeenLastCalledWith('settings', { replace: true })

  cleanup()
  const callCount = onRouteChange.mock.calls.length
  childWindow.history.pushState({}, '', '/after-cleanup')
  expect(onRouteChange).toHaveBeenCalledTimes(callCount)
})
