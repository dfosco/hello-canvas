/**
 * storyboard canvas roles — List available hub roles.
 *
 * Usage:
 *   storyboard canvas roles
 *   storyboard canvas roles --json
 *
 * Flags:
 *   --json    Output as JSON
 */

import { get, parseSimpleArgs, jsonOut, die } from './cliHelpers.js'

const args = process.argv.slice(4) // skip: node, sb, canvas, roles

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
  canvas roles flags:

    --json    Output as JSON
`)
  process.exit(0)
}

const { flags } = parseSimpleArgs(args)

try {
  const result = await get('/_storyboard/canvas/roles')
  if (flags.json) {
    jsonOut(result)
  } else {
    const roles = result.roles || []
    if (roles.length === 0) {
      console.log('No roles found')
    } else {
      for (const role of roles) {
        const tags = []
        if (role.type) tags.push(role.type)
        if (role.default) tags.push('default')
        console.log(`  ${role.name}${tags.length ? ` (${tags.join(', ')})` : ''} — ${role.title || role.name}`)
      }
    }
  }
} catch (err) { die(err.message) }
