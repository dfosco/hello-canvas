import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  exportNotebookProject,
  deployPublish,
  preparePublish,
  publishingStatus,
  savePublishingCredential,
  setupPublishingRepository,
} from './publishing.js'
import { initializeNotebook, inspectNotebook, NOTEBOOK_MANIFEST_FILE } from './notebook.js'
import { materializeProject, PUBLICATION_MARKER_FILE, verifyMarker } from './publishing/generator.js'
import { buildProject } from './publishing/build.js'
import { ensureRepository, ensureCommitIdentity, findRepositoryRoot, resolveRepositoryRoot, stagePublication, runGit, remoteBranches, reconcileAndRestore, fetchRemote, commitPublication } from './publishing/git.js'
import { pagesWorkflowYaml, pagesUrl } from './publishing/github.js'
import { runOperation, redactOutput } from './publishing/operations.js'
import { createPublishingHandler } from './publishing-routes.js'
import { __test as publishingTest } from './publishing.js'

const roots = []
function temp(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `storyboard-${name}-`))
  roots.push(root)
  return root
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

const fixture = path.resolve('fixtures/notebooks/demo-notebook')

describe('Notebook Pages base paths', () => {
  it('uses project-page URLs by default and honors branch-prefixed overrides', () => {
    const configuredBase = process.env.VITE_BASE_PATH
    try {
      delete process.env.VITE_BASE_PATH
      expect(publishingTest.pagesBasePath('owner', 'notebook')).toBe('/notebook/')
      expect(publishingTest.pagesBasePath('owner', 'owner.github.io')).toBe('/')

      process.env.VITE_BASE_PATH = '/branch--preview/notebook'
      expect(publishingTest.pagesBasePath('owner', 'notebook')).toBe('/branch--preview/notebook/')
    } finally {
      if (configuredBase === undefined) delete process.env.VITE_BASE_PATH
      else process.env.VITE_BASE_PATH = configuredBase
    }
  })
})

async function withFakeGithub({ remoteRoot, owner, name, existingRepository = false, existingPages = false }, run) {
  const bin = temp('fake-gh')
  const stateFile = path.join(bin, 'state.json')
  const globalGitConfig = path.join(bin, 'gitconfig')
  const executable = path.join(bin, 'gh')
  const npmExecutable = path.join(bin, 'npm')
  fs.writeFileSync(stateFile, JSON.stringify({
    repositories: existingRepository ? { [`${owner}/${name}`]: true } : {},
    pages: existingPages ? { [`${owner}/${name}`]: { url: `https://${owner}.github.io/${name}/`, build_type: 'workflow' } } : {},
    repositoryCreates: 0,
    workflowDispatches: 0,
  }))
  fs.writeFileSync(globalGitConfig, `[url "file://${remoteRoot}"]\n  insteadOf = https://github.com/${owner}/${name}.git\n`)
  fs.writeFileSync(executable, `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
const stateFile = process.env.HYPERCANVAS_FAKE_GH_STATE
const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state))
const output = (value) => process.stdout.write(value)
const missing = () => { process.stderr.write('HTTP 404 Not Found'); process.exit(1) }
const repoKey = (value) => String(value || '').split('/').slice(-2).join('/')
if (args[0] === 'api' && args[1] === 'user') output('publish-user\\n')
else if (args[0] === 'repo' && args[1] === 'view') {
  const key = repoKey(args[2])
  if (!state.repositories[key]) missing()
  output(JSON.stringify({ nameWithOwner: key, visibility: 'PUBLIC', defaultBranchRef: { name: 'main' } }))
} else if (args[0] === 'repo' && args[1] === 'create') {
  state.repositories[repoKey(args[2])] = true
  state.repositoryCreates += 1
  save()
} else if (args[0] === 'api') {
  const endpoint = args.find((value) => value.startsWith('repos/') && value.endsWith('/pages'))
  if (!endpoint) missing()
  const key = repoKey(endpoint.slice('repos/'.length, -'/pages'.length))
  if (args.includes('--method')) {
    const [owner, name] = key.split('/')
    state.pages[key] = { url: 'https://' + owner + '.github.io/' + name + '/', build_type: 'workflow' }
    save()
  } else if (state.pages[key]) output(JSON.stringify({ html_url: state.pages[key].url, build_type: 'workflow' }))
  else missing()
} else if (args[0] === 'workflow' && args[1] === 'run') {
  state.workflowDispatches += 1
  save()
  output('')
}
else if (args[0] === 'run' && args[1] === 'list') output('[]')
else missing()
  `)
  fs.chmodSync(executable, 0o755)
  fs.writeFileSync(npmExecutable, `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
if (args[0] === '--version') process.stdout.write('10.0.0\\n')
else if (args[0] === 'run' && args[1] === 'build') {
  fs.mkdirSync(path.join(process.cwd(), 'dist'), { recursive: true })
  fs.writeFileSync(path.join(process.cwd(), 'dist/index.html'), '<!doctype html><title>test</title>')
  process.stdout.write('build complete\\n')
} else if (args[0] === 'install') {
  const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'))
  const lockPath = path.join(process.cwd(), 'package-lock.json')
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
  lock.packages[''].dependencies = packageJson.dependencies
  fs.writeFileSync(lockPath, JSON.stringify(lock))
  process.stdout.write('test lockfile updated\\n')
} else process.stdout.write('test npm command complete\\n')
`)
  fs.chmodSync(npmExecutable, 0o755)

  const keys = ['PATH', 'GIT_CONFIG_GLOBAL', 'HYPERCANVAS_FAKE_GH_STATE']
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  process.env.PATH = `${bin}:${process.env.PATH || ''}`
  process.env.GIT_CONFIG_GLOBAL = globalGitConfig
  process.env.HYPERCANVAS_FAKE_GH_STATE = stateFile
  try { return await run() } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
  }
}

describe('Notebook publishing contract', () => {
  it('generates the regular read-only Storyboard app with exact dependencies and a Pages fallback', async () => {
    const notebook = temp('notebook')
    initializeNotebook(notebook, { title: 'Export test' })
    fs.mkdirSync(path.join(notebook, 'canvas'), { recursive: true })
    fs.writeFileSync(path.join(notebook, 'canvas', 'welcome.canvas.jsonl'), JSON.stringify({ event: 'canvas_created', title: 'Welcome', widgets: [{ id: 'note-1', type: 'sticky-note', position: { x: 42, y: 84 }, props: { text: 'Public text', color: 'blue' } }], sources: [{ export: 'Greeting', url: 'https://example.com/source' }] }))
    const manifest = JSON.parse(fs.readFileSync(path.join(notebook, 'hypercanvas.notebook.json'), 'utf8'))
    fs.mkdirSync(path.join(notebook, 'prototypes', 'welcome'), { recursive: true })
    fs.writeFileSync(path.join(notebook, 'prototypes', 'welcome', 'index.jsx'), 'export default function Welcome() { return <main>Notebook prototype</main> }\n')
    manifest.pages = [
      { id: 'canvas-welcome', type: 'canvas', title: 'Welcome', path: 'canvas/welcome.canvas.jsonl' },
      { id: 'prototype-welcome', type: 'prototype', title: 'Welcome prototype', path: 'prototypes/welcome' },
    ]
    fs.writeFileSync(path.join(notebook, 'hypercanvas.notebook.json'), JSON.stringify(manifest))
    const output = temp('output')

    const before = fs.readFileSync(path.join(notebook, 'hypercanvas.notebook.json'), 'utf8')
    const result = await exportNotebookProject({ notebookRoot: notebook, destination: output, mode: 'external' })
    const pkg = JSON.parse(fs.readFileSync(path.join(output, 'package.json'), 'utf8'))
    const state = fs.readFileSync(path.join(output, 'notebook-content/canvas/welcome.canvas.jsonl'), 'utf8')
    const app = fs.readFileSync(path.join(output, 'src/library/_app.jsx'), 'utf8')
    const router = fs.readFileSync(path.join(output, 'src/library/routes.jsx'), 'utf8')
    const home = fs.readFileSync(path.join(output, 'src/library/index.jsx'), 'utf8')
    const config = fs.readFileSync(path.join(output, 'vite.config.js'), 'utf8')
    const marker = JSON.parse(fs.readFileSync(path.join(output, PUBLICATION_MARKER_FILE), 'utf8'))

    expect(result.destination).toBe(output)
    expect(pkg.scripts).toMatchObject({ dev: expect.stringContaining('build:runtime'), build: expect.stringContaining('build:runtime'), preview: 'vite preview' })
    expect(pkg.dependencies.react).toMatch(/^19\.2\./)
    expect(pkg.dependencies['@dfosco/hypercanvas']).toBe('file:vendor/hypercanvas')
    expect(Object.entries(pkg.dependencies).every(([name, version]) => name === '@dfosco/hypercanvas' || /^\d+\.\d+\.\d+/.test(version))).toBe(true)
    expect(fs.existsSync(path.join(output, 'vendor/hypercanvas/package.json'))).toBe(true)
    expect(fs.existsSync(path.join(output, 'vendor/hypercanvas/src/internals/context.jsx'))).toBe(true)
    expect(fs.existsSync(path.join(output, 'vendor/hypercanvas/vite.ui.config.js'))).toBe(true)
    expect(fs.existsSync(path.join(output, 'package-lock.json'))).toBe(true)
    expect(fs.existsSync(path.join(output, PUBLICATION_MARKER_FILE))).toBe(true)
    expect(JSON.parse(fs.readFileSync(path.join(output, NOTEBOOK_MANIFEST_FILE), 'utf8')))
      .toEqual(JSON.parse(fs.readFileSync(path.join(notebook, NOTEBOOK_MANIFEST_FILE), 'utf8')))
    expect(JSON.parse(fs.readFileSync(path.join(output, 'public', NOTEBOOK_MANIFEST_FILE), 'utf8')))
      .toEqual(JSON.parse(fs.readFileSync(path.join(notebook, NOTEBOOK_MANIFEST_FILE), 'utf8')))
    expect(fs.readFileSync(path.join(output, '.gitignore'), 'utf8')).not.toContain('dist/')
    expect(state).toContain('Public text')
    expect(state).toContain('https://example.com/source')
    expect(app).toContain('StoryboardProvider')
    expect(app).toContain('@dfosco/hypercanvas/canvas/style.css')
    expect(router).toContain('virtual:hypercanvas-notebook-routes')
    expect(router).toContain('prototypeLayoutRoute')
    expect(home).toContain("import HomePage from './home'")
    expect(home).toContain("import WorkspacePage from './workspace'")
    expect(config).toContain("process.env.HYPERCANVAS_NOTEBOOK_ROOT = path.resolve(__dirname, './notebook-content')")
    expect(config).toContain("const base = process.env.VITE_BASE_PATH || \"./\"")
    expect(fs.existsSync(path.join(output, 'notebook-content/prototypes/welcome/index.jsx'))).toBe(true)
    expect(JSON.parse(fs.readFileSync(path.join(output, 'notebook-content/prototypes/welcome/hypercanvas-publication.prototype.json'), 'utf8')))
      .toEqual({ meta: { title: 'Welcome prototype' } })
    expect(marker.generatedNotebookFiles).toContain('notebook-content/prototypes/welcome/hypercanvas-publication.prototype.json')
    expect(fs.existsSync(path.join(output, 'src/App.jsx'))).toBe(false)
    expect(fs.existsSync(path.join(output, 'src/CanvasPage.jsx'))).toBe(false)
    expect(fs.existsSync(path.join(output, 'src/generated'))).toBe(false)
    expect(fs.existsSync(path.join(output, 'public/404.html'))).toBe(true)
    expect(fs.readFileSync(path.join(notebook, 'hypercanvas.notebook.json'), 'utf8')).toBe(before)
    expect(fs.existsSync(path.join(notebook, '.storyboard/publishing.json'))).toBe(false)
  })

  it('generates the same regular runtime and Notebook sources deterministically', async () => {
    const first = temp('publish-one')
    const second = temp('publish-two')
    const one = await materializeProject({ notebookRoot: fixture, destination: first, mode: 'external' })
    await materializeProject({ notebookRoot: fixture, destination: second, mode: 'external' })
    expect(one.pages.map(({ id }) => id)).toContain('canvas-welcome')
    expect(fs.readFileSync(path.join(first, 'package.json'), 'utf8'))
      .toBe(fs.readFileSync(path.join(second, 'package.json'), 'utf8'))
    expect(fs.readFileSync(path.join(first, 'src/library/routes.jsx'), 'utf8'))
      .toBe(fs.readFileSync(path.join(second, 'src/library/routes.jsx'), 'utf8'))
    expect(fs.existsSync(path.join(first, 'notebook-content/prototypes/loopline-signup/SignupForm.jsx'))).toBe(true)
    expect(fs.existsSync(path.join(first, 'src/generated'))).toBe(false)
    expect(fs.existsSync(path.join(first, 'dist'))).toBe(false)
  })

  it('copies arbitrary Notebook directories, honors ignore rules, and only removes stale owned files', async () => {
    const notebook = temp('publish-custom-folders-notebook')
    const project = temp('publish-custom-folders-project')
    fs.cpSync(fixture, notebook, { recursive: true })
    fs.writeFileSync(path.join(notebook, '.gitignore'), 'private-content/\n')
    fs.mkdirSync(path.join(notebook, 'components/Chart'), { recursive: true })
    fs.mkdirSync(path.join(notebook, 'visualization'), { recursive: true })
    fs.writeFileSync(path.join(notebook, 'visualization/.gitignore'), 'private.*\n!private.keep.js\n')
    fs.writeFileSync(path.join(notebook, 'visualization/private.drop.js'), 'ignored by nested rules\n')
    fs.writeFileSync(path.join(notebook, 'visualization/private.keep.js'), 'explicitly included by nested rules\n')
    fs.mkdirSync(path.join(notebook, 'private-content'), { recursive: true })
    fs.mkdirSync(path.join(notebook, '.storyboard'), { recursive: true })
    fs.mkdirSync(path.join(notebook, 'publish'), { recursive: true })
    fs.writeFileSync(path.join(notebook, 'components/Chart/Chart.jsx'), "import format from '../../visualization/format.js'\nexport default function Chart() { return <div>{format(42)}</div> }\n")
    fs.writeFileSync(path.join(notebook, 'visualization/format.js'), 'export default (value) => `value: ${value}`\n')
    fs.writeFileSync(path.join(notebook, 'visualization/obsolete.js'), 'export default true\n')
    fs.writeFileSync(path.join(notebook, 'private-content/secret.js'), 'not public\n')
    fs.writeFileSync(path.join(notebook, '.storyboard/runtime.json'), '{"private":true}\n')
    fs.writeFileSync(path.join(notebook, 'publish/previous-build.txt'), 'not a source folder\n')
    fs.writeFileSync(path.join(notebook, 'prototypes/welcome/index.jsx'), [
      "import Chart from '../../components/Chart/Chart.jsx'",
      'export default function Welcome() { return <Chart /> }',
      '',
    ].join('\n'))

    const result = await materializeProject({ notebookRoot: notebook, destination: project, mode: 'external' })
    expect(fs.existsSync(path.join(project, 'notebook-content/components/Chart/Chart.jsx'))).toBe(true)
    expect(fs.existsSync(path.join(project, 'notebook-content/visualization/format.js'))).toBe(true)
    expect(fs.existsSync(path.join(project, 'notebook-content/visualization/private.drop.js'))).toBe(false)
    expect(fs.existsSync(path.join(project, 'notebook-content/visualization/private.keep.js'))).toBe(true)
    expect(fs.existsSync(path.join(project, 'notebook-content/private-content/secret.js'))).toBe(false)
    expect(fs.existsSync(path.join(project, '.storyboard/runtime.json'))).toBe(false)
    expect(fs.existsSync(path.join(project, 'publish/previous-build.txt'))).toBe(false)
    expect(result.marker.sourceFiles).toContain('components/Chart/Chart.jsx')
    expect(result.marker.sourceFiles).toContain('visualization/format.js')
    expect(result.marker.sourceFiles).not.toContain('private-content/secret.js')

    const externalNote = path.join(project, 'notebook-content/visualization/project-note.md')
    fs.writeFileSync(externalNote, 'keep this unrelated file')
    fs.rmSync(path.join(notebook, 'visualization/obsolete.js'))
    await materializeProject({ notebookRoot: notebook, destination: project, mode: 'external' })
    expect(fs.existsSync(path.join(project, 'notebook-content/visualization/obsolete.js'))).toBe(false)
    expect(fs.readFileSync(externalNote, 'utf8')).toBe('keep this unrelated file')
  })

  it('refuses Notebook source files that collide with an unrelated external project file', async () => {
    const notebook = temp('publish-source-conflict-notebook')
    const project = temp('publish-source-conflict-project')
    fs.cpSync(fixture, notebook, { recursive: true })
    await materializeProject({ notebookRoot: notebook, destination: project, mode: 'external' })
    fs.mkdirSync(path.join(project, 'notebook-content/custom'), { recursive: true })
    fs.writeFileSync(path.join(project, 'notebook-content/custom/keep.js'), 'external user work')
    fs.mkdirSync(path.join(notebook, 'custom'), { recursive: true })
    fs.writeFileSync(path.join(notebook, 'custom/keep.js'), 'Notebook source')

    await expect(materializeProject({ notebookRoot: notebook, destination: project, mode: 'external' }))
      .rejects.toMatchObject({ code: 'PUBLISH_SOURCE_CONFLICT' })
    expect(fs.readFileSync(path.join(project, 'notebook-content/custom/keep.js'), 'utf8')).toBe('external user work')
  })

  it('pins bare package imports from copied prototypes and refreshes their lockfile before npm ci', async () => {
    const project = temp('publish-prototype-dependency')
    const notebook = temp('publish-prototype-dependency-notebook')
    fs.cpSync(fixture, notebook, { recursive: true })
    fs.writeFileSync(path.join(notebook, 'prototypes/welcome/index.jsx'), [
      "import { PlusIcon } from '@primer/octicons-react'",
      '',
      'export default function Welcome() {',
      '  return <main><PlusIcon /><h1>Welcome</h1></main>',
      '}',
      '',
    ].join('\n'))

    await materializeProject({ notebookRoot: notebook, destination: project, mode: 'external' })
    const manifest = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8'))
    const initialLock = JSON.parse(fs.readFileSync(path.join(project, 'package-lock.json'), 'utf8'))
    expect(manifest.dependencies['@primer/octicons-react']).toBe('19.21.1')
    expect(initialLock.packages[''].dependencies['@primer/octicons-react']).toBeUndefined()

    const calls = []
    await buildProject({
      projectDir: project,
      commandRunner: async (args) => {
        calls.push(args)
        if (args[0] === 'install') {
          initialLock.packages[''].dependencies = { ...manifest.dependencies }
          fs.writeFileSync(path.join(project, 'package-lock.json'), JSON.stringify(initialLock))
        }
        if (args[0] === 'run') {
          fs.mkdirSync(path.join(project, 'dist'), { recursive: true })
          fs.writeFileSync(path.join(project, 'dist/index.html'), 'built')
        }
        return { stdout: 'ok' }
      },
    })
    expect(calls).toEqual([
      ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
      ['ci'],
      ['run', 'build'],
    ])
  })

  it('never deletes Git metadata, dist, workflow, or unrelated files during regeneration', async () => {
    const output = temp('publish-managed')
    await materializeProject({ notebookRoot: fixture, destination: output, mode: 'external' })
    fs.mkdirSync(path.join(output, '.git'))
    fs.mkdirSync(path.join(output, 'dist'))
    fs.mkdirSync(path.join(output, '.github/workflows'), { recursive: true })
    fs.writeFileSync(path.join(output, 'dist/index.html'), 'built')
    fs.writeFileSync(path.join(output, '.github/workflows/deploy-pages.yml'), 'workflow')
    fs.writeFileSync(path.join(output, 'my-notes.txt'), 'user')

    await materializeProject({ notebookRoot: fixture, destination: output, mode: 'external' })

    expect(fs.existsSync(path.join(output, '.git'))).toBe(true)
    expect(fs.readFileSync(path.join(output, 'dist/index.html'), 'utf8')).toBe('built')
    expect(fs.readFileSync(path.join(output, '.github/workflows/deploy-pages.yml'), 'utf8')).toBe('workflow')
    expect(fs.readFileSync(path.join(output, 'my-notes.txt'), 'utf8')).toBe('user')
  })

  it('refuses non-empty unknown destinations and identity-mismatched projects', async () => {
    const notebook = temp('notebook')
    const output = temp('output')
    initializeNotebook(notebook)
    fs.writeFileSync(path.join(output, 'keep.txt'), 'keep')
    await expect(exportNotebookProject({ notebookRoot: notebook, destination: output, mode: 'external' }))
      .rejects.toThrow(/not an empty folder or a recognized Hypercanvas publication/)
    expect(fs.readFileSync(path.join(output, 'keep.txt'), 'utf8')).toBe('keep')

    const publishedOutput = temp('published-output')
    await materializeProject({ notebookRoot: notebook, destination: publishedOutput, mode: 'external' })
    const other = temp('notebook-other')
    initializeNotebook(other)
    expect(() => verifyMarker(publishedOutput, inspectNotebook(other))).toThrow(/bound to another Notebook/)
  })

  it('removes stale Notebook-owned prototype and asset files without removing unrelated files', async () => {
    const output = temp('publish-cleanup')
    const notebook = temp('publish-cleanup-notebook')
    fs.cpSync(fixture, notebook, { recursive: true })
    const staleSource = path.join(notebook, 'prototypes/old/old.jsx')
    fs.mkdirSync(path.dirname(staleSource), { recursive: true })
    fs.writeFileSync(staleSource, 'owned source')
    const manifestPath = path.join(notebook, NOTEBOOK_MANIFEST_FILE)
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    manifest.pages.push({ id: 'prototype-old', type: 'prototype', title: 'Old Prototype', path: 'prototypes/old' })
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
    await materializeProject({ notebookRoot: notebook, destination: output, mode: 'external' })
    const stale = path.join(output, 'notebook-content/prototypes/old/old.jsx')
    const generatedMetadata = path.join(output, 'notebook-content/prototypes/old/hypercanvas-publication.prototype.json')
    expect(fs.existsSync(stale)).toBe(true)
    expect(fs.existsSync(generatedMetadata)).toBe(true)
    fs.rmSync(path.dirname(staleSource), { recursive: true, force: true })
    const unrelated = path.join(output, 'notebook-content/prototypes/notes.txt')
    fs.writeFileSync(unrelated, 'user-owned')
    await materializeProject({ notebookRoot: notebook, destination: output, mode: 'external' })
    expect(fs.existsSync(stale)).toBe(false)
    expect(fs.existsSync(generatedMetadata)).toBe(false)
    expect(fs.readFileSync(unrelated, 'utf8')).toBe('user-owned')
  })

  it('supports private credentials only in runtime state and redacts output', () => {
    const root = temp('app')
    savePublishingCredential({ root, provider: 'vercel', token: 'secret-token' })
    expect(JSON.stringify(publishingStatus(root))).not.toContain('secret-token')
    expect(redactOutput('ghp_abcdefghijklmnopqrstuvwxyz123456 https://x-access-token:secret@github.com/repo'))
      .not.toContain('secret')
  })

  it('retains legacy prepare shape while using the portable project generator', async () => {
    const root = temp('app')
    const notebook = temp('notebook')
    initializeNotebook(notebook)
    const result = await preparePublish({ root, notebookRoot: notebook, provider: 'github-pages' })
    expect(fs.realpathSync.native(result.destination)).toBe(path.join(fs.realpathSync.native(notebook), 'publish'))
    expect(fs.existsSync(path.join(notebook, 'publish/package-lock.json'))).toBe(true)
    expect(publishingStatus(root).projects).toHaveLength(1)
  })

  it('rejects publishing into a sibling path within the Notebook and parent repositories', async () => {
    const notebook = temp('notebook')
    initializeNotebook(notebook)
    await expect(exportNotebookProject({ notebookRoot: notebook, destination: path.join(notebook, 'other'), mode: 'external' }))
      .rejects.toThrow(/outside the Notebook/)
    await expect(exportNotebookProject({ notebookRoot: notebook, destination: path.join(notebook, 'publish'), mode: 'external' }))
      .rejects.toThrow(/outside the Notebook/)

    const parent = temp('parent-repo')
    const child = path.join(parent, 'notebook')
    initializeNotebook(child)
    runGit(parent, ['init', '-b', 'main'])
    expect(() => resolveRepositoryRoot({ notebookRoot: child, projectDir: path.join(child, 'publish'), mode: 'default' }))
      .toThrow(/inside an existing Git repository/)

    const external = path.join(parent, 'external-site')
    expect(() => resolveRepositoryRoot({ notebookRoot: temp('unrelated-notebook'), projectDir: external, mode: 'external' }))
      .toThrow(/inside an existing Git repository/)
  })

  it('publishes when Site Frames lack previews or production URLs and reports advisory warnings', async () => {
    const notebook = temp('frame-notebook')
    const output = temp('frame-output')
    initializeNotebook(notebook)
    const relative = 'canvas/frame.canvas.jsonl'
    fs.mkdirSync(path.dirname(path.join(notebook, relative)), { recursive: true })
    fs.writeFileSync(path.join(notebook, relative), `${JSON.stringify({
      event: 'canvas_created',
      title: 'Frame canvas',
      widgets: [{ id: 'frame-1', type: 'site-frame', position: { x: 0, y: 0 }, props: { siteId: 'missing-site', title: 'Docs' } }],
      connectors: [],
    })}\n`)
    const manifestPath = path.join(notebook, 'hypercanvas.notebook.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    manifest.pages = [{ id: 'frame-canvas', type: 'canvas', title: 'Frame canvas', path: relative }]
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const project = await exportNotebookProject({ notebookRoot: notebook, destination: output, mode: 'external' })
    expect(project.warnings.map(warning => warning.code)).toEqual([
      'FRAME_SNAPSHOT_MISSING',
      'FRAME_PRODUCTION_URL_MISSING',
    ])
    expect(fs.existsSync(path.join(output, 'package.json'))).toBe(true)
    const publishedCanvas = fs.readFileSync(path.join(output, 'notebook-content/canvas/frame.canvas.jsonl'), 'utf8')
    expect(publishedCanvas).toContain('site-frame')
    expect(publishedCanvas).not.toContain('FRAME_SNAPSHOT_PREFLIGHT_FAILED')
  })
})

describe('Notebook publishing Git and Actions', () => {
  it.each(['default', 'external'])('publishes a portable site end to end in %s repository mode', async (mode) => {
    const notebook = temp(`publish-e2e-${mode}`)
    fs.cpSync(fixture, notebook, { recursive: true })
    const welcomePrototype = path.join(notebook, 'prototypes/welcome/index.jsx')
    fs.writeFileSync(welcomePrototype, [
      "import { PlusIcon } from '@primer/octicons-react'",
      "import SiloChart from '../../components/SiloChart/SiloChart.jsx'",
      '',
      'export default function Welcome() {',
      '  return <main><PlusIcon /><h1>Welcome to Hypercanvas</h1><SiloChart /></main>',
      '}',
      '',
    ].join('\n'))
    fs.mkdirSync(path.join(notebook, 'components/SiloChart'), { recursive: true })
    fs.mkdirSync(path.join(notebook, 'visualization'), { recursive: true })
    fs.writeFileSync(path.join(notebook, 'components/SiloChart/SiloChart.jsx'), [
      "import { formatValue } from '../../visualization/format.js'",
      'export default function SiloChart() { return <p>{formatValue(42)}</p> }',
      '',
    ].join('\n'))
    fs.writeFileSync(path.join(notebook, 'visualization/format.js'), 'export const formatValue = (value) => `Utilization ${value}%`\n')
    fs.writeFileSync(path.join(notebook, '.gitignore'), 'private-content/\n')
    fs.mkdirSync(path.join(notebook, 'private-content'), { recursive: true })
    fs.writeFileSync(path.join(notebook, 'private-content/secret.txt'), 'not for publication')
    const destination = mode === 'external' ? temp('publish-e2e-external') : undefined
    const remoteRoot = temp(`publish-e2e-remote-${mode}`)
    const owner = 'publish-test'
    const name = `notebook-${mode}`
    runGit(remoteRoot, ['init', '--bare', '--initial-branch=main'])

    const operation = await withFakeGithub({ remoteRoot, owner, name }, () => deployPublish({
      root: notebook,
      notebookRoot: notebook,
      mode,
      destination,
      repositoryMode: 'create',
      owner,
      name,
      visibility: 'public',
      branch: 'main',
    }))

    expect(operation.status, JSON.stringify({ steps: operation.steps, error: operation.error }, null, 2)).toBe('succeeded')
    expect(operation.output).toEqual(expect.arrayContaining([
      expect.stringContaining('$ git init'),
      expect.stringContaining('$ git add'),
      expect.stringContaining('$ git push'),
      expect.stringContaining('$ npm run build'),
    ]))
    expect(operation).not.toHaveProperty('terminal')
    expect(operation.result.pagesUrl).toBe(`https://${owner}.github.io/${name}/`)
    const projectDir = mode === 'default' ? path.join(notebook, 'publish') : destination
    const generatedPackage = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'))
    const generatedLock = JSON.parse(fs.readFileSync(path.join(projectDir, 'package-lock.json'), 'utf8'))
    expect(generatedPackage.dependencies['@primer/octicons-react']).toBe('19.21.1')
    expect(generatedLock.packages[''].dependencies['@primer/octicons-react']).toBe('19.21.1')
    expect(fs.existsSync(path.join(projectDir, 'notebook-content/components/SiloChart/SiloChart.jsx'))).toBe(true)
    expect(fs.existsSync(path.join(projectDir, 'notebook-content/visualization/format.js'))).toBe(true)
    expect(fs.existsSync(path.join(projectDir, 'notebook-content/private-content/secret.txt'))).toBe(false)
    const repositoryRoot = mode === 'default' ? notebook : destination
    const inventory = String(runGit(remoteRoot, ['ls-tree', '-r', '--name-only', 'refs/heads/main']).output)
    expect(inventory).toContain(mode === 'default' ? 'publish/dist/index.html' : 'dist/index.html')
    expect(inventory).toContain(mode === 'default' ? 'publish/hypercanvas.publication.json' : 'hypercanvas.publication.json')
    expect(inventory).toContain(mode === 'default' ? 'publish/notebook-content/components/SiloChart/SiloChart.jsx' : 'notebook-content/components/SiloChart/SiloChart.jsx')
    expect(inventory).toContain(mode === 'default' ? 'publish/notebook-content/visualization/format.js' : 'notebook-content/visualization/format.js')
    expect(inventory).toContain('.github/workflows/deploy-pages.yml')
    expect(inventory).not.toContain('.storyboard/')
    expect(inventory).not.toContain('private-content/secret.txt')
    const workflow = String(runGit(remoteRoot, ['show', 'refs/heads/main:.github/workflows/deploy-pages.yml']).output)
    expect(workflow).toContain(mode === 'default' ? 'path: publish/dist' : 'path: dist')
    expect(workflow).not.toContain('npm run build')
    if (mode === 'external') expect(findRepositoryRoot(notebook)).toBeNull()
    else expect(findRepositoryRoot(repositoryRoot)).toBe(fs.realpathSync.native(notebook))

    // A second machine can clone the publication and safely update changed
    // Notebook content using the portable identity marker as proof of owner.
    const clone = temp(`publish-e2e-clone-${mode}`)
    runGit(process.cwd(), ['clone', remoteRoot, clone])
    runGit(clone, ['remote', 'set-url', 'origin', `https://github.com/${owner}/${name}.git`])
    const publishNotebook = mode === 'default' ? clone : notebook
    const publishDestination = mode === 'external' ? clone : undefined
    const canvasPath = path.join(publishNotebook, 'canvas/welcome.canvas.jsonl')
    const changedCanvas = fs.readFileSync(canvasPath, 'utf8')
      .replace('This is a content-only Hypercanvas Notebook.', 'Updated by a clone during republishing.')
    fs.writeFileSync(canvasPath, changedCanvas)
    const republished = await withFakeGithub({ remoteRoot, owner, name, existingRepository: true }, () => deployPublish({
      root: publishNotebook,
      notebookRoot: publishNotebook,
      mode,
      destination: publishDestination,
      repositoryMode: 'connect',
      owner,
      name,
      visibility: 'public',
      branch: 'main',
    }))
    expect(republished.status, JSON.stringify({ steps: republished.steps, error: republished.error, output: republished.output }, null, 2)).toBe('succeeded')
    const publishedStatePath = mode === 'default'
      ? 'publish/notebook-content/canvas/welcome.canvas.jsonl'
      : 'notebook-content/canvas/welcome.canvas.jsonl'
    expect(String(runGit(remoteRoot, ['show', `refs/heads/main:${publishedStatePath}`]).output))
      .toContain('Updated by a clone during republishing.')

    const unchangedHead = String(runGit(remoteRoot, ['rev-parse', 'refs/heads/main']).output).trim()
    const { operation: repeated, githubState } = await withFakeGithub({
      remoteRoot,
      owner,
      name,
      existingRepository: true,
      existingPages: true,
    }, async () => {
      const operation = await deployPublish({
        root: publishNotebook,
        notebookRoot: publishNotebook,
        mode,
        destination: publishDestination,
        repositoryMode: 'create',
        owner,
        name,
        visibility: 'public',
        branch: 'main',
      })
      return {
        operation,
        githubState: JSON.parse(fs.readFileSync(process.env.HYPERCANVAS_FAKE_GH_STATE, 'utf8')),
      }
    })
    expect(repeated.status, JSON.stringify({ steps: repeated.steps, error: repeated.error, output: repeated.output }, null, 2)).toBe('succeeded')
    expect(String(runGit(remoteRoot, ['rev-parse', 'refs/heads/main']).output).trim()).toBe(unchangedHead)
    expect(githubState.repositoryCreates).toBe(0)
    expect(githubState.workflowDispatches).toBe(0)
  }, 120_000)

  it('preserves an unmarked default publish folder and stops before initializing local or remote repositories', async () => {
    const notebook = temp('occupied-default-publish')
    initializeNotebook(notebook)
    const publishDir = path.join(notebook, 'publish')
    fs.mkdirSync(publishDir)
    fs.writeFileSync(path.join(publishDir, 'user-content.txt'), 'keep this content')

    const remoteRoot = temp('occupied-default-remote')
    runGit(remoteRoot, ['init', '--bare', '--initial-branch=main'])
    const owner = 'publish-test'
    const name = 'occupied-publish'
    let operation
    let githubState

    await withFakeGithub({ remoteRoot, owner, name }, async () => {
      operation = await deployPublish({
        root: notebook,
        notebookRoot: notebook,
        mode: 'default',
        repositoryMode: 'create',
        owner,
        name,
        visibility: 'public',
        branch: 'main',
      })
      githubState = JSON.parse(fs.readFileSync(process.env.HYPERCANVAS_FAKE_GH_STATE, 'utf8'))
    })

    expect(operation.status).toBe('awaiting_retry')
    expect(operation.steps.map(({ name: step, status }) => [step, status])).toEqual([
      ['validate', 'succeeded'],
      ['repository-root', 'succeeded'],
      ['generate', 'failed'],
    ])
    expect(operation.error).toMatchObject({ code: 'NOT_A_PUBLICATION' })
    expect(operation.error.hint).toContain('outside the Notebook')
    expect(operation.error.detail).toBe(fs.realpathSync.native(publishDir))
    expect(operation.error).not.toHaveProperty('output')
    expect(operation.output).toEqual([])
    expect(findRepositoryRoot(notebook)).toBeNull()
    expect(fs.existsSync(path.join(notebook, '.git'))).toBe(false)
    expect(githubState.repositories).toEqual({})
    expect(fs.readFileSync(path.join(publishDir, 'user-content.txt'), 'utf8')).toBe('keep this content')
  })

  it('refuses a connected repository with an unrelated Pages site before installing a workflow', async () => {
    const notebook = temp('pages-ownership-notebook')
    fs.cpSync(fixture, notebook, { recursive: true })
    const remoteRoot = temp('pages-ownership-remote')
    const owner = 'publish-test'
    const name = 'unrelated-pages'
    runGit(remoteRoot, ['init', '--bare', '--initial-branch=main'])

    await withFakeGithub({ remoteRoot, owner, name, existingRepository: true, existingPages: true }, async () => {
      await expect(setupPublishingRepository({
        root: notebook,
        notebookRoot: notebook,
        mode: 'default',
        repositoryMode: 'connect',
        owner,
        name,
      })).rejects.toMatchObject({ code: 'REMOTE_NOT_PUBLICATION' })
    })

    expect(fs.existsSync(path.join(notebook, '.github/workflows/deploy-pages.yml'))).toBe(false)
    expect(fs.readdirSync(path.join(remoteRoot, 'refs/heads'))).toEqual([])
  })

  it('awaits asynchronous generator results in publishing API routes', async () => {
    const notebook = temp('route-notebook')
    initializeNotebook(notebook)
    let response
    const handler = createPublishingHandler({
      root: notebook,
      getNotebookRoot: () => notebook,
      sendJson: (_res, status, body) => {
        response = { status, body }
        return response
      },
    })

    await handler({}, {}, { method: 'POST', path: '/project', body: { mode: 'default' } })
    expect(response.status).toBe(200)
    expect(fs.realpathSync.native(response.body.destination)).toBe(fs.realpathSync.native(notebook) + '/publish')

    await handler({}, {}, { method: 'POST', path: '/prepare', body: { provider: 'github-pages' } })
    expect(response.status).toBe(200)
    expect(fs.realpathSync.native(response.body.destination)).toBe(fs.realpathSync.native(notebook) + '/publish')
    expect(response.body.id).toMatch(/^publish_/)
  })

  it('initializes the Notebook root and stages unignored content, excluding .storyboard', () => {
    const notebook = temp('notebook-git')
    initializeNotebook(notebook)
    fs.writeFileSync(path.join(notebook, '.gitignore'), 'private.txt\n')
    fs.writeFileSync(path.join(notebook, 'public.txt'), 'public')
    fs.writeFileSync(path.join(notebook, 'private.txt'), 'private')
    fs.mkdirSync(path.join(notebook, '.storyboard'), { recursive: true })
    fs.writeFileSync(path.join(notebook, '.storyboard', 'publishing.json'), '{"private":true}')
    const repo = ensureRepository({ repositoryRoot: notebook, branch: 'main' })
    expect(findRepositoryRoot(notebook)).toBe(fs.realpathSync.native(repo))
    stagePublication({ repositoryRoot: notebook, mode: 'default' })
    const staged = String(runGit(notebook, ['diff', '--cached', '--name-only']).output)
    expect(staged).toContain('public.txt')
    expect(staged).not.toContain('private.txt')
    expect(staged).not.toContain('.storyboard')
  })

  it('preserves origin and rejects mismatched origins before takeover', async () => {
    const root = temp('notebook-origin')
    initializeNotebook(root)
    const project = path.join(root, 'publish')
    await materializeProject({ notebookRoot: root, destination: project, mode: 'default' })
    ensureRepository({ repositoryRoot: root, branch: 'main' })
    runGit(root, ['remote', 'add', 'origin', 'git@github.com:someone/different.git'])
    await expect(setupPublishingRepository({
      root, notebookRoot: root, mode: 'default', repositoryMode: 'connect', owner: 'dfosco', name: 'site',
    })).rejects.toMatchObject({ code: 'ORIGIN_MISMATCH' })
    expect(String(runGit(root, ['remote', 'get-url', 'origin']).output)).toContain('someone/different.git')
  })

  it('emits Pages Actions workflow for the repository-mode-specific dist path', () => {
    const defaultWorkflow = pagesWorkflowYaml({ branch: 'main', distPath: 'publish/dist' })
    const externalWorkflow = pagesWorkflowYaml({ branch: 'release', distPath: 'dist' })
    expect(defaultWorkflow).toContain('pages: write')
    expect(defaultWorkflow).toContain('id-token: write')
    expect(defaultWorkflow).toContain('actions/upload-pages-artifact@v3')
    expect(defaultWorkflow).toContain('path: publish/dist')
    expect(defaultWorkflow).not.toContain('npm run build')
    expect(externalWorkflow).toContain('path: dist')
    expect(externalWorkflow).toContain('branches: [release]')
    expect(pagesUrl({ owner: 'dfosco', name: 'my-site' })).toBe('https://dfosco.github.io/my-site/')
  })

  it('preserves an unrelated workflow instead of replacing it', () => {
    const repositoryRoot = temp('workflow-conflict')
    const workflowPath = path.join(repositoryRoot, '.github/workflows/deploy-pages.yml')
    fs.mkdirSync(path.dirname(workflowPath), { recursive: true })
    fs.writeFileSync(workflowPath, 'name: User deployment\n')

    let caught
    try { publishingTest.installWorkflow({ repositoryRoot, mode: 'external', branch: 'main' }) } catch (error) { caught = error }
    expect(caught).toMatchObject({ code: 'PAGES_WORKFLOW_CONFLICT' })
    expect(fs.readFileSync(workflowPath, 'utf8')).toBe('name: User deployment\n')
  })

  it('treats an empty remote branch as a valid first-publish target', () => {
    const repositoryRoot = temp('empty-origin-local')
    const remoteRoot = temp('empty-origin-remote')
    runGit(repositoryRoot, ['init', '-b', 'main'])
    runGit(remoteRoot, ['init', '--bare', '--initial-branch=main'])
    ensureCommitIdentity(repositoryRoot)
    fs.writeFileSync(path.join(repositoryRoot, 'Notebook.txt'), 'publish me\n')
    runGit(repositoryRoot, ['add', 'Notebook.txt'])
    runGit(repositoryRoot, ['commit', '-m', 'Create first local commit'])
    runGit(repositoryRoot, ['remote', 'add', 'origin', remoteRoot])

    expect(fetchRemote({ repositoryRoot, branch: 'main' })).toMatchObject({ fetched: false, reason: 'branch-not-found' })
    expect(reconcileAndRestore({ repositoryRoot, branch: 'main' })).toMatchObject({ reconciled: true })
    expect(remoteBranches({ repositoryRoot })).toEqual([])
  })

  it('bootstraps an unborn repository, then reconciles before its first push', () => {
    const repositoryRoot = temp('unborn-local')
    const remoteRoot = temp('unborn-remote')
    runGit(repositoryRoot, ['init', '-b', 'main'])
    runGit(remoteRoot, ['init', '--bare', '--initial-branch=main'])
    ensureCommitIdentity(repositoryRoot)
    fs.writeFileSync(path.join(repositoryRoot, 'Notebook.txt'), 'private work stays local until commit\n')
    runGit(repositoryRoot, ['add', 'Notebook.txt'])
    runGit(repositoryRoot, ['remote', 'add', 'origin', remoteRoot])

    expect(reconcileAndRestore({ repositoryRoot, branch: 'main' }))
      .toMatchObject({ reconciled: true, reason: 'unborn-local-repository' })
    runGit(repositoryRoot, ['commit', '-m', 'Initial local Notebook commit'])
    expect(reconcileAndRestore({ repositoryRoot, branch: 'main' })).toMatchObject({ reconciled: true })
    runGit(repositoryRoot, ['push', '-u', 'origin', 'main'])
    expect(remoteBranches({ repositoryRoot })).toEqual(['main'])
  })

  it('does not commit first-publish work when the remote is populated and local history is unborn', () => {
    const repositoryRoot = temp('unborn-with-origin-local')
    const remoteRoot = temp('unborn-with-origin-remote')
    const seedRoot = temp('unborn-with-origin-seed')
    runGit(remoteRoot, ['init', '--bare', '--initial-branch=main'])
    runGit(seedRoot, ['init', '-b', 'main'])
    ensureCommitIdentity(seedRoot)
    fs.writeFileSync(path.join(seedRoot, 'existing.txt'), 'remote history\n')
    runGit(seedRoot, ['add', 'existing.txt'])
    runGit(seedRoot, ['commit', '-m', 'Remote history'])
    runGit(seedRoot, ['remote', 'add', 'origin', remoteRoot])
    runGit(seedRoot, ['push', '-u', 'origin', 'main'])

    runGit(repositoryRoot, ['init', '-b', 'main'])
    runGit(repositoryRoot, ['remote', 'add', 'origin', remoteRoot])
    fs.writeFileSync(path.join(repositoryRoot, 'Notebook.txt'), 'local work remains staged\n')
    runGit(repositoryRoot, ['add', 'Notebook.txt'])
    let caught
    try { reconcileAndRestore({ repositoryRoot, branch: 'main' }) } catch (error) { caught = error }

    expect(caught).toMatchObject({ code: 'REMOTE_CONFLICT' })
    expect(fs.readFileSync(path.join(repositoryRoot, 'Notebook.txt'), 'utf8')).toBe('local work remains staged\n')
    expect(String(runGit(repositoryRoot, ['status', '--porcelain']).output)).toContain('A  Notebook.txt')
    expect(() => runGit(repositoryRoot, ['rev-parse', '--verify', 'HEAD'])).toThrow()
  })

  it('aborts a conflicting rebase and restores staged, tracked, and untracked local work', () => {
    const remoteRoot = temp('conflict-remote')
    const seedRoot = temp('conflict-seed')
    const localRoot = temp('conflict-local')
    const remoteWork = temp('conflict-remote-work')
    runGit(remoteRoot, ['init', '--bare', '--initial-branch=main'])

    runGit(seedRoot, ['init', '-b', 'main'])
    ensureCommitIdentity(seedRoot)
    fs.writeFileSync(path.join(seedRoot, 'same.txt'), 'base\n')
    fs.writeFileSync(path.join(seedRoot, 'other.txt'), 'other base\n')
    runGit(seedRoot, ['add', '.'])
    runGit(seedRoot, ['commit', '-m', 'Base'])
    runGit(seedRoot, ['remote', 'add', 'origin', remoteRoot])
    runGit(seedRoot, ['push', '-u', 'origin', 'main'])

    runGit(localRoot, ['clone', remoteRoot, '.'])
    ensureCommitIdentity(localRoot)
    fs.writeFileSync(path.join(localRoot, 'same.txt'), 'local commit\n')
    runGit(localRoot, ['add', 'same.txt'])
    runGit(localRoot, ['commit', '-m', 'Local conflicting commit'])
    const localCommit = String(runGit(localRoot, ['rev-parse', 'HEAD']).output).trim()

    runGit(remoteWork, ['clone', remoteRoot, '.'])
    ensureCommitIdentity(remoteWork)
    fs.writeFileSync(path.join(remoteWork, 'same.txt'), 'remote commit\n')
    runGit(remoteWork, ['add', 'same.txt'])
    runGit(remoteWork, ['commit', '-m', 'Remote conflicting commit'])
    runGit(remoteWork, ['push', 'origin', 'main'])

    fs.writeFileSync(path.join(localRoot, 'same.txt'), 'staged local work\n')
    runGit(localRoot, ['add', 'same.txt'])
    fs.writeFileSync(path.join(localRoot, 'other.txt'), 'unstaged local work\n')
    fs.writeFileSync(path.join(localRoot, 'untracked.txt'), 'untracked local work\n')
    let caught
    try { reconcileAndRestore({ repositoryRoot: localRoot, branch: 'main' }) } catch (error) { caught = error }

    expect(caught).toMatchObject({ code: 'REMOTE_CONFLICT' })
    expect(String(runGit(localRoot, ['rev-parse', 'HEAD']).output).trim()).toBe(localCommit)
    expect(fs.readFileSync(path.join(localRoot, 'same.txt'), 'utf8')).toBe('staged local work\n')
    expect(fs.readFileSync(path.join(localRoot, 'other.txt'), 'utf8')).toBe('unstaged local work\n')
    expect(fs.readFileSync(path.join(localRoot, 'untracked.txt'), 'utf8')).toBe('untracked local work\n')
    expect(String(runGit(localRoot, ['status', '--porcelain']).output)).toContain('M  same.txt')
    expect(String(runGit(localRoot, ['status', '--porcelain']).output)).toContain(' M other.txt')
    expect(String(runGit(localRoot, ['status', '--porcelain']).output)).toContain('?? untracked.txt')
    expect(String(runGit(localRoot, ['stash', 'list']).output)).toBe('')
  })

  it('leaves private .storyboard runtime files out of reconciliation stashes', () => {
    const remoteRoot = temp('runtime-stash-remote')
    const seedRoot = temp('runtime-stash-seed')
    const localRoot = temp('runtime-stash-local')
    runGit(remoteRoot, ['init', '--bare', '--initial-branch=main'])

    runGit(seedRoot, ['init', '-b', 'main'])
    ensureCommitIdentity(seedRoot)
    fs.writeFileSync(path.join(seedRoot, 'content.txt'), 'published content\n')
    fs.writeFileSync(path.join(seedRoot, '.gitignore'), '.storyboard/\n')
    fs.mkdirSync(path.join(seedRoot, 'publish/components'), { recursive: true })
    fs.writeFileSync(path.join(seedRoot, 'publish/components/old.jsx'), 'old generated site\n')
    runGit(seedRoot, ['add', 'content.txt', '.gitignore', 'publish'])
    runGit(seedRoot, ['commit', '-m', 'Initial content'])
    runGit(seedRoot, ['remote', 'add', 'origin', remoteRoot])
    runGit(seedRoot, ['push', '-u', 'origin', 'main'])
    runGit(localRoot, ['clone', remoteRoot, '.'])
    ensureCommitIdentity(localRoot)
    fs.writeFileSync(path.join(localRoot, 'content.txt'), 'updated content\n')
    runGit(localRoot, ['add', 'content.txt'])
    fs.rmSync(path.join(localRoot, 'publish/components/old.jsx'))
    fs.mkdirSync(path.join(localRoot, 'publish/vendor/hypercanvas'), { recursive: true })
    fs.writeFileSync(path.join(localRoot, 'publish/vendor/hypercanvas/runtime.js'), 'new generated site\n')
    runGit(localRoot, ['add', '-A', '--', 'publish'])
    fs.writeFileSync(path.join(localRoot, 'untracked-notebook-file.txt'), 'untracked user content\n')
    fs.mkdirSync(path.join(localRoot, '.storyboard'), { recursive: true })
    fs.writeFileSync(path.join(localRoot, '.storyboard/publishing.json'), '{"operation":"active"}\n')

    expect(reconcileAndRestore({ repositoryRoot: localRoot, branch: 'main' }))
      .toMatchObject({ reconciled: true, stashed: true })
    expect(fs.readFileSync(path.join(localRoot, '.storyboard/publishing.json'), 'utf8'))
      .toBe('{"operation":"active"}\n')
    expect(String(runGit(localRoot, ['status', '--porcelain']).output)).toContain('M  content.txt')
    expect(String(runGit(localRoot, ['status', '--porcelain']).output)).toContain('D  publish/components/old.jsx')
    expect(String(runGit(localRoot, ['status', '--porcelain']).output)).toContain('A  publish/vendor/hypercanvas/runtime.js')
    expect(fs.readFileSync(path.join(localRoot, 'untracked-notebook-file.txt'), 'utf8'))
      .toBe('untracked user content\n')
    expect(String(runGit(localRoot, ['status', '--porcelain']).output)).toContain('?? untracked-notebook-file.txt')
    expect(String(runGit(localRoot, ['stash', 'list']).output)).toBe('')
  })

  it('does not mistake untracked private runtime state for a staged publication commit', () => {
    const repositoryRoot = temp('runtime-noop-commit')
    runGit(repositoryRoot, ['init', '-b', 'main'])
    fs.mkdirSync(path.join(repositoryRoot, '.storyboard'), { recursive: true })
    fs.writeFileSync(path.join(repositoryRoot, '.storyboard/publishing.json'), '{"operation":"active"}\n')

    expect(commitPublication({ repositoryRoot, message: 'No publication changes' })).toEqual({ committed: false })
    expect(String(runGit(repositoryRoot, ['status', '--porcelain']).output)).toContain('?? .storyboard/')
  })

  it('refuses an existing remote branch without a publication marker', () => {
    const repositoryRoot = temp('unowned-remote-local')
    const remoteRoot = temp('unowned-remote')
    runGit(repositoryRoot, ['init', '-b', 'main'])
    runGit(remoteRoot, ['init', '--bare', '--initial-branch=main'])
    ensureCommitIdentity(repositoryRoot)
    fs.writeFileSync(path.join(repositoryRoot, 'README.md'), 'Unrelated repository\n')
    runGit(repositoryRoot, ['add', 'README.md'])
    runGit(repositoryRoot, ['commit', '-m', 'Unrelated content'])
    runGit(repositoryRoot, ['remote', 'add', 'origin', remoteRoot])
    runGit(repositoryRoot, ['push', '-u', 'origin', 'main'])
    fetchRemote({ repositoryRoot, branch: 'main' })

    let caught
    try { publishingTest.verifyRemoteOwnership({
      repositoryRoot,
      branch: 'main',
      relativePath: 'hypercanvas.publication.json',
      notebook: { manifest: { id: 'notebook-1' } },
      existing: true,
      owner: 'example',
      name: 'unrelated',
    }) } catch (error) { caught = error }
    expect(caught).toMatchObject({ code: 'REMOTE_NOT_PUBLICATION' })
  })

  it('recognizes a matching Notebook manifest as the remote ownership marker', () => {
    const repositoryRoot = temp('notebook-manifest-remote-local')
    const remoteRoot = temp('notebook-manifest-remote')
    runGit(repositoryRoot, ['init', '-b', 'main'])
    runGit(remoteRoot, ['init', '--bare', '--initial-branch=main'])
    ensureCommitIdentity(repositoryRoot)
    fs.writeFileSync(path.join(repositoryRoot, NOTEBOOK_MANIFEST_FILE), JSON.stringify({
      formatVersion: 1,
      id: 'notebook-1',
      title: 'Notebook',
      pages: [],
    }))
    runGit(repositoryRoot, ['add', NOTEBOOK_MANIFEST_FILE])
    runGit(repositoryRoot, ['commit', '-m', 'Notebook manifest'])
    runGit(repositoryRoot, ['remote', 'add', 'origin', remoteRoot])
    runGit(repositoryRoot, ['push', '-u', 'origin', 'main'])
    fetchRemote({ repositoryRoot, branch: 'main' })

    expect(publishingTest.verifyRemoteOwnership({
      repositoryRoot,
      branch: 'main',
      relativePath: NOTEBOOK_MANIFEST_FILE,
      legacyRelativePath: 'publish/hypercanvas.publication.json',
      notebook: { manifest: { id: 'notebook-1' } },
      existing: true,
      owner: 'example',
      name: 'notebook',
    })).toEqual({ verified: true, markerPath: NOTEBOOK_MANIFEST_FILE })
  })

  it('runs npm ci then build while leaving repository metadata and user files intact', async () => {
    const project = temp('build-project')
    const manifest = { name: 'build-project', version: '1.0.0', dependencies: {} }
    fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify(manifest))
    fs.writeFileSync(path.join(project, 'package-lock.json'), JSON.stringify({
      name: manifest.name,
      version: manifest.version,
      lockfileVersion: 3,
      requires: true,
      packages: { '': { name: manifest.name, version: manifest.version, dependencies: {} } },
    }))
    fs.mkdirSync(path.join(project, '.git'))
    fs.writeFileSync(path.join(project, 'keep.txt'), 'keep')
    const calls = []
    const result = await buildProject({
      projectDir: project,
      commandRunner: async (args) => {
        calls.push(args)
        if (args[0] === 'run') {
          fs.mkdirSync(path.join(project, 'dist'), { recursive: true })
          fs.writeFileSync(path.join(project, 'dist/index.html'), 'built')
        }
        return { stdout: 'ok' }
      },
    })
    expect(calls).toEqual([['ci'], ['run', 'build']])
    expect(fs.existsSync(path.join(project, '.git'))).toBe(true)
    expect(fs.readFileSync(path.join(project, 'keep.txt'), 'utf8')).toBe('keep')
    expect(fs.readFileSync(path.join(result.dist, 'index.html'), 'utf8')).toBe('built')
  })

  it('records structured operation errors, pauses actionable failures, and allows retry', async () => {
    const state = { operations: {} }
    const result = await runOperation({
      state,
      kind: 'publish',
      request: { mode: 'default' },
      run: async (step) => {
        await step('generate', async () => 'ok')
        const error = Object.assign(new Error('Resolve the conflict'), { code: 'REMOTE_CONFLICT', hint: 'Run git pull --rebase.' })
        await step('push', async () => { throw error })
      },
    })
    expect(result.status).toBe('awaiting_retry')
    expect(result.steps.map(({ status }) => status)).toEqual(['succeeded', 'failed'])
    expect(result.error.hint).toContain('git pull')
    expect(state.operations[result.id]).toBe(result)
  })

})
