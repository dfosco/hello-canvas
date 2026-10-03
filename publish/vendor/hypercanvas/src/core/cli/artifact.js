/**
 * storyboard artifact — Manage storyboard artifacts (prototypes, canvases, components, etc).
 *
 * Subcommands:
 *   storyboard artifact create <type> --name X [--title T] [--folder F] ...
 *   storyboard artifact edit <type> <name> [--title T] ...
 *   storyboard artifact delete <type> <name> [--force]
 *   storyboard artifact list [type] [--folder X] [--json]
 *   storyboard artifact schema <type>
 *
 * Types: prototype, canvas, site, component, flow, object, record, page
 *
 * Each flag maps 1:1 to a schema field. Run `storyboard artifact schema <type>`
 * to see the full JSON Schema for any artifact type.
 */

import { post, get, patch, del, parseSimpleArgs, jsonOut, die } from './cliHelpers.js'
import * as p from '@clack/prompts'

const TYPES = ['prototype', 'canvas', 'site', 'component', 'flow', 'object', 'record', 'page']

const dim = (s) => `\x1b[2m${s}\x1b[0m`
const green = (s) => `\x1b[32m${s}\x1b[0m`
const cyan = (s) => `\x1b[36m${s}\x1b[0m`
const bold = (s) => `\x1b[1m${s}\x1b[0m`

function showHelp() {
  const cmd = (name, desc) => `    ${green(name.padEnd(40))}${desc}`
  console.log(`
  ${bold('storyboard artifact')} — Manage storyboard artifacts

  ${bold(cyan('Subcommands'))}
${cmd('create <type> --name X [flags]', 'Create a new artifact')}
${cmd('edit <type> <name> [flags]', 'Edit an existing artifact')}
${cmd('delete <type> <name> [--force]', 'Delete an artifact')}
${cmd('list [type] [--folder X] [--json]', 'List artifacts')}
${cmd('schema <type>', 'Show the JSON Schema for a type')}

  ${bold(cyan('Types'))}
    ${TYPES.join(', ')}

  ${bold(cyan('Create flags'))} ${dim('(vary by type — use `artifact schema <type>` for full list)')}
${cmd('--name, -n', 'Artifact name (required)')}
${cmd('--title, -t', 'Display title')}
${cmd('--folder, -f', 'Parent .folder directory')}
${cmd('--description, -d', 'Description')}
${cmd('--author, -a', 'Author name(s)')}
${cmd('--prototype, -p', 'Parent prototype (for flow/page/object/record)')}
${cmd('--url', 'External URL (external prototype)')}
${cmd('--json', 'Output as JSON')}

  ${bold(cyan('Examples'))}
    ${dim('$')} storyboard artifact create prototype --name my-app --title "My App"
    ${dim('$')} storyboard artifact create component --name LoginForm --prototype my-app
    ${dim('$')} storyboard artifact create flow --name settings --prototype my-app
    ${dim('$')} storyboard artifact edit prototype my-app --title "New Title"
    ${dim('$')} storyboard artifact delete prototype my-app --force
    ${dim('$')} storyboard artifact list --json
    ${dim('$')} storyboard artifact list component --folder my-folder
    ${dim('$')} storyboard artifact schema prototype
`)
  process.exit(0)
}

// --- Main dispatch ---

const subcommand = process.argv[3]

if (!subcommand || subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
  showHelp()
}

switch (subcommand) {
  case 'create':
    await handleCreate()
    break
  case 'edit':
    await handleEdit()
    break
  case 'delete':
    await handleDelete()
    break
  case 'list':
    await handleList()
    break
  case 'schema':
    await handleSchema()
    break
  default:
    die(`Unknown subcommand: ${subcommand}. Run 'storyboard artifact --help' for usage.`)
}

// --- Subcommand handlers ---

async function handleCreate() {
  const args = process.argv.slice(4) // skip: node, sb, artifact, create
  const { positional, flags } = parseSimpleArgs(args)

  if (flags.help || flags.h) showHelp()

  const type = positional[0]
  const isJson = flags.json

  if (!type) {
    if (isJson) die('Type is required. Use: storyboard artifact create <type>')
    // Interactive type selection
    p.intro('storyboard artifact create')
    const selected = await p.select({
      message: 'Artifact type',
      options: TYPES.map(t => ({ value: t, label: t })),
    })
    if (p.isCancel(selected)) process.exit(0)
    await doCreate(selected, flags, isJson)
    return
  }

  if (!TYPES.includes(type)) {
    die(`Unknown type: ${type}. Valid types: ${TYPES.join(', ')}`)
  }

  await doCreate(type, flags, isJson)
}

async function doCreate(type, flags, isJson) {
  // Build the values payload from flags
  const values = buildValues(flags)
  values.type = type

  // Name is required
  if (!values.name) {
    if (isJson) die('--name is required')
    const name = await p.text({ message: 'Artifact name (kebab-case)', placeholder: 'my-artifact' })
    if (p.isCancel(name)) process.exit(0)
    values.name = name
  }

  try {
    const result = await post('/_storyboard/artifact/', values)
    if (isJson) {
      jsonOut(result)
    } else {
      const path = result.path || result.files?.[0] || ''
      console.log(`\n  ${green('✓')} Created ${bold(type)} ${cyan(values.name)}${path ? ` at ${dim(path)}` : ''}`)
      if (result.files?.length > 1) {
        console.log(`    Files: ${result.files.map(f => dim(f)).join(', ')}`)
      }
      console.log('')
    }
  } catch (err) {
    die(err.message)
  }
}

async function handleEdit() {
  const args = process.argv.slice(4) // skip: node, sb, artifact, edit
  const { positional, flags } = parseSimpleArgs(args)
  const isJson = flags.json

  const type = positional[0]
  const name = positional[1]

  if (!type) die('Type is required. Usage: storyboard artifact edit <type> <name> [flags]')
  if (!TYPES.includes(type)) die(`Unknown type: ${type}. Valid types: ${TYPES.join(', ')}`)
  if (!name) die('Name is required. Usage: storyboard artifact edit <type> <name> [flags]')

  const values = buildValues(flags)

  if (Object.keys(values).length === 0) {
    die('No updates provided. Pass flags like --title "New Title" to update fields.')
  }

  try {
    const result = await patch('/_storyboard/artifact/', { type, name, ...values })
    if (isJson) {
      jsonOut(result)
    } else {
      console.log(`\n  ${green('✓')} Updated ${bold(type)} ${cyan(name)}`)
      console.log('')
    }
  } catch (err) {
    die(err.message)
  }
}

async function handleDelete() {
  const args = process.argv.slice(4) // skip: node, sb, artifact, delete
  const { positional, flags } = parseSimpleArgs(args)
  const isJson = flags.json

  const type = positional[0]
  const name = positional[1]

  if (!type) die('Type is required. Usage: storyboard artifact delete <type> <name> [--force]')
  if (!TYPES.includes(type)) die(`Unknown type: ${type}. Valid types: ${TYPES.join(', ')}`)
  if (!name) die('Name is required. Usage: storyboard artifact delete <type> <name> [--force]')

  // Confirm unless --force
  if (!flags.force) {
    const confirm = await p.confirm({
      message: `Delete ${type} "${name}"? This cannot be undone.`,
    })
    if (p.isCancel(confirm) || !confirm) {
      console.log('  Cancelled.')
      process.exit(0)
    }
  }

  try {
    const result = await del('/_storyboard/artifact/', { type, name, folder: flags.folder || flags.f })
    if (isJson) {
      jsonOut(result)
    } else {
      console.log(`\n  ${green('✓')} Deleted ${bold(type)} ${cyan(name)}`)
      console.log('')
    }
  } catch (err) {
    die(err.message)
  }
}

async function handleList() {
  const args = process.argv.slice(4) // skip: node, sb, artifact, list
  const { positional, flags } = parseSimpleArgs(args)
  const isJson = flags.json

  const type = positional[0]

  // Build query string
  const params = new URLSearchParams()
  if (type) {
    if (!TYPES.includes(type)) die(`Unknown type: ${type}. Valid types: ${TYPES.join(', ')}`)
    params.set('type', type)
  }
  if (flags.folder || flags.f) params.set('folder', flags.folder || flags.f)
  if (flags.prototype || flags.p) params.set('prototype', flags.prototype || flags.p)

  const qs = params.toString()
  const path = `/_storyboard/artifact/list${qs ? '?' + qs : ''}`

  try {
    const result = await get(path)
    if (isJson) {
      jsonOut(result)
    } else {
      const artifacts = type
        ? result.items || []
        : Object.entries(result.items || {}).flatMap(([artifactType, items]) => items.map(item => ({ ...item, type: artifactType })))
      if (artifacts.length === 0) {
        console.log(`\n  No artifacts found${type ? ` of type "${type}"` : ''}.`)
        console.log('')
        return
      }

      console.log(`\n  ${bold('Artifacts')}${type ? ` (${type})` : ''}: ${dim(`${artifacts.length} found`)}\n`)
      for (const a of artifacts) {
        const label = a.title || a.name
        const typeTag = dim(`[${a.type}]`)
        const path = a.path ? dim(` · ${a.path}`) : ''
        console.log(`    ${typeTag} ${cyan(label)}${path}`)
      }
      console.log('')
    }
  } catch (err) {
    die(err.message)
  }
}

async function handleSchema() {
  const args = process.argv.slice(4) // skip: node, sb, artifact, schema
  const { positional } = parseSimpleArgs(args)

  const type = positional[0]
  if (!type) die('Type is required. Usage: storyboard artifact schema <type>')
  if (!TYPES.includes(type)) die(`Unknown type: ${type}. Valid types: ${TYPES.join(', ')}`)

  try {
    const result = await get(`/_storyboard/artifact/schema?type=${type}`)
    console.log(JSON.stringify(result, null, 2))
  } catch (err) {
    die(err.message)
  }
}

// --- Helpers ---

/**
 * Extract known creation flags into a values object.
 * Handles aliases (short flags) and passes through unknown flags as-is.
 */
function buildValues(flags) {
  const values = {}

  // Map known aliases to canonical names
  const aliasMap = {
    n: 'name',
    t: 'title',
    f: 'folder',
    d: 'description',
    a: 'author',
    p: 'prototype',
    // kebab-case CLI flag → camelCase schema field
    'folder-kind': 'folderKind',
  }

  for (const [key, val] of Object.entries(flags)) {
    // Skip meta flags
    if (key === 'json' || key === 'force' || key === 'help' || key === 'h') continue

    const canonical = aliasMap[key] || key
    values[canonical] = val
  }

  return values
}
