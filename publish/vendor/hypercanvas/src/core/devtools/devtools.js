/**
 * Storyboard Core UI Bar — React-based floating toolbar.
 *
 * Mounts the CoreUIBar React component into the DOM.
 * Contains the command menu and mode-specific buttons (workshop, etc.).
 * Uses dynamic import() for the React component to avoid
 * breaking non-React test environments.
 *
 * Usage:
 *   import { mountDevTools } from '../index.js'
 *   mountDevTools() // call once at app startup
 */

let root = null
let wrapper = null
let skipLink = null

/**
 * Mount the Storyboard Core UI Bar to the DOM.
 * Call once at app startup. Safe to call multiple times (no-ops after first).
 *
 * @param {object} [options]
 * @param {HTMLElement} [options.container=document.body] - Where to mount
 * @param {string} [options.basePath='/'] - Base URL path
 * @param {object} [options.toolbarConfig] - Merged toolbar config
 * @param {Record<string, () => Promise<any>>} [options.customHandlers] - Custom tool handlers
 */
export async function mountDevTools(options = {}) {
  const container = options.container || document.body
  const basePath = options.basePath || '/'

  // Prevent double-mount
  if (wrapper) return

  // Skip mounting entirely when loaded inside a prototype embed iframe
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('_sb_embed')) return

  const { createElement } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { default: CoreUIBar } = await import('../ui/CoreUIBar.jsx')

  // Inject skip link as the first child of <body> so it is the
  // first element in the tab order, regardless of where CoreUIBar
  // is mounted. Works in both this repo and client repos.
  skipLink = document.createElement('a')
  skipLink.href = '#storyboard-controls'
  skipLink.textContent = 'Skip to controls'
  skipLink.setAttribute('data-sb-skip-link', '')
  skipLink.addEventListener('click', (e) => {
    e.preventDefault()
    const firstBtn = document.querySelector('[data-core-ui-bar] [data-slot="button"]')
    if (firstBtn) firstBtn.focus()
  })

  // Inline styles so it works without any CSS framework loaded
  Object.assign(skipLink.style, {
    position: 'fixed',
    top: '1rem',
    left: '1rem',
    zIndex: '10000',
    clip: 'rect(0 0 0 0)',
    clipPath: 'inset(50%)',
    width: '1px',
    height: '1px',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textDecoration: 'none',
  })

  skipLink.addEventListener('focus', () => {
    Object.assign(skipLink.style, {
      clip: 'auto',
      clipPath: 'none',
      width: 'auto',
      height: 'auto',
      overflow: 'visible',
      padding: '0.375rem 0.75rem',
      background: '#fff',
      color: '#111',
      border: '1px solid #ddd',
      borderRadius: '0.5rem',
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      fontSize: '0.875rem',
      fontFamily: "'Mona Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
    })
  })

  skipLink.addEventListener('blur', () => {
    Object.assign(skipLink.style, {
      clip: 'rect(0 0 0 0)',
      clipPath: 'inset(50%)',
      width: '1px',
      height: '1px',
      overflow: 'hidden',
      padding: '0',
      background: '',
      color: '',
      border: '',
      borderRadius: '',
      boxShadow: '',
      fontSize: '',
      fontFamily: '',
    })
  })

  document.body.insertBefore(skipLink, document.body.firstChild)

  wrapper = document.createElement('div')
  wrapper.id = 'sb-core-ui'
  container.appendChild(wrapper)

  root = createRoot(wrapper)
  root.render(createElement(CoreUIBar, {
    basePath,
    toolbarConfig: options.toolbarConfig,
    customHandlers: options.customHandlers,
  }))
}

/**
 * Remove the Core UI Bar from the DOM.
 */
export async function unmountDevTools() {
  if (root) {
    root.unmount()
    root = null
  }
  if (wrapper) { wrapper.remove(); wrapper = null }
  if (skipLink) { skipLink.remove(); skipLink = null }
}

/**
 * @deprecated Use mountDevTools instead.
 */
export function mountFlowDebug(options = {}) {
  return mountDevTools(options)
}

/**
 * @deprecated Use mountDevTools instead.
 */
export function mountSceneDebug(options = {}) {
  return mountDevTools(options)
}
