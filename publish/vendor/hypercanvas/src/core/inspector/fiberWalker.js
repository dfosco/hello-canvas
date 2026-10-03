/**
 * Fiber Walker — React fiber tree inspector for DOM elements.
 *
 * Framework-agnostic (zero npm dependencies).
 * Intended for dev-time inspection only — relies on React's internal
 * fiber keys and _debugSource which are only present in development builds.
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Find the React fiber key on a DOM element.
 * React attaches fibers via private keys like __reactFiber$xxxx.
 * The suffix changes per React instance, so we search by prefix.
 *
 * @param {Element} el
 * @returns {string|undefined}
 */
function findFiberKey(el) {
  return Object.keys(el).find(
    k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
  )
}

/**
 * Check whether a fiber represents a user-defined component
 * (as opposed to a host element like 'div' or a React internal like Fragment).
 * Handles function components, forwardRef, and memo wrappers.
 *
 * @param {object} fiber
 * @returns {boolean}
 */
function isUserComponent(fiber) {
  if (!fiber || !fiber.type) return false
  const t = fiber.type
  // Plain function/class component
  if (typeof t === 'function') return true
  // forwardRef: { $$typeof: Symbol(react.forward_ref), render: fn }
  // memo: { $$typeof: Symbol(react.memo), type: ... }
  if (typeof t === 'object' && t !== null) {
    if (typeof t.render === 'function') return true  // forwardRef
    if (t.$$typeof && typeof t.type === 'function') return true  // memo
    if (t.$$typeof && typeof t.type === 'object') return true  // memo(forwardRef)
  }
  return false
}

/**
 * Derive a human-readable name from a fiber's type.
 * Handles plain components, forwardRef, and memo wrappers.
 * Skips minified names (single-char or generic) in favor of 'ForwardRef'/'Memo'
 * so the caller can try walking up the tree for a better name.
 *
 * @param {object} fiber
 * @returns {string}
 */
function getComponentName(fiber) {
  if (!fiber || !fiber.type) return 'Unknown'
  const t = fiber.type
  // Plain function/class
  if (typeof t === 'function') return t.displayName || t.name || 'Anonymous'
  // forwardRef / memo wrapper objects
  if (typeof t === 'object' && t !== null) {
    if (t.displayName) return t.displayName
    // forwardRef: { render: fn }
    if (typeof t.render === 'function') {
      const name = t.render.displayName || t.render.name
      return isUsableName(name) ? name : 'ForwardRef'
    }
    // memo: { type: ... }
    if (t.type) {
      const inner = t.type
      if (typeof inner === 'function') {
        const name = inner.displayName || inner.name
        return isUsableName(name) ? name : 'Memo'
      }
      // memo(forwardRef)
      if (typeof inner === 'object' && inner.render) {
        if (inner.displayName) return inner.displayName
        const name = inner.render.displayName || inner.render.name
        return isUsableName(name) ? name : 'ForwardRef'
      }
    }
  }
  return 'Unknown'
}

/**
 * Check if a resolved component name is usable (not minified).
 * Minified names are typically 1-2 chars or all lowercase short strings.
 */
function isUsableName(name) {
  if (!name) return false
  // Single-char names (e, t, r, n) are almost certainly minified
  if (name.length <= 2) return false
  return true
}

/**
 * Extract debug source info from a fiber (dev builds only).
 *
 * @param {object} fiber
 * @returns {{ fileName: string, lineNumber: number, columnNumber: number }|null}
 */
function getDebugSource(fiber) {
  if (!fiber || !fiber._debugSource) return null
  const src = fiber._debugSource
  return {
    fileName: src.fileName ?? null,
    lineNumber: src.lineNumber ?? null,
    columnNumber: src.columnNumber ?? null,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the React fiber node attached to a DOM element.
 * React attaches fibers via private keys like __reactFiber$xxx.
 * Returns null if the element has no fiber (not a React-rendered element).
 *
 * @param {Element} el - A DOM element
 * @returns {object|null} The fiber node, or null
 */
export function getFiberFromElement(el) {
  if (!el || typeof el !== 'object') return null
  const key = findFiberKey(el)
  if (!key) return null
  return el[key] ?? null
}

/**
 * Extract component information from a fiber node.
 * Walks up the fiber tree to find the nearest user component
 * (skipping host elements like div, span, etc.).
 *
 * Returns: { name, props, source, hostSource, owner } or null
 * - name: component display name or function name
 * - props: current memoized props object
 * - source: { fileName, lineNumber, columnNumber } from _debugSource of the
 *           component definition, or null
 * - hostSource: _debugSource of the originally clicked fiber — points to the
 *               JSX line in the parent file where this element was written
 *               (preferred for "jump to source"), or null
 * - owner: name of the owning/parent component, or null
 *
 * @param {object} fiber - A React fiber node
 * @returns {{ name: string, props: object, source: object|null, hostSource: object|null, owner: string|null }|null}
 */
export function getComponentInfo(fiber) {
  if (!fiber) return null

  // Capture the clicked element's own debug source BEFORE walking up.
  // For host elements (div/button) and inner components, this points to
  // the exact JSX line in the parent file — that's what users want when
  // they click "deep" into the DOM.
  const hostSource = getDebugSource(fiber)

  // Walk up to the nearest user component
  let current = fiber
  while (current && !isUserComponent(current)) {
    current = current.return
  }

  if (!current) return null

  let name = getComponentName(current)

  // If we got a generic name (ForwardRef, Memo), try walking up
  // to find the nearest ancestor with a real component name
  if (name === 'ForwardRef' || name === 'Memo') {
    let ancestor = current.return
    while (ancestor) {
      if (isUserComponent(ancestor)) {
        const ancestorName = getComponentName(ancestor)
        if (ancestorName !== 'ForwardRef' && ancestorName !== 'Memo' && ancestorName !== 'Unknown') {
          name = ancestorName
          break
        }
      }
      ancestor = ancestor.return
    }
  }

  const ownerFiber = current._debugOwner ?? null

  return {
    name,
    props: current.memoizedProps ?? {},
    source: getDebugSource(current),
    hostSource,
    owner: ownerFiber ? getComponentName(ownerFiber) : null,
  }
}

/**
 * Walk up the fiber tree and collect all user components in the chain.
 * Returns an array from the given fiber up to the root.
 * Each entry: { name, source }
 * Skips host elements (div, span, etc.) and React internal types.
 *
 * @param {object} fiber - A React fiber node
 * @returns {Array<{ name: string, source: object|null }>}
 */
export function getComponentChain(fiber) {
  const chain = []
  let current = fiber

  while (current) {
    if (isUserComponent(current)) {
      chain.push({
        name: getComponentName(current),
        source: getDebugSource(current),
      })
    }
    current = current.return
  }

  return chain
}

/**
 * Convenience: given a DOM element, get full component info.
 * Combines getFiberFromElement + getComponentInfo.
 *
 * @param {Element} el - A DOM element
 * @returns {{ name: string, props: object, source: object|null, owner: string|null }|null}
 */
export function inspectElement(el) {
  const fiber = getFiberFromElement(el)
  if (!fiber) return null
  return getComponentInfo(fiber)
}

/**
 * Given a DOM element, get ALL React components in the ancestry chain.
 * Combines getFiberFromElement + getComponentChain.
 *
 * @param {Element} el - A DOM element
 * @returns {Array<{ name: string, source: object|null }>}
 */
export function inspectElementChain(el) {
  const fiber = getFiberFromElement(el)
  if (!fiber) return []
  return getComponentChain(fiber)
}
