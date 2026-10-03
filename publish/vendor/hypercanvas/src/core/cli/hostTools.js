import { AGENT_IDS } from '../host-tools/catalog.js'
import { get, post } from './cliHelpers.js'
import { formatFlagHelp, parseFlags } from './flags.js'

const API_PATH = '/_storyboard/host-tools'
const AGENT_ID_SET = new Set(AGENT_IDS)

const COMMAND_SCHEMAS = Object.freeze({
  preflight: Object.freeze({}),
  plan: Object.freeze({
    agents: { type: 'array', description: `Agent IDs, repeated or comma-separated (${AGENT_IDS.join(', ')})` },
  }),
  install: Object.freeze({
    plan: { type: 'string', required: true, description: 'Plan ID returned by host-tools plan' },
    consent: { type: 'boolean', required: true, description: 'Explicitly consent to the disclosed plan' },
  }),
  status: Object.freeze({
    operation: { type: 'string', required: true, description: 'Installation operation ID' },
  }),
  cancel: Object.freeze({
    operation: { type: 'string', required: true, description: 'Installation operation ID' },
  }),
})

export function hostToolsHelp(command) {
  if (command && COMMAND_SCHEMAS[command]) {
    const flags = formatFlagHelp(COMMAND_SCHEMAS[command])
    return [
      `Usage: storyboard host-tools ${command}${flags ? ' [flags]' : ''}`,
      flags,
    ].filter(Boolean).join('\n\n')
  }
  return [
    'Usage: storyboard host-tools <command> [flags]',
    '',
    'Commands:',
    '  preflight                         Inspect supported host tools',
    '  plan --agents <id[,id]>           Create an install plan; --agents may repeat',
    '  install --plan <id> --consent     Start a consented install plan',
    '  status --operation <id>           Read an installation operation',
    '  cancel --operation <id>           Request operation cancellation',
  ].join('\n')
}

export function parseAgentSelection(values) {
  if (values === undefined) return []
  const selected = values.flatMap((value) => String(value).split(',').map((id) => id.trim()))
  if (selected.some((id) => !id)) throw new Error('--agents cannot contain an empty agent ID')
  const invalid = selected.filter((id) => !AGENT_ID_SET.has(id))
  if (invalid.length) throw new Error(`Unknown agent ID: ${invalid.join(', ')}. Allowed: ${AGENT_IDS.join(', ')}`)
  if (new Set(selected).size !== selected.length) throw new Error('--agents must contain unique agent IDs')
  return selected
}

function parsedCommand(command, args) {
  const schema = COMMAND_SCHEMAS[command]
  if (!schema) throw new Error(`Unknown host-tools command: ${command || '(none)'}`)
  const parsed = parseFlags(args, schema)
  if (parsed.positional.length) parsed.errors.push(`Unexpected arguments: ${parsed.positional.join(', ')}`)
  if (parsed.missing.length) parsed.errors.push(`Missing required flags: ${parsed.missing.map((name) => `--${name}`).join(', ')}`)
  if (parsed.errors.length) throw new Error(parsed.errors.join('; '))
  return parsed.flags
}

export async function runHostToolsCommand(args, request = { get, post }) {
  const [command, ...commandArgs] = args
  if (!command || command === 'help' || command === '--help') return { help: hostToolsHelp() }
  if (commandArgs.includes('--help') || commandArgs.includes('-h')) return { help: hostToolsHelp(command) }

  const flags = parsedCommand(command, commandArgs)
  if (command === 'preflight') return request.get(`${API_PATH}/preflight`)
  if (command === 'plan') {
    return request.post(`${API_PATH}/plan`, { selectedAgentIds: parseAgentSelection(flags.agents) })
  }
  if (command === 'install') {
    return request.post(`${API_PATH}/install`, { planId: flags.plan, consent: flags.consent })
  }
  if (command === 'status') {
    return request.get(`${API_PATH}/operations/${encodeURIComponent(flags.operation)}`)
  }
  return request.post(`${API_PATH}/operations/${encodeURIComponent(flags.operation)}/cancel`, {})
}

export async function main(args = process.argv.slice(3)) {
  try {
    const result = await runHostToolsCommand(args)
    if (result.help) console.log(result.help)
    else console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    console.error(JSON.stringify({ error: { code: 'CLI_ERROR', message: error.message } }, null, 2))
    process.exitCode = 1
  }
}
