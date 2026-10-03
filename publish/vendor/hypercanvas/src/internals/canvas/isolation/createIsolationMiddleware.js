/**
 * Vite middleware factory for iframe-isolation entries.
 *
 * Both `prototypes.html` (prototype embeds) and `stories.html` (story /
 * component-set widgets) follow the same recipe: serve a minimal HTML shell
 * that boots a library-side React entry, with a theme bootstrap inlined so
 * first paint matches the active theme. This factory captures that recipe
 * so the two surfaces can't drift apart.
 *
 * Returns a Connect middleware that matches `/${name}` and `/${name}/*`
 * (after the configured Vite base path is stripped). Non-matching URLs are
 * passed through to `next()`.
 *
 * @param {object} opts
 * @param {string} opts.name        — entry name, including extension, e.g. 'prototypes.html'
 * @param {string} opts.entryPath   — absolute on-disk path to the JS entry to /@fs-load
 * @param {string} opts.surface     — value for `data-sb-surface` attribute on <body>
 * @param {string} opts.title       — document <title>
 * @param {() => object|undefined} opts.getThemes — read live themes config; called per request
 * @returns {(req, res, next) => void}
 */
export function createIsolationMiddleware({ name, entryPath, surface, title, getThemes }, { renderInlineBootstrapScript, server }) {
  const matchPath = `/${name}`
  return async function isolationMiddleware(req, res, next) {
    if (!req.url) return next()
    let url = req.url
    const baseNoTrail = (server.config.base || '/').replace(/\/$/, '')
    if (baseNoTrail && url.startsWith(baseNoTrail)) {
      url = url.slice(baseNoTrail.length) || '/'
    }
    const cleanUrl = url.split('?')[0].split('#')[0]
    if (cleanUrl !== matchPath && !cleanUrl.startsWith(`${matchPath}/`)) return next()

    const themes = getThemes?.()
    const themeBootstrap = themes ? renderInlineBootstrapScript(themes) : ''

    const rawHtml = [
      '<!DOCTYPE html>',
      '<html lang="en"><head>',
      '<meta charset="UTF-8" />',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />',
      `<title>${escapeHtml(title)}</title>`,
      themeBootstrap,
      `</head><body data-sb-surface="${escapeAttr(surface)}">`,
      '<div id="root"></div>',
      `<script type="module" src="/@fs${entryPath}"></script>`,
      '</body></html>',
    ].join('\n')

    try {
      const html = await server.transformIndexHtml(req.url, rawHtml)
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(html)
    } catch (err) {
      console.error(`[storyboard] ${name} transform failed:`, err)
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end(`${name} failed`)
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
}

function escapeAttr(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}
