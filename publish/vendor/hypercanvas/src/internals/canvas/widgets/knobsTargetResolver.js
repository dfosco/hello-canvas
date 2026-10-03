import {
  buildPrototypeIndex as buildPrototypeIndexDefault,
  getComponentKnobs as getComponentKnobsDefault,
  getPrototypeKnobs as getPrototypeKnobsDefault,
  getPrototypeMetadata as getPrototypeMetadataDefault,
} from '../../../core/index.js'
import { getWidgetRef as getWidgetRefDefault } from '../canvasApi.js'
import { getWidgetKnobs as getWidgetKnobsDefault } from './widgetConfig.js'

const EXTERNAL_IFRAME_TYPES = new Set(['prototype', 'figma-embed', 'codepen-embed'])

function safeArray(value) {
  return Array.isArray(value) ? value : []
}

function labelFromWidget(id, widget) {
  const props = widget?.props ?? {}
  return (
    widget?.alias ||
    props.alias ||
    widget?.prettyName ||
    props.prettyName ||
    widget?.label ||
    props.label ||
    id
  )
}

function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim())
}

export function isExternalWidgetTarget(widget) {
  if (!widget || !EXTERNAL_IFRAME_TYPES.has(widget.type)) return false
  const props = widget.props ?? {}
  return isHttpUrl(props.src) || isHttpUrl(props.url)
}

function readBaseUrl(deps) {
  if (deps?.baseUrl !== undefined) return deps.baseUrl
  return import.meta.env?.BASE_URL || '/'
}

function normalizeBasePath(baseUrl) {
  const base = String(baseUrl || '/').replace(/\/+$/, '')
  if (!base || base === '/') return ''
  return base.startsWith('/') ? base : `/${base}`
}

function routeKey(value, deps, { keepSearch = false } = {}) {
  if (!value) return ''

  const raw = String(value).trim()
  if (!raw) return ''

  let pathname = raw
  let search = ''
  try {
    const url = new URL(raw, 'http://storyboard.local')
    pathname = url.pathname || '/'
    search = url.search || ''
  } catch {
    const hashless = raw.split('#')[0]
    const queryIndex = hashless.indexOf('?')
    if (queryIndex >= 0) {
      pathname = hashless.slice(0, queryIndex)
      search = hashless.slice(queryIndex)
    } else {
      pathname = hashless
    }
  }

  if (!pathname.startsWith('/')) pathname = `/${pathname}`

  const base = normalizeBasePath(readBaseUrl(deps))
  if (base && pathname === base) pathname = '/'
  else if (base && pathname.startsWith(`${base}/`)) pathname = pathname.slice(base.length) || '/'

  pathname = pathname.replace(/^\/branch--[^/]+(?=\/|$)/, '') || '/'
  pathname = pathname.replace(/^\/prototypes\.html(?=\/|$)/, '') || '/'
  pathname = pathname.replace(/^\/stories\.html(?=\/|$)/, '') || '/'
  if (!pathname.startsWith('/')) pathname = `/${pathname}`
  pathname = pathname.replace(/\/+$/, '') || '/'

  return `${pathname}${keepSearch ? search : ''}`
}

function flattenPrototypeEntries(index) {
  const result = []
  const seen = new Set()
  for (const proto of safeArray(index?.prototypes)) {
    const key = proto?.dirName || proto?.name
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(proto)
  }
  for (const folder of safeArray(index?.folders)) {
    for (const proto of safeArray(folder?.prototypes)) {
      const key = proto?.dirName || proto?.name
      if (!key || seen.has(key)) continue
      seen.add(key)
      result.push(proto)
    }
  }
  return result
}

export function resolvePrototypeNameFromSrc(src, deps = {}) {
  const srcExact = routeKey(src, deps, { keepSearch: true })
  const srcPath = routeKey(src, deps)
  if (!srcPath) return null

  let index
  try {
    index = (deps.buildPrototypeIndex || buildPrototypeIndexDefault)()
  } catch {
    return null
  }

  const prototypes = flattenPrototypeEntries(index)
  const candidateRows = prototypes.map((proto) => {
    const protoName = proto?.dirName || proto?.name
    const routes = [
      protoName ? `/${protoName}` : null,
      ...safeArray(proto?.flows).map(flow => flow?.route),
    ].filter(Boolean)

    return {
      protoName,
      exact: routes.map(route => routeKey(route, deps, { keepSearch: true })),
      paths: routes.map(route => routeKey(route, deps)),
    }
  }).filter(row => row.protoName)

  for (const row of candidateRows) {
    if (row.exact.includes(srcExact)) return row.protoName
  }

  for (const row of candidateRows) {
    if (row.paths.includes(srcPath)) return row.protoName
  }

  return null
}

function iframeWindowGetter(targetId, getWidgetRef) {
  return () => {
    try {
      const handle = getWidgetRef(targetId)
      if (typeof handle?.getIframeWindow !== 'function') return null
      return handle.getIframeWindow() ?? null
    } catch {
      return null
    }
  }
}

export function resolveKnobsTarget(target, deps = {}) {
  const id = target?.id
  const widget = target?.widget
  if (!id || !widget) return null
  if (isExternalWidgetTarget(widget)) return null

  const getWidgetRef = deps.getWidgetRef || getWidgetRefDefault
  const getPrototypeKnobs = deps.getPrototypeKnobs || getPrototypeKnobsDefault
  const getComponentKnobs = deps.getComponentKnobs || getComponentKnobsDefault
  const getWidgetKnobs = deps.getWidgetKnobs || getWidgetKnobsDefault
  const getPrototypeMetadata = deps.getPrototypeMetadata || getPrototypeMetadataDefault
  const fallbackLabel = labelFromWidget(id, widget)

  if (widget.type === 'prototype') {
    const protoName = resolvePrototypeNameFromSrc(widget.props?.src, deps)
    if (!protoName) return null
    // Prefer the prototype's declared title (.prototype.json meta.title)
    // over canvas-side aliases/labels so the titlebar reflects the actual
    // prototype identity, e.g. "Loopline Signup" instead of the route name.
    const protoMeta = getPrototypeMetadata(protoName)
    const protoTitle = protoMeta?.meta?.title || protoMeta?.title || protoName
    return {
      id,
      label: protoTitle,
      knobs: getPrototypeKnobs(protoName),
      requiresTargetWindow: true,
      getTargetWindow: iframeWindowGetter(id, getWidgetRef),
    }
  }

  if (widget.type === 'component-set' || widget.type === 'story') {
    const componentName = widget.props?.storyId
    if (!componentName) return null
    return {
      id,
      label: fallbackLabel,
      knobs: getComponentKnobs(componentName),
      requiresTargetWindow: true,
      getTargetWindow: iframeWindowGetter(id, getWidgetRef),
    }
  }

  const knobs = getWidgetKnobs(widget.type)
  if (!Array.isArray(knobs) || knobs.length === 0) return null

  return {
    id,
    label: fallbackLabel,
    knobs,
    getTargetWindow: null,
  }
}

export function resolveKnobsTargets(targets, deps = {}) {
  return safeArray(targets)
    .map(target => resolveKnobsTarget(target, deps))
    .filter(Boolean)
}
