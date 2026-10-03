import process from 'node:process'
import { get, post } from './cliHelpers.js'

const OPERATIONS = new Set(['select-directory', 'select-file', 'import-file', 'diagnostics'])

export function systemHelp() {
  return [
    'Usage: storyboard system select-directory [--purpose notebook|site]',
    '       storyboard system <select-file|import-file|diagnostics>',
    '',
    'Use Core OS pickers, import a selected file, or print Core runtime diagnostics.',
  ].join('\n')
}

export async function runSystemCommand(args, request = { get, post }) {
  const [operation, ...extra] = args
  if (!operation || operation === 'help') return { help: systemHelp() }
  if (!OPERATIONS.has(operation)) throw new Error(systemHelp())
  if (operation === 'diagnostics') {
    if (extra.length) throw new Error(systemHelp())
    return request.get('/_storyboard/diagnostics')
  }
  let body = {}
  if (operation === 'select-directory' && extra.length > 0) {
    if (extra.length !== 2 || extra[0] !== '--purpose' || !['notebook', 'site'].includes(extra[1])) {
      throw new Error(systemHelp())
    }
    body = { purpose: extra[1] }
  } else if (extra.length > 0) {
    throw new Error(systemHelp())
  }
  return request.post(`/_storyboard/system/${operation}`, body)
}

export async function main(args = process.argv.slice(3)) {
  try {
    const result = await runSystemCommand(args)
    if (result.help) console.log(result.help)
    else console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    console.error(JSON.stringify({ error: { code: error.code || 'CLI_ERROR', message: error.message } }, null, 2))
    process.exitCode = 1
  }
}
