import fs from 'node:fs'
import { SiteStore, SITE_CONFIG_FILE, normalizeSiteId, detectSiteConfiguration, siteIdForTitle, assertAvailableSiteRoot, assertExternalSiteRoot, updateSiteDescriptor } from './site.js'
import { SiteRuntime, rebindSite } from './runtime.js'
import { captureSiteFrame, readSiteCapture } from './capture.js'
import { resolveSiteDevelopmentUrl } from './contract.js'
import { createFilesystemGrants } from '../system/filesystem-grants.js'
import { createSitePreviewMiddleware } from './proxy.js'

export function createSiteRoutes({ root, sendJson, ptyRuntime = null, workspaceScripts = null, serviceResolver = null, resolveNotebookWorkspaceId = null, filesystemGrants = createFilesystemGrants(), eventSender = null }) {
  const store = new SiteStore(root)
  const runtime = new SiteRuntime(store, {
    ptyRuntime,
    requirePtyRuntime: true,
    workspaceScripts,
    serviceResolver,
    resolveNotebookWorkspaceId,
    onSiteError: siteId => eventSender?.({ type: 'custom', event: 'storyboard:site-failed', data: { siteId } }),
  })
  // The list route can respond before reconciliation completes, so handle a
  // background startup failure even when no lifecycle route awaits readiness.
  runtime.ready.catch(() => {})
  const missing = id => { const directory = store.getBinding(id)?.root; try { return Boolean(directory && !fs.statSync(directory).isDirectory()) } catch { return Boolean(directory) } }
  async function deleteSite(id) {
    const siteId = normalizeSiteId(id)
    if (!store.get(siteId)) return { success: false, error: `Site "${siteId}" not found` }
    await runtime.ready
    await runtime.stop(siteId)
    const existed = store.remove(siteId)
    return existed
      ? { success: true, deleted: siteId, files: [SITE_CONFIG_FILE] }
      : { success: false, error: `Site "${siteId}" not found` }
  }
  const siteHandler = async function siteHandler(req, res, ctx) {
    const route = '/' + String(ctx.subpath || ctx.path || '').split('?')[0].replace(/^\//, '')
    const body = ctx.body ?? {}
    try {
      if (ctx.method === 'GET' && (route === '/' || route === '/list')) {
        return sendJson(res, 200, { sites: store.list().map(site => ({ ...site, binding: runtime.status(site.id), missing: missing(site.id) })) })
      }
      if (ctx.method === 'GET' && route === '/detect') {
        const directory = new URL(req.url, 'http://localhost').searchParams.get('root')
        if (!directory) throw new Error('root is required')
        const grantedRoot = filesystemGrants.resolveDirectory(req, directory, { purpose: 'site', consume: false })
        return sendJson(res, 200, { detection: detectSiteConfiguration(assertExternalSiteRoot(root, grantedRoot)) })
      }
      if (ctx.method === 'GET' && route.endsWith('/status')) {
        const id = normalizeSiteId(route.split('/')[1])
        await runtime.ready
        return sendJson(res, 200, { binding: runtime.status(id) })
      }
      if (ctx.method === 'GET' && route.endsWith('/logs')) {
        const id = normalizeSiteId(route.split('/')[1])
        return sendJson(res, 200, { logs: runtime.getLogs(id) })
      }
      if (ctx.method === 'GET' && route.endsWith('/capture')) {
        const id = normalizeSiteId(route.split('/')[1])
        if (store.getBinding(id)?.root) runtime.resolveRoot(id)
        const reference = { siteId: id, route: body.route || '' , width: body.width, height: body.height }
        return sendJson(res, 200, { capture: await readSiteCapture(root, reference, { bindingRevision: store.getBinding(id)?.revision || 0, theme: body.theme || 'light' }) })
      }
      if (ctx.method === 'POST' && route.endsWith('/capture')) {
        const id = normalizeSiteId(route.split('/')[1])
        const binding = store.getBinding(id)
        if (binding?.root) runtime.resolveRoot(id)
        if (!binding?.developmentBaseUrl) throw new Error('Site is not running')
        const reference = { siteId: id, route: body.route || '', width: body.width, height: body.height }
        const playwright = await import(/* @vite-ignore */ 'playwright').catch(() => null)
        if (!playwright) throw new Error('Site frame capture requires playwright — install it with: npm install playwright && npx playwright install chromium')
        const { chromium } = playwright
        const result = await captureSiteFrame({
          notebookRoot: root,
          reference,
          developmentUrl: resolveSiteDevelopmentUrl(binding.developmentBaseUrl, reference.route),
          bindingRevision: binding.revision,
          theme: body.theme || 'light',
          force: body.force === true,
          captureAdapter: async ({ url, outputPath, viewport, colorScheme }) => {
            const browser = await chromium.launch({ headless: true })
            try {
              const page = await browser.newPage({ viewport, colorScheme })
              await page.goto(url, { waitUntil: 'networkidle' })
              await page.screenshot({ path: outputPath })
            } finally {
              await browser.close()
            }
          },
        })
        return sendJson(res, 200, { capture: await readSiteCapture(root, reference, { bindingRevision: binding.revision, theme: body.theme || 'light' }), ...result })
      }
      if (ctx.method === 'POST' && route.endsWith('/discover')) {
        const id = normalizeSiteId(route.split('/')[1])
        return sendJson(res, 200, { discovery: await runtime.discover(id, body) })
      }
      if (ctx.method === 'POST' && route === '/create') {
        if (Object.prototype.hasOwnProperty.call(body, 'notebookPath')) throw new Error('Notebook-contained Site sources are no longer supported')
        if (!body.title?.trim() || typeof body.root !== 'string' || !body.root) throw new Error('Site name and external directory are required')
        const requestedRoot = filesystemGrants.resolveDirectory(req, body.root, { purpose: 'site' })
        const directory = assertAvailableSiteRoot(store, requestedRoot)
        if (!resolveNotebookWorkspaceId) throw new Error('Paseo workspace registration is unavailable')
        const workspaceId = await resolveNotebookWorkspaceId()
        const detection = detectSiteConfiguration(directory)
        const id = siteIdForTitle(body.title, store)
        const command = body.startCommand?.trim() || detection.findings.find(item => item.kind === 'start-command')?.value || 'npm run dev'
        const developmentBaseUrl = body.developmentBaseUrl ?? body.localUrl ?? detection.findings.find(item => item.kind === 'local-url')?.value
        const site = store.upsert(updateSiteDescriptor({ id, title: body.title.trim() }, {
          title: body.title.trim(),
          description: body.description,
          productionBaseUrl: body.productionBaseUrl ?? body.deployUrl,
        }))
        const binding = store.upsertBinding(id, {
          source: 'managed', root: directory, workspaceId, startCommand: command, status: 'stopped',
          ...(developmentBaseUrl ? { developmentBaseUrl } : {}),
        })
        return sendJson(res, 201, { site: { ...site, binding } })
      }
      if (ctx.method === 'PATCH' && route.endsWith('/metadata')) {
        const id = normalizeSiteId(route.split('/')[1])
        const previous = store.get(id)
        if (!previous) return sendJson(res, 404, { error: `Site not found: ${id}` })
        if (body.root !== undefined || body.id !== undefined) throw new Error('Use Rebind directory to change the Site binding')
        const developmentBaseUrl = body.developmentBaseUrl !== undefined ? body.developmentBaseUrl : body.localUrl
        const hasDescriptorUpdate = body.title !== undefined || body.description !== undefined || body.productionBaseUrl !== undefined || body.deployUrl !== undefined
        const hasBindingUpdate = body.startCommand !== undefined || developmentBaseUrl !== undefined
        if (!hasDescriptorUpdate && !hasBindingUpdate) throw new Error('Provide a Site field to update')
        if (body.title !== undefined && (typeof body.title !== 'string' || !body.title.trim())) throw new Error('Site name is required')
        if (body.startCommand !== undefined && (typeof body.startCommand !== 'string' || !body.startCommand.trim())) throw new Error('Dev command is required')
        const site = hasDescriptorUpdate
          ? store.upsert(updateSiteDescriptor(previous, {
            ...(body.title !== undefined ? { title: body.title.trim() } : {}),
            ...(body.description !== undefined ? { description: body.description } : {}),
            ...(body.productionBaseUrl !== undefined || body.deployUrl !== undefined ? { productionBaseUrl: body.productionBaseUrl ?? body.deployUrl } : {}),
          }))
          : previous
        const bindingUpdates = {
          ...(body.startCommand !== undefined ? { startCommand: body.startCommand.trim() } : {}),
          ...(developmentBaseUrl !== undefined ? { developmentBaseUrl } : {}),
        }
        if (Object.keys(bindingUpdates).length) store.upsertBinding(id, bindingUpdates)
        const binding = runtime.status(id)
        return sendJson(res, 200, { site: { ...site, binding, missing: missing(id) } })
      }
      if (ctx.method === 'POST' && route.endsWith('/metadata')) {
        const id = normalizeSiteId(route.split('/')[1])
        if (!store.get(id)) return sendJson(res, 404, { error: `Site not found: ${id}` })
        if (!body.root) throw new Error('Select a new directory to rebind the Site')
        const selectedRoot = filesystemGrants.resolveDirectory(req, body.root, { purpose: 'site' })
        const directory = assertAvailableSiteRoot(store, selectedRoot, id)
        const previous = store.getBinding(id)?.root
        if (previous && fs.existsSync(previous) && fs.realpathSync.native(previous) === directory) throw new Error('Select a different directory to rebind the Site')
        if (!resolveNotebookWorkspaceId) throw new Error('Paseo workspace registration is unavailable')
        const workspaceId = await resolveNotebookWorkspaceId()
        await runtime.ready
        await runtime.stop(id)
        const detection = detectSiteConfiguration(directory)
        const command = body.startCommand?.trim() || detection.findings.find(item => item.kind === 'start-command')?.value || 'npm run dev'
        const developmentBaseUrl = body.developmentBaseUrl ?? body.localUrl ?? detection.findings.find(item => item.kind === 'local-url')?.value ?? null
        const previousSite = store.get(id)
        store.upsert(updateSiteDescriptor(previousSite, {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.productionBaseUrl !== undefined || body.deployUrl !== undefined ? { productionBaseUrl: body.productionBaseUrl ?? body.deployUrl } : {}),
        }))
        store.upsertBinding(id, { source: 'managed', root: directory, workspaceId, startCommand: command, status: 'stopped', developmentBaseUrl })
        return sendJson(res, 200, { site: { ...store.get(id), binding: runtime.status(id) } })
      }
      if (ctx.method === 'DELETE' && route !== '/') {
        const id = normalizeSiteId(route.slice(1))
        const result = await deleteSite(id)
        return sendJson(res, result.success ? 200 : 404, result)
      }
      if (ctx.method === 'GET' && route.startsWith('/')) {
        const id = normalizeSiteId(route.slice(1))
        const site = store.get(id)
        await runtime.ready
        if (site && store.getBinding(id)?.source === 'managed' && store.getBinding(id)?.root && !runtime.processes.has(id)) {
          try { await runtime.discover(id, { requireOwnedListener: true, timeoutMs: 1500 }) } catch { /* Site may be stopped or its directory unavailable */ }
        }
        return site ? sendJson(res, 200, { site: { ...site, binding: runtime.status(id), missing: missing(id) } }) : sendJson(res, 404, { error: `Site not found: ${id}` })
      }
      if (ctx.method === 'POST' && route === '/') {
        if (req?.headers?.origin || req?.headers?.['sec-fetch-site']) throw Object.assign(new Error('Use the Core Site create action to bind a directory.'), { code: 'FILESYSTEM_GRANT_REQUIRED' })
        const { localUrl, developmentBaseUrl, startCommand, productionBaseUrl, deployUrl, binding: suppliedBinding, ...descriptor } = body
        const checkedBinding = suppliedBinding?.root
          ? { ...suppliedBinding, root: assertAvailableSiteRoot(store, suppliedBinding.root, descriptor.id) }
          : suppliedBinding
        const site = store.upsert(updateSiteDescriptor(descriptor, {
          ...(productionBaseUrl !== undefined || deployUrl !== undefined ? { productionBaseUrl: productionBaseUrl ?? deployUrl } : {}),
        }))
        const bindingUpdates = {
          ...(checkedBinding || {}),
          ...(developmentBaseUrl !== undefined || localUrl !== undefined
            ? { source: suppliedBinding?.source || 'url', developmentBaseUrl: developmentBaseUrl ?? localUrl }
            : {}),
          ...(startCommand !== undefined ? { startCommand } : {}),
        }
        if (Object.keys(bindingUpdates).length) store.upsertBinding(site.id, bindingUpdates)
        return sendJson(res, 201, { site: { ...site, binding: runtime.status(site.id) } })
      }
      const id = normalizeSiteId(body.siteId || route.split('/')[1])
      if (ctx.method === 'POST' && route.endsWith('/binding')) {
        if (req?.headers?.origin || req?.headers?.['sec-fetch-site']) throw Object.assign(new Error('Use the Core Site create or rebind action to change a Site root.'), { code: 'FILESYSTEM_GRANT_REQUIRED' })
        const binding = body.binding ?? body
        const checkedBinding = binding?.root
          ? { ...binding, root: assertAvailableSiteRoot(store, binding.root, id) }
          : binding
        store.upsertBinding(id, checkedBinding)
        return sendJson(res, 200, { binding: runtime.status(id) })
      }
      if (ctx.method === 'POST' && route.endsWith('/start')) return sendJson(res, 200, { binding: await runtime.start(id, body) })
      if (ctx.method === 'POST' && route.endsWith('/stop')) {
        await runtime.ready
        return sendJson(res, 200, { binding: await runtime.stop(id) })
      }
      if (ctx.method === 'POST' && route.endsWith('/restart')) return sendJson(res, 200, { binding: await runtime.restart(id, body) })
       if (ctx.method === 'POST' && route.endsWith('/rebind')) return sendJson(res, 200, { binding: await rebindSite(store, id, { workspaceId: body.workspaceId, developmentBaseUrl: body.developmentBaseUrl }) })
      return sendJson(res, 404, { error: `Unknown Site route: ${ctx.method} ${route}` })
    } catch (error) {
      const status = ['FILESYSTEM_ORIGIN_NOT_ALLOWED', 'FILESYSTEM_GRANT_REQUIRED', 'FILESYSTEM_GRANT_ORIGIN_MISMATCH'].includes(error.code)
        ? 403
        : error.code === 'ENOENT' || error.code === 'FILESYSTEM_ROOT_UNAVAILABLE'
          ? 404
          : error.code === 'SITE_REBIND_REQUIRED' || error.message?.includes('already registered')
            ? 409
            : 400
      return sendJson(res, status, { error: error.message, ...(error.code ? { code: error.code } : {}) })
    }
  }
  siteHandler.close = () => runtime.close()
  siteHandler.previewMiddleware = ({ base, authorizeRequest } = {}) => createSitePreviewMiddleware({
    base,
    authorizeRequest,
    getDevelopmentBaseUrl: id => store.getBinding(normalizeSiteId(id))?.developmentBaseUrl || null,
  })
  siteHandler.deleteSite = deleteSite
  siteHandler.diagnostics = () => store.list().map(site => {
    const binding = store.getBinding(site.id)
    const status = runtime.status(site.id)
    return {
      id: site.id,
      title: site.title,
      root: binding?.root || null,
      source: binding?.source || null,
      status: status?.status || binding?.status || 'stopped',
      running: Boolean(status?.running),
      pid: status?.pid || null,
      terminalSessionId: binding?.terminalSessionId || null,
      sessionOwnership: status?.sessionOwnership || (binding?.terminalSessionId ? 'paseo' : null),
    }
  })
  return siteHandler
}
