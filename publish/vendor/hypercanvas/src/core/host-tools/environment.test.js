import { describe, expect, it } from 'vitest'
import { AGENT_CATALOG, AGENT_IDS, getAgentDefinition } from './catalog.js'
import { discoverHostEnvironment, resolveHostExecutable } from './environment.js'

function virtualFs({ directories = [], files = [], links = {} } = {}) {
  const directorySet = new Set(directories)
  const fileSet = new Set(files)
  const resolveLink = (path) => links[path] || path
  return {
    accessSync(path) {
      if (!fileSet.has(resolveLink(path))) throw new Error('ENOENT')
    },
    realpathSync(path) {
      const resolved = resolveLink(path)
      if (!directorySet.has(resolved) && !fileSet.has(resolved)) throw new Error('ENOENT')
      return resolved
    },
    statSync(path) {
      const resolved = resolveLink(path)
      if (!directorySet.has(resolved) && !fileSet.has(resolved)) throw new Error('ENOENT')
      return {
        isDirectory: () => directorySet.has(resolved),
        isFile: () => fileSet.has(resolved),
      }
    },
  }
}

describe('host environment discovery', () => {
  it('prefers, sanitizes, enriches, and deduplicates the captured host PATH', () => {
    const fs = virtualFs({
      directories: ['/host/bin', '/opt/homebrew/bin', '/bundle/bin', '/project/node_modules/.bin'],
      links: { '/host/link': '/host/bin' },
    })
    const result = discoverHostEnvironment({
      env: {
        HOME: '/Users/test',
        PATH: '/wrong/path',
        HYPERCANVAS_HOST_PATH: '/host/bin:/host/link:relative:/missing:/bundle/bin:/project/node_modules/.bin',
        HYPERCANVAS_BUNDLE_ROOT: '/bundle',
      },
      fs,
      home: '/Users/test',
    })

    expect(result.source).toBe('HYPERCANVAS_HOST_PATH')
    expect(result.entries).toEqual(['/host/bin', '/opt/homebrew/bin'])
    expect(result.path).toBe('/host/bin:/opt/homebrew/bin')
    expect(result.rejected).toEqual(expect.arrayContaining([
      { path: 'relative', reason: 'not_absolute' },
      { path: '/bundle/bin', reason: 'bundle' },
      { path: '/project/node_modules/.bin', reason: 'node_modules_bin' },
    ]))
  })

  it('falls back to PATH in non-packaged development', () => {
    const fs = virtualFs({ directories: ['/dev/bin'] })
    const result = discoverHostEnvironment({ env: { PATH: '/dev/bin' }, fs })

    expect(result.source).toBe('PATH')
    expect(result.entries).toEqual(['/dev/bin'])
  })

  it('returns canonical executable paths and rejects symlinks into the bundle', () => {
    const fs = virtualFs({
      directories: ['/host/bin', '/real/bin', '/bundle', '/bundle/bin'],
      files: ['/real/bin/node', '/bundle/bin/npm'],
      links: {
        '/host/bin': '/real/bin',
        '/real/bin/npm': '/bundle/bin/npm',
      },
    })
    const environment = discoverHostEnvironment({
      env: { HYPERCANVAS_HOST_PATH: '/host/bin', HYPERCANVAS_BUNDLE_ROOT: '/bundle' },
      fs,
    })

    expect(environment.entries).toEqual(['/real/bin'])
    expect(resolveHostExecutable('node', { environment, fs })).toBe('/real/bin/node')
    expect(resolveHostExecutable('npm', { environment, fs })).toBeNull()
  })

  it('resolves agent executables from code-owned known paths outside PATH', () => {
    const fs = virtualFs({
      directories: ['/host/bin', '/Users/test/.opencode/bin'],
      files: ['/Users/test/.opencode/bin/opencode'],
    })
    const environment = discoverHostEnvironment({ env: { HYPERCANVAS_HOST_PATH: '/host/bin' }, fs, home: '/Users/test' })
    const definition = getAgentDefinition('opencode')

    expect(resolveHostExecutable(definition.executable, {
      environment,
      knownPaths: definition.knownPaths,
      fs,
      home: '/Users/test',
    })).toBe('/Users/test/.opencode/bin/opencode')
  })
})

describe('agent catalog', () => {
  it('is closed, frozen, and carries reviewed official metadata for the four supported agents', () => {
    expect(AGENT_IDS).toEqual(['codex', 'claude', 'copilot', 'opencode'])
    expect(AGENT_CATALOG.map(({ install }) => install.origin)).toEqual([
      'https://chatgpt.com/codex/install.sh',
      'https://claude.ai/install.sh',
      'https://gh.io/copilot-install',
      'https://opencode.ai/install',
    ])
    expect(Object.isFrozen(AGENT_CATALOG)).toBe(true)
    expect(getAgentDefinition('other')).toBeNull()
    for (const definition of AGENT_CATALOG) {
      expect(definition).toMatchObject({
        executable: definition.id,
        versionArgs: ['--version'],
        install: {
          channel: 'official-https-installer',
          shell: '/bin/bash',
          modifiesShellProfile: definition.id === 'claude',
          authentication: 'user-managed',
        },
      })
      expect(Object.isFrozen(definition.install)).toBe(true)
      expect(Object.isFrozen(definition.install.allowedFinalUrls)).toBe(true)
      expect(Object.isFrozen(definition.install.args)).toBe(true)
      expect(Object.isFrozen(definition.install.env)).toBe(true)
      expect(definition.install.integrity).toContain('No fixed checksum')
    }
  })
})
