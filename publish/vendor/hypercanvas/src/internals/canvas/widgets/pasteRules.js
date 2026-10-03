/**
 * Paste Rules — config-driven paste routing for canvas widgets.
 *
 * All paste routing is defined in paste.config.json (packages/core).
 * Each rule declares a match condition and a widget type + prop template.
 * Rules are evaluated in order — first match wins.
 *
 * Image paste and widget-ref paste remain in CanvasPage.jsx because they
 * require clipboard / canvas API access that doesn't belong here.
 */

import pasteConfig from '../../../../paste.config.json'

// ---------------------------------------------------------------------------
// Branch-prefix pattern (matches /branch--<name> at start of pathname)
// ---------------------------------------------------------------------------

const BRANCH_PREFIX_RE = /^\/branch--[^/]+/

// ---------------------------------------------------------------------------
// Paste context — captures origin + base-path once per effect cycle
// ---------------------------------------------------------------------------

/**
 * Build a paste context object that URL rules can query.
 *
 * @param {string} origin  - `window.location.origin`
 * @param {string} basePath - `import.meta.env.BASE_URL` with trailing slash stripped
 * @returns {PasteContext}
 */
export function createPasteContext(origin, basePath) {
  const normalizedBase = basePath.replace(/\/$/, '')

  return {
    origin,
    basePath: normalizedBase,
    baseUrl: origin + normalizedBase,

    /**
     * Check whether a raw URL string points at the same Storyboard origin,
     * accounting for branch-deploy prefixes.
     * Uses parsed URL comparison (not string prefix) to avoid host spoofing.
     */
    isSameOrigin(text) {
      const parsed = this.parseUrl(text)
      if (!parsed || parsed.origin !== origin) return false
      const pathname = parsed.pathname
      if (normalizedBase && (pathname === normalizedBase || pathname.startsWith(normalizedBase + '/'))) return true
      if (!normalizedBase) return true
      return BRANCH_PREFIX_RE.test(pathname)
    },

    /**
     * Strip the base path (or any branch prefix) from a pathname to produce a
     * portable prototype `src` value.
     */
    extractSrc(pathname) {
      if (normalizedBase && pathname.startsWith(normalizedBase)) {
        return pathname.slice(normalizedBase.length) || '/'
      }
      const m = pathname.match(BRANCH_PREFIX_RE)
      if (m) return pathname.slice(m[0].length) || '/'
      return pathname
    },

    /**
     * Parse text as an http(s) URL. Returns the URL object or null.
     */
    parseUrl(text) {
      try {
        const url = new URL(text)
        return (url.protocol === 'http:' || url.protocol === 'https:') ? url : null
      } catch {
        return null
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Template variable resolution
// ---------------------------------------------------------------------------

/**
 * Build the set of template variables available to prop templates.
 *
 * @param {string} text           - raw pasted text
 * @param {URL|null} parsed       - parsed URL (null for non-URL text)
 * @param {PasteContext} ctx
 * @returns {Record<string, string>}
 */
export function buildTemplateVars(text, parsed, ctx) {
  const pathname = parsed?.pathname ?? ''
  return {
    $url: text,
    $text: text,
    $pathname: pathname,
    $src: ctx.extractSrc(pathname),
    $search: parsed?.search ?? '',
    $hash: parsed?.hash ?? '',
    $hostname: parsed?.hostname ?? '',
    $origin: parsed?.origin ?? '',
  }
}

/**
 * Apply URL sanitization to a value per the sanitize spec.
 *
 * @param {string} value         - the resolved URL string
 * @param {{ stripParams?: string[], normalizeHost?: string }} spec
 * @returns {string}
 */
export function sanitizeUrl(value, spec) {
  try {
    const url = new URL(value)
    if (spec.normalizeHost) url.hostname = spec.normalizeHost
    if (Array.isArray(spec.stripParams)) {
      for (const p of spec.stripParams) url.searchParams.delete(p)
    }
    return url.toString()
  } catch {
    return value
  }
}

/**
 * Resolve a single prop value from config.
 * - Plain values (string, number, boolean) are returned as-is.
 * - Objects with `template` are resolved from template vars.
 * - Objects with `sanitize` have URL sanitization applied after template resolution.
 *
 * @param {*} propDef             - the prop definition from config
 * @param {Record<string, string>} vars - template variables
 * @returns {*}
 */
export function resolvePropValue(propDef, vars) {
  if (propDef == null) return propDef

  // Object with template key → resolve template + optional sanitize
  if (typeof propDef === 'object' && propDef.template) {
    let value = propDef.template
    for (const [varName, varValue] of Object.entries(vars)) {
      value = value.replaceAll(varName, varValue)
    }
    if (propDef.sanitize) {
      value = sanitizeUrl(value, propDef.sanitize)
    }
    return value
  }

  // Plain string — substitute template vars
  if (typeof propDef === 'string') {
    let value = propDef
    for (const [varName, varValue] of Object.entries(vars)) {
      value = value.replaceAll(varName, varValue)
    }
    return value
  }

  // Numbers, booleans, etc. — pass through
  return propDef
}

// ---------------------------------------------------------------------------
// Rule compilation
// ---------------------------------------------------------------------------

/**
 * Compile a single rule from paste.config.json into a callable
 * `{ name, match, resolve }` object.
 *
 * Match conditions (all must pass when combined):
 *   - `hostname`    — regex tested against parsed URL hostname
 *   - `pathname`    — regex tested against parsed URL pathname
 *   - `pattern`     — regex tested against the full pasted text
 *   - `sameOrigin`  — boolean; delegates to ctx.isSameOrigin()
 *   - `isUrl`       — boolean; true if text is a valid http(s) URL
 *   - `any`         — boolean; always matches (catch-all)
 *
 * @param {object} ruleDef
 * @returns {{ name: string, match: Function, resolve: Function } | null}
 */
export function compileRule(ruleDef) {
  if (!ruleDef || !ruleDef.match || !ruleDef.widget) return null

  const { match: matchDef, widget, props: propsDef = {}, name = 'unnamed' } = ruleDef

  // Pre-compile regexes
  const matchers = []

  if (matchDef.hostname) {
    try {
      const re = new RegExp(matchDef.hostname)
      matchers.push((text, parsed) => parsed !== null && re.test(parsed.hostname))
    } catch {
      console.warn(`[pasteRules] Invalid hostname regex in rule "${name}": ${matchDef.hostname}`)
      return null
    }
  }

  if (matchDef.pathname) {
    try {
      const re = new RegExp(matchDef.pathname)
      matchers.push((text, parsed) => parsed !== null && re.test(parsed.pathname))
    } catch {
      console.warn(`[pasteRules] Invalid pathname regex in rule "${name}": ${matchDef.pathname}`)
      return null
    }
  }

  if (matchDef.pattern) {
    try {
      const re = new RegExp(matchDef.pattern)
      matchers.push((text) => re.test(text))
    } catch {
      console.warn(`[pasteRules] Invalid pattern regex in rule "${name}": ${matchDef.pattern}`)
      return null
    }
  }

  if (matchDef.sameOrigin) {
    matchers.push((text, parsed, ctx) => ctx.isSameOrigin(text))
  }

  if (matchDef.isUrl) {
    matchers.push((text, parsed) => parsed !== null)
  }

  if (matchDef.any) {
    matchers.push(() => true)
  }

  if (matchers.length === 0) {
    console.warn(`[pasteRules] Rule "${name}" has no valid match conditions`)
    return null
  }

  return {
    name,
    match(text, parsed, ctx) {
      return matchers.every(fn => fn(text, parsed, ctx))
    },
    resolve(text, parsed, ctx) {
      const vars = buildTemplateVars(text, parsed, ctx)
      const resolvedProps = {}
      for (const [key, def] of Object.entries(propsDef)) {
        resolvedProps[key] = resolvePropValue(def, vars)
      }
      return { type: widget, props: resolvedProps }
    },
  }
}

// ---------------------------------------------------------------------------
// Compile rules from paste.config.json at import time
// ---------------------------------------------------------------------------

const COMPILED_RULES = (pasteConfig.rules || [])
  .map(compileRule)
  .filter(Boolean)

// ---------------------------------------------------------------------------
// Main resolver
// ---------------------------------------------------------------------------

/**
 * Resolve pasted text into a widget `{ type, props }` by running through
 * ordered rules from paste.config.json. Override rules (if any) run first.
 *
 * @param {string} text              - trimmed clipboard text
 * @param {PasteContext} context      - from `createPasteContext()`
 * @param {object[]} [overrideRules] - raw rule objects from storyboard.config.json canvas.pasteRules
 * @returns {{ type: string, props: object } | null}
 */
export function resolvePaste(text, context, overrideRules = []) {
  const parsed = context.parseUrl(text)

  // Compile any runtime override rules (from storyboard.config.json)
  const overrides = overrideRules.map(compileRule).filter(Boolean)
  const allRules = [...overrides, ...COMPILED_RULES]

  for (const rule of allRules) {
    if (rule.match(text, parsed, context)) {
      return rule.resolve(text, parsed, context)
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Exports for testing
// ---------------------------------------------------------------------------

export { COMPILED_RULES, BRANCH_PREFIX_RE }