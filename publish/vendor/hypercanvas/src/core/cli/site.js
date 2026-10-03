import fs from 'node:fs'
import path from 'node:path'
import { SiteStore, SITE_CONFIG_FILE, detectSiteConfiguration, siteIdForTitle, assertAvailableSiteRoot, updateSiteDescriptor } from '../site/site.js'
import { SiteRuntime, discoverSiteServer, rebindSite } from '../site/runtime.js'
import { getPaseoConnection, ensurePaseoWorkspaceForRoot } from '../canvas/paseo-runtime-client.js'
import { initPaseoTerminalRuntime } from '../canvas/paseo-terminal-runtime.js'
import { die, jsonOut, parseSimpleArgs } from './cliHelpers.js'
import { resolveNotebookRoot } from './filesystemRoots.js'
import { registerNotebookPage, unregisterNotebookPage, updateNotebookPage } from '../notebook/notebook.js'

const subcommand = process.argv[3]
const { positional, flags } = parseSimpleArgs(process.argv.slice(4))
if (!subcommand || flags.help || flags.h) {
  console.log('Usage: storyboard site list | detect <project> | create <external-root> --title <name> [--description <text>] [--development-base-url <url>] [--start-command <command>] [--production-base-url <url>] | metadata <id> [--title <title>] [--description <text>] [--development-base-url <url>] [--start-command <command>] [--production-base-url <url>] [--root <external-directory> for rebind] | add <id> [--title <title>] [--description <text>] [--development-base-url <url>] [--root <external-project>] [--start-command <command>] [--production-base-url <url>] | remove <id> --confirmed | status <id> | logs <id> | start <id> | run <id> (alias for start) | stop <id> | restart <id> --confirmed | discover <id> | rebind <id> <url> | capture <id> [--route <route>] [--width <px>] [--height <px>]')
  process.exit(0)
}

const notebookRoot = resolveNotebookRoot(flags.notebook)
const store = new SiteStore(notebookRoot)
const startCommandFlag = flags['start-command'] ?? flags.start
const developmentBaseUrlFlag = flags['development-base-url'] ?? flags['local-url']
const productionBaseUrlFlag = flags['production-base-url'] ?? flags.production ?? flags['deploy-url']
if (Object.prototype.hasOwnProperty.call(flags, 'notebook-path')) {
  die('--notebook-path is no longer supported; Site directories must be external')
}

async function resolveNotebookWorkspaceId() {
  const connection = await getPaseoConnection()
  return ensurePaseoWorkspaceForRoot(connection.client, notebookRoot)
}

async function siteStatus(id) {
  const binding = store.getBinding(id)
  if (!binding) return null
  if (binding.source === 'url') {
    return {
      ...binding,
      status: binding.developmentBaseUrl ? 'running' : 'stopped',
      running: Boolean(binding.developmentBaseUrl),
      sessionOwnership: binding.developmentBaseUrl ? 'adopted' : null,
    }
  }
  if (!binding.root) return { ...binding, status: 'stopped', running: false, sessionOwnership: null }
  try {
    const discovery = await discoverSiteServer({ root: binding.root, previousBaseUrl: binding.developmentBaseUrl })
    if (discovery.baseUrl && discovery.baseUrl !== binding.developmentBaseUrl) store.upsertBinding(id, { developmentBaseUrl: discovery.baseUrl })
    const current = store.getBinding(id)
    return {
      ...current,
      status: discovery.baseUrl ? 'running' : 'stopped',
      pid: null,
      running: Boolean(discovery.baseUrl),
      sessionOwnership: current.terminalSessionId ? 'paseo' : discovery.baseUrl ? 'adopted' : null,
      discovery,
    }
  } catch (error) {
    return { ...binding, status: 'error', running: false, error: error.message, sessionOwnership: binding.terminalSessionId ? 'paseo' : null }
  }
}

try {
  let result
  if (subcommand === 'list') result = { sites: await Promise.all(store.list().map(async site => ({ ...site, binding: await siteStatus(site.id) }))) }
  else if (subcommand === 'detect') result = detectSiteConfiguration(positional[0] || process.cwd())
  else if (subcommand === 'create' || subcommand === 'metadata') {
    const id = subcommand === 'metadata' ? positional[0] : null
    const suppliedRoot = flags.root || (subcommand === 'create' ? positional[0] : null)
    const directory = suppliedRoot
    if (subcommand === 'metadata' && !flags.root) {
      if (!id || !store.get(id)) die(`Site not found: ${id}`)
      if (!Object.keys(flags).some(key => ['title', 'description', 'local-url', 'development-base-url', 'start', 'start-command', 'production', 'production-base-url', 'deploy-url'].includes(key))) die('Provide a Site field to edit')
      const title = flags.title === undefined ? undefined : String(flags.title).trim()
      const startCommand = startCommandFlag === undefined ? undefined : String(startCommandFlag).trim()
      if (flags.title && !title) die('Site name is required')
      if (startCommandFlag !== undefined && !startCommand) die('Dev command is required')
      const descriptorUpdates = {}
      if (title !== undefined) descriptorUpdates.title = title
      if (flags.description !== undefined) descriptorUpdates.description = String(flags.description)
      if (productionBaseUrlFlag !== undefined) descriptorUpdates.productionBaseUrl = productionBaseUrlFlag
      const site = Object.keys(descriptorUpdates).length
        ? store.upsert(updateSiteDescriptor(store.get(id), descriptorUpdates))
        : store.get(id)
      const bindingUpdates = {}
      if (startCommand !== undefined) bindingUpdates.startCommand = startCommand
      if (developmentBaseUrlFlag !== undefined) bindingUpdates.developmentBaseUrl = developmentBaseUrlFlag
      result = { site, binding: Object.keys(bindingUpdates).length ? store.upsertBinding(id, bindingUpdates) : store.getBinding(id) }
    } else {
      if (!directory || (subcommand === 'create' && !flags.title) || (id && !store.get(id))) die('Site name and an existing directory are required')
      const selected = assertAvailableSiteRoot(store, directory, id)
      if (selected === notebookRoot) die('This directory is already registered as a Notebook')
      const ptyRuntime = id ? await initPaseoTerminalRuntime(notebookRoot) : null
      try {
        if (id) {
          const runtime = new SiteRuntime(store, { ptyRuntime, requirePtyRuntime: true, reconcileOnStart: false, resolveNotebookWorkspaceId })
          await runtime.ready
          await runtime.stop(id)
        }
        const workspaceId = await resolveNotebookWorkspaceId()
        const detection = detectSiteConfiguration(selected)
        const startCommand = startCommandFlag || detection.findings.find(item => item.kind === 'start-command')?.value || 'npm run dev'
        const localUrl = developmentBaseUrlFlag ?? detection.findings.find(item => item.kind === 'local-url')?.value ?? null
        const siteId = id || siteIdForTitle(flags.title, store)
        const previous = id ? store.get(id) : { id: siteId, title: flags.title }
        const descriptorUpdates = {
          ...(flags.title !== undefined ? { title: String(flags.title).trim() } : {}),
          ...(flags.description !== undefined ? { description: String(flags.description) } : {}),
          ...(productionBaseUrlFlag !== undefined ? { productionBaseUrl: productionBaseUrlFlag } : {}),
        }
        const site = store.upsert(updateSiteDescriptor(previous, descriptorUpdates))
        const binding = store.upsertBinding(site.id, {
          source: 'managed', root: selected, workspaceId, startCommand, status: 'stopped', terminalSessionId: null,
          developmentBaseUrl: localUrl,
        })
        result = { site, binding }
      } finally {
        await ptyRuntime?.shutdown()
      }
    }
  }
  else if (subcommand === 'add') {
    if (!positional[0]) die('Usage: storyboard site add <id>')
    if (store.get(positional[0])) die(`Site already exists: ${positional[0]}`)
    const externalRoot = flags.root ? assertAvailableSiteRoot(store, flags.root) : null
    const site = store.upsert(updateSiteDescriptor({ id: positional[0], title: flags.title || positional[0] }, {
      title: flags.title || positional[0],
      ...(flags.description !== undefined ? { description: String(flags.description) } : {}),
      ...(productionBaseUrlFlag !== undefined ? { productionBaseUrl: productionBaseUrlFlag } : {}),
    }))
    const bindingUpdates = {
      ...(externalRoot ? { root: externalRoot } : {}),
      ...(startCommandFlag ? { startCommand: startCommandFlag } : {}),
      ...(developmentBaseUrlFlag ? { developmentBaseUrl: developmentBaseUrlFlag } : {}),
    }
    const binding = Object.keys(bindingUpdates).length
      ? store.upsertBinding(site.id, { source: flags.root || startCommandFlag ? 'managed' : 'url', ...bindingUpdates })
      : null
    result = { site, ...(binding ? { binding } : {}) }
  } else if (subcommand === 'remove' || subcommand === 'delete') {
    const id = positional[0]
    if (!id || !store.get(id)) die(`Site not found: ${id}`)
    if (fs.existsSync(path.join(notebookRoot, 'hypercanvas.notebook.json')) && flags.confirmed !== true) {
      die(`Removing Site "${id}" unregisters it from ${SITE_CONFIG_FILE} and leaves its external project intact. Re-run with --confirmed after reviewing this file.`)
    }
    const binding = store.getBinding(id)
    const ptyRuntime = binding?.terminalSessionId ? await initPaseoTerminalRuntime(notebookRoot) : null
    const runtime = new SiteRuntime(store, { ptyRuntime, requirePtyRuntime: false, reconcileOnStart: false })
    try {
      await runtime.stop(id)
      store.remove(id)
      unregisterNotebookPage(notebookRoot, { siteId: id })
      result = { success: true, deleted: id, files: [SITE_CONFIG_FILE] }
    } finally {
      await runtime.close()
      await ptyRuntime?.shutdown()
    }
  } else if (subcommand === 'status') {
    const id = positional[0]
    if (!id || !store.get(id)) die(`Site not found: ${id}`)
    result = await siteStatus(id)
  }
  else if (subcommand === 'capture') {
    const site = store.get(positional[0])
    const binding = store.getBinding(positional[0])
    if (!site || !binding?.developmentBaseUrl) die(`Site is not running: ${positional[0]}`)
    const playwright = await import(/* @vite-ignore */ 'playwright').catch(() => null)
    if (!playwright) die('Site frame capture requires playwright — install it with: npm install playwright && npx playwright install chromium')
    const { chromium } = playwright
    const { captureSiteFrame, readSiteCapture } = await import('../site/capture.js')
    const { resolveSiteUrl } = await import('../site/contract.js')
    const reference = { siteId: site.id, route: flags.route || '', width: Number(flags.width) || 800, height: Number(flags.height) || 600 }
    result = await captureSiteFrame({
      notebookRoot,
      reference,
      developmentUrl: resolveSiteUrl(binding.developmentBaseUrl, reference.siteId, reference.route),
      bindingRevision: binding.revision,
      captureAdapter: async ({ url, outputPath, viewport, colorScheme }) => {
        const browser = await chromium.launch({ headless: true })
        try {
          const page = await browser.newPage({ viewport, colorScheme })
          await page.goto(url, { waitUntil: 'networkidle' })
          await page.screenshot({ path: outputPath })
        } finally { await browser.close() }
      },
    })
    result.capture = await readSiteCapture(notebookRoot, reference, { bindingRevision: binding.revision })
  }
  else if (subcommand === 'logs') result = { logs: [] }
  else if (subcommand === 'start' || subcommand === 'run' || subcommand === 'stop' || subcommand === 'restart' || subcommand === 'discover' || subcommand === 'rebind') {
    if (!positional[0]) die(`Usage: storyboard site ${subcommand} <id>`)
    if (subcommand === 'discover') {
      const binding = store.getBinding(positional[0])
      if (!binding?.root) die(`Site requires a project root for discovery: ${positional[0]}`)
      result = await discoverSiteServer({ root: binding.root, previousBaseUrl: binding.developmentBaseUrl })
    } else if (subcommand === 'rebind') {
      const binding = store.getBinding(positional[0])
      if (!binding?.workspaceId) die(`Site requires a workspace binding: ${positional[0]}`)
      result = await rebindSite(store, positional[0], { workspaceId: binding.workspaceId, developmentBaseUrl: positional[1] })
    } else {
      const ptyRuntime = await initPaseoTerminalRuntime(notebookRoot)
      try {
        const runtime = new SiteRuntime(store, { ptyRuntime, requirePtyRuntime: true, reconcileOnStart: false, resolveNotebookWorkspaceId })
        await runtime.ready
        if (subcommand === 'start' || subcommand === 'run') result = await runtime.start(positional[0], { confirmed: true })
        else if (subcommand === 'stop') result = await runtime.stop(positional[0])
        else result = await runtime.restart(positional[0], { confirmed: Boolean(flags.confirmed) })
      } finally {
        await ptyRuntime.shutdown()
      }
    }
  }
  else die(`Unknown site subcommand: ${subcommand}`)
  if (result?.site?.id) {
    if (subcommand === 'metadata') updateNotebookPage(notebookRoot, { siteId: result.site.id }, { title: result.site.title })
    else if (['create', 'add'].includes(subcommand)) registerNotebookPage(notebookRoot, { type: 'site', siteId: result.site.id, title: result.site.title })
  }
  if (flags.json) jsonOut(result)
  else console.log(JSON.stringify(result, null, 2))
} catch (error) { die(error.message) }
