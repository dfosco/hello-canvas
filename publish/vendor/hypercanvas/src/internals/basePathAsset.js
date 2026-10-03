/** Resolve a static asset path beneath Vite's deployment base path. */
export function resolveBasePathAsset(value, basePath = '/') {
  if (typeof value !== 'string' || !value) return ''
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)) return value

  const base = String(basePath || '/')
  const normalizedBase = base.endsWith('/') ? base : `${base}/`
  return `${normalizedBase}${value.replace(/^\/+/, '')}`
}
