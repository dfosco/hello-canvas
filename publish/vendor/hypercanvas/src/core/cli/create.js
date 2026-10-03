/**
 * storyboard create — Create prototypes, canvases, flows, and pages.
 *
 * Supports both interactive prompts and non-interactive flags.
 * When all required flags are provided, skips prompts entirely.
 * When some flags are provided, prompts only for missing fields.
 *
 * Usage:
 *   storyboard create                                 Interactive picker
 *   storyboard create prototype                       Interactive prototype creation
 *   storyboard create prototype --name my-proto       Non-interactive (or partial)
 *   storyboard create canvas --name my-canvas         Non-interactive (or partial)
 *   storyboard create flow --name default --prototype my-proto
 *   storyboard create page --prototype my-proto --path settings
 */

import * as p from '@clack/prompts'
import { parseFlags, hasFlags, formatFlagHelp } from './flags.js'
import { prototypeSchema, canvasSchema, flowSchema, pageSchema, componentSchema } from './schemas.js'
import { getServerUrl, resolveBasePath } from './serverUrl.js'
import { detectWorktreeName, getPort, resolveRunningPort } from '../worktree/port.js'
import { withoutRuntimeCredentials } from '../runtimeEnvironment.js'

const dim = (s) => `\x1b[2m${s}\x1b[0m`
const green = (s) => `\x1b[32m${s}\x1b[0m`
const cyan = (s) => `\x1b[36m${s}\x1b[0m`

function promptOrCancel(promise) {
  return promise.then((v) => {
    if (p.isCancel(v)) process.exit(0)
    return v
  })
}

function showHelp(type, schema) {
  console.log(`\n  ${type} flags:\n`)
  console.log(formatFlagHelp(schema))
  console.log('')
  process.exit(0)
}

async function serverGet(path) {
  const base = getServerUrl()
  const res = await fetch(`${base}${path}`)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

async function serverPost(path, body) {
  const base = getServerUrl()
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}${text ? ': ' + text : ''}`)
  }
  return res.json()
}

async function checkServer(url, { quiet = false } = {}) {
  const target = url || getServerUrl()
  try {
    await fetch(`${target}/_storyboard/canvas/list`, { signal: AbortSignal.timeout(5000) })
    return true
  } catch (err) {
    if (!quiet) p.log.warning(`Could not reach dev server at ${target}: ${err.message}`)
    return false
  }
}

async function ensureDevServer({ quiet = false } = {}) {
  // 1. If STORYBOARD_SERVER_URL is explicitly set, try it first (with retry)
  if (process.env.STORYBOARD_SERVER_URL) {
    const envUrl = process.env.STORYBOARD_SERVER_URL.replace(/\/$/, '')
    if (await checkServer(envUrl, { quiet })) return

    // Retry once after a short delay (server may be mid-restart)
    await new Promise((r) => setTimeout(r, 1000))
    if (await checkServer(envUrl, { quiet })) return

    if (!quiet) {
      p.log.warning(
        `STORYBOARD_SERVER_URL (${envUrl}) is not reachable — falling back to auto-discovery.`
      )
    }
  }

  // 2. Try auto-discovered URL (Caddy → ports.json)
  if (await checkServer(undefined, { quiet })) return

  // 3. No server found — start one
  let s
  if (!quiet) {
    s = p.spinner()
    s.start('No running dev server found — starting one')
  }

  const { spawn } = await import('child_process')

  const worktreeName = detectWorktreeName()
  const port = getPort(worktreeName)

  const child = spawn('npx', ['vite', '--port', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    env: withoutRuntimeCredentials(process.env),
  })
  child.unref()

  // Wait for Vite to be ready (up to 30s)
  const start = Date.now()
  while (Date.now() - start < 30000) {
    await new Promise((r) => setTimeout(r, 500))
    try {
      await fetch(`http://localhost:${port}`, { signal: AbortSignal.timeout(2000) })
      if (s) s.stop('Dev server started')
      return
    } catch {
      // Not ready yet — keep waiting
    }
  }
  if (s) s.stop('Dev server may still be starting...')
}

function getDirectUrl() {
  const name = detectWorktreeName()
  const port = resolveRunningPort(name)
  const basePath = resolveBasePath()
  return `http://localhost:${port}${basePath}`
}

/**
 * Convert a free-form display title to a kebab-case slug.
 * Mirrors the slug derivation used by the workshop CreatePrototypeForm
 * (`features/createPrototype/CreatePrototypeForm.jsx`).
 */
function slugify(input) {
  if (!input) return ''
  return String(input)
    .replace(/[^a-zA-Z0-9\s_-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .toLowerCase()
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Resolve a default author name. Prefers the GitHub login from `gh auth
 * status` (via the dev server's `git-user` endpoint), then falls back to
 * `git config user.name`. Returns '' if nothing is available.
 */
async function fetchDefaultAuthor() {
  try {
    const data = await serverGet('/_storyboard/git-user')
    if (data?.login) return data.login
    if (data?.name) return data.name
  } catch { /* server may be down or endpoint unavailable */ }
  return ''
}

/**
 * After creation: show URL and open in browser.
 * @param {string} resultPath — e.g. "src/canvas/test.canvas.jsonl" or "src/prototypes/MyProto"
 * @param {'canvas'|'prototype'} type
 */
async function postCreateFlow(resultPath, type) {
  const baseUrl = getDirectUrl()

  // Build the view URL
  let viewUrl = baseUrl
  if (type === 'canvas' && resultPath) {
    const canvasName = resultPath.replace(/^src\/canvas\//, '').replace(/\.canvas\.jsonl$/, '')
    viewUrl = `${baseUrl}canvas/${canvasName}`
  } else if (type === 'prototype' && resultPath) {
    // Mirror the generouted route regex: strip `src/prototypes/` and any
    // `*.folder/` segments. The dev server routes prototypes at
    // `<basePath><prototypeName>` (folders are organisational, not URL).
    const protoName = resultPath
      .replace(/^src\/prototypes\//, '')
      .replace(/[^/]*\.folder\//g, '')
    viewUrl = `${baseUrl}${protoName}`
  }

  p.log.info(`${cyan(viewUrl)}`)

  // Open in browser
  try {
    const { execSync } = await import('child_process')
    execSync(`open "${viewUrl}"`, { stdio: 'ignore' })
  } catch { /* empty */ }

  p.outro('')
}

// ── Prototype creation ────────────────────────────────────────

async function createPrototype() {
  const argv = process.argv.slice(4)
  if (argv.includes('--help') || argv.includes('-h')) return showHelp('create prototype', prototypeSchema)
  const flagMode = hasFlags(argv)
  const { flags, errors } = flagMode ? parseFlags(argv, prototypeSchema) : { flags: {}, errors: [] }

  if (errors.length) {
    for (const e of errors) p.log.error(e)
    process.exit(1)
  }

  if (flagMode && !flags.name && !flags.title) {
    p.log.error('Either --name or --title is required (the slug is auto-derived from the title when --name is omitted).')
    process.exit(1)
  }

  p.intro('storyboard create prototype')
  await ensureDevServer()

  // Fetch available folders and templates from server
  let folders = []
  let partials = []
  try {
    const data = await serverGet('/_storyboard/workshop/prototypes')
    folders = data.folders || []
    partials = data.partials || []
  } catch {
    // Server may not support this endpoint — continue without options
  }

  // Resolve each field: use flag if provided, otherwise prompt
  const isExternal = flags.url !== undefined
    ? true
    : flagMode
      ? false
      : await promptOrCancel(p.confirm({ message: 'Is this an external prototype?', initialValue: false }))

  let url = flags.url || ''
  if (isExternal && !url) {
    url = await promptOrCancel(p.text({
      message: 'External URL',
      placeholder: 'https://example.com/prototype',
      validate: (v) => {
        if (!v) return 'URL is required for external prototypes'
        if (!/^https?:\/\//.test(v)) return 'URL must start with http:// or https://'
      },
    }))
  }

  // Title comes first — the slug is auto-derived from it (slug prompt only
  // appears after, so the user can accept or override the suggestion).
  const title = flags.title || (flagMode
    ? (flags.name ? flags.name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '')
    : await promptOrCancel(p.text({
      message: 'Display title',
      placeholder: 'My Prototype',
      validate: (v) => {
        if (!v && !flags.name) return 'Title is required'
      },
    })))

  const suggestedSlug = slugify(title || flags.name || '')
  const name = flags.name || (flagMode ? suggestedSlug : await promptOrCancel(p.text({
    message: 'Slug (kebab-case)',
    placeholder: suggestedSlug || 'my-prototype',
    defaultValue: suggestedSlug,
    validate: (v) => {
      const candidate = v || suggestedSlug
      if (!candidate) return 'Slug is required'
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate)) return 'Use kebab-case (lowercase, hyphens)'
    },
  }))) || suggestedSlug

  // Folder selection
  let folder = flags.folder || ''
  if (!folder && !flagMode && folders.length > 0) {
    folder = await promptOrCancel(p.select({
      message: 'Folder',
      options: [
        { value: '', label: 'None (root)' },
        ...folders.map((f) => ({ value: f, label: f })),
      ],
    }))
  }

  // Template selection
  let partial = flags.partial || ''
  if (!partial && !isExternal && !flagMode && partials.length > 0) {
    const templateOptions = [
      { value: '', label: 'Blank (no template)' },
      ...partials.map((t) => ({
        value: t.id || t.name || t,
        label: t.name || t.label || t,
        hint: t.directory || undefined,
      })),
    ]
    partial = await promptOrCancel(p.select({ message: 'Template', options: templateOptions }))
  }

  // Author defaults to the GitHub login (via `gh auth status`) or the git
  // user.name — so common case is just hit Enter to accept.
  const defaultAuthor = flagMode ? '' : await fetchDefaultAuthor()
  const author = flags.author || (flagMode ? '' : await promptOrCancel(p.text({
    message: 'Author',
    placeholder: defaultAuthor || 'your-name',
    defaultValue: defaultAuthor,
  })))

  const description = flags.description || (flagMode ? '' : await promptOrCancel(p.text({
    message: 'Description',
    placeholder: 'What is this prototype about?',
    defaultValue: '',
  })))

  let createFlow = flags.flow ?? false
  if (!flagMode && !isExternal) {
    createFlow = await promptOrCancel(p.confirm({ message: 'Create a default flow file?', initialValue: false }))
  }

  // Submit
  const s = p.spinner()
  s.start('Creating prototype')

  try {
    const body = {
      name,
      title: title || name,
      folder: folder || undefined,
      partial: partial || undefined,
      author: author || undefined,
      description: description || undefined,
      createFlow,
    }
    if (isExternal) body.url = url

    const result = await serverPost('/_storyboard/workshop/prototypes', body)
    s.stop('Prototype created!')
    if (result.path) {
      p.log.success(`  ${result.path}`)
    }
    await postCreateFlow(result.path || `src/prototypes/${name}`, 'prototype')
    return
  } catch (err) {
    s.stop('Failed to create prototype')
    p.log.error(err.message)
  }

  p.outro('')
}

// ── Canvas creation ───────────────────────────────────────────

async function createCanvas() {
  const argv = process.argv.slice(4)
  if (argv.includes('--help') || argv.includes('-h')) return showHelp('create canvas', canvasSchema)
  const flagMode = hasFlags(argv)
  const { flags, errors } = flagMode ? parseFlags(argv, canvasSchema) : { flags: {}, errors: [] }

  if (errors.length) {
    for (const e of errors) p.log.error(e)
    process.exit(1)
  }

  p.intro('storyboard create canvas')
  await ensureDevServer()

  // Fetch available folders (tagged when the server supports it)
  let folderEntries = []
  try {
    const data = await serverGet('/_storyboard/canvas/folders')
    if (Array.isArray(data.entries)) {
      folderEntries = data.entries
    } else {
      const legacy = data.folders || data || []
      folderEntries = legacy.map((name) => ({ name, kind: 'pages' }))
    }
  } catch {
    // Continue without folders
  }

  const name = flags.name || await promptOrCancel(p.text({
    message: 'Canvas name',
    placeholder: 'my-canvas',
    validate: (v) => {
      if (!v) return 'Name is required'
      if (/[A-Z\s]/.test(v)) return 'Use kebab-case (lowercase, hyphens)'
    },
  }))

  const defaultTitle = name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  const title = flags.title || (flagMode ? defaultTitle : await promptOrCancel(p.text({
    message: 'Display title',
    placeholder: defaultTitle,
    defaultValue: defaultTitle,
  })))

  let folder = flags.folder || ''
  let folderKind = flags['folder-kind'] || undefined
  if (!folder && !flagMode && Array.isArray(folderEntries) && folderEntries.length > 0) {
    const NEW = '__new__'
    folder = await promptOrCancel(p.select({
      message: 'Folder',
      options: [
        { value: '', label: 'None (root)' },
        ...folderEntries.map((f) => ({
          value: f.name,
          label: `${f.name}${f.kind === 'workspace' ? ' — workspace folder' : ' — canvas pages'}`,
        })),
        { value: NEW, label: '+ Create new folder…' },
      ],
    }))
    if (folder === NEW) {
      folder = await promptOrCancel(p.text({
        message: 'New folder name (kebab-case)',
        placeholder: 'my-folder',
        validate: (v) => {
          if (!v) return 'Folder name is required'
          if (/[A-Z\s]/.test(v)) return 'Use kebab-case'
        },
      }))
      folderKind = await promptOrCancel(p.select({
        message: 'Folder type',
        options: [
          { value: 'workspace', label: 'Workspace folder (sibling canvases grouped in workspace)' },
          { value: 'pages',     label: 'Canvas pages (multi-page canvas; sibling files become pages)' },
        ],
        initialValue: 'workspace',
      }))
    }
  }

  const grid = flags.grid ?? (flagMode ? true : await promptOrCancel(p.confirm({
    message: 'Show dot grid?',
    initialValue: true,
  })))

  const includeJsx = flags.jsx ?? (flagMode ? false : await promptOrCancel(p.confirm({
    message: 'Include JSX companion file?',
    initialValue: false,
  })))

  const description = flags.description || (flagMode ? '' : (await promptOrCancel(p.text({
    message: 'Description (optional)',
    placeholder: 'A brief description of this canvas',
  }))) || '')

  // Submit
  const s = p.spinner()
  s.start('Creating canvas')

  try {
    const result = await serverPost('/_storyboard/canvas/create', {
      name,
      title: title || name,
      folder: folder || undefined,
      folderKind: folder && folderKind ? folderKind : undefined,
      grid,
      includeJsx,
      description: description || undefined,
    })
    s.stop('Canvas created!')
    if (result.path || result.name) {
      p.log.success(`  ${result.path || result.name}`)
    }
    await postCreateFlow(result.path || `src/canvas/${name}.canvas.jsonl`, 'canvas')
    return
  } catch (err) {
    s.stop('Failed to create canvas')
    p.log.error(err.message)
  }

  p.outro('')
}

// ── Flow creation ─────────────────────────────────────────────

async function createFlow() {
  const argv = process.argv.slice(4)
  if (argv.includes('--help') || argv.includes('-h')) return showHelp('create flow', flowSchema)
  const flagMode = hasFlags(argv)
  const { flags, errors } = flagMode ? parseFlags(argv, flowSchema) : { flags: {}, errors: [] }

  if (errors.length) {
    for (const e of errors) p.log.error(e)
    process.exit(1)
  }

  p.intro('storyboard create flow')
  await ensureDevServer()

  const prototype = flags.prototype || await promptOrCancel(p.text({
    message: 'Prototype name',
    placeholder: 'my-prototype',
    validate: (v) => { if (!v) return 'Prototype is required' },
  }))

  const name = flags.name || await promptOrCancel(p.text({
    message: 'Flow name',
    placeholder: 'default',
    validate: (v) => { if (!v) return 'Name is required' },
  }))

  const title = flags.title || (flagMode ? '' : await promptOrCancel(p.text({
    message: 'Display title',
    placeholder: name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    defaultValue: '',
  })))

  const folder = flags.folder || ''
  const author = flags.author || ''
  const description = flags.description || ''
  const copyFrom = flags['copy-from'] || undefined
  const startingPage = flags['starting-page'] || undefined
  const globals = flags.globals || undefined

  // Submit
  const s = p.spinner()
  s.start('Creating flow')

  try {
    const body = {
      name,
      prototype,
      title: title || undefined,
      folder: folder || undefined,
      author: author || undefined,
      description: description || undefined,
      copyFrom,
      startingPage,
      globals,
    }

    const result = await serverPost('/_storyboard/workshop/flows', body)
    s.stop('Flow created!')
    if (result.path) {
      p.log.success(`  ${result.path}`)
    }
    p.outro('')
  } catch (err) {
    s.stop('Failed to create flow')
    p.log.error(err.message)
    p.outro('')
  }
}

// ── Page creation ─────────────────────────────────────────────

async function createPage() {
  const argv = process.argv.slice(4)
  if (argv.includes('--help') || argv.includes('-h')) return showHelp('create page', pageSchema)
  const flagMode = hasFlags(argv)
  const { flags, errors } = flagMode ? parseFlags(argv, pageSchema) : { flags: {}, errors: [] }

  if (errors.length) {
    for (const e of errors) p.log.error(e)
    process.exit(1)
  }

  p.intro('storyboard create page')
  await ensureDevServer()

  const prototype = flags.prototype || await promptOrCancel(p.text({
    message: 'Prototype name',
    placeholder: 'my-prototype',
    validate: (v) => { if (!v) return 'Prototype is required' },
  }))

  const pagePath = flags.path || await promptOrCancel(p.text({
    message: 'Page path (e.g. settings/general)',
    placeholder: 'settings',
    validate: (v) => { if (!v) return 'Path is required' },
  }))

  const folder = flags.folder || ''
  const template = flags.template || ''

  // Submit
  const s = p.spinner()
  s.start('Creating page')

  try {
    const body = {
      prototype,
      path: pagePath,
      folder: folder || undefined,
      template: template || undefined,
    }

    const result = await serverPost('/_storyboard/workshop/pages', body)
    s.stop('Page created!')
    if (result.path) {
      p.log.success(`  ${result.path}`)
    }
    p.outro('')
  } catch (err) {
    s.stop('Failed to create page')
    p.log.error(err.message)
    p.outro('')
  }
}

// ── Create Component ───────────────────────────────────────────

async function createComponent() {
  const rest = process.argv.slice(4)
  if (rest.includes('--help') || rest.includes('-h')) showHelp('component', componentSchema)

  const flagMode = hasFlags(rest)
  const { flags, errors } = flagMode ? parseFlags(rest, componentSchema) : { flags: {}, errors: [] }
  if (errors.length) {
    for (const e of errors) p.log.error(e)
    process.exit(1)
  }

  p.intro('storyboard create component')

  const componentName = flags.name || await promptOrCancel(
    p.text({
      message: 'Component name',
      placeholder: 'my-component',
      validate: (v) => {
        if (!v) return 'Name is required'
        if (!/^[a-z][a-z0-9-]*$/.test(v)) return 'Use kebab-case (e.g. my-component)'
      },
    }),
  )

  // Directory picker — list existing subdirectories inside src/components/
  const fs = await import('node:fs')
  const path = await import('node:path')
  const componentsRoot = path.resolve('src/components')

  let directory = flags.directory || ''
  if (!directory) {
    const existingDirs = []
    if (fs.existsSync(componentsRoot)) {
      for (const entry of fs.readdirSync(componentsRoot, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.name.startsWith('_') && !entry.name.startsWith('.')) {
          existingDirs.push(entry.name)
        }
      }
    }

    if (existingDirs.length > 0) {
      const dirChoice = await promptOrCancel(
        p.select({
          message: 'Directory',
          options: [
            { value: '', label: 'src/components/ (root)', hint: 'Top-level component' },
            ...existingDirs.map((d) => ({ value: d, label: `src/components/${d}/` })),
          ],
        }),
      )
      directory = dirChoice
    }
  }

  // Build file path
  const targetDir = directory
    ? path.join(componentsRoot, directory)
    : componentsRoot
  const storyFile = path.join(targetDir, `${componentName}.story.jsx`)

  if (fs.existsSync(storyFile)) {
    p.log.error(`File already exists: ${path.relative('.', storyFile)}`)
    p.outro('')
    return
  }

  // Scaffold the story file
  const pascalName = componentName
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('')

  const content = `/**
 * ${pascalName} component stories.
 * Each named export renders as an embeddable component at /components/${directory ? directory + '/' : ''}${componentName}
 */

export function Default() {
  return (
    <div style={{ padding: '1.5rem', minWidth: 280 }}>
      <p>${pascalName} component</p>
    </div>
  )
}
`

  const s = p.spinner()
  s.start('Creating component')

  fs.mkdirSync(targetDir, { recursive: true })
  fs.writeFileSync(storyFile, content)

  s.stop('Component created!')
  p.log.success(`  ${green(path.relative('.', storyFile))}`)
  p.log.info(`  ${dim('Route:')} /components/${directory ? directory + '/' : ''}${componentName}`)
  p.outro('')
}

// ── Dispatcher ────────────────────────────────────────────────

export { createFlow, createPage, createComponent, ensureDevServer, serverPost, postCreateFlow, getServerUrl }

// Set of artifact types that have a schema-driven UI in ArtifactForm. Used by
// the `--ui` flag below to validate the type before opening the browser.
const UI_TYPES = new Set(['prototype', 'canvas', 'component', 'flow', 'object', 'record', 'page'])

/**
 * `--ui` handler — ensures the dev server is running, then opens the
 * standalone `/create` page in the user's browser. That page renders the
 * schema-driven ArtifactForm centered on a clean background — no
 * workspace chrome, no command palette overlay. See
 * `internals/CreatePage/CreatePage.jsx` for the page itself.
 *
 * @param {string|null} type — artifact type (`prototype`, `canvas`, …) or
 *   `null` to show the type picker.
 */
async function openCreateUI(type) {
  p.intro(`storyboard create${type ? ' ' + type : ''} --ui`)
  await ensureDevServer()

  const baseUrl = getDirectUrl()
  const qs = type ? `?type=${encodeURIComponent(type)}` : ''
  const url = `${baseUrl}create${qs}`
  p.log.info(`${cyan(url)}`)

  try {
    const { execSync } = await import('child_process')
    execSync(`open "${url}"`, { stdio: 'ignore' })
  } catch { /* empty */ }

  p.outro('')
}

async function main() {
  const argv = process.argv.slice(2) // skip: node, sb
  const wantsUI = argv.includes('--ui')

  const subcommand = process.argv[3]

  // `--ui` short-circuits all interactive prompts — the user picks fields
  // in the browser instead of in the terminal. The subcommand (if any)
  // becomes the artifact type; omitting it shows the type picker.
  if (wantsUI) {
    const type = subcommand && !subcommand.startsWith('-') ? subcommand : null
    if (type && !UI_TYPES.has(type)) {
      p.log.error(`Unknown type "${type}" for --ui. Valid: ${[...UI_TYPES].join(', ')}`)
      process.exit(1)
    }
    return openCreateUI(type)
  }

  if (subcommand === 'prototype') return createPrototype()
  if (subcommand === 'canvas') return createCanvas()
  if (subcommand === 'flow') return createFlow()
  if (subcommand === 'page') return createPage()
  if (subcommand === 'component') return createComponent()

  // Interactive picker
  p.intro('storyboard create')

  const type = await p.select({
    message: 'What would you like to create?',
    options: [
      { value: 'prototype', label: 'Prototype', hint: 'React-based interactive prototype' },
      { value: 'canvas', label: 'Canvas', hint: 'Freeform canvas with widgets' },
      { value: 'flow', label: 'Flow', hint: 'Data context for a prototype page' },
      { value: 'page', label: 'Page', hint: 'New page in a prototype' },
      { value: 'component', label: 'Component', hint: 'Story-format component (.story.jsx)' },
    ],
  })

  if (p.isCancel(type)) return process.exit(0)

  if (type === 'prototype') return createPrototype()
  if (type === 'canvas') return createCanvas()
  if (type === 'flow') return createFlow()
  if (type === 'page') return createPage()
  if (type === 'component') return createComponent()
}

// Only run main() when this file is the entry point, not when imported
const isDirectEntry = process.argv[2] === 'create'
if (isDirectEntry) main()
