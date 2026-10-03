import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSiteRoutes } from './routes.js'
import { createFilesystemGrants } from '../system/filesystem-grants.js'
import { SiteStore } from './site.js'

const roots = []
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

function setup({ ptyRuntime = null, filesystemGrants, initialSites = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'site-create-'))
  roots.push(root)
  const notebook = path.join(root, 'notebook')
  const project = path.join(root, 'project')
  fs.mkdirSync(notebook)
  fs.mkdirSync(project)
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }))
  if (initialSites) {
    const configPath = path.join(notebook, '.storyboard', 'sites.config.json')
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(configPath, JSON.stringify({ formatVersion: 1, sites: initialSites }))
  }
  const resolveNotebookWorkspaceId = vi.fn(async () => 'workspace-notebook')
  const handler = createSiteRoutes({ root: notebook, resolveNotebookWorkspaceId, ptyRuntime, filesystemGrants, sendJson: (res, status, data) => Object.assign(res, { status, data }) })
  const requestWithHeaders = async (subpath, body = {}, method = 'POST', headers = { 'user-agent': 'node' }) => {
    const response = {}
    await handler({ url: `/_storyboard/site${subpath}`, headers }, response, { method, subpath, body })
    return response
  }
  const request = (...args) => requestWithHeaders(...args)
  return { notebook, project, resolveNotebookWorkspaceId, request, requestWithHeaders, handler }
}

describe('native Site registration and rebind', () => {
  it('infers a dev command, keeps Sites stopped, and increments colliding slugs', async () => {
    const { project, request, resolveNotebookWorkspaceId } = setup()
    const first = await request('/create', { title: 'Project', root: project })
    expect(first.status).toBe(201)
    expect(first.data.site).toMatchObject({ id: 'project', binding: { root: fs.realpathSync(project), workspaceId: 'workspace-notebook', startCommand: 'npm run dev', status: 'stopped' } })
    expect(resolveNotebookWorkspaceId).toHaveBeenCalledOnce()
    expect(resolveNotebookWorkspaceId).toHaveBeenCalledWith()
    const duplicate = await request('/create', { title: 'Other', root: project })
    expect(duplicate.status).toBe(409)
    const other = path.join(path.dirname(project), 'other')
    fs.mkdirSync(other)
    const second = await request('/create', { title: 'Project', root: other })
    expect(second.data.site.id).toBe('project-2')
  })

  it('creates a Site from a directory name containing a dot', async () => {
    const { project, request } = setup()
    const result = await request('/create', { title: 'Filesystem.Design', root: project })
    expect(result.status).toBe(201)
    expect(result.data.site).toMatchObject({ id: 'filesystem-design', title: 'Filesystem.Design' })
  })

  it('rejects Site source directories inside the Notebook and the removed notebookPath API', async () => {
    const { notebook, project, request, resolveNotebookWorkspaceId } = setup()
    const internalRoot = path.join(notebook, 'assets', 'app')
    fs.mkdirSync(internalRoot, { recursive: true })

    await expect(request('/create', { title: 'Internal Project', root: internalRoot })).resolves.toMatchObject({
      status: 400,
      data: { code: 'SITE_ROOT_INSIDE_NOTEBOOK' },
    })
    await expect(request('/create', { title: 'Legacy Copy', root: project, notebookPath: 'assets/sites/app' })).resolves.toMatchObject({
      status: 400,
      data: { error: expect.stringContaining('no longer supported') },
    })
    expect(resolveNotebookWorkspaceId).not.toHaveBeenCalled()
  })

  it('requires a same-origin Core picker grant before browser Site inspection and registration', async () => {
    const filesystemGrants = createFilesystemGrants()
    const origin = 'http://127.0.0.1:4317'
    const browserHeaders = { host: '127.0.0.1:4317', origin, 'sec-fetch-site': 'same-origin' }
    filesystemGrants.registerBrowserOrigin(origin)
    const { project, requestWithHeaders } = setup({ filesystemGrants })

    expect((await requestWithHeaders(`/detect?root=${encodeURIComponent(project)}`, {}, 'GET', {
      ...browserHeaders,
      origin: 'http://127.0.0.1:4318',
    })).status).toBe(403)
    expect((await requestWithHeaders(`/detect?root=${encodeURIComponent(project)}`, {}, 'GET', browserHeaders)).status).toBe(403)
    expect((await requestWithHeaders('/create', { title: 'Unselected project', root: project }, 'POST', browserHeaders)))
      .toMatchObject({ status: 403, data: { code: 'FILESYSTEM_GRANT_REQUIRED' } })

    filesystemGrants.grantDirectory(project, { purpose: 'site', request: { headers: browserHeaders } })
    expect((await requestWithHeaders(`/detect?root=${encodeURIComponent(project)}`, {}, 'GET', browserHeaders)).status).toBe(200)
    expect((await requestWithHeaders('/create', { title: 'Selected project', root: project }, 'POST', browserHeaders)).status).toBe(201)
  })

  it('creates and edits all Site metadata fields through the Site API', async () => {
    const { project, request } = setup()
    const created = await request('/create', {
      title: 'Project',
      root: project,
      description: 'Project documentation',
      developmentBaseUrl: 'http://localhost:4317/docs',
      productionBaseUrl: 'https://docs.example.com/guide',
    })
    expect(created.status).toBe(201)
    expect(created.data.site).toMatchObject({
      id: 'project',
      title: 'Project',
      description: 'Project documentation',
      deployments: { production: { baseUrl: 'https://docs.example.com/guide/' } },
      binding: { developmentBaseUrl: 'http://localhost:4317/docs/', startCommand: 'npm run dev' },
    })

    const updated = await request('/project/metadata', {
      title: 'Project Docs',
      description: 'Updated description',
      developmentBaseUrl: 'http://127.0.0.1:4318/docs',
      startCommand: 'npm run preview',
      productionBaseUrl: 'https://docs.example.com/v2',
    }, 'PATCH')
    expect(updated).toMatchObject({
      status: 200,
      data: { site: {
        title: 'Project Docs',
        description: 'Updated description',
        deployments: { production: { baseUrl: 'https://docs.example.com/v2/' } },
        binding: { developmentBaseUrl: 'http://127.0.0.1:4318/docs/', startCommand: 'npm run preview' },
      } },
    })
  })

  it('creates URL-backed Sites with the complete descriptor through the Site route', async () => {
    const { request } = setup()
    const created = await request('/', {
      id: 'external-docs',
      title: 'External Docs',
      description: 'Externally hosted docs',
      localUrl: 'http://localhost:4321/docs',
      startCommand: 'npm run dev',
      productionBaseUrl: 'https://docs.example.com',
    })

    expect(created.status).toBe(201)
    expect(created.data.site).toMatchObject({
      id: 'external-docs',
      title: 'External Docs',
      description: 'Externally hosted docs',
      deployments: { production: { baseUrl: 'https://docs.example.com/' } },
      binding: { source: 'url', developmentBaseUrl: 'http://localhost:4321/docs/', startCommand: 'npm run dev', running: true },
    })
  })

  it('detects the dev command when the routed path includes the directory query', async () => {
    const { project, request } = setup()
    const detection = await request(`/detect?root=${encodeURIComponent(project)}`, {}, 'GET')
    expect(detection.status).toBe(200)
    expect(detection.data.detection.findings).toContainEqual(expect.objectContaining({ kind: 'start-command', value: 'npm run dev' }))
  })

  it('requires a different directory for rebind and preserves the Site ID', async () => {
    const { project, request, resolveNotebookWorkspaceId } = setup()
    await request('/create', { title: 'Project', root: project })
    expect((await request('/project/metadata', { startCommand: 'npm run start' })).status).toBe(400)
    const next = path.join(path.dirname(project), 'renamed-project')
    fs.mkdirSync(next)
    const rebound = await request('/project/metadata', { root: next, startCommand: 'node server.js' })
    expect(rebound.data.site).toMatchObject({
      id: 'project',
      binding: {
        root: fs.realpathSync(next),
        workspaceId: 'workspace-notebook',
        startCommand: 'node server.js',
        status: 'stopped',
      },
    })
    expect(resolveNotebookWorkspaceId).toHaveBeenCalledTimes(2)
  })

  it('edits the Site name and command without rebinding its directory', async () => {
    const { project, request } = setup()
    await request('/create', { title: 'Project', root: project })
    const edited = await request('/project/metadata', { title: 'New Name', startCommand: 'yarn dev' }, 'PATCH')
    expect(edited).toMatchObject({ status: 200, data: { site: { id: 'project', title: 'New Name', binding: { root: fs.realpathSync(project), startCommand: 'yarn dev', status: 'stopped' } } } })
    expect((await request('/project/metadata', { root: project }, 'PATCH')).status).toBe(400)
  })

  it('reports a moved directory as missing and blocks starting until rebind', async () => {
    const { project, request } = setup()
    await request('/create', { title: 'Project', root: project })
    fs.renameSync(project, `${project}-moved`)
    const listed = await request('/list', {}, 'GET')
    expect(listed.data.sites[0].missing).toBe(true)
    const start = await request('/project/start', { confirmed: true })
    expect(start).toMatchObject({ status: 409, data: { code: 'SITE_REBIND_REQUIRED' } })
    const rebound = await request('/project/metadata', { root: `${project}-moved` })
    expect(rebound.data.site.id).toBe('project')
    expect((await request('/list', {}, 'GET')).data.sites[0].missing).toBe(false)
  })

  it('lists persisted Sites before runtime reconciliation finishes', async () => {
    let releaseTermination
    let signalTerminationStarted
    const terminalGate = new Promise(resolve => { releaseTermination = resolve })
    const terminationStarted = new Promise(resolve => { signalTerminationStarted = resolve })
    const ptyRuntime = {
      terminate: vi.fn(async () => {
        signalTerminationStarted()
        await terminalGate
        return { terminated: true }
      }),
    }
    const { handler, request } = setup({
      ptyRuntime,
      initialSites: {
        project: {
          id: 'project',
          title: 'Project',
          binding: { source: 'managed', workspaceId: 'workspace-project', terminalSessionId: 'site:project' },
        },
      },
    })

    try {
      await terminationStarted
      let timer
      const result = await Promise.race([
        request('/list', {}, 'GET').then(value => ({ value })),
        new Promise(resolve => { timer = setTimeout(() => resolve(null), 1000) }),
      ])
      clearTimeout(timer)

      expect(result).not.toBeNull()
      expect(result.value).toMatchObject({
        status: 200,
        data: { sites: [{ id: 'project', title: 'Project' }] },
      })
    } finally {
      releaseTermination()
      await handler.close()
    }
  })

  it('does not fall back to a hidden local process when the Paseo terminal runtime is unavailable', async () => {
    const { project, request } = setup()
    await request('/create', { title: 'Project', root: project })

    expect(await request('/project/start', { confirmed: true })).toMatchObject({
      status: 400,
      data: { code: 'PASEO_UNAVAILABLE' },
    })
  })

  it('stops the managed runtime before removing Site metadata without deleting its source folder', async () => {
    let notebook
    const terminate = vi.fn(async () => {
      expect(new SiteStore(notebook).get('project')).not.toBeNull()
    })
    const { notebook: root, project, request } = setup({ ptyRuntime: { terminate } })
    notebook = root
    await request('/create', { title: 'Project', root: project })
    const store = new SiteStore(root)
    store.upsertBinding('project', { root: null, status: 'running', terminalSessionId: 'site:project' })

    await expect(request('/project', {}, 'DELETE')).resolves.toMatchObject({
      status: 200,
      data: { success: true, deleted: 'project', files: ['.storyboard/sites.config.json'] },
    })

    expect(terminate).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'site:project',
      workspaceId: expect.any(String),
    }))
    expect(store.get('project')).toBeNull()
    expect(store.getBinding('project')).toBeNull()
    expect(fs.statSync(project).isDirectory()).toBe(true)
  })
})
