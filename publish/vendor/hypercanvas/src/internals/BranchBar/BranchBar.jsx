/**
 * BranchBar — blue accent bar showing current branch and local dev status.
 *
 * Dev: always visible (main or branch). Shows "Local development" label.
 * Prod: shows on non-main branches only.
 *
 * Renders via portal as the first child of <body> so that its sticky
 * positioning pushes the entire page (including absolutely positioned items) down.
 */
import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { GitBranchIcon } from '@primer/octicons-react'
import { useBranches } from './useBranches.js'
import ChromeSlot from '../../core/ui/ChromeSlot.jsx'
import { isMenuHidden } from '../../core/stores/uiConfig.js'
import css from './BranchBar.module.css'

/** Check if we're in local dev mode (respects ?prodMode simulation). */
function checkLocalDev() {
  if (typeof window === 'undefined') return false
  if (new URLSearchParams(window.location.search).has('prodMode')) return false
  return window.__SB_LOCAL_DEV__ === true
}

/** Read the dev domain color injected by the server plugin, validated via CSS.supports. */
function getDevDomainColor() {
  if (typeof window === 'undefined') return null
  const color = window.__SB_DEV_DOMAIN_COLOR__
  if (!color) return null
  if (typeof CSS !== 'undefined' && CSS.supports && !CSS.supports('color', color)) return null
  return color
}

/** Get or create the portal container at the top of body. */
function getPortalContainer() {
  if (typeof document === 'undefined') return null
  let el = document.getElementById('sb-branch-bar-root')
  if (!el) {
    el = document.createElement('div')
    el.id = 'sb-branch-bar-root'
    document.body.prepend(el)
  }
  return el
}

export default function BranchBar({ basePath }) {
  const [hidden, setHidden] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('storyboard-chrome-hidden')
  )

  const isHiddenByParam = useMemo(() => {
    if (typeof window === 'undefined') return false
    const params = new URLSearchParams(window.location.search)
    return params.has('_sb_hide_branch_bar') || params.has('_sb_embed')
  }, [])

  const { currentBranch } = useBranches(basePath)

  const isLocalDev = checkLocalDev()
  const isOnBranch = currentBranch !== 'main'
  const domainColor = isLocalDev ? getDevDomainColor() : null
  const isHiddenByConfig = isMenuHidden('branch-bar')

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setHidden(document.documentElement.classList.contains('storyboard-chrome-hidden'))
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  if ((!isOnBranch && !isLocalDev) || hidden || isHiddenByParam || isHiddenByConfig) return null

  const portalContainer = getPortalContainer()
  if (!portalContainer) return null

  function hideChrome() {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: '.', metaKey: true, bubbles: true,
    }))
  }

  return createPortal(
    <ChromeSlot id="branch-bar:root" surface="branch-bar" ctx={{ currentBranch, isLocalDev }}>
      <div className={css.bar} data-branch-bar>
        <div
          className={`${css.barInner}${isLocalDev ? '' : ` ${css.barProd}`}`}
          style={domainColor ? { '--sb-branch-bar-bg': domainColor } : undefined}
        >
          <ChromeSlot id="branch-bar:label" surface="branch-bar" ctx={{ currentBranch, isLocalDev }}>
            <span className={css.barLabel}>
              {isLocalDev && window.__SB_DEV_DOMAIN__ && <>
                <span className={css.barDomainName}>⌘ {window.__SB_DEV_DOMAIN__}</span>
                <span className={css.barSeparator}>·</span>
              </>}
              <GitBranchIcon size={12} />
              <span className={css.barBranchName}>{currentBranch}</span>
              {isLocalDev && <>
                <span className={css.barSeparator}>·</span>
                <span>Local development</span>
              </>}
            </span>
          </ChromeSlot>
          <div className={css.barActions}>
            <ChromeSlot id="branch-bar:hide-button" surface="branch-bar" ctx={{ currentBranch, isLocalDev }}>
              <button className={css.barAction} onClick={hideChrome}>Hide</button>
            </ChromeSlot>
          </div>
        </div>
      </div>
    </ChromeSlot>,
    portalContainer
  )
}
