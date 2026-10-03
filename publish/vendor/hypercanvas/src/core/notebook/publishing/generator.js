/**
 * Portable publication project generator.
 *
 * Materializes a Notebook as ONE self-contained site project: exact pinned
 * dependencies, an embedded deterministic lockfile, embedded canvas states,
 * copied Notebook sources and assets, the regular Storyboard application,
 * and an identity marker. The project builds with `npm ci`, `npm run build`,
 * and `npm run preview` anywhere it is copied — no Notebook, no Hypercanvas
 * checkout. See DOCS/publishing.md for the contract.
 *
 * Generation is deterministic: repeated generation from the same Notebook is
 * byte-stable (no timestamps, no machine paths). Regeneration updates managed
 * scopes in place and never deletes `.git`, the Pages workflow, `node_modules/`,
 * committed `dist/`, or unrelated user files.
 */

import fs from 'node:fs'
import path from 'node:path'
import { builtinModules, createRequire } from 'node:module'
import { Buffer } from 'node:buffer'
import { fileURLToPath } from 'node:url'
import ignore from 'ignore'
import { inspectNotebook, NOTEBOOK_CONFIG_FILES, NOTEBOOK_MANIFEST_FILE, NOTEBOOK_PUBLISH_DIR, NOTEBOOK_DIRECTORIES } from '../notebook.js'
import { materializeFromText } from '../../canvas/materializer.js'
import { preparePublishedFrames } from '../frame-snapshot-publishing.js'
import { publishingError } from './errors.js'

const require = createRequire(import.meta.url)
const BUILTIN_MODULES = new Set(builtinModules.map((name) => name.replace(/^node:/, '')))
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../')
const SCAFFOLD_ROOT = path.join(PACKAGE_ROOT, 'scaffold')
const WORKSPACE_ROOT = path.resolve(PACKAGE_ROOT, '../..')
const HYPERCANVAS_PACKAGE = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'))
const NOTEBOOK_CONTENT_DIRECTORY = 'notebook-content'
const SCAFFOLD_DEPENDENCY_NAMES = [
  '@base-ui/react',
  '@csstools/postcss-global-data',
  '@dfosco/hypercanvas',
  '@generouted/react-router',
  '@github/browserslist-config',
  '@primer/octicons-react',
  '@primer/primitives',
  '@primer/react',
  '@tailwindcss/vite',
  '@vitejs/plugin-react',
  'glob',
  'postcss-preset-env',
  'react',
  'react-dom',
  'react-router-dom',
  'tailwindcss',
  'vite',
]
const BASE_DEPENDENCY_NAMES = [...new Set([
  ...Object.keys(HYPERCANVAS_PACKAGE.dependencies || {}),
  ...Object.entries(HYPERCANVAS_PACKAGE.peerDependencies || {})
    .filter(([name]) => HYPERCANVAS_PACKAGE.peerDependenciesMeta?.[name]?.optional !== true)
    .map(([name]) => name),
  ...SCAFFOLD_DEPENDENCY_NAMES,
])].sort()
const BASE_DEPENDENCIES = Object.fromEntries(BASE_DEPENDENCY_NAMES.map((name) => [name, null]))
const EXCLUDED_DIRECTORY_NAMES = new Set(['.git', '.storyboard', 'node_modules'])
const VENDORED_RUNTIME = 'vendor/hypercanvas'
const LEGACY_MIRROR_SCOPES = new Set([NOTEBOOK_DIRECTORIES.prototypes, NOTEBOOK_DIRECTORIES.assets])
const PUBLISH_WORKFLOW_PATH = '.github/workflows/deploy-pages.yml'
const LEGACY_PRESENTATION_FILES = [
  'src/App.jsx',
  'src/main.jsx',
  'src/CanvasPage.jsx',
  'src/PrototypePage.jsx',
  'src/HomePage.jsx',
  'src/NotFoundPage.jsx',
  'src/styles.css',
]

export const PUBLICATION_MARKER_FILE = 'hypercanvas.publication.json'
export const PUBLICATION_FORMAT_VERSION = 1
export const LOCKFILE_SCAFFOLD = '../../../../scaffold/publish/package-lock.json'

/** Managed regeneration scopes — stale files inside these are removed. */
const MANAGED_SCOPES = ['src/generated', VENDORED_RUNTIME, NOTEBOOK_DIRECTORIES.prototypes, NOTEBOOK_DIRECTORIES.assets]

export function pageSlug(page) {
  return page.id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `page-${page.index + 1}`
}

function generatorVersion() {
  try { return require('../../../../package.json').version } catch { return '0' }
}

export function publicationMarker(notebook, sourceFiles = [], generatedNotebookFiles = []) {
  return {
    formatVersion: PUBLICATION_FORMAT_VERSION,
    kind: 'hypercanvas-publication',
    notebook: { id: notebook.manifest.id, title: notebook.manifest.title },
    generator: { name: '@dfosco/hypercanvas', version: generatorVersion() },
    sourceFiles: [...sourceFiles].sort(),
    generatedNotebookFiles: [...generatedNotebookFiles].sort(),
  }
}

export function readMarker(projectDir) {
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(projectDir, PUBLICATION_MARKER_FILE), 'utf8'))
    if (marker?.kind !== 'hypercanvas-publication' || !marker?.notebook?.id) return null
    return marker
  } catch { return null }
}

/**
 * A project directory may only be reused when it is an empty folder or a
 * recognized publication of the same Notebook. Anything else is refused so a
 * publish never overwrites unrelated work (see DOCS/publishing.md).
 */
export function verifyMarker(projectDir, notebook, { mode = 'external' } = {}) {
  const unrecognizedHint = mode === 'default'
    ? 'The Notebook publish/ folder already contains unrecognized files. Back it up outside the Notebook, then retry; Hypercanvas will not overwrite or remove those files.'
    : 'Back up the existing content or choose an empty external folder, then retry.'
  const mismatchedHint = mode === 'default'
    ? 'The Notebook publish/ folder belongs to another Notebook. Move it outside the Notebook or open the Notebook it belongs to, then retry.'
    : 'Choose the Notebook bound to this publication or another empty external folder, then retry.'
  const marker = readMarker(projectDir)
  if (!marker) throw publishingError('NOT_A_PUBLICATION', 'The destination is not an empty folder or a recognized Hypercanvas publication.', projectDir, unrecognizedHint)
  if (marker.notebook.id !== notebook.manifest.id) {
    throw publishingError('MARKER_MISMATCH', `The destination is bound to another Notebook (${JSON.stringify(marker.notebook.title)}).`, projectDir, mismatchedHint)
  }
  return marker
}

function canonical(candidate) {
  try { return fs.realpathSync.native(candidate) } catch { return path.resolve(candidate) }
}

function isInside(parent, child) {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/**
 * Validate and prepare the project directory without destructive behavior.
 * Default mode targets the Notebook's managed `publish/` directory; external
 * mode targets a folder outside the Notebook that must be empty or a
 * recognized publication of this Notebook.
 */
export function ensureProjectDirectory({ destination, notebookRoot, mode }) {
  const resolved = path.resolve(destination)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  const canonicalDestination = path.join(canonical(path.dirname(resolved)), path.basename(resolved))
  const canonicalNotebook = canonical(notebookRoot)
  const managedPublish = path.join(canonicalNotebook, NOTEBOOK_PUBLISH_DIR)

  if (mode === 'external' && isInside(canonicalNotebook, canonicalDestination)) {
    throw publishingError('DESTINATION_INSIDE_NOTEBOOK', 'External publish destinations must be outside the Notebook.')
  }
  if (canonicalDestination !== managedPublish && isInside(canonicalNotebook, canonicalDestination)) {
    throw publishingError('DESTINATION_INSIDE_NOTEBOOK', 'Publish destination must not be inside the Notebook.')
  }
  if (fs.existsSync(resolved) && !fs.statSync(resolved).isDirectory()) {
    throw publishingError('DESTINATION_NOT_DIRECTORY', 'Publish destination must be a directory.')
  }
  const managed = canonicalDestination === managedPublish
  if (mode === 'default' && !managed) {
    throw publishingError('INVALID_DESTINATION', 'Default publishing uses the Notebook publish/ directory.')
  }
  if (fs.existsSync(resolved) && fs.readdirSync(resolved).length) {
    verifyMarker(resolved, inspectNotebook(notebookRoot), { mode })
  }
  fs.mkdirSync(resolved, { recursive: true })
  return { directory: resolved, managed }
}

function readCanvasState(notebook, page) {
  const file = path.join(notebook.root, page.path)
  return materializeFromText(fs.readFileSync(file, 'utf8'))
}

function prototypeEntry(notebook, page) {
  const directory = path.join(notebook.root, page.path)
  for (const name of ['index.jsx', 'index.js', 'index.tsx', 'index.ts']) {
    if (fs.existsSync(path.join(directory, name))) return `${page.path}/${name}`
  }
  return null
}

function jsonScript(value) { return JSON.stringify(value, null, 2) }

function ignoreMatcher(notebookRoot) {
  const cache = new Map()
  const matcherFor = (directory) => {
    if (cache.has(directory)) return cache.get(directory)
    const matcher = ignore()
    const ignoreFile = path.join(directory, '.gitignore')
    if (fs.existsSync(ignoreFile) && fs.statSync(ignoreFile).isFile()) {
      try { matcher.add(fs.readFileSync(ignoreFile, 'utf8')) } catch (error) {
        throw publishingError(
          'PUBLISH_IGNORE_INVALID',
          `Could not read ignore rules from ${path.relative(notebookRoot, ignoreFile) || '.gitignore'}.`,
          error?.message,
          'Fix the invalid .gitignore entry, then retry publishing.',
        )
      }
    }
    cache.set(directory, matcher)
    return matcher
  }

  return (relativePath, isDirectory = false) => {
    const segments = relativePath.split('/')
    let ignored = false
    for (let end = 1; end <= segments.length; end += 1) {
      const isCurrentDirectory = end < segments.length || isDirectory
      const prefix = segments.slice(0, end).join('/')
      for (let scopeDepth = 0; scopeDepth < end; scopeDepth += 1) {
        const scope = path.join(notebookRoot, ...segments.slice(0, scopeDepth))
        const scopedPath = segments.slice(scopeDepth, end).join('/')
        const result = matcherFor(scope).test(scopedPath)
        if (result.ignored) ignored = true
        else if (result.unignored) ignored = false
      }
      if (isCurrentDirectory && ignored) return true
      if (!isCurrentDirectory && prefix === relativePath) return ignored
    }
    return ignored
  }
}

/** Inventory every user-owned top-level directory without assuming its name. */
function notebookSourceFiles(notebookRoot) {
  if (!fs.existsSync(notebookRoot)) return []
  const isIgnored = ignoreMatcher(notebookRoot)
  const files = []
  const visit = (directory, relativeDirectory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (EXCLUDED_DIRECTORY_NAMES.has(entry.name)) continue
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
      const fullPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (relativeDirectory === '' && entry.name === NOTEBOOK_PUBLISH_DIR) continue
        if (!isIgnored(relativePath, true)) visit(fullPath, relativePath)
      } else if (entry.isFile() && relativePath !== PUBLISH_WORKFLOW_PATH && !isIgnored(relativePath)) {
        files.push(relativePath)
      }
    }
  }

  for (const entry of fs.readdirSync(notebookRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || EXCLUDED_DIRECTORY_NAMES.has(entry.name) || entry.name === NOTEBOOK_PUBLISH_DIR) continue
    if (!isIgnored(entry.name, true)) visit(path.join(notebookRoot, entry.name), entry.name)
  }
  return files.sort()
}

function packageNameFromSpecifier(specifier) {
  const value = String(specifier ?? '').split(/[?#]/, 1)[0]
  if (!value || value.startsWith('.') || value.startsWith('#') || value.startsWith('@/') || value.startsWith('/') || value.startsWith('\\') || value.startsWith('node:') || /^[A-Za-z][\w+.-]*:/.test(value) || /^[A-Za-z]:[\\/]/.test(value)) return null
  const segments = value.split('/')
  const packageName = value.startsWith('@')
    ? segments.length >= 2 && segments[1] ? `${segments[0]}/${segments[1]}` : null
    : segments[0]
  if (!packageName || BUILTIN_MODULES.has(packageName) || value === '@dfosco/hypercanvas') return null
  return packageName
}

function prototypeModuleSpecifiers(source, extension) {
  const specifiers = new Set()
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|\s)\/\/[^\n]*/gm, '$1')
  const patterns = extension === '.css'
    ? [/@import\s+(?:url\(\s*)?['"]([^'"]+)['"]/g]
    : [
        /\b(?:import|export)\s+(?:[^'";`]*?\sfrom\s*)?['"]([^'"]+)['"]/g,
        /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]/g,
      ]
  for (const pattern of patterns) {
    for (const match of withoutComments.matchAll(pattern)) specifiers.add(match[1])
  }
  return specifiers
}

function notebookLockedPackageVersion(notebookRoot, packageName) {
  let manifest
  try { manifest = JSON.parse(fs.readFileSync(path.join(notebookRoot, 'package.json'), 'utf8')) } catch { return null }
  const declared = [manifest.dependencies, manifest.devDependencies, manifest.optionalDependencies]
    .some((dependencies) => Object.hasOwn(dependencies || {}, packageName))
  if (!declared) return null

  let lockfile
  try { lockfile = JSON.parse(fs.readFileSync(path.join(notebookRoot, 'package-lock.json'), 'utf8')) } catch { /* try exact manifest pins below */ }
  const lockVersion = lockfile?.packages?.[`node_modules/${packageName}`]?.version
    || lockfile?.dependencies?.[packageName]?.version
  if (typeof lockVersion === 'string' && lockVersion) return lockVersion

  const exactVersion = [manifest.dependencies, manifest.devDependencies, manifest.optionalDependencies]
    .map((dependencies) => dependencies?.[packageName])
    .find((version) => typeof version === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version))
  return exactVersion || null
}

function installedPackageVersion(packageName, notebookRoot) {
  const notebookVersion = notebookLockedPackageVersion(notebookRoot, packageName)
  if (notebookVersion) return notebookVersion

  let entry = null
  try { entry = require.resolve(packageName) } catch { /* package exports may hide its root entry */ }
  if (entry) {
    let directory = path.dirname(entry)
    while (true) {
      try {
        const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'))
        if (metadata.name === packageName && typeof metadata.version === 'string') return metadata.version
      } catch { /* keep searching parent directories */ }
      const parent = path.dirname(directory)
      if (parent === directory) break
      directory = parent
    }
  }

  // Package export maps may intentionally hide package.json (or even '.').
  // Resolve metadata through ancestor node_modules directories as a fallback.
  for (let directory = path.dirname(fileURLToPath(import.meta.url)); ; directory = path.dirname(directory)) {
    const metadataPath = path.join(directory, 'node_modules', packageName, 'package.json')
    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
      if (metadata.name === packageName && typeof metadata.version === 'string') return metadata.version
    } catch { /* keep searching ancestor node_modules directories */ }
    const parent = path.dirname(directory)
    if (parent === directory) break
  }
  throw publishingError(
    'PUBLISH_DEPENDENCY_UNAVAILABLE',
    `Could not determine an exact installed version for prototype dependency "${packageName}".`,
    packageName,
    `Install "${packageName}" in the Hypercanvas application, then retry publishing.`,
  )
}

function prototypeDependencies(notebook, sourceFiles = notebookSourceFiles(notebook.root)) {
  const packageNames = new Set()
  for (const relativePath of sourceFiles) {
    if (!/\.(?:[cm]?[jt]sx?|css)$/i.test(relativePath)) continue
    const fullPath = path.join(notebook.root, ...relativePath.split('/'))
    const extension = path.extname(relativePath).toLowerCase()
    for (const specifier of prototypeModuleSpecifiers(fs.readFileSync(fullPath, 'utf8'), extension)) {
      const packageName = packageNameFromSpecifier(specifier)
      if (packageName && !Object.hasOwn(BASE_DEPENDENCIES, packageName)) packageNames.add(packageName)
    }
  }

  return Object.fromEntries([...packageNames].sort().map((packageName) => [packageName, installedPackageVersion(packageName, notebook.root)]))
}

function prototypeNameForPath(relativePath) {
  const segments = String(relativePath || '').split('/')
  const prototypeIndex = segments.indexOf(NOTEBOOK_DIRECTORIES.prototypes)
  if (prototypeIndex < 0) return null
  for (const segment of segments.slice(prototypeIndex + 1)) {
    if (segment === 'drafts' || segment.endsWith('.folder')) continue
    return segment
  }
  return null
}

export function lockfileMatchesDependencies(lockfile, dependencies) {
  const actual = lockfile?.packages?.['']?.dependencies ?? {}
  const expectedNames = Object.keys(dependencies ?? {}).sort()
  const actualNames = Object.keys(actual).sort()
  return expectedNames.length === actualNames.length
    && expectedNames.every((name, index) => name === actualNames[index] && dependencies[name] === actual[name])
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function publishedPages(notebook) {
  const canvases = notebook.pages
    .filter((page) => page.type === 'canvas' && page.available)
    .map((page) => ({ ...page, slug: pageSlug(page), state: readCanvasState(notebook, page) }))
  const prototypes = notebook.pages
    .filter((page) => page.type === 'prototype' && page.available)
    .map((page) => ({ ...page, slug: pageSlug(page), entry: prototypeEntry(notebook, page), prototypeName: prototypeNameForPath(page.path) }))
  return [...canvases, ...prototypes].sort((a, b) => a.index - b.index)
}

/** Give manifest-listed prototypes a workspace card even when they have no metadata or flows. */
function generatedPrototypeMetadata(pages, sourceFiles) {
  const files = {}
  const seenDirectories = new Set()
  for (const page of pages) {
    if (page.type !== 'prototype' || !page.path || seenDirectories.has(page.path)) continue
    seenDirectories.add(page.path)
    const prototypeName = prototypeNameForPath(page.path)
    const hasMetadata = sourceFiles.some((relativePath) => {
      const metadataFile = /\.prototype\.jsonc?$/.test(relativePath)
      const nestedMetadata = metadataFile && relativePath.startsWith(`${page.path}/`)
      const topLevelMetadata = prototypeName && [
        `prototypes/${prototypeName}.prototype.json`,
        `prototypes/${prototypeName}.prototype.jsonc`,
      ].includes(relativePath)
      return nestedMetadata || topLevelMetadata
    })
    if (hasMetadata) continue
    const relativePath = `${NOTEBOOK_CONTENT_DIRECTORY}/${page.path}/hypercanvas-publication.prototype.json`
    files[relativePath] = `${jsonScript({ meta: { title: page.title || prototypeNameForPath(page.path) || 'Prototype' } })}\n`
  }
  return files
}

const RUNTIME_SCAFFOLD_FILES = [
  'src/_prototype.jsx',
  'src/library/mount.jsx',
  'src/library/prototypes-entry.jsx',
  'src/library/routes.jsx',
  'src/library/_app.jsx',
  'src/library/_app.module.css',
  'src/library/index.jsx',
  'src/library/home.jsx',
  'src/library/create.jsx',
  'src/library/viewfinder.jsx',
  'src/library/sites.jsx',
  'src/library/workspace.jsx',
]

function scaffoldText(relativePath) {
  return fs.readFileSync(path.join(SCAFFOLD_ROOT, relativePath), 'utf8')
}

function runtimeDependencies() {
  return Object.fromEntries(BASE_DEPENDENCY_NAMES.map((name) => [
    name,
    name === '@dfosco/hypercanvas' ? `file:${VENDORED_RUNTIME}` : installedPackageVersion(name, null),
  ]))
}

function vendoredRuntimeFiles() {
  const entries = new Set([
    'package.json',
    ...(HYPERCANVAS_PACKAGE.files || []).filter((entry) => entry !== 'dist'),
    'vite.ui.config.js',
    'vite.canvas.config.js',
    'scripts/gen-themes-css.mjs',
  ])
  const files = {}
  for (const entry of entries) {
    const absolute = path.join(PACKAGE_ROOT, entry)
    if (!fs.existsSync(absolute)) continue
    if (fs.statSync(absolute).isDirectory()) {
      for (const relative of walkFiles(absolute)) {
        const sourcePath = path.join(absolute, ...relative.split('/'))
        let content = fs.readFileSync(sourcePath)
        if (entry === 'src' && relative === 'core/styles/tailwind.css') {
          content = Buffer.from(content.toString('utf8').replaceAll('../../../../../assets/fonts/', '../../../assets/fonts/'))
        }
        files[`${VENDORED_RUNTIME}/${entry}/${relative}`] = content
      }
    } else {
      files[`${VENDORED_RUNTIME}/${entry}`] = fs.readFileSync(absolute)
    }
  }
  for (const relative of [
    'HubotSans/Hubot-Sans.woff2',
    'MonaSans/MonaSans.woff2',
  ]) {
    const sourcePath = path.join(WORKSPACE_ROOT, 'assets/fonts', relative)
    if (fs.existsSync(sourcePath)) files[`${VENDORED_RUNTIME}/assets/fonts/${relative}`] = fs.readFileSync(sourcePath)
  }
  return files
}

function normalRuntimeFiles(notebook, sourceFiles, basePath = './') {
  const files = Object.fromEntries(RUNTIME_SCAFFOLD_FILES.map((relativePath) => [relativePath, scaffoldText(relativePath)]))

  for (const filename of NOTEBOOK_CONFIG_FILES) {
    if (sourceFiles.includes(filename)) continue
    const fallback = path.join(PACKAGE_ROOT, filename)
    if (fs.existsSync(fallback)) files[filename] = fs.readFileSync(fallback, 'utf8')
  }

  let viteConfig = scaffoldText('vite.config.js')
  viteConfig = viteConfig.replace(
    'const __dirname = path.dirname(fileURLToPath(import.meta.url))',
    "const __dirname = path.dirname(fileURLToPath(import.meta.url))\nprocess.env.HYPERCANVAS_NOTEBOOK_ROOT = path.resolve(__dirname, './notebook-content')",
  )
  viteConfig = viteConfig.replace(
    "const base = process.env.VITE_BASE_PATH || '/'",
    `const base = process.env.VITE_BASE_PATH || ${JSON.stringify(basePath)}`,
  )
  viteConfig = viteConfig.replace(
    '    base,\n',
    "    base,\n    define: { 'globalThis.__HYPERCANVAS_NOTEBOOK_PUBLICATION__': 'true' },\n",
  )
  files['vite.config.js'] = viteConfig

  files['index.html'] = [
    '<!doctype html>',
    '<html>',
    '  <head>',
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `    <title>${escapeHtml(notebook.manifest.title)}</title>`,
    '  </head>',
    '  <body>',
    '    <div id="root"></div>',
    '    <script type="module" src="/src/library/mount.jsx"></script>',
    '  </body>',
    '</html>',
    '',
  ].join('\n')
  files['prototypes.html'] = [
    '<!doctype html>',
    '<html>',
    '  <head>',
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `    <title>${escapeHtml(notebook.manifest.title)}</title>`,
    '  </head>',
    '  <body>',
    '    <div id="root"></div>',
    '    <script type="module" src="/src/library/prototypes-entry.jsx"></script>',
    '  </body>',
    '</html>',
    '',
  ].join('\n')
  files['public/404.html'] = [
    '<!doctype html>',
    '<html>',
    '  <head>',
    '    <meta charset="utf-8" />',
    '    <title>Redirecting&hellip;</title>',
    '    <script>',
    '      /* Resolve the nearest hosted app root so project and branch prefixes work. */',
    '      (async function () {',
    '        var segments = window.location.pathname.split("/").filter(Boolean)',
    '        for (var count = segments.length; count >= 0; count -= 1) {',
    '          var base = count ? "/" + segments.slice(0, count).join("/") + "/" : "/"',
    '          try {',
    '            var response = await fetch(base + "index.html", { method: "HEAD", cache: "no-store" })',
    '            if (!response.ok) continue',
    '            var route = segments.slice(count).join("/") + window.location.search + window.location.hash',
    '            var target = base + "?p=" + encodeURIComponent(route) + "&b=" + encodeURIComponent(base)',
    '            window.location.replace(target)',
    '            return',
    '          } catch { /* try the next parent */ }',
    '        }',
    '        window.location.replace("/")',
    '      })()',
    '    </script>',
    '  </head>',
    '  <body></body>',
    '</html>',
    '',
  ].join('\n')
  files['public/.nojekyll'] = ''
  files['.gitignore'] = 'node_modules/\n'
  return files
}

function generatedFiles(notebook, pages, frames, sourceFiles, basePath = './', generatedNotebookFiles = {}) {
  const files = normalRuntimeFiles(notebook, sourceFiles, basePath)
  Object.assign(files, vendoredRuntimeFiles())
  Object.assign(files, generatedNotebookFiles)
  const dependencies = { ...runtimeDependencies(), ...prototypeDependencies(notebook, sourceFiles) }
  files['package.json'] = jsonScript({
    name: 'published-notebook-site',
    private: true,
    version: '1.0.0',
    type: 'module',
    scripts: {
      dev: 'npm run build:runtime && vite',
      build: 'npm run build:runtime && vite build',
      preview: 'vite preview',
      'build:runtime': 'npm run build:css --prefix vendor/hypercanvas && npm run build:ui --prefix vendor/hypercanvas && npm run build:canvas --prefix vendor/hypercanvas',
    },
    dependencies,
    devDependencies: {},
  }) + '\n'
  files[PUBLICATION_MARKER_FILE] = jsonScript(publicationMarker(notebook, sourceFiles, Object.keys(generatedNotebookFiles))) + '\n'
  files[NOTEBOOK_MANIFEST_FILE] = jsonScript(notebook.manifest) + '\n'
  files[`public/${NOTEBOOK_MANIFEST_FILE}`] = jsonScript(notebook.manifest) + '\n'
  files['publish-manifest.json'] = jsonScript({
    formatVersion: 1,
    title: notebook.manifest.title,
    notebookId: notebook.manifest.id,
    pages: pages.map(({ id, type, title, slug, prototypeName }) => ({ id, type, title, slug, prototypeName: prototypeName || null })),
  }) + '\n'
  files['package-lock.json'] = null
  return files
}

function safeSourcePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || path.posix.isAbsolute(value)) return null
  const segments = value.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return null
  if (segments.some((segment) => EXCLUDED_DIRECTORY_NAMES.has(segment))) return null
  if (segments[0] === NOTEBOOK_PUBLISH_DIR || segments[0] === 'dist' || value === PUBLISH_WORKFLOW_PATH) return null
  return value
}

function pathsOverlap(first, second) {
  return first === second || first.startsWith(`${second}/`) || second.startsWith(`${first}/`)
}

function sourceConflict(relativePath, reason) {
  return publishingError(
    'PUBLISH_SOURCE_CONFLICT',
    `Notebook source path "${relativePath}" conflicts with the generated publication project${reason ? ` (${reason})` : ''}.`,
    relativePath,
    'Move or rename the conflicting Notebook path, then retry; Hypercanvas will not overwrite it.',
  )
}

function preflightSourceFiles({ notebookRoot, destination, sourceFiles, generatedPaths, previousMarker }) {
  const previousSources = new Set((Array.isArray(previousMarker?.sourceFiles) ? previousMarker.sourceFiles : []).map(safeSourcePath).filter(Boolean))
  const hasPreviousPublication = Boolean(previousMarker)
  const generated = [...generatedPaths]

  for (const relativePath of sourceFiles) {
    if (!safeSourcePath(relativePath)) throw sourceConflict(relativePath, 'unsafe or reserved path')
    if (relativePath === 'dist' || relativePath.startsWith('dist/')) throw sourceConflict(relativePath, 'dist/ is generated by the site build')
    if (relativePath === PUBLISH_WORKFLOW_PATH) throw sourceConflict(relativePath, 'the Pages workflow is managed by publishing')
    for (const targetPath of notebookDestinationPaths(relativePath)) {
      if (generated.some((generatedPath) => pathsOverlap(targetPath, generatedPath))) {
        throw sourceConflict(relativePath, `it overlaps generated site file ${targetPath}`)
      }

      const target = path.join(destination, ...targetPath.split('/'))
      const parentSegments = targetPath.split('/').slice(0, -1)
      let parent = destination
      for (const segment of parentSegments) {
        parent = path.join(parent, segment)
        try {
          if (!fs.lstatSync(parent).isDirectory()) throw sourceConflict(relativePath, 'a destination parent is not a directory')
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error
        }
      }

      try {
        const stat = fs.lstatSync(target)
        if (!stat.isFile()) throw sourceConflict(relativePath, 'the destination path is not a regular file')
        const topLevel = relativePath.split('/')[0]
        const legacyManaged = hasPreviousPublication && LEGACY_MIRROR_SCOPES.has(topLevel)
        if (!previousSources.has(relativePath) && !legacyManaged) {
          throw sourceConflict(relativePath, 'an unrelated destination file already exists')
        }
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
    }
  }

  // Resolve each source against the Notebook root before any destination write.
  for (const relativePath of sourceFiles) {
    const source = path.join(notebookRoot, ...relativePath.split('/'))
    try {
      if (!fs.lstatSync(source).isFile()) throw sourceConflict(relativePath, 'source is not a regular file')
    } catch (error) {
      if (error?.code === 'ENOENT') throw sourceConflict(relativePath, 'source disappeared during generation')
      throw error
    }
  }
}

function notebookDestinationPaths(relativePath) {
  const paths = [`${NOTEBOOK_CONTENT_DIRECTORY}/${relativePath}`]
  if (NOTEBOOK_CONFIG_FILES.includes(relativePath)) paths.push(relativePath)
  if (relativePath.startsWith(`${NOTEBOOK_DIRECTORIES.assets}/`)) {
    paths.push(`public/${relativePath}`)
  }
  return paths
}

function copyNotebookFiles(notebookRoot, destination, sourceFiles) {
  const copiedPaths = new Set()
  for (const relativePath of sourceFiles) {
    const source = path.join(notebookRoot, ...relativePath.split('/'))
    for (const targetPath of notebookDestinationPaths(relativePath)) {
      const target = path.join(destination, ...targetPath.split('/'))
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(source, target)
      copiedPaths.add(targetPath)
    }
  }
  return copiedPaths
}

function walkFiles(root) {
  const files = []
  if (!fs.existsSync(root)) return files
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) files.push(path.relative(root, full).split(path.sep).join('/'))
    }
  }
  walk(root)
  return files
}

function removeEmptyDirectories(root) {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const full = path.join(root, entry.name)
    removeEmptyDirectories(full)
    if (fs.readdirSync(full).length === 0) fs.rmdirSync(full)
  }
}

function removeEmptyParents(destination, relativePath) {
  let directory = path.dirname(path.join(destination, ...relativePath.split('/')))
  while (directory !== destination && isInside(destination, directory)) {
    try {
      if (fs.readdirSync(directory).length) return
      fs.rmdirSync(directory)
    } catch { return }
    directory = path.dirname(directory)
  }
}

/** Remove only legacy-scope files or source paths previously owned by publishing. */
function cleanupStale(destination, desired, previousSourceFiles = [], previousGeneratedNotebookFiles = []) {
  for (const scope of MANAGED_SCOPES) {
    const scopeRoot = path.join(destination, scope)
    for (const relative of walkFiles(scopeRoot)) {
      if (!desired.has(`${scope}/${relative}`)) fs.rmSync(path.join(scopeRoot, relative), { force: true })
    }
    removeEmptyDirectories(scopeRoot)
  }

  for (const relativePath of Array.isArray(previousSourceFiles) ? previousSourceFiles : []) {
    const safePath = safeSourcePath(relativePath)
    if (!safePath) continue
    for (const targetPath of notebookDestinationPaths(safePath)) {
      if (desired.has(targetPath)) continue
      const filePath = path.join(destination, ...targetPath.split('/'))
      try {
        const stat = fs.lstatSync(filePath)
        if (stat.isFile() || stat.isSymbolicLink()) fs.rmSync(filePath, { force: true })
        removeEmptyParents(destination, targetPath)
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
    }

    const topLevel = safePath.split('/')[0]
    if (desired.has(safePath) || MANAGED_SCOPES.some((scope) => safePath.startsWith(`${scope}/`))) continue
    if (LEGACY_MIRROR_SCOPES.has(topLevel)) continue
    const legacyPath = path.join(destination, ...safePath.split('/'))
    try {
      const stat = fs.lstatSync(legacyPath)
      if (stat.isFile() || stat.isSymbolicLink()) fs.rmSync(legacyPath, { force: true })
      removeEmptyParents(destination, safePath)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }

  for (const relativePath of Array.isArray(previousGeneratedNotebookFiles) ? previousGeneratedNotebookFiles : []) {
    const safePath = safeSourcePath(relativePath)
    if (!safePath?.startsWith(`${NOTEBOOK_CONTENT_DIRECTORY}/prototypes/`) || desired.has(safePath)) continue
    const filePath = path.join(destination, ...safePath.split('/'))
    try {
      const stat = fs.lstatSync(filePath)
      if (stat.isFile() || stat.isSymbolicLink()) fs.rmSync(filePath, { force: true })
      removeEmptyParents(destination, safePath)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }

  for (const relativePath of LEGACY_PRESENTATION_FILES) {
    if (desired.has(relativePath)) continue
    const filePath = path.join(destination, ...relativePath.split('/'))
    try { fs.rmSync(filePath, { force: true }) } catch { /* a stale legacy file is optional */ }
    removeEmptyParents(destination, relativePath)
  }
}

function appendPublishedFrameEvents(destination, pages, frames) {
  for (const page of pages) {
    if (page.type !== 'canvas') continue
    const framesByWidget = frames.get(page.slug)
    if (!framesByWidget) continue
    const target = path.join(destination, NOTEBOOK_CONTENT_DIRECTORY, ...page.path.split('/'))
    let source
    try { source = fs.readFileSync(target, 'utf8') } catch { continue }
    const events = Object.entries(framesByWidget).map(([widgetId, props]) => JSON.stringify({
      event: 'widget_updated',
      timestamp: '1970-01-01T00:00:00.000Z',
      widgetId,
      props,
    }))
    if (!events.length) continue
    fs.writeFileSync(target, `${source}${source.endsWith('\n') ? '' : '\n'}${events.join('\n')}\n`)
  }
}

/**
 * Materialize (or non-destructively update) the portable project for a valid
 * Notebook. Returns the project summary. The Notebook itself is never modified.
 */
export async function materializeProject({ notebookRoot, destination, mode = 'external', basePath = './' }) {
  const notebook = inspectNotebook(notebookRoot)
  if (notebook.status !== 'valid') {
    throw publishingError('INVALID_NOTEBOOK', 'Notebook must be valid before it can be published.', notebook.diagnostics)
  }
  const sourceFiles = notebookSourceFiles(notebook.root)
  const pages = publishedPages(notebook)
  const canvases = pages.filter((page) => page.type === 'canvas')
  const { frames, warnings } = await preparePublishedFrames({ notebookRoot: notebook.root, canvases })
  const { directory } = ensureProjectDirectory({ destination, notebookRoot: notebook.root, mode })
  const previousMarker = readMarker(directory)
  const generatedNotebookFiles = generatedPrototypeMetadata(pages, sourceFiles)
  const files = generatedFiles(notebook, pages, frames, sourceFiles, basePath, generatedNotebookFiles)
  files['package-lock.json'] = null
  preflightSourceFiles({
    notebookRoot: notebook.root,
    destination: directory,
    sourceFiles,
    generatedPaths: Object.keys(files),
    previousMarker,
  })
  const desired = new Set(Object.keys(files))
  const dependencies = JSON.parse(files['package.json']).dependencies
  for (const [relative, content] of Object.entries(files)) {
    const filePath = path.join(directory, relative)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    if (content === null) {
      let existingLockfile = null
      try { existingLockfile = JSON.parse(fs.readFileSync(filePath, 'utf8')) } catch { /* install the scaffold lockfile */ }
      if (!lockfileMatchesDependencies(existingLockfile, dependencies)) {
        fs.copyFileSync(require.resolve(LOCKFILE_SCAFFOLD), filePath)
      }
    }
    else fs.writeFileSync(filePath, content)
    desired.add(relative)
  }
  for (const relativePath of copyNotebookFiles(notebook.root, directory, sourceFiles)) desired.add(relativePath)
  appendPublishedFrameEvents(directory, pages, frames)
  cleanupStale(directory, desired, previousMarker?.sourceFiles, previousMarker?.generatedNotebookFiles)
  return {
    destination: directory,
    mode,
    marker: JSON.parse(files[PUBLICATION_MARKER_FILE]),
    pages: pages.map((page) => ({ id: page.id, type: page.type, title: page.title, slug: page.slug })),
    warnings,
  }
}

export const __test = { normalRuntimeFiles, generatedFiles, publishedPages, generatedPrototypeMetadata, cleanupStale, notebookSourceFiles, packageNameFromSpecifier, prototypeModuleSpecifiers, prototypeDependencies, preflightSourceFiles, notebookDestinationPaths }
