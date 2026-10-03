import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Menu } from '@base-ui/react/menu'
import * as DropdownMenu from '../lib/components/ui/dropdown-menu/index.js'
import { siteViewerPath } from '../../internals/siteFrameRouteBridge.js'

const popupClassName = 'font-sans data-[open]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[open]:fade-in-0 data-[closed]:zoom-out-95 data-[open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ring-foreground/10 z-[10000] bg-popover border-3 border-border text-popover-foreground fill-popover-foreground min-w-[180px] rounded-xl p-2 shadow-xl duration-100 overflow-x-hidden overflow-y-auto'

function isSiteViewerPath(pathname, basePath, siteId) {
  const sitePath = siteViewerPath(basePath, siteId).replace(/\/$/, '')
  return pathname === sitePath || pathname.startsWith(`${sitePath}/`)
}

function editPath(mode, site, basePath, location, isCurrentSite) {
  const pathname = isCurrentSite ? location.pathname : siteViewerPath(basePath, site.id)
  const search = new URLSearchParams(isCurrentSite ? location.search : '')
  search.delete('edit')
  search.delete('rebind')
  search.set(mode, 'true')
  return `${pathname}?${search.toString()}${isCurrentSite ? location.hash : ''}`
}

export default function SiteEditMenu({ site, basePath = '/', onRemoved, onError }) {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!site?.id) return null

  const base = (basePath || '/').replace(/\/+$/, '')
  const isCurrentSite = isSiteViewerPath(location.pathname, basePath, site.id)

  async function removeSite() {
    if (busy) return
    setBusy(true)
    try {
      const response = await fetch(`${base}/_storyboard/site/${encodeURIComponent(site.id)}`, { method: 'DELETE' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.error || 'Could not remove Site')
      document.dispatchEvent(new CustomEvent('storyboard:sites-changed'))
      document.dispatchEvent(new CustomEvent('storyboard:site-removed', { detail: { siteId: site.id } }))
      onRemoved?.()
    } catch (cause) {
      onError?.(cause?.message || 'Could not remove Site')
    } finally {
      setBusy(false)
    }
  }

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger>
        <button type="button">Edit</button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal container={typeof document === 'undefined' ? undefined : document.body}>
        <Menu.Positioner side="bottom" align="end" sideOffset={8} style={{ zIndex: 10001 }}>
          <Menu.Popup className={popupClassName}>
            <DropdownMenu.Item render={<Link to={editPath('edit', site, basePath, location, isCurrentSite)} />}>
              Edit metadata
            </DropdownMenu.Item>
            <DropdownMenu.Item render={<Link to={editPath('rebind', site, basePath, location, isCurrentSite)} />}>
              Rebind directory
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item variant="destructive" disabled={busy} onClick={removeSite}>
              Remove Site
            </DropdownMenu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
