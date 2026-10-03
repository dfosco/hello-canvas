/**
 * Returns the navigable identity of an iframe URL — the part that, when
 * changed, causes the browser to fetch a new document and fire `onLoad`.
 *
 * That's everything *except* the hash. Pure hash mutations (e.g. when a
 * child app calls `history.replaceState` for storyboard URL overrides
 * like `#view=projects&projects.menuOpen=mock-project`) update the URL
 * without triggering a navigation, so an iframe whose only diff is the
 * hash is still "loaded" — assigning the same path+search to `iframe.src`
 * would not fire `onLoad`, and any spinner gated on "src changed → wait
 * for onLoad" would spin forever.
 *
 * Used by PrototypeEmbed to decide whether to display the loading
 * placeholder over the iframe after the stored widget src changes.
 *
 * Inputs may be absolute (`https://…`) or relative (`/MyProto?flow=x#y`).
 * Empty/nullish inputs return `''`.
 *
 * @param {string|null|undefined} url
 * @returns {string} the URL with any `#…` suffix stripped
 */
export function stripHash(url) {
  if (typeof url !== 'string' || url.length === 0) return ''
  const hashIdx = url.indexOf('#')
  return hashIdx >= 0 ? url.slice(0, hashIdx) : url
}

/**
 * True when two iframe URLs would resolve to the same document — i.e.
 * they differ only in their hash fragment, or are byte-identical.
 *
 * @param {string|null|undefined} a
 * @param {string|null|undefined} b
 * @returns {boolean}
 */
export function isSameIframeDocument(a, b) {
  return stripHash(a) === stripHash(b)
}
