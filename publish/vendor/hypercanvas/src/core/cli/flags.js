/**
 * Shared CLI flag parser — converts argv into a validated flags object.
 *
 * Supports:
 *   --key value       string/number value
 *   --key=value       equals-separated
 *   --bool            boolean true
 *   --no-bool         boolean false (negation prefix)
 *   --key a --key b   repeated flags → array
 *
 * Usage:
 *   const { flags, missing, errors } = parseFlags(process.argv.slice(3), schema)
 */

/**
 * @typedef {Object} FlagDef
 * @property {'string'|'boolean'|'number'|'array'} type
 * @property {boolean} [required]
 * @property {*} [default]
 * @property {string} [description]
 * @property {string[]} [aliases] - short or alternate names (without --)
 */

/**
 * @typedef {Object<string, FlagDef>} FlagSchema
 */

/**
 * Parse argv tokens against a schema.
 *
 * @param {string[]} argv - process.argv tokens (after command words are stripped)
 * @param {FlagSchema} schema
 * @returns {{ flags: Object, positional: string[], missing: string[], errors: string[] }}
 */
export function parseFlags(argv, schema) {
  const flags = {}
  const positional = []
  const errors = []

  // Build alias → canonical name map
  const aliasMap = {}
  for (const [name, def] of Object.entries(schema)) {
    aliasMap[name] = name
    if (def.aliases) {
      for (const alias of def.aliases) {
        aliasMap[alias] = name
      }
    }
  }

  // Seed defaults
  for (const [name, def] of Object.entries(schema)) {
    if (def.default !== undefined) {
      flags[name] = def.default
    }
  }

  let i = 0
  while (i < argv.length) {
    const token = argv[i]

    if (!token.startsWith('-')) {
      positional.push(token)
      i++
      continue
    }

    // Strip leading dashes
    let raw = token.replace(/^--?/, '')
    let value

    // Handle --key=value
    const eqIdx = raw.indexOf('=')
    if (eqIdx !== -1) {
      value = raw.slice(eqIdx + 1)
      raw = raw.slice(0, eqIdx)
    }

    // Handle --no-<key> negation
    let negated = false
    if (raw.startsWith('no-') && !aliasMap[raw]) {
      const candidate = raw.slice(3)
      if (aliasMap[candidate]) {
        raw = candidate
        negated = true
      }
    }

    const canonical = aliasMap[raw]
    if (!canonical) {
      errors.push(`Unknown flag: --${raw}`)
      i++
      continue
    }

    const def = schema[canonical]

    if (def.type === 'boolean') {
      if (value !== undefined) {
        // Handle --flag=true / --flag=false
        const lower = value.toLowerCase()
        if (lower === 'true' || lower === '1') flags[canonical] = !negated
        else if (lower === 'false' || lower === '0') flags[canonical] = negated
        else errors.push(`Flag --${raw} is boolean; use --${raw}, --no-${raw}, or --${raw}=true|false`)
      } else {
        flags[canonical] = !negated
      }
      i++
      continue
    }

    // Consume next token as value if we didn't get one from `=`
    if (value === undefined) {
      i++
      if (i >= argv.length) {
        errors.push(`Flag --${raw} requires a value`)
        continue
      }
      value = argv[i]
    }

    if (def.type === 'number') {
      const num = Number(value)
      if (Number.isNaN(num)) {
        errors.push(`Flag --${raw} must be a number, got "${value}"`)
      } else {
        flags[canonical] = num
      }
    } else if (def.type === 'array') {
      if (!Array.isArray(flags[canonical])) flags[canonical] = []
      flags[canonical].push(value)
    } else {
      // string (or JSON for object-typed flags)
      flags[canonical] = value
    }

    i++
  }

  // Check required
  const missing = []
  for (const [name, def] of Object.entries(schema)) {
    if (def.required && (flags[name] === undefined || flags[name] === '')) {
      missing.push(name)
    }
  }

  return { flags, positional, missing, errors }
}

/**
 * Check if any flags were provided (beyond defaults).
 * Useful to decide interactive vs non-interactive mode.
 */
export function hasFlags(argv) {
  return argv.some((t) => t.startsWith('-'))
}

/**
 * Format a schema into help text lines.
 *
 * @param {FlagSchema} schema
 * @returns {string}
 */
export function formatFlagHelp(schema) {
  const lines = []
  for (const [name, def] of Object.entries(schema)) {
    const aliases = def.aliases ? def.aliases.map((a) => `-${a}`).join(', ') + ', ' : ''
    const req = def.required ? ' (required)' : ''
    const defVal = def.default !== undefined ? ` [default: ${def.default}]` : ''
    lines.push(`  ${aliases}--${name.padEnd(16)} ${def.description || ''}${req}${defVal}`)
  }
  return lines.join('\n')
}
