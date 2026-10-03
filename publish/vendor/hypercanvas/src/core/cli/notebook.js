/**
 * storyboard notebook — manage content-only Notebook folders and Core bindings.
 *
 * This command only manages portable Notebook content and its local runtime
 * directory. It never copies the Hypercanvas application into the Notebook.
 */

import path from 'node:path'
import process from 'node:process'
import { initializeNotebook, inspectNotebook } from '../notebook/notebook.js'
import { publishNotebookProject } from '../notebook/publishing.js'
import { runNotebookRuntimeCommand } from './notebookRuntimeCommands.js'
import { notebookCatalogHelp, runNotebookCatalogCommand } from './notebookCatalogCommands.js'
import { die, jsonOut, parseSimpleArgs } from './cliHelpers.js'

function help() {
  console.log(`
  storyboard notebook — manage content-only Notebook folders

  Usage:
    storyboard notebook inspect [path] [--json]
    storyboard notebook init [path] [--id <id>] [--title <title>] [--json]
    storyboard notebook pages [--json]
    storyboard notebook navigation read [--json]
    storyboard notebook navigation update --notebook-id <id> --generation <n> --expected-revision <sha256> --operation <json>
    storyboard notebook publish <source> [destination] [--mode default|external] [--json]
    storyboard notebook recent
    storyboard notebook open <path>
    storyboard notebook create <path> [--title <title>] [--id <id>]
    storyboard notebook close

  A Notebook contains canvas/, prototypes/, assets/, and portable metadata.
  Runtime state is kept in .storyboard/ and the application is never copied in.
${notebookCatalogHelp}
`)
}

const subcommand = process.argv[3]
const { positional, flags } = parseSimpleArgs(process.argv.slice(4))
if (!subcommand || subcommand === 'help' || flags.help || flags.h) {
  help()
  process.exit(0)
}
if (!['inspect', 'init', 'publish', 'recent', 'open', 'create', 'close', 'pages', 'navigation'].includes(subcommand)) die(`Unknown notebook subcommand: ${subcommand}`)

if (['recent', 'open', 'create', 'close'].includes(subcommand)) {
  runNotebookRuntimeCommand([subcommand, ...positional]).then(result => {
    if (result.help) console.log(result.help)
    else console.log(JSON.stringify(result, null, 2))
  }).catch(error => die(error.message))
} else if (['pages', 'navigation'].includes(subcommand)) {
  runNotebookCatalogCommand([subcommand, ...process.argv.slice(4)]).then(jsonOut).catch(error => die(error.message))
} else {
const root = path.resolve(positional[0] || process.cwd())
try {
  const result = subcommand === 'publish'
    ? await publishNotebookProject({
      notebookRoot: root,
      destination: positional[1],
      mode: flags.mode || (positional[1] ? 'external' : 'default'),
      initializeGit: false,
    })
    : subcommand === 'init'
    ? initializeNotebook(root, { id: flags.id, title: flags.title || 'Notebook' })
    : inspectNotebook(root)

  if (flags.json) {
    jsonOut(result)
  } else {
    if (subcommand === 'publish') console.log(`published: ${result.destination}`)
    else console.log(`${result.status}: ${result.root}`)
    if (subcommand !== 'publish') {
      if (result.manifest) console.log(`  ${result.manifest.title} (${result.manifest.id})`)
      console.log(`  pages: ${result.pages.length}`)
      console.log(`  sites: ${(result.sites ?? []).length}`)
      for (const site of result.sites ?? []) console.log(`  - site ${site.id}: ${site.path}`)
      for (const page of result.pages) {
        console.log(`  - ${page.type || 'unknown'} ${page.title || page.id || '(unnamed)'}: ${page.available ? 'available' : 'unavailable'}`)
      }
      for (const item of result.diagnostics) console.error(`  ! ${item.code}: ${item.message}`)
    }
  }
  if (result.status === 'invalid' || result.status === 'unavailable') process.exitCode = 1
} catch (error) {
  die(error.message)
}
}
