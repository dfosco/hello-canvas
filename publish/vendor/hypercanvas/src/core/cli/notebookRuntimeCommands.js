import path from 'node:path'
import { get, post } from './cliHelpers.js'
import { parseFlags } from './flags.js'

const API = '/_storyboard/notebook-runtime'

export function notebookRuntimeHelp() {
  return [
    'Usage: storyboard notebook <recent|open|create|close> [path] [flags]',
    '',
    '  recent             List recently opened Notebooks',
    '  open <path>        Open/initialize a Notebook directory',
    '  create <path>      Create a Notebook in a selected directory (--title, --id)',
    '  close              Close the active Notebook binding',
  ].join('\n')
}

export async function runNotebookRuntimeCommand(args, request = { get, post }) {
  const [command, ...positional] = args
  if (command === 'recent' && positional.length === 0) return request.get(`${API}/recent`)
  if (command === 'close' && positional.length === 0) return request.post(`${API}/close`, {})
  if (command === 'open' && positional.length === 1 && positional[0]) {
    return request.post(`${API}/open`, { root: path.resolve(positional[0]) })
  }
  if (command === 'create') {
    const parsed = parseFlags(positional, {
      title: { type: 'string', description: 'New Notebook title' },
      id: { type: 'string', description: 'Stable Notebook ID' },
    })
    if (parsed.errors.length || parsed.positional.length !== 1 || !parsed.positional[0]) {
      throw new Error(`Usage: storyboard notebook create <path> [--title <title>] [--id <id>]`)
    }
    const body = { root: path.resolve(parsed.positional[0]), title: parsed.flags.title || 'Notebook' }
    if (parsed.flags.id) body.id = parsed.flags.id
    return request.post(`${API}/create`, body)
  }
  if (!command || command === 'help') return { help: notebookRuntimeHelp() }
  throw new Error(`Usage: ${notebookRuntimeHelp().replaceAll('\n', ' ')}`)
}
