/**
 * Storyboard FlowDebug — a vanilla JS debug panel that displays flow data.
 *
 * Framework-agnostic: creates a DOM element, no React/Vue/etc. needed.
 *
 * Usage:
 *   import { mountFlowDebug } from '../index.js'
 *   mountFlowDebug(document.getElementById('debug'))
 *   // or
 *   mountFlowDebug() // appends to document.body
 */
import { loadFlow } from '../data/loader.js'

/** Escape a string for safe interpolation into HTML text/attribute contexts. */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const STYLES = `
.sb-scene-debug {
  padding: 16px;
  font-family: "Mona Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
}
.sb-scene-debug-title {
  font-size: 20px;
  font-weight: 600;
  margin-bottom: 8px;
  color: #c9d1d9;
}
.sb-scene-debug-code {
  padding: 16px;
  background-color: #161b22;
  border-radius: 8px;
  overflow: auto;
  font-size: 13px;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  line-height: 1.5;
  max-height: 70vh;
  color: #c9d1d9;
  white-space: pre-wrap;
  word-break: break-word;
}
.sb-scene-debug-error {
  padding: 16px;
  background-color: rgba(248, 81, 73, 0.1);
  border-radius: 8px;
}
.sb-scene-debug-error-title {
  color: #f85149;
  font-weight: 600;
}
.sb-scene-debug-error-message {
  color: #f85149;
  margin-top: 4px;
}
`

let stylesInjected = false

/**
 * Mount a flow debug panel into the DOM.
 *
 * @param {HTMLElement} [container=document.body] - Where to mount
 * @param {string} [flowName] - Flow name override (defaults to ?flow= param or "default")
 * @returns {HTMLElement} The created debug element
 */
export function mountFlowDebug(container, flowName) {
  const target = container || document.body
  const sp = new URLSearchParams(window.location.search)
  const activeFlowName = flowName
    || sp.get('flow') || sp.get('scene')
    || 'default'

  // Inject styles once
  if (!stylesInjected) {
    const styleEl = document.createElement('style')
    styleEl.textContent = STYLES
    document.head.appendChild(styleEl)
    stylesInjected = true
  }

  const el = document.createElement('div')
  el.className = 'sb-scene-debug'

  let data = null
  let error = null
  try {
    data = loadFlow(activeFlowName)
  } catch (err) {
    error = err.message
  }

  if (error) {
    el.innerHTML = `
      <div class="sb-scene-debug-error">
        <div class="sb-scene-debug-error-title">Error loading flow</div>
        <p class="sb-scene-debug-error-message">${escapeHtml(error)}</p>
      </div>`
  } else {
    const title = document.createElement('h2')
    title.className = 'sb-scene-debug-title'
    title.textContent = `Flow: ${activeFlowName}`

    const pre = document.createElement('pre')
    pre.className = 'sb-scene-debug-code'
    pre.textContent = JSON.stringify(data, null, 2)

    el.appendChild(title)
    el.appendChild(pre)
  }

  target.appendChild(el)
  return el
}

/** @deprecated Use mountFlowDebug() */
export const mountSceneDebug = mountFlowDebug
