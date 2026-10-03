/**
 * Pure helpers for the PrototypeEmbed selection card — mirrors the Site
 * Frame's "Choose a Site" list. Kept module-level (outside the component)
 * so fast refresh still works on PrototypeEmbed.jsx.
 */

/** Path portion only: strips branch deploy prefixes, query, and hash. */
export function embedRoutePath(value) {
  if (typeof value !== 'string') return ''
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    try {
      const parsed = new URL(value)
      return `${parsed.pathname}${parsed.hash}` || ''
    } catch { return '' }
  }
  return value.replace(/^\/branch--[^/]+/, '').split('?')[0].split('#')[0] || ''
}

/** Full evaluation route: branch prefixes stripped, everything else intact. */
export function stripEmbedRoute(value) {
  return typeof value === 'string' ? value.replace(/^\/branch--[^/]+/, '') : ''
}

function formatName(name) {
  return String(name)
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Flat picker entries for the prototype selection card: one row per
 * prototype (folders flattened, externals skipped), title + directory
 * slug, no flow rows.
 *
 * `route` is the representative URL a pick writes into the Frame's src —
 * the default flow's route when one is declared, else the prototype's
 * index route (`/<dirName>`). `routes` carries every URL that belongs to
 * the prototype so an existing Frame src highlights its row.
 */
export function buildPrototypePickerEntries(index) {
  const idx = index || {}
  const seen = new Map()
  const collect = (proto) => {
    if (!proto || proto.isExternal || !proto.dirName || seen.has(proto.dirName)) return
    const flows = (proto.flows || []).map(flow => ({
      name: flow.meta?.title || formatName(flow.name || proto.dirName),
      route: flow.route,
    }))
    const defaultFlow = (proto.flows || []).find(flow => flow.meta?.default === true)
    const route = (defaultFlow || (proto.flows || [])[0])?.route || `/${proto.dirName}`
    seen.set(proto.dirName, {
      title: proto.name || proto.dirName,
      dirName: proto.dirName,
      route,
      flows,
      routes: [...new Set([`/${proto.dirName}`, ...flows.map(flow => flow.route)])],
    })
  }
  for (const folder of (idx.sorted?.title?.folders || idx.folders || [])) {
    for (const proto of (folder.prototypes || [])) collect(proto)
  }
  for (const proto of (idx.sorted?.title?.prototypes || idx.prototypes || [])) collect(proto)
  return [...seen.values()].sort((a, b) => a.title.localeCompare(b.title))
}
