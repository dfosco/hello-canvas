import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readRepoConfig, diffRepoIdentity, writeRepoConfig } from './repoConfig.js'

let dir

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'storyboard-repo-cfg-'))
})

afterEach(() => {
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
})

describe('readRepoConfig', () => {
  it('returns exists=false when the file is missing', () => {
    const result = readRepoConfig(dir)
    expect(result.exists).toBe(false)
    expect(result.config).toEqual({})
  })

  it('parses a well-formed file', () => {
    writeFileSync(join(dir, 'storyboard.config.json'), '{"repository":{"owner":"a","name":"b"}}', 'utf8')
    const { exists, config } = readRepoConfig(dir)
    expect(exists).toBe(true)
    expect(config.repository).toEqual({ owner: 'a', name: 'b' })
  })

  it('tolerates malformed JSON (returns {})', () => {
    writeFileSync(join(dir, 'storyboard.config.json'), '{not json', 'utf8')
    const { exists, config } = readRepoConfig(dir)
    expect(exists).toBe(true)
    expect(config).toEqual({})
  })
})

describe('diffRepoIdentity', () => {
  it('returns nothing when desired matches current', () => {
    const current = {
      repository: { owner: 'a', name: 'b' },
      prodDomain: 'https://a.github.io/b/',
    }
    expect(diffRepoIdentity(current, { owner: 'a', name: 'b', prodDomain: 'https://a.github.io/b/' })).toEqual([])
  })

  it('returns only the differing fields', () => {
    const current = { repository: { owner: 'a', name: 'old' }, prodDomain: 'https://a.github.io/old/' }
    const updates = diffRepoIdentity(current, { owner: 'a', name: 'new', prodDomain: 'https://a.github.io/new/' })
    expect(updates.map((u) => u.label).sort()).toEqual(['prodDomain', 'repository.name'])
  })

  it('skips empty desired values (does not overwrite with empty)', () => {
    const current = { repository: { owner: 'a', name: 'b' }, prodDomain: 'https://a.github.io/b/' }
    expect(diffRepoIdentity(current, { owner: '', name: '', prodDomain: '' })).toEqual([])
  })
})

describe('writeRepoConfig formatting preservation', () => {
  it('preserves tabs and key order', () => {
    const src = [
      '{',
      '\t"repository": {',
      '\t\t"owner": "old",',
      '\t\t"name": "old"',
      '\t},',
      '\t"prodDomain": "https://old.github.io/old/",',
      '\t"devDomainColor": "#663399"',
      '}',
      '',
    ].join('\n')
    writeFileSync(join(dir, 'storyboard.config.json'), src, 'utf8')

    const { config } = readRepoConfig(dir)
    const updates = diffRepoIdentity(config, { owner: 'alice', name: 'my-fork', prodDomain: 'https://alice.github.io/my-fork/' })
    writeRepoConfig(dir, updates)

    const out = readFileSync(join(dir, 'storyboard.config.json'), 'utf8')
    expect(out).toContain('\t"repository":')
    expect(out).toContain('\t\t"owner": "alice"')
    expect(out).toContain('\t\t"name": "my-fork"')
    expect(out).toContain('\t"prodDomain": "https://alice.github.io/my-fork/"')
    // unrelated field untouched
    expect(out).toContain('"devDomainColor": "#663399"')
    // key order: repository first, prodDomain after
    expect(out.indexOf('repository')).toBeLessThan(out.indexOf('prodDomain'))
  })

  it('preserves 2-space indent', () => {
    const src = [
      '{',
      '  "repository": {',
      '    "owner": "old",',
      '    "name": "old"',
      '  }',
      '}',
      '',
    ].join('\n')
    writeFileSync(join(dir, 'storyboard.config.json'), src, 'utf8')

    const updates = diffRepoIdentity(JSON.parse(src), { owner: 'alice', name: 'my-fork', prodDomain: '' })
    writeRepoConfig(dir, updates)

    const out = readFileSync(join(dir, 'storyboard.config.json'), 'utf8')
    expect(out).toContain('  "repository":')
    expect(out).toContain('    "owner": "alice"')
    expect(out).not.toContain('\t')
  })

  it('leaves the file on disk on no-op write', () => {
    const src = '{\n\t"repository": { "owner": "a", "name": "b" }\n}\n'
    writeFileSync(join(dir, 'storyboard.config.json'), src, 'utf8')
    writeRepoConfig(dir, [])
    const out = readFileSync(join(dir, 'storyboard.config.json'), 'utf8')
    expect(out).toBe(src)
    expect(existsSync(join(dir, 'storyboard.config.json'))).toBe(true)
  })
})
