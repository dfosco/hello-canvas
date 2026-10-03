import * as nodeFs from 'node:fs'
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export const KNOWN_MACOS_HOST_DIRECTORIES = Object.freeze([
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/opt/homebrew/opt/node@24/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '~/.local/bin',
  '~/.opencode/bin',
])

function expandHome(path, home) {
  if (path === '~') return home
  return path.startsWith(`~${sep}`) ? join(home, path.slice(2)) : path
}

function isInside(path, root) {
  const relation = relative(root, path)
  return relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..' && !isAbsolute(relation))
}

function isNodeModulesBin(path) {
  return path.split(sep).some((part, index, parts) => part === 'node_modules' && parts[index + 1] === '.bin')
}

function canonicalPath(path, fs) {
  try {
    return fs.realpathSync(path)
  } catch {
    return null
  }
}

function existingDirectory(path, fs) {
  try {
    return fs.statSync(path).isDirectory()
  } catch {
    return false
  }
}

function executableFile(path, fs) {
  try {
    fs.accessSync(path, nodeFs.constants.X_OK)
    return fs.statSync(path).isFile()
  } catch {
    return false
  }
}

function excludedReason(path, bundleRoots) {
  if (isNodeModulesBin(path)) return 'node_modules_bin'
  if (bundleRoots.some((root) => isInside(path, root))) return 'bundle'
  return null
}

function bundleRoots(env, fs) {
  if (!env.HYPERCANVAS_BUNDLE_ROOT) return []
  const lexical = resolve(env.HYPERCANVAS_BUNDLE_ROOT)
  const canonical = canonicalPath(lexical, fs)
  return [...new Set([lexical, canonical].filter(Boolean))]
}

export function discoverHostEnvironment({ env = {}, fs = nodeFs, home = env.HOME || '' } = {}) {
  const source = env.HYPERCANVAS_HOST_PATH === undefined ? 'PATH' : 'HYPERCANVAS_HOST_PATH'
  const inheritedPath = env.HYPERCANVAS_HOST_PATH ?? env.PATH ?? ''
  const roots = bundleRoots(env, fs)
  const candidates = [
    ...String(inheritedPath).split(delimiter),
    ...KNOWN_MACOS_HOST_DIRECTORIES.map((path) => expandHome(path, home)),
  ]
  const entries = []
  const rejected = []
  const seen = new Set()

  for (const value of candidates) {
    if (!value) continue
    const expanded = expandHome(value, home)
    if (!isAbsolute(expanded)) {
      rejected.push({ path: value, reason: 'not_absolute' })
      continue
    }
    const lexical = resolve(expanded)
    const lexicalReason = excludedReason(lexical, roots)
    if (lexicalReason) {
      rejected.push({ path: lexical, reason: lexicalReason })
      continue
    }
    if (!existingDirectory(lexical, fs)) {
      rejected.push({ path: lexical, reason: 'not_directory' })
      continue
    }
    const canonical = canonicalPath(lexical, fs)
    const canonicalReason = canonical && excludedReason(canonical, roots)
    if (!canonical || canonicalReason) {
      rejected.push({ path: lexical, reason: canonicalReason || 'unresolvable' })
      continue
    }
    if (!seen.has(canonical)) {
      seen.add(canonical)
      entries.push(canonical)
    }
  }

  return Object.freeze({
    source,
    path: entries.join(delimiter),
    entries: Object.freeze(entries),
    bundleRoots: Object.freeze(roots),
    rejected: Object.freeze(rejected.map(Object.freeze)),
  })
}

export function resolveHostExecutable(name, {
  environment,
  knownPaths = [],
  fs = nodeFs,
  home = '',
} = {}) {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return null
  const candidates = [
    ...(environment?.entries || []).map((directory) => join(directory, name)),
    ...knownPaths.map((path) => expandHome(path, home)),
  ]
  const seen = new Set()

  for (const value of candidates) {
    if (!isAbsolute(value)) continue
    const lexical = resolve(value)
    if (seen.has(lexical) || excludedReason(lexical, environment?.bundleRoots || [])) continue
    seen.add(lexical)
    if (!executableFile(lexical, fs)) continue
    const canonical = canonicalPath(lexical, fs)
    if (!canonical || excludedReason(canonical, environment?.bundleRoots || [])) continue
    return canonical
  }
  return null
}

export function executableDirectory(path) {
  return dirname(path)
}
