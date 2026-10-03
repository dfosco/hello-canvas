/**
 * Inspector Mouse Mode — DOM element selection via hover + click.
 *
 * When activated, draws a highlight overlay on the hovered element and
 * shows a tooltip with the React component name.  Clicking selects the
 * element and returns its info via the onSelect callback.
 *
 * Usage:
 *   import { createMouseMode } from './mouseMode.js'
 *   const mode = createMouseMode({
 *     onSelect: (el) => console.log('Selected:', el),
 *     onDeactivate: () => console.log('Cancelled'),
 *   })
 *   mode.activate()
 *   // later: mode.deactivate()
 */

import { getFiberFromElement, getComponentInfo } from './fiberWalker.js'

/**
 * @typedef {Object} MouseModeOptions
 * @property {(el: Element) => void} onSelect  Called when user clicks an element
 * @property {() => void} [onDeactivate]       Called when mode is exited (Escape or programmatic)
 */

/**
 * @typedef {Object} MouseModeHandle
 * @property {() => void} activate   Start inspector mouse mode
 * @property {() => void} deactivate Stop inspector mouse mode
 * @property {() => boolean} isActive Whether mouse mode is currently active
 */

/**
 * Create an inspector mouse mode instance.
 *
 * @param {MouseModeOptions} options
 * @returns {MouseModeHandle}
 */
export function createMouseMode(options = {}) {
  const { onSelect, onDeactivate } = options

  let active = false
  let overlay = null
  let tooltip = null
  let currentTarget = null
  let highlightedEl = null
  let scrollTimer = null

  // ---------------------------------------------------------------------------
  // Overlay / tooltip creation
  // ---------------------------------------------------------------------------

  function createOverlay() {
    overlay = document.createElement('div')
    overlay.id = 'sb-inspector-overlay'
    Object.assign(overlay.style, {
      position: 'fixed',
      pointerEvents: 'none',
      zIndex: '9997',
      border: '2px solid var(--color-foreground-accent, #7655a4)',
      backgroundColor: 'rgba(118, 85, 164, 0.08)',
      borderRadius: '3px',
      transition: 'top 0.06s ease, left 0.06s ease, width 0.06s ease, height 0.06s ease',
      display: 'none',
    })
    document.body.appendChild(overlay)
  }

  function createTooltip() {
    tooltip = document.createElement('div')
    tooltip.id = 'sb-inspector-tooltip'
    Object.assign(tooltip.style, {
      position: 'fixed',
      pointerEvents: 'none',
      zIndex: '9997',
      backgroundColor: 'var(--color-foreground-accent, #7655a4)',
      color: '#fff',
      fontSize: '11px',
      fontFamily: '"Hubot Sans", ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
      fontWeight: '600',
      padding: '3px 8px',
      borderRadius: '4px',
      whiteSpace: 'nowrap',
      display: 'none',
      boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
    })
    document.body.appendChild(tooltip)
  }

  function removeElements() {
    overlay?.remove()
    tooltip?.remove()
    overlay = null
    tooltip = null
  }

  // ---------------------------------------------------------------------------
  // Positioning
  // ---------------------------------------------------------------------------

  function positionOverlay(el) {
    if (!overlay || !tooltip) return

    const rect = el.getBoundingClientRect()
    overlay.style.display = 'block'
    overlay.style.top = `${rect.top}px`
    overlay.style.left = `${rect.left}px`
    overlay.style.width = `${rect.width}px`
    overlay.style.height = `${rect.height}px`

    // Get component name for tooltip
    const fiber = getFiberFromElement(el)
    const info = fiber ? getComponentInfo(fiber) : null
    const label = info?.name || el.tagName.toLowerCase()

    tooltip.textContent = `<${label}>`
    tooltip.style.display = 'block'

    // Position tooltip above the element, or below if no space
    const tooltipHeight = 24
    const gap = 6
    if (rect.top > tooltipHeight + gap) {
      tooltip.style.top = `${rect.top - tooltipHeight - gap}px`
    } else {
      tooltip.style.top = `${rect.bottom + gap}px`
    }
    tooltip.style.left = `${rect.left}px`
  }

  function hideOverlay() {
    if (overlay) overlay.style.display = 'none'
    if (tooltip) tooltip.style.display = 'none'
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  function shouldIgnore(el) {
    // Ignore storyboard UI elements
    if (el.closest('[data-core-ui-bar]')) return true
    if (el.closest('#sb-core-ui')) return true
    if (el.closest('#sb-inspector-overlay')) return true
    if (el.closest('#sb-inspector-tooltip')) return true
    if (el.closest('.sb-plugin-root')) return true
    if (el.closest('[data-slot="panel-content"]')) return true
    if (el.closest('[data-sidepanel]')) return true
    return false
  }

  function handleMouseMove(e) {
    const el = e.target
    if (!el || shouldIgnore(el)) {
      hideOverlay()
      currentTarget = null
      return
    }
    currentTarget = el
    positionOverlay(el)
  }

  function handleClick(e) {
    if (!currentTarget) return
    if (shouldIgnore(e.target)) return

    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()

    const selected = currentTarget
    deactivate()
    onSelect?.(selected)
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      deactivate()
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  function activate() {
    if (active) return
    active = true

    createOverlay()
    createTooltip()

    // Capture phase so we intercept before any other handler
    document.addEventListener('mousemove', handleMouseMove, true)
    document.addEventListener('click', handleClick, true)
    document.addEventListener('keydown', handleKeydown, true)

    // Change cursor to crosshair on the page
    document.documentElement.style.cursor = 'crosshair'
  }

  function deactivate() {
    if (!active) return
    active = false

    document.removeEventListener('mousemove', handleMouseMove, true)
    document.removeEventListener('click', handleClick, true)
    document.removeEventListener('keydown', handleKeydown, true)

    document.documentElement.style.cursor = ''
    currentTarget = null

    removeElements()
    onDeactivate?.()
  }

  function isActive() {
    return active
  }

  /**
   * Reposition the persistent highlight after scrolling stops.
   */
  function handleScroll() {
    // Hide during scroll for smoother feel
    if (overlay) overlay.style.display = 'none'
    if (tooltip) tooltip.style.display = 'none'

    clearTimeout(scrollTimer)
    scrollTimer = setTimeout(() => {
      if (highlightedEl) positionOverlay(highlightedEl)
    }, 80)
  }

  /**
   * Show a persistent highlight on an element (used after selection).
   * Creates the overlay if needed, positions it, and leaves it visible.
   * Listens for scroll to reposition.
   */
  function showHighlight(el) {
    if (!overlay) createOverlay()
    if (!tooltip) createTooltip()
    highlightedEl = el
    positionOverlay(el)
    window.addEventListener('scroll', handleScroll, true)
  }

  /**
   * Remove the persistent highlight.
   */
  function hideHighlight() {
    highlightedEl = null
    clearTimeout(scrollTimer)
    window.removeEventListener('scroll', handleScroll, true)
    removeElements()
  }

  return { activate, deactivate, isActive, showHighlight, hideHighlight }
}
