import { afterEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import SiteEditMenu from './SiteEditMenu.jsx'

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

function CurrentLocation() {
  const { pathname, search, hash } = useLocation()
  return <output data-testid="current-location">{`${pathname}${search}${hash}`}</output>
}

it('links edit actions to the current Site route and preserves its query and hash', async () => {
  render(<MemoryRouter initialEntries={['/branch--demo/sites/docs/guide?mode=full#intro']}>
    <div id="sb-core-ui">
      <SiteEditMenu site={{ id: 'docs', title: 'Docs' }} basePath="/branch--demo/" />
    </div>
    <CurrentLocation />
  </MemoryRouter>)

  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  const editLink = await screen.findByRole('menuitem', { name: 'Edit metadata' })
  const portal = editLink.closest('[data-base-ui-portal]')
  expect(portal?.parentElement).toBe(document.body)
  expect(editLink.closest('#sb-core-ui')).toBeNull()
  expect(editLink.parentElement?.parentElement?.style.zIndex).toBe('10001')
  expect(editLink.getAttribute('href')).toBe('/branch--demo/sites/docs/guide?mode=full&edit=true#intro')
  fireEvent.click(editLink)
  expect(await screen.findByTestId('current-location')).toHaveTextContent('/branch--demo/sites/docs/guide?mode=full&edit=true#intro')

  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  const rebindLink = await screen.findByRole('menuitem', { name: 'Rebind directory' })
  expect(rebindLink.getAttribute('href')).toBe('/branch--demo/sites/docs/guide?mode=full&rebind=true#intro')
})

it('opens the Site viewer with edit metadata when launched from another route', async () => {
  render(<MemoryRouter initialEntries={['/branch--demo/workspace?section=sites']}>
    <SiteEditMenu site={{ id: 'docs', title: 'Docs' }} basePath="/branch--demo/" />
  </MemoryRouter>)

  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  const editLink = await screen.findByRole('menuitem', { name: 'Edit metadata' })
  expect(editLink.getAttribute('href')).toBe('/branch--demo/sites/docs/?edit=true')
})

it('removes the Site and notifies listeners and the caller after success', async () => {
  const order = []
  const onSitesChanged = () => order.push('sites-changed')
  const onSiteRemoved = event => order.push(`site-removed:${event.detail.siteId}`)
  const onRemoved = () => order.push('onRemoved')
  const onError = vi.fn()
  document.addEventListener('storyboard:sites-changed', onSitesChanged)
  document.addEventListener('storyboard:site-removed', onSiteRemoved)
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })))

  render(<MemoryRouter initialEntries={['/branch--demo/workspace?section=sites']}>
    <SiteEditMenu site={{ id: 'docs' }} basePath="/branch--demo/" onRemoved={onRemoved} onError={onError} />
  </MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove Site' }))

  await waitFor(() => expect(order).toEqual(['sites-changed', 'site-removed:docs', 'onRemoved']))
  expect(fetch).toHaveBeenCalledWith('/branch--demo/_storyboard/site/docs', { method: 'DELETE' })
  expect(onError).not.toHaveBeenCalled()
  document.removeEventListener('storyboard:sites-changed', onSitesChanged)
  document.removeEventListener('storyboard:site-removed', onSiteRemoved)
})

it('passes a failed removal message to onError', async () => {
  const onRemoved = vi.fn()
  const onError = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: 'Site is still in use' }) })))

  render(<MemoryRouter initialEntries={['/workspace?section=sites']}>
    <SiteEditMenu site={{ id: 'docs' }} onRemoved={onRemoved} onError={onError} />
  </MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove Site' }))

  await waitFor(() => expect(onError).toHaveBeenCalledWith('Site is still in use'))
  expect(onRemoved).not.toHaveBeenCalled()
})
