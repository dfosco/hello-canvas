/**
 * fileFlavor.js
 *
 * Maps a file path or filename to rendering metadata used by the FileWidget.
 * Pure module — no React, no I/O, zero dependencies.
 *
 * ## Flavors
 * - `markdown`    — .md, .markdown files
 * - `mdx`         — .mdx files
 * - `code`        — any other text file (shown in code editor)
 * - `unsupported` — binary or unrecognised extension
 */

// ── Extension tables ────────────────────────────────────────────────────────

/** Maps extension → CodeMirror language id (null = plain text). */
const LANGUAGE_MAP = {
  js:           'javascript',
  jsx:          'javascript',
  cjs:          'javascript',
  mjs:          'javascript',
  ts:           'typescript',
  tsx:          'typescript',
  css:          'css',
  scss:         'css',
  html:         'html',
  htm:          'html',
  svg:          'html',
  xml:          'html',
  json:         'json',
  jsonc:        'json',
  jsonl:        'json',
  md:           'markdown',
  markdown:     'markdown',
  mdx:          'markdown',
  yaml:         'yaml',
  yml:          'yaml',
  py:           'python',
  rb:           'ruby',
  go:           'go',
  rs:           'rust',
  java:         'java',
  c:            'cpp',
  cpp:          'cpp',
  h:            'cpp',
  hpp:          'cpp',
  sh:           'shell',
  bash:         'shell',
  zsh:          'shell',
  fish:         'shell',
}

/** Maps extension → MIME type. */
const MIME_MAP = {
  js:           'text/javascript',
  jsx:          'text/javascript',
  cjs:          'text/javascript',
  mjs:          'text/javascript',
  ts:           'text/typescript',
  tsx:          'text/typescript',
  css:          'text/css',
  scss:         'text/x-scss',
  html:         'text/html',
  htm:          'text/html',
  svg:          'image/svg+xml',
  xml:          'application/xml',
  json:         'application/json',
  jsonc:        'application/json',
  jsonl:        'application/jsonl',
  md:           'text/markdown',
  markdown:     'text/markdown',
  mdx:          'text/mdx',
  yaml:         'text/yaml',
  yml:          'text/yaml',
  toml:         'text/toml',
  ini:          'text/plain',
  env:          'text/plain',
  sh:           'application/x-sh',
  bash:         'application/x-sh',
  zsh:          'application/x-sh',
  fish:         'application/x-sh',
  py:           'text/x-python',
  rb:           'text/x-ruby',
  go:           'text/x-go',
  rs:           'text/x-rust',
  java:         'text/x-java',
  c:            'text/x-c',
  cpp:          'text/x-c++',
  h:            'text/x-c',
  hpp:          'text/x-c++',
  txt:          'text/plain',
  text:         'text/plain',
  log:          'text/plain',
  config:       'text/plain',
}

/**
 * Set of extensions (without leading dot) that are considered text files.
 * Order does not matter — membership is the only check.
 */
const TEXT_EXTENSIONS = new Set([
  'md', 'markdown', 'mdx',
  'js', 'jsx', 'ts', 'tsx', 'cjs', 'mjs',
  'json', 'jsonc', 'jsonl',
  'css', 'scss',
  'html', 'htm', 'svg', 'xml',
  'yaml', 'yml',
  'toml', 'ini', 'env',
  'sh', 'bash', 'zsh', 'fish',
  'py', 'rb', 'go', 'rs', 'java',
  'c', 'cpp', 'h', 'hpp',
  'txt', 'text', 'log', 'config',
  'gitignore', 'gitattributes', 'editorconfig',
  'npmrc', 'nvmrc', 'prettierrc', 'eslintrc', 'dockerignore',
])

/**
 * Well-known filenames that are text files even without a recognisable
 * extension (e.g. `Dockerfile`, `.gitignore`).
 */
const WELL_KNOWN_NAMES = new Set([
  'dockerfile', 'makefile', 'license', 'readme',
  '.gitignore', '.gitattributes', '.editorconfig',
  '.npmrc', '.nvmrc', '.prettierrc', '.eslintrc', '.dockerignore', '.env',
])

/** Language ids for well-known extensionless files. */
const WELL_KNOWN_LANGUAGE = {
  dockerfile:  'shell',
  makefile:    'shell',
}

/** MIME types for well-known extensionless files. */
const WELL_KNOWN_MIME = {
  dockerfile:   'application/x-sh',
  makefile:     'text/x-makefile',
  license:      'text/plain',
  readme:       'text/plain',
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract the bare filename from a path, stripping query strings and fragments.
 * @param {string} input
 * @returns {string}
 */
function basename(input) {
  // Strip query / fragment
  const clean = input.replace(/[?#].*$/, '')
  // Last path segment
  return clean.split('/').pop() || ''
}

/**
 * Extract the lowercase extension (without leading dot) from a filename.
 * Returns empty string if there is no extension.
 * @param {string} filename — bare filename (no path)
 * @returns {string}
 */
function extension(filename) {
  // Dotfiles like `.gitignore` have no extension — their name IS the key
  const dot = filename.lastIndexOf('.')
  if (dot <= 0) return ''
  return filename.slice(dot + 1).toLowerCase()
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Detect the render flavor and editor metadata for a file path or filename.
 *
 * Handles edge cases:
 * - Empty string / null / undefined → returns `unsupported` with all nulls
 * - Paths with `..` segments — only the final filename is examined
 * - Query strings / fragments (e.g. `foo.md?v=1`) — stripped before detection
 *
 * @param {string | null | undefined} pathOrFilename
 * @returns {{ flavor: 'markdown'|'mdx'|'code'|'unsupported', language: string|null, mime: string|null, isText: boolean, extension: string }}
 */
export function detectFlavor(pathOrFilename) {
  const unsupported = { flavor: 'unsupported', language: null, mime: null, isText: false, extension: '' }

  if (!pathOrFilename || typeof pathOrFilename !== 'string') return unsupported

  const file = basename(pathOrFilename)
  if (!file) return unsupported

  const fileLower = file.toLowerCase()
  const ext = extension(file)

  // Check well-known extensionless names first
  if (!ext && WELL_KNOWN_NAMES.has(fileLower)) {
    return {
      flavor:    'code',
      language:  WELL_KNOWN_LANGUAGE[fileLower] ?? null,
      mime:      WELL_KNOWN_MIME[fileLower] ?? 'text/plain',
      isText:    true,
      extension: '',
    }
  }

  // Dotfiles whose name (without leading dot) is in TEXT_EXTENSIONS
  // e.g. `.gitignore` → ext = '' but fileLower = '.gitignore' already handled above
  // e.g. `.eslintrc` already in WELL_KNOWN_NAMES
  if (!ext) return unsupported

  // Extension-based detection
  if (!TEXT_EXTENSIONS.has(ext)) {
    return { ...unsupported, extension: ext }
  }

  let flavor
  if (ext === 'mdx') {
    flavor = 'mdx'
  } else if (ext === 'md' || ext === 'markdown') {
    flavor = 'markdown'
  } else {
    flavor = 'code'
  }

  return {
    flavor,
    language:  LANGUAGE_MAP[ext] ?? null,
    mime:      MIME_MAP[ext] ?? 'text/plain',
    isText:    true,
    extension: ext,
  }
}

/**
 * Returns `true` if the file is a text file the editor can open.
 *
 * @param {string | null | undefined} pathOrFilename
 * @returns {boolean}
 */
export function isTextFile(pathOrFilename) {
  return detectFlavor(pathOrFilename).isText
}

/**
 * Returns the CodeMirror language id for the file, or `null` if none applies
 * (plain text or unsupported).
 *
 * @param {string | null | undefined} pathOrFilename
 * @returns {string | null}
 */
export function getLanguageId(pathOrFilename) {
  return detectFlavor(pathOrFilename).language
}
