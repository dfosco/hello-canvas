/**
 * Self-heal canvases that persisted a dev-isolation loader URL as the prototype
 * widget src. Three legacy shapes exist (all caused by older bugs in the embed
 * iframe broadcaster — see commit history of PrototypeEmbed.jsx + mountStoryboardCore.js):
 *
 *   1. `/prototypes.html#/MyProto?...`
 *      — 0.6.13 and older, when the iframe broadcast pathname+hash and
 *        routing lived in the hash. Inner is a clean path.
 *
 *   2. `/prototypes.html#%2FMyProto=&cqOpen=true&...`
 *      — 0.6.13/0.6.14 with storyboard URL state. The iframe's hash was
 *        `#/MyProto` (router route), then storyboard's session.writeHash
 *        did `URLSearchParams.toString()` on the entire hash, which
 *        URL-encoded `/` to `%2F` and turned `/MyProto` into a key with
 *        an empty value. This is the most common shape seen in the wild.
 *
 *   3. `/prototypes.html/MyProto...`
 *      — defensive: if a future broadcaster ever forwards the loader
 *        path verbatim with the path-based router layout (0.6.15+).
 *
 * Without normalization the URL builder in PrototypeEmbed treats
 * "prototypes.html" as the prototype name and produces a blank iframe — and
 * cmd+D duplicates inherit the broken src.
 *
 * Pure, deterministic, safe to call on every render. The PrototypeEmbed
 * component also writes the normalized form back to the canvas via onUpdate
 * so the persisted JSONL stops carrying the broken URL forever.
 *
 * @param {unknown} src
 * @returns {unknown} normalized src, or the original value when not a string
 */
export function normalizeLegacyEmbedSrc(src) {
  if (typeof src !== 'string' || !src) return src
  // Hash-form (legacy 0.6.13 router-in-hash). Match both clean and
  // URLSearchParams-mangled inner contents.
  const hashMatch = src.match(/^\/?(?:[^#]*\/)?prototypes\.html#(.*)$/)
  if (hashMatch) {
    const inner = hashMatch[1] || ''
    if (!inner) return '/'
    // Clean form: `#/MyProto?...` — inner already starts with `/`.
    if (inner.startsWith('/')) return inner
    // URLSearchParams-mangled form: parse and find the key whose decoded
    // name starts with `/` (that's the route). Surviving params become
    // the storyboard URL state on the recovered hash.
    try {
      const params = new URLSearchParams(inner)
      let route = ''
      const restPairs = []
      for (const [key, value] of params) {
        if (!route && key.startsWith('/')) {
          // Storyboard never persists state with `/`-prefixed keys, and the
          // mangled form always puts the route first — so first match wins.
          // The route had no `=` in the original URL, so value is empty.
          // If a `?query=...` survived alongside, append it back.
          route = value ? `${key}?${key}=${value}` : key
        } else {
          restPairs.push(`${key}=${value}`)
        }
      }
      if (route) {
        return restPairs.length > 0 ? `${route}#${restPairs.join('&')}` : route
      }
    } catch { /* fall through */ }
    // Last-resort: prefix `/` so we at least produce a routable path.
    return `/${inner}`
  }
  // Path-form: `/prototypes.html/inner...` — defensive.
  const pathMatch = src.match(/^\/?(?:[^#?]*\/)?prototypes\.html(\/[^]*)$/)
  if (pathMatch) {
    const inner = pathMatch[1] || ''
    return inner || '/'
  }
  return src
}
