/**
 * storyboard file — Read, write, and list repo files.
 *
 * Subcommands:
 *   storyboard file tree [--root <dir>] [--json]
 *   storyboard file read <path> [--json]
 *   storyboard file write <path> [--content X] [--from-stdin] [--from-file <localpath>] [--json]
 *   storyboard file rename <from> <to> [--json]
 *   storyboard file upload <filename> [--content <base64>] [--from-file <localpath>] [--dest-dir <dir>] [--skip-identical-search] [--json]
 *   storyboard file exists <path> [--json]
 *   storyboard file resolve <absPath...> [--json]
 */

import { readFile } from 'node:fs/promises'
import { get, post, put, parseSimpleArgs, jsonOut, die } from './cliHelpers.js'
import * as p from '@clack/prompts'

const dim = (s) => `\x1b[2m${s}\x1b[0m`
const green = (s) => `\x1b[32m${s}\x1b[0m`
const cyan = (s) => `\x1b[36m${s}\x1b[0m`
const bold = (s) => `\x1b[1m${s}\x1b[0m`

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico',
  '.pdf', '.zip', '.woff', '.woff2',
])

function isBinary(filename) {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  return BINARY_EXTENSIONS.has(ext)
}

function showHelp() {
  const cmd = (name, desc) => `    ${green(name.padEnd(40))}${desc}`
  console.log(`
  ${bold('storyboard file')} — Read, write, and list repo files

  ${bold(cyan('Subcommands'))}
${cmd('tree [--root X]', 'List the editable repo file tree')}
${cmd('read <path>', "Read a file's content")}
${cmd('write <path> [--content X]', 'Overwrite a file')}
${cmd('rename <from> <to>', 'Rename a file (same directory only)')}
${cmd('upload <filename>', 'Upload a file into the default folder')}
${cmd('exists <path>', 'Check if a file exists')}
${cmd('resolve <absPath...>', 'Resolve abs file paths (e.g. file:// URIs) → rel path / image src')}

  ${bold(cyan('Flags'))}
${cmd('--json', 'Output as JSON')}
${cmd('--content', 'Inline content (for write/upload)')}
${cmd('--from-stdin', 'Read content from stdin (write)')}
${cmd('--from-file', 'Read content from a local file (write/upload)')}
${cmd('--root', 'Repo-relative root (tree)')}
${cmd('--dest-dir', 'Destination directory (upload)')}
${cmd('--skip-identical-search', 'Keep the upload in its destination even if identical bytes exist elsewhere')}

  ${bold(cyan('Examples'))}
    ${dim('$')} storyboard file tree
    ${dim('$')} storyboard file read src/README.md
    ${dim('$')} echo "hello" | storyboard file write notes.md --from-stdin
    ${dim('$')} storyboard file write notes.md --content "## hello"
    ${dim('$')} storyboard file rename old.md new.md
    ${dim('$')} storyboard file upload screenshot.png --from-file ~/Desktop/snap.png
    ${dim('$')} storyboard file exists src/main.jsx
    ${dim('$')} storyboard file resolve /Users/me/repo/src/foo.md /Users/me/repo/photo.png
`)
  process.exit(0)
}

// --- Main dispatch ---

const subcommand = process.argv[3]

if (!subcommand || subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
  showHelp()
}

switch (subcommand) {
  case 'tree':
    await handleTree()
    break
  case 'read':
    await handleRead()
    break
  case 'write':
    await handleWrite()
    break
  case 'rename':
    await handleRename()
    break
  case 'upload':
    await handleUpload()
    break
  case 'exists':
    await handleExists()
    break
  case 'resolve':
    await handleResolve()
    break
  default:
    die(`Unknown subcommand: ${subcommand}. Run 'storyboard file --help' for usage.`)
}

// --- Subcommand handlers ---

async function handleTree() {
  const args = process.argv.slice(4)
  const { flags } = parseSimpleArgs(args)
  const isJson = flags.json

  if (flags.help || flags.h) showHelp()

  const params = new URLSearchParams()
  if (flags.root) params.set('root', flags.root)
  const qs = params.toString()

  try {
    const result = await get(`/_storyboard/file/tree${qs ? '?' + qs : ''}`)
    if (isJson) {
      jsonOut(result)
    } else {
      printTree(result.tree || result, '')
    }
  } catch (err) {
    die(err.message)
  }
}

function printTree(nodes, prefix) {
  if (!Array.isArray(nodes)) return
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    const isLast = i === nodes.length - 1
    const connector = isLast ? '└── ' : '├── '
    const childPrefix = prefix + (isLast ? '    ' : '│   ')

    if (node.type === 'directory' || node.children) {
      console.log(prefix + connector + dim(node.name + '/'))
      if (node.children) printTree(node.children, childPrefix)
    } else {
      console.log(prefix + connector + node.name)
    }
  }
}

async function handleRead() {
  const args = process.argv.slice(4)
  const { positional, flags } = parseSimpleArgs(args)
  const isJson = flags.json

  if (flags.help || flags.h) showHelp()

  const filePath = positional[0]
  if (!filePath) die('Path is required. Usage: storyboard file read <path>')

  try {
    const result = await get(`/_storyboard/file/read?path=${encodeURIComponent(filePath)}`)
    if (isJson) {
      jsonOut(result)
    } else {
      process.stdout.write(result.content)
      if (!result.content.endsWith('\n')) process.stdout.write('\n')
    }
  } catch (err) {
    die(err.message)
  }
}

async function handleWrite() {
  const args = process.argv.slice(4)
  const { positional, flags } = parseSimpleArgs(args)
  const isJson = flags.json

  if (flags.help || flags.h) showHelp()

  const filePath = positional[0]
  if (!filePath) die('Path is required. Usage: storyboard file write <path>')

  let content

  if (flags.content !== undefined) {
    content = flags.content
  } else if (flags['from-stdin']) {
    let buf = ''
    for await (const chunk of process.stdin) buf += chunk
    content = buf
  } else if (flags['from-file']) {
    content = await readFile(flags['from-file'], 'utf-8').catch(err => die(err.message))
  } else if (!isJson) {
    p.intro('storyboard file write')
    const entered = await p.text({
      message: `Content for ${cyan(filePath)}`,
      placeholder: 'Enter file content…',
    })
    if (p.isCancel(entered)) process.exit(0)
    content = entered
  } else {
    die('Content is required. Use --content, --from-stdin, or --from-file.')
  }

  try {
    const result = await put('/_storyboard/file/write', { path: filePath, content })
    if (isJson) {
      jsonOut(result)
    } else {
      console.log(`\n  ${green('✓')} Wrote ${cyan(filePath)} ${dim(`(${result.size} bytes)`)}\n`)
    }
  } catch (err) {
    die(err.message)
  }
}

async function handleRename() {
  const args = process.argv.slice(4)
  const { positional, flags } = parseSimpleArgs(args)
  const isJson = flags.json

  if (flags.help || flags.h) showHelp()

  const from = positional[0]
  const to = positional[1]

  if (!from) die('Source path is required. Usage: storyboard file rename <from> <to>')
  if (!to) die('Destination name is required. Usage: storyboard file rename <from> <to>')

  try {
    const result = await post('/_storyboard/file/rename', { from, to })
    if (isJson) {
      jsonOut(result)
    } else {
      console.log(`\n  ${green('✓')} Renamed ${cyan(from)} → ${cyan(result.to || to)}\n`)
    }
  } catch (err) {
    die(err.message)
  }
}

async function handleUpload() {
  const args = process.argv.slice(4)
  const { positional, flags } = parseSimpleArgs(args)
  const isJson = flags.json

  if (flags.help || flags.h) showHelp()

  const filename = positional[0]
  if (!filename) die('Filename is required. Usage: storyboard file upload <filename>')

  let content
  let encoding = 'utf-8'

  if (flags['from-file']) {
    const localPath = flags['from-file']
    if (isBinary(localPath)) {
      const buf = await readFile(localPath).catch(err => die(err.message))
      content = Buffer.from(buf).toString('base64')
      encoding = 'base64'
    } else {
      content = await readFile(localPath, 'utf-8').catch(err => die(err.message))
      encoding = 'utf-8'
    }
  } else if (flags.content !== undefined) {
    content = flags.content
    encoding = 'base64'
  } else {
    die('Content source is required. Use --from-file or --content.')
  }

  const body = { filename, content, encoding }
  if (flags['dest-dir']) body.destDir = flags['dest-dir']
  if (flags['skip-identical-search']) body.searchIdenticalFiles = false

  try {
    const result = await post('/_storyboard/file/upload', body)
    if (isJson) {
      jsonOut(result)
    } else {
      console.log(`\n  ${green('✓')} Uploaded ${cyan(filename)} → ${dim(result.path)}\n`)
    }
  } catch (err) {
    die(err.message)
  }
}

async function handleExists() {
  const args = process.argv.slice(4)
  const { positional, flags } = parseSimpleArgs(args)
  const isJson = flags.json

  if (flags.help || flags.h) showHelp()

  const filePath = positional[0]
  if (!filePath) die('Path is required. Usage: storyboard file exists <path>')

  try {
    const result = await get(`/_storyboard/file/exists?path=${encodeURIComponent(filePath)}`)
    if (isJson) {
      jsonOut(result)
    } else {
      console.log(result.exists ? 'yes' : 'no')
      process.exit(result.exists ? 0 : 1)
    }
  } catch (err) {
    die(err.message)
  }
}

async function handleResolve() {
  const args = process.argv.slice(4)
  const { positional, flags } = parseSimpleArgs(args)
  const isJson = flags.json

  if (flags.help || flags.h) showHelp()

  if (positional.length === 0) {
    die('At least one absolute path is required. Usage: storyboard file resolve <absPath...>')
  }

  try {
    const result = await post('/_storyboard/file/resolve', { paths: positional })
    if (isJson) {
      jsonOut(result)
    } else {
      for (const r of result.results || []) {
        if (r.ok && r.kind === 'image') {
          console.log(`${green('✓')} image  ${cyan(r.src)}${r.copied ? dim(' (copied)') : r.reused ? dim(' (reused)') : ''}`)
        } else if (r.ok && r.kind === 'file') {
          console.log(`${green('✓')} file   ${cyan(r.path)}`)
        } else {
          console.log(`${dim('✗')} ${r.reason || 'rejected'}  ${dim(r.absPath || '')}`)
        }
      }
    }
  } catch (err) {
    die(err.message)
  }
}
