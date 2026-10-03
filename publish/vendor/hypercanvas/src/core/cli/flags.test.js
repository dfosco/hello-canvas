import { describe, it, expect } from 'vitest'
import { parseFlags, hasFlags, formatFlagHelp } from './flags.js'

const testSchema = {
  name: { type: 'string', required: true, description: 'Name', aliases: ['n'] },
  title: { type: 'string', description: 'Title', aliases: ['t'] },
  count: { type: 'number', description: 'Count', default: 0 },
  verbose: { type: 'boolean', description: 'Verbose', default: false },
  tags: { type: 'array', description: 'Tags', aliases: ['g'] },
}

describe('parseFlags', () => {
  it('parses --key value pairs', () => {
    const { flags } = parseFlags(['--name', 'hello', '--title', 'world'], testSchema)
    expect(flags.name).toBe('hello')
    expect(flags.title).toBe('world')
  })

  it('parses --key=value syntax', () => {
    const { flags } = parseFlags(['--name=hello'], testSchema)
    expect(flags.name).toBe('hello')
  })

  it('parses short aliases', () => {
    const { flags } = parseFlags(['-n', 'hello', '-t', 'world'], testSchema)
    expect(flags.name).toBe('hello')
    expect(flags.title).toBe('world')
  })

  it('parses boolean flags', () => {
    const { flags } = parseFlags(['--verbose', '--name', 'x'], testSchema)
    expect(flags.verbose).toBe(true)
  })

  it('parses --no- negation for booleans', () => {
    const { flags } = parseFlags(['--no-verbose', '--name', 'x'], testSchema)
    expect(flags.verbose).toBe(false)
  })

  it('parses --flag=false for booleans', () => {
    const { flags } = parseFlags(['--verbose=false', '--name', 'x'], testSchema)
    expect(flags.verbose).toBe(false)
  })

  it('parses --flag=true for booleans', () => {
    const { flags } = parseFlags(['--verbose=true', '--name', 'x'], testSchema)
    expect(flags.verbose).toBe(true)
  })

  it('parses --no-flag=false as double negation (true)', () => {
    const { flags } = parseFlags(['--no-verbose=false', '--name', 'x'], testSchema)
    expect(flags.verbose).toBe(true)
  })

  it('reports error for invalid boolean value', () => {
    const { errors } = parseFlags(['--verbose=maybe', '--name', 'x'], testSchema)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('boolean')
  })

  it('parses number flags', () => {
    const { flags } = parseFlags(['--name', 'x', '--count', '42'], testSchema)
    expect(flags.count).toBe(42)
  })

  it('reports error for non-numeric number flag', () => {
    const { errors } = parseFlags(['--name', 'x', '--count', 'abc'], testSchema)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('must be a number')
  })

  it('collects repeated flags into arrays', () => {
    const { flags } = parseFlags(['--name', 'x', '-g', 'a', '-g', 'b'], testSchema)
    expect(flags.tags).toEqual(['a', 'b'])
  })

  it('collects positional arguments', () => {
    const { positional } = parseFlags(['sticky-note', '--name', 'x'], testSchema)
    expect(positional).toEqual(['sticky-note'])
  })

  it('reports missing required flags', () => {
    const { missing } = parseFlags(['--title', 'hello'], testSchema)
    expect(missing).toContain('name')
  })

  it('does not report missing when required flag is provided', () => {
    const { missing } = parseFlags(['--name', 'hello'], testSchema)
    expect(missing).not.toContain('name')
  })

  it('reports unknown flags', () => {
    const { errors } = parseFlags(['--name', 'x', '--unknown', 'y'], testSchema)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('Unknown flag')
  })

  it('applies defaults', () => {
    const { flags } = parseFlags(['--name', 'x'], testSchema)
    expect(flags.count).toBe(0)
    expect(flags.verbose).toBe(false)
  })

  it('reports error when value flag has no value', () => {
    const { errors } = parseFlags(['--name'], testSchema)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('requires a value')
  })

  it('returns empty results for empty argv', () => {
    const { flags, positional, missing, errors } = parseFlags([], testSchema)
    expect(positional).toEqual([])
    expect(errors).toEqual([])
    expect(missing).toContain('name')
    expect(flags.count).toBe(0)
  })
})

describe('hasFlags', () => {
  it('returns true when argv has flags', () => {
    expect(hasFlags(['--name', 'x'])).toBe(true)
  })

  it('returns true for short flags', () => {
    expect(hasFlags(['-n', 'x'])).toBe(true)
  })

  it('returns false when no flags', () => {
    expect(hasFlags(['positional'])).toBe(false)
  })

  it('returns false for empty argv', () => {
    expect(hasFlags([])).toBe(false)
  })
})

describe('formatFlagHelp', () => {
  it('includes flag names and descriptions', () => {
    const output = formatFlagHelp(testSchema)
    expect(output).toContain('--name')
    expect(output).toContain('Name')
    expect(output).toContain('(required)')
  })

  it('includes aliases', () => {
    const output = formatFlagHelp(testSchema)
    expect(output).toContain('-n')
  })

  it('includes defaults', () => {
    const output = formatFlagHelp(testSchema)
    expect(output).toContain('[default: 0]')
    expect(output).toContain('[default: false]')
  })
})
